// simul-juice-safe-v7-webauthn-fix-regression.js
// ---------------------------------------------------------------------------
// REGRESSION for the H-01 fix. Deploys the FIXED clarity-5-webauthn-v4 and
// juice-safe-v7 (repointed to v4) on the stxer mainnet fork, then:
//   1. fires the exact 3-way challenge multiplex that drained juice-safe-v6
//      -> every split must now FAIL (err u4002 invalid-signature)
//   2. fires one HONEST single-op transfer (canonical single-hash challenge)
//      -> must PASS (ok true) and move the funds
//   3. read-only verify-signature cross-check: multiplex splits -> (err u4002),
//      honest split -> (ok true)
//
//   node simul-juice-safe-v7-webauthn-fix-regression.js
// ---------------------------------------------------------------------------

import fs from "node:fs";
import crypto from "node:crypto";
import {
  tupleCV, uintCV, bufferCV, noneCV, someCV, principalCV,
  standardPrincipalCV, stringAsciiCV, serializeCV, deserializeCV, cvToString,
  PostConditionMode, ClarityVersion,
} from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";
import { generateP256Keypair } from "./lib-webauthn-test-signer.mjs";
import { p256 } from "@noble/curves/nist.js";

const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const OWNER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";
const RECOVERY = "SP3HXJJMJQ06GNAZ8XWDN1QM48JEDC6PP6W3YZPZJ";
const RELAYER = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM";
const STX_WHALE = "SP9BP4PN74CNR5XT7CMAMBPA0GWC9HMB69HVVV51";
const SINK1 = "SP22WH53NS94VR6N145ZX77BK4S0EWFBE41VW3Z6B";
const SINK2 = "SP1MGH8BH1KRY49Z7EE5TY0JVKT6C3NT9RTVM8FND";
const SINK3 = "SP1JAG6TV2XRYFGJN7CAAN6Z3CEW2YMZWMHJAJV91";
const HONEST_SINK = "SP3TA7SMY7APYR9SFKDT0527NC0GWR84S3AHEM0NE";

const WALLET = `${DEPLOYER}.juice-safe-v7`;
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core-v2`;
const STACKS_NODE_API = "http://77.42.3.101/stacks-api";
const RP_ID = "juiceofbtc.com";

const FUND_USTX = 2_800_000_000;
const STX_THRESHOLD = 100_000_000;
const SBTC_THRESHOLD = 100_000;
const COOLDOWN = 144;
const DRAIN1 = 10_000_000, DRAIN2 = 20_000_000, DRAIN3 = 30_000_000;
const HONEST_AMT = 15_000_000;

// comment-free deploy sources (exactly what the fakdao-be templates ship)
const V4_SRC = fs.readFileSync("./contracts/deploying/clarity-5-webauthn-v4.clar", "utf8");
const CORE_V2_SRC = fs.readFileSync("./contracts/deploying/fakfun-wallet-core-v2.clar", "utf8");
const V7_SRC = fs.readFileSync("./contracts/deploying/juice-safe-v7.clar", "utf8");
const V17_SRC = fs.readFileSync("./contracts/deploying/fakfun-wallet-v17.clar", "utf8");

// -- SIP-018 stx-transfer hash (helpers-v7); domain wallet = the v7 safe --------
const SIP = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const cvSha256 = (cv) => { const o = serializeCV(cv); return sha256(Buffer.from(typeof o === "string" ? o : Buffer.from(o).toString("hex"), "hex")); };
const domainHash = cvSha256(tupleCV({
  name: stringAsciiCV("smart-wallet-standard"), version: stringAsciiCV("1.0.0"),
  "chain-id": uintCV(1), wallet: principalCV(WALLET),
}));
const stxTransferHash = (authId, amount, recipient) =>
  sha256(Buffer.concat([SIP, domainHash, cvSha256(tupleCV({
    topic: stringAsciiCV("stx-transfer"), "auth-id": uintCV(authId),
    amount: uintCV(amount), recipient: principalCV(recipient), memo: noneCV(),
  }))]));

// -- WebAuthn crafting ----------------------------------------------------------
const strip = (h) => (h.startsWith("0x") ? h.slice(2) : h);
const hx = (b) => "0x" + Buffer.from(b).toString("hex");
const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const JSON_PREFIX = Buffer.from('{"type":"webauthn.get","challenge":"', "utf8");
const JSON_SUFFIX = Buffer.from(`","origin":"https://${RP_ID}","crossOrigin":false}`, "utf8");
function authData() {
  return Buffer.concat([sha256(Buffer.from(RP_ID, "ascii")), Buffer.from([0x05]), Buffer.from([0, 0, 0, 5])]);
}

