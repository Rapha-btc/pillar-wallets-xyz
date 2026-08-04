// simul-config-passkey-v6.js
//
// Everything the v6 generation changed and nothing else exercises, against the
// DEPLOYED juice-safe-v6. The repointed suite proves the changes did not regress
// what already worked; this proves the changes themselves work.
//
// A. ONBOARD. recovery is now a bare principal, not (optional principal), and
//    cooldown-period is caller-supplied instead of hardcoded u144. Both the
//    rejections and the happy path.
//
// B. THE CIRCLE IS BROKEN. In v4 both halves of a config change were
//    (is-authorized none), so the admin key the cooldown protects against could
//    also switch the cooldown off: signal, wait, set cooldown-period to u0. Now
//    signal-config-change is admin-only and set-wallet-config is PASSKEY-only, so
//    the two steps need two different factors. The load-bearing assertion is that
//    the admin key ALONE can no longer finish a config change.
//
// C. THE HASH BINDS THE VALUES. A signature collected for one set of thresholds
//    must be rejected against another. Without this the passkey is only consenting
//    to "a change", which a compromised admin could then fill in differently.
//
// D. VALUES ARE COMMITTED AT SIGNAL TIME. get-pending-config must show what is
//    coming DURING the cooldown, not merely that something is, and must be zeroed
//    once it lands.
//
// E. BOUNDS. MIN-COOLDOWN u144 floor and MAX-CONFIG-COOLDOWN u4032 ceiling, at
//    onboard AND at signal. err-cooldown-too-long u4019 was declared in v4 and
//    never used.
//
// F. update-activity on the paths that were missing it. is-inactive gates
//    recover-inactive-wallet, so an owner whose only interactions across a year
//    were config changes counted as ABANDONED and could lose the wallet to the
//    recovery address.
//
//   node simul-config-passkey-v6.js
import crypto from "node:crypto";
import {
  tupleCV, uintCV, bufferCV, noneCV, someCV, principalCV, standardPrincipalCV,
  stringAsciiCV, contractPrincipalCV, serializeCV, deserializeCV, cvToString,
  PostConditionMode,
} from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";
import { generateP256Keypair, signChallengeWithRpId } from "./lib-webauthn-test-signer.mjs";

const D = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const OWNER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";
const RECOVERY = "SP3HXJJMJQ06GNAZ8XWDN1QM48JEDC6PP6W3YZPZJ";
const RELAYER = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM";
const RANDOM = "SP1MGH8BH1KRY49Z7EE5TY0JVKT6C3NT9RTVM8FND";
const STX_WHALE = "SP9BP4PN74CNR5XT7CMAMBPA0GWC9HMB69HVVV51";
const BURN = "SP000000000000000000002Q6VF78";
const SBTC = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const WALLET = `${D}.juice-safe-v6`;
const CORE = `${D}.fakfun-wallet-core`;
const API = "http://77.42.3.101/stacks-api";
const RP_ID = "juiceofbtc.com";

const MIN_COOLDOWN = 144;          // MIN-COOLDOWN
const MAX_COOLDOWN = 4032;         // MAX-CONFIG-COOLDOWN
const ONBOARD_COOLDOWN = 200;      // legal, and NOT the old hardcoded u144
const STX_THRESHOLD = 100_000_000;
const SBTC_THRESHOLD = 100_000;

// the config change under test
const NEW_STX = 250_000_000;
const NEW_SBTC = 300_000;
const NEW_COOLDOWN = 288;

const E_UNAUTH = "(err u4001)";
const E_BADSIG = "(err u4002)";
const E_COOLDOWN = "(err u4012)";
const E_NOTSIGNALED = "(err u4016)";
const E_TOO_LONG = "(err u4019)";
const E_TOO_SHORT = "(err u4031)";

