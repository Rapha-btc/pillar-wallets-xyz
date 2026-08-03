// simul-juice-safe-v1-lifecycle.js
// Stxer mainnet-fork simulation for juice-safe-v1 + juice-safe-auth-helpers-v1,
// both DEPLOYED FRESH in the sim (neither exists on mainnet yet), exercising the
// pox-5 staking surface against the LIVE pox-5 boot contract and the LIVE
// SPV9K21....juice-pool-stx-signer.
//
// What this is actually here to answer:
//   1. Does `unstake` work with an EMPTY as-contract? allowance list? pox-5's
//      unstake body only rewrites maps, but the staking asset event is emitted
//      NODE-side, not by a Clarity primitive, so reading the source cannot
//      settle it. This is the whole reason the sim exists.
//   2. Do (with-stacking N) allowances admit the stake / stake-update locks?
//   3. Do the three juice-safe-auth-helpers-v1 builders produce hashes the
//      wallet accepts? The helper is brand new and nothing has ever signed
//      against it.
//   4. Does the stake / stake-update split behave, given the wallet no longer
//      reads pox-5 state to pick between them?
//
// Coverage:
//   A  deploy helper -> deploy wallet -> verify -> fund -> onboard
//   B1 stake-stx-juice by a random principal          -> u4001
//   B2 stake-stx-juice amount u0 (admin)              -> u4026
//   B3 stake-stx-juice (PASSKEY, rp juiceofbtc.com)   -> ok      [helper #1]
//   B4 STX actually locked on the SAFE                -> stx-account
//   C1 update-stake-stx-juice top-up (admin)          -> ok
//   C2 update-stake-stx-juice amount u0 + cycles u0   -> u4026
//   C3 update-stake-stx-juice PURE EXTEND (PASSKEY)   -> ok      [helper #2]
//                                                     -> (with-stacking u0)
//   -- ADVANCE past the cycle boundary (140 -> 141) --
//   E1 STX is now ACTUALLY LOCKED (first-reward-cycle reached)
//   E2 top-up AGAINST A LIVE LOCK -- the only way to actually exercise
//      (with-stacking (+ (locked-ustx) amount-increase)). Pre-advance the node
//      writes no stacking entry, so the allowance branch is skipped and a
//      buggy allowance passes just as happily (proven: simul-allowance-probe).
//   E3 extend now has room: num-cycles decayed 96 -> 95, so +1 is legal where
//      it was ERR_INVALID_NUM_CYCLES (u20) before any time passed.
//   E4 rewards visible for the cycle
//   D1 unstake by a random principal                  -> u4001
//   D2 unstake (PASSKEY)                              -> ok      [helper #3]
//
// ORDERING NOTE. pox-5 leaves staker-info in place after `unstake` (it only
// shortens num-cycles), so a second `stake` would hit ERR_ALREADY_STAKED. Every
// stake/update step therefore runs BEFORE the unstake, and unstake is last.
//
// Run: node simul-juice-safe-v1.js
import crypto from "node:crypto";
import {
  tupleCV,
  uintCV,
  bufferCV,
  noneCV,
  someCV,
  principalCV,
  standardPrincipalCV,
  listCV,
  contractPrincipalCV,
  stringAsciiCV,
  serializeCV,
  deserializeCV,
  cvToString,
  PostConditionMode,
} from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";
import {
  generateP256Keypair,
  signChallengeWithRpId,
} from "./lib-webauthn-test-signer.mjs";

// -- actors ------------------------------------------------------------------
const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const OWNER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";
const RECOVERY = "SP3HXJJMJQ06GNAZ8XWDN1QM48JEDC6PP6W3YZPZJ";
const RANDOM = "SP1MGH8BH1KRY49Z7EE5TY0JVKT6C3NT9RTVM8FND";
const RECIPIENT = "SP22WH53NS94VR6N145ZX77BK4S0EWFBE41VW3Z6B";   // withdrawal target
const WD_STX_UNDER = 50_000_000;    // 50 STX, under the 100 STX threshold
const WD_STX_OVER = 400_000_000;    // 400 STX, OVER -> must become a pending op
const WD_SBTC = 1_000;              // sats, under the 100k threshold
const SBTC_BIG_FUND = 500_000;      // sats, so we can exceed the 100k threshold
const WD_SBTC_OVER = 150_000;       // sats, OVER -> pending op
const RELAYER = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM";
const STX_WHALE = "SP9BP4PN74CNR5XT7CMAMBPA0GWC9HMB69HVVV51";