// One signature over ONE clientDataJSON holding all three hashes (the attack).
function multiplexSign(privKey, ops) {
  const m = ops.map((o) => stxTransferHash(o.authId, o.amount, o.recipient));
  const hb = m.map((x) => Buffer.from(b64url(x), "ascii"));
  const A = Buffer.from("A", "ascii");
  const clientDataJSON = Buffer.concat([JSON_PREFIX, hb[0], A, hb[1], A, hb[2], JSON_SUFFIX]);
  const ad = authData();
  const sig = p256.sign(sha256(Buffer.concat([ad, sha256(clientDataJSON)])), privKey, { prehash: false, format: "compact", lowS: true });
  const splits = [
    { prefix: JSON_PREFIX, suffix: Buffer.concat([A, hb[1], A, hb[2], JSON_SUFFIX]) },
    { prefix: Buffer.concat([JSON_PREFIX, hb[0], A]), suffix: Buffer.concat([A, hb[2], JSON_SUFFIX]) },
    { prefix: Buffer.concat([JSON_PREFIX, hb[0], A, hb[1], A]), suffix: JSON_SUFFIX },
  ];
  return { m, sigHex: hx(sig), adHex: hx(ad), splits: splits.map((s) => ({ p: hx(s.prefix), s: hx(s.suffix) })) };
}

// A HONEST single-op assertion: canonical prefix, one hash, closing quote next.
function honestSign(privKey, authId, amount, recipient) {
  const m = stxTransferHash(authId, amount, recipient);
  const clientDataJSON = Buffer.concat([JSON_PREFIX, Buffer.from(b64url(m), "ascii"), JSON_SUFFIX]);
  const ad = authData();
  const sig = p256.sign(sha256(Buffer.concat([ad, sha256(clientDataJSON)])), privKey, { prehash: false, format: "compact", lowS: true });
  return { m, sigHex: hx(sig), adHex: hx(ad), pHex: hx(JSON_PREFIX), sHex: hx(JSON_SUFFIX) };
}

function sigAuthTuple(authId, pubKeyHex, sigHex, adHex, pHex, sHex) {
  return tupleCV({
    "auth-id": uintCV(authId),
    pubkey: bufferCV(Buffer.from(strip(pubKeyHex), "hex")),
    signature: bufferCV(Buffer.from(strip(sigHex), "hex")),
    "authenticator-data": bufferCV(Buffer.from(strip(adHex), "hex")),
    "client-data-prefix": bufferCV(Buffer.from(strip(pHex), "hex")),
    "client-data-suffix": bufferCV(Buffer.from(strip(sHex), "hex")),
  });
}