// --- SIP-018 plumbing ----------------------------------------------------
const P = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const cvh = (cv) => { const o = serializeCV(cv); return typeof o === "string" ? sha256(Buffer.from(o, "hex")) : sha256(Buffer.from(o)); };
const dom = () => cvh(tupleCV({ name: stringAsciiCV("smart-wallet-standard"), version: stringAsciiCV("1.0.0"), "chain-id": uintCV(1), wallet: principalCV(WALLET) }));
const chal = (t) => sha256(Buffer.concat([P, dom(), cvh(t)]));
const strip = (h) => (h.startsWith("0x") ? h.slice(2) : h);
const sa = (id, pk, s) => tupleCV({ "auth-id": uintCV(id), pubkey: bufferCV(Buffer.from(strip(pk), "hex")), signature: bufferCV(Buffer.from(strip(s.signatureHex), "hex")), "authenticator-data": bufferCV(Buffer.from(strip(s.authenticatorDataHex), "hex")), "client-data-prefix": bufferCV(Buffer.from(strip(s.clientDataPrefixHex), "hex")), "client-data-suffix": bufferCV(Buffer.from(strip(s.clientDataSuffixHex), "hex")) });

// helpers-v10 build-set-wallet-config-hash
const tConfig = (id, stx, sbtc, cd) => tupleCV({
  topic: stringAsciiCV("set-wallet-config"), "auth-id": uintCV(id),
  "stx-threshold": uintCV(stx), "sbtc-threshold": uintCV(sbtc), "cooldown-period": uintCV(cd),
});
const key = generateP256Keypair();
const pubkeyCV = bufferCV(Buffer.from(strip(key.pubKeyHex), "hex"));
const signConfig = (id, stx, sbtc, cd) =>
  sa(id, key.pubKeyHex, signChallengeWithRpId(chal(tConfig(id, stx, sbtc, cd)), key.privKey, RP_ID));

