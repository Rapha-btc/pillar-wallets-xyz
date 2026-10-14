// simul-juice-autostake-safe-stake-passkey.js
// Stxer mainnet-fork harness for the PASSKEY arms (sig-auth some) of
// juice-autostake-safe stake-stx-juice, update-stake-stx-juice and unstake,
// each with gas none and with the gas station, plus the token-lock refusal
// (u4023) and the zero-amount refusals (u4026). Real pox-5 locks into the real
// SPV9K21....juice-pool-sbtc-signer.
//
// Deploy bytes: the Jing stack, trait-v2, autoswap, juice-pool-sbtc-signer,
// the helper (Clarity 4) and the safe (Clarity 6) are deployed from
// jing-contracts-v3/simulations/deploy-bytes-mv7dfb/ unchanged (sha256 checked
// against SHA256SUMS.txt). The pool registers with pox-5 (real grant), as
// REAL_POOL=1 does in simul-juice-autostake-safe.js.
//
// Two safes, one stake position each (pox-5 allows one per staker):
//   A  SPV9K21....juice-autostake-safe (canonical): lock on -> passkey stake /
//      update / unstake refused u4023; lock off; owner stake 0 -> u4026;
//      passkey stake (no gas); owner update 0/0 -> u4026; passkey update +100
//      STX (gas); passkey update +50 STX (no gas); replayed update sig -> u4006;
//      passkey unstake (gas)
//   B  SP28MP....bob-autostake-safe (relay user copy, same bytes, onboarded on
//      the canonical hash, own passkey): passkey stake (gas); passkey unstake
//      (no gas)
// signer-calldata: A8 (stake) and A10 (update) pass (some "telegram"), A11
// and B2 pass none; the pool's validate-stake! print must carry exactly that,
// for pox-5 stake and stake-update alike, and so must the safe's own print.
// Message hashes: SPV9K21....juice-safe-auth-helpers-v1 (live) builders
// build-stake-stx-juice-pox5-hash / build-update-stake-stx-juice-hash /
// build-unstake-stx-juice-hash, mirrored below.
//
// Run: node --import ~/projects/jing-contracts-v3/simulations/_use-deploy-bytes.mjs simul-juice-autostake-safe-stake-passkey.js
//   (the preload is optional: the harness reads the deploy-bytes files directly)
import crypto from "node:crypto";
import fs from "node:fs";
import {
  tupleCV,
  uintCV,
  bufferCV,
  noneCV,
  someCV,
  trueCV,
  falseCV,
  principalCV,
  standardPrincipalCV,
  contractPrincipalCV,
  stringAsciiCV,
  serializeCV,
  deserializeCV,
  cvToString,
  ClarityVersion,
  PostConditionMode,
  randomPrivateKey,
  privateKeyToPublic,
  signMessageHashRsv,
} from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";
import { generateP256Keypair, signChallengeWithRpId } from "./lib-webauthn-test-signer.mjs";
import { installChunkedSubmit } from "./_chunked-submit.mjs";
installChunkedSubmit(30);

