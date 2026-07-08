// simul-pillar-safe-v2.js
// Stxer mainnet-fork simulation for the DEPLOYED pillar-safe-v2 canonical
// (SPV9K21....pillar-safe-v2). No local deploy: we exercise the exact
// on-chain bytes. set-verified-contract already ran on mainnet.
//
// v2 changes under test vs the old 22/22 suite:
//   - propose/confirm-admin-pubkey + signal/confirm-pubkey-cooldown-change
//     REMOVED -> negative checks (function gone)
//   - rp-id whitelist extended to fak.fun / fakfun.com -> positive passkey
//     transfers under BOTH new domains (plus pillarwallets.xyz regression)
//   - wrong-rp negative now uses example.com (fak.fun is whitelisted in v2)
//   - everything else must keep working: admin/passkey transfers, pending op
//     + cooldown, sBTC transfer, sBTC withdrawal, 2FA wallet transfer escape
//
// Run: node simul-pillar-safe-v2.js
import crypto from "node:crypto";
import {
  tupleCV,
  uintCV,
  bufferCV,
  noneCV,
  someCV,
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

const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const OWNER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";
const RECOVERY = "SP3HXJJMJQ06GNAZ8XWDN1QM48JEDC6PP6W3YZPZJ";
const NEW_OWNER = "SP1MGH8BH1KRY49Z7EE5TY0JVKT6C3NT9RTVM8FND";
const RECIPIENT = "SP22WH53NS94VR6N145ZX77BK4S0EWFBE41VW3Z6B";
const RELAYER = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM";

const WALLET = `${DEPLOYER}.pillar-safe-v2`; // DEPLOYED canonical
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core`;
const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";

const RP_MAIN = "pillarwallets.xyz";
const RP_FAKFUN = "fak.fun"; // NEW in v2
const RP_FAKFUNCOM = "fakfun.com"; // NEW in v2
const RP_WRONG = "example.com"; // NOT whitelisted

const STX_THRESHOLD = 100_000_000;
const SBTC_THRESHOLD = 100_000;
const STX_UNDER = 10_000_000;
const STX_OVER = 150_000_000;
const SBTC_UNDER = 10_000;
const WD_AMOUNT = 5_000;
const WD_MAXFEE = 1_000;

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

const WD_RECIP = tupleCV({
  version: bufferCV(Buffer.from([0x06])),
  hashbytes: bufferCV(Buffer.alloc(32, 0x11)),
});

async function main() {
  const key = generateP256Keypair();
  const pubkeyCV = bufferCV(key.pubKey);

  // Pre-sign challenges. Unique auth-id per signature.
  const sMain = buildChallenge(tStxTransfer(1, STX_UNDER, RECIPIENT));
  const sFak = buildChallenge(tStxTransfer(2, STX_UNDER, RECIPIENT));
  const sFakCom = buildChallenge(tStxTransfer(3, STX_UNDER, RECIPIENT));
  const sSbtc = buildChallenge(tSip010(4, SBTC_UNDER, RECIPIENT, SBTC_TOKEN));
  const sWd = buildChallenge(tSbtcWithdraw(5, WD_AMOUNT, WD_RECIP, WD_MAXFEE));
  const sXfer = buildChallenge(tConfirmTransfer(6, NEW_OWNER));
  const sWrong = buildChallenge(tStxTransfer(7, STX_UNDER, RECIPIENT));

  const sigMain = signChallengeWithRpId(sMain, key.privKey, RP_MAIN);
  const sigFak = signChallengeWithRpId(sFak, key.privKey, RP_FAKFUN);
  const sigFakCom = signChallengeWithRpId(sFakCom, key.privKey, RP_FAKFUNCOM);
  const sigSbtc = signChallengeWithRpId(sSbtc, key.privKey, RP_MAIN);
  const sigWd = signChallengeWithRpId(sWd, key.privKey, RP_MAIN);
  const sigXfer = signChallengeWithRpId(sXfer, key.privKey, RP_MAIN);
  const sigWrong = signChallengeWithRpId(sWrong, key.privKey, RP_WRONG);

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

  // A: fund + onboard the DEPLOYED canonical (set-verified already on mainnet)
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
  evalc("is-admin-pubkey(pubkey)", `(is-admin-pubkey 0x${strip(key.pubKeyHex)})`, "adminpk0");

  // B: admin path
  call("stx-transfer under thr (admin) -> executes", OWNER, WALLET,
    "stx-transfer", [uintCV(STX_UNDER), standardPrincipalCV(RECIPIENT), noneCV(), noneCV(), noneCV()],
    /^\(ok/);

  // C: passkey path under all three rp-ids (old + the two NEW v2 domains)
  call("stx-transfer PASSKEY rp=pillarwallets.xyz", RELAYER, WALLET,
    "stx-transfer", [uintCV(STX_UNDER), standardPrincipalCV(RECIPIENT), noneCV(),
      someCV(sigAuthTuple(1, key.pubKeyHex, sigMain)), noneCV()],
    /^\(ok/);
  call("stx-transfer PASSKEY rp=fak.fun (NEW in v2)", RELAYER, WALLET,
    "stx-transfer", [uintCV(STX_UNDER), standardPrincipalCV(RECIPIENT), noneCV(),
      someCV(sigAuthTuple(2, key.pubKeyHex, sigFak)), noneCV()],
    /^\(ok/);
  call("stx-transfer PASSKEY rp=fakfun.com (NEW in v2)", RELAYER, WALLET,
    "stx-transfer", [uintCV(STX_UNDER), standardPrincipalCV(RECIPIENT), noneCV(),
      someCV(sigAuthTuple(3, key.pubKeyHex, sigFakCom)), noneCV()],
    /^\(ok/);

  // D: over threshold -> pending op + cooldown execute
  call("stx-transfer OVER thr (admin) -> pending-op", OWNER, WALLET,
    "stx-transfer", [uintCV(STX_OVER), standardPrincipalCV(RECIPIENT), noneCV(), noneCV(), noneCV()],
    /^\(ok/);
  evalc("pending-op 0 exists", "(get-pending-operation u0)", "pop0");
  b.addAdvanceBlocks({ bitcoin_blocks: 145, stacks_blocks_per_bitcoin: 1 });
  plan.push({ kind: "advance", label: "advance 145 blocks (config cooldown)" });
  call("execute-pending-stx-transfer(0) after cooldown", OWNER, WALLET,
    "execute-pending-stx-transfer", [uintCV(0), noneCV()], /^\(ok/);

  // E: sBTC transfer passkey
  call("sip010 sBTC under thr (PASSKEY)", RELAYER, WALLET,
    "sip010-transfer",
    [uintCV(SBTC_UNDER), standardPrincipalCV(RECIPIENT), noneCV(),
     contractPrincipalCV("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token"),
     stringAsciiCV("sbtc-token"),
     someCV(sigAuthTuple(4, key.pubKeyHex, sigSbtc)), noneCV()],
    /^\(ok/);

  // F: sBTC withdrawal passkey
  call("sbtc-initiate-withdrawal under thr (PASSKEY)", RELAYER, WALLET,
    "sbtc-initiate-withdrawal",
    [uintCV(WD_AMOUNT), WD_RECIP, uintCV(WD_MAXFEE),
     someCV(sigAuthTuple(5, key.pubKeyHex, sigWd)), noneCV()],
    /^\(ok/);

  // G-NEG: the four removed functions are GONE
  const gone = (s) => s.startsWith("ENGINE-ERR") || s.startsWith("(err") ||
    s.includes("Undefined") || s.includes("NoSuch");
  const NEW_PK = "0x03" + "22".repeat(32);
  call("propose-admin-pubkey REMOVED", OWNER, WALLET, "propose-admin-pubkey",
    [bufferCV(Buffer.from(strip(NEW_PK), "hex"))], gone);
  call("confirm-admin-pubkey REMOVED", OWNER, WALLET, "confirm-admin-pubkey", [], gone);
  call("signal-pubkey-cooldown-change REMOVED", OWNER, WALLET,
    "signal-pubkey-cooldown-change", [uintCV(100)], gone);
  call("confirm-pubkey-cooldown-change REMOVED", OWNER, WALLET,
    "confirm-pubkey-cooldown-change", [], gone);
  call("remove-admin-pubkey REMOVED", OWNER, WALLET, "remove-admin-pubkey",
    [bufferCV(Buffer.from(strip(NEW_PK), "hex"))], gone);

  // J-NEG: non-whitelisted rp-id rejected
  call("wrong rp-id (example.com) -> err u4002", RELAYER, WALLET,
    "stx-transfer", [uintCV(STX_UNDER), standardPrincipalCV(RECIPIENT), noneCV(),
      someCV(sigAuthTuple(7, key.pubKeyHex, sigWrong)), noneCV()],
    "(err u4002)");

  // H: 2FA wallet transfer escape still works
  call("propose-transfer-wallet(NEW_OWNER) (admin)", OWNER, WALLET,
    "propose-transfer-wallet", [standardPrincipalCV(NEW_OWNER)], /^\(ok/);
  call("confirm-transfer-wallet (PASSKEY) -> owner flips", RELAYER, WALLET,
    "confirm-transfer-wallet",
    [sigAuthTuple(6, key.pubKeyHex, sigXfer), noneCV()], /^\(ok/);
  evalc("owner == NEW_OWNER", "(get-owner)", "owner1");
  evalc("old passkey now maps to non-admin", `(is-admin-pubkey 0x${strip(key.pubKeyHex)})`, "adminpk1");

  console.log("=== pillar-safe-v2 (DEPLOYED canonical) - stxer harness ===\n");
  const sessionId = await b.run();
  const url = `https://stxer.xyz/simulations/mainnet/${sessionId}`;
  console.log(`Submitted: ${url}\n`);
  const res = await getSimulationResult(sessionId);

  const decTx = (s) => {
    const r = s?.Result?.Transaction;
    if (!r) return "<none>";
    if ("Err" in r) return `ENGINE-ERR: ${JSON.stringify(r.Err).slice(0, 160)}`;
    try { return cvToString(deserializeCV(r.Ok.result)); }
    catch (e) { return `dec-fail: ${e.message}`; }
  };
  const decEval = (s) => {
    const r = s?.Result?.Eval;
    if (!r || !("Ok" in r)) return `<eval:${JSON.stringify(r?.Err ?? "?").slice(0,120)}>`;
    try { return cvToString(deserializeCV(r.Ok)); } catch { return r.Ok; }
  };

  let pass = 0, fail = 0;
  const cap = {};
  res.steps.forEach((s, i) => {
    const p = plan[i];
    if (!p) return;
    if (p.kind === "fund" || p.kind === "advance") {
      const ok = !("Err" in (s?.Result?.Transaction || {}));
      console.log(`${ok ? "OK " : "WARN"} [${i}] ${p.label}`);
      return;
    }
    if (p.kind === "eval") {
      const v = decEval(s);
      if (p.capture) cap[p.capture] = v;
      console.log(`INFO [${i}] ${p.label}: ${String(v).slice(0, 150)}`);
      return;
    }
    const d = decTx(s);
    if (p.capture) cap[p.capture] = d;
    const ok = p.expect == null ? true
      : typeof p.expect === "function" ? p.expect(d)
      : p.expect instanceof RegExp ? p.expect.test(d)
      : d === p.expect;
    console.log(`${ok ? "PASS" : "FAIL"} [${i}] ${p.label}\n        got ${d.slice(0, 150)}`);
    ok ? pass++ : fail++;
  });

  console.log("\n--- state checks ---");
  const chk = (l, cond) => { console.log(`${cond ? "PASS" : "FAIL"} ${l}`); cond ? pass++ : fail++; };
  chk("owner set to OWNER at onboard", String(cap.owner0).includes(OWNER));
  chk("recovery set to RECOVERY", String(cap.recovery0).includes(RECOVERY));
  chk("config has stx-threshold", String(cap.config0).includes(`stx-threshold u${STX_THRESHOLD}`));
  chk("config has sbtc-threshold", String(cap.config0).includes(`sbtc-threshold u${SBTC_THRESHOLD}`));
  chk("onboarded pubkey is admin", String(cap.adminpk0).startsWith("(ok"));
  chk("owner flipped to NEW_OWNER after 2FA transfer", String(cap.owner1).includes(NEW_OWNER));
  chk("old passkey de-authorized after transfer", !String(cap.adminpk1).startsWith("(ok"));

  console.log(`\n=== ${pass} passed, ${fail} failed ===\nView: ${url}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
