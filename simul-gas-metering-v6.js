// simul-gas-metering-v6.js
// Repoint of simul-gas-metering-v4.js at the DEPLOYED juice-safe-v6.
// onboard now takes SIX args -- recovery is a bare principal, not an optional,
// and cooldown-period is caller-supplied instead of hardcoded u144.
// simul-gas-metering-v4.js
//
// The v4 delta with ZERO existing coverage. simul-max-gas-cooldown.js tests the
// two-step raise of max-gas-amount (v2 code); nothing tests what v3/v4 actually
// added: pay-gas-accounted MEASURES the fee and FUSES it.
//
// Six properties, each with a station built to break exactly one:
//
//   1. DELTA, NOT SELF-REPORT. The fee charged is the wallet's own sBTC balance
//      delta across pay-gas, never <gas-trait>'s get-gas-amount. The station is
//      caller-supplied, so anything it says about itself is unverified. A LIAR
//      station reports u9999 and takes u10; the counter must move by u10.
//
//   2. CREDIT FLOORS AT ZERO. A station that sends sBTC IN is charged u0, not an
//      underflow, and credits do NOT refill the budget.
//
//   3. THE FUSE. gas is capped at max-gas-amount * GAS-CALLS-PER-PERIOD u25 =
//      u25000 at the u1000 default. The check is `gas-so-far + fee > cap` BEFORE
//      the counter moves, so with u10 already spent the 25th full-price call is
//      the one that crosses (24010 + 1000 > 25000) and reverts u4018.
//
//   4. NO CROSSTALK. gas and sbtc are disjoint counters. With the fuse fully
//      blown, an under-threshold sBTC transfer must STILL execute immediately.
//      If it queues as a pending op, the two channels have been merged and the
//      rejected "count it in sbtc too" design has crept back in.
//
//   5. A BLOWN FUSE IS NOT A LOCKOUT. Two ways through with the fuse spent:
//      self-broadcast with gas: none (the passkey still authorises it), and the
//      admin EOA with no sig-auth. Both must succeed.
//
//   6. THE PERIOD ROLLS. After cooldown-period blocks the gas counter resets and
//      a relayed call works again.
//
// Run against the DEPLOYED juice-safe-v6. Nothing is redeployed except the
// stations.
//   node simul-gas-metering-v4.js
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

// Contract constants, mirrored so the expectations are derived not guessed.
const DEFAULT_MAX_GAS = 1_000;          // max-gas-amount initial value
const GAS_CALLS_PER_PERIOD = 25;        // GAS-CALLS-PER-PERIOD
const CAP = DEFAULT_MAX_GAS * GAS_CALLS_PER_PERIOD;   // max-gas-per-period

const LIAR_TAKES = 10;
const LIAR_CLAIMS = 9_999;
const CREDIT_SENDS = 50;

// After the liar's u10, each full-price call adds u1000. The fuse trips on the
// call where gas-so-far + fee crosses CAP:
//   before call k (1-indexed): 10 + 1000*(k-1);  trips when that + 1000 > 25000
//   => k = 25.  So 24 pass and the 25th reverts.
const FULL_CALLS = 25;
const EXPECT_FULL_PASSES = 24;

const STX_FUND = 800_000_000;           // 800 STX
const SBTC_FUND = 500_000;              // sats, well clear of the cap
const STAKE = 100_000_000;              // 100 STX opening position
const TOPUP = 1_000_000;                // 1 STX per gasless top-up
const FUSE_STX = 100_000;               // 0.1 STX per fuse call
const WD_SBTC_UNDER = 1_000;            // under the u100000 default threshold

// --- the three stations --------------------------------------------------
const TRAIT = `(impl-trait '${D}.gas-station-trait.gas-station-trait)`;

// Property 1: claims LIAR_CLAIMS, takes LIAR_TAKES.
const LIAR = `${TRAIT}
(define-public (get-gas-amount) (ok u${LIAR_CLAIMS}))
(define-public (pay-gas)
  (contract-call? '${SBTC} transfer u${LIAR_TAKES} contract-caller '${ATTACKER} none))
(define-public (pay-gas-with-pyth)
  (contract-call? '${SBTC} transfer u${LIAR_TAKES} contract-caller '${ATTACKER} none))`;

