// simul-juice-safe-v0.js
// Stxer mainnet-fork simulation for juice-safe-v0 + juice-safe-auth-helpers-v1,
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
//   D1 unstake by a random principal                  -> u4001
//   D2 unstake (PASSKEY)                              -> ok      [helper #3]
//                                                     -> EMPTY allowance list
//
// ORDERING NOTE. pox-5 leaves staker-info in place after `unstake` (it only
// shortens num-cycles), so a second `stake` would hit ERR_ALREADY_STAKED. Every
// stake/update step therefore runs BEFORE the unstake, and unstake is last.
//
// Run: node simul-juice-safe-v0.js
import crypto from "node:crypto";
import {
  tupleCV,
  uintCV,
  bufferCV,
  noneCV,
  someCV,
  principalCV,
  standardPrincipalCV,
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
const RELAYER = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM";
const STX_WHALE = "SP9BP4PN74CNR5XT7CMAMBPA0GWC9HMB69HVVV51";

// -- contracts ---------------------------------------------------------------
const WALLET_NAME = "juice-safe-v0";
const HELPER_NAME = "juice-safe-auth-helpers-v1";
const WALLET = `${DEPLOYER}.${WALLET_NAME}`;
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core`;
const POX5 = "SP000000000000000000002Q6VF78.pox-5";

const STACKS_NODE_API = "http://77.42.3.101/stacks-api";
const RP_ID = "juiceofbtc.com"; // RP-ID-HASH-JUICEOFBTC-COM is whitelisted

// -- amounts -----------------------------------------------------------------
// The safe is funded with 1,500 STX and stakes 1,000 then tops up 200. pox-5
// requires the locked amount to be covered by the account's balance, and leaves
// enough unlocked for fees.
const FUND_USTX = 1_500_000_000;
const STAKE_USTX = 1_000_000_000;
const TOPUP_USTX = 200_000_000;
const EXTEND_CYCLES = 2;
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
  call("set-verified-contract(juice-safe-v0)", DEPLOYER, WALLET_CORE,
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
  call("C2 update with amount u0 AND cycles u0 -> u4026", OWNER, WALLET,
    "update-stake-stx-juice", [uintCV(0), uintCV(0), noneCV(), noneCV()], "(err u4026)");
  call("C3 update PURE EXTEND amount u0 (PASSKEY) -> ok", RELAYER, WALLET,
    "update-stake-stx-juice",
    [uintCV(0), uintCV(EXTEND_CYCLES),
     someCV(sigAuthTuple(2, key.pubKeyHex, sigExtend)), noneCV()],
    okre);
  evalc("pox-5 staker-info AFTER extend", `(contract-call? '${POX5} get-staker-info '${WALLET})`,
    "info2", WALLET);

  // -- D: unstake (the empty-allowance question) -------------------------------
  call("D1 unstake by random -> u4001", RANDOM, WALLET,
    "unstake", [noneCV(), noneCV()], "(err u4001)");
  call("D2 unstake (PASSKEY) -> ok  [EMPTY allowance list]", RELAYER, WALLET,
    "unstake",
    [someCV(sigAuthTuple(3, key.pubKeyHex, sigUnstake)), noneCV()],
    okre);
  evalc("pox-5 staker-info AFTER unstake", `(contract-call? '${POX5} get-staker-info '${WALLET})`,
    "info3", WALLET);
  evalc("safe stx-account AFTER unstake", `(stx-account '${WALLET})`, "acct3");

  // -- run + verify ------------------------------------------------------------
  console.log("=== juice-safe-v0 (DEPLOYED) + juice-safe-auth-helpers-v1 - stxer harness ===\n");
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
  const lockedFrom = (s) => BigInt((String(s).match(/locked:\s*u(\d+)/) || [])[1] ?? "-1");

  let pass = 0, fail = 0;
  const cap = {};
  res.steps.forEach((s, i) => {
    const p = plan[i];
    if (!p) return;
    if (p.kind === "fund") {
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
  chk("stake locked exactly STAKE_USTX", lockedFrom(cap.acct1) === BigInt(STAKE_USTX));
  chk("top-up raised the lock by TOPUP_USTX",
    lockedFrom(cap.acct2) === BigInt(STAKE_USTX) + BigInt(TOPUP_USTX));
  chk("staker-info present after stake", String(cap.info1).startsWith("(some"));
  chk("staker-info names the Juice signer",
    String(cap.info1).includes("juice-pool-stx-signer"));
  chk("pure extend did not change the locked amount",
    lockedFrom(cap.acct2) === lockedFrom(cap.acct3));

  console.log(`\n=== ${pass} passed, ${fail} failed ===\nView: ${url}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
