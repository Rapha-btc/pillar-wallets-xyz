// dialer.mjs -- rv dialers for the juice-autostake-safe INVARIANT runs.
//
// PRE  (passkey injection): rv cannot produce P-256 WebAuthn signatures, so on
//      a share of calls to a sig-auth function this replaces the fuzzed sig-auth
//      with a VALID one from the onboarded test passkey (keys.mjs) over the exact
//      SIP-018 message the safe will rebuild -- or with a REPLAY of an earlier
//      successful call (same args, same signature). It also nudges arguments
//      rv cannot hit by chance (asset names, live op-ids, legal cooldowns).
//      State-derived messages (confirm-max-gas, set-wallet-config,
//      confirm-transfer-wallet) are signed over values tracked from successful
//      propose/signal calls -- the only writers of those slots.
// POST (oracle, successful calls only): asset events must match the call.
//   O1 every asset leaving the safe is justified by the function and its
//      arguments (or a tracked pending op); restake/stake/config calls move none
//   O2 gas: at most one sBTC payment to a gas station per call, <= max-gas
//   O3 a replayed passkey signature never succeeds
//   O4 with the token lock on, no lock-gated passkey call succeeds
//   O5 a pending op pays at most once, never after a veto, and a
//      passkey-created op never pays through an execute-*-now
// A violated oracle throws, which rv reports as a failed run.
//
// Deterministic: a seeded PRNG (DIAL_SEED, default 1) drives every choice, so
// an rv seed + DIAL_SEED replays the same run. DIAL_LOG=<file> writes one JSON
// line per injected call.
import crypto from "node:crypto";
import fs from "node:fs";
import { Cl } from "@stacks/transactions";
const cvToString = (cv) => Cl.prettyPrint(cv);
import { signChallengeWithRpId } from "../../../lib-webauthn-test-signer.mjs";
import { WALLET, CHAIN_ID, RP_ID, SIP018, PASSKEY_PRIV, PASSKEY_PUB, cvHash } from "./keys.mjs";

const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const [WADDR, WNAME] = WALLET.split(".");
const SBTC = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const PLACEHOLDER = "SP000000000000000000002Q6VF78";

// --- seeded PRNG (mulberry32) ----------------------------------------------
let seed = Number(process.env.DIAL_SEED ?? 1) >>> 0;
function rnd() {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];

// --- tracked contract state (exact: only these calls write these slots) ------
const st = {
  authId: 1,
  maxGas: 1000n,
  pendingMaxGas: 0n,
  pendingConfig: { stx: 0n, sbtc: 0n, cd: 0n },
  pendingTransfer: PLACEHOLDER,
  owner: "ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5", // wallet_1, onboarded by the plan
  lock: false,
  ops: new Map(), // id -> { type, amount, recipient, fee, passkey, executed, vetoed }
  nfts: new Set([1n]), // zz-nft ids held by the safe (the plan mints #1)
  lastOk: new Map(), // fn -> args of the last successful VALID passkey call
};
const stats = { valid: {}, replay: {}, okValid: {}, okPlain: {}, f1Signed: 0, f1Ok: 0 };
const bump = (m, k) => (m[k] = (m[k] ?? 0) + 1);

// --- SIP-018 hashing, mirroring the helper contracts --------------------------
const DOMAIN = cvHash(Cl.tuple({
  name: Cl.stringAscii("smart-wallet-standard"), version: Cl.stringAscii("1.0.0"),
  "chain-id": Cl.uint(CHAIN_ID), wallet: Cl.contractPrincipal(WADDR, WNAME),
}));
function msgHash(topic, fields) {
  return sha256(Buffer.concat([SIP018, DOMAIN, cvHash(Cl.tuple({ topic: Cl.stringAscii(topic), ...fields }))]));
}
function sigAuth(authId, hash) {
  const s = signChallengeWithRpId(hash, PASSKEY_PRIV, RP_ID);
  const b = (h) => Cl.bufferFromHex(h.replace(/^0x/, ""));
  return Cl.tuple({
    "auth-id": Cl.uint(authId), pubkey: Cl.buffer(PASSKEY_PUB), signature: b(s.signatureHex),
    "authenticator-data": b(s.authenticatorDataHex), "client-data-prefix": b(s.clientDataPrefixHex),
    "client-data-suffix": b(s.clientDataSuffixHex),
  });
}