// --- harness -------------------------------------------------------------
const plan = [];
const b = SimulationBuilder.new({ stacksNodeAPI: API });
const call = (l, snd, fn, args, exp) => {
  b.withSender(snd).addContractCall({ contract_id: WALLET, function_name: fn, function_args: args, post_condition_mode: PostConditionMode.Allow });
  plan.push({ l, exp });
};
const core = (l, fn, args, exp) => {
  b.withSender(D).addContractCall({ contract_id: CORE, function_name: fn, function_args: args, post_condition_mode: PostConditionMode.Allow });
  plan.push({ l, exp });
};
const ev = (l, code, cap) => { b.addEvalCode(WALLET, code); plan.push({ l, cap, ev: true }); };
const note = (l) => plan.push({ l });
const ok = /^\(ok/;
const onboardArgs = (recovery, cooldown) =>
  [pubkeyCV, standardPrincipalCV(OWNER), recovery, uintCV(STX_THRESHOLD), uintCV(SBTC_THRESHOLD), uintCV(cooldown)];

core("set-verified-contract(juice-safe-v6)", "set-verified-contract", [principalCV(WALLET), noneCV()], ok);

// === A. onboard rejections, then the happy path ==========================
call(`A1 onboard recovery=BURN sentinel -> ${E_UNAUTH}`, FAKFUN_DEPLOYER, "onboard",
  onboardArgs(standardPrincipalCV(BURN), ONBOARD_COOLDOWN), E_UNAUTH);
call(`A2 onboard recovery=THIS CONTRACT -> ${E_UNAUTH}`, FAKFUN_DEPLOYER, "onboard",
  [pubkeyCV, standardPrincipalCV(OWNER), principalCV(WALLET), uintCV(STX_THRESHOLD), uintCV(SBTC_THRESHOLD), uintCV(ONBOARD_COOLDOWN)], E_UNAUTH);
call(`A3 onboard recovery=OWNER -> ${E_UNAUTH}`, FAKFUN_DEPLOYER, "onboard",
  onboardArgs(standardPrincipalCV(OWNER), ONBOARD_COOLDOWN), E_UNAUTH);
call(`A4 onboard cooldown=100 (< MIN u${MIN_COOLDOWN}) -> ${E_TOO_SHORT}`, FAKFUN_DEPLOYER, "onboard",
  onboardArgs(standardPrincipalCV(RECOVERY), 100), E_TOO_SHORT);
call(`A5 onboard cooldown=5000 (> MAX u${MAX_COOLDOWN}) -> ${E_TOO_LONG}`, FAKFUN_DEPLOYER, "onboard",
  onboardArgs(standardPrincipalCV(RECOVERY), 5000), E_TOO_LONG);
call(`A6 onboard cooldown=${ONBOARD_COOLDOWN} (legal) -> ok`, FAKFUN_DEPLOYER, "onboard",
  onboardArgs(standardPrincipalCV(RECOVERY), ONBOARD_COOLDOWN), ok);
ev(`A7 wallet-config after onboard (cooldown must be u${ONBOARD_COOLDOWN}, NOT the old u144)`,
  "(var-get wallet-config)", "cfg0");
ev("A8 recovery-address is set", "(var-get recovery-address)", "rec");
ev("A9 last-activity-block after onboard", "(var-get last-activity-block)", "act0");

b.withSender(STX_WHALE).addSTXTransfer({ recipient: WALLET, amount: 500_000_000 });
note("fund 500 STX");

// === E. bounds at signal ================================================
call(`E1 signal by RANDOM -> ${E_UNAUTH}`, RANDOM, "signal-config-change",
  [uintCV(NEW_STX), uintCV(NEW_SBTC), uintCV(NEW_COOLDOWN)], E_UNAUTH);
call(`E2 signal cooldown=10 (< MIN) -> ${E_TOO_SHORT}`, OWNER, "signal-config-change",
  [uintCV(NEW_STX), uintCV(NEW_SBTC), uintCV(10)], E_TOO_SHORT);
call(`E3 signal cooldown=9999 (> MAX) -> ${E_TOO_LONG}`, OWNER, "signal-config-change",
  [uintCV(NEW_STX), uintCV(NEW_SBTC), uintCV(9999)], E_TOO_LONG);

// === D. values committed at signal time =================================
call("D1 signal (legal) by the ADMIN -> ok", OWNER, "signal-config-change",
  [uintCV(NEW_STX), uintCV(NEW_SBTC), uintCV(NEW_COOLDOWN)], ok);
ev("D2 get-pending-config DURING the window (must show the queued values)",
  "(get-pending-config)", "pend1");
ev("D3 wallet-config during the window (must be UNCHANGED)", "(var-get wallet-config)", "cfg1");

// === B and C. the confirm =============================================
call(`B1 set-wallet-config with NOTHING pending? no -- pending exists; wrong-value sig -> ${E_BADSIG}`,
  RELAYER, "set-wallet-config", [signConfig(1, 999_000_000, 999_000, 1000), noneCV()], E_BADSIG);
call(`C1 sig bound to DIFFERENT thresholds -> ${E_BADSIG}`,
  RELAYER, "set-wallet-config", [signConfig(2, NEW_STX + 1, NEW_SBTC, NEW_COOLDOWN), noneCV()], E_BADSIG);
call(`B2 correct sig but BEFORE the cooldown -> ${E_COOLDOWN}`,
  RELAYER, "set-wallet-config", [signConfig(3, NEW_STX, NEW_SBTC, NEW_COOLDOWN), noneCV()], E_COOLDOWN);

b.addAdvanceBlocks({ bitcoin_blocks: ONBOARD_COOLDOWN + 20, stacks_blocks_per_bitcoin: 1 });
note(`advance ${ONBOARD_COOLDOWN + 20} burn blocks (past the onboard cooldown u${ONBOARD_COOLDOWN})`);

call("B3 correct sig AFTER the cooldown, relayed -> ok", RELAYER, "set-wallet-config",
  [signConfig(4, NEW_STX, NEW_SBTC, NEW_COOLDOWN), noneCV()], ok);
ev("B4 wallet-config after the confirm (must be the NEW values)", "(var-get wallet-config)", "cfg2");
ev("D4 get-pending-config after the confirm (must be ZEROED)", "(get-pending-config)", "pend2");
ev("F1 last-activity-block after the config change", "(var-get last-activity-block)", "act1");

// === B5. the admin key alone can no longer finish a config change =======
call("B5 signal again (admin) -> ok", OWNER, "signal-config-change",
  [uintCV(STX_THRESHOLD), uintCV(SBTC_THRESHOLD), uintCV(MIN_COOLDOWN)], ok);
b.addAdvanceBlocks({ bitcoin_blocks: NEW_COOLDOWN + 20, stacks_blocks_per_bitcoin: 1 });
note(`advance ${NEW_COOLDOWN + 20} (past the NEW cooldown u${NEW_COOLDOWN})`);
call(`B6 confirm with a GARBAGE signature (admin alone) -> ${E_BADSIG}`, OWNER, "set-wallet-config",
  [tupleCV({ "auth-id": uintCV(9), pubkey: pubkeyCV,
             signature: bufferCV(Buffer.alloc(64)),
             "authenticator-data": bufferCV(Buffer.alloc(37)),
             "client-data-prefix": bufferCV(Buffer.from("{}")),
             "client-data-suffix": bufferCV(Buffer.from("{}")) }), noneCV()], E_BADSIG);
ev("B7 wallet-config unchanged by the admin-only attempt", "(var-get wallet-config)", "cfg3");
ev("B8 the change is STILL pending, not lost", "(get-pending-config)", "pend3");

// --- run -----------------------------------------------------------------
const id = await b.run();
const url = `https://stxer.xyz/simulations/mainnet/${id}`;
console.log(`\n${url}\n`);
const res = await getSimulationResult(id);
const dtx = (s) => { const t = s?.Result?.Transaction; if (!t) return "";
  if ("Err" in t) return `ABORT ${JSON.stringify(t.Err).slice(0, 160)}`;
  return cvToString(deserializeCV(t.Ok.result)); };
const dev = (s) => { const e = s?.Result?.Eval; return e && "Ok" in e ? cvToString(deserializeCV(e.Ok)) : "?"; };

let pass = 0, fail = 0; const cap = {};
res.steps.forEach((s, i) => {
  const p = plan[i]; if (!p) return;
  if (p.ev) { const v = dev(s); if (p.cap) cap[p.cap] = v; console.log(`INFO  ${p.l}\n        ${v}`); return; }
  const d = dtx(s);
  if (!p.exp) { console.log(`      ${p.l} -> ${d}`); return; }
  const good = p.exp instanceof RegExp ? p.exp.test(d) : d === p.exp;
  console.log(`${good ? "PASS" : "FAIL"}  ${p.l} -> ${d}`);
  good ? pass++ : fail++;
});

const fld = (t, f) => BigInt((String(t).match(new RegExp(`\\(${f} u(\\d+)\\)`)) || [])[1] ?? "-1");
const u = (x) => BigInt((String(x).match(/u(\d+)/) || [])[1] ?? "-1");
const chk = (l, c, extra) => { console.log(`${c ? "PASS" : "FAIL"} ${l}${extra ? `  (${extra})` : ""}`); c ? pass++ : fail++; };

console.log("\n--- derived checks ---");
chk(`A onboard honoured cooldown-period u${ONBOARD_COOLDOWN} instead of hardcoding u144`,
  fld(cap.cfg0, "cooldown-period") === BigInt(ONBOARD_COOLDOWN), `read ${fld(cap.cfg0, "cooldown-period")}`);
chk("A recovery-address was actually set (mandatory now)",
  String(cap.rec).includes(RECOVERY), `${cap.rec}`);
chk("D signal queued the values where an observer can read them",
  fld(cap.pend1, "stx-threshold") === BigInt(NEW_STX)
  && fld(cap.pend1, "sbtc-threshold") === BigInt(NEW_SBTC)
  && fld(cap.pend1, "cooldown-period") === BigInt(NEW_COOLDOWN), `${cap.pend1}`);
chk("D signal did NOT touch the live config",
  fld(cap.cfg1, "stx-threshold") === BigInt(STX_THRESHOLD), `${fld(cap.cfg1, "stx-threshold")}`);
chk("B the confirm applied all three pending values",
  fld(cap.cfg2, "stx-threshold") === BigInt(NEW_STX)
  && fld(cap.cfg2, "sbtc-threshold") === BigInt(NEW_SBTC)
  && fld(cap.cfg2, "cooldown-period") === BigInt(NEW_COOLDOWN), `${cap.cfg2}`);
chk("D pending-config was ZEROED after the confirm",
  fld(cap.pend2, "stx-threshold") === 0n && fld(cap.pend2, "sbtc-threshold") === 0n
  && fld(cap.pend2, "cooldown-period") === 0n, `${cap.pend2}`);
chk("F update-activity fired: last-activity-block advanced across the config change",
  u(cap.act1) > u(cap.act0), `${cap.act0} -> ${cap.act1}`);
chk("B the admin-only attempt changed nothing",
  fld(cap.cfg3, "cooldown-period") === BigInt(NEW_COOLDOWN), `${fld(cap.cfg3, "cooldown-period")}`);
chk("B the pending change survived the failed attempt",
  fld(cap.pend3, "cooldown-period") === BigInt(MIN_COOLDOWN), `${cap.pend3}`);

console.log(`\n=== ${pass} passed, ${fail} failed ===\n${url}`);
