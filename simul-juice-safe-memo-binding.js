// simul-juice-safe-memo-binding.js
// Stxer mainnet-fork proof of the memo fix (d4eda1c, bounty mv8wal, Cunning
// Nexus #3, repro sim 5e1951e926f9c3063bdcb33e720955ca): a queued over-limit
// transfer now stores its memo (payload = to-consensus-buff? memo) and the
// passkey execute-pending-{stx,sbtc}-transfer-now refuses any other memo
// (err-memo-mismatch u4041).
//
// Four safes in ONE session, each run through the same script:
//   C8  SPV9K21....juice-safe-v8 - the LIVE canonical (not redeployed), control
//   F9  SPV9K21....juice-safe-v9 - fixed, deploy-bytes-memofix/juice-safe-v9.clar
//   CA  SP28MP....memo-control-autostake-safe - pre-fix autostake bytes (93d3adf),
//       verified against .juice-autostake-safe with set-verified-contract(hash)
//   FA  SPV9K21....juice-autostake-safe - fixed autostake bytes, verified by
//       set-verified-contract(none) AFTER CA onboarded (re-points the hash)
// Deploy bytes: deploy-bytes-memofix/ (strip_clarity + clarinet format, the
// pipeline that reproduces the live v8 hash; sha256 checked against SHA256SUMS).
// The autostake pool stack comes from jing-contracts-v3 deploy-bytes-mv7dfb;
// parts already live on mainnet with identical source are not redeployed.
//
// Per safe (thresholds 100 STX / 100k sats, cooldown 144; OWNER = admin queues,
// a passkey sig over execute-now {auth-id, op-id} is broadcast by RELAYER):
//   op0 STX 400 memo M    -now X: control ok + memo X (bug) | fixed u4041, nothing
//                          moves, op pending; -now M (same sig): control u4014 |
//                          fixed ok, stx_transfer_event memo M
//   op1 STX 300 memo none -now X: control ok (memo injected) | fixed u4041;
//                          fixed: -now none -> ok, no memo
//   op2 sBTC 150k memo M  same as op0 on execute-pending-sbtc-transfer-now
//   op3 sBTC 120k none    same as op1
//   op4 STX 200 memo M, op5 sBTC 110k memo M: admin execute-pending-* before the
//                          cooldown u4017; after 145 burn blocks ok with memo M,
//                          identical on control and fixed
//
// Run: node simul-juice-safe-memo-binding.js
import crypto from "node:crypto";
import fs from "node:fs";
import {
  tupleCV, uintCV, bufferCV, noneCV, someCV, principalCV, standardPrincipalCV, contractPrincipalCV,
  stringAsciiCV, serializeCV, deserializeCV, cvToString, ClarityVersion, PostConditionMode,
} from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";
import { generateP256Keypair, signChallengeWithRpId } from "./lib-webauthn-test-signer.mjs";
import { installChunkedSubmit } from "./_chunked-submit.mjs";
installChunkedSubmit(40);

