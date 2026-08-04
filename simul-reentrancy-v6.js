// simul-reentrancy-v6.js
// Repoint of simul-reentrancy-v4.js at the DEPLOYED juice-safe-v6.
// onboard now takes SIX args -- recovery is a bare principal, not an optional,
// and cooldown-period is caller-supplied instead of hardcoded u144.
// simul-reentrancy-v4.js
//
// Drives the one attack shape the suite never executed, against the DEPLOYED
// juice-safe-v6.
//
// THE ATTACK. The <gas-trait> station is chosen by whoever relays the call and
// is NOT covered by the signed hash (build-stx-transfer-hash covers only
// {topic, auth-id, amount, recipient, memo}). So a compromised relay can
// substitute any contract as the station on an otherwise legitimate,
// correctly-signed user call. The wallet then pays it inside:
//
//   (as-contract? ((with-ft SBTC-CONTRACT "sbtc-token" (var-get max-gas-amount)))
//     (try! (contract-call? g pay-gas)))
//
// as-contract? rebinds tx-sender to the wallet's own principal, so for the
// duration of pay-gas the attacker's code runs while tx-sender IS the safe.
// Instead of taking its fee, the station calls back into the safe with
// sig-auth: none. That routes to (try! (is-authorized none)) =
// (is-admin-calling tx-sender) -- and tx-sender is the safe. If the safe
// treated itself as an admin, the relay alone would have authorised an
// arbitrary transfer holding no key and forging no signature.
//
// WHY IT SHOULD FAIL. Every write to the `admins` map takes a STANDARD
// principal: line 1761 at onboard, 1247 on 2FA transfer, 1401 on recovery.
// Line 1746 seeds the burn address as a placeholder and 1760 deletes it. The
// safe's own contract principal is never inserted, so the lookup misses and the
// re-entrant call gets err-unauthorised (err u4001).
//
// WHAT THIS ACTUALLY ADDS OVER READING THE SOURCE. The source argument rests on
// one unverified premise: that as-contract? under Clarity 6 rebinds tx-sender
// the way described. That is exactly the class of thing the tooling gets wrong
// -- see simul-deploy-v4-v14.js, where clarinet 3.19.0 and 3.23.1 both accepted
// an invented allowance form and both accepted no-such-method on a constant
// target. So each station RECORDS the tx-sender it observed into its own
// data-var, and this harness asserts on that recorded value. If as-contract?
// does not rebind, the recorded principal will not be the safe and the whole
// re-entrancy argument collapses regardless of the admins map.
//
// The stations swallow the inner response with `match` rather than `try!`, so
// the failure is captured instead of reverting the outer call. That is what
// makes the inner (err u4001) observable at all -- a propagated error would
// abort everything and leave nothing to read.
//
// Two variants, to show which barrier fires first:
//   A. re-enter stx-transfer  -- STX has NO allowance in that frame at all
//   B. re-enter sip010-transfer for sBTC BELOW max-gas-amount, so the frame's
//      one allowance would cover it. If the admin gate is the real barrier,
//      this fails identically with u4001.
//
//   node simul-reentrancy-v4.js
import crypto from "node:crypto";
import {
  tupleCV, uintCV, bufferCV, noneCV, someCV, principalCV, standardPrincipalCV,
  stringAsciiCV, contractPrincipalCV, serializeCV, deserializeCV, cvToString,
  ClarityVersion, PostConditionMode,
} from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";
import { generateP256Keypair, signChallengeWithRpId } from "./lib-webauthn-test-signer.mjs";

const D = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const OWNER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";
const RECOVERY = "SP3HXJJMJQ06GNAZ8XWDN1QM48JEDC6PP6W3YZPZJ";
const RELAYER = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM";
const ATTACKER = "SP1MGH8BH1KRY49Z7EE5TY0JVKT6C3NT9RTVM8FND";
const RECIPIENT = "SP22WH53NS94VR6N145ZX77BK4S0EWFBE41VW3Z6B";
const STX_WHALE = "SP9BP4PN74CNR5XT7CMAMBPA0GWC9HMB69HVVV51";
const SBTC = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const WALLET = `${D}.juice-safe-v6`;
const CORE = `${D}.fakfun-wallet-core`;
const API = "http://77.42.3.101/stacks-api";
const RP_ID = "juiceofbtc.com";