const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const OWNER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2"; // admin + sBTC whale
const RECOVERY = "SP3HXJJMJQ06GNAZ8XWDN1QM48JEDC6PP6W3YZPZJ";
const RELAYER = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM";
const STX_WHALE = "SP354663MXNWN2B6HKNBYD8JBNJK2ZNBZE764X1RR";
const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const POX5 = "SP000000000000000000002Q6VF78.pox-5";
const GAS_STATION = "gas-station";
const WALLET_NAME = "juice-autostake-safe";
const HELPER_NAME = "juice-autostake-safe-auth-helpers-v1";
const A = `${DEPLOYER}.${WALLET_NAME}`;
const B_NAME = "bob-autostake-safe";
const B = `${FAKFUN_DEPLOYER}.${B_NAME}`;
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core-v2`;
const POOL = "juice-pool-sbtc-signer";
const CLARITY_6 = ClarityVersion.Clarity6 ?? 6;
const DB = `${process.env.HOME}/projects/jing-contracts-v3/simulations/deploy-bytes-mv7dfb`;
const STACKS_NODE_API = "http://77.42.3.101/stacks-api";
const RP_ID = "juiceofbtc.com";
const FIRST_BURN = 666050, CYCLE = 2100, PREPARE = 100;

const FUND = 1_000_000_000;     // 1000 STX each
const FUND_SBTC = 5_000;
const STAKE = 500_000_000, INC1 = 100_000_000, INC2 = 50_000_000;
const STAKE_B = 300_000_000;
// signer-calldata (last param of stake-stx-juice / update-stake-stx-juice since
// pillar-wallets 99d69e8): forwarded to pox-5 stake / stake-update, which hands
// it to the pool's validate-stake!, which prints it.
const CALLDATA = "telegram";
const CALLDATA_HEX = Buffer.from(CALLDATA).toString("hex");
const CALLDATA_CV = someCV(bufferCV(Buffer.from(CALLDATA)));

const SIP018_PREFIX = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const cvSha256 = (cv) => {
  const out = serializeCV(cv);
  return sha256(Buffer.from(typeof out === "string" ? out : Buffer.from(out).toString("hex"), "hex"));
};
const challenge = (wallet, t) => sha256(Buffer.concat([SIP018_PREFIX, cvSha256(tupleCV({
  name: stringAsciiCV("smart-wallet-standard"), version: stringAsciiCV("1.0.0"), "chain-id": uintCV(1), wallet: principalCV(wallet),
})), cvSha256(t)]));
const T = {
  stake: (a, amt) => tupleCV({ topic: stringAsciiCV("stake-stx-juice-pox5"), "auth-id": uintCV(a), "amount-ustx": uintCV(amt) }),
  update: (a, inc, ext) => tupleCV({ topic: stringAsciiCV("update-stake-stx-juice"), "auth-id": uintCV(a), "amount-increase": uintCV(inc), "cycles-to-extend": uintCV(ext) }),
  unstake: (a) => tupleCV({ topic: stringAsciiCV("unstake-stx-juice"), "auth-id": uintCV(a) }),
};
const strip = (h) => (h.startsWith("0x") ? h.slice(2) : h);
const cycleOf = (h) => Math.floor((h - FIRST_BURN) / CYCLE);

async function readOnly(cid, fn, args = [], sender) {
  const [addr, name] = cid.split(".");
  const r = await (await fetch(`${STACKS_NODE_API}/v2/contracts/call-read/${addr}/${name}/${fn}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sender: sender || addr, arguments: args.map((c) => "0x" + strip(serializeCV(c))) }),
  })).json();
  return r.result;
}