// Property 3: takes the whole max-gas-amount every call.
const FULL = `${TRAIT}
(define-public (get-gas-amount) (ok u${DEFAULT_MAX_GAS}))
(define-public (pay-gas)
  (contract-call? '${SBTC} transfer u${DEFAULT_MAX_GAS} contract-caller '${ATTACKER} none))
(define-public (pay-gas-with-pyth)
  (contract-call? '${SBTC} transfer u${DEFAULT_MAX_GAS} contract-caller '${ATTACKER} none))`;

// Property 2: sends sBTC IN. contract-caller is captured BEFORE as-contract?,
// which would otherwise rebind it to the station itself.
const CREDIT = `${TRAIT}
(define-public (get-gas-amount) (ok u0))
(define-private (credit)
  (let ((payee contract-caller))
    (unwrap-panic (as-contract? ((with-ft '${SBTC} "sbtc-token" u${CREDIT_SENDS}))
      (unwrap-panic (contract-call? '${SBTC} transfer u${CREDIT_SENDS} current-contract payee none))))))
(define-public (pay-gas) (begin (credit) (ok true)))
(define-public (pay-gas-with-pyth) (begin (credit) (ok true)))`;

// --- SIP-018 challenge plumbing (identical to the lifecycle harness) -----
const P = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const cvh = (cv) => { const o = serializeCV(cv); return typeof o === "string" ? sha256(Buffer.from(o, "hex")) : sha256(Buffer.from(o)); };
const dom = () => cvh(tupleCV({ name: stringAsciiCV("smart-wallet-standard"), version: stringAsciiCV("1.0.0"), "chain-id": uintCV(1), wallet: principalCV(WALLET) }));
const chal = (t) => sha256(Buffer.concat([P, dom(), cvh(t)]));
const tStake = (id, amt) => tupleCV({ topic: stringAsciiCV("stake-stx-juice-pox5"), "auth-id": uintCV(id), "amount-ustx": uintCV(amt) });
const tUpdate = (id, inc, cyc) => tupleCV({ topic: stringAsciiCV("update-stake-stx-juice"), "auth-id": uintCV(id), "amount-increase": uintCV(inc), "cycles-to-extend": uintCV(cyc) });
const strip = (h) => (h.startsWith("0x") ? h.slice(2) : h);
const sa = (id, pk, s) => tupleCV({ "auth-id": uintCV(id), pubkey: bufferCV(Buffer.from(strip(pk), "hex")), signature: bufferCV(Buffer.from(strip(s.signatureHex), "hex")), "authenticator-data": bufferCV(Buffer.from(strip(s.authenticatorDataHex), "hex")), "client-data-prefix": bufferCV(Buffer.from(strip(s.clientDataPrefixHex), "hex")), "client-data-suffix": bufferCV(Buffer.from(strip(s.clientDataSuffixHex), "hex")) });

const key = generateP256Keypair();
const pubkeyCV = bufferCV(Buffer.from(strip(key.pubKeyHex), "hex"));
let authId = 0;
const nextId = () => ++authId;
// Every signed call needs its own auth-id: signatures are single-use.
const signStake = (id, amt) => sa(id, key.pubKeyHex, signChallengeWithRpId(chal(tStake(id, amt)), key.privKey, RP_ID));
const signUpdate = (id, inc, cyc) => sa(id, key.pubKeyHex, signChallengeWithRpId(chal(tUpdate(id, inc, cyc)), key.privKey, RP_ID));
// Mirrors helpers-v7 build-stx-transfer-hash exactly.
const tStx = (id, amt, rcpt) => tupleCV({ topic: stringAsciiCV("stx-transfer"), "auth-id": uintCV(id), amount: uintCV(amt), recipient: standardPrincipalCV(rcpt), memo: noneCV() });
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
const station = (n) => someCV(contractPrincipalCV(D, n));