async function main() {
  const key = generateP256Keypair();
  const pubkeyCV = bufferCV(Buffer.from(strip(key.pubKeyHex), "hex"));
  const mx = multiplexSign(key.privKey, [
    { authId: 1, amount: DRAIN1, recipient: SINK1 },
    { authId: 2, amount: DRAIN2, recipient: SINK2 },
    { authId: 3, amount: DRAIN3, recipient: SINK3 },
  ]);
  const honest = honestSign(key.privKey, 9, HONEST_AMT, HONEST_SINK);

  const plan = [];
  const b = SimulationBuilder.new({ stacksNodeAPI: STACKS_NODE_API });
  const evalc = (label, code, cap, at = WALLET) => { b.addEvalCode(at, code); plan.push({ kind: "eval", label, cap }); };
  const call = (label, sender, cid, fn, args, expect) => {
    b.withSender(sender).addContractCall({ contract_id: cid, function_name: fn, function_args: args, post_condition_mode: PostConditionMode.Allow });
    plan.push({ kind: "tx", label, expect });
  };
  const okre = /^\(ok/;

  // -- deploy the FIXED library, then the repointed safe ----------------------
  const CLARITY6 = 6; // SDK enum stops at 5; these are Clarity 6 (SIP-044 as-contract?)
  b.withSender(DEPLOYER).addContractDeploy({ contract_name: "clarity-5-webauthn-v4", source_code: V4_SRC, clarity_version: CLARITY6 });
  plan.push({ kind: "tx", label: "deploy clarity-5-webauthn-v4 (comment-free)", expect: null });
  b.withSender(DEPLOYER).addContractDeploy({ contract_name: "fakfun-wallet-core-v2", source_code: CORE_V2_SRC, clarity_version: CLARITY6 });
  plan.push({ kind: "tx", label: "deploy fakfun-wallet-core-v2 (comment-free)", expect: null });
  b.withSender(DEPLOYER).addContractDeploy({ contract_name: "juice-safe-v7", source_code: V7_SRC, clarity_version: CLARITY6 });
  plan.push({ kind: "tx", label: "deploy juice-safe-v7 (-> v4 + core-v2)", expect: null });
  b.withSender(DEPLOYER).addContractDeploy({ contract_name: "fakfun-wallet-v17", source_code: V17_SRC, clarity_version: CLARITY6 });
  plan.push({ kind: "tx", label: "deploy fakfun-wallet-v17 (-> v4 + core-v2) [compile check]", expect: null });

  // -- setup ------------------------------------------------------------------
  call("set-verified-contract(juice-safe-v7)", DEPLOYER, WALLET_CORE, "set-verified-contract", [principalCV(WALLET), noneCV()], okre);
  b.withSender(STX_WHALE).addSTXTransfer({ recipient: WALLET, amount: FUND_USTX });
  plan.push({ kind: "fund", label: `fund safe ${FUND_USTX / 1e6} STX` });
  call("onboard(passkey, OWNER, RECOVERY, thresholds)", FAKFUN_DEPLOYER, WALLET, "onboard",
    [pubkeyCV, standardPrincipalCV(OWNER), standardPrincipalCV(RECOVERY), uintCV(STX_THRESHOLD), uintCV(SBTC_THRESHOLD), uintCV(COOLDOWN)], okre);

  // -- read-only cross-check --------------------------------------------------
  mx.splits.forEach((s, i) => evalc(`verify-signature multiplex split ${i + 1} -> want (err u4002)`,
    `(contract-call? '${WALLET} verify-signature ${hx(mx.m[i])} 0x${strip(key.pubKeyHex)} ${mx.sigHex} ${mx.adHex} ${s.p} ${s.s})`, `mx${i + 1}`));
  evalc("verify-signature HONEST single -> want (ok true)",
    `(contract-call? '${WALLET} verify-signature ${hx(honest.m)} 0x${strip(key.pubKeyHex)} ${honest.sigHex} ${honest.adHex} ${honest.pHex} ${honest.sHex})`, "honestVs");

  // -- THE REGRESSION: multiplex drains must now FAIL -------------------------
  const drains = [
    { n: 1, amt: DRAIN1, sink: SINK1 }, { n: 2, amt: DRAIN2, sink: SINK2 }, { n: 3, amt: DRAIN3, sink: SINK3 },
  ];
  drains.forEach((d, i) => call(`multiplex DRAIN #${d.n} MUST FAIL -> (err u4002)`, RELAYER, WALLET, "stx-transfer",
    [uintCV(d.amt), standardPrincipalCV(d.sink), noneCV(),
     someCV(sigAuthTuple(d.n, key.pubKeyHex, mx.sigHex, mx.adHex, mx.splits[i].p, mx.splits[i].s)), noneCV()], "(err u4002)"));

  // -- the HONEST single-op transfer must still PASS --------------------------
  evalc("HONEST_SINK STX before", `(stx-get-balance '${HONEST_SINK})`, "hb");
  call("HONEST single-op transfer MUST PASS -> (ok true)", RELAYER, WALLET, "stx-transfer",
    [uintCV(HONEST_AMT), standardPrincipalCV(HONEST_SINK), noneCV(),
     someCV(sigAuthTuple(9, key.pubKeyHex, honest.sigHex, honest.adHex, honest.pHex, honest.sHex)), noneCV()], okre);
  evalc("HONEST_SINK STX after", `(stx-get-balance '${HONEST_SINK})`, "ha");

  // -- run --------------------------------------------------------------------
  console.log("=== juice-safe-v7 + clarity-5-webauthn-v4 FIX REGRESSION ===\n");
  const sessionId = await b.run();
  const url = `https://stxer.xyz/simulations/mainnet/${sessionId}`;
  console.log(`Submitted: ${url}\n`);
  const res = await getSimulationResult(sessionId);

  const decTx = (s) => { const r = s?.Result?.Transaction; if (!r) return "<none>"; if ("Err" in r) return `ENGINE-ERR: ${JSON.stringify(r.Err).slice(0, 200)}`; try { return cvToString(deserializeCV(r.Ok.result)); } catch (e) { return `dec-fail: ${e.message}`; } };
  const decEval = (s) => { const r = s?.Result?.Eval; if (!r || !("Ok" in r)) return `<eval:${JSON.stringify(r?.Err ?? "?").slice(0, 140)}>`; try { return cvToString(deserializeCV(r.Ok)); } catch { return r.Ok; } };
  const uintOf = (s) => BigInt((String(s).match(/(\d+)/) || [])[1] ?? "-1");

  let pass = 0, fail = 0; const cap = {};
  res.steps.forEach((s, i) => {
    const p = plan[i]; if (!p) return;
    if (p.kind === "fund") { const ok = !("Err" in (s?.Result?.Transaction || {})); console.log(`${ok ? "OK  " : "FAIL"} [${i}] ${p.label}`); if (!ok) { fail++; console.log("   " + decTx(s)); } return; }
    if (p.kind === "eval") { const v = decEval(s); if (p.cap) cap[p.cap] = v; console.log(`INFO [${i}] ${p.label}: ${String(v).slice(0, 90)}`); return; }
    const d = decTx(s);
    const ok = p.expect == null ? !d.startsWith("ENGINE-ERR") : (p.expect instanceof RegExp ? p.expect.test(d) : d === p.expect);
    console.log(`${ok ? "PASS" : "FAIL"} [${i}] ${p.label}\n        got ${d.slice(0, 150)}`);
    ok ? pass++ : fail++;
  });

  console.log("\n--- regression assertions ---");
  const chk = (l, c) => { console.log(`${c ? "PASS" : "FAIL"} ${l}`); c ? pass++ : fail++; };
  chk("verify-signature rejects multiplex split 1 (err u4002)", String(cap.mx1) === "(err u4002)");
  chk("verify-signature rejects multiplex split 2 (err u4002)", String(cap.mx2) === "(err u4002)");
  chk("verify-signature rejects multiplex split 3 (err u4002)", String(cap.mx3) === "(err u4002)");
  chk("verify-signature accepts honest single (ok true)", String(cap.honestVs) === "(ok true)");
  chk("honest transfer moved exactly 15 STX", uintOf(cap.ha) - uintOf(cap.hb) === BigInt(HONEST_AMT));

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  console.log(url);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