// --- per-function spec: sig index, optional?, lock-gated?, message ------------
const u = (cv) => BigInt(cv.value);
const SPEC = {
  "stx-transfer": { i: 3, opt: true, lock: true,
    m: (a, id) => msgHash("stx-transfer", { "auth-id": Cl.uint(id), amount: a[0], recipient: a[1], memo: a[2] }) },
  "sip010-transfer": { i: 5, opt: true, lock: true,
    m: (a, id) => msgHash("sip010-transfer", { "auth-id": Cl.uint(id), amount: a[0], recipient: a[1], memo: a[2], sip010: a[3] }) },
  "sip009-transfer": { i: 4, opt: true, lock: true,
    m: (a, id) => msgHash("sip009-transfer", { "auth-id": Cl.uint(id), "nft-id": a[0], recipient: a[1], sip009: a[2] }) },
  "sbtc-initiate-withdrawal": { i: 3, opt: true, lock: true,
    m: (a, id) => msgHash("sbtc-withdrawal", { "auth-id": Cl.uint(id), amount: a[0], recipient: a[1], "max-fee": a[2] }) },
  "stake-stx-juice": { i: 1, opt: true, lock: true,
    m: (a, id) => msgHash("stake-stx-juice-pox5", { "auth-id": Cl.uint(id), "amount-ustx": a[0] }) },
  "update-stake-stx-juice": { i: 2, opt: true, lock: true,
    m: (a, id) => msgHash("update-stake-stx-juice", { "auth-id": Cl.uint(id), "amount-increase": a[0], "cycles-to-extend": a[1] }) },
  unstake: { i: 0, opt: true, lock: true,
    m: (a, id) => msgHash("unstake-stx-juice", { "auth-id": Cl.uint(id) }) },
  "set-keeper": { i: 1, opt: true, lock: true,
    m: (a, id) => msgHash("set-keeper", { "auth-id": Cl.uint(id), keeper: a[0] }) },
  "toggle-token-lock": { i: 1, opt: true, lock: false,
    m: (a, id) => msgHash("toggle-token-lock", { "auth-id": Cl.uint(id), enabled: a[0] }) },
  "veto-operation": { i: 1, opt: true, lock: false,
    m: (a, id) => msgHash("veto-operation", { "auth-id": Cl.uint(id), "op-id": a[0] }) },
  "propose-recovery": { i: 1, opt: false, lock: false,
    m: (a, id) => msgHash("propose-recovery", { "auth-id": Cl.uint(id), "new-recovery": a[0] }) },
  "confirm-transfer-wallet": { i: 0, opt: false, lock: false,
    m: (a, id) => msgHash("confirm-transfer", { "auth-id": Cl.uint(id), "new-admin": Cl.principal(st.pendingTransfer) }) },
  "confirm-max-gas-amount": { i: 0, opt: false, lock: false,
    m: (a, id) => msgHash("confirm-max-gas-amount", { "auth-id": Cl.uint(id), amount: Cl.uint(st.pendingMaxGas) }) },
  "set-wallet-config": { i: 0, opt: false, lock: false,
    m: (a, id) => msgHash("set-wallet-config", { "auth-id": Cl.uint(id), "stx-threshold": Cl.uint(st.pendingConfig.stx),
      "sbtc-threshold": Cl.uint(st.pendingConfig.sbtc), "cooldown-period": Cl.uint(st.pendingConfig.cd) }) },
  "execute-pending-stx-transfer-now": { i: 2, opt: false, lock: true,
    m: (a, id) => msgHash("execute-now", { "auth-id": Cl.uint(id), "op-id": a[0] }) },
  "execute-pending-sbtc-transfer-now": { i: 2, opt: false, lock: true,
    m: (a, id) => msgHash("execute-now", { "auth-id": Cl.uint(id), "op-id": a[0] }) },
  "execute-pending-sbtc-withdrawal-now": { i: 1, opt: false, lock: true,
    m: (a, id) => msgHash("execute-now", { "auth-id": Cl.uint(id), "op-id": a[0] }) },
};
const OP_TYPE = {
  "execute-pending-stx-transfer": "stx-transfer", "execute-pending-stx-transfer-now": "stx-transfer",
  "execute-pending-sbtc-transfer": "sbtc-transfer", "execute-pending-sbtc-transfer-now": "sbtc-transfer",
  "execute-pending-sbtc-withdrawal": "sbtc-withdraw", "execute-pending-sbtc-withdrawal-now": "sbtc-withdraw",
};