for (const [name, src] of [["zz-gas-liar", LIAR], ["zz-gas-full", FULL], ["zz-gas-credit", CREDIT]]) {
  b.withSender(D).addContractDeploy({ contract_name: name, source_code: src, clarity_version: ClarityVersion.Clarity6 });
  note(`deploy station ${name}`);
}

call("set-verified-contract(juice-safe-v6)", D, CORE, "set-verified-contract", [principalCV(WALLET), noneCV()], ok);
call("onboard", FAKFUN_DEPLOYER, WALLET, "onboard",
  [pubkeyCV, standardPrincipalCV(OWNER), standardPrincipalCV(RECOVERY), uintCV(100_000_000), uintCV(100_000), uintCV(144)], ok);
b.withSender(STX_WHALE).addSTXTransfer({ recipient: WALLET, amount: STX_FUND });
note(`fund ${STX_FUND / 1e6} STX`);
call(`fund ${SBTC_FUND} sats sBTC -> wallet`, OWNER, SBTC, "transfer",
  [uintCV(SBTC_FUND), standardPrincipalCV(OWNER), principalCV(WALLET), noneCV()], ok);
call(`fund ${CREDIT_SENDS * 4} sats sBTC -> zz-gas-credit`, OWNER, SBTC, "transfer",
  [uintCV(CREDIT_SENDS * 4), standardPrincipalCV(OWNER), principalCV(`${D}.zz-gas-credit`), noneCV()], ok);

ev("max-gas-amount (expect u1000)", "(var-get max-gas-amount)", "maxgas");
ev("spent-this-period at start", "(var-get spent-this-period)", "s0");
ev("attacker sBTC at start", `(contract-call? '${SBTC} get-balance '${ATTACKER})`, "a0");
ev("wallet sBTC at start", `(contract-call? '${SBTC} get-balance '${WALLET})`, "w0");

// --- property 1: the LIAR ------------------------------------------------
{
  const id = nextId();
  call(`P1 stake via RELAYER + LIAR station (claims u${LIAR_CLAIMS}, takes u${LIAR_TAKES})`,
    RELAYER, WALLET, "stake-stx-juice",
    [uintCV(STAKE), someCV(signStake(id, STAKE)), station("zz-gas-liar")], ok);
}
ev("spent-this-period after the liar", "(var-get spent-this-period)", "s1");
ev("attacker sBTC after the liar", `(contract-call? '${SBTC} get-balance '${ATTACKER})`, "a1");

// --- property 2: the CREDIT station --------------------------------------
{
  const id = nextId();
  call(`P2 top-up via RELAYER + CREDIT station (sends u${CREDIT_SENDS} IN)`,
    RELAYER, WALLET, "update-stake-stx-juice",
    [uintCV(TOPUP), uintCV(0), someCV(signUpdate(id, TOPUP, 0)), station("zz-gas-credit")], ok);
}
ev("spent-this-period after the credit", "(var-get spent-this-period)", "s2");
ev("wallet sBTC after the credit", `(contract-call? '${SBTC} get-balance '${WALLET})`, "w2");

// --- property 3: the FUSE ------------------------------------------------
const fuseIdx = [];
for (let k = 1; k <= FULL_CALLS; k++) {
  const id = nextId();
  fuseIdx.push(plan.length);
  call(`P3 SIGNED full-price gasless stx-transfer #${k}`, RELAYER, WALLET, "stx-transfer",
    [uintCV(FUSE_STX), standardPrincipalCV(RECIPIENT), noneCV(),
     someCV(signStx(id, FUSE_STX, RECIPIENT)), station("zz-gas-full")], null);
}
ev("spent-this-period with the fuse spent", "(var-get spent-this-period)", "s3");
ev("attacker sBTC with the fuse spent", `(contract-call? '${SBTC} get-balance '${ATTACKER})`, "a3");

// P3b. Found the hard way in run 2. `gas` is matched INSIDE the sig-auth
// Some-branch, so an UNSIGNED admin call silently ignores the station: it
// succeeds and is charged nothing, even with the fuse fully blown. Not a
// vulnerability -- it is why a stolen admin key alone cannot drain via gas --
// but a relayer that broadcasts an admin-path call expecting to be paid gets
// nothing, and no error says so.
call("P3b UNSIGNED admin call + station: station IGNORED, no charge", OWNER, WALLET,
  "stx-transfer",
  [uintCV(FUSE_STX), standardPrincipalCV(RECIPIENT), noneCV(), noneCV(), station("zz-gas-full")], ok);