async function main() {
  const sums = Object.fromEntries(fs.readFileSync(`${DB}/SHA256SUMS.txt`, "utf8").trim().split("\n")
    .map((l) => l.trim().split(/\s+/)).map(([f, , h]) => [f, h]));
  const src = (n) => {
    const s = fs.readFileSync(`${DB}/${n}.clar`, "utf8");
    const h = crypto.createHash("sha256").update(s).digest("hex");
    if (sums[`${n}.clar`] !== h) throw new Error(`${n}: sha256 ${h} != SHA256SUMS (${sums[`${n}.clar`]})`);
    return { s, h };
  };
  const safe = src(WALLET_NAME), helper = src(HELPER_NAME);

  const pox = await (await fetch(`${STACKS_NODE_API}/v2/pox`)).json();
  if (pox.first_burnchain_block_height !== FIRST_BURN || pox.reward_cycle_length !== CYCLE || pox.prepare_phase_block_length !== PREPARE)
    throw new Error("pox timing changed");
  const startBurn = (await (await fetch(`${STACKS_NODE_API}/v2/info`)).json()).burn_block_height;
  const off = (startBurn - FIRST_BURN) % CYCLE;
  // stay clear of the prepare phase: if within 150 blocks of it, move to 20 into the next cycle
  const toSafe = off > CYCLE - PREPARE - 150 ? CYCLE - off + 20 : 0;
  const GAS = BigInt(cvToString(deserializeCV(strip(await readOnly(`${DEPLOYER}.${GAS_STATION}`, "get-gas")))).replace(/^u/, ""));
  console.log(`start burn ${startBurn} (cycle ${cycleOf(startBurn)}, offset ${off}); gas ${GAS} sats; pre-advance ${toSafe}`);

  const keyA = generateP256Keypair(), keyB = generateP256Keypair();
  const sigTuple = (authId, s, pk) => tupleCV({
    "auth-id": uintCV(authId),
    pubkey: bufferCV(Buffer.from(strip(pk), "hex")),
    signature: bufferCV(Buffer.from(strip(s.signatureHex), "hex")),
    "authenticator-data": bufferCV(Buffer.from(strip(s.authenticatorDataHex), "hex")),
    "client-data-prefix": bufferCV(Buffer.from(strip(s.clientDataPrefixHex), "hex")),
    "client-data-suffix": bufferCV(Buffer.from(strip(s.clientDataSuffixHex), "hex")),
  });
  const sAuth = (wallet, key, authId, t) => someCV(sigTuple(authId, signChallengeWithRpId(challenge(wallet, t), key.privKey, RP_ID), key.pubKeyHex));
  const GASCV = someCV(contractPrincipalCV(DEPLOYER, GAS_STATION));

  const plan = [];
  const b = SimulationBuilder.new({ stacksNodeAPI: STACKS_NODE_API });
  const okre = /^\(ok/;
  const step = (label) => plan.push({ kind: "fund", label });
  const evalw = (wallet, label, code, capture) => { b.addEvalCode(wallet, code); plan.push({ kind: "eval", label, capture }); };
  const call = (label, sender, cid, fn, args, expect, capture, ev) => {
    b.withSender(sender).addContractCall({ contract_id: cid, function_name: fn, function_args: args, post_condition_mode: PostConditionMode.Allow });
    plan.push({ kind: "tx", label, expect, capture, ev });
  };
  const snap = (wallet, tag) => evalw(wallet, `${tag} snapshot`, `{ acct: (stx-account '${wallet}), info: (contract-call? '${POX5} get-staker-info '${wallet}),
    cyc: (contract-call? '${POX5} current-pox-reward-cycle), sbtc: (unwrap-panic (contract-call? '${SBTC_TOKEN} get-balance '${wallet})) }`, tag);

  // -- deploys + pool registration ------------------------------------------------------
  for (const [n, v] of [["jing-core-v6", ClarityVersion.Clarity5], ["jing-ladder-v1", ClarityVersion.Clarity5], ["markets-sbtc-stx-jing-v6-3", ClarityVersion.Clarity5],
    ["swap-router-sbtc-stx-jing-v5-3", ClarityVersion.Clarity5], ["juice-swap-vault-trait-v2", CLARITY_6], ["juice-sbtc-autoswap", CLARITY_6], [POOL, CLARITY_6]]) {
    b.withSender(DEPLOYER).addContractDeploy({ contract_name: n, source_code: src(n).s, clarity_version: v });
    step(`deploy ${n} (deploy bytes)`);
  }
  const priv = randomPrivateKey(), skey = privateKeyToPublic(priv);
  const gr = await readOnly("SP000000000000000000002Q6VF78.pox-5", "get-signer-grant-message-hash", [contractPrincipalCV(DEPLOYER, POOL), uintCV(7)], DEPLOYER);
  const ssig = signMessageHashRsv({ messageHash: strip(gr).slice(2 + 8), privateKey: priv });
  call("pool register-self (real pox-5 grant)", DEPLOYER, `${DEPLOYER}.${POOL}`, "register-self",
    [contractPrincipalCV(DEPLOYER, POOL), bufferCV(Buffer.from(strip(skey), "hex")), uintCV(7), bufferCV(Buffer.from(strip(ssig), "hex"))], okre);
  b.withSender(DEPLOYER).addContractDeploy({ contract_name: HELPER_NAME, source_code: helper.s, clarity_version: ClarityVersion.Clarity4 });
  step(`deploy ${HELPER_NAME} (Clarity 4, sha256 ${helper.h.slice(0, 12)})`);
  b.withSender(DEPLOYER).addContractDeploy({ contract_name: WALLET_NAME, source_code: safe.s, clarity_version: CLARITY_6 });
  step(`deploy ${WALLET_NAME} (Clarity 6, sha256 ${safe.h.slice(0, 12)})`);
  call("core-v2 set-verified-contract(safe)", DEPLOYER, WALLET_CORE, "set-verified-contract", [principalCV(A), noneCV()], okre);
  b.withSender(FAKFUN_DEPLOYER).addContractDeploy({ contract_name: B_NAME, source_code: safe.s, clarity_version: CLARITY_6 });
  step(`relay deploys user copy ${B} (same bytes)`);
  const onboard = (w, key) => call(`onboard ${w.split(".")[1]}`, FAKFUN_DEPLOYER, w, "onboard",
    [bufferCV(Buffer.from(strip(key.pubKeyHex), "hex")), standardPrincipalCV(OWNER), standardPrincipalCV(RECOVERY), uintCV(100_000_000), uintCV(100_000), uintCV(144)], okre);
  onboard(A, keyA); onboard(B, keyB);
  for (const w of [A, B]) {
    b.withSender(STX_WHALE).addSTXTransfer({ recipient: w, amount: FUND });
    step(`fund ${w.split(".")[1]} ${FUND / 1e6} STX`);
    call(`fund ${w.split(".")[1]} ${FUND_SBTC} sats (gas)`, OWNER, SBTC_TOKEN, "transfer", [uintCV(FUND_SBTC), standardPrincipalCV(OWNER), principalCV(w), noneCV()], okre);
  }
  if (toSafe > 0) {
    b.addAdvanceBlocks({ bitcoin_blocks: toSafe, stacks_blocks_per_bitcoin: 1 });
    step(`advance ${toSafe} burn blocks (clear of the prepare phase)`);
  }

  // -- A: token lock on -> every passkey staking call refused -------------------------------
  call("A1 owner turns the lock on", OWNER, A, "toggle-token-lock", [trueCV(), noneCV(), noneCV()], okre);
  call("A2 locked: passkey stake -> u4023", RELAYER, A, "stake-stx-juice", [uintCV(STAKE), sAuth(A, keyA, 1, T.stake(1, STAKE)), noneCV(), noneCV()], "(err u4023)");
  call("A3 locked: passkey update -> u4023", RELAYER, A, "update-stake-stx-juice", [uintCV(INC1), uintCV(0), sAuth(A, keyA, 2, T.update(2, INC1, 0)), noneCV(), noneCV()], "(err u4023)");
  call("A4 locked: passkey unstake -> u4023", RELAYER, A, "unstake", [sAuth(A, keyA, 3, T.unstake(3)), noneCV()], "(err u4023)");
  call("A5 owner turns the lock off", OWNER, A, "toggle-token-lock", [falseCV(), noneCV(), noneCV()], okre);
  call("A6 owner stake 0 -> u4026", OWNER, A, "stake-stx-juice", [uintCV(0), noneCV(), noneCV(), noneCV()], "(err u4026)");
  call("A7 passkey stake signed for another amount -> u4002", RELAYER, A, "stake-stx-juice", [uintCV(STAKE), sAuth(A, keyA, 4, T.stake(4, STAKE + 1)), noneCV(), noneCV()], "(err u4002)");
  snap(A, "a0");
  call(`A8 passkey stake ${STAKE / 1e6} STX, no gas, signer-calldata "${CALLDATA}"`, RELAYER, A, "stake-stx-juice", [uintCV(STAKE), sAuth(A, keyA, 5, T.stake(5, STAKE)), noneCV(), CALLDATA_CV], okre, undefined, "A8");
  snap(A, "a1");
  call("A9 owner update 0/0 -> u4026", OWNER, A, "update-stake-stx-juice", [uintCV(0), uintCV(0), noneCV(), noneCV(), noneCV()], "(err u4026)");
  call(`A10 passkey update +${INC1 / 1e6} STX, with gas, signer-calldata "${CALLDATA}"`, RELAYER, A, "update-stake-stx-juice", [uintCV(INC1), uintCV(0), sAuth(A, keyA, 6, T.update(6, INC1, 0)), GASCV, CALLDATA_CV], okre, undefined, "A10");
  snap(A, "a2");
  const upd2 = sAuth(A, keyA, 7, T.update(7, INC2, 0));
  call(`A11 passkey update +${INC2 / 1e6} STX, no gas, signer-calldata none`, RELAYER, A, "update-stake-stx-juice", [uintCV(INC2), uintCV(0), upd2, noneCV(), noneCV()], okre, undefined, "A11");
  snap(A, "a3");
  call("A12 same update signature replayed -> u4006", RELAYER, A, "update-stake-stx-juice", [uintCV(INC2), uintCV(0), upd2, noneCV(), noneCV()], "(err u4006)");
  call("A13 passkey unstake, with gas", RELAYER, A, "unstake", [sAuth(A, keyA, 8, T.unstake(8)), GASCV], okre);
  snap(A, "a4");

  // -- B: the other gas arms ------------------------------------------------------------------
  call("B1 owner turns bob's lock on", OWNER, B, "toggle-token-lock", [trueCV(), noneCV(), noneCV()], okre);
  call("B1 bob locked: passkey stake with gas -> u4023", RELAYER, B, "stake-stx-juice", [uintCV(STAKE_B), sAuth(B, keyB, 1, T.stake(1, STAKE_B)), GASCV, noneCV()], "(err u4023)");
  call("B1 owner turns bob's lock off", OWNER, B, "toggle-token-lock", [falseCV(), noneCV(), noneCV()], okre);
  snap(B, "b0");
  call(`B2 bob passkey stake ${STAKE_B / 1e6} STX, with gas, signer-calldata none`, RELAYER, B, "stake-stx-juice", [uintCV(STAKE_B), sAuth(B, keyB, 2, T.stake(2, STAKE_B)), GASCV, noneCV()], okre, undefined, "B2");
  snap(B, "b1");
  call("B3 bob passkey unstake, no gas", RELAYER, B, "unstake", [sAuth(B, keyB, 3, T.unstake(3)), noneCV()], okre);
  snap(B, "b2");

  // -- run + verify -----------------------------------------------------------------------------
  console.log("=== juice-autostake-safe passkey staking - stxer harness ===");
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
  let pass = 0, fail = 0;
  const checks = [], cap = {}, evs = {};
  const prints = (s, cid) => (s?.Result?.Transaction?.Ok?.events ?? []).map((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw))
    .filter((e) => e.type === "contract_event" && e.contract_event?.contract_identifier === cid && e.committed !== false)
    .map((e) => cvToString(deserializeCV(e.contract_event.raw_value)));
  if (res.steps.length !== plan.length) console.log(`WARN: ${res.steps.length} steps returned, ${plan.length} planned`);
  plan.forEach((p, i) => {
    const s = res.steps[i];
    if (p.kind === "eval") { cap[p.capture] = decEval(s); console.log(`INFO [${i}] ${p.label}: ${String(cap[p.capture]).slice(0, 260)}`); return; }
    const d = decTx(s);
    if (p.ev) evs[p.ev] = { pool: prints(s, `${DEPLOYER}.${POOL}`), safe: prints(s, p.ev.startsWith("B") ? B : A) };
    const ok = p.kind === "fund" ? !!s && !/^ENGINE-ERR|^\(err|^<none>/.test(d) : p.expect instanceof RegExp ? p.expect.test(d) : d === p.expect;
    console.log(`${ok ? "PASS" : "FAIL"} [${i}] ${p.label}\n        got ${d.slice(0, 200)}`);
    ok ? pass++ : fail++;
    checks.push({ label: p.label, actual: d, passed: ok });
  });

  console.log("\n--- state checks ---");
  const chk = (l, cond, actual = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${l}${cond ? "" : `  (${actual})`}`); cond ? pass++ : fail++; checks.push({ label: l, actual: String(actual), passed: !!cond }); };
  const num = (t, f) => BigInt((String(cap[t]).match(new RegExp(`\\(${f} u(\\d+)\\)`)) || [])[1] ?? "-1");
  const unlockCycle = (t) => num(t, "first-reward-cycle") + num(t, "num-cycles");
  const cyc = (t) => BigInt((String(cap[t]).match(/\(cyc u(\d+)\)/) || [])[1] ?? "-1");
  const G = GAS;
  chk("a0 nothing staked before", num("a0", "locked") === 0n && /\(info none\)/.test(cap.a0), cap.a0);
  chk(`A8 passkey stake locked exactly ${STAKE}, 96 cycles, no gas paid`, num("a1", "locked") === BigInt(STAKE) && num("a1", "amount-ustx") === BigInt(STAKE)
    && unlockCycle("a1") === cyc("a1") + 1n + 96n && num("a1", "sbtc") === num("a0", "sbtc"), cap.a1);
  chk(`A10 update +${INC1}: locked ${STAKE + INC1}, gas ${G} paid`, num("a2", "locked") === BigInt(STAKE + INC1) && num("a2", "amount-ustx") === BigInt(STAKE + INC1)
    && num("a1", "sbtc") - num("a2", "sbtc") === G, cap.a2);
  chk(`A11 update +${INC2}: locked ${STAKE + INC1 + INC2}, no gas`, num("a3", "locked") === BigInt(STAKE + INC1 + INC2) && num("a3", "sbtc") === num("a2", "sbtc"), cap.a3);
  chk(`A13 unstake: lock ends next cycle, gas ${G} paid`, unlockCycle("a4") === cyc("a4") + 1n && num("a3", "sbtc") - num("a4", "sbtc") === G
    && num("a4", "locked") + num("a4", "unlocked") === BigInt(FUND), cap.a4);
  chk(`B2 bob passkey stake locked exactly ${STAKE_B}, gas ${G} paid`, num("b1", "locked") === BigInt(STAKE_B) && num("b1", "amount-ustx") === BigInt(STAKE_B)
    && num("b0", "sbtc") - num("b1", "sbtc") === G, cap.b1);
  chk("B3 bob unstake: lock ends next cycle, no gas", unlockCycle("b2") === cyc("b2") + 1n && num("b2", "sbtc") === num("b1", "sbtc"), cap.b2);

  // signer-calldata reaches the pool: pox-5 stake / stake-update -> validate-stake! print
  const vs = (k) => (evs[k]?.pool ?? []).filter((x) => /\(topic "validate-stake"\)/.test(x));
  const cdSome = `(signer-calldata (some 0x${CALLDATA_HEX}))`;
  const cdOk = (k, want, extra = () => true) => {
    const v = vs(k);
    chk(`${k} pool validate-stake print: signer-calldata ${want === "none" ? "none" : `= "${CALLDATA}" (0x${CALLDATA_HEX})`}`,
      v.length === 1 && v[0].includes(want === "none" ? "(signer-calldata none)" : cdSome) && extra(v[0]), JSON.stringify(evs[k]?.pool));
  };
  cdOk("A8", "some", (x) => x.includes(`(amount-ustx u${STAKE})`) && x.includes(`(staker ${A})`));
  cdOk("A10", "some", (x) => x.includes(`(staker ${A})`));
  cdOk("A11", "none");
  cdOk("B2", "none", (x) => x.includes(`(staker ${B})`));
  for (const k of ["A8", "A10"])
    chk(`${k} safe print carries signer-calldata = "${CALLDATA}"`, (evs[k]?.safe ?? []).some((x) => x.includes(cdSome)), JSON.stringify(evs[k]?.safe));
  chk("A11 safe print carries signer-calldata none", (evs.A11?.safe ?? []).some((x) => x.includes("(signer-calldata none)")), JSON.stringify(evs.A11?.safe));

  const total = pass + fail;
  console.log(`\n=== ${pass} passed, ${fail} failed (${total}) ===\nView: ${url}`);
  fs.mkdirSync("fixtures", { recursive: true });
  fs.writeFileSync("fixtures/simul-juice-autostake-safe-stake-passkey-result.json", JSON.stringify({
    simulation: url, passed: pass, total,
    sources: {
      [A]: { form: "deploy-bytes-mv7dfb", bytes: Buffer.byteLength(safe.s), sha256: safe.h, clarity: 6 },
      [B]: { form: "deploy-bytes-mv7dfb", bytes: Buffer.byteLength(safe.s), sha256: safe.h, clarity: 6 },
      [`${DEPLOYER}.${HELPER_NAME}`]: { form: "deploy-bytes-mv7dfb", bytes: Buffer.byteLength(helper.s), sha256: helper.h, clarity: 4 },
    },
    gasSats: String(GAS), startBurn, checks,
  }, null, 1) + "\n");
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