const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const OWNER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2"; // admin + sBTC whale
const RECOVERY = "SP3HXJJMJQ06GNAZ8XWDN1QM48JEDC6PP6W3YZPZJ";
const RELAYER = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM";
const EXCHANGE = "SP22WH53NS94VR6N145ZX77BK4S0EWFBE41VW3Z6B"; // memo-routed deposit address stand-in
const STX_WHALE = "SP354663MXNWN2B6HKNBYD8JBNJK2ZNBZE764X1RR";
const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core-v2`;
const MM_HELPER = `${DEPLOYER}.mm-safe-auth-helpers-v1`;
const CLARITY_6 = ClarityVersion.Clarity6 ?? 6;
const STACKS_NODE_API = "http://77.42.3.101/stacks-api";
const RP_ID = "juiceofbtc.com";
const MB = new URL("./deploy-bytes-memofix/", import.meta.url).pathname;
const DB = `${process.env.HOME}/projects/jing-contracts-v3/simulations/deploy-bytes-mv7dfb`;
const LIVE_V8_HASH = "b3d74b90efebba24a28e3c8d5101fd7c56208deb1699088f18206565f1c0ba15";

const M = Buffer.from("owner-acct-1001", "ascii");
const X = Buffer.from("attacker-acct-6666", "ascii");
const STX_THR = 100_000_000, SBTC_THR = 100_000, COOLDOWN = 144;
const FUND_STX = 1_000_000_000, FUND_SBTC = 400_000;
const AMT = { op0: 400_000_000, op1: 300_000_000, op2: 150_000, op3: 120_000, op4: 200_000_000, op5: 110_000 };

const SAFES = [
  { tag: "C8", fixed: false, id: `${DEPLOYER}.juice-safe-v8`, live: true, family: "v9" },
  { tag: "F9", fixed: true, id: `${DEPLOYER}.juice-safe-v9`, bytes: "juice-safe-v9", family: "v9" },
  { tag: "CA", fixed: false, id: `${FAKFUN_DEPLOYER}.memo-control-autostake-safe`, bytes: "juice-autostake-safe-prefix", family: "autostake" },
  { tag: "FA", fixed: true, id: `${DEPLOYER}.juice-autostake-safe`, bytes: "juice-autostake-safe", family: "autostake" },
];

const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const strip = (h) => (h.startsWith("0x") ? h.slice(2) : h);
const cvHex = (cv) => strip(typeof serializeCV(cv) === "string" ? serializeCV(cv) : Buffer.from(serializeCV(cv)).toString("hex"));
const cvSha = (cv) => sha256(Buffer.from(cvHex(cv), "hex"));
const challenge = (wallet, t) => sha256(Buffer.concat([Buffer.from("534950303138", "hex"), cvSha(tupleCV({
  name: stringAsciiCV("smart-wallet-standard"), version: stringAsciiCV("1.0.0"), "chain-id": uintCV(1), wallet: principalCV(wallet),
})), cvSha(t)]));
const tNow = (a, op) => tupleCV({ topic: stringAsciiCV("execute-now"), "auth-id": uintCV(a), "op-id": uintCV(op) });
const optMemo = (m) => (m ? someCV(bufferCV(m)) : noneCV());
const hx = (b) => b.toString("hex");

async function main() {
  const sums = Object.fromEntries(fs.readFileSync(`${MB}SHA256SUMS.txt`, "utf8").trim().split("\n").map((l) => l.split(/\s+/)).map(([f, n, h, h5]) => [f, { h, h5 }]));
  const mb = (n) => {
    const s = fs.readFileSync(`${MB}${n}.clar`, "utf8");
    if (crypto.createHash("sha256").update(s).digest("hex") !== sums[`${n}.clar`].h) throw new Error(`${n}: sha256 != SHA256SUMS`);
    return { s, h5: crypto.createHash("sha512-256").update(s).digest("hex") };
  };
  const dbSums = Object.fromEntries(fs.readFileSync(`${DB}/SHA256SUMS.txt`, "utf8").trim().split("\n").map((l) => l.trim().split(/\s+/)).map(([f, , h]) => [f, h]));
  const db = (n) => {
    const s = fs.readFileSync(`${DB}/${n}.clar`, "utf8");
    if (crypto.createHash("sha256").update(s).digest("hex") !== dbSums[`${n}.clar`]) throw new Error(`${n}: sha256 != mv7dfb SHA256SUMS`);
    return s;
  };
  const liveSource = async (cid) => {
    const [a, n] = cid.split(".");
    const r = await fetch(`${STACKS_NODE_API}/v2/contracts/source/${a}/${n}?proof=0`);
    return r.ok ? (await r.json()).source : null;
  };

  const plan = [];
  const b = SimulationBuilder.new({ stacksNodeAPI: STACKS_NODE_API });
  const okre = /^\(ok/;
  const step = (label) => plan.push({ kind: "step", label });
  const evalAt = (at, label, code, capture) => { b.addEvalCode(at, code); plan.push({ kind: "eval", label, capture }); };
  const call = (label, sender, cid, fn, args, expect, capture) => {
    b.withSender(sender).addContractCall({ contract_id: cid, function_name: fn, function_args: args, post_condition_mode: PostConditionMode.Allow });
    plan.push({ kind: "tx", label, expect, capture });
  };
  const deploy = (sender, name, code, ver, label) => { b.withSender(sender).addContractDeploy({ contract_name: name, source_code: code, clarity_version: ver }); step(label); };
  const sbtc = contractPrincipalCV(...SBTC_TOKEN.split("."));
  const notes = [];

  // -- autostake dependencies: pool stack (mv7dfb bytes) + helper ------------------------
  for (const [n, v] of [["jing-core-v6", ClarityVersion.Clarity5], ["jing-ladder-v1", ClarityVersion.Clarity5], ["markets-sbtc-stx-jing-v6-3", ClarityVersion.Clarity5],
    ["swap-router-sbtc-stx-jing-v5-3", ClarityVersion.Clarity5], ["juice-swap-vault-trait-v2", CLARITY_6], ["juice-sbtc-autoswap", CLARITY_6], ["juice-pool-sbtc-signer", CLARITY_6]]) {
    const code = db(n), live = await liveSource(`${DEPLOYER}.${n}`);
    if (live === null) deploy(DEPLOYER, n, code, v, `deploy ${n} (mv7dfb deploy bytes)`);
    else if (live === code) notes.push(`${n}: live on mainnet, identical to mv7dfb bytes, not redeployed`);
    else throw new Error(`${n} is live with DIFFERENT source than mv7dfb`);
  }
  const helper = mb("juice-autostake-safe-auth-helpers-v1");
  if (await liveSource(`${DEPLOYER}.juice-autostake-safe-auth-helpers-v1`)) throw new Error("autostake helper unexpectedly live");
  deploy(DEPLOYER, "juice-autostake-safe-auth-helpers-v1", helper.s, ClarityVersion.Clarity4, "deploy juice-autostake-safe-auth-helpers-v1 (Clarity 4)");
  for (const s of SAFES.filter((x) => !x.live)) if (await liveSource(s.id)) throw new Error(`${s.id} already on mainnet: not a fresh name`);

  // -- per-safe setup ------------------------------------------------------------------
  const keys = {}, hashes = {};
  for (const s of SAFES) {
    keys[s.tag] = generateP256Keypair();
    const [addr, name] = s.id.split(".");
    if (s.live) {
      evalAt(s.id, `${s.tag} live contract-hash?`, `(contract-hash? '${s.id})`, `${s.tag}hash`);
    } else {
      const { s: code, h5 } = mb(s.bytes);
      hashes[s.tag] = h5;
      deploy(addr, name, code, CLARITY_6, `${s.tag} deploy ${s.id} (${s.bytes}, sha512/256 ${h5.slice(0, 12)})`);
      if (s.tag === "F9") call("F9 core-v2 set-verified-contract(juice-safe-v9)", DEPLOYER, WALLET_CORE, "set-verified-contract", [principalCV(s.id), noneCV()], okre);
      if (s.tag === "CA") call("CA core-v2 set-verified-contract(.juice-autostake-safe, pre-fix hash)", DEPLOYER, WALLET_CORE, "set-verified-contract",
        [principalCV(`${DEPLOYER}.juice-autostake-safe`), someCV(bufferCV(Buffer.from(h5, "hex")))], okre);
      if (s.tag === "FA") call("FA core-v2 set-verified-contract(.juice-autostake-safe) -> fixed hash", DEPLOYER, WALLET_CORE, "set-verified-contract", [principalCV(s.id), noneCV()], okre);
      evalAt(s.id, `${s.tag} contract-hash?`, `(contract-hash? '${s.id})`, `${s.tag}hash`);
    }
    b.withSender(STX_WHALE).addSTXTransfer({ recipient: s.id, amount: FUND_STX });
    step(`${s.tag} fund ${FUND_STX / 1e6} STX`);
    call(`${s.tag} fund ${FUND_SBTC} sats sBTC`, OWNER, SBTC_TOKEN, "transfer", [uintCV(FUND_SBTC), standardPrincipalCV(OWNER), principalCV(s.id), noneCV()], okre);
    call(`${s.tag} onboard (passkey, 100 STX / 100k sats / 144)`, FAKFUN_DEPLOYER, s.id, "onboard",
      [bufferCV(Buffer.from(strip(keys[s.tag].pubKeyHex), "hex")), standardPrincipalCV(OWNER), standardPrincipalCV(RECOVERY), uintCV(STX_THR), uintCV(SBTC_THR), uintCV(COOLDOWN)], okre);
  }

  // -- per-safe memo scenarios -----------------------------------------------------------
  const sigTuple = (tag, authId, wallet, op) => {
    const k = keys[tag];
    const sg = signChallengeWithRpId(challenge(wallet, tNow(authId, op)), k.privKey, RP_ID);
    return tupleCV({
      "auth-id": uintCV(authId), pubkey: bufferCV(Buffer.from(strip(k.pubKeyHex), "hex")), signature: bufferCV(Buffer.from(strip(sg.signatureHex), "hex")),
      "authenticator-data": bufferCV(Buffer.from(strip(sg.authenticatorDataHex), "hex")),
      "client-data-prefix": bufferCV(Buffer.from(strip(sg.clientDataPrefixHex), "hex")), "client-data-suffix": bufferCV(Buffer.from(strip(sg.clientDataSuffixHex), "hex")),
    });
  };
  const BAL = (w) => `{ ws: (stx-get-balance '${w}), rs: (stx-get-balance '${EXCHANGE}),
    wb: (unwrap-panic (contract-call? '${SBTC_TOKEN} get-balance '${w})), rb: (unwrap-panic (contract-call? '${SBTC_TOKEN} get-balance '${EXCHANGE})) }`;
  const moves = []; // [tag, label, before, after, deltas]
  const valued = (s, label, sender, fn, args, expect, deltas, capture) => {
    const t0 = `${capture}_b`, t1 = `${capture}_a`;
    evalAt(s.id, `${label} (balances before)`, BAL(s.id), t0);
    call(label, sender, s.id, fn, args, expect, capture);
    evalAt(s.id, `${label} (balances after)`, BAL(s.id), t1);
    moves.push([label, t0, t1, deltas]);
  };
  const op = (s, n, tag) => evalAt(s.id, `${s.tag} get-pending-operation u${n}`, `(get-pending-operation u${n})`, `${s.tag}${tag}`);
  const stxNow = (s, n, memo, sig) => [uintCV(n), optMemo(memo), sig, noneCV()];
  const nil = {};

  for (const s of SAFES) {
    const P = s.tag, W = s.id;
    evalAt(W, `${P} live mm helper execute-now hash {auth 1, op 0}`, `(contract-call? '${MM_HELPER} build-execute-now-hash {auth-id: u1, op-id: u0})`, `${P}helper`);
    hashes[`${P}js`] = hx(challenge(W, tNow(1, 0)));
    // op0: STX, memo M
    call(`${P} op0 admin stx-transfer ${AMT.op0 / 1e6} STX memo M -> queued`, OWNER, W, "stx-transfer", [uintCV(AMT.op0), standardPrincipalCV(EXCHANGE), optMemo(M), noneCV(), noneCV()], "(ok true)");
    op(s, 0, "op0q");
    const sig0 = sigTuple(P, 1, W, 0);
    if (s.fixed) {
      valued(s, `${P} (b) op0 -now with memo X -> u4041`, RELAYER, "execute-pending-stx-transfer-now", stxNow(s, 0, X, sig0), "(err u4041)", nil, `${P}b0x`);
      op(s, 0, "op0x");
      valued(s, `${P} (b) op0 -now with memo M, same sig -> ok`, RELAYER, "execute-pending-stx-transfer-now", stxNow(s, 0, M, sig0), "(ok true)", { ws: -AMT.op0, rs: AMT.op0 }, `${P}b0m`);
    } else {
      valued(s, `${P} (a) op0 -now with memo X -> ok (bug: broadcaster's memo)`, RELAYER, "execute-pending-stx-transfer-now", stxNow(s, 0, X, sig0), "(ok true)", { ws: -AMT.op0, rs: AMT.op0 }, `${P}a0x`);
      call(`${P} (a) op0 -now with memo M, same sig -> u4014`, RELAYER, W, "execute-pending-stx-transfer-now", stxNow(s, 0, M, sig0), "(err u4014)");
    }
    // op1: STX, memo none
    call(`${P} op1 admin stx-transfer ${AMT.op1 / 1e6} STX memo none -> queued`, OWNER, W, "stx-transfer", [uintCV(AMT.op1), standardPrincipalCV(EXCHANGE), noneCV(), noneCV(), noneCV()], "(ok true)");
    op(s, 1, "op1q");
    const sig1 = sigTuple(P, 2, W, 1);
    if (s.fixed) {
      valued(s, `${P} (c) op1 (none) -now with memo X -> u4041`, RELAYER, "execute-pending-stx-transfer-now", stxNow(s, 1, X, sig1), "(err u4041)", nil, `${P}c1x`);
      valued(s, `${P} (c) op1 (none) -now with none -> ok`, RELAYER, "execute-pending-stx-transfer-now", stxNow(s, 1, null, sig1), "(ok true)", { ws: -AMT.op1, rs: AMT.op1 }, `${P}c1n`);
    } else {
      valued(s, `${P} (a) op1 (none) -now with memo X -> ok (bug: memo injected)`, RELAYER, "execute-pending-stx-transfer-now", stxNow(s, 1, X, sig1), "(ok true)", { ws: -AMT.op1, rs: AMT.op1 }, `${P}a1x`);
    }
    // op2: sBTC, memo M
    const ft = (amt, memo) => [uintCV(amt), standardPrincipalCV(EXCHANGE), optMemo(memo), sbtc, stringAsciiCV("sbtc-token"), noneCV(), noneCV()];
    call(`${P} op2 admin sip010-transfer ${AMT.op2} sats memo M -> queued`, OWNER, W, "sip010-transfer", ft(AMT.op2, M), "(ok true)");
    op(s, 2, "op2q");
    const sig2 = sigTuple(P, 3, W, 2);
    if (s.fixed) {
      valued(s, `${P} (b) op2 sbtc -now with memo X -> u4041`, RELAYER, "execute-pending-sbtc-transfer-now", stxNow(s, 2, X, sig2), "(err u4041)", nil, `${P}b2x`);
      op(s, 2, "op2x");
      valued(s, `${P} (b) op2 sbtc -now with memo M, same sig -> ok`, RELAYER, "execute-pending-sbtc-transfer-now", stxNow(s, 2, M, sig2), "(ok true)", { wb: -AMT.op2, rb: AMT.op2 }, `${P}b2m`);
    } else {
      valued(s, `${P} (a) op2 sbtc -now with memo X -> ok (bug)`, RELAYER, "execute-pending-sbtc-transfer-now", stxNow(s, 2, X, sig2), "(ok true)", { wb: -AMT.op2, rb: AMT.op2 }, `${P}a2x`);
      call(`${P} (a) op2 sbtc -now with memo M, same sig -> u4014`, RELAYER, W, "execute-pending-sbtc-transfer-now", stxNow(s, 2, M, sig2), "(err u4014)");
    }
    // op3: sBTC, memo none
    call(`${P} op3 admin sip010-transfer ${AMT.op3} sats memo none -> queued`, OWNER, W, "sip010-transfer", ft(AMT.op3, null), "(ok true)");
    op(s, 3, "op3q");
    const sig3 = sigTuple(P, 4, W, 3);
    if (s.fixed) {
      valued(s, `${P} (c) op3 sbtc (none) -now with memo X -> u4041`, RELAYER, "execute-pending-sbtc-transfer-now", stxNow(s, 3, X, sig3), "(err u4041)", nil, `${P}c3x`);
      valued(s, `${P} (c) op3 sbtc (none) -now with none -> ok`, RELAYER, "execute-pending-sbtc-transfer-now", stxNow(s, 3, null, sig3), "(ok true)", { wb: -AMT.op3, rb: AMT.op3 }, `${P}c3n`);
    } else {
      valued(s, `${P} (a) op3 sbtc (none) -now with memo X -> ok (bug)`, RELAYER, "execute-pending-sbtc-transfer-now", stxNow(s, 3, X, sig3), "(ok true)", { wb: -AMT.op3, rb: AMT.op3 }, `${P}a3x`);
    }
    // op4 / op5 for (d)
    call(`${P} op4 admin stx-transfer ${AMT.op4 / 1e6} STX memo M -> queued`, OWNER, W, "stx-transfer", [uintCV(AMT.op4), standardPrincipalCV(EXCHANGE), optMemo(M), noneCV(), noneCV()], "(ok true)");
    call(`${P} op5 admin sip010-transfer ${AMT.op5} sats memo M -> queued`, OWNER, W, "sip010-transfer", ft(AMT.op5, M), "(ok true)");
    call(`${P} (d) op4 admin execute-pending-stx-transfer before the cooldown -> u4017`, OWNER, W, "execute-pending-stx-transfer", [uintCV(4), optMemo(M)], "(err u4017)");
    call(`${P} (d) op5 admin execute-pending-sbtc-transfer before the cooldown -> u4017`, OWNER, W, "execute-pending-sbtc-transfer", [uintCV(5), optMemo(M)], "(err u4017)");
  }
  evalAt(SAFES[1].id, "burn-block-height before the advance", "burn-block-height", "burn0");
  b.addAdvanceBlocks({ bitcoin_blocks: COOLDOWN + 1, stacks_blocks_per_bitcoin: 1 });
  plan.push({ kind: "advance", label: `advance ${COOLDOWN + 1} burn blocks (past the cooldown)` });
  evalAt(SAFES[1].id, "burn-block-height after the advance", "burn-block-height", "burn1");
  for (const s of SAFES) {
    const P = s.tag;
    valued(s, `${P} (d) op4 admin execute-pending-stx-transfer memo M -> ok`, OWNER, "execute-pending-stx-transfer", [uintCV(4), optMemo(M)], "(ok true)", { ws: -AMT.op4, rs: AMT.op4 }, `${P}d4`);
    valued(s, `${P} (d) op5 admin execute-pending-sbtc-transfer memo M -> ok`, OWNER, "execute-pending-sbtc-transfer", [uintCV(5), optMemo(M)], "(ok true)", { wb: -AMT.op5, rb: AMT.op5 }, `${P}d5`);
    call(`${P} (d) op4 again -> u4014`, OWNER, s.id, "execute-pending-stx-transfer", [uintCV(4), optMemo(M)], "(err u4014)");
  }

  // -- run ------------------------------------------------------------------------------
  console.log(`=== juice-safe memo binding (v8/v9 + autostake) - stxer harness ===\n${notes.join("\n")}`);
  const sessionId = await b.run();
  const url = `https://stxer.xyz/simulations/mainnet/${sessionId}`;
  console.log(`Submitted: ${url}\n`);
  const res = await getSimulationResult(sessionId);
  const decTx = (st) => {
    const r = st?.Result?.Transaction;
    if (!r) return "<none>";
    if ("Err" in r) return `ENGINE-ERR: ${JSON.stringify(r.Err).slice(0, 220)}`;
    try { return cvToString(deserializeCV(r.Ok.result)); } catch (e) { return `dec-fail: ${e.message}`; }
  };
  const decEval = (st) => {
    const r = st?.Result?.Eval;
    if (!r || !("Ok" in r)) return `<eval:${JSON.stringify(r?.Err ?? "?").slice(0, 160)}>`;
    try { return cvToString(deserializeCV(r.Ok)); } catch { return r.Ok; }
  };
  const events = (st) => (st?.Result?.Transaction?.Ok?.events ?? []).map((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw)).filter((e) => e.committed !== false);

  let pass = 0, fail = 0;
  const checks = [], cap = {}, ev = {};
  if (res.steps.length !== plan.length) console.log(`WARN: ${res.steps.length} steps returned, ${plan.length} planned`);
  plan.forEach((p, i) => {
    const st = res.steps[i];
    if (p.kind === "eval") { cap[p.capture] = decEval(st); console.log(`INFO [${i}] ${p.label}: ${String(cap[p.capture]).slice(0, 220)}`); return; }
    if (p.kind === "advance") { console.log(`INFO [${i}] ${p.label}`); return; }
    const d = decTx(st);
    if (p.capture) ev[p.capture] = events(st);
    const good = p.kind === "step" ? !!st && !/^ENGINE-ERR|^\(err|^<none>/.test(d) : p.expect instanceof RegExp ? p.expect.test(d) : d === p.expect;
    console.log(`${good ? "PASS" : "FAIL"} [${i}] ${p.label}\n        got ${d.slice(0, 200)}`);
    good ? pass++ : fail++;
    checks.push({ label: p.label, actual: d, passed: good });
  });

  console.log("\n--- state checks ---");
  const chk = (l, cond, actual = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${l}${cond ? "" : `  (${String(actual).slice(0, 400)})`}`); cond ? pass++ : fail++; checks.push({ label: l, actual: String(actual), passed: !!cond }); };
  const num2 = (t) => BigInt((String(cap[t]).match(/^u(\d+)$/) || [])[1] ?? "-1");
  const num = (t, f) => BigInt((String(cap[t]).match(new RegExp(`\\(${f} u(\\d+)\\)`)) || [])[1] ?? "-999999999999");
  for (const [label, t0, t1, d] of moves)
    for (const f of ["ws", "rs", "wb", "rb"]) {
      const want = BigInt(d[f] ?? 0), got = num(t1, f) - num(t0, f);
      chk(`${label}: ${f} moved ${want}`, got === want, `got ${got}`);
    }
  // memo in the events of one tx: STX -> the stx_transfer_event memo; sBTC -> the sbtc-token print
  const stxMemo = (cap) => (ev[cap] ?? []).filter((e) => e.type === "stx_transfer_event").map((e) => strip(e.stx_transfer_event?.memo ?? ""));
  const sbtcPrints = (cap) => (ev[cap] ?? []).filter((e) => e.type === "contract_event" && e.contract_event?.contract_identifier === SBTC_TOKEN)
    .map((e) => cvToString(deserializeCV(e.contract_event.raw_value)));
  const all = (cap) => JSON.stringify(ev[cap] ?? []);
  const memoIs = (cap, kind, want) => {
    if (kind === "stx") { const m = stxMemo(cap); return m.length === 1 && (want ? m[0].startsWith(hx(want)) && /^0*$/.test(m[0].slice(hx(want).length)) : /^0*$/.test(m[0])); }
    const p = sbtcPrints(cap); return want ? p.length === 1 && p[0] === `0x${hx(want)}` : p.length === 0;
  };
  const noTag = (cap, tag) => !all(cap).includes(hx(tag));
  const payloadSome = (m) => `(payload (some 0x${cvHex(optMemo(m))}))`;
  chk(`advance moved burn-block-height by >= ${COOLDOWN + 1}`, num2("burn1") - num2("burn0") >= BigInt(COOLDOWN + 1), `${cap.burn0} -> ${cap.burn1}`);
  console.log(`(sample stx_transfer_event memo: ${JSON.stringify(stxMemo(SAFES[0].tag + "a0x"))})`);
  chk("C8 is the LIVE juice-safe-v8 (contract-hash? = b3d74b90)", String(cap.C8hash) === `(ok 0x${LIVE_V8_HASH})`, cap.C8hash);
  for (const s of SAFES.filter((x) => !x.live)) chk(`${s.tag} on-chain hash = deploy-bytes sha512/256`, String(cap[`${s.tag}hash`]) === `(ok 0x${hashes[s.tag]})`, cap[`${s.tag}hash`]);
  for (const s of SAFES) {
    const P = s.tag;
    chk(`${P} live mm helper hash = JS execute-now challenge`, String(cap[`${P}helper`]) === `0x${hashes[`${P}js`]}`, cap[`${P}helper`]);
    for (const [o, m] of [["op0q", M], ["op1q", null], ["op2q", M], ["op3q", null]])
      chk(`${P} ${o.slice(0, 3)} payload ${s.fixed ? (m ? "= consensus(some M)" : "= consensus(none) 0x09") : "none (memo dropped)"}`,
        String(cap[`${P}${o}`]).includes(s.fixed ? payloadSome(m) : "(payload none)"), cap[`${P}${o}`]);
    if (s.fixed) {
      for (const c of ["b0x", "c1x", "b2x", "c3x"]) chk(`${P} ${c} refused tx emitted no events`, (ev[`${P}${c}`] ?? []).length === 0, all(`${P}${c}`));
      chk(`${P} op0 still pending after the X attempt (executed false, vetoed false)`, /\(executed false\)/.test(cap[`${P}op0x`]) && /\(vetoed false\)/.test(cap[`${P}op0x`]), cap[`${P}op0x`]);
      chk(`${P} op2 still pending after the X attempt`, /\(executed false\)/.test(cap[`${P}op2x`]), cap[`${P}op2x`]);
      chk(`${P} (b) op0 STX event memo = M, no X anywhere`, memoIs(`${P}b0m`, "stx", M) && noTag(`${P}b0m`, X), all(`${P}b0m`));
      chk(`${P} (b) op2 sbtc-token print = M, no X anywhere`, memoIs(`${P}b2m`, "sbtc", M) && noTag(`${P}b2m`, X), all(`${P}b2m`));
      chk(`${P} (c) op1 STX event has no memo`, memoIs(`${P}c1n`, "stx", null) && noTag(`${P}c1n`, X) && noTag(`${P}c1n`, M), all(`${P}c1n`));
      chk(`${P} (c) op3 sBTC transfer printed no memo`, memoIs(`${P}c3n`, "sbtc", null) && noTag(`${P}c3n`, X), all(`${P}c3n`));
    } else {
      chk(`${P} (a) op0 STX event memo = X (broadcaster's), not M`, memoIs(`${P}a0x`, "stx", X) && noTag(`${P}a0x`, M), all(`${P}a0x`));
      chk(`${P} (a) op1 (queued none) STX event memo = X`, memoIs(`${P}a1x`, "stx", X), all(`${P}a1x`));
      chk(`${P} (a) op2 sbtc-token print = X, not M`, memoIs(`${P}a2x`, "sbtc", X) && noTag(`${P}a2x`, M), all(`${P}a2x`));
      chk(`${P} (a) op3 (queued none) sbtc-token print = X`, memoIs(`${P}a3x`, "sbtc", X), all(`${P}a3x`));
    }
    chk(`${P} (d) admin op4 STX event memo = M`, memoIs(`${P}d4`, "stx", M), all(`${P}d4`));
    chk(`${P} (d) admin op5 sbtc-token print = M`, memoIs(`${P}d5`, "sbtc", M), all(`${P}d5`));
  }

  const total = pass + fail;
  console.log(`\n=== ${pass} passed, ${fail} failed (${total}) ===\nView: ${url}`);
  fs.mkdirSync("fixtures", { recursive: true });
  fs.writeFileSync("fixtures/simul-juice-safe-memo-binding-result.json", JSON.stringify({ simulation: url, passed: pass, total, notes, hashes, checks }, null, 1) + "\n");
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