ev("spent-this-period after the UNSIGNED attempt (gas must NOT move)", "(var-get spent-this-period)", "s3b");

// --- property 4: no crosstalk -------------------------------------------
ev("recipient sBTC BEFORE the sBTC transfer", `(contract-call? '${SBTC} get-balance '${RECIPIENT})`, "r4a");
call(`P4 sip010-transfer ${WD_SBTC_UNDER} sats sBTC (UNDER threshold) with the fuse spent`,
  OWNER, WALLET, "sip010-transfer",
  [uintCV(WD_SBTC_UNDER), standardPrincipalCV(RECIPIENT), noneCV(),
   contractPrincipalCV("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token"),
   stringAsciiCV("sbtc-token"), noneCV(), noneCV()], ok);
ev("recipient sBTC AFTER", `(contract-call? '${SBTC} get-balance '${RECIPIENT})`, "r4b");
ev("spent-this-period after the transfer (sbtc moved, gas did not)", "(var-get spent-this-period)", "s4");

// --- property 5: not a lockout ------------------------------------------
{
  const id = nextId();
  call("P5a passkey top-up with gas: NONE despite the blown fuse -> ok",
    RELAYER, WALLET, "update-stake-stx-juice",
    [uintCV(TOPUP), uintCV(0), someCV(signUpdate(id, TOPUP, 0)), noneCV()], ok);
}
call("P5b ADMIN EOA top-up, no sig-auth, no gas -> ok",
  OWNER, WALLET, "update-stake-stx-juice",
  [uintCV(TOPUP), uintCV(0), noneCV(), noneCV()], ok);

// --- property 6: the period rolls ---------------------------------------
b.addAdvanceBlocks({ bitcoin_blocks: 150, stacks_blocks_per_bitcoin: 1 });
note("advance 150 burn blocks (past the u144 cooldown-period)");
{
  const id = nextId();
  call("P6 full-price gasless top-up after the period rolled -> ok",
    RELAYER, WALLET, "update-stake-stx-juice",
    [uintCV(TOPUP), uintCV(0), someCV(signUpdate(id, TOPUP, 0)), station("zz-gas-full")], ok);
}
ev("spent-this-period after the roll (gas restarted from this fee)", "(var-get spent-this-period)", "s6");

// --- run -----------------------------------------------------------------
const id = await b.run();
const url = `https://stxer.xyz/simulations/mainnet/${id}`;
console.log(`\n${url}\n`);
const res = await getSimulationResult(id);
const dtx = (s) => { const t = s?.Result?.Transaction; if (!t) return ""; 
  if ("Err" in t) return `ABORT ${JSON.stringify(t.Err).slice(0, 220)}`;
  return cvToString(deserializeCV(t.Ok.result)); };
const dev = (s) => { const e = s?.Result?.Eval; return e && "Ok" in e ? cvToString(deserializeCV(e.Ok)) : "?"; };

let pass = 0, fail = 0;
const cap = {};
const got = [];
res.steps.forEach((s, i) => {
  const p = plan[i]; if (!p) return;
  if (p.ev) { const v = dev(s); if (p.cap) cap[p.cap] = v; console.log(`INFO  ${p.l}\n        ${v}`); return; }
  const d = dtx(s); got[i] = d;
  if (!p.exp) { console.log(`      ${p.l} -> ${d}`); return; }
  const good = p.exp instanceof RegExp ? p.exp.test(d) : d === p.exp;
  console.log(`${good ? "PASS" : "FAIL"}  ${p.l} -> ${d}`);
  good ? pass++ : fail++;
});

const u = (x) => BigInt((String(x).match(/u(\d+)/) || [])[1] ?? "-1");
const fld = (t, f) => BigInt((String(t).match(new RegExp(`\\(${f} u(\\d+)\\)`)) || [])[1] ?? "-1");
const chk = (l, c, extra) => { console.log(`${c ? "PASS" : "FAIL"} ${l}${extra ? `  (${extra})` : ""}`); c ? pass++ : fail++; };