const ERR_UNAUTHORISED = 4001;      // err-unauthorised, juice-safe-v6.clar:57
const DEFAULT_MAX_GAS = 1_000;      // max-gas-amount initial value

const STX_FUND = 500_000_000;       // 500 STX into the safe
const SBTC_FUND = 200_000;          // sats into the safe
const LEGIT_FEE = 20;               // what each station actually charges
const STEAL_STX = 1_000_000;        // 1 STX, UNDER the threshold -> would move
const STEAL_SBTC = 500;             // sats, under BOTH the threshold and the
                                    // frame's (with-ft ... max-gas-amount u1000)
const XFER = 100_000;               // 0.1 STX, the legitimate outer call

const TRAIT = `(impl-trait '${D}.gas-station-trait.gas-station-trait)`;

// Shared station body. `probe` is the re-entrant call under test; its response
// is captured, never propagated.
const stationSrc = (probe) => `${TRAIT}
(define-constant SAFE '${WALLET})
;; evidence, readable after the outer call completes
(define-data-var seen-tx-sender principal 'SP000000000000000000002Q6VF78)
(define-data-var attack-err uint u0)
(define-data-var attack-ok bool false)
(define-data-var attempted bool false)
(define-read-only (get-seen-tx-sender) (var-get seen-tx-sender))
(define-read-only (get-attack-err) (var-get attack-err))
(define-read-only (get-attack-ok) (var-get attack-ok))
(define-read-only (get-attempted) (var-get attempted))

(define-public (get-gas-amount) (ok u${LEGIT_FEE}))

(define-private (attack)
  (begin
    ;; whatever the safe will see as tx-sender when we call back into it
    (var-set seen-tx-sender tx-sender)
    (var-set attempted true)
    (match ${probe}
      okv (begin (var-set attack-ok true) true)
      errv (begin (var-set attack-err errv) false)
    )))

;; Run the attack, then pay a real fee so the OUTER call succeeds and the
;; recorded evidence survives to be read.
(define-private (run)
  (begin
    (attack)
    (contract-call? '${SBTC} transfer u${LEGIT_FEE} contract-caller '${D} none)))

(define-public (pay-gas) (run))
(define-public (pay-gas-with-pyth) (run))`;

// A. re-enter stx-transfer: no STX allowance exists in the gas frame at all
const RE_STX = stationSrc(
  `(contract-call? SAFE stx-transfer u${STEAL_STX} '${ATTACKER} none none none)`);

// B. re-enter sip010-transfer for sBTC BELOW max-gas-amount, so the frame's one
//    allowance would cover the movement. Isolates the admin gate as the barrier.
const RE_SBTC = stationSrc(
  `(contract-call? SAFE sip010-transfer u${STEAL_SBTC} '${ATTACKER} none '${SBTC} "sbtc-token" none none)`);

// --- SIP-018 plumbing ----------------------------------------------------
const P = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const cvh = (cv) => { const o = serializeCV(cv); return typeof o === "string" ? sha256(Buffer.from(o, "hex")) : sha256(Buffer.from(o)); };
const dom = () => cvh(tupleCV({ name: stringAsciiCV("smart-wallet-standard"), version: stringAsciiCV("1.0.0"), "chain-id": uintCV(1), wallet: principalCV(WALLET) }));
const chal = (t) => sha256(Buffer.concat([P, dom(), cvh(t)]));
const tStx = (id, amt, rcpt) => tupleCV({ topic: stringAsciiCV("stx-transfer"), "auth-id": uintCV(id), amount: uintCV(amt), recipient: standardPrincipalCV(rcpt), memo: noneCV() });
const strip = (h) => (h.startsWith("0x") ? h.slice(2) : h);
const sa = (id, pk, s) => tupleCV({ "auth-id": uintCV(id), pubkey: bufferCV(Buffer.from(strip(pk), "hex")), signature: bufferCV(Buffer.from(strip(s.signatureHex), "hex")), "authenticator-data": bufferCV(Buffer.from(strip(s.authenticatorDataHex), "hex")), "client-data-prefix": bufferCV(Buffer.from(strip(s.clientDataPrefixHex), "hex")), "client-data-suffix": bufferCV(Buffer.from(strip(s.clientDataSuffixHex), "hex")) });
const key = generateP256Keypair();
const pubkeyCV = bufferCV(Buffer.from(strip(key.pubKeyHex), "hex"));
const signStx = (id, amt, rcpt) => sa(id, key.pubKeyHex, signChallengeWithRpId(chal(tStx(id, amt, rcpt)), key.privKey, RP_ID));

