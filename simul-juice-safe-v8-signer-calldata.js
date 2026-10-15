// simul-juice-safe-v8-signer-calldata.js
// Stxer mainnet-fork harness: helpers-v2 binds signer-calldata into the
// passkey challenge of juice-safe-v8 stake-stx-juice, on the LIVE contracts.
//
// Live (not redeployed): SPV9K21....juice-safe-auth-helpers-v2,
// SPV9K21....juice-safe-v8 (canonical, not onboarded on mainnet),
// SPV9K21....juice-pool-stx-signer, pox-5, fakfun-wallet-core-v2.
//
// Two safes, one stake position each (pox-5 allows one per staker):
//   A  SPV9K21....juice-safe-v8 (the deployed canonical code), onboarded here
//   B  SP28MP....juice-safe-v8-user (relay user copy deployed from the BE
//      template bytes faktory-dao/backend/server/utils/juice-safe-v8-template.ts,
//      sha512/256 must equal the canonical hash b3d74b90...)
// Per safe, the passkey signs stake-stx-juice-pox5 {auth-id, amount-ustx,
// signer-calldata: X}. A relayer then submits:
//   calldata Y      -> (err u4002), nothing locked, no pool print
//   calldata none   -> (err u4002)
//   calldata X      -> (ok true), pox-5 locks exactly the stake for 96 cycles
//                      into juice-pool-stx-signer, the pool's validate-stake
//                      print and the safe's print both carry X
//   same sig again  -> refused (auth-id spent, u4006)
// The JS challenge is also cross-checked against the live helpers-v2 builder.
//
// Run: node simul-juice-safe-v8-signer-calldata.js
import crypto from "node:crypto";
import fs from "node:fs";
import {
  tupleCV, uintCV, bufferCV, noneCV, someCV, principalCV, standardPrincipalCV,
  stringAsciiCV, serializeCV, deserializeCV, cvToString, ClarityVersion, PostConditionMode,
} from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";
import { generateP256Keypair, signChallengeWithRpId } from "./lib-webauthn-test-signer.mjs";
import { SAFE_BYTES_DIR, bytesTag, loadBytes } from "./_safe-bytes.mjs";

const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const OWNER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";
const RECOVERY = "SP3HXJJMJQ06GNAZ8XWDN1QM48JEDC6PP6W3YZPZJ";
const RELAYER = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM";
const STX_WHALE = "SP354663MXNWN2B6HKNBYD8JBNJK2ZNBZE764X1RR";
const POX5 = "SP000000000000000000002Q6VF78.pox-5";
// SAFE_BYTES_DIR=deploy-bytes-memofix SAFE_NAME=juice-safe-v9: same scenario on other deploy bytes;
// A is deployed from <dir>/<name>.clar and verified in core-v2, B is a relay copy of
// the same bytes, and both hashes must equal those bytes' sha512/256.
const SAFE_NAME = process.env.SAFE_NAME || "juice-safe-v8";
const A = `${DEPLOYER}.${SAFE_NAME}`;
const B_NAME = `${SAFE_NAME}-user`;
const B = `${FAKFUN_DEPLOYER}.${B_NAME}`;
const HELPERS = `${DEPLOYER}.juice-safe-auth-helpers-v2`;
const POOL = `${DEPLOYER}.juice-pool-stx-signer`;
const CANON_HASH = "b3d74b90efebba24a28e3c8d5101fd7c56208deb1699088f18206565f1c0ba15";
const TEMPLATE = `${process.env.HOME}/projects/faktory-dao/backend/server/utils/juice-safe-v8-template.ts`;
const CLARITY_6 = ClarityVersion.Clarity6 ?? 6;
const STACKS_NODE_API = "http://77.42.3.101/stacks-api";
const RP_ID = "juiceofbtc.com";
const FIRST_BURN = 666050, CYCLE = 2100, PREPARE = 100;

const FUND = 1_000_000_000;
const STAKE = { A: 500_000_000, B: 300_000_000 };
const X = Buffer.from("telegram:@juice_staker", "utf8");
const Y = Buffer.from("telegram:@someone_else", "utf8");
const X_CV = someCV(bufferCV(X)), Y_CV = someCV(bufferCV(Y));