console.log("\n--- derived checks ---");
chk(`max-gas-amount is the u${DEFAULT_MAX_GAS} default, so the cap is u${CAP}`,
  u(cap.maxgas) === BigInt(DEFAULT_MAX_GAS), `read ${cap.maxgas}`);

// P1
chk(`P1 fee charged is the u${LIAR_TAKES} DELTA, not the u${LIAR_CLAIMS} self-report`,
  fld(cap.s1, "gas") === BigInt(LIAR_TAKES),
  `gas ${fld(cap.s0, "gas")} -> ${fld(cap.s1, "gas")}`);
chk(`P1 the attacker actually received u${LIAR_TAKES}`,
  u(cap.a1) - u(cap.a0) === BigInt(LIAR_TAKES));

// P2
chk("P2 a credit station is charged u0, the counter does NOT move",
  fld(cap.s2, "gas") === fld(cap.s1, "gas"),
  `gas ${fld(cap.s1, "gas")} -> ${fld(cap.s2, "gas")}`);
chk(`P2 the credit did NOT refill the budget (wallet sBTC rose by u${CREDIT_SENDS})`,
  u(cap.w2) > u(cap.w0));

// P3
const fuseResults = fuseIdx.map((i) => got[i] ?? "");
const passes = fuseResults.filter((r) => /^\(ok/.test(r)).length;
const firstFail = fuseResults.findIndex((r) => !/^\(ok/.test(r));
chk(`P3 exactly ${EXPECT_FULL_PASSES} full-price signed calls fit under the u${CAP} cap`,
  passes === EXPECT_FULL_PASSES, `${passes} passed`);
chk(`P3 call #${EXPECT_FULL_PASSES + 1} is the one that trips the fuse`,
  firstFail === EXPECT_FULL_PASSES, `first failure at #${firstFail + 1}`);
chk("P3 the trip is err-threshold-exceeded u4018, not a generic abort",
  firstFail >= 0 && fuseResults[firstFail] === "(err u4018)",
  `got ${fuseResults[firstFail]}`);
chk(`P3 gas landed at or below the cap u${CAP}`,
  fld(cap.s3, "gas") <= BigInt(CAP), `gas ${fld(cap.s3, "gas")}`);
chk("P3 the fuse actually got near the cap (not a no-charge false green)",
  fld(cap.s3, "gas") >= BigInt(CAP) - BigInt(DEFAULT_MAX_GAS), `gas ${fld(cap.s3, "gas")}`);

// P3b
chk("P3b an UNSIGNED call ignores the station and is charged nothing",
  fld(cap.s3b, "gas") === fld(cap.s3, "gas"),
  `gas ${fld(cap.s3, "gas")} -> ${fld(cap.s3b, "gas")}`);

// P4
chk(`P4 the under-threshold sBTC transfer MOVED u${WD_SBTC_UNDER} with the fuse spent`,
  u(cap.r4b) - u(cap.r4a) === BigInt(WD_SBTC_UNDER),
  `recipient delta ${u(cap.r4b) - u(cap.r4a)}`);
chk("P4 that transfer hit the sbtc counter and left gas alone",
  fld(cap.s4, "sbtc") > fld(cap.s3b, "sbtc") && fld(cap.s4, "gas") === fld(cap.s3b, "gas"),
  `sbtc ${fld(cap.s3b, "sbtc")} -> ${fld(cap.s4, "sbtc")}, gas ${fld(cap.s4, "gas")}`);

// P6
chk("P6 the period rolled and the gas counter restarted from this fee alone",
  fld(cap.s6, "gas") < fld(cap.s4, "gas") && fld(cap.s6, "gas") === BigInt(DEFAULT_MAX_GAS),
  `gas ${fld(cap.s4, "gas")} -> ${fld(cap.s6, "gas")}`);
chk("P6 period-start advanced",
  fld(cap.s6, "period-start") > fld(cap.s0, "period-start"));

console.log(`\n=== ${pass} passed, ${fail} failed ===\n${url}`);