// -- contracts ---------------------------------------------------------------
const WALLET_NAME = "juice-safe-v1";
const HELPER_NAME = "juice-safe-auth-helpers-v1";
const WALLET = `${DEPLOYER}.${WALLET_NAME}`;
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core`;
const POX5 = "SP000000000000000000002Q6VF78.pox-5";
const SIGNER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-pool-stx-signer";
const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const SBTC_WHALE = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";
const GAS_STATION_NAME = "gas-station";   // get-gas u20, get-sponsor SPV9K21T...
const SBTC_FUND = 5_000;
const GAS_SATS = 20n;
const GAS_TOPUP_USTX = 50_000_000;
const REWARD_SATS = 2_000_000;   // sBTC sent to pox-5 = the cycle's rewards
const REWARD_CYCLE = 141;
// REAL Juice stakers with live cycle-141 shares, discovered on chain from
// pox-5 stake/stake-update calls and the signer's set-og list. Paid in the
// same fold as the safe, to exercise pay-stx-stakers across a real list
// rather than a single synthetic entry.
const REAL_STAKERS = [
  "SP3TA7SMY7APYR9SFKDT0527NC0GWR84S3AHEM0NE",  // u50055762570
  "SP3A4CP63QJB1R0EJR3TJ1PN16FC5HVJSPT77C8C0",  // u42025933179
  "SP3TS3T9GSGFEDW7ZBJNFXMH6RY0AP7HNCQEE77DH",  // u10000357028
  "SP3WAAYXPC6WZNEC7SHGR36D32RJPZVXRR1BG0QSY",  // u370074740
  "SP1JAG6TV2XRYFGJN7CAAN6Z3CEW2YMZWMHJAJV91",  // u290373791
  "SP389APB4DHZ836P4AE9RJW7EKEZAPV5NPDNG7N46",  // u218045440
  "SP18QG8A8943KY9S15M08AMAWWF58W9X1M90BRCSJ",  // u101208721
  "SP218F71JZ4R2ERQDKEBGA1FKVAQNZBM3HK7W8EA7",  // u100975859
];

const STACKS_NODE_API = "http://77.42.3.101/stacks-api";
const RP_ID = "juiceofbtc.com"; // RP-ID-HASH-JUICEOFBTC-COM is whitelisted

// -- amounts -----------------------------------------------------------------
// The safe is funded with 1,500 STX and stakes 1,000 then tops up 200. pox-5
// requires the locked amount to be covered by the account's balance, and leaves
// enough unlocked for fees.
const FUND_USTX = 2_800_000_000;   // whale holds ~3139 STX; locks are real now
const STAKE_USTX = 1_000_000_000;
const TOPUP_USTX = 200_000_000;
const EXTEND_CYCLES = 1;   // 96 is the max; post-advance num-cycles is 95
const ADVANCE_BLOCKS = 1360; // 1346 to the boundary + margin, lands in cycle 141
const STX_THRESHOLD = 100_000_000;
const SBTC_THRESHOLD = 100_000;

// -- SIP-018 (mirrors juice-safe-auth-helpers-v1) -----------------------------
const SIP018_PREFIX = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const cvSha256 = (cv) => {
  const out = serializeCV(cv);
  return typeof out === "string" ? sha256(Buffer.from(out, "hex")) : sha256(Buffer.from(out));
};
// Domain tuple is byte-identical to helpers-v7's, with wallet = contract-caller
// (the wallet, since the wallet is what calls the helper).
function walletDomainHash() {
  return cvSha256(tupleCV({
    name: stringAsciiCV("smart-wallet-standard"),
    version: stringAsciiCV("1.0.0"),
    "chain-id": uintCV(1),
    wallet: principalCV(WALLET),
  }));
}
const buildChallenge = (topicTuple) =>
  sha256(Buffer.concat([SIP018_PREFIX, walletDomainHash(), cvSha256(topicTuple)]));

const tStake = (authId, amountUstx) =>
  tupleCV({
    topic: stringAsciiCV("stake-stx-juice-pox5"),
    "auth-id": uintCV(authId),
    "amount-ustx": uintCV(amountUstx),
  });
const tUpdateStake = (authId, amountIncrease, cyclesToExtend) =>
  tupleCV({
    topic: stringAsciiCV("update-stake-stx-juice"),
    "auth-id": uintCV(authId),
    "amount-increase": uintCV(amountIncrease),
    "cycles-to-extend": uintCV(cyclesToExtend),
  });
const tExecuteNow = (authId, opId) =>
  tupleCV({
    topic: stringAsciiCV("execute-now"),
    "auth-id": uintCV(authId),
    "op-id": uintCV(opId),
  });
const tUnstake = (authId) =>
  tupleCV({
    topic: stringAsciiCV("unstake-stx-juice"),
    "auth-id": uintCV(authId),
  });

const strip = (h) => (h.startsWith("0x") ? h.slice(2) : h);
function sigAuthTuple(authId, pubKeyHex, signed) {
  return tupleCV({
    "auth-id": uintCV(authId),
    pubkey: bufferCV(Buffer.from(strip(pubKeyHex), "hex")),
    signature: bufferCV(Buffer.from(strip(signed.signatureHex), "hex")),
    "authenticator-data": bufferCV(Buffer.from(strip(signed.authenticatorDataHex), "hex")),
    "client-data-prefix": bufferCV(Buffer.from(strip(signed.clientDataPrefixHex), "hex")),
    "client-data-suffix": bufferCV(Buffer.from(strip(signed.clientDataSuffixHex), "hex")),
  });
}

async function main() {
  const key = generateP256Keypair();
  const sign = (challenge, rp = RP_ID) => signChallengeWithRpId(challenge, key.privKey, rp);
  const pubkeyCV = bufferCV(Buffer.from(strip(key.pubKeyHex), "hex"));

  const sigStake = sign(buildChallenge(tStake(1, STAKE_USTX)));
  const sigExtend = sign(buildChallenge(tUpdateStake(2, 0, EXTEND_CYCLES)));
  const sigUnstake = sign(buildChallenge(tUnstake(3)));
  const sigGasTopup = sign(buildChallenge(tUpdateStake(7, GAS_TOPUP_USTX, 0)));
  const sigNow0 = sign(buildChallenge(tExecuteNow(8, 0)));
  const sigNowSbtc = sign(buildChallenge(tExecuteNow(9, 2)));   // op 2 = first sBTC op

  const plan = [];
  const b = SimulationBuilder.new({ stacksNodeAPI: STACKS_NODE_API });
  const evalc = (label, code, capture, at = WALLET) => {
    b.addEvalCode(at, code);
    plan.push({ kind: "eval", label, capture });
  };
  const call = (label, sender, cid, fn, args, expect, capture) => {
    b.withSender(sender).addContractCall({
      contract_id: cid, function_name: fn, function_args: args,
      post_condition_mode: PostConditionMode.Allow,
    });
    plan.push({ kind: "tx", label, expect, capture });
  };
  const okre = /^\(ok/;

  // -- A: contracts are ALREADY DEPLOYED on mainnet; exercise the real bytes.
  //    (An earlier revision deployed them fresh in-sim; that now collides with
  //    "Duplicate contract". Testing the deployed bytes is strictly better.)
  call("set-verified-contract(juice-safe-v1)", DEPLOYER, WALLET_CORE,
    "set-verified-contract", [principalCV(WALLET), noneCV()], okre);
  b.withSender(STX_WHALE).addSTXTransfer({ recipient: WALLET, amount: FUND_USTX });
  plan.push({ kind: "fund", label: `fund safe ${FUND_USTX / 1e6} STX (whale)` });
  call("onboard(pubkey, OWNER, some(RECOVERY), thresholds)", FAKFUN_DEPLOYER, WALLET,
    "onboard",
    [pubkeyCV, standardPrincipalCV(OWNER), someCV(standardPrincipalCV(RECOVERY)),
     uintCV(STX_THRESHOLD), uintCV(SBTC_THRESHOLD)],
    okre);
  evalc("owner == OWNER", "(get-owner)", "owner0");
  evalc("safe stx-account BEFORE stake", `(stx-account '${WALLET})`, "acct0");

  // -- B: stake ---------------------------------------------------------------
  call("B1 stake by random -> u4001", RANDOM, WALLET,
    "stake-stx-juice", [uintCV(STAKE_USTX), noneCV(), noneCV()], "(err u4001)");
  call("B2 stake amount u0 (admin) -> u4026", OWNER, WALLET,
    "stake-stx-juice", [uintCV(0), noneCV(), noneCV()], "(err u4026)");
  call("B3 stake (PASSKEY rp=juiceofbtc.com) -> ok", RELAYER, WALLET,
    "stake-stx-juice",
    [uintCV(STAKE_USTX), someCV(sigAuthTuple(1, key.pubKeyHex, sigStake)), noneCV()],
    okre);
  evalc("safe stx-account AFTER stake (expect locked>0)", `(stx-account '${WALLET})`, "acct1");
  evalc("pox-5 staker-info AFTER stake", `(contract-call? '${POX5} get-staker-info '${WALLET})`,
    "info1", WALLET);

  // -- C: stake-update --------------------------------------------------------
  call("C1 update top-up (admin) -> ok", OWNER, WALLET,
    "update-stake-stx-juice", [uintCV(TOPUP_USTX), uintCV(0), noneCV(), noneCV()], okre);
  evalc("safe stx-account AFTER top-up", `(stx-account '${WALLET})`, "acct2");
  // ---- GAS STATION on the DEPLOYED safe -----------------------------------
  // Relayer broadcasts; the safe pays the sponsor 20 sats of sBTC out of its
  // own balance, bounded by (with-ft sbtc-token max-gas-amount) = u1000.
  call(`fund ${SBTC_FUND} sats sBTC (for gas)`, SBTC_WHALE, SBTC_TOKEN, "transfer",
    [uintCV(SBTC_FUND), standardPrincipalCV(SBTC_WHALE), principalCV(WALLET), noneCV()], okre);
  evalc("G sBTC BEFORE gas-paid call",
    `(contract-call? '${SBTC_TOKEN} get-balance '${WALLET})`, "gsb0", WALLET);
  call("G top-up via PASSKEY + GAS STATION (safe pays 20 sats) -> ok",
    RELAYER, WALLET, "update-stake-stx-juice",
    [uintCV(GAS_TOPUP_USTX), uintCV(0),
     someCV(sigAuthTuple(7, key.pubKeyHex, sigGasTopup)),
     someCV(contractPrincipalCV(DEPLOYER, GAS_STATION_NAME))], okre);
  evalc("G sBTC AFTER gas-paid call",
    `(contract-call? '${SBTC_TOKEN} get-balance '${WALLET})`, "gsb1", WALLET);

  call("C2 update with amount u0 AND cycles u0 -> u4026", OWNER, WALLET,
    "update-stake-stx-juice", [uintCV(0), uintCV(0), noneCV(), noneCV()], "(err u4026)");
  // -- ADVANCE across the cycle boundary so the lock actually applies --------
  b.addAdvanceBlocks({ bitcoin_blocks: ADVANCE_BLOCKS, stacks_blocks_per_bitcoin: 1 });
  plan.push({ kind: "advance", label: `advance ${ADVANCE_BLOCKS} burn blocks (cycle 140 -> 141)` });

  evalc("E1 stx-account AFTER advance (expect locked>0)", `(stx-account '${WALLET})`, "acctL");
  evalc("E1 staker-info AFTER advance", `(contract-call? '${POX5} get-staker-info '${WALLET})`,
    "infoL", WALLET);

  // THE test the pre-advance run could not do: a top-up while a real stacking
  // entry exists, so (with-stacking ...) is genuinely enforced.
  call("E2 top-up AGAINST A LIVE LOCK (admin) -> ok  <-- allowance really checked",
    OWNER, WALLET, "update-stake-stx-juice",
    [uintCV(TOPUP_USTX), uintCV(0), noneCV(), noneCV()], okre);
  evalc("E2 stx-account AFTER live top-up", `(stx-account '${WALLET})`, "acctL2");

  // num-cycles has decayed to 95, so +1 is legal now (it was u20 pre-advance).
  call("E3 extend +1 cycle (PASSKEY) -> ok", RELAYER, WALLET,
    "update-stake-stx-juice",
    [uintCV(0), uintCV(1), someCV(sigAuthTuple(2, key.pubKeyHex, sigExtend)), noneCV()],
    okre);
  evalc("E3 staker-info AFTER extend", `(contract-call? '${POX5} get-staker-info '${WALLET})`,
    "infoE", WALLET);
  // get-staker-unclaimed-rewards-for-cycle takes FOUR args in the order
  // (signer, reward-cycle, bond-index, staker) -- the pool first, staker last.
  evalc("E4 our shares in cycle 141",
    `(contract-call? '${POX5} get-staker-shares-staked-for-cycle '${WALLET} u141 none 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-pool-stx-signer)`,
    "shares", WALLET);
  evalc("E4 pool TOTAL shares cycle 141",
    `(contract-call? '${POX5} get-total-shares-staked-for-cycle u141 none)`, "tot", WALLET);
  evalc("E4 unclaimed rewards cycle 141",
    `(contract-call? '${POX5} get-staker-unclaimed-rewards-for-cycle 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-pool-stx-signer u141 none '${WALLET})`,
    "rew", WALLET);

  // ---- REWARD PAYOUT ------------------------------------------------------
  // Rewards are simply sBTC sitting in the pox-5 contract: pox-5 derives them
  // as (sbtc-balance - total-sbtc-staked - reserve). So "Juice getting paid" is
  // modelled by sending sBTC to pox-5 and then running the distribution chain:
  //   pox-5.calculate-rewards          (permissionless, needs a NEW dist cycle;
  //                                     a dist cycle is HALF a reward cycle)
  //   signer.pox-claim-rewards         pulls the signer's share into its pot
  //   signer.pay-stx-stakers           pays them out of the pot
  //   (pox-settle-stakers is NOT needed and is not called -- see below)
  evalc("R0 pox-5 sBTC balance BEFORE reward drop",
    `(contract-call? '${SBTC_TOKEN} get-balance '${POX5})`, "px0", WALLET);
  call(`R1 send ${REWARD_SATS} sats to pox-5 (= the cycle's rewards)`,
    SBTC_WHALE, SBTC_TOKEN, "transfer",
    [uintCV(REWARD_SATS), standardPrincipalCV(SBTC_WHALE), principalCV(POX5), noneCV()],
    okre);
  evalc("R1 pox-5 new-rewards seen", `(contract-call? '${POX5} get-new-rewards)`, "newrew", WALLET);

  // A distribution cycle is pox-reward-cycle-length/2 = 1050 blocks; advance
  // past one so calculate-rewards is not ERR_DISTRIBUTION_ALREADY_COMPUTED.
  b.addAdvanceBlocks({ bitcoin_blocks: 1100, stacks_blocks_per_bitcoin: 1 });
  plan.push({ kind: "advance", label: "advance 1100 (clear a distribution cycle)" });

  call("R2 pox-5.calculate-rewards (permissionless)", RELAYER, POX5,
    "calculate-rewards", [listCV([])], okre);
  call("R3 signer.pox-claim-rewards -> pulls into the Juice pot", RELAYER, SIGNER,
    "pox-claim-rewards", [listCV([]), uintCV(REWARD_CYCLE)], okre);
  evalc("R3 Juice stx-pot for cycle/tranche 0",
    `(contract-call? '${SIGNER} get-stx-pot u${REWARD_CYCLE} u0)`, "pot", WALLET);
  evalc("R3 our entitlement per the signer",
    `(contract-call? '${SIGNER} get-staker-entitlement '${WALLET} u${REWARD_CYCLE} none)`, "ent", WALLET);

  // NOTE: pox-settle-stakers is deliberately NOT called. It is not on the
  // payment path -- pay-one computes owed = pot * shares / total-shares from
  // the LOCAL pot and the shares map, neither of which settle writes. Settle
  // only moves a reward watermark inside pox-5. Skipping it proves the payout
  // stands alone. (Separately verified harmless-if-called in
  // simul-tranche-attack.js: 4 hostile settles, payouts unaffected.)
  evalc("R safe sBTC BEFORE payout",
    `(contract-call? '${SBTC_TOKEN} get-balance '${WALLET})`, "sb0", WALLET);
  REAL_STAKERS.forEach((p, i) =>
    evalc(`  real staker ${i + 1} sBTC before`,
      `(contract-call? '${SBTC_TOKEN} get-balance '${p})`, `rs${i}a`, WALLET));
  call(`R signer.pay-stx-stakers([safe + ${REAL_STAKERS.length} REAL stakers]) -> pays the whole list`,
    RELAYER, SIGNER, "pay-stx-stakers",
    [listCV([principalCV(WALLET), ...REAL_STAKERS.map((p) => standardPrincipalCV(p))]),
     uintCV(REWARD_CYCLE), uintCV(0)], okre);
  REAL_STAKERS.forEach((p, i) =>
    evalc(`  real staker ${i + 1} sBTC after`,
      `(contract-call? '${SBTC_TOKEN} get-balance '${p})`, `rs${i}b`, WALLET));
  evalc("R safe sBTC AFTER payout",
    `(contract-call? '${SBTC_TOKEN} get-balance '${WALLET})`, "sb1", WALLET);

  // ---- PAY TWICE: the stx-paid guard --------------------------------------
  call("R2 pay-stx-stakers AGAIN, same tranche, SAME LIST -> must pay NOTHING",
    RELAYER, SIGNER, "pay-stx-stakers",
    [listCV([principalCV(WALLET), ...REAL_STAKERS.map((p) => standardPrincipalCV(p))]),
     uintCV(REWARD_CYCLE), uintCV(0)], okre);
  evalc("safe sBTC after the SECOND pay",
    `(contract-call? '${SBTC_TOKEN} get-balance '${WALLET})`, "sbDouble", WALLET);

  // ---- UNSTAKE, then advance past the unlock cycle -------------------------
  call("U1 unstake (PASSKEY)", RELAYER, WALLET, "unstake",
    [someCV(sigAuthTuple(3, key.pubKeyHex, sigUnstake)), noneCV()], okre);
  evalc("LOCKED per pox-5, after unstake (position truncated, still locked)",
    `(contract-call? '${POX5} get-staker-info '${WALLET})`, "uInfo", WALLET);
  evalc("shares after unstake (next cycle)",
    `(contract-call? '${POX5} get-staker-shares-staked-for-cycle '${WALLET} u142 none '${SIGNER})`,
    "sharesNext", WALLET);
  evalc("U1 stx-account after unstake", `(stx-account '${WALLET})`, "uAcct", WALLET);

  // Roll well past the unlock cycle so a real chain would have released the STX.
  b.addAdvanceBlocks({ bitcoin_blocks: 3000, stacks_blocks_per_bitcoin: 1 });
  plan.push({ kind: "advance", label: "advance 3000 (past the unlock height)" });
  evalc("LOCKED per pox-5, AFTER unlock cycle (expect none = released)",
    `(contract-call? '${POX5} get-staker-info '${WALLET})`, "uInfo2", WALLET);
  evalc("U2 stx-account AFTER unlock (STX spendable again)",
    `(stx-account '${WALLET})`, "uAcct2", WALLET);

  // ---- WITHDRAW STX and sBTC out of the safe -------------------------------
  evalc("W recipient STX before", `(stx-get-balance '${RECIPIENT})`, "rStx0", WALLET);
  call(`W1 withdraw ${WD_STX_UNDER / 1e6} STX (UNDER threshold -> immediate)`,
    OWNER, WALLET, "stx-transfer",
    [uintCV(WD_STX_UNDER), standardPrincipalCV(RECIPIENT), noneCV(), noneCV(), noneCV()], okre);
  evalc("W1 recipient STX after", `(stx-get-balance '${RECIPIENT})`, "rStx1", WALLET);

  // Over the threshold the safe must NOT move funds -- it queues a pending op.
  call(`W2 withdraw ${WD_STX_OVER / 1e6} STX (OVER threshold -> pending op, no move)`,
    OWNER, WALLET, "stx-transfer",
    [uintCV(WD_STX_OVER), standardPrincipalCV(RECIPIENT), noneCV(), noneCV(), noneCV()], okre);
  evalc("W2 recipient STX after over-threshold attempt",
    `(stx-get-balance '${RECIPIENT})`, "rStx2", WALLET);
  evalc("W2 the pending op that was created", "(get-pending-operation u0)", "op0", WALLET);

  // ---- PATH 1: passkey 2FA lifts the cooldown ------------------------------
  // The op was created by the ADMIN key (sig-auth none), so passkey-created is
  // false and the fast path is allowed -- that is the 2FA: admin created it,
  // passkey releases it. A passkey-CREATED op cannot be fast-tracked by the
  // same passkey (that would be one factor twice) and must serve the cooldown.
  call("W4 plain execute BEFORE cooldown -> u4017", OWNER, WALLET,
    "execute-pending-stx-transfer", [uintCV(0), noneCV()], "(err u4017)");
  call("W5 execute-pending-stx-transfer-NOW (PASSKEY 2FA) -> ok, no waiting",
    RELAYER, WALLET, "execute-pending-stx-transfer-now",
    [uintCV(0), noneCV(), sigAuthTuple(8, key.pubKeyHex, sigNow0), noneCV()], okre);
  evalc("W5 recipient STX after the 2FA fast-path",
    `(stx-get-balance '${RECIPIENT})`, "rStx3", WALLET);

  // ---- PATH 2: serve the 144-block cooldown --------------------------------
  call(`W6 withdraw ${WD_STX_OVER / 1e6} STX again (OVER threshold -> op 1)`,
    OWNER, WALLET, "stx-transfer",
    [uintCV(WD_STX_OVER), standardPrincipalCV(RECIPIENT), noneCV(), noneCV(), noneCV()], okre);
  b.addAdvanceBlocks({ bitcoin_blocks: 150, stacks_blocks_per_bitcoin: 1 });
  plan.push({ kind: "advance", label: "advance 150 (past the u144 cooldown)" });
  call("W7 plain execute AFTER cooldown -> ok", OWNER, WALLET,
    "execute-pending-stx-transfer", [uintCV(1), noneCV()], okre);
  evalc("W7 recipient STX after the cooldown path",
    `(stx-get-balance '${RECIPIENT})`, "rStx4", WALLET);

  // ---- sBTC OVER the threshold: both release paths -------------------------
  call(`fund ${SBTC_BIG_FUND} sats sBTC (to exceed the 100k threshold)`,
    SBTC_WHALE, SBTC_TOKEN, "transfer",
    [uintCV(SBTC_BIG_FUND), standardPrincipalCV(SBTC_WHALE), principalCV(WALLET), noneCV()], okre);
  evalc("S recipient sBTC before the over-threshold legs",
    `(contract-call? '${SBTC_TOKEN} get-balance '${RECIPIENT})`, "sR0", WALLET);

  call(`S1 send ${WD_SBTC_OVER} sats (OVER threshold -> pending op 2, no move)`,
    OWNER, WALLET, "sip010-transfer",
    [uintCV(WD_SBTC_OVER), standardPrincipalCV(RECIPIENT), noneCV(),
     contractPrincipalCV("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token"),
     stringAsciiCV("sbtc-token"), noneCV(), noneCV()], okre);
  evalc("S1 recipient sBTC after (must be unchanged)",
    `(contract-call? '${SBTC_TOKEN} get-balance '${RECIPIENT})`, "sR1", WALLET);
  evalc("S1 the pending sBTC op", "(get-pending-operation u2)", "sOp", WALLET);

  call("S2 plain execute BEFORE cooldown -> u4017", OWNER, WALLET,
    "execute-pending-sbtc-transfer", [uintCV(2), noneCV()], "(err u4017)");
  call("S3 execute-pending-sbtc-transfer-NOW (PASSKEY 2FA) -> ok",
    RELAYER, WALLET, "execute-pending-sbtc-transfer-now",
    [uintCV(2), noneCV(), sigAuthTuple(9, key.pubKeyHex, sigNowSbtc), noneCV()], okre);
  evalc("S3 recipient sBTC after the 2FA fast-path",
    `(contract-call? '${SBTC_TOKEN} get-balance '${RECIPIENT})`, "sR2", WALLET);

  call(`S4 send ${WD_SBTC_OVER} sats again (OVER threshold -> pending op 3)`,
    OWNER, WALLET, "sip010-transfer",
    [uintCV(WD_SBTC_OVER), standardPrincipalCV(RECIPIENT), noneCV(),
     contractPrincipalCV("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token"),
     stringAsciiCV("sbtc-token"), noneCV(), noneCV()], okre);
  b.addAdvanceBlocks({ bitcoin_blocks: 150, stacks_blocks_per_bitcoin: 1 });
  plan.push({ kind: "advance", label: "advance 150 (past the u144 cooldown)" });
  call("S5 plain execute by OWNER AFTER cooldown -> ok", OWNER, WALLET,
    "execute-pending-sbtc-transfer", [uintCV(3), noneCV()], okre);
  evalc("S5 recipient sBTC after the cooldown path",
    `(contract-call? '${SBTC_TOKEN} get-balance '${RECIPIENT})`, "sR3", WALLET);

  evalc("W3 recipient sBTC before",
    `(contract-call? '${SBTC_TOKEN} get-balance '${RECIPIENT})`, "rSb0", WALLET);
  call(`W3 withdraw ${WD_SBTC} sats sBTC (UNDER threshold -> immediate)`,
    OWNER, WALLET, "sip010-transfer",
    [uintCV(WD_SBTC), standardPrincipalCV(RECIPIENT), noneCV(),
     contractPrincipalCV("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token"),
     stringAsciiCV("sbtc-token"), noneCV(), noneCV()], okre);
  evalc("W3 recipient sBTC after",
    `(contract-call? '${SBTC_TOKEN} get-balance '${RECIPIENT})`, "rSb1", WALLET);

  // -- run + verify ------------------------------------------------------------
  console.log("=== juice-safe-v1 (DEPLOYED) + juice-safe-auth-helpers-v1 - stxer harness ===\n");
  const sessionId = await b.run();
  const url = `https://stxer.xyz/simulations/mainnet/${sessionId}`;
  console.log(`Submitted: ${url}\n`);
  const res = await getSimulationResult(sessionId);

  const decTx = (s) => {
    const r = s?.Result?.Transaction;
    if (!r) return "<none>";
    if ("Err" in r) return `ENGINE-ERR: ${JSON.stringify(r.Err).slice(0, 220)}`;
    try { return cvToString(deserializeCV(r.Ok.result)); }
    catch (e) { return `dec-fail: ${e.message}`; }
  };
  const decEval = (s) => {
    const r = s?.Result?.Eval;
    if (!r || !("Ok" in r)) return `<eval:${JSON.stringify(r?.Err ?? "?").slice(0, 160)}>`;
    try { return cvToString(deserializeCV(r.Ok)); } catch { return r.Ok; }
  };
  const lockedFrom = (s) => BigInt((String(s).match(/\(locked u(\d+)\)/) || [])[1] ?? "-1");

  let pass = 0, fail = 0;
  const cap = {};
  res.steps.forEach((s, i) => {
    const p = plan[i];
    if (!p) return;
    if (p.kind === "fund" || p.kind === "advance") {
      const ok = !("Err" in (s?.Result?.Transaction || {}));
      console.log(`${ok ? "OK  " : "FAIL"} [${i}] ${p.label}`);
      if (!ok) { fail++; console.log(`        ${decTx(s)}`); }
      return;
    }
    if (p.kind === "eval") {
      const v = decEval(s);
      if (p.capture) cap[p.capture] = v;
      console.log(`INFO [${i}] ${p.label}: ${String(v).slice(0, 190)}`);
      return;
    }
    const d = decTx(s);
    if (p.capture) cap[p.capture] = d;
    const ok = p.expect == null ? true
      : p.expect instanceof RegExp ? p.expect.test(d)
      : d === p.expect;
    console.log(`${ok ? "PASS" : "FAIL"} [${i}] ${p.label}\n        got ${d.slice(0, 190)}`);
    ok ? pass++ : fail++;
  });

  console.log("\n--- state checks ---");
  const chk = (l, cond) => { console.log(`${cond ? "PASS" : "FAIL"} ${l}`); cond ? pass++ : fail++; };
  chk("owner set at onboard", String(cap.owner0).includes(OWNER));
  chk("nothing locked before stake", lockedFrom(cap.acct0) === 0n);
  chk("stake locks IMMEDIATELY (stxer now runs the PoX lock handler)",
    lockedFrom(cap.acct1) === BigInt(STAKE_USTX));
  chk("staker-info present after stake", String(cap.info1).startsWith("(some"));
  chk("staker-info names the Juice signer",
    String(cap.info1).includes("juice-pool-stx-signer"));
  // stxer does not run the node PoX lock handler (no STXLockEvent is emitted),
  // so account locks never move here. Assert the KNOWN behaviour instead of a
  // mainnet expectation the simulator cannot produce.
  chk("lock persists across the cycle boundary", lockedFrom(cap.acctL) > 0n);
  chk("live top-up raised the account lock",
    lockedFrom(cap.acctL2) > lockedFrom(cap.acctL));
  chk("we hold shares in the Juice pool for cycle 141",
    /u[1-9]/.test(String(cap.shares)));
  chk("extend increased num-cycles", String(cap.infoE).includes("num-cycles"));
  const u = (x) => BigInt((String(x).match(/u(\d+)/) || [])[1] ?? "-1");
  chk(`gas station charged the safe exactly ${GAS_SATS} sats`,
    u(cap.gsb0) - u(cap.gsb1) === GAS_SATS);
  chk("pox-5 saw the reward drop", u(cap.newrew) > 0n);
  chk("Juice pot funded for the cycle", u(cap.pot) > 0n);
  chk("JUICE PAID THE SAFE (sBTC balance rose)", u(cap.sb1) > u(cap.sb0));
  chk("paying the SAME tranche twice pays nothing", u(cap.sbDouble) === u(cap.sb1));
  let paidCount = 0;
  console.log("\n   --- real stakers paid in the same fold ---");
  REAL_STAKERS.forEach((p, i) => {
    const before = u(cap[`rs${i}a`]), after = u(cap[`rs${i}b`]);
    const delta = after - before;
    if (delta > 0n) paidCount++;
    console.log(`   ${p}  +${delta} sats`);
  });
  chk(`all ${REAL_STAKERS.length} real stakers were paid in the same call`,
    paidCount === REAL_STAKERS.length);
  const amtOf = (x) => BigInt((String(x).match(/amount-ustx u(\d+)/) || [])[1] ?? "-1");
  chk("LOCK LIFECYCLE 1/4 - pox-5 records the stake as locked",
    amtOf(cap.info1) === BigInt(STAKE_USTX));
  chk("LOCK LIFECYCLE 2/4 - top-ups raise the locked amount",
    amtOf(cap.infoE) > amtOf(cap.info1));
  chk("LOCK LIFECYCLE 3/4 - unstake truncates but STILL locked",
    /num-cycles u[01]\)/.test(String(cap.uInfo)) && amtOf(cap.uInfo) > 0n);
  chk("LOCK LIFECYCLE 3b - STX returned after the unlock height",
    lockedFrom(cap.uAcct2) === 0n);
  chk("LOCK LIFECYCLE 4/4 - past the unlock cycle the position is RELEASED",
    String(cap.uInfo2).trim() === "none");
  console.log("\n   --- locked amount, per pox-5 (the authoritative record) ---");
  console.log(`   after stake        ${amtOf(cap.info1)} uSTX`);
  console.log(`   after top-ups      ${amtOf(cap.infoE)} uSTX`);
  console.log(`   after unstake      ${amtOf(cap.uInfo)} uSTX  (num-cycles truncated)`);
  console.log(`   shares next cycle  ${cap.sharesNext}`);
  console.log(`   after unlock cycle ${cap.uInfo2}  <- released`);
  chk("STX withdrawal UNDER threshold moved funds",
    u(cap.rStx1) - u(cap.rStx0) === BigInt(WD_STX_UNDER));
  chk("STX withdrawal OVER threshold moved NOTHING (pending op)",
    u(cap.rStx2) === u(cap.rStx1));
  chk("2FA fast-path released the over-threshold op immediately",
    u(cap.rStx3) - u(cap.rStx2) === BigInt(WD_STX_OVER));
  chk("cooldown path released the second op after 144 blocks",
    u(cap.rStx4) - u(cap.rStx3) === BigInt(WD_STX_OVER));
  chk("sBTC OVER threshold moved NOTHING (pending op)", u(cap.sR1) === u(cap.sR0));
  chk("sBTC 2FA fast-path released it immediately",
    u(cap.sR2) - u(cap.sR1) === BigInt(WD_SBTC_OVER));
  chk("sBTC cooldown path released the second op",
    u(cap.sR3) - u(cap.sR2) === BigInt(WD_SBTC_OVER));
  chk("sBTC withdrawal moved funds",
    u(cap.rSb1) - u(cap.rSb0) === BigInt(WD_SBTC));
  console.log(`   after unstake : ${cap.uAcct}`);
  console.log(`   after unlock  : ${cap.uAcct2}`);
  console.log(`   staker-info   : ${cap.uInfo2}`);

  console.log(`\n=== ${pass} passed, ${fail} failed ===\nView: ${url}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