// per-call scratch shared between pre and post
let cur = null;

function nudge(fn, a) {
  if (fn === "sip010-transfer") {
    if (rnd() < 0.5) { a[3] = Cl.contractPrincipal(...SBTC.split(".")); a[4] = Cl.stringAscii("sbtc-token"); }
    else if (rnd() < 0.9) a[4] = Cl.stringAscii("zz-ft");
  } else if (fn === "sip009-transfer") {
    if (rnd() < 0.9) a[3] = Cl.stringAscii("zz-nft");
    if (st.nfts.size && rnd() < 0.8) a[0] = Cl.uint(pick([...st.nfts]));
  } else if (fn === "sbtc-initiate-withdrawal") {
    if (rnd() < 0.8) {
      a[0] = Cl.uint(547n + (u(a[0]) % 200000n));
      a[1] = Cl.tuple({ version: Cl.bufferFromHex("00"), hashbytes: Cl.bufferFromHex("11".repeat(20)) });
      a[2] = Cl.uint(u(a[2]) % 5000n);
    }
  } else if (fn === "update-stake-stx-juice") {
    if (rnd() < 0.7) a[1] = Cl.uint(u(a[1]) % 4n);
  } else if (fn === "signal-config-change") {
    if (rnd() < 0.8) a[2] = Cl.uint(144n + (u(a[2]) % 3889n));
  } else if (fn === "propose-max-gas-amount") {
    if (rnd() < 0.8) a[0] = Cl.uint(u(a[0]) % 10001n);
  } else if (fn === "veto-operation") {
    if (st.ops.size && rnd() < 0.8) a[0] = Cl.uint(pick([...st.ops.keys()]));
  } else if (OP_TYPE[fn]) {
    const ids = [...st.ops].filter(([, o]) => o.type === OP_TYPE[fn]).map(([id]) => id);
    if (ids.length && rnd() < 0.85) a[0] = Cl.uint(pick(ids));
  }
}

export function preInject({ selectedFunction, clarityValueArguments: a }) {
  const fn = selectedFunction.name;
  cur = { fn, kind: "plain", lockAtCall: st.lock, sigSome: false, args: null };
  nudge(fn, a);
  const spec = SPEC[fn];
  // toggle-token-lock only reads sig-auth when enabling; a "passkey" call that
  // disables runs the admin path, so it is neither injected nor replayed
  // KNOWN FINDING RV-F1 (../README.md): confirming a pending transfer that
  // names the current owner empties the admin set. Once found, the default run
  // stops signing that one message so every other invariant stays meaningful;
  // RV_ALLOW_F1=1 lets the fuzzer reach it again.
  const f1 = fn === "confirm-transfer-wallet" && st.pendingTransfer === st.owner && !process.env.RV_ALLOW_F1;
  if (spec && !f1 && !(fn === "toggle-token-lock" && a[0].type !== "true")) {
    const r = rnd();
    const last = st.lastOk.get(fn);
    if (last && r < 0.1) {
      for (let k = 0; k < a.length; k++) a[k] = last[k];
      cur.kind = "replay";
      bump(stats.replay, fn);
    } else if (r < (spec.opt ? 0.6 : 0.85)) {
      const id = st.authId++;
      const sa = sigAuth(id, spec.m(a, id));
      a[spec.i] = spec.opt ? Cl.some(sa) : sa;
      cur.kind = "valid";
      bump(stats.valid, fn);
      // RV_ALLOW_F1=1 only: a valid passkey confirm of a transfer naming the
      // current owner (fixed in 7724b0d: must be refused, f1Ok stays 0)
      if (fn === "confirm-transfer-wallet" && st.pendingTransfer === st.owner) { cur.f1 = true; stats.f1Signed++; }
    }
    cur.sigSome = spec.opt ? a[spec.i].type === "some" : true;
  }
  cur.args = [...a];
  if (process.env.DIAL_LOG && cur.kind !== "plain") {
    fs.appendFileSync(process.env.DIAL_LOG, JSON.stringify({ fn, kind: cur.kind,
      args: a.map((cv) => cvToString(cv)) }) + "\n");
  }
}

