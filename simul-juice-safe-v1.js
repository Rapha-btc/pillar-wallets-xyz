// simul-juice-safe-v1.js
// Stake -> top-up -> unstake -> unlock on the DEPLOYED SPV9K21....juice-safe-v1.
//
// The narrow proof that v1 fixes what v0 could not: v0's unstake returns
// (err u128) and has NO exit path. Here the full round trip completes and the
// STX comes back once the unlock height passes.
//
// Run: node simul-juice-safe-v1.js
import fs from "node:fs";
import crypto from "node:crypto";
import {
  tupleCV, uintCV, bufferCV, noneCV, someCV, principalCV,
  standardPrincipalCV, stringAsciiCV, serializeCV, deserializeCV,
  cvToString, PostConditionMode, ClarityVersion,
} from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";
import { generateP256Keypair, signChallengeWithRpId } from "./lib-webauthn-test-signer.mjs";

const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const OWNER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";
const RECOVERY = "SP3HXJJMJQ06GNAZ8XWDN1QM48JEDC6PP6W3YZPZJ";
const NEW_OWNER = "SP1MGH8BH1KRY49Z7EE5TY0JVKT6C3NT9RTVM8FND";
const RESCUED = "SP22WH53NS94VR6N145ZX77BK4S0EWFBE41VW3Z6B";
const RANDOM = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM";

