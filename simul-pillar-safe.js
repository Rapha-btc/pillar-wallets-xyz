// simul-pillar-safe.js
// Stxer mainnet-fork simulation for pillar-safe — the fakfun-wallet-v2 fork
// that drops all faktory/wager/extension code + the 3-step init flow +
// remove-admin-pubkey, and onboards owner + recovery + thresholds in one call.
//
// SELF-SIGNED: a synthetic P-256 test key is onboarded and signs every
// WebAuthn challenge under rp.id "pillarwallets.xyz" (one of pillar-safe's
// three whitelisted domains). No human passkey tap required.
//
// Coverage:
//   A  deploy + set-verified + fund + onboard(pubkey, owner, recovery, thr)
//      -> owner/recovery/thresholds/pubkey-map set exactly
//   B  stx-transfer under threshold, admin path (owner, no sig)   -> executes
//   C  stx-transfer under threshold, PASSKEY path (rp pillarwallets.xyz) -> executes
//      (proves the new rp-id whitelist verifies on-chain)
//   D  stx-transfer OVER threshold -> pending-op created; execute after cooldown
//   E  sip010 (sBTC) transfer under threshold, passkey path
//   F  sbtc-withdrawal under threshold, passkey path (auth-helpers-v8 hash)
//   G  admin-pubkey rotate: propose (admin) -> cooldown -> confirm (admin)
//   H  transfer-wallet ESCAPE: propose (admin) -> confirm (PASSKEY) -> owner flips
//   I  NEGATIVE: remove-admin-pubkey is GONE (call -> error)
//   J  NEGATIVE: wrong rp-id ("fak.fun") sig -> err-invalid-signature (u4002)
//
// Run: node simul-pillar-safe.js
import fs from "node:fs";
import crypto from "node:crypto";
import {
  ClarityVersion,
  tupleCV,
  uintCV,
  bufferCV,
  noneCV,
  someCV,
  trueCV,
  principalCV,
  standardPrincipalCV,
  contractPrincipalCV,
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

// ── Actors ───────────────────────────────────────────────────────────────
const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22"; // deploys wallet + core admin
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK"; // gates onboard()
const OWNER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2"; // wallet owner (admin), has sBTC
const RECOVERY = "SP3HXJJMJQ06GNAZ8XWDN1QM48JEDC6PP6W3YZPZJ"; // recovery address
const NEW_OWNER = "SP1MGH8BH1KRY49Z7EE5TY0JVKT6C3NT9RTVM8FND"; // transfer target
const RECIPIENT = "SP22WH53NS94VR6N145ZX77BK4S0EWFBE41VW3Z6B"; // transfer sink (valid)
const RELAYER = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM"; // broadcasts gasless passkey txs

const WALLET_NAME = "pillar-safe";
const WALLET = `${DEPLOYER}.${WALLET_NAME}`;
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core`;
const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";

const RP_ID = "pillarwallets.xyz"; // whitelisted in pillar-safe
const RP_ID_WRONG = "fak.fun"; // NOT whitelisted → negative test

// Thresholds set at onboard
const STX_THRESHOLD = 100_000_000; // 100 STX
const SBTC_THRESHOLD = 100_000; // 100k sats
// cooldown-period defaults to u144 (set inside onboard)
const PUBKEY_COOLDOWN = 432; // pillar-safe default pubkey-cooldown-period

// Amounts
const STX_UNDER = 10_000_000; // 10 STX (< threshold)
const STX_OVER = 150_000_000; // 150 STX (> threshold) → pending
const SBTC_UNDER = 10_000; // 10k sats (< threshold)
const WD_AMOUNT = 5_000; // sbtc withdraw
const WD_MAXFEE = 1_000;

// ── SIP-018 challenge builder (mirrors auth-helpers-v7/v8 on-chain) ─────────
const SIP018_PREFIX = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();

function getDomainHash(walletPrincipal) {
  const domain = tupleCV({
    name: stringAsciiCV("smart-wallet-standard"),
    version: stringAsciiCV("1.0.0"),
    "chain-id": uintCV(1),
    wallet: principalCV(walletPrincipal),
  });
  return sha256(Buffer.from(serializeCV(domain), "hex"));
}
function buildChallenge(topicTuple) {
  const msgHash = sha256(Buffer.from(serializeCV(topicTuple), "hex"));
  return sha256(Buffer.concat([SIP018_PREFIX, getDomainHash(WALLET), msgHash]));
}

// topic tuples ---------------------------------------------------------------
const memoNone = noneCV();
const tStxTransfer = (authId, amount, recipient) =>
  tupleCV({
    topic: stringAsciiCV("stx-transfer"),
    "auth-id": uintCV(authId),
    amount: uintCV(amount),
    recipient: standardPrincipalCV(recipient),
    memo: memoNone,
  });
const tSip010 = (authId, amount, recipient, sip010) =>
  tupleCV({
    topic: stringAsciiCV("sip010-transfer"),
    "auth-id": uintCV(authId),
    amount: uintCV(amount),
    recipient: standardPrincipalCV(recipient),
    memo: memoNone,
    sip010: principalCV(sip010),
  });
const tSbtcWithdraw = (authId, amount, recipient, maxFee) =>
  tupleCV({
    topic: stringAsciiCV("sbtc-withdrawal"),
    "auth-id": uintCV(authId),
    amount: uintCV(amount),
    recipient,
    "max-fee": uintCV(maxFee),
  });
const tConfirmTransfer = (authId, newAdmin) =>
  tupleCV({
    topic: stringAsciiCV("confirm-transfer"),
    "auth-id": uintCV(authId),
    "new-admin": standardPrincipalCV(newAdmin),
  });

// sig-auth tuple from a signChallengeWithRpId result --------------------------
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

// withdrawal recipient (p2tr: version 0x06 + 32-byte hashbytes — valid shape)
const WD_RECIP = tupleCV({
  version: bufferCV(Buffer.from([0x06])),
  hashbytes: bufferCV(Buffer.alloc(32, 0x11)),
});

async function main() {
  const key = generateP256Keypair();
  const pubkeyCV = bufferCV(key.pubKey);

  // Pre-sign every passkey challenge (rp pillarwallets.xyz), one wrong-rp too.
  const sC = buildChallenge(tStxTransfer(1, STX_UNDER, RECIPIENT));
  const sSbtc = buildChallenge(tSip010(2, SBTC_UNDER, RECIPIENT, SBTC_TOKEN));
  const sWd = buildChallenge(tSbtcWithdraw(3, WD_AMOUNT, WD_RECIP, WD_MAXFEE));
  const sXfer = buildChallenge(tConfirmTransfer(4, NEW_OWNER));
  const sWrong = buildChallenge(tStxTransfer(5, STX_UNDER, RECIPIENT));

  const sigC = signChallengeWithRpId(sC, key.privKey, RP_ID);
  const sigSbtc = signChallengeWithRpId(sSbtc, key.privKey, RP_ID);
  const sigWd = signChallengeWithRpId(sWd, key.privKey, RP_ID);
  const sigXfer = signChallengeWithRpId(sXfer, key.privKey, RP_ID);
  const sigWrong = signChallengeWithRpId(sWrong, key.privKey, RP_ID_WRONG);

  const walletSource = fs.readFileSync("./contracts/pillar-safe.clar", "utf8");

  const plan = [];
  const b = SimulationBuilder.new();
  const evalc = (label, code, capture) => {
    b.addEvalCode(WALLET, code);
    plan.push({ kind: "eval", label, capture });
  };
  const call = (label, sender, cid, fn, args, expect, capture) => {
    b.withSender(sender).addContractCall({
      contract_id: cid, function_name: fn, function_args: args,
      post_condition_mode: PostConditionMode.Allow,
    });
    plan.push({ kind: "tx", label, expect, capture });
  };

  // ── A: deploy + verify + fund + onboard ──────────────────────────────────
  b.withSender(DEPLOYER).addContractDeploy({
    contract_name: WALLET_NAME, source_code: walletSource,
    clarity_version: ClarityVersion.Clarity5,
  });
  plan.push({ kind: "deploy", label: "deploy pillar-safe (C5)" });

  call("set-verified-contract(pillar-safe)", DEPLOYER, WALLET_CORE,
    "set-verified-contract", [principalCV(WALLET), noneCV()], /^\(ok/);

  // fund the wallet: 1000 STX from DEPLOYER, 500k sats sBTC from OWNER
  b.withSender(DEPLOYER).addSTXTransfer({ recipient: WALLET, amount: 400_000_000 });
  plan.push({ kind: "fund", label: "fund wallet 400 STX (DEPLOYER)" });

  call("fund wallet 500k sats sBTC", OWNER, SBTC_TOKEN, "transfer",
    [uintCV(500_000), standardPrincipalCV(OWNER), principalCV(WALLET), noneCV()], /^\(ok/);

  call("onboard(pubkey, OWNER, some(RECOVERY), thresholds)", FAKFUN_DEPLOYER, WALLET,
    "onboard",
    [pubkeyCV, standardPrincipalCV(OWNER), someCV(standardPrincipalCV(RECOVERY)),
     uintCV(STX_THRESHOLD), uintCV(SBTC_THRESHOLD)],
    /^\(ok/);

  evalc("owner == OWNER", "(get-owner)", "owner0");
  evalc("recovery-address", "(var-get recovery-address)", "recovery0");
  evalc("wallet-config", "(var-get wallet-config)", "config0");
  evalc("is-admin-pubkey(pubkey)", `(is-admin-pubkey ${key.pubKeyHex.startsWith("0x") ? key.pubKeyHex : "0x" + key.pubKeyHex})`, "adminpk0");

  // ── B: stx-transfer under threshold, ADMIN path (owner, no sig) ──────────
  evalc("recipient STX before", `(stx-get-balance '${RECIPIENT})`, "r_stx_0");
  call("stx-transfer under thr (admin/owner, no sig) -> executes", OWNER, WALLET,
    "stx-transfer", [uintCV(STX_UNDER), standardPrincipalCV(RECIPIENT), noneCV(), noneCV(), noneCV()],
    /^\(ok/);

  // ── C: stx-transfer under threshold, PASSKEY path (rp pillarwallets.xyz) ──
  call("stx-transfer under thr (PASSKEY pillarwallets.xyz) -> executes", RELAYER, WALLET,
    "stx-transfer", [uintCV(STX_UNDER), standardPrincipalCV(RECIPIENT), noneCV(),
      someCV(sigAuthTuple(1, key.pubKeyHex, sigC)), noneCV()],
    /^\(ok/);
  evalc("recipient STX after 2 transfers", `(stx-get-balance '${RECIPIENT})`, "r_stx_1");

  // ── D: stx-transfer OVER threshold -> pending-op ─────────────────────────
  call("stx-transfer OVER thr (admin) -> pending-op created", OWNER, WALLET,
    "stx-transfer", [uintCV(STX_OVER), standardPrincipalCV(RECIPIENT), noneCV(), noneCV(), noneCV()],
    /^\(ok/);
  evalc("pending-op 0 exists", "(get-pending-operation u0)", "pop0");
  b.addAdvanceBlocks({ bitcoin_blocks: 145, stacks_blocks_per_bitcoin: 1 });
  plan.push({ kind: "advance", label: "advance 145 blocks (past config cooldown)" });
  call("execute-pending-stx-transfer(0) after cooldown", OWNER, WALLET,
    "execute-pending-stx-transfer", [uintCV(0), noneCV()], /^\(ok/);

  // ── E: sBTC transfer under threshold, PASSKEY ────────────────────────────
  call("sip010 sBTC under thr (PASSKEY) -> executes", RELAYER, WALLET,
    "sip010-transfer",
    [uintCV(SBTC_UNDER), standardPrincipalCV(RECIPIENT), noneCV(),
     contractPrincipalCV("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token"),
     stringAsciiCV("sbtc-token"),
     someCV(sigAuthTuple(2, key.pubKeyHex, sigSbtc)), noneCV()],
    /^\(ok/);

  // ── F: sbtc-withdrawal under threshold, PASSKEY (v8 hash) ────────────────
  call("sbtc-initiate-withdrawal under thr (PASSKEY) -> ok/pending", RELAYER, WALLET,
    "sbtc-initiate-withdrawal",
    [uintCV(WD_AMOUNT), WD_RECIP, uintCV(WD_MAXFEE),
     someCV(sigAuthTuple(3, key.pubKeyHex, sigWd)), noneCV()],
    /^\(ok/);

  // ── G: admin-pubkey rotate (admin-gated, no sig) ─────────────────────────
  const NEW_PK = "0x03" + "22".repeat(32);
  call("propose-admin-pubkey (admin)", OWNER, WALLET, "propose-admin-pubkey",
    [bufferCV(Buffer.from(strip(NEW_PK), "hex"))], /^\(ok/);
  b.addAdvanceBlocks({ bitcoin_blocks: PUBKEY_COOLDOWN + 1, stacks_blocks_per_bitcoin: 1 });
  plan.push({ kind: "advance", label: `advance ${PUBKEY_COOLDOWN + 1} (pubkey cooldown)` });
  call("confirm-admin-pubkey (admin)", OWNER, WALLET, "confirm-admin-pubkey", [], /^\(ok/);
  evalc("new pubkey maps to admin", `(is-admin-pubkey ${NEW_PK})`, "adminpk1");

  // ── J: wrong rp-id sig rejected (BEFORE transfer, while pubkey→live admin) ─
  call("wrong rp-id (fak.fun) sig -> err-invalid-signature u4002", RELAYER, WALLET,
    "stx-transfer", [uintCV(STX_UNDER), standardPrincipalCV(RECIPIENT), noneCV(),
      someCV(sigAuthTuple(5, key.pubKeyHex, sigWrong)), noneCV()],
    "(err u4002)");

  // ── H: transfer-wallet ESCAPE (propose admin + confirm PASSKEY) ──────────
  call("propose-transfer-wallet(NEW_OWNER) (admin)", OWNER, WALLET,
    "propose-transfer-wallet", [standardPrincipalCV(NEW_OWNER)], /^\(ok/);
  evalc("pending-transfer set", "(var-get pending-transfer)", "pxfer");
  call("confirm-transfer-wallet (PASSKEY) -> owner flips", RELAYER, WALLET,
    "confirm-transfer-wallet",
    [sigAuthTuple(4, key.pubKeyHex, sigXfer), noneCV()], /^\(ok/);
  evalc("owner == NEW_OWNER", "(get-owner)", "owner1");

  // ── I: remove-admin-pubkey is GONE ───────────────────────────────────────
  call("remove-admin-pubkey REMOVED -> error", NEW_OWNER, WALLET,
    "remove-admin-pubkey", [bufferCV(Buffer.from(strip(NEW_PK), "hex"))],
    (s) => s.startsWith("(err") || s.includes("Undefined") || s.includes("NoSuch"));

  // ── run + verify ─────────────────────────────────────────────────────────
  console.log("=== pillar-safe — self-verifying stxer harness ===\n");
  const sessionId = await b.run();
  const url = `https://stxer.xyz/simulations/mainnet/${sessionId}`;
  console.log(`Submitted: ${url}\n`);
  const res = await getSimulationResult(sessionId);

  const decTx = (s) => {
    const r = s?.Result?.Transaction;
    if (!r) return "<none>";
    if ("Err" in r) return `ENGINE-ERR: ${JSON.stringify(r.Err).slice(0, 160)}`;
    try {
      return cvToString(deserializeCV(r.Ok.result));
    } catch (e) { return `dec-fail: ${e.message}`; }
  };
  const decEval = (s) => {
    const r = s?.Result?.Eval;
    if (!r || !("Ok" in r)) return `<eval:${JSON.stringify(r?.Err ?? "?").slice(0,120)}>`;
    try {
      return cvToString(deserializeCV(r.Ok));
    } catch { return r.Ok; }
  };

  let pass = 0, fail = 0;
  const cap = {};
  res.steps.forEach((s, i) => {
    const p = plan[i];
    if (!p) return;
    if (p.kind === "deploy" || p.kind === "fund" || p.kind === "advance") {
      const ok = !("Err" in (s?.Result?.Transaction || {}));
      console.log(`${ok ? "✅" : "⚠️ "} [${i}] ${p.label}`);
      return;
    }
    if (p.kind === "eval") {
      const v = decEval(s);
      if (p.capture) cap[p.capture] = v;
      console.log(`ℹ️  [${i}] ${p.label}: ${String(v).slice(0, 150)}`);
      return;
    }
    const d = decTx(s);
    if (p.capture) cap[p.capture] = d;
    const ok = p.expect == null ? true
      : typeof p.expect === "function" ? p.expect(d)
      : p.expect instanceof RegExp ? p.expect.test(d)
      : d === p.expect;
    console.log(`${ok ? "✅" : "❌"} [${i}] ${p.label}\n        got ${d.slice(0, 150)}`);
    ok ? pass++ : fail++;
  });

  console.log("\n--- state checks ---");
  const chk = (l, cond) => { console.log(`${cond ? "✅" : "❌"} ${l}`); cond ? pass++ : fail++; };
  chk("owner set to OWNER at onboard", String(cap.owner0).includes(OWNER));
  chk("recovery set to RECOVERY", String(cap.recovery0).includes(RECOVERY));
  chk("config has stx-threshold", String(cap.config0).includes(`stx-threshold u${STX_THRESHOLD}`));
  chk("config has sbtc-threshold", String(cap.config0).includes(`sbtc-threshold u${SBTC_THRESHOLD}`));
  chk("onboarded pubkey is admin", String(cap.adminpk0).startsWith("(ok"));
  chk("owner flipped to NEW_OWNER after transfer", String(cap.owner1).includes(NEW_OWNER));
  chk("rotated pubkey maps to admin", String(cap.adminpk1).startsWith("(ok"));

  console.log(`\n=== ${pass} passed, ${fail} failed ===\nView: ${url}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
