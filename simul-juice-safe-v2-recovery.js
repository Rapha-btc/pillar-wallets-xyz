// simul-juice-safe-v2-recovery.js
// The two owner-change escape hatches on the DEPLOYED SPV9K21....juice-safe-v2.
//
//   A. 2FA ownership transfer
//        propose-transfer-wallet(new-admin)   admin key, direct
//        confirm-transfer-wallet(sig-auth)    PASSKEY -- the second factor
//      Neither factor alone can move the wallet.
//
//   B. inactivity recovery
//        recover-inactive-wallet(new-admin)   recovery address only, and only
//                                             once is-inactive
//      is-inactive is burn-block-height > last-activity-block + INACTIVITY-PERIOD
//      (u52560 burn blocks, roughly a year). EVERY wallet call runs
//      update-activity, so the clock restarts on any use -- this harness
//      therefore advances the full period AFTER the last touch.
//
// Kept separate from the lifecycle harness precisely because of that 52,560
// block advance; stacking those on top of the lifecycle's own advances would
// make one very long fork.
//
// Run: node simul-juice-safe-v2-recovery.js
import crypto from "node:crypto";
import {
  tupleCV, uintCV, bufferCV, noneCV, someCV, principalCV,
  standardPrincipalCV, stringAsciiCV, serializeCV, deserializeCV,
  cvToString, PostConditionMode,
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

const WALLET = `${DEPLOYER}.juice-safe-v2`;
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

  // ---- setup --------------------------------------------------------------
  call("set-verified-contract", DEPLOYER, WALLET_CORE, "set-verified-contract",
    [principalCV(WALLET), noneCV()], okre);
  call("onboard (owner=OWNER, recovery=RECOVERY)", FAKFUN_DEPLOYER, WALLET, "onboard",
    [pubkeyCV, standardPrincipalCV(OWNER), someCV(standardPrincipalCV(RECOVERY)),
     uintCV(STX_THRESHOLD), uintCV(SBTC_THRESHOLD)], okre);
  evalc("owner at onboard", "(get-owner)", "own0");
  evalc("is-inactive right after onboard (expect false)", "(is-inactive)", "inact0");

  // ---- B negative: recovery is not available while the wallet is active ----
  call("recover-inactive by RECOVERY while ACTIVE -> u4009", RECOVERY, WALLET,
    "recover-inactive-wallet", [standardPrincipalCV(RESCUED)], "(err u4009)");

  // ---- A: 2FA ownership transfer ------------------------------------------
  call("A1 propose-transfer-wallet by RANDOM -> u4001", RANDOM, WALLET,
    "propose-transfer-wallet", [standardPrincipalCV(NEW_OWNER)], "(err u4001)");
  call("A2 propose-transfer-wallet by ADMIN -> ok", OWNER, WALLET,
    "propose-transfer-wallet", [standardPrincipalCV(NEW_OWNER)], okre);
  evalc("owner still OWNER after propose (factor 1 alone is not enough)",
    "(get-owner)", "own1");
  call("A3 confirm-transfer with WRONG rp.id (example.com) -> u4002", RANDOM, WALLET,
    "confirm-transfer-wallet", [sigAuth(2, key.pubKeyHex, sigXferWrongRp), noneCV()],
    "(err u4002)");
  call("A4 confirm-transfer-wallet (PASSKEY = factor 2) -> ok", RANDOM, WALLET,
    "confirm-transfer-wallet", [sigAuth(1, key.pubKeyHex, sigXfer), noneCV()], okre);
  evalc("owner AFTER 2FA transfer (expect NEW_OWNER)", "(get-owner)", "own2");

  // ---- B: inactivity recovery ---------------------------------------------
  b.addAdvanceBlocks({ bitcoin_blocks: ADVANCE, stacks_blocks_per_bitcoin: 1 });
  plan.push({ kind: "advance", label: `advance ${ADVANCE} burn blocks (> INACTIVITY-PERIOD u52560)` });
  evalc("is-inactive after the advance (expect true)", "(is-inactive)", "inact1");

  call("B1 recover-inactive by RANDOM (not the recovery addr) -> u4001", RANDOM, WALLET,
    "recover-inactive-wallet", [standardPrincipalCV(RESCUED)], "(err u4001)");
  call("B2 recover-inactive by RECOVERY -> ok", RECOVERY, WALLET,
    "recover-inactive-wallet", [standardPrincipalCV(RESCUED)], okre);
  evalc("owner AFTER recovery (expect RESCUED)", "(get-owner)", "own3");
  evalc("is-inactive after recovery (clock reset, expect false)", "(is-inactive)", "inact2");

  console.log("=== juice-safe-v2: 2FA transfer + inactivity recovery ===\n");
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
  chk("owner seated at onboard", String(cap.own0).includes(OWNER));
  chk("active wallet is NOT inactive", String(cap.inact0).includes("false"));
  chk("propose alone does NOT move the wallet", String(cap.own1).includes(OWNER));
  chk("2FA transfer flipped the owner", String(cap.own2).includes(NEW_OWNER));
  chk("wallet IS inactive after the period", String(cap.inact1).includes("true"));
  chk("recovery flipped the owner", String(cap.own3).includes(RESCUED));
  chk("recovery reset the activity clock", String(cap.inact2).includes("false"));

  console.log(`\n=== ${pass} passed, ${fail} failed ===\nView: ${url}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
