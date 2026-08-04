// simul-v14-full.js
// Stxer mainnet-fork harness for the DEPLOYED SPV9K21....fakfun-wallet-v14.
//
// SCOPE: what changed from v8. Public-surface diff:
//   REMOVED (all pox-4, dead since cycle 140):
//     stack-stx-fast-pool, stack-stx-juice, revoke-stacking
//   ADDED (pox-5):
//     stake-stx-juice, update-stake-stx-juice, unstake, locked-ustx
//   plus: JUICE-SIGNER is the signer CONTRACT (was the operator EOA), the
//         POX5 / NUM-CYCLES constants, err-zero-amount, and the three
//         challenges served from juice-safe-auth-helpers-v1.
// Everything else is v8 byte-for-byte and is NOT retested here.
//
// Flow: onboard -> propose-admin-with-signature -> accept-admin-proposal
//       -> advance 432 (pubkey cooldown) -> confirm-admin-with-signature
//       -> stake -> top-up -> gas-paid top-up -> extend -> reward payout
//       -> unstake -> advance past the unlock -> withdrawals + threshold guard
//
// NOTE: v10 has NO execute-pending-*-now. The passkey 2FA release is a
// jing-mm-safe lineage feature juice-safe-v1 inherited; the fakfun-wallet line
// never had it. Every over-threshold op here serves the full u144 cooldown.
//
// Run: node simul-v14-full.js
import crypto from "node:crypto";
import {
  tupleCV, uintCV, bufferCV, noneCV, someCV, principalCV,
  standardPrincipalCV, contractPrincipalCV, listCV, stringAsciiCV, serializeCV, deserializeCV,
  cvToString, ClarityVersion, PostConditionMode,
} from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";
import { generateP256Keypair, signChallengeWithRpId } from "./lib-webauthn-test-signer.mjs";

const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const OWNER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";
const RANDOM = "SP1MGH8BH1KRY49Z7EE5TY0JVKT6C3NT9RTVM8FND";
const RECIPIENT = "SP22WH53NS94VR6N145ZX77BK4S0EWFBE41VW3Z6B";
const WD_STX_UNDER = 50_000_000;     // under the u100000000 default threshold
const WD_STX_OVER = 400_000_000;     // OVER -> pending op
const WD_SBTC_UNDER = 1_000;         // under the u100000 default threshold
const WD_SBTC_OVER = 150_000;        // OVER -> pending op
const SBTC_BIG_FUND = 500_000;
const REWARD_SATS = 2_000_000;   // sBTC dropped on pox-5 = the cycle's rewards
const RC = 141;
// REAL Juice stakers with live cycle-141 shares, paid in the SAME fold as the
// v10 wallet -- exercises pay-stx-stakers across a real mixed list (contract
// principal + standard principals) rather than a single synthetic entry.
const REAL_STAKERS = [
  "SP3TA7SMY7APYR9SFKDT0527NC0GWR84S3AHEM0NE",
  "SP3A4CP63QJB1R0EJR3TJ1PN16FC5HVJSPT77C8C0",
  "SP3TS3T9GSGFEDW7ZBJNFXMH6RY0AP7HNCQEE77DH",
  "SP3WAAYXPC6WZNEC7SHGR36D32RJPZVXRR1BG0QSY",
  "SP1JAG6TV2XRYFGJN7CAAN6Z3CEW2YMZWMHJAJV91",
  "SP389APB4DHZ836P4AE9RJW7EKEZAPV5NPDNG7N46",
  "SP18QG8A8943KY9S15M08AMAWWF58W9X1M90BRCSJ",
  "SP218F71JZ4R2ERQDKEBGA1FKVAQNZBM3HK7W8EA7",
];
const RELAYER = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM";
const STX_WHALE = "SP9BP4PN74CNR5XT7CMAMBPA0GWC9HMB69HVVV51";
const SBTC_WHALE = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";  // == OWNER, holds sBTC
const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const GAS_STATION = `${DEPLOYER}.gas-station`;  // pay-gas: 20 sats -> sponsor

