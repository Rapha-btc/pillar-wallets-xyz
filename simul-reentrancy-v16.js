// simul-reentrancy-v16.js
// Repoint of simul-reentrancy-v14.js at the DEPLOYED fakfun-wallet-v16.
// onboard is unchanged here (pubkey only).
// simul-reentrancy-v14.js
//
// The fakfun-wallet-v16 twin of simul-reentrancy-v4.js
// (https://stxer.xyz/simulations/mainnet/269209165482e594bea782cd066b3b11).
// Same attack, same question: does a hostile gas station re-entering the wallet
// while tx-sender is the wallet itself get treated as an admin?
//
// v14 matters more than v4 here. It has 25 GAS-ENFORCED surfaces to v4's 13,
// including extension-call, wager-deposit and nine faktory-* functions, so it
// hands a caller-supplied station far more places to be invoked from.
//
// THE ATTACK. The station is chosen by whoever relays and is not covered by the
// signed hash (build-stx-transfer-hash covers only {topic, auth-id, amount,
// recipient, memo}). The wallet pays it inside
//   (as-contract? ((with-ft SBTC-CONTRACT "sbtc-token" (var-get max-gas-amount)))
//     (try! (contract-call? g pay-gas)))
// which rebinds tx-sender to the wallet's own principal. The station calls back
// in with sig-auth: none, hitting (is-authorized none) = (is-admin-calling
// tx-sender), where tx-sender IS the wallet. If the wallet trusted itself, a
// compromised relay alone would authorise arbitrary transfers.
//
// WHY IT SHOULD FAIL. Every write to `admins` in v14 takes a standard
// principal: 1722 confirm-transfer-wallet, 1990 confirm-admin-with-signature,
// 2107 recover-inactive-wallet. 2507 seeds the burn address and 1989 deletes
// it. The wallet's own contract principal is never inserted.
//
// The station records the tx-sender it observed into its own data-var, so the
// as-contract? rebinding premise is asserted on rather than assumed, and it
// swallows the inner response with `match` instead of `try!` so the inner error
// is observable rather than reverting the outer call.
//
// Variant B is the load-bearing one: it re-enters sip010-transfer for an amount
// BELOW max-gas-amount, so the gas frame's one allowance would have covered the
// movement. That isolates the admin gate as the barrier rather than the
// allowance. Variant A (stx-transfer, no STX allowance in the frame at all)
// aborted the outer call with (err none) on v4 and is carried here unasserted,
// to see whether v14 reproduces it.
//
// Onboarding is v14's three-step admin seating, lifted from simul-v14-full.js.
//   node simul-reentrancy-v14.js
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
const OWNER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";   // also holds sBTC
const RELAYER = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM";
const ATTACKER = "SP1MGH8BH1KRY49Z7EE5TY0JVKT6C3NT9RTVM8FND";
const RECIPIENT = "SP22WH53NS94VR6N145ZX77BK4S0EWFBE41VW3Z6B";
const STX_WHALE = "SP9BP4PN74CNR5XT7CMAMBPA0GWC9HMB69HVVV51";
const SBTC = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const WALLET = `${D}.fakfun-wallet-v16`;
const CORE = `${D}.fakfun-wallet-core`;
const API = "http://77.42.3.101/stacks-api";
const RP_ID = "fak.fun";                 // v14 whitelists fak.fun / fakfun.com
const COOLDOWN_BLOCKS = 440;             // pubkey-cooldown-period is u432

const ERR_UNAUTHORISED = 4001;
const DEFAULT_MAX_GAS = 1_000;

const STX_FUND = 500_000_000;
const SBTC_FUND = 200_000;
const LEGIT_FEE = 20;
const STEAL_STX = 1_000_000;   // 1 STX, under the default u100000000 threshold
const STEAL_SBTC = 500;        // under BOTH the u100000 threshold and max-gas-amount
const XFER = 100_000;          // the legitimate outer call

const TRAIT = `(impl-trait '${D}.gas-station-trait.gas-station-trait)`;

const stationSrc = (probe) => `${TRAIT}
(define-constant SAFE '${WALLET})
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
    (var-set seen-tx-sender tx-sender)
    (var-set attempted true)
    (match ${probe}
      okv (begin (var-set attack-ok true) true)
      errv (begin (var-set attack-err errv) false)
    )))

(define-private (run)
  (begin
    (attack)
    (contract-call? '${SBTC} transfer u${LEGIT_FEE} contract-caller '${D} none)))

(define-public (pay-gas) (run))
(define-public (pay-gas-with-pyth) (run))`;