// --- harness -------------------------------------------------------------
const plan = [];
const b = SimulationBuilder.new({ stacksNodeAPI: API });
const call = (l, snd, cid, fn, args, exp) => {
  b.withSender(snd).addContractCall({ contract_id: cid, function_name: fn, function_args: args, post_condition_mode: PostConditionMode.Allow });
  plan.push({ l, exp });
};
const ev = (l, code, cap) => { b.addEvalCode(WALLET, code); plan.push({ l, cap, ev: true }); };
const note = (l) => plan.push({ l });
const ok = /^\(ok/;
const ro = (station, fn) => `(contract-call? '${D}.${station} ${fn})`;

for (const [name, src] of [["zz-reenter-stx", RE_STX], ["zz-reenter-sbtc", RE_SBTC]]) {
  b.withSender(D).addContractDeploy({ contract_name: name, source_code: src, clarity_version: ClarityVersion.Clarity6 });
  note(`deploy re-entrant station ${name}`);
}

call("set-verified-contract(juice-safe-v6)", D, CORE, "set-verified-contract", [principalCV(WALLET), noneCV()], ok);
call("onboard", FAKFUN_DEPLOYER, WALLET, "onboard",
  [pubkeyCV, standardPrincipalCV(OWNER), standardPrincipalCV(RECOVERY), uintCV(100_000_000), uintCV(100_000), uintCV(144)], ok);
b.withSender(STX_WHALE).addSTXTransfer({ recipient: WALLET, amount: STX_FUND });
note(`fund ${STX_FUND / 1e6} STX`);
call(`fund ${SBTC_FUND} sats sBTC`, OWNER, SBTC, "transfer",
  [uintCV(SBTC_FUND), standardPrincipalCV(OWNER), principalCV(WALLET), noneCV()], ok);

ev("safe principal (for comparison against what the station saw)", `'${WALLET}`, "safe");
ev("attacker STX BEFORE", `(stx-get-balance '${ATTACKER})`, "astx0");
ev("attacker sBTC BEFORE", `(contract-call? '${SBTC} get-balance '${ATTACKER})`, "asbtc0");
ev("safe STX BEFORE", `(stx-get-balance '${WALLET})`, "wstx0");

// --- A: re-enter stx-transfer -------------------------------------------
call("A signed stx-transfer relayed with the STX-re-entrant station (DIAGNOSTIC)",
  RELAYER, WALLET, "stx-transfer",
  [uintCV(XFER), standardPrincipalCV(RECIPIENT), noneCV(),
   someCV(signStx(1, XFER, RECIPIENT)), someCV(contractPrincipalCV(D, "zz-reenter-stx"))], null);
ev("A did the station even run?", ro("zz-reenter-stx", "get-attempted"), "a_try");
ev("A tx-sender the SAFE saw during pay-gas", ro("zz-reenter-stx", "get-seen-tx-sender"), "a_sender");
ev("A re-entrant stx-transfer error code", ro("zz-reenter-stx", "get-attack-err"), "a_err");
ev("A did the re-entrant call SUCCEED?", ro("zz-reenter-stx", "get-attack-ok"), "a_ok");
ev("attacker STX AFTER", `(stx-get-balance '${ATTACKER})`, "astx1");

// --- B: re-enter sip010-transfer within the gas allowance ----------------
call("B signed stx-transfer relayed with the sBTC-re-entrant station",
  RELAYER, WALLET, "stx-transfer",
  [uintCV(XFER), standardPrincipalCV(RECIPIENT), noneCV(),
   someCV(signStx(2, XFER, RECIPIENT)), someCV(contractPrincipalCV(D, "zz-reenter-sbtc"))], ok);
ev("B did the station even run?", ro("zz-reenter-sbtc", "get-attempted"), "b_try");
ev("B tx-sender the SAFE saw during pay-gas", ro("zz-reenter-sbtc", "get-seen-tx-sender"), "b_sender");
ev("B re-entrant sip010-transfer error code", ro("zz-reenter-sbtc", "get-attack-err"), "b_err");
ev("B did the re-entrant call SUCCEED?", ro("zz-reenter-sbtc", "get-attack-ok"), "b_ok");
ev("attacker sBTC AFTER", `(contract-call? '${SBTC} get-balance '${ATTACKER})`, "asbtc1");

// the safe itself must never appear in the admins map
ev("is-admin-calling(the safe's OWN principal)", `(is-admin-calling '${WALLET})`, "selfadmin");
ev("is-admin-calling(OWNER) as a control", `(is-admin-calling '${OWNER})`, "owneradmin");

// --- run -----------------------------------------------------------------
const id = await b.run();
const url = `https://stxer.xyz/simulations/mainnet/${id}`;
console.log(`\n${url}\n`);
const res = await getSimulationResult(id);
const dtx = (s) => { const t = s?.Result?.Transaction; if (!t) return "";
  if ("Err" in t) return `ABORT ${JSON.stringify(t.Err).slice(0, 200)}`;
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

const u = (x) => BigInt((String(x).match(/u(\d+)/) || [])[1] ?? "-1");
const chk = (l, c, extra) => { console.log(`${c ? "PASS" : "FAIL"} ${l}${extra ? `  (${extra})` : ""}`); c ? pass++ : fail++; };
const principal = (x) => String(x).replace(/^'/, "").trim();

console.log("\n--- derived checks ---");

// The premise. If this fails, the whole source-level argument was built on sand.
// Asserted on B, not A. A aborts the outer call, which rolls back its own
// recording, so a_sender reads as the initial burn-address default -- that is
// the rollback, not evidence about as-contract?.
chk("PREMISE: as-contract? rebound tx-sender to the SAFE's own principal",
  principal(cap.b_sender) === principal(cap.safe),
  `station saw ${cap.b_sender}`);
chk("the station really did attempt the re-entrant call",
  String(cap.b_try) === "true");

// A
// A is carried UNASSERTED: it aborts the outer call with (err none) on both
// juice-safe-v6 and fakfun-wallet-v14, and that is not yet diagnosed. The
// balance check below is the assertion that still means something.
console.log(`  A (unasserted): err=${cap.a_err} ok=${cap.a_ok} sender=${cap.a_sender}`);
chk(`A attacker gained no STX (tried to take ${STEAL_STX})`,
  u(cap.astx1) === u(cap.astx0), `${cap.astx0} -> ${cap.astx1}`);

// B -- inside the frame's sBTC allowance, so only the admin gate can stop it
chk(`B re-entrant sip010-transfer BELOW max-gas-amount also rejected u${ERR_UNAUTHORISED}`,
  u(cap.b_err) === BigInt(ERR_UNAUTHORISED), `got ${cap.b_err}`);
chk("B the re-entrant call did NOT succeed", String(cap.b_ok) === "false");
chk(`B attacker gained only the ${LEGIT_FEE * 0} sats it was owed, not the ${STEAL_SBTC} it grabbed for`,
  u(cap.asbtc1) === u(cap.asbtc0), `${cap.asbtc0} -> ${cap.asbtc1}`);

// the map itself
chk("is-admin-calling(safe's own principal) is an error: it is NOT in admins",
  /^\(err/.test(String(cap.selfadmin)), `${cap.selfadmin}`);
chk("control: is-admin-calling(OWNER) is ok",
  /^\(ok/.test(String(cap.owneradmin)), `${cap.owneradmin}`);

console.log(`\n=== ${pass} passed, ${fail} failed ===\n${url}`);