// --- post: the oracle -------------------------------------------------------
function fail(msg) {
  throw new Error(`[dialer oracle] ${cur.fn}: ${msg} | args=${cur.args.map((cv) => cvToString(cv)).join(" ")}`);
}
const isGasStation = (p) => /\.zz-gas-/.test(p);
const assetOf = (id) => id.split("::")[0];

export function postOracle({ selectedFunction, functionCall, clarityValueArguments }) {
  const fn = selectedFunction.name;
  if (!cur || cur.fn !== fn) return;
  const a = cur.args;
  const evs = functionCall.events ?? [];
  if (cur.kind === "valid") bump(stats.okValid, fn); else bump(stats.okPlain, fn);
  if (cur.f1) stats.f1Ok++;

  // O3 replay
  if (cur.kind === "replay") fail("a replayed passkey signature was accepted");
  // O4 token lock
  const spec = SPEC[fn];
  if (spec && spec.lock && cur.lockAtCall && cur.sigSome) fail("lock-gated passkey call succeeded with the token lock on");

  // collect asset events with the safe as sender
  // (the safe's own `ect` token is minted and burned in place by
  // confirm-transfer-wallet as a lock probe; it is not an asset of the owner)
  const out = evs.filter((e) => e.data && e.data.sender === WALLET &&
    /^(stx|ft|nft)_(transfer|burn)_event$/.test(e.event) &&
    e.data.asset_identifier !== `${WALLET}::ect`);
  // O2 gas
  const gas = out.filter((e) => e.event === "ft_transfer_event" && isGasStation(e.data.recipient));
  if (gas.length > 1) fail(`${gas.length} gas payments in one call`);
  for (const g of gas) {
    if (assetOf(g.data.asset_identifier) !== SBTC) fail(`gas paid in ${g.data.asset_identifier}`);
    if (BigInt(g.data.amount) > st.maxGas) fail(`gas ${g.data.amount} > max-gas ${st.maxGas}`);
  }
  const rest = out.filter((e) => !gas.includes(e));
  const created = evs.filter((e) => e.event === "print_event" && cvToString(e.data.value).includes('event: "pending-operation-created"'));

  const one = (pred, why) => {
    if (rest.length !== 1 || !pred(rest[0])) fail(`${why}; outgoing=${JSON.stringify(rest.map((e) => [e.event, e.data]))}`);
  };
  const opCheck = (now) => {
    const id = u(a[0]);
    const op = st.ops.get(id);
    if (!op) fail(`executed op ${id} unknown to the tracker`);
    if (op.executed) fail(`op ${id} paid twice`);
    if (op.vetoed) fail(`vetoed op ${id} paid`);
    if (now && op.passkey) fail(`passkey-created op ${id} paid through execute-now`);
    op.executed = true;
    return op;
  };

  switch (fn) {
    case "stx-transfer":
      if (created.length) { if (rest.length) fail("queued AND paid"); }
      else one((e) => e.event === "stx_transfer_event" && BigInt(e.data.amount) === u(a[0]) &&
        e.data.recipient === cvToString(a[1]).replace(/^'/, ""), "immediate STX send must move exactly amount to recipient");
      break;
    case "sip010-transfer": {
      const tok = cvToString(a[3]).replace(/^'/, "");
      if (created.length) { if (rest.length) fail("queued AND paid"); if (tok !== SBTC) fail("non-sBTC transfer queued"); }
      else one((e) => e.event === "ft_transfer_event" && assetOf(e.data.asset_identifier) === tok &&
        BigInt(e.data.amount) === u(a[0]) && e.data.recipient === cvToString(a[1]).replace(/^'/, ""),
        "SIP-010 send must move exactly amount of that token to recipient");
      break;
    }
    case "sip009-transfer":
      one((e) => e.event === "nft_transfer_event" && e.data.recipient === cvToString(a[1]).replace(/^'/, ""),
        "NFT send must move one NFT to recipient");
      st.nfts.delete(u(a[0]));
      break;
    case "sbtc-initiate-withdrawal":
      if (created.length) { if (rest.length) fail("queued AND paid"); }
      else one((e) => e.event === "ft_burn_event" && assetOf(e.data.asset_identifier) === SBTC &&
        BigInt(e.data.amount) === u(a[0]) + u(a[2]), "withdrawal must lock exactly amount + max-fee");
      break;
    case "execute-pending-stx-transfer": case "execute-pending-stx-transfer-now": {
      const op = opCheck(fn.endsWith("-now"));
      one((e) => e.event === "stx_transfer_event" && BigInt(e.data.amount) === op.amount && e.data.recipient === op.recipient,
        "op must pay exactly its amount to its recipient");
      break;
    }
    case "execute-pending-sbtc-transfer": case "execute-pending-sbtc-transfer-now": {
      const op = opCheck(fn.endsWith("-now"));
      one((e) => e.event === "ft_transfer_event" && assetOf(e.data.asset_identifier) === SBTC &&
        BigInt(e.data.amount) === op.amount && e.data.recipient === op.recipient, "op must pay exactly its amount");
      break;
    }
    case "execute-pending-sbtc-withdrawal": case "execute-pending-sbtc-withdrawal-now": {
      const op = opCheck(fn.endsWith("-now"));
      one((e) => e.event === "ft_burn_event" && BigInt(e.data.amount) === op.amount + op.fee,
        "withdrawal op must lock exactly amount + max-fee");
      break;
    }
    default:
      if (rest.length) fail(`moved assets out: ${JSON.stringify(rest.map((e) => [e.event, e.data]))}`);
  }

  // --- track state from this successful call ---
  for (const c of created) {
    const s = cvToString(c.data.value);
    const id = BigInt(s.match(/op-id: u(\d+)/)[1]);
    const type = s.match(/op-type: "([^"]+)"/)[1];
    const amount = BigInt(s.match(/amount: u(\d+)/)[1]);
    const recipient = s.match(/recipient: '([^ ,})]+)/)[1];
    st.ops.set(id, { type, amount, recipient, fee: fn === "sbtc-initiate-withdrawal" ? u(a[2]) : 0n,
      passkey: cur.sigSome, executed: false, vetoed: false });
  }
  if (cur.kind === "valid") st.lastOk.set(fn, a);
  switch (fn) {
    case "propose-max-gas-amount": st.pendingMaxGas = u(a[0]); break;
    case "confirm-max-gas-amount": st.maxGas = st.pendingMaxGas; st.pendingMaxGas = 0n; break;
    case "signal-config-change": st.pendingConfig = { stx: u(a[0]), sbtc: u(a[1]), cd: u(a[2]) }; break;
    case "set-wallet-config": st.pendingConfig = { stx: 0n, sbtc: 0n, cd: 0n }; break;
    case "propose-transfer-wallet": st.pendingTransfer = cvToString(a[0]).replace(/^'/, ""); break;
    case "confirm-transfer-wallet": st.owner = st.pendingTransfer; st.pendingTransfer = PLACEHOLDER; break;
    case "recover-inactive-wallet": st.owner = cvToString(a[0]).replace(/^'/, ""); break;
    case "toggle-token-lock": st.lock = a[0].type === "true"; break;
    case "veto-operation": { const op = st.ops.get(u(a[0])); if (op) op.vetoed = true; break; }
    case "rv-fund-nft": st.nfts.add(BigInt(cvToString(functionCall.result).match(/u(\d+)/)[1])); break;
  }
}

process.on("exit", () => {
  const f = process.env.DIAL_STATS;
  const body = JSON.stringify({ ...stats, opsTracked: st.ops.size,
    opsExecuted: [...st.ops.values()].filter((o) => o.executed).length,
    opsVetoed: [...st.ops.values()].filter((o) => o.vetoed).length, maxGas: String(st.maxGas) }, null, 1);
  if (f) fs.writeFileSync(f, body);
});