const RE_STX = stationSrc(
  `(contract-call? SAFE stx-transfer u${STEAL_STX} '${ATTACKER} none none none)`);
const RE_SBTC = stationSrc(
  `(contract-call? SAFE sip010-transfer u${STEAL_SBTC} '${ATTACKER} none '${SBTC} "sbtc-token" none none)`);

// --- SIP-018 plumbing (v14 shapes, from simul-v14-full.js) ----------------
const P = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const cvh = (cv) => { const o = serializeCV(cv); return typeof o === "string" ? sha256(Buffer.from(o, "hex")) : sha256(Buffer.from(o)); };
const dom = () => cvh(tupleCV({ name: stringAsciiCV("smart-wallet-standard"), version: stringAsciiCV("1.0.0"), "chain-id": uintCV(1), wallet: principalCV(WALLET) }));
const chal = (t) => sha256(Buffer.concat([P, dom(), cvh(t)]));
const tAddAdmin = (id, a) => tupleCV({ topic: stringAsciiCV("add-admin"), "auth-id": uintCV(id), "new-admin": standardPrincipalCV(a) });
const tConfirmAdmin = (id, a) => tupleCV({ topic: stringAsciiCV("confirm-admin"), "auth-id": uintCV(id), "new-admin": standardPrincipalCV(a) });
const tStx = (id, amt, rcpt) => tupleCV({ topic: stringAsciiCV("stx-transfer"), "auth-id": uintCV(id), amount: uintCV(amt), recipient: standardPrincipalCV(rcpt), memo: noneCV() });
const strip = (h) => (h.startsWith("0x") ? h.slice(2) : h);
const sa = (id, pk, s) => tupleCV({ "auth-id": uintCV(id), pubkey: bufferCV(Buffer.from(strip(pk), "hex")), signature: bufferCV(Buffer.from(strip(s.signatureHex), "hex")), "authenticator-data": bufferCV(Buffer.from(strip(s.authenticatorDataHex), "hex")), "client-data-prefix": bufferCV(Buffer.from(strip(s.clientDataPrefixHex), "hex")), "client-data-suffix": bufferCV(Buffer.from(strip(s.clientDataSuffixHex), "hex")) });

const key = generateP256Keypair();
const pubkeyCV = bufferCV(Buffer.from(strip(key.pubKeyHex), "hex"));
const sign = (t) => signChallengeWithRpId(chal(t), key.privKey, RP_ID);
const sPropose = sign(tAddAdmin(1, OWNER));
const sConfirm = sign(tConfirmAdmin(2, OWNER));
const sStxA = sign(tStx(3, XFER, RECIPIENT));
const sStxB = sign(tStx(4, XFER, RECIPIENT));

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

for (const [name, src] of [["zz-reenter-stx-v14", RE_STX], ["zz-reenter-sbtc-v14", RE_SBTC]]) {
  b.withSender(D).addContractDeploy({ contract_name: name, source_code: src, clarity_version: ClarityVersion.Clarity6 });
  note(`deploy re-entrant station ${name}`);
}

// v14's three-step admin seating (onboard takes only the pubkey)
call("set-verified-contract(fakfun-wallet-v16)", D, CORE, "set-verified-contract",
  [principalCV(WALLET), noneCV()], ok);
call("onboard(pubkey)", FAKFUN_DEPLOYER, WALLET, "onboard", [pubkeyCV], ok);
call("propose-admin-with-signature(OWNER) (PASSKEY)", RELAYER, WALLET,
  "propose-admin-with-signature",
  [standardPrincipalCV(OWNER), sa(1, key.pubKeyHex, sPropose), noneCV()], ok);
call("accept-admin-proposal (from OWNER)", OWNER, WALLET, "accept-admin-proposal", [], ok);
b.addAdvanceBlocks({ bitcoin_blocks: COOLDOWN_BLOCKS, stacks_blocks_per_bitcoin: 1 });
note(`advance ${COOLDOWN_BLOCKS} (pubkey cooldown u432)`);
call("confirm-admin-with-signature (PASSKEY) -> admin seated", RELAYER, WALLET,
  "confirm-admin-with-signature", [sa(2, key.pubKeyHex, sConfirm), noneCV()], ok);

