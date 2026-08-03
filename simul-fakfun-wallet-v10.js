// simul-fakfun-wallet-v10.js
// Stxer mainnet-fork harness for SPV9K21....fakfun-wallet-v9 (DEPLOYED).
//
// SCOPE: exactly what changed from v8. The public-surface diff is:
//   REMOVED (all pox-4, all dead since cycle 140):
//     stack-stx-fast-pool, stack-stx-juice, revoke-stacking
//   ADDED (pox-5):
//     stake-stx-juice, update-stake-stx-juice, unstake, locked-ustx
//   plus: JUICE-SIGNER is now the signer CONTRACT (was the operator EOA),
//         POX5 / NUM-CYCLES constants, err-zero-amount, and the three
//         challenges moved to juice-safe-auth-helpers-v1.
// Everything else in v9 is v8 byte-for-byte and is NOT retested here.
//
// PART A -- the deployed contract, as it actually is.
//   v9's onboard calls register-wallet against '.fakfun-wallet-v8'. On mainnet
//   v8 IS verified (hash 0xe0c7d14e...), so fakfun-wallet-core's first assert
//   passes and the SECOND one compares v9's own hash to v8's and fails.
//   Expect onboard -> (err u6002) err-invalid-contract-hash. If that is what
//   comes back, the deployed v9 cannot be initialised at all and needs a v10.
//
// PART B -- a corrected copy (register-wallet -> itself), so the pox-5 surface
//   still gets exercised end to end despite Part A:
//     init: onboard -> propose-admin-with-signature -> accept-admin-proposal
//           -> advance 432 (pubkey cooldown) -> confirm-admin-with-signature
//     then: stake -> top-up -> advance past the cycle boundary -> extend
//           -> rewards -> unstake
//
// NOTE ON LOCKS: stxer does not run the node-side PoX lock handler, so
// stx-account stays locked u0 throughout and (with-stacking ...) is never
// enforced here -- proven in simul-allowance-probe.js and again by advancing a
// full cycle in simul-juice-safe-v0-lifecycle.js. pox-5 CONTRACT state is
// authoritative in this harness; account locks are not.
//
// Run: node simul-fakfun-wallet-v9.js
import crypto from "node:crypto";
import {
  tupleCV, uintCV, bufferCV, noneCV, someCV, principalCV,
  standardPrincipalCV, contractPrincipalCV, stringAsciiCV, serializeCV, deserializeCV,
  cvToString, ClarityVersion, PostConditionMode,
} from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";
import { generateP256Keypair, signChallengeWithRpId } from "./lib-webauthn-test-signer.mjs";

const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const OWNER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";
const RANDOM = "SP1MGH8BH1KRY49Z7EE5TY0JVKT6C3NT9RTVM8FND";
const RELAYER = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM";
const STX_WHALE = "SP9BP4PN74CNR5XT7CMAMBPA0GWC9HMB69HVVV51";
const SBTC_WHALE = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";  // == OWNER, holds sBTC
const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const GAS_STATION = `${DEPLOYER}.gas-station`;  // pay-gas: 20 sats -> sponsor

const V9 = `${DEPLOYER}.fakfun-wallet-v9`;      // deployed, buggy register-wallet
const FIXED_NAME = "fakfun-wallet-v10";
const FIXED = `${DEPLOYER}.${FIXED_NAME}`;      // the real v10, deployed in-sim
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core`;
const POX5 = "SP000000000000000000002Q6VF78.pox-5";
const STACKS_NODE_API = "http://77.42.3.101/stacks-api";
const RP_ID = "fak.fun";                         // v9 whitelists fak.fun / fakfun.com only

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

  // ---- PART A: the DEPLOYED v9, as-is -------------------------------------
  call("A1 set-verified-contract(fakfun-wallet-v9)", DEPLOYER, WALLET_CORE,
    "set-verified-contract", [principalCV(V9), noneCV()], okre);
  call("A2 onboard on DEPLOYED v9 -> expect u6002 (registers against v8)",
    FAKFUN_DEPLOYER, V9, "onboard", [pubkeyCV], "(err u6002)");

  // ---- PART B: corrected copy, full lifecycle ------------------------------
  // fakfun-wallet-v10 is DEPLOYED on mainnet -- run against the real bytes.
  call("B1 set-verified-contract(fakfun-wallet-v10)", DEPLOYER, WALLET_CORE,
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
  call("G1 top-up via PASSKEY + GAS STATION (wallet pays 20 sats) -> ok",
    RELAYER, FIXED, "update-stake-stx-juice",
    [uintCV(GAS_TOPUP_USTX), uintCV(0),
     someCV(sigAuth(6, key.pubKeyHex, sGasTopup)),
     someCV(contractPrincipalCV(DEPLOYER, "gas-station"))], okre);
  evalc("sBTC balance AFTER gas-paid call",
    `(contract-call? '${SBTC_TOKEN} get-balance '${FIXED})`, "sb1", FIXED);
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
  call("C6 unstake by random -> u4001", RANDOM, FIXED, "unstake", [noneCV(), noneCV()], "(err u4001)");
  call("C7 unstake (PASSKEY) -> ok", RELAYER, FIXED,
    "unstake", [someCV(sigAuth(5, key.pubKeyHex, sUnstake)), noneCV()], okre);
  evalc("staker-info after unstake", `(contract-call? '${POX5} get-staker-info '${FIXED})`, "i4", FIXED);
  evalc("locked after unstake", `(stx-account '${FIXED})`, "lk2", FIXED);
  b.addAdvanceBlocks({ bitcoin_blocks: 2600, stacks_blocks_per_bitcoin: 1 });
  plan.push({ kind: "advance", label: "advance 2600 (past the unlock height)" });
  evalc("locked AFTER unlock (expect u0, STX returned)", `(stx-account '${FIXED})`, "lk3", FIXED);
  evalc("staker-info after unlock (expect none)",
    `(contract-call? '${POX5} get-staker-info '${FIXED})`, "si2", FIXED);

  console.log("=== fakfun-wallet-v10 - stxer harness (v8 -> v10 delta) ===\n");
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
  const lkv = (x) => BigInt((String(x).match(/\(locked u(\d+)\)/) || [])[1] ?? "-1");
  chk("STX RETURNED: locked back to u0 after the unlock height", lkv(cap.lk3) === 0n);
  chk("position gone from pox-5", String(cap.si2).trim() === "none");
  console.log(`   locked before unstake ${cap.lk1}`);
  console.log(`   locked after unlock   ${cap.lk3}`);
  chk("gas-paid top-up also moved the stake",
    amt(cap.iG) === BigInt(STAKE_USTX) + BigInt(TOPUP_USTX) + BigInt(GAS_TOPUP_USTX));

  console.log(`\n=== ${pass} passed, ${fail} failed ===\nView: ${url}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