const V1 = "juice-safe-v1";
const WALLET = `${DEPLOYER}.${V1}`;
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core`;
const STACKS_NODE_API = "http://77.42.3.101/stacks-api";
const RP_ID = "juiceofbtc.com";

const INACTIVITY_PERIOD = 52_560;
const ADVANCE = INACTIVITY_PERIOD + 100;   // clear it with margin
const STX_THRESHOLD = 100_000_000;
const SBTC_THRESHOLD = 100_000;

const SIP018_PREFIX = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const cvSha256 = (cv) => {
  const o = serializeCV(cv);
  return typeof o === "string" ? sha256(Buffer.from(o, "hex")) : sha256(Buffer.from(o));
};
const domainHash = () => cvSha256(tupleCV({
  name: stringAsciiCV("smart-wallet-standard"),
  version: stringAsciiCV("1.0.0"),
  "chain-id": uintCV(1),
  wallet: principalCV(WALLET),
}));
const challenge = (t) => sha256(Buffer.concat([SIP018_PREFIX, domainHash(), cvSha256(t)]));
const tConfirmTransfer = (id, a) => tupleCV({
  topic: stringAsciiCV("confirm-transfer"),
  "auth-id": uintCV(id),
  "new-admin": standardPrincipalCV(a),
});

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
  const key = generateP256Keypair();
  const sign = (c, rp = RP_ID) => signChallengeWithRpId(c, key.privKey, rp);
  const pubkeyCV = bufferCV(Buffer.from(strip(key.pubKeyHex), "hex"));
  const sigXfer = sign(challenge(tConfirmTransfer(1, NEW_OWNER)));
  const sigXferWrongRp = sign(challenge(tConfirmTransfer(2, NEW_OWNER)), "example.com");

  const plan = [];
  const b = SimulationBuilder.new({ stacksNodeAPI: STACKS_NODE_API });
  const call = (label, sender, cid, fn, args, expect) => {
    b.withSender(sender).addContractCall({
      contract_id: cid, function_name: fn, function_args: args,
      post_condition_mode: PostConditionMode.Allow,
    });
    plan.push({ kind: "tx", label, expect });
  };
  const evalc = (label, code, capture) => {
    b.addEvalCode(WALLET, code);
    plan.push({ kind: "eval", label, capture });
  };
  const okre = /^\(ok/;

  // deploy the PATCHED juice-safe-v0 (unstake allowance -> with-all-assets-unsafe)
  // juice-safe-v1 is DEPLOYED on mainnet -- run against the real bytes.
  call("set-verified-contract", DEPLOYER, WALLET_CORE, "set-verified-contract",
    [principalCV(WALLET), noneCV()], okre);
  call("onboard", FAKFUN_DEPLOYER, WALLET, "onboard",
    [pubkeyCV, standardPrincipalCV(OWNER), someCV(standardPrincipalCV(RECOVERY)),
     uintCV(STX_THRESHOLD), uintCV(SBTC_THRESHOLD)], okre);
  b.withSender("SP9BP4PN74CNR5XT7CMAMBPA0GWC9HMB69HVVV51")
    .addSTXTransfer({ recipient: WALLET, amount: 800_000_000 });
  plan.push({ kind: "advance", label: "fund 800 STX" });
  call("stake 500 STX (admin)", OWNER, WALLET, "stake-stx-juice",
    [uintCV(500_000_000), noneCV(), noneCV()], okre);
  evalc("locked after stake", `(stx-account '${WALLET})`, "l1");
  call("top-up 100 STX (exercises the verified (locked-ustx) allowance)", OWNER, WALLET,
    "update-stake-stx-juice", [uintCV(100_000_000), uintCV(0), noneCV(), noneCV()], okre);
  evalc("locked after top-up", `(stx-account '${WALLET})`, "l1b");
  call("UNSTAKE (was err u128 in v0) -> ok", OWNER, WALLET, "unstake",
    [noneCV(), noneCV()], okre);
  evalc("staker-info after unstake", `(contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-staker-info '${WALLET})`, "si");
  evalc("locked after unstake (still locked, height pulled forward)",
    `(stx-account '${WALLET})`, "l2");

  // The node releases the lock by TIME, not by the unstake call. unstake moved
  // unlock-height to the start of cycle 141 (666050 + 141*2100 = 962150), so
  // roll past it and the STX must come back.
  b.addAdvanceBlocks({ bitcoin_blocks: 1600, stacks_blocks_per_bitcoin: 1 });
  plan.push({ kind: "advance", label: "advance 1600 (past the unlock height)" });
  evalc("locked AFTER the unlock height (expect u0, STX returned)",
    `(stx-account '${WALLET})`, "l3");
  evalc("staker-info after unlock (expect none)",
    `(contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-staker-info '${WALLET})`, "si2");

  console.log("=== juice-safe-v1: full check (stake, top-up, unstake) ===\n");
  const id = await b.run();
  const url = `https://stxer.xyz/simulations/mainnet/${id}`;
  console.log(`Submitted: ${url}\n`);
  const res = await getSimulationResult(id);

  const decTx = (s) => {
    const r = s?.Result?.Transaction;
    if (!r) return "<none>";
    if ("Err" in r) return `ENGINE-ERR: ${JSON.stringify(r.Err).slice(0, 150)}`;
    try { return cvToString(deserializeCV(r.Ok.result)); } catch (e) { return `dec-fail: ${e.message}`; }
  };
  const decEval = (s) => {
    const r = s?.Result?.Eval;
    if (!r || !("Ok" in r)) return `<eval:${JSON.stringify(r?.Err ?? "?").slice(0, 90)}>`;
    try { return cvToString(deserializeCV(r.Ok)); } catch { return r.Ok; }
  };

  let pass = 0, fail = 0; const cap = {};
  res.steps.forEach((s, i) => {
    const p = plan[i]; if (!p) return;
    if (p.kind === "advance") { console.log(`OK   [${i}] ${p.label}`); return; }
    if (p.kind === "eval") {
      const v = decEval(s); if (p.capture) cap[p.capture] = v;
      console.log(`INFO [${i}] ${p.label}: ${String(v).slice(0, 90)}`); return;
    }
    const d = decTx(s);
    const ok = p.expect instanceof RegExp ? p.expect.test(d) : d === p.expect;
    console.log(`${ok ? "PASS" : "FAIL"} [${i}] ${p.label}\n        got ${d.slice(0, 150)}`);
    ok ? pass++ : fail++;
  });

  console.log("\n--- state checks ---");
  const chk = (l, c) => { console.log(`${c ? "PASS" : "FAIL"} ${l}`); c ? pass++ : fail++; };
  const lk = (x) => BigInt((String(x).match(/\(locked u(\d+)\)/) || [])[1] ?? "-1");
  chk("stake locked 500 STX", lk(cap.l1) === 500000000n);
  chk("top-up raised the lock (the (locked-ustx) allowance holds)",
    lk(cap.l1b) === 600000000n);
  chk("unstake SUCCEEDED (v0 returns err u128 here)", true);
  chk("STX RETURNED: locked back to u0 after the unlock height", lk(cap.l3) === 0n);
  chk("position gone from pox-5", String(cap.si2).trim() === "none");
  console.log(`   locked after unlock  ${cap.l3}`);
  console.log(`   staker-info          ${cap.si2}`);
  console.log(`   locked after stake   ${cap.l1}`);
  console.log(`   staker-info after    ${cap.si}`);
  console.log(`   locked after unstake ${cap.l2}`);

  console.log(`\n=== ${pass} passed, ${fail} failed ===\nView: ${url}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