const SIP018 = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const strip = (h) => (h.startsWith("0x") ? h.slice(2) : h);
const cvSha256 = (cv) => { const o = serializeCV(cv); return sha256(Buffer.from(typeof o === "string" ? o : Buffer.from(o).toString("hex"), "hex")); };
const challenge = (wallet, t) => sha256(Buffer.concat([SIP018, cvSha256(tupleCV({
  name: stringAsciiCV("smart-wallet-standard"), version: stringAsciiCV("1.0.0"), "chain-id": uintCV(1), wallet: principalCV(wallet),
})), cvSha256(t)]));
const stakeT = (authId, amt, cd) => tupleCV({ topic: stringAsciiCV("stake-stx-juice-pox5"), "auth-id": uintCV(authId), "amount-ustx": uintCV(amt), "signer-calldata": cd });
const cycleOf = (h) => Math.floor((h - FIRST_BURN) / CYCLE);

async function main() {
  const alt = SAFE_BYTES_DIR ? loadBytes(SAFE_BYTES_DIR, SAFE_NAME) : null;
  const tpl = alt ? alt.s : fs.readFileSync(TEMPLATE, "utf8").match(/JUICE_SAFE_V8_TEMPLATE = `([\s\S]*?)`;/)[1];
  const tplHash = crypto.createHash("sha512-256").update(tpl).digest("hex");
  const WANT_HASH = alt ? alt.h512 : CANON_HASH;
  if (tplHash !== WANT_HASH) throw new Error(`BE template sha512/256 ${tplHash} != canonical ${CANON_HASH}`);
  if (alt) console.log(`${A}: deploy bytes ${SAFE_BYTES_DIR}/${SAFE_NAME}.clar (sha512/256 ${tplHash.slice(0, 12)})`);

  const pox = await (await fetch(`${STACKS_NODE_API}/v2/pox`)).json();
  if (pox.first_burnchain_block_height !== FIRST_BURN || pox.reward_cycle_length !== CYCLE || pox.prepare_phase_block_length !== PREPARE)
    throw new Error("pox timing changed");
  const startBurn = (await (await fetch(`${STACKS_NODE_API}/v2/info`)).json()).burn_block_height;
  const off = (startBurn - FIRST_BURN) % CYCLE;
  const toSafe = off > CYCLE - PREPARE - 150 ? CYCLE - off + 20 : 0;
  console.log(`start burn ${startBurn} (cycle ${cycleOf(startBurn)}, offset ${off}); pre-advance ${toSafe}`);

  const keys = { A: generateP256Keypair(), B: generateP256Keypair() };
  const W = { A, B };
  const sigTuple = (authId, s, pk) => tupleCV({
    "auth-id": uintCV(authId), pubkey: bufferCV(Buffer.from(strip(pk), "hex")),
    signature: bufferCV(Buffer.from(strip(s.signatureHex), "hex")),
    "authenticator-data": bufferCV(Buffer.from(strip(s.authenticatorDataHex), "hex")),
    "client-data-prefix": bufferCV(Buffer.from(strip(s.clientDataPrefixHex), "hex")),
    "client-data-suffix": bufferCV(Buffer.from(strip(s.clientDataSuffixHex), "hex")),
  });

  const plan = [];
  const b = SimulationBuilder.new({ stacksNodeAPI: STACKS_NODE_API });
  const okre = /^\(ok/;
  const step = (label) => plan.push({ kind: "fund", label });
  const evalw = (at, label, code, capture) => { b.addEvalCode(at, code); plan.push({ kind: "eval", label, capture }); };
  const call = (label, sender, cid, fn, args, expect, ev) => {
    b.withSender(sender).addContractCall({ contract_id: cid, function_name: fn, function_args: args, post_condition_mode: PostConditionMode.Allow });
    plan.push({ kind: "tx", label, expect, ev });
  };
  const snap = (k, tag) => evalw(W[k], `${tag} snapshot`, `{ acct: (stx-account '${W[k]}), info: (contract-call? '${POX5} get-staker-info '${W[k]}),
    cyc: (contract-call? '${POX5} current-pox-reward-cycle) }`, tag);

  // -- setup: canonical A onboarded; user copy B deployed from the BE template -------------
  if (alt) {
    b.withSender(DEPLOYER).addContractDeploy({ contract_name: SAFE_NAME, source_code: tpl, clarity_version: CLARITY_6 });
    step(`deploy ${A} (deploy bytes)`);
    call(`core-v2 set-verified-contract(${SAFE_NAME})`, DEPLOYER, `${DEPLOYER}.fakfun-wallet-core-v2`, "set-verified-contract", [principalCV(A), noneCV()], /^\(ok/);
  }
  evalw(A, "A canonical contract-hash? on chain", `(contract-hash? '${A})`, "hashA");
  b.withSender(FAKFUN_DEPLOYER).addContractDeploy({ contract_name: B_NAME, source_code: tpl, clarity_version: CLARITY_6 });
  step(`relay deploys ${B} from the BE template (${Buffer.byteLength(tpl)} bytes)`);
  evalw(B, "B user copy contract-hash?", `(contract-hash? '${B})`, "hashB");
  for (const k of ["A", "B"]) {
    call(`onboard ${k}`, FAKFUN_DEPLOYER, W[k], "onboard",
      [bufferCV(Buffer.from(strip(keys[k].pubKeyHex), "hex")), standardPrincipalCV(OWNER), standardPrincipalCV(RECOVERY),
       uintCV(100_000_000), uintCV(100_000), uintCV(144)], okre);
    b.withSender(STX_WHALE).addSTXTransfer({ recipient: W[k], amount: FUND });
    step(`fund ${k} ${FUND / 1e6} STX`);
  }
  if (toSafe > 0) { b.addAdvanceBlocks({ bitcoin_blocks: toSafe, stacks_blocks_per_bitcoin: 1 }); step(`advance ${toSafe} burn blocks (clear of prepare phase)`); }

  const js = {};
  for (const [k, authId] of [["A", 1], ["B", 3]]) {
    const amt = STAKE[k];
    const xHash = challenge(W[k], stakeT(authId, amt, X_CV));
    js[k] = xHash.toString("hex");
    // the live helpers-v2 builds the same hash when the safe is contract-caller
    evalw(W[k], `${k} helpers-v2 build-stake-stx-juice-pox5-hash (calldata X)`,
      `(contract-call? '${HELPERS} build-stake-stx-juice-pox5-hash { auth-id: u${authId}, amount-ustx: u${amt}, signer-calldata: (some 0x${X.toString("hex")}) })`, `h${k}`);
    const auth = someCV(sigTuple(authId, signChallengeWithRpId(xHash, keys[k].privKey, RP_ID), keys[k].pubKeyHex));
    const stake = (cd) => [uintCV(amt), auth, noneCV(), cd];
    snap(k, `${k}0`);
    call(`${k}1 passkey sig over X, relayer submits calldata Y -> (err u4002)`, RELAYER, W[k], "stake-stx-juice", stake(Y_CV), "(err u4002)", `${k}1`);
    call(`${k}2 passkey sig over X, relayer submits calldata none -> (err u4002)`, RELAYER, W[k], "stake-stx-juice", stake(noneCV()), "(err u4002)", `${k}2`);
    snap(k, `${k}1s`);
    call(`${k}3 passkey sig over X, relayer submits calldata X -> (ok true), pox-5 stake ${amt / 1e6} STX`, RELAYER, W[k], "stake-stx-juice", stake(X_CV), "(ok true)", `${k}3`);
    snap(k, `${k}3s`);
    call(`${k}4 same sig + X replayed -> (err u4006)`, RELAYER, W[k], "stake-stx-juice", stake(X_CV), "(err u4006)", `${k}4`);
  }

  // -- run --------------------------------------------------------------------------------------
  console.log("=== juice-safe-v8 signer-calldata (helpers-v2) - stxer harness ===");
  const sessionId = await b.run();
  const url = `https://stxer.xyz/simulations/mainnet/${sessionId}`;
  console.log(`Submitted: ${url}\n`);
  const res = await getSimulationResult(sessionId);
  const decTx = (s) => {
    const r = s?.Result?.Transaction;
    if (!r) return "<none>";
    if ("Err" in r) return `ENGINE-ERR: ${JSON.stringify(r.Err).slice(0, 220)}`;
    try { return cvToString(deserializeCV(r.Ok.result)); } catch (e) { return `dec-fail: ${e.message}`; }
  };
  const decEval = (s) => {
    const r = s?.Result?.Eval;
    if (!r || !("Ok" in r)) return `<eval:${JSON.stringify(r?.Err ?? "?").slice(0, 160)}>`;
    try { return cvToString(deserializeCV(r.Ok)); } catch { return r.Ok; }
  };
  const prints = (s, cid) => (s?.Result?.Transaction?.Ok?.events ?? []).map((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw))
    .filter((e) => e.type === "contract_event" && e.contract_event?.contract_identifier === cid && e.committed !== false)
    .map((e) => cvToString(deserializeCV(e.contract_event.raw_value)));

  let pass = 0, fail = 0;
  const checks = [], cap = {}, evs = {};
  if (res.steps.length !== plan.length) console.log(`WARN: ${res.steps.length} steps returned, ${plan.length} planned`);
  plan.forEach((p, i) => {
    const s = res.steps[i];
    if (p.kind === "eval") { cap[p.capture] = decEval(s); console.log(`INFO [${i}] ${p.label}: ${String(cap[p.capture]).slice(0, 260)}`); return; }
    const d = decTx(s);
    if (p.ev) evs[p.ev] = { pool: prints(s, POOL), safe: prints(s, W[p.ev[0]]) };
    const ok = p.kind === "fund" ? !!s && !/^ENGINE-ERR|^\(err|^<none>/.test(d) : p.expect instanceof RegExp ? p.expect.test(d) : d === p.expect;
    console.log(`${ok ? "PASS" : "FAIL"} [${i}] ${p.label}\n        got ${d.slice(0, 200)}`);
    ok ? pass++ : fail++;
    checks.push({ label: p.label, actual: d, passed: ok });
  });

  console.log("\n--- state checks ---");
  const chk = (l, cond, actual = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${l}${cond ? "" : `  (${actual})`}`); cond ? pass++ : fail++; checks.push({ label: l, actual: String(actual), passed: !!cond }); };
  const num = (t, f) => BigInt((String(cap[t]).match(new RegExp(`\\(${f} u(\\d+)\\)`)) || [])[1] ?? "-1");
  const cyc = (t) => BigInt((String(cap[t]).match(/\(cyc u(\d+)\)/) || [])[1] ?? "-1");
  const xHex = `0x${X.toString("hex")}`;
  chk(`A canonical on-chain hash = ${WANT_HASH.slice(0, 12)}`, String(cap.hashA) === `(ok 0x${WANT_HASH})`, cap.hashA);
  chk(`B user copy (${alt ? "same deploy bytes" : "BE template"}) hash = canonical`, String(cap.hashB) === `(ok 0x${WANT_HASH})`, cap.hashB);
  for (const k of ["A", "B"]) {
    const amt = BigInt(STAKE[k]);
    chk(`${k} live helpers-v2 hash over X = JS challenge signed by the passkey`, String(cap[`h${k}`]) === `0x${js[k]}`, `${cap[`h${k}`]} vs 0x${js[k]}`);
    chk(`${k}0 nothing staked before`, num(`${k}0`, "locked") === 0n && /\(info none\)/.test(cap[`${k}0`]), cap[`${k}0`]);
    for (const r of ["1", "2"])
      chk(`${k}${r} rejected call printed nothing (pool, safe)`, (evs[`${k}${r}`]?.pool ?? []).length === 0 && (evs[`${k}${r}`]?.safe ?? []).length === 0, JSON.stringify(evs[`${k}${r}`]));
    chk(`${k}1s still nothing staked after Y / none`, num(`${k}1s`, "locked") === 0n && /\(info none\)/.test(cap[`${k}1s`]), cap[`${k}1s`]);
    const s3 = `${k}3s`;
    chk(`${k}3 pox-5 locked exactly ${amt} for 96 cycles from next cycle, unlocked = fund - stake`,
      num(s3, "locked") === amt && num(s3, "amount-ustx") === amt && num(s3, "num-cycles") === 96n
      && num(s3, "first-reward-cycle") === cyc(s3) + 1n && num(s3, "unlocked") === BigInt(FUND) - amt, cap[s3]);
    chk(`${k}3 staker-info names juice-pool-stx-signer`, String(cap[s3]).includes(POOL), cap[s3]);
    const vs = (evs[`${k}3`]?.pool ?? []).filter((x) => /\(topic "validate-stake"\)/.test(x));
    chk(`${k}3 pool validate-stake print carries X, staker = safe, amount = stake`,
      vs.length === 1 && vs[0].includes(`(signer-calldata (some ${xHex}))`) && vs[0].includes(`(staker ${W[k]})`) && vs[0].includes(`(amount-ustx u${amt})`),
      JSON.stringify(evs[`${k}3`]?.pool));
    chk(`${k}3 safe stake-stx-juice print carries X`,
      (evs[`${k}3`]?.safe ?? []).some((x) => x.includes(`(event "stake-stx-juice")`) && x.includes(`(signer-calldata (some ${xHex}))`)), JSON.stringify(evs[`${k}3`]?.safe));
  }

  const total = pass + fail;
  console.log(`\n=== ${pass} passed, ${fail} failed (${total}) ===\nView: ${url}`);
  fs.mkdirSync("fixtures", { recursive: true });
  fs.writeFileSync(`fixtures/simul-juice-safe-v8-signer-calldata${alt ? `-${SAFE_NAME}${bytesTag()}` : ""}-result.json`, JSON.stringify({
    simulation: url, passed: pass, total, startBurn,
    sources: { [A]: alt ? `${SAFE_BYTES_DIR}/${SAFE_NAME}.clar` : "live canonical", [B]: { form: alt ? "same deploy bytes" : "faktory-dao juice-safe-v8-template.ts", bytes: Buffer.byteLength(tpl), sha512_256: tplHash, clarity: 6 } },
    checks,
  }, null, 1) + "\n");
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