const FIXED_NAME = "fakfun-wallet-v14";
const FIXED = `${DEPLOYER}.${FIXED_NAME}`;      // the real v10, deployed in-sim
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core`;
const POX5 = "SP000000000000000000002Q6VF78.pox-5";
const STACKS_NODE_API = "http://77.42.3.101/stacks-api";
const RP_ID = "fak.fun";   // v10 whitelists fak.fun / fakfun.com only

const FUND_USTX = 2_800_000_000;   // locks are real now
const STAKE_USTX = 800_000_000;
const TOPUP_USTX = 200_000_000;
const GAS_TOPUP_USTX = 50_000_000;
const SBTC_FUND = 5_000;   // sats; gas is 20/call, max-gas-amount caps at 1000
const GAS_SATS = 20n;
const COOLDOWN_BLOCKS = 440;   // pubkey-cooldown-period is u432
const CYCLE_BLOCKS = 1000;     // + the 440 above clears the ~1346 to cycle 141

const SIP018_PREFIX = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const cvSha256 = (cv) => {
  const o = serializeCV(cv);
  return typeof o === "string" ? sha256(Buffer.from(o, "hex")) : sha256(Buffer.from(o));
};
const domainHash = (wallet) => cvSha256(tupleCV({
  name: stringAsciiCV("smart-wallet-standard"),
  version: stringAsciiCV("1.0.0"),
  "chain-id": uintCV(1),
  wallet: principalCV(wallet),
}));
const challenge = (wallet, topicTuple) =>
  sha256(Buffer.concat([SIP018_PREFIX, domainHash(wallet), cvSha256(topicTuple)]));

const tAddAdmin = (id, a) => tupleCV({ topic: stringAsciiCV("add-admin"), "auth-id": uintCV(id), "new-admin": standardPrincipalCV(a) });
const tConfirmAdmin = (id, a) => tupleCV({ topic: stringAsciiCV("confirm-admin"), "auth-id": uintCV(id), "new-admin": standardPrincipalCV(a) });
const tStake = (id, amt) => tupleCV({ topic: stringAsciiCV("stake-stx-juice-pox5"), "auth-id": uintCV(id), "amount-ustx": uintCV(amt) });
const tUpdate = (id, inc, cyc) => tupleCV({ topic: stringAsciiCV("update-stake-stx-juice"), "auth-id": uintCV(id), "amount-increase": uintCV(inc), "cycles-to-extend": uintCV(cyc) });
const tUnstake = (id) => tupleCV({ topic: stringAsciiCV("unstake-stx-juice"), "auth-id": uintCV(id) });

const strip = (h) => (h.startsWith("0x") ? h.slice(2) : h);
const sigAuth = (id, pk, s) => tupleCV({
  "auth-id": uintCV(id),
  pubkey: bufferCV(Buffer.from(strip(pk), "hex")),
  signature: bufferCV(Buffer.from(strip(s.signatureHex), "hex")),
  "authenticator-data": bufferCV(Buffer.from(strip(s.authenticatorDataHex), "hex")),
  "client-data-prefix": bufferCV(Buffer.from(strip(s.clientDataPrefixHex), "hex")),
  "client-data-suffix": bufferCV(Buffer.from(strip(s.clientDataSuffixHex), "hex")),
});

async function main() {
  // Corrected copy: identical to the deployed bytes except register-wallet
  // names ITSELF instead of v8.


  const key = generateP256Keypair();
  const sign = (c, rp = RP_ID) => signChallengeWithRpId(c, key.privKey, rp);
  const pubkeyCV = bufferCV(Buffer.from(strip(key.pubKeyHex), "hex"));

  const sPropose = sign(challenge(FIXED, tAddAdmin(1, OWNER)));
  const sConfirm = sign(challenge(FIXED, tConfirmAdmin(2, OWNER)));
  const sStake = sign(challenge(FIXED, tStake(3, STAKE_USTX)));
  const sExtend = sign(challenge(FIXED, tUpdate(4, 0, 1)));
  const sUnstake = sign(challenge(FIXED, tUnstake(5)));
  const sGasTopup = sign(challenge(FIXED, tUpdate(6, GAS_TOPUP_USTX, 0)));

  const plan = [];
  const b = SimulationBuilder.new({ stacksNodeAPI: STACKS_NODE_API });
  const call = (label, sender, cid, fn, args, expect) => {
    b.withSender(sender).addContractCall({
      contract_id: cid, function_name: fn, function_args: args,
      post_condition_mode: PostConditionMode.Allow,
    });
    plan.push({ kind: "tx", label, expect });
  };
  const evalc = (label, code, capture, at) => {
    b.addEvalCode(at, code);
    plan.push({ kind: "eval", label, capture });
  };
  const okre = /^\(ok/;

  // fakfun-wallet-v14 is DEPLOYED on mainnet -- run against the real bytes.
  call("set-verified-contract(fakfun-wallet-v14)", DEPLOYER, WALLET_CORE,
    "set-verified-contract", [principalCV(FIXED), noneCV()], okre);
  call("B2 onboard(pubkey) -> ok  [the fix]", FAKFUN_DEPLOYER, FIXED,
    "onboard", [pubkeyCV], okre);
  call("B3 propose-admin-with-signature(OWNER) (PASSKEY)", RELAYER, FIXED,
    "propose-admin-with-signature",
    [standardPrincipalCV(OWNER), sigAuth(1, key.pubKeyHex, sPropose), noneCV()], okre);
  call("B4 accept-admin-proposal (from OWNER)", OWNER, FIXED,
    "accept-admin-proposal", [], okre);
  b.addAdvanceBlocks({ bitcoin_blocks: COOLDOWN_BLOCKS, stacks_blocks_per_bitcoin: 1 });
  plan.push({ kind: "advance", label: `advance ${COOLDOWN_BLOCKS} (pubkey cooldown u432)` });
  call("B5 confirm-admin-with-signature (PASSKEY) -> admin seated", RELAYER, FIXED,
    "confirm-admin-with-signature", [sigAuth(2, key.pubKeyHex, sConfirm), noneCV()], okre);
  evalc("owner == OWNER", "(get-owner)", "owner", FIXED);

  b.withSender(STX_WHALE).addSTXTransfer({ recipient: FIXED, amount: FUND_USTX });
  plan.push({ kind: "fund", label: `fund ${FUND_USTX / 1e6} STX` });
  call(`fund ${SBTC_FUND} sats sBTC (for gas)`, SBTC_WHALE, SBTC_TOKEN, "transfer",
    [uintCV(SBTC_FUND), standardPrincipalCV(SBTC_WHALE), principalCV(FIXED), noneCV()], okre);

  // ---- the pox-5 surface (the whole point) ---------------------------------
  call("C1 stake by random -> u4001", RANDOM, FIXED,
    "stake-stx-juice", [uintCV(STAKE_USTX), noneCV(), noneCV()], "(err u4001)");
  call("C2 stake amount u0 (admin) -> u4030", OWNER, FIXED,
    "stake-stx-juice", [uintCV(0), noneCV(), noneCV()], "(err u4030)");
  call("C3 stake (PASSKEY rp=fak.fun) -> ok", RELAYER, FIXED,
    "stake-stx-juice", [uintCV(STAKE_USTX), someCV(sigAuth(3, key.pubKeyHex, sStake)), noneCV()], okre);
  evalc("staker-info after stake", `(contract-call? '${POX5} get-staker-info '${FIXED})`, "i1", FIXED);
  call("C4 top-up (admin) -> ok", OWNER, FIXED,
    "update-stake-stx-juice", [uintCV(TOPUP_USTX), uintCV(0), noneCV(), noneCV()], okre);
  evalc("staker-info after top-up", `(contract-call? '${POX5} get-staker-info '${FIXED})`, "i2", FIXED);

  // ---- GAS STATION: relayer broadcasts, wallet pays 20 sats sBTC -----------
  // The (gas (optional <gas-trait>)) branch is dead code in every other run.
  // Wallet allowance is (with-ft sbtc-token max-gas-amount) = u1000 default,
  // and gas-station.pay-gas moves get-gas() sats from contract-caller (= the
  // wallet, inside as-contract) to get-sponsor().
  evalc("sBTC balance BEFORE gas-paid call",
    `(contract-call? '${SBTC_TOKEN} get-balance '${FIXED})`, "sb0", FIXED);
  // TODAY'S CHANGE: the fee must land in `gas` and NOWHERE ELSE. Capture the
  // whole counter tuple either side so `sbtc` can be proved unchanged --
  // disjointness is the property, not just "gas went up".
  evalc("spent-this-period BEFORE gas-paid call (gas/sbtc)",
    `(var-get spent-this-period)`, "sp0", FIXED);
  call("G1 top-up via PASSKEY + GAS STATION (wallet pays 20 sats) -> ok",
    RELAYER, FIXED, "update-stake-stx-juice",
    [uintCV(GAS_TOPUP_USTX), uintCV(0),
     someCV(sigAuth(6, key.pubKeyHex, sGasTopup)),
     someCV(contractPrincipalCV(DEPLOYER, "gas-station"))], okre);
  evalc("sBTC balance AFTER gas-paid call",
    `(contract-call? '${SBTC_TOKEN} get-balance '${FIXED})`, "sb1", FIXED);
  evalc("spent-this-period AFTER gas-paid call (expect gas +fee, sbtc UNCHANGED)",
    `(var-get spent-this-period)`, "sp1", FIXED);
  evalc("max-gas-per-period ceiling (max-gas-amount * u25)",
    `(* (var-get max-gas-amount) u25)`, "ceil", FIXED);
  evalc("staker-info after gas-paid top-up",
    `(contract-call? '${POX5} get-staker-info '${FIXED})`, "iG", FIXED);

  b.addAdvanceBlocks({ bitcoin_blocks: CYCLE_BLOCKS, stacks_blocks_per_bitcoin: 1 });
  plan.push({ kind: "advance", label: `advance ${CYCLE_BLOCKS} (cross into cycle 141)` });

  call("C5 extend +1 cycle (PASSKEY) -> ok [only legal once cycles elapse]", RELAYER, FIXED,
    "update-stake-stx-juice",
    [uintCV(0), uintCV(1), someCV(sigAuth(4, key.pubKeyHex, sExtend)), noneCV()], okre);
  evalc("staker-info after extend", `(contract-call? '${POX5} get-staker-info '${FIXED})`, "i3", FIXED);
  evalc("locked before unstake", `(stx-account '${FIXED})`, "lk1", FIXED);
  // "is Juice going to pay us" -- the safe's shares in the pool for cycle 141,
  // the pool's total for that cycle, and the unclaimed reward accrual.
  evalc("our shares in cycle 141",
    `(contract-call? '${POX5} get-staker-shares-staked-for-cycle '${FIXED} u141 none '${DEPLOYER}.juice-pool-stx-signer)`, "shares", FIXED);
  evalc("pool TOTAL shares cycle 141",
    `(contract-call? '${POX5} get-total-shares-staked-for-cycle u141 none)`, "tot", FIXED);
  evalc("unclaimed rewards cycle 141",
    `(contract-call? '${POX5} get-staker-unclaimed-rewards-for-cycle '${DEPLOYER}.juice-pool-stx-signer u141 none '${FIXED})`, "rew", FIXED);
  // ---- DOES JUICE ACTUALLY PAY THIS WALLET? --------------------------------
  // pox-5 derives rewards from its own sBTC balance:
  //   get-rewards = sbtc-balance(pox-5) - total-sbtc-staked - reserve
  // so dropping sBTC on pox-5 and advancing past a distribution cycle (HALF a
  // reward cycle) is enough. calculate-rewards and pox-claim-rewards are both
  // PERMISSIONLESS -- called here from an unrelated relayer, not the admin.
  // pox-settle-stakers is deliberately NOT called: it is not on the payment
  // path (pay-one reads the local pot and shares, never pox-5's settle state).
  evalc("R wallet sBTC before any reward",
    `(contract-call? '${SBTC_TOKEN} get-balance '${FIXED})`, "rb0", FIXED);
  call(`R1 send ${REWARD_SATS} sats -> pox-5 (the cycle's rewards)`,
    SBTC_WHALE, SBTC_TOKEN, "transfer",
    [uintCV(REWARD_SATS), standardPrincipalCV(SBTC_WHALE),
     principalCV("SP000000000000000000002Q6VF78.pox-5"), noneCV()], okre);
  b.addAdvanceBlocks({ bitcoin_blocks: 1100, stacks_blocks_per_bitcoin: 1 });
  plan.push({ kind: "advance", label: "R advance 1100 (clear a distribution cycle)" });
  call("R2 pox-5.calculate-rewards (permissionless)", RELAYER,
    "SP000000000000000000002Q6VF78.pox-5", "calculate-rewards", [listCV([])], okre);
  call("R3 signer.pox-claim-rewards -> fills the Juice pot", RELAYER,
    `${DEPLOYER}.juice-pool-stx-signer`, "pox-claim-rewards",
    [listCV([]), uintCV(RC)], okre);
  evalc("R3 Juice pot for tranche 0",
    `(contract-call? '${DEPLOYER}.juice-pool-stx-signer get-stx-pot u${RC} u0)`, "pot", FIXED);
  REAL_STAKERS.forEach((p, i) =>
    evalc(`  real staker ${i + 1} sBTC before`,
      `(contract-call? '${SBTC_TOKEN} get-balance '${p})`, `rs${i}a`, FIXED));
  call(`R4 pay-stx-stakers([v10 wallet + ${REAL_STAKERS.length} REAL stakers])`,
    RELAYER, `${DEPLOYER}.juice-pool-stx-signer`, "pay-stx-stakers",
    [listCV([principalCV(FIXED), ...REAL_STAKERS.map((p) => standardPrincipalCV(p))]),
     uintCV(RC), uintCV(0)], okre);
  REAL_STAKERS.forEach((p, i) =>
    evalc(`  real staker ${i + 1} sBTC after`,
      `(contract-call? '${SBTC_TOKEN} get-balance '${p})`, `rs${i}b`, FIXED));
  evalc("R4 wallet sBTC AFTER payout",
    `(contract-call? '${SBTC_TOKEN} get-balance '${FIXED})`, "rb1", FIXED);
  call("R5 pay the SAME tranche + SAME LIST again -> must pay nothing", RELAYER,
    `${DEPLOYER}.juice-pool-stx-signer`, "pay-stx-stakers",
    [listCV([principalCV(FIXED), ...REAL_STAKERS.map((p) => standardPrincipalCV(p))]),
     uintCV(RC), uintCV(0)], okre);
  evalc("R5 wallet sBTC after replay",
    `(contract-call? '${SBTC_TOKEN} get-balance '${FIXED})`, "rb2", FIXED);

  call("C6 unstake by random -> u4001", RANDOM, FIXED, "unstake", [noneCV(), noneCV()], "(err u4001)");
  // Two ways out, both must work: admin key directly, and passkey via relayer.
  // Re-stake in between so there is a live position for the second attempt.
  call("C7a unstake by the ADMIN KEY (no signature) -> ok", OWNER, FIXED,
    "unstake", [noneCV(), noneCV()], okre);
  evalc("staker-info after the ADMIN unstake",
    `(contract-call? '${POX5} get-staker-info '${FIXED})`, "iAdmin", FIXED);
  call("C7b re-stake so there is a position to exit again", OWNER, FIXED,
    "update-stake-stx-juice", [uintCV(50_000_000), uintCV(1), noneCV(), noneCV()], okre);
  call("C7c unstake (PASSKEY via relayer) -> ok", RELAYER, FIXED,
    "unstake", [someCV(sigAuth(5, key.pubKeyHex, sUnstake)), noneCV()], okre);
  evalc("staker-info after unstake", `(contract-call? '${POX5} get-staker-info '${FIXED})`, "i4", FIXED);
  evalc("locked after unstake", `(stx-account '${FIXED})`, "lk2", FIXED);
  b.addAdvanceBlocks({ bitcoin_blocks: 2600, stacks_blocks_per_bitcoin: 1 });
  plan.push({ kind: "advance", label: "advance 2600 (past the unlock height)" });
  evalc("locked AFTER unlock (expect u0, STX returned)", `(stx-account '${FIXED})`, "lk3", FIXED);
  evalc("staker-info after unlock (expect none)",
    `(contract-call? '${POX5} get-staker-info '${FIXED})`, "si2", FIXED);

  // ---- WITHDRAWALS + the threshold guard -----------------------------------
  // NOTE: v10 has NO execute-pending-*-now. The passkey 2FA fast-path is a
  // jing-mm-safe lineage feature that juice-safe-v1 inherited; the
  // fakfun-wallet line only has the cooldown path (plus veto). So every
  // over-threshold op here MUST serve the full u144 wait.
  evalc("W recipient STX before", `(stx-get-balance '${RECIPIENT})`, "rStx0", FIXED);
  call(`W1 withdraw ${WD_STX_UNDER / 1e6} STX (UNDER threshold -> immediate)`,
    OWNER, FIXED, "stx-transfer",
    [uintCV(WD_STX_UNDER), standardPrincipalCV(RECIPIENT), noneCV(), noneCV(), noneCV()], okre);
  evalc("W1 recipient STX after", `(stx-get-balance '${RECIPIENT})`, "rStx1", FIXED);

  call(`W2 withdraw ${WD_STX_OVER / 1e6} STX (OVER threshold -> pending op 0)`,
    OWNER, FIXED, "stx-transfer",
    [uintCV(WD_STX_OVER), standardPrincipalCV(RECIPIENT), noneCV(), noneCV(), noneCV()], okre);
  evalc("W2 recipient STX after (must be unchanged)",
    `(stx-get-balance '${RECIPIENT})`, "rStx2", FIXED);
  call("W3 plain execute BEFORE cooldown -> u4017", OWNER, FIXED,
    "execute-pending-stx-transfer", [uintCV(0), noneCV()], "(err u4017)");

  // sBTC over the threshold -> op 1
  call(`fund ${SBTC_BIG_FUND} sats sBTC`, SBTC_WHALE, SBTC_TOKEN, "transfer",
    [uintCV(SBTC_BIG_FUND), standardPrincipalCV(SBTC_WHALE), principalCV(FIXED), noneCV()], okre);
  evalc("S recipient sBTC before",
    `(contract-call? '${SBTC_TOKEN} get-balance '${RECIPIENT})`, "sR0", FIXED);
  call(`S1 send ${WD_SBTC_UNDER} sats (UNDER threshold -> immediate)`,
    OWNER, FIXED, "sip010-transfer",
    [uintCV(WD_SBTC_UNDER), standardPrincipalCV(RECIPIENT), noneCV(),
     contractPrincipalCV("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token"),
     stringAsciiCV("sbtc-token"), noneCV(), noneCV()], okre);
  evalc("S1 recipient sBTC after",
    `(contract-call? '${SBTC_TOKEN} get-balance '${RECIPIENT})`, "sR1", FIXED);
  call(`S2 send ${WD_SBTC_OVER} sats (OVER threshold -> pending op 1)`,
    OWNER, FIXED, "sip010-transfer",
    [uintCV(WD_SBTC_OVER), standardPrincipalCV(RECIPIENT), noneCV(),
     contractPrincipalCV("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token"),
     stringAsciiCV("sbtc-token"), noneCV(), noneCV()], okre);
  evalc("S2 recipient sBTC after (must be unchanged)",
    `(contract-call? '${SBTC_TOKEN} get-balance '${RECIPIENT})`, "sR2", FIXED);

  // serve the cooldown, then release BOTH by the owner
  b.addAdvanceBlocks({ bitcoin_blocks: 150, stacks_blocks_per_bitcoin: 1 });
  plan.push({ kind: "advance", label: "advance 150 (past the u144 cooldown)" });
  call("W4 execute STX op 0 by OWNER after cooldown -> ok", OWNER, FIXED,
    "execute-pending-stx-transfer", [uintCV(0), noneCV()], okre);
  evalc("W4 recipient STX after cooldown release",
    `(stx-get-balance '${RECIPIENT})`, "rStx3", FIXED);
  call("S3 execute sBTC op 1 by OWNER after cooldown -> ok", OWNER, FIXED,
    "execute-pending-sbtc-transfer", [uintCV(1), noneCV()], okre);
  evalc("S3 recipient sBTC after cooldown release",
    `(contract-call? '${SBTC_TOKEN} get-balance '${RECIPIENT})`, "sR3", FIXED);

  console.log("=== fakfun-wallet-v14 - full harness + gas-counter assertions ===\n");
  const id = await b.run();
  const url = `https://stxer.xyz/simulations/mainnet/${id}`;
  console.log(`Submitted: ${url}\n`);
  const res = await getSimulationResult(id);

  const decTx = (s) => {
    const r = s?.Result?.Transaction;
    if (!r) return "<none>";
    if ("Err" in r) return `ENGINE-ERR: ${JSON.stringify(r.Err).slice(0, 180)}`;
    try { return cvToString(deserializeCV(r.Ok.result)); } catch (e) { return `dec-fail: ${e.message}`; }
  };
  const decEval = (s) => {
    const r = s?.Result?.Eval;
    if (!r || !("Ok" in r)) return `<eval:${JSON.stringify(r?.Err ?? "?").slice(0, 110)}>`;
    try { return cvToString(deserializeCV(r.Ok)); } catch { return r.Ok; }
  };

  let pass = 0, fail = 0; const cap = {};
  res.steps.forEach((s, i) => {
    const p = plan[i]; if (!p) return;
    if (p.kind === "fund" || p.kind === "advance" || p.kind === "deploy") {
      const ok = !("Err" in (s?.Result?.Transaction || {}));
      console.log(`${ok ? "OK  " : "FAIL"} [${i}] ${p.label}`);
      if (!ok) { fail++; console.log(`        ${decTx(s)}`); }
      return;
    }
    if (p.kind === "eval") {
      const v = decEval(s); if (p.capture) cap[p.capture] = v;
      console.log(`INFO [${i}] ${p.label}: ${String(v).slice(0, 175)}`); return;
    }
    const d = decTx(s);
    const ok = p.expect instanceof RegExp ? p.expect.test(d) : d === p.expect;
    console.log(`${ok ? "PASS" : "FAIL"} [${i}] ${p.label}\n        got ${d.slice(0, 175)}`);
    ok ? pass++ : fail++;
  });

  console.log("\n--- state checks ---");
  const chk = (l, c) => { console.log(`${c ? "PASS" : "FAIL"} ${l}`); c ? pass++ : fail++; };
  const amt = (s) => BigInt((String(s).match(/amount-ustx u(\d+)/) || [])[1] ?? "-1");
  const cyc = (s) => BigInt((String(s).match(/num-cycles u(\d+)/) || [])[1] ?? "-1");
  chk("owner seated after 3-step init", String(cap.owner).includes(OWNER));
  chk("stake recorded STAKE_USTX", amt(cap.i1) === BigInt(STAKE_USTX));
  chk("staker-info names juice-pool-stx-signer", String(cap.i1).includes("juice-pool-stx-signer"));
  chk("top-up = stake + topup", amt(cap.i2) === BigInt(STAKE_USTX) + BigInt(TOPUP_USTX));
  chk("extend raised num-cycles", cyc(cap.i3) > cyc(cap.i2));
  chk("unstake truncated to the current cycle only (u1 => cycle 141 still paid)",
    cyc(cap.i4) === 1n);
  chk("we hold shares in the Juice pool for cycle 141", /u[1-9]/.test(String(cap.shares)));
  const sats = (x) => BigInt((String(x).match(/u(\d+)/) || [])[1] ?? "-1");
  chk(`gas station charged the wallet exactly ${GAS_SATS} sats`,
    sats(cap.sb0) - sats(cap.sb1) === GAS_SATS);

  // ---- TODAY'S CHANGE: fee metering + counter disjointness ----------------
  const fld = (t, k) => BigInt((String(t).match(new RegExp(`\\(${k} u(\\d+)\\)`)) || [])[1] ?? "-1");
  const gas0 = fld(cap.sp0, "gas"),  gas1 = fld(cap.sp1, "gas");
  const sb_0 = fld(cap.sp0, "sbtc"), sb_1 = fld(cap.sp1, "sbtc");
  chk(`gas counter rose by exactly the fee (${GAS_SATS} sats)`, gas1 - gas0 === GAS_SATS);
  chk("DISJOINT: sbtc counter UNCHANGED by the gas fee", sb_1 === sb_0);
  chk("fee measured as balance delta == what the station actually took",
    gas1 - gas0 === sats(cap.sb0) - sats(cap.sb1));
  chk("gas fuse ceiling is max-gas-amount * u25 and the fee is well under it",
    sats(cap.ceil) > 0n && gas1 < sats(cap.ceil));
  console.log(`   spent-this-period before ${cap.sp0}`);
  console.log(`   spent-this-period after  ${cap.sp1}`);
  console.log(`   fuse ceiling             ${cap.ceil}`);
  const lkv = (x) => BigInt((String(x).match(/\(locked u(\d+)\)/) || [])[1] ?? "-1");
  chk("STX RETURNED: locked back to u0 after the unlock height", lkv(cap.lk3) === 0n);
  chk("position gone from pox-5", String(cap.si2).trim() === "none");
  console.log(`   locked before unstake ${cap.lk1}`);
  console.log(`   locked after unlock   ${cap.lk3}`);
  const uu = (x) => BigInt((String(x).match(/u(\d+)/) || [])[1] ?? "-1");
  chk("STX under threshold moved funds", uu(cap.rStx1) - uu(cap.rStx0) === BigInt(WD_STX_UNDER));
  chk("STX OVER threshold moved NOTHING", uu(cap.rStx2) === uu(cap.rStx1));
  chk("STX released by OWNER after the 144-block cooldown",
    uu(cap.rStx3) - uu(cap.rStx2) === BigInt(WD_STX_OVER));
  chk("sBTC under threshold moved funds", uu(cap.sR1) - uu(cap.sR0) === BigInt(WD_SBTC_UNDER));
  chk("sBTC OVER threshold moved NOTHING", uu(cap.sR2) === uu(cap.sR1));
  chk("sBTC released by OWNER after the 144-block cooldown",
    uu(cap.sR3) - uu(cap.sR2) === BigInt(WD_SBTC_OVER));
  chk("Juice pot funded for the cycle", uu(cap.pot) > 0n);
  chk("JUICE PAID THE V10 WALLET (sBTC rose)", uu(cap.rb1) > uu(cap.rb0));
  chk("paying the same tranche twice pays nothing", uu(cap.rb2) === uu(cap.rb1));
  let paid = 0;
  console.log("   --- real stakers paid in the same fold as v10 ---");
  REAL_STAKERS.forEach((p, i) => {
    const d = uu(cap[`rs${i}b`]) - uu(cap[`rs${i}a`]);
    if (d > 0n) paid++;
    console.log(`   ${p}  +${d} sats`);
  });
  chk(`all ${REAL_STAKERS.length} real stakers paid alongside v10`, paid === REAL_STAKERS.length);
  console.log(`   sBTC before reward ${cap.rb0} -> after payout ${cap.rb1} -> after replay ${cap.rb2}`);
  chk("gas-paid top-up also moved the stake",
    amt(cap.iG) === BigInt(STAKE_USTX) + BigInt(TOPUP_USTX) + BigInt(GAS_TOPUP_USTX));

  console.log(`\n=== ${pass} passed, ${fail} failed ===\nView: ${url}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