b.withSender(STX_WHALE).addSTXTransfer({ recipient: WALLET, amount: STX_FUND });
note(`fund ${STX_FUND / 1e6} STX`);
call(`fund ${SBTC_FUND} sats sBTC`, OWNER, SBTC, "transfer",
  [uintCV(SBTC_FUND), standardPrincipalCV(OWNER), principalCV(WALLET), noneCV()], ok);

ev("wallet principal (to compare against what the station saw)", `'${WALLET}`, "safe");
ev("owner after seating", "(get-owner)", "owner");
ev("attacker STX BEFORE", `(stx-get-balance '${ATTACKER})`, "astx0");
ev("attacker sBTC BEFORE", `(contract-call? '${SBTC} get-balance '${ATTACKER})`, "asbtc0");

// --- A: re-enter stx-transfer (no STX allowance in the gas frame) ---------
call("A signed stx-transfer relayed with the STX-re-entrant station",
  RELAYER, WALLET, "stx-transfer",
  [uintCV(XFER), standardPrincipalCV(RECIPIENT), noneCV(),
   someCV(sa(3, key.pubKeyHex, sStxA)), someCV(contractPrincipalCV(D, "zz-reenter-stx-v14"))], null);
ev("A did the station run?", ro("zz-reenter-stx-v14", "get-attempted"), "a_try");
ev("A tx-sender the WALLET saw", ro("zz-reenter-stx-v14", "get-seen-tx-sender"), "a_sender");
ev("A re-entrant error code", ro("zz-reenter-stx-v14", "get-attack-err"), "a_err");
ev("A did it SUCCEED?", ro("zz-reenter-stx-v14", "get-attack-ok"), "a_ok");
ev("attacker STX AFTER", `(stx-get-balance '${ATTACKER})`, "astx1");

// --- B: re-enter sip010-transfer INSIDE the gas allowance -----------------
call("B signed stx-transfer relayed with the sBTC-re-entrant station",
  RELAYER, WALLET, "stx-transfer",
  [uintCV(XFER), standardPrincipalCV(RECIPIENT), noneCV(),
   someCV(sa(4, key.pubKeyHex, sStxB)), someCV(contractPrincipalCV(D, "zz-reenter-sbtc-v14"))], ok);
ev("B did the station run?", ro("zz-reenter-sbtc-v14", "get-attempted"), "b_try");
ev("B tx-sender the WALLET saw", ro("zz-reenter-sbtc-v14", "get-seen-tx-sender"), "b_sender");
ev("B re-entrant error code", ro("zz-reenter-sbtc-v14", "get-attack-err"), "b_err");
ev("B did it SUCCEED?", ro("zz-reenter-sbtc-v14", "get-attack-ok"), "b_ok");
ev("attacker sBTC AFTER", `(contract-call? '${SBTC} get-balance '${ATTACKER})`, "asbtc1");

ev("is-admin-calling(the wallet's OWN principal)", `(is-admin-calling '${WALLET})`, "selfadmin");
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
const pr = (x) => String(x).replace(/^'/, "").trim();

console.log("\n--- derived checks ---");
chk("PREMISE: as-contract? rebound tx-sender to the WALLET's own principal",
  pr(cap.b_sender) === pr(cap.safe), `station saw ${cap.b_sender}`);
chk("the station really did attempt the re-entrant call", String(cap.b_try) === "true");
chk(`B re-entrant sip010-transfer BELOW max-gas-amount rejected u${ERR_UNAUTHORISED}`,
  u(cap.b_err) === BigInt(ERR_UNAUTHORISED), `got ${cap.b_err}`);
chk("B the re-entrant call did NOT succeed", String(cap.b_ok) === "false");
chk(`B attacker gained no sBTC (tried for ${STEAL_SBTC} sats)`,
  u(cap.asbtc1) === u(cap.asbtc0), `${cap.asbtc0} -> ${cap.asbtc1}`);
chk(`A attacker gained no STX (tried for ${STEAL_STX})`,
  u(cap.astx1) === u(cap.astx0), `${cap.astx0} -> ${cap.astx1}`);
chk("is-admin-calling(wallet's own principal) errors: it is NOT in admins",
  /^\(err/.test(String(cap.selfadmin)), `${cap.selfadmin}`);
chk("control: is-admin-calling(OWNER) is ok",
  /^\(ok/.test(String(cap.owneradmin)), `${cap.owneradmin}`);
console.log(`\n  A (unasserted, v4 gave (err none)): err=${cap.a_err} ok=${cap.a_ok} sender=${cap.a_sender}`);

console.log(`\n=== ${pass} passed, ${fail} failed ===\n${url}`);
