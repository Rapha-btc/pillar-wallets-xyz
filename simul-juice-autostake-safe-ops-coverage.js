// simul-juice-autostake-safe-ops-coverage.js
// Stxer mainnet-fork harness for the juice-autostake-safe functions that
// simul-juice-autostake-safe.js never reaches: max gas, token lock, wallet
// config, the pending-operation queue (STX, sBTC, sBTC withdrawal) with plain
// and passkey ("now") execution, veto, SIP-010 / SIP-009 transfers, and the
// recovery-address change.
//
// Deploy bytes: the safe and its helper are deployed from
// jing-contracts-v3/simulations/deploy-bytes-mv7dfb/ unchanged (sha256 checked
// against SHA256SUMS.txt), the safe as Clarity 6 and the helper as Clarity 4,
// under SPV9K21....juice-autostake-safe, so trace-coverage.mjs --by-source
// counts this sim. The safe names SPV9K21....juice-pool-sbtc-signer, which is
// not on mainnet, so the pool (with the Jing stack, trait-v2 and autoswap its
// deploy needs) is deployed first from the same folder, as REAL_POOL=1 does in
// simul-juice-autostake-safe.js. Nothing here stakes, so the pool is not
// registered with pox-5.
//
// Funding: STX from SP354663...X1RR, sBTC and LEO from SP2C7B...7QN2 (also
// the safe owner), bitcoin-pepe NFTs #5 and #100 from their mainnet owner
// SPY3VW...2M6 (impersonated). Every value step asserts the exact change of
// the safe's and the recipient's STX, sBTC (available + locked), LEO and the
// NFT owner. Passkey calls that pass the gas station also assert the safe paid
// exactly get-gas sats.
//
// Op ids (operation-nonce starts at 0):
//   op0 admin STX over   op1 passkey STX over   op2 admin STX (vetoed by passkey)
//   op3 admin STX (execute-now)
//   op4 admin sBTC (execute-now)  op5 passkey sBTC  op6 admin sBTC (vetoed by admin)
//   op7 admin withdrawal (execute-now)  op8 passkey withdrawal
//   op9 admin withdrawal (vetoed by passkey)
//   op10/op11/op12 admin STX / sBTC / withdrawal (execute-now without gas)
//
// Paths not reachable on a fork (documented, not asserted):
//   - pay-gas-accounted u4018 (gas over max-gas * 25 per period): needs 25+
//     gas-paid calls inside one cooldown period at the live 20-sat fee.
//   - pay-gas-accounted fee = 0 arm: the live gas station always charges.
//   - consume-signature second replay check (used assertion id with a new
//     message hash): a WebAuthn signature verifies for one message hash only,
//     so the first check (used message hash) always fires first.
//   - execute-pending-sbtc-withdrawal(-now) payload unwrap / decode errors: a
//     "sbtc-withdraw" op is only created with a well-formed payload.
//
// Run: node --import ~/projects/jing-contracts-v3/simulations/_use-deploy-bytes.mjs simul-juice-autostake-safe-ops-coverage.js
//   (the preload is optional: the harness reads the deploy-bytes files directly)
import crypto from "node:crypto";
import fs from "node:fs";
import {
  tupleCV,
  uintCV,
  bufferCV,
  noneCV,
  someCV,
  trueCV,
  falseCV,
  principalCV,
  standardPrincipalCV,
  contractPrincipalCV,
  stringAsciiCV,
  serializeCV,
  deserializeCV,
  cvToString,
  ClarityVersion,
  PostConditionMode,
} from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";
import { generateP256Keypair, signChallengeWithRpId } from "./lib-webauthn-test-signer.mjs";
import { installChunkedSubmit } from "./_chunked-submit.mjs";
installChunkedSubmit(60);

// -- actors ------------------------------------------------------------------
const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const OWNER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";   // admin + sBTC/LEO whale
const RECOVERY = "SP3HXJJMJQ06GNAZ8XWDN1QM48JEDC6PP6W3YZPZJ";
const RANDOM = "SP1MGH8BH1KRY49Z7EE5TY0JVKT6C3NT9RTVM8FND";
const RELAYER = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM";
const RECIPIENT = "SP22WH53NS94VR6N145ZX77BK4S0EWFBE41VW3Z6B";
const STX_WHALE = "SP354663MXNWN2B6HKNBYD8JBNJK2ZNBZE764X1RR";
const NFT_OWNER = "SPY3VW50YQCEWD905SSBPVF55D1E502ZV24TE2M6";  // holds bitcoin-pepe #5 and #100
const NEW_RECOVERY = STX_WHALE;
const NEW_OWNER = NFT_OWNER;

// -- contracts ---------------------------------------------------------------
const WALLET_NAME = "juice-autostake-safe";
const HELPER_NAME = "juice-autostake-safe-auth-helpers-v1";
const WALLET = `${DEPLOYER}.${WALLET_NAME}`;
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core-v2`;
const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const LEO_TOKEN = "SP1AY6K3PQV5MRT6R4S671NWW2FRVPKM0BR162CT6.leo-token";
const NFT = "SP16SRR777TVB1WS5XSS9QT3YEZEC9JQFKYZENRAJ.bitcoin-pepe";
const NFT_A = 5, NFT_B = 100;
const GAS_STATION = "gas-station";
const CLARITY_6 = ClarityVersion.Clarity6 ?? 6;
const DB = `${process.env.HOME}/projects/jing-contracts-v3/simulations/deploy-bytes-mv7dfb`;

const STACKS_NODE_API = "http://77.42.3.101/stacks-api";
const RP_ID = "juiceofbtc.com";
const RP_WRONG = "example.com";

// -- amounts -----------------------------------------------------------------
const STX_THR = 100_000_000, SBTC_THR = 100_000, COOLDOWN = 144;
const FUND_STX = 1_000_000_000;   // 1000 STX
const FUND_SBTC = 1_200_000;
const FUND_LEO = 1_000_000;
const STX_UNDER = 10_000_000, STX_OVER = 150_000_000, STX_LOCKED_ADMIN = 5_000_000, STX_AFTER_RESET = 90_000_000;
const SBTC_UNDER = 10_000, SBTC_OVER = 150_000, LEO_AMT = 1_000;
const WD_UNDER = 20_000, WD_UNDER_FEE = 3_000, WD_OVER = 120_000, WD_OVER_FEE = 1_000;
const BTC_RCPT = { version: Buffer.from("04", "hex"), hashbytes: Buffer.from("aa".repeat(20), "hex") }; // P2WPKH
const NEW_GAS = 2_000;
const NEW_CFG = { stx: 200_000_000, sbtc: 200_000, cooldown: 150 };
const MEMO = Buffer.from("6f70732d636f766572616765", "hex"); // "ops-coverage"

// -- SIP-018 (mirrors smart-wallet-standard-auth-helpers-v7/v8/v10, mm-safe-auth-helpers-v1)
const SIP018_PREFIX = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const cvSha256 = (cv) => {
  const out = serializeCV(cv);
  return sha256(Buffer.from(typeof out === "string" ? out : Buffer.from(out).toString("hex"), "hex"));
};
const domainHash = cvSha256(tupleCV({
  name: stringAsciiCV("smart-wallet-standard"),
  version: stringAsciiCV("1.0.0"),
  "chain-id": uintCV(1),
  wallet: principalCV(WALLET),
}));
const challenge = (t) => sha256(Buffer.concat([SIP018_PREFIX, domainHash, cvSha256(t)]));
const T = {
  maxGas: (a, amount) => tupleCV({ topic: stringAsciiCV("confirm-max-gas-amount"), "auth-id": uintCV(a), amount: uintCV(amount) }),
  cfg: (a, s, b, c) => tupleCV({ topic: stringAsciiCV("set-wallet-config"), "auth-id": uintCV(a), "stx-threshold": uintCV(s), "sbtc-threshold": uintCV(b), "cooldown-period": uintCV(c) }),
  lock: (a, en) => tupleCV({ topic: stringAsciiCV("toggle-token-lock"), "auth-id": uintCV(a), enabled: en ? trueCV() : falseCV() }),
  veto: (a, op) => tupleCV({ topic: stringAsciiCV("veto-operation"), "auth-id": uintCV(a), "op-id": uintCV(op) }),
  now: (a, op) => tupleCV({ topic: stringAsciiCV("execute-now"), "auth-id": uintCV(a), "op-id": uintCV(op) }),
  stx: (a, amount, to, memo) => tupleCV({ topic: stringAsciiCV("stx-transfer"), "auth-id": uintCV(a), amount: uintCV(amount), recipient: principalCV(to), memo: memo ? someCV(bufferCV(memo)) : noneCV() }),
  ft: (a, amount, to, token) => tupleCV({ topic: stringAsciiCV("sip010-transfer"), "auth-id": uintCV(a), amount: uintCV(amount), recipient: principalCV(to), memo: noneCV(), sip010: principalCV(token) }),
  wd: (a, amount, fee) => tupleCV({ topic: stringAsciiCV("sbtc-withdrawal"), "auth-id": uintCV(a), amount: uintCV(amount), recipient: tupleCV({ version: bufferCV(BTC_RCPT.version), hashbytes: bufferCV(BTC_RCPT.hashbytes) }), "max-fee": uintCV(fee) }),
  nft: (a, id, to) => tupleCV({ topic: stringAsciiCV("sip009-transfer"), "auth-id": uintCV(a), "nft-id": uintCV(id), recipient: principalCV(to), sip009: principalCV(NFT) }),
  recovery: (a, r) => tupleCV({ topic: stringAsciiCV("propose-recovery"), "auth-id": uintCV(a), "new-recovery": principalCV(r) }),
  xfer: (a, to) => tupleCV({ topic: stringAsciiCV("confirm-transfer"), "auth-id": uintCV(a), "new-admin": principalCV(to) }),
};
const strip = (h) => (h.startsWith("0x") ? h.slice(2) : h);

async function readOnly(cid, fn, args = []) {
  const [addr, name] = cid.split(".");
  const r = await (await fetch(`${STACKS_NODE_API}/v2/contracts/call-read/${addr}/${name}/${fn}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sender: addr, arguments: args.map((c) => "0x" + strip(serializeCV(c))) }),
  })).json();
  return cvToString(deserializeCV(strip(r.result)));
}

async function main() {
  // -- exact deploy bytes ----------------------------------------------------
  const sums = Object.fromEntries(fs.readFileSync(`${DB}/SHA256SUMS.txt`, "utf8").trim().split("\n")
    .map((l) => l.trim().split(/\s+/)).map(([f, , h]) => [f, h]));
  const src = (n) => {
    const s = fs.readFileSync(`${DB}/${n}.clar`, "utf8");
    const h = crypto.createHash("sha256").update(s).digest("hex");
    if (sums[`${n}.clar`] !== h) throw new Error(`${n}: sha256 ${h} != SHA256SUMS (${sums[`${n}.clar`]})`);
    return { s, h };
  };
  const safe = src(WALLET_NAME), helper = src(HELPER_NAME);

  const GAS = BigInt((await readOnly(`${DEPLOYER}.${GAS_STATION}`, "get-gas")).replace(/^u/, ""));
  console.log(`live gas-station fee: ${GAS} sats`);

  const key = generateP256Keypair();
  const key2 = generateP256Keypair(); // never registered
  const pub = bufferCV(Buffer.from(strip(key.pubKeyHex), "hex"));
  const sigTuple = (authId, s, pk = key.pubKeyHex) => tupleCV({
    "auth-id": uintCV(authId),
    pubkey: bufferCV(Buffer.from(strip(pk), "hex")),
    signature: bufferCV(Buffer.from(strip(s.signatureHex), "hex")),
    "authenticator-data": bufferCV(Buffer.from(strip(s.authenticatorDataHex), "hex")),
    "client-data-prefix": bufferCV(Buffer.from(strip(s.clientDataPrefixHex), "hex")),
    "client-data-suffix": bufferCV(Buffer.from(strip(s.clientDataSuffixHex), "hex")),
  });
  // signed sig-auth: `t` is the topic tuple the wallet will rebuild
  const auth = (authId, t, { rp = RP_ID, k = key } = {}) => sigTuple(authId, signChallengeWithRpId(challenge(t), k.privKey, rp), k.pubKeyHex);
  const sAuth = (...a) => someCV(auth(...a));
  const GASCV = someCV(contractPrincipalCV(DEPLOYER, GAS_STATION));
  const btcRcpt = tupleCV({ version: bufferCV(BTC_RCPT.version), hashbytes: bufferCV(BTC_RCPT.hashbytes) });

  const plan = [];
  const b = SimulationBuilder.new({ stacksNodeAPI: STACKS_NODE_API });
  const okre = /^\(ok/;
  const evalc = (label, code, capture) => { b.addEvalCode(WALLET, code); plan.push({ kind: "eval", label, capture }); };
  const step = (label) => plan.push({ kind: "fund", label });
  const call = (label, sender, cid, fn, args, expect, capture) => {
    b.withSender(sender).addContractCall({ contract_id: cid, function_name: fn, function_args: args, post_condition_mode: PostConditionMode.Allow });
    plan.push({ kind: "tx", label, expect, capture });
  };
  const w = (label, sender, fn, args, expect, capture) => call(label, sender, WALLET, fn, args, expect, capture);
  // balances snapshot: one eval returning a tuple
  const BAL = `{ ss: (stx-get-balance '${WALLET}), rs: (stx-get-balance '${RECIPIENT}),
    sb: (unwrap-panic (contract-call? '${SBTC_TOKEN} get-balance-available '${WALLET})),
    sl: (unwrap-panic (contract-call? '${SBTC_TOKEN} get-balance-locked '${WALLET})),
    rb: (unwrap-panic (contract-call? '${SBTC_TOKEN} get-balance '${RECIPIENT})),
    sf: (unwrap-panic (contract-call? '${LEO_TOKEN} get-balance '${WALLET})),
    rf: (unwrap-panic (contract-call? '${LEO_TOKEN} get-balance '${RECIPIENT})) }`;
  const moves = []; // [label, beforeTag, afterTag, expected deltas]
  let snapN = 0;
  const snap = () => { const t = `bal${snapN++}`; evalc(`balances ${t}`, BAL, t); return t; };
  // a value step: snapshot, call, snapshot; deltas default to 0 for every field
  const valued = (label, sender, fn, args, expect, deltas, capture) => {
    const t0 = snap();
    w(label, sender, fn, args, expect, capture);
    const t1 = snap();
    moves.push([label, t0, t1, deltas]);
  };

  // -- 0: deploy the stack, the helper and the safe (exact bytes) -------------
  for (const [n, v] of [["jing-core-v6", ClarityVersion.Clarity5], ["jing-ladder-v1", ClarityVersion.Clarity5], ["markets-sbtc-stx-jing-v6-3", ClarityVersion.Clarity5],
    ["swap-router-sbtc-stx-jing-v5-3", ClarityVersion.Clarity5], ["juice-swap-vault-trait-v2", CLARITY_6], ["juice-sbtc-autoswap", CLARITY_6], ["juice-pool-sbtc-signer", CLARITY_6]]) {
    b.withSender(DEPLOYER).addContractDeploy({ contract_name: n, source_code: src(n).s, clarity_version: v });
    step(`deploy ${n} (deploy bytes)`);
  }
  b.withSender(DEPLOYER).addContractDeploy({ contract_name: HELPER_NAME, source_code: helper.s, clarity_version: ClarityVersion.Clarity4 });
  step(`deploy ${HELPER_NAME} (Clarity 4, sha256 ${helper.h.slice(0, 12)})`);
  b.withSender(DEPLOYER).addContractDeploy({ contract_name: WALLET_NAME, source_code: safe.s, clarity_version: CLARITY_6 });
  step(`deploy ${WALLET_NAME} (Clarity 6, sha256 ${safe.h.slice(0, 12)})`);

  w("Z0 toggle-token-lock before onboard (no owner) -> u4001", OWNER, "toggle-token-lock", [trueCV(), noneCV(), noneCV()], "(err u4001)");
  w("Z0 confirm-recovery before anything is proposed -> u4010", OWNER, "confirm-recovery", [], "(err u4010)");
  call("Z1 core-v2 set-verified-contract(safe)", DEPLOYER, WALLET_CORE, "set-verified-contract", [principalCV(WALLET), noneCV()], okre);
  b.withSender(STX_WHALE).addSTXTransfer({ recipient: WALLET, amount: FUND_STX });
  step(`Z2 fund ${FUND_STX / 1e6} STX`);
  call(`Z2 fund ${FUND_SBTC} sats sBTC`, OWNER, SBTC_TOKEN, "transfer", [uintCV(FUND_SBTC), standardPrincipalCV(OWNER), principalCV(WALLET), noneCV()], okre);
  call(`Z2 fund ${FUND_LEO} LEO`, OWNER, LEO_TOKEN, "transfer", [uintCV(FUND_LEO), standardPrincipalCV(OWNER), principalCV(WALLET), noneCV()], okre);
  call(`Z2 NFT owner sends bitcoin-pepe #${NFT_A}`, NFT_OWNER, NFT, "transfer", [uintCV(NFT_A), standardPrincipalCV(NFT_OWNER), principalCV(WALLET)], okre);
  call(`Z2 NFT owner sends bitcoin-pepe #${NFT_B}`, NFT_OWNER, NFT, "transfer", [uintCV(NFT_B), standardPrincipalCV(NFT_OWNER), principalCV(WALLET)], okre);
  call("Z3 onboard", FAKFUN_DEPLOYER, WALLET, "onboard",
    [pub, standardPrincipalCV(OWNER), standardPrincipalCV(RECOVERY), uintCV(STX_THR), uintCV(SBTC_THR), uintCV(COOLDOWN)], okre);
  evalc("Z3 NFT owners", `{ a: (unwrap-panic (contract-call? '${NFT} get-owner u${NFT_A})), b: (unwrap-panic (contract-call? '${NFT} get-owner u${NFT_B})) }`, "nft0");

  // -- P: max gas (propose now, confirm after the cooldown) ----------------------
  w("P0 confirm-max-gas-amount with nothing proposed -> u4016", RELAYER, "confirm-max-gas-amount", [auth(1, T.maxGas(1, 0)), noneCV()], "(err u4016)");
  w("P1 RANDOM propose-max-gas-amount -> u4001", RANDOM, "propose-max-gas-amount", [uintCV(NEW_GAS)], "(err u4001)");
  w("P2 propose above MAX-GAS-CEILING (10001) -> u4018", OWNER, "propose-max-gas-amount", [uintCV(10_001)], "(err u4018)");
  w(`P3 owner proposes max gas ${NEW_GAS}`, OWNER, "propose-max-gas-amount", [uintCV(NEW_GAS)], okre);
  evalc("P3 get-pending-max-gas", "(get-pending-max-gas)", "pgas3");
  w("P4 confirm inside the cooldown -> u4012", RELAYER, "confirm-max-gas-amount", [auth(2, T.maxGas(2, NEW_GAS)), noneCV()], "(err u4012)");
  w("P5 confirm signed for another amount (bad signature) -> u4002", RELAYER, "confirm-max-gas-amount", [auth(3, T.maxGas(3, 3000)), noneCV()], "(err u4002)");
  w("P6 confirm by an unregistered passkey -> u4004", RELAYER, "confirm-max-gas-amount", [auth(4, T.maxGas(4, NEW_GAS), { k: key2 }), noneCV()], "(err u4004)");

  // -- C: wallet config (signal now, set after the cooldown) -----------------------
  w("C0 set-wallet-config with nothing signaled -> u4016", RELAYER, "set-wallet-config", [auth(5, T.cfg(5, 0, 0, 0)), noneCV()], "(err u4016)");
  w("C1 RANDOM signal-config-change -> u4001", RANDOM, "signal-config-change", [uintCV(NEW_CFG.stx), uintCV(NEW_CFG.sbtc), uintCV(NEW_CFG.cooldown)], "(err u4001)");
  w("C2 signal cooldown 143 (< MIN-COOLDOWN) -> u4031", OWNER, "signal-config-change", [uintCV(NEW_CFG.stx), uintCV(NEW_CFG.sbtc), uintCV(143)], "(err u4031)");
  w("C3 signal cooldown 4033 (> MAX-CONFIG-COOLDOWN) -> u4019", OWNER, "signal-config-change", [uintCV(NEW_CFG.stx), uintCV(NEW_CFG.sbtc), uintCV(4033)], "(err u4019)");
  w("C4 owner signals 200 STX / 200000 sats / 150", OWNER, "signal-config-change", [uintCV(NEW_CFG.stx), uintCV(NEW_CFG.sbtc), uintCV(NEW_CFG.cooldown)], okre);
  evalc("C4 get-pending-config", "(get-pending-config)", "pcfg4");
  w("C5 set-wallet-config inside the cooldown -> u4012", RELAYER, "set-wallet-config", [auth(6, T.cfg(6, NEW_CFG.stx, NEW_CFG.sbtc, NEW_CFG.cooldown)), noneCV()], "(err u4012)");

  // -- T: token lock, admin paths -----------------------------------------------------
  w("T1 RANDOM toggle-token-lock true -> u4001", RANDOM, "toggle-token-lock", [trueCV(), noneCV(), noneCV()], "(err u4001)");
  w("T2 owner turns the lock on (admin path)", OWNER, "toggle-token-lock", [trueCV(), noneCV(), noneCV()], okre);
  evalc("T2 get-token-lock-enabled", "(get-token-lock-enabled)", "lockT2");
  w("T3 owner turns the lock off", OWNER, "toggle-token-lock", [falseCV(), noneCV(), noneCV()], okre);
  w("T4 RANDOM turns the lock off -> u4001", RANDOM, "toggle-token-lock", [falseCV(), noneCV(), noneCV()], "(err u4001)");

  // -- S: STX transfers ---------------------------------------------------------------
  const stxArgs = (amount, memo, sig, gas = noneCV()) => [uintCV(amount), standardPrincipalCV(RECIPIENT), memo ? someCV(bufferCV(memo)) : noneCV(), sig, gas];
  w("S1 RANDOM stx-transfer -> u4001", RANDOM, "stx-transfer", stxArgs(STX_UNDER, null, noneCV()), "(err u4001)");
  valued("S2 owner stx-transfer 10 STX (under)", OWNER, "stx-transfer", stxArgs(STX_UNDER, null, noneCV()), okre, { ss: -STX_UNDER, rs: STX_UNDER });
  valued("S3 passkey stx-transfer 10 STX with memo + gas (under)", RELAYER, "stx-transfer",
    stxArgs(STX_UNDER, MEMO, sAuth(7, T.stx(7, STX_UNDER, RECIPIENT, MEMO)), GASCV), okre, { ss: -STX_UNDER, rs: STX_UNDER, sb: -GAS });
  w("S4 passkey stx-transfer signed under example.com -> u4002", RELAYER, "stx-transfer",
    stxArgs(STX_UNDER, null, sAuth(8, T.stx(8, STX_UNDER, RECIPIENT), { rp: RP_WRONG })), "(err u4002)");
  valued("S5 owner stx-transfer 150 STX (over) -> op0 queued, nothing moves", OWNER, "stx-transfer", stxArgs(STX_OVER, null, noneCV()), okre, {});
  valued("S6 passkey stx-transfer 150 STX (over) -> op1 queued (passkey-created)", RELAYER, "stx-transfer",
    stxArgs(STX_OVER, null, sAuth(9, T.stx(9, STX_OVER, RECIPIENT))), okre, {});
  w("S7 owner stx-transfer 150 STX -> op2", OWNER, "stx-transfer", stxArgs(STX_OVER, null, noneCV()), okre);
  w("S8 owner stx-transfer 150 STX -> op3", OWNER, "stx-transfer", stxArgs(STX_OVER, null, noneCV()), okre);
  evalc("S8 op0", "(get-pending-operation u0)", "op0");
  evalc("S8 op1", "(get-pending-operation u1)", "op1");
  w("E1 execute-pending-stx-transfer unknown op 99 -> u4013", OWNER, "execute-pending-stx-transfer", [uintCV(99), noneCV()], "(err u4013)");
  w("E2 execute-pending-stx-transfer op0 before the cooldown -> u4017", OWNER, "execute-pending-stx-transfer", [uintCV(0), noneCV()], "(err u4017)");
  w("V1 RANDOM veto op2 -> u4001", RANDOM, "veto-operation", [uintCV(2), noneCV(), noneCV()], "(err u4001)");
  w("V2 veto unknown op 99 -> u4013", OWNER, "veto-operation", [uintCV(99), noneCV(), noneCV()], "(err u4013)");
  valued("V3 passkey veto op2 with gas", RELAYER, "veto-operation", [uintCV(2), sAuth(10, T.veto(10, 2)), GASCV], okre, { sb: -GAS });
  evalc("V3 op2", "(get-pending-operation u2)", "op2");
  w("N1 execute-stx-now op1 (passkey-created) -> u4003", RELAYER, "execute-pending-stx-transfer-now", [uintCV(1), noneCV(), auth(11, T.now(11, 1)), noneCV()], "(err u4003)");
  w("N2 execute-stx-now op0 with a sig for op3 -> u4002", RELAYER, "execute-pending-stx-transfer-now", [uintCV(0), noneCV(), auth(12, T.now(12, 3)), noneCV()], "(err u4002)");
  w("N3 execute-stx-now op2 (vetoed) -> u4015", RELAYER, "execute-pending-stx-transfer-now", [uintCV(2), noneCV(), auth(13, T.now(13, 2)), noneCV()], "(err u4015)");
  valued("N4 execute-stx-now op3 with gas: 150 STX moves before the cooldown", RELAYER, "execute-pending-stx-transfer-now",
    [uintCV(3), noneCV(), auth(14, T.now(14, 3)), GASCV], okre, { ss: -STX_OVER, rs: STX_OVER, sb: -GAS });
  w("N5 execute-stx-now op3 again -> u4014", RELAYER, "execute-pending-stx-transfer-now", [uintCV(3), noneCV(), auth(15, T.now(15, 3)), noneCV()], "(err u4014)");
  w("N6 execute-pending-stx-transfer op3 (executed) -> u4014", OWNER, "execute-pending-stx-transfer", [uintCV(3), noneCV()], "(err u4014)");
  w("V4 veto op3 (executed) -> u4014", OWNER, "veto-operation", [uintCV(3), noneCV(), noneCV()], "(err u4014)");

  // -- B: SIP-010 transfers (sBTC + LEO) -----------------------------------------------
  const ftArgs = (amount, token, name, sig, gas = noneCV()) => {
    const [a, n] = token.split(".");
    return [uintCV(amount), standardPrincipalCV(RECIPIENT), noneCV(), contractPrincipalCV(a, n), stringAsciiCV(name), sig, gas];
  };
  const sbtcArgs = (amount, sig, gas) => ftArgs(amount, SBTC_TOKEN, "sbtc-token", sig, gas);
  w("B1 RANDOM sip010-transfer -> u4001", RANDOM, "sip010-transfer", sbtcArgs(SBTC_UNDER, noneCV()), "(err u4001)");
  valued("B2 owner sip010-transfer 10000 sats sBTC (under)", OWNER, "sip010-transfer", sbtcArgs(SBTC_UNDER, noneCV()), okre, { sb: -SBTC_UNDER, rb: SBTC_UNDER });
  valued("B3 passkey sip010-transfer 10000 sats sBTC with gas (under)", RELAYER, "sip010-transfer",
    sbtcArgs(SBTC_UNDER, sAuth(16, T.ft(16, SBTC_UNDER, RECIPIENT, SBTC_TOKEN)), GASCV), okre, { sb: -SBTC_UNDER - Number(GAS), rb: SBTC_UNDER });
  valued(`B4 owner sip010-transfer ${LEO_AMT} LEO (not sBTC: no threshold)`, OWNER, "sip010-transfer", ftArgs(LEO_AMT, LEO_TOKEN, "leo", noneCV()), okre, { sf: -LEO_AMT, rf: LEO_AMT });
  valued(`B5 passkey sip010-transfer ${LEO_AMT} LEO`, RELAYER, "sip010-transfer",
    ftArgs(LEO_AMT, LEO_TOKEN, "leo", sAuth(17, T.ft(17, LEO_AMT, RECIPIENT, LEO_TOKEN))), okre, { sf: -LEO_AMT, rf: LEO_AMT });
  w("B6 passkey sip010-transfer signed for sBTC, sent with LEO -> u4002", RELAYER, "sip010-transfer",
    ftArgs(LEO_AMT, LEO_TOKEN, "leo", sAuth(18, T.ft(18, LEO_AMT, RECIPIENT, SBTC_TOKEN))), "(err u4002)");
  valued("B7 owner sip010-transfer 150000 sats (over) -> op4", OWNER, "sip010-transfer", sbtcArgs(SBTC_OVER, noneCV()), okre, {});
  w("B8 passkey sip010-transfer 150000 sats (over) -> op5 (passkey-created)", RELAYER, "sip010-transfer", sbtcArgs(SBTC_OVER, sAuth(19, T.ft(19, SBTC_OVER, RECIPIENT, SBTC_TOKEN))), okre);
  w("B9 owner sip010-transfer 150000 sats -> op6", OWNER, "sip010-transfer", sbtcArgs(SBTC_OVER, noneCV()), okre);
  evalc("B9 op4", "(get-pending-operation u4)", "op4");
  w("ES1 execute-pending-sbtc-transfer unknown op 99 -> u4013", OWNER, "execute-pending-sbtc-transfer", [uintCV(99), noneCV()], "(err u4013)");
  w("ES2 execute-pending-sbtc-transfer on an STX op (op0) -> u4013", OWNER, "execute-pending-sbtc-transfer", [uintCV(0), noneCV()], "(err u4013)");
  w("ES3 execute-pending-sbtc-transfer op4 before the cooldown -> u4017", OWNER, "execute-pending-sbtc-transfer", [uintCV(4), noneCV()], "(err u4017)");
  w("ES4 execute-pending-stx-transfer on an sBTC op (op4) -> u4013", OWNER, "execute-pending-stx-transfer", [uintCV(4), noneCV()], "(err u4013)");
  w("V5 owner vetoes op6 (admin path)", OWNER, "veto-operation", [uintCV(6), noneCV(), noneCV()], okre);
  w("NS1 execute-sbtc-now op5 (passkey-created) -> u4003", RELAYER, "execute-pending-sbtc-transfer-now", [uintCV(5), noneCV(), auth(20, T.now(20, 5)), noneCV()], "(err u4003)");
  w("NS2 execute-sbtc-now op6 (vetoed) -> u4015", RELAYER, "execute-pending-sbtc-transfer-now", [uintCV(6), noneCV(), auth(21, T.now(21, 6)), noneCV()], "(err u4015)");
  w("NS3 execute-sbtc-now on an STX op (op0) -> u4013", RELAYER, "execute-pending-sbtc-transfer-now", [uintCV(0), noneCV(), auth(22, T.now(22, 0)), noneCV()], "(err u4013)");
  w("NS4 execute-sbtc-now op4 signed under example.com -> u4002", RELAYER, "execute-pending-sbtc-transfer-now", [uintCV(4), noneCV(), auth(23, T.now(23, 4), { rp: RP_WRONG }), noneCV()], "(err u4002)");
  w("NS5 execute-stx-now on an sBTC op (op4) -> u4013", RELAYER, "execute-pending-stx-transfer-now", [uintCV(4), noneCV(), auth(24, T.now(24, 4)), noneCV()], "(err u4013)");

  // -- W: sBTC withdrawals (live sbtc-withdrawal) ---------------------------------------
  const wdArgs = (amount, fee, sig, gas = noneCV()) => [uintCV(amount), btcRcpt, uintCV(fee), sig, gas];
  w("W1 RANDOM sbtc-initiate-withdrawal -> u4001", RANDOM, "sbtc-initiate-withdrawal", wdArgs(WD_UNDER, WD_UNDER_FEE, noneCV()), "(err u4001)");
  valued("W2 owner withdrawal 20000 + 3000 fee (under): sBTC locked in sbtc-withdrawal", OWNER, "sbtc-initiate-withdrawal",
    wdArgs(WD_UNDER, WD_UNDER_FEE, noneCV()), okre, { sb: -(WD_UNDER + WD_UNDER_FEE), sl: WD_UNDER + WD_UNDER_FEE });
  valued("W3 passkey withdrawal 20000 + 3000 fee with gas (under)", RELAYER, "sbtc-initiate-withdrawal",
    wdArgs(WD_UNDER, WD_UNDER_FEE, sAuth(25, T.wd(25, WD_UNDER, WD_UNDER_FEE)), GASCV), okre, { sb: -(WD_UNDER + WD_UNDER_FEE) - Number(GAS), sl: WD_UNDER + WD_UNDER_FEE });
  w("W4 passkey withdrawal signed for another fee -> u4002", RELAYER, "sbtc-initiate-withdrawal",
    wdArgs(WD_UNDER, WD_UNDER_FEE, sAuth(26, T.wd(26, WD_UNDER, 1))), "(err u4002)");
  valued("W5 owner withdrawal 120000 + 1000 (over) -> op7", OWNER, "sbtc-initiate-withdrawal", wdArgs(WD_OVER, WD_OVER_FEE, noneCV()), okre, {});
  w("W6 passkey withdrawal 120000 + 1000 (over) -> op8 (passkey-created)", RELAYER, "sbtc-initiate-withdrawal",
    wdArgs(WD_OVER, WD_OVER_FEE, sAuth(27, T.wd(27, WD_OVER, WD_OVER_FEE))), okre);
  w("W7 owner withdrawal 120000 + 1000 -> op9", OWNER, "sbtc-initiate-withdrawal", wdArgs(WD_OVER, WD_OVER_FEE, noneCV()), okre);
  evalc("W7 op7", "(get-pending-operation u7)", "op7");
  w("EW1 execute-pending-sbtc-withdrawal unknown op 99 -> u4013", OWNER, "execute-pending-sbtc-withdrawal", [uintCV(99)], "(err u4013)");
  w("EW2 execute-pending-sbtc-withdrawal on an sBTC transfer op (op4) -> u4013", OWNER, "execute-pending-sbtc-withdrawal", [uintCV(4)], "(err u4013)");
  w("EW3 execute-pending-sbtc-withdrawal op7 before the cooldown -> u4017", OWNER, "execute-pending-sbtc-withdrawal", [uintCV(7)], "(err u4017)");
  w("V6 passkey veto op9 (no gas)", RELAYER, "veto-operation", [uintCV(9), sAuth(28, T.veto(28, 9)), noneCV()], okre);
  w("NW1 execute-withdrawal-now op8 (passkey-created) -> u4003", RELAYER, "execute-pending-sbtc-withdrawal-now", [uintCV(8), auth(29, T.now(29, 8)), noneCV()], "(err u4003)");
  w("NW2 execute-withdrawal-now op9 (vetoed) -> u4015", RELAYER, "execute-pending-sbtc-withdrawal-now", [uintCV(9), auth(30, T.now(30, 9)), noneCV()], "(err u4015)");
  w("NW3 execute-withdrawal-now on an sBTC transfer op (op4) -> u4013", RELAYER, "execute-pending-sbtc-withdrawal-now", [uintCV(4), auth(31, T.now(31, 4)), noneCV()], "(err u4013)");
  w("NW4 execute-withdrawal-now op7 by an unregistered passkey -> u4004", RELAYER, "execute-pending-sbtc-withdrawal-now", [uintCV(7), auth(32, T.now(32, 7), { k: key2 }), noneCV()], "(err u4004)");
  w("NW5 execute-withdrawal-now op7 with a sig for op8 -> u4002", RELAYER, "execute-pending-sbtc-withdrawal-now", [uintCV(7), auth(33, T.now(33, 8)), noneCV()], "(err u4002)");

  // -- L: token lock on (passkey), every passkey spend refused -----------------------------
  const lockSig = auth(34, T.lock(34, true));
  valued("L1 passkey turns the lock on, with gas", RELAYER, "toggle-token-lock", [trueCV(), someCV(lockSig), GASCV], okre, { sb: -GAS });
  evalc("L1 get-token-lock-enabled", "(get-token-lock-enabled)", "lockL1");
  w("L2 same lock signature replayed -> u4006", RELAYER, "toggle-token-lock", [trueCV(), someCV(lockSig), noneCV()], "(err u4006)");
  w("L3 locked: passkey stx-transfer -> u4023", RELAYER, "stx-transfer", stxArgs(STX_UNDER, null, sAuth(35, T.stx(35, STX_UNDER, RECIPIENT))), "(err u4023)");
  w("L4 locked: passkey sip010-transfer -> u4023", RELAYER, "sip010-transfer", sbtcArgs(SBTC_UNDER, sAuth(36, T.ft(36, SBTC_UNDER, RECIPIENT, SBTC_TOKEN))), "(err u4023)");
  w("L5 locked: passkey withdrawal -> u4023", RELAYER, "sbtc-initiate-withdrawal", wdArgs(WD_UNDER, WD_UNDER_FEE, sAuth(37, T.wd(37, WD_UNDER, WD_UNDER_FEE))), "(err u4023)");
  w("L6 locked: passkey sip009-transfer -> u4023", RELAYER, "sip009-transfer",
    [uintCV(NFT_B), standardPrincipalCV(RECIPIENT), contractPrincipalCV(...NFT.split(".")), stringAsciiCV("bitcoin-pepe"), sAuth(38, T.nft(38, NFT_B, RECIPIENT)), noneCV()], "(err u4023)");
  w("L7 locked: execute-stx-now op0 -> u4023", RELAYER, "execute-pending-stx-transfer-now", [uintCV(0), noneCV(), auth(39, T.now(39, 0)), noneCV()], "(err u4023)");
  w("L8 locked: execute-sbtc-now op4 -> u4023", RELAYER, "execute-pending-sbtc-transfer-now", [uintCV(4), noneCV(), auth(40, T.now(40, 4)), noneCV()], "(err u4023)");
  w("L9 locked: execute-withdrawal-now op7 -> u4023", RELAYER, "execute-pending-sbtc-withdrawal-now", [uintCV(7), auth(41, T.now(41, 7)), noneCV()], "(err u4023)");
  valued("L10 locked: the owner (admin path) still sends 5 STX", OWNER, "stx-transfer", stxArgs(STX_LOCKED_ADMIN, null, noneCV()), okre, { ss: -STX_LOCKED_ADMIN, rs: STX_LOCKED_ADMIN });
  w("L11 relayer with a passkey sig cannot turn the lock off -> u4001", RELAYER, "toggle-token-lock", [falseCV(), sAuth(42, T.lock(42, false)), noneCV()], "(err u4001)");
  w("L12 owner turns the lock off", OWNER, "toggle-token-lock", [falseCV(), noneCV(), noneCV()], okre);
  evalc("L12 get-token-lock-enabled", "(get-token-lock-enabled)", "lockL12");

  // -- execute-now successes (before the cooldown) --------------------------------------
  valued("NS6 execute-sbtc-now op4 with gas: 150000 sats move", RELAYER, "execute-pending-sbtc-transfer-now",
    [uintCV(4), noneCV(), auth(43, T.now(43, 4)), GASCV], okre, { sb: -SBTC_OVER - Number(GAS), rb: SBTC_OVER });
  w("NS7 execute-sbtc-now op4 again -> u4014", RELAYER, "execute-pending-sbtc-transfer-now", [uintCV(4), noneCV(), auth(44, T.now(44, 4)), noneCV()], "(err u4014)");
  valued("NW6 execute-withdrawal-now op7 with gas: 121000 sats locked", RELAYER, "execute-pending-sbtc-withdrawal-now",
    [uintCV(7), auth(45, T.now(45, 7)), GASCV], /^\(ok u\d+\)$/, { sb: -(WD_OVER + WD_OVER_FEE) - Number(GAS), sl: WD_OVER + WD_OVER_FEE });
  w("NW7 execute-withdrawal-now op7 again -> u4014", RELAYER, "execute-pending-sbtc-withdrawal-now", [uintCV(7), auth(46, T.now(46, 7)), noneCV()], "(err u4014)");

  // -- NF: SIP-009 transfers -------------------------------------------------------------
  const nftArgs = (id, sig, gas = noneCV()) => [uintCV(id), standardPrincipalCV(RECIPIENT), contractPrincipalCV(...NFT.split(".")), stringAsciiCV("bitcoin-pepe"), sig, gas];
  w("NF1 RANDOM sip009-transfer -> u4001", RANDOM, "sip009-transfer", nftArgs(NFT_A, noneCV()), "(err u4001)");
  w(`NF2 owner sip009-transfer #${NFT_A} to RECIPIENT`, OWNER, "sip009-transfer", nftArgs(NFT_A, noneCV()), okre);
  w(`NF3 passkey sip009-transfer #${NFT_B} signed for #${NFT_A} -> u4002`, RELAYER, "sip009-transfer", nftArgs(NFT_B, sAuth(47, T.nft(47, NFT_A, RECIPIENT))), "(err u4002)");
  valued(`NF4 passkey sip009-transfer #${NFT_B} to RECIPIENT with gas`, RELAYER, "sip009-transfer", nftArgs(NFT_B, sAuth(48, T.nft(48, NFT_B, RECIPIENT)), GASCV), okre, { sb: -GAS });
  evalc("NF4 NFT owners", `{ a: (unwrap-panic (contract-call? '${NFT} get-owner u${NFT_A})), b: (unwrap-panic (contract-call? '${NFT} get-owner u${NFT_B})) }`, "nft1");
  w(`NF5 owner sip009-transfer #${NFT_A} again (no longer held) -> err`, OWNER, "sip009-transfer", nftArgs(NFT_A, noneCV()), /^\(err/);

  // -- R: recovery address ------------------------------------------------------------------
  w("R1 propose-recovery signed for another address -> u4002", RELAYER, "propose-recovery", [standardPrincipalCV(NEW_RECOVERY), auth(49, T.recovery(49, RANDOM)), noneCV()], "(err u4002)");
  w("R2 propose-recovery = the safe itself -> u4001", RELAYER, "propose-recovery", [principalCV(WALLET), auth(50, T.recovery(50, WALLET)), noneCV()], "(err u4001)");
  const recSig = auth(51, T.recovery(51, NEW_RECOVERY));
  valued("R3 passkey propose-recovery with gas", RELAYER, "propose-recovery", [standardPrincipalCV(NEW_RECOVERY), recSig, GASCV], okre, { sb: -GAS });
  w("R4 same propose-recovery signature replayed -> u4006", RELAYER, "propose-recovery", [standardPrincipalCV(NEW_RECOVERY), recSig, noneCV()], "(err u4006)");
  w("R5 RANDOM confirm-recovery -> u4001", RANDOM, "confirm-recovery", [], "(err u4001)");
  w("R6 owner confirm-recovery", OWNER, "confirm-recovery", [], okre);
  evalc("R6 recovery", "{ r: (var-get recovery-address), p: (var-get pending-recovery) }", "recR6");
  w("R7 confirm-recovery again (nothing pending) -> u4010", OWNER, "confirm-recovery", [], "(err u4010)");

  // -- advance past every cooldown (144) --------------------------------------------------
  b.addAdvanceBlocks({ bitcoin_blocks: COOLDOWN + 6, stacks_blocks_per_bitcoin: 1 });
  step(`advance ${COOLDOWN + 6} burn blocks (past the ${COOLDOWN}-block cooldown)`);

  // -- X: plain executions after the cooldown ------------------------------------------------
  w("X1 RANDOM execute-pending-stx-transfer op0 -> u4001", RANDOM, "execute-pending-stx-transfer", [uintCV(0), noneCV()], "(err u4001)");
  w("X2 execute-pending-stx-transfer op2 (vetoed) -> u4015", OWNER, "execute-pending-stx-transfer", [uintCV(2), noneCV()], "(err u4015)");
  valued("X3 owner executes op0 with memo: 150 STX", OWNER, "execute-pending-stx-transfer", [uintCV(0), someCV(bufferCV(MEMO))], okre, { ss: -STX_OVER, rs: STX_OVER });
  w("X4 execute op0 again -> u4014", OWNER, "execute-pending-stx-transfer", [uintCV(0), noneCV()], "(err u4014)");
  valued("X5 owner executes op1 (passkey-created, plain path after the cooldown)", OWNER, "execute-pending-stx-transfer", [uintCV(1), noneCV()], okre, { ss: -STX_OVER, rs: STX_OVER });
  w("X6 veto op0 (executed) -> u4014", OWNER, "veto-operation", [uintCV(0), noneCV(), noneCV()], "(err u4014)");
  w("XS1 RANDOM execute-pending-sbtc-transfer op5 -> u4001", RANDOM, "execute-pending-sbtc-transfer", [uintCV(5), noneCV()], "(err u4001)");
  w("XS2 execute-pending-sbtc-transfer op6 (vetoed) -> u4015", OWNER, "execute-pending-sbtc-transfer", [uintCV(6), noneCV()], "(err u4015)");
  valued("XS3 owner executes op5: 150000 sats", OWNER, "execute-pending-sbtc-transfer", [uintCV(5), noneCV()], okre, { sb: -SBTC_OVER, rb: SBTC_OVER });
  w("XS4 execute op5 again -> u4014", OWNER, "execute-pending-sbtc-transfer", [uintCV(5), noneCV()], "(err u4014)");
  w("XW1 RANDOM execute-pending-sbtc-withdrawal op8 -> u4001", RANDOM, "execute-pending-sbtc-withdrawal", [uintCV(8)], "(err u4001)");
  w("XW2 execute-pending-sbtc-withdrawal op9 (vetoed) -> u4015", OWNER, "execute-pending-sbtc-withdrawal", [uintCV(9)], "(err u4015)");
  valued("XW3 owner executes op8: 121000 sats locked", OWNER, "execute-pending-sbtc-withdrawal", [uintCV(8)], /^\(ok u\d+\)$/, { sb: -(WD_OVER + WD_OVER_FEE), sl: WD_OVER + WD_OVER_FEE });
  w("XW4 execute op8 again -> u4014", OWNER, "execute-pending-sbtc-withdrawal", [uintCV(8)], "(err u4014)");
  // the spend period expired: 90 STX goes through although 25 STX were spent before
  valued("XR1 new period: passkey stx-transfer 90 STX goes through (spent reset)", RELAYER, "stx-transfer",
    stxArgs(STX_AFTER_RESET, null, sAuth(52, T.stx(52, STX_AFTER_RESET, RECIPIENT))), okre, { ss: -STX_AFTER_RESET, rs: STX_AFTER_RESET });

  // -- G: the no-gas arms of the passkey "now" paths, the stx-now memo arm, and
  //    a passkey toggle / sip009 without gas (op10..op12)
  w("G1 owner stx-transfer 150 STX -> op10", OWNER, "stx-transfer", stxArgs(STX_OVER, null, noneCV()), okre);
  w("G1 owner sip010-transfer 150000 sats -> op11", OWNER, "sip010-transfer", sbtcArgs(SBTC_OVER, noneCV()), okre);
  w("G1 owner withdrawal 120000 + 1000 -> op12", OWNER, "sbtc-initiate-withdrawal", wdArgs(WD_OVER, WD_OVER_FEE, noneCV()), okre);
  valued("G2 execute-stx-now op10 with memo, no gas", RELAYER, "execute-pending-stx-transfer-now",
    [uintCV(10), someCV(bufferCV(MEMO)), auth(60, T.now(60, 10)), noneCV()], okre, { ss: -STX_OVER, rs: STX_OVER });
  valued("G3 execute-sbtc-now op11, no gas", RELAYER, "execute-pending-sbtc-transfer-now",
    [uintCV(11), noneCV(), auth(61, T.now(61, 11)), noneCV()], okre, { sb: -SBTC_OVER, rb: SBTC_OVER });
  valued("G4 execute-withdrawal-now op12, no gas", RELAYER, "execute-pending-sbtc-withdrawal-now",
    [uintCV(12), auth(62, T.now(62, 12)), noneCV()], /^\(ok u\d+\)$/, { sb: -(WD_OVER + WD_OVER_FEE), sl: WD_OVER + WD_OVER_FEE });
  valued("G5 passkey turns the lock on, no gas", RELAYER, "toggle-token-lock", [trueCV(), sAuth(63, T.lock(63, true)), noneCV()], okre, {});
  w("G5 owner turns the lock off", OWNER, "toggle-token-lock", [falseCV(), noneCV(), noneCV()], okre);
  call(`G6 RECIPIENT sends #${NFT_A} back to the safe`, RECIPIENT, NFT, "transfer", [uintCV(NFT_A), standardPrincipalCV(RECIPIENT), principalCV(WALLET)], okre);
  valued(`G7 passkey sip009-transfer #${NFT_A} to RECIPIENT, no gas`, RELAYER, "sip009-transfer", nftArgs(NFT_A, sAuth(64, T.nft(64, NFT_A, RECIPIENT))), okre, {});
  evalc("G7 NFT owners", `{ a: (unwrap-panic (contract-call? '${NFT} get-owner u${NFT_A})), b: (unwrap-panic (contract-call? '${NFT} get-owner u${NFT_B})) }`, "nft2");

  // -- P / C after the cooldown ---------------------------------------------------------------
  valued(`P7 passkey confirm-max-gas-amount ${NEW_GAS} with gas`, RELAYER, "confirm-max-gas-amount", [auth(53, T.maxGas(53, NEW_GAS)), GASCV], okre, { sb: -GAS });
  evalc("P7 max gas", "{ m: (var-get max-gas-amount), p: (get-pending-max-gas) }", "gasP7");
  w("P8 confirm again (nothing pending) -> u4016", RELAYER, "confirm-max-gas-amount", [auth(54, T.maxGas(54, 0)), noneCV()], "(err u4016)");
  w("C6 set-wallet-config signed for other values -> u4002", RELAYER, "set-wallet-config", [auth(55, T.cfg(55, NEW_CFG.stx, NEW_CFG.sbtc, 144)), noneCV()], "(err u4002)");
  valued("C7 passkey set-wallet-config with gas", RELAYER, "set-wallet-config", [auth(56, T.cfg(56, NEW_CFG.stx, NEW_CFG.sbtc, NEW_CFG.cooldown)), GASCV], okre, { sb: -GAS });
  evalc("C7 wallet-config", "{ c: (var-get wallet-config), p: (get-pending-config) }", "cfgC7");
  w("C8 set-wallet-config again (nothing signaled) -> u4016", RELAYER, "set-wallet-config", [auth(57, T.cfg(57, 0, 0, 0)), noneCV()], "(err u4016)");

  // -- Y: after an ownership transfer the old passkey maps to a non-admin -> u4005 ----------
  w("Y1 owner proposes transfer to NEW_OWNER", OWNER, "propose-transfer-wallet", [standardPrincipalCV(NEW_OWNER)], okre);
  valued("Y2 passkey confirm-transfer-wallet with gas (gas-exempt from the cap)", RELAYER, "confirm-transfer-wallet", [auth(58, T.xfer(58, NEW_OWNER)), GASCV], okre, { sb: -GAS });
  evalc("Y2 owner", "(get-owner)", "ownerY2");
  w("Y3 old passkey (owner no longer admin) stx-transfer -> u4005", RELAYER, "stx-transfer", stxArgs(STX_UNDER, null, sAuth(59, T.stx(59, STX_UNDER, RECIPIENT))), "(err u4005)");
  w("Y4 old owner stx-transfer -> u4001", OWNER, "stx-transfer", stxArgs(STX_UNDER, null, noneCV()), "(err u4001)");
  valued("Y5 new owner signal-config-change works", NEW_OWNER, "signal-config-change", [uintCV(STX_THR), uintCV(SBTC_THR), uintCV(COOLDOWN)], okre, {});

  // -- run + verify ---------------------------------------------------------------------------
  console.log("=== juice-autostake-safe ops coverage - stxer harness ===");
  const sessionId = await b.run();
  const url = `https://stxer.xyz/simulations/mainnet/${sessionId}`;
  console.log(`Submitted: ${url}\n`);
  const res = await getSimulationResult(sessionId);

  const decTx = (s) => {
    const r = s?.Result?.Transaction;
    if (!r) return "<none>";
    if ("Err" in r) return `ENGINE-ERR: ${JSON.stringify(r.Err).slice(0, 220)}`;
    try { return cvToString(deserializeCV(r.Ok.result)); } catch (e) { return `dec-fail: ${e.message}`; }
  };
  const decEval = (s) => {
    const r = s?.Result?.Eval;
    if (!r || !("Ok" in r)) return `<eval:${JSON.stringify(r?.Err ?? "?").slice(0, 160)}>`;
    try { return cvToString(deserializeCV(r.Ok)); } catch { return r.Ok; }
  };

  let pass = 0, fail = 0;
  const checks = [];
  const cap = {};
  if (res.steps.length !== plan.length) console.log(`WARN: ${res.steps.length} steps returned, ${plan.length} planned`);
  plan.forEach((p, i) => {
    const s = res.steps[i];
    if (p.kind === "fund") {
      const ok = !!s && !("Err" in (s?.Result?.Transaction || {})) && !/^\(err/.test(s?.Result?.Transaction ? decTx(s) : "");
      console.log(`${ok ? "OK  " : "FAIL"} [${i}] ${p.label}`);
      if (!ok) { fail++; console.log(`        ${decTx(s)}`); }
      else pass++;
      checks.push({ label: p.label, actual: s ? decTx(s) : "<missing>", passed: ok });
      return;
    }
    if (p.kind === "eval") {
      const v = decEval(s);
      if (p.capture) cap[p.capture] = v;
      if (!/^balances /.test(p.label)) console.log(`INFO [${i}] ${p.label}: ${String(v).slice(0, 220)}`);
      return;
    }
    const d = decTx(s);
    if (p.capture) cap[p.capture] = d;
    const ok = p.expect == null ? true : p.expect instanceof RegExp ? p.expect.test(d) : d === p.expect;
    console.log(`${ok ? "PASS" : "FAIL"} [${i}] ${p.label}\n        got ${d.slice(0, 200)}`);
    ok ? pass++ : fail++;
    checks.push({ label: p.label, actual: d, passed: ok });
  });

  console.log("\n--- state checks ---");
  const chk = (l, cond, actual = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${l}${cond ? "" : `  (${actual})`}`); cond ? pass++ : fail++; checks.push({ label: l, actual: String(actual), passed: !!cond }); };
  const field = (s, f) => BigInt((String(s).match(new RegExp(`\\(${f} u(\\d+)\\)`)) || [])[1] ?? "-1");
  const FIELDS = ["ss", "rs", "sb", "sl", "rb", "sf", "rf"];
  for (const [label, t0, t1, deltas] of moves) {
    const got = {}, bad = [];
    for (const f of FIELDS) {
      const a = field(cap[t0], f), z = field(cap[t1], f);
      got[f] = z - a;
      const want = BigInt(deltas[f] ?? 0);
      if (a < 0n || z < 0n || got[f] !== want) bad.push(`${f} ${got[f]} != ${want}`);
    }
    chk(`balances exact: ${label}`, bad.length === 0, bad.join(", ") || JSON.stringify(Object.fromEntries(Object.entries(got).map(([k, v]) => [k, String(v)]))));
  }
  const has = (k, s) => String(cap[k]).includes(s);
  chk(`Z3 the safe holds NFTs #${NFT_A} and #${NFT_B}`, String(cap.nft0) === `(tuple (a (some ${WALLET})) (b (some ${WALLET})))`, cap.nft0);
  chk("P3 pending max gas recorded", has("pgas3", `(amount u${NEW_GAS})`) && !has("pgas3", "(proposed-at u0)"), cap.pgas3);
  chk("C4 pending config recorded", has("pcfg4", `(cooldown-period u${NEW_CFG.cooldown})`) && has("pcfg4", `(stx-threshold u${NEW_CFG.stx})`), cap.pcfg4);
  chk("T2 lock on after the admin toggle", String(cap.lockT2) === "true", cap.lockT2);
  chk("S8 op0 admin-created, op1 passkey-created", has("op0", "(passkey-created false)") && has("op1", "(passkey-created true)") && has("op0", `(amount u${STX_OVER})`), `${cap.op0} | ${cap.op1}`);
  chk("V3 op2 vetoed", has("op2", "(vetoed true)"), cap.op2);
  chk("B9 op4 is an sbtc-transfer", has("op4", '(op-type "sbtc-transfer")'), cap.op4);
  chk("W7 op7 is an sbtc-withdraw with the payload", has("op7", '(op-type "sbtc-withdraw")') && has("op7", "(payload (some 0x"), cap.op7);
  chk("L1 lock on after the passkey toggle", String(cap.lockL1) === "true", cap.lockL1);
  chk("L12 lock off", String(cap.lockL12) === "false", cap.lockL12);
  chk(`NF4 both NFTs now owned by RECIPIENT`, String(cap.nft1) === `(tuple (a (some ${RECIPIENT})) (b (some ${RECIPIENT})))`, cap.nft1);
  chk("R6 recovery-address = NEW_RECOVERY, pending cleared", String(cap.recR6) === `(tuple (p SP000000000000000000002Q6VF78) (r ${NEW_RECOVERY}))`, cap.recR6);
  chk(`P7 max-gas-amount = ${NEW_GAS}, pending cleared`, has("gasP7", `(m u${NEW_GAS})`) && has("gasP7", "(amount u0) (proposed-at u0)"), cap.gasP7);
  chk("C7 wallet-config set, signal + pending cleared", has("cfgC7", `(config-signaled-at none) (cooldown-period u${NEW_CFG.cooldown}) (sbtc-threshold u${NEW_CFG.sbtc}) (stx-threshold u${NEW_CFG.stx})`)
    && has("cfgC7", "(p (tuple (cooldown-period u0) (sbtc-threshold u0) (stx-threshold u0)))"), cap.cfgC7);

  chk(`G7 NFT #${NFT_A} back with RECIPIENT after the no-gas passkey send`, String(cap.nft2) === `(tuple (a (some ${RECIPIENT})) (b (some ${RECIPIENT})))`, cap.nft2);
  chk("Y2 owner is NEW_OWNER", String(cap.ownerY2) === `(ok ${NEW_OWNER})`, cap.ownerY2);

  const total = pass + fail;
  console.log(`\n=== ${pass} passed, ${fail} failed (${total}) ===\nView: ${url}`);
  fs.mkdirSync("fixtures", { recursive: true });
  fs.writeFileSync("fixtures/simul-juice-autostake-safe-ops-coverage-result.json", JSON.stringify({
    simulation: url, passed: pass, total,
    sources: {
      [WALLET]: { form: "deploy-bytes-mv7dfb", bytes: Buffer.byteLength(safe.s), sha256: safe.h, clarity: 6 },
      [`${DEPLOYER}.${HELPER_NAME}`]: { form: "deploy-bytes-mv7dfb", bytes: Buffer.byteLength(helper.s), sha256: helper.h, clarity: 4 },
    },
    gasSats: String(GAS),
    checks,
  }, null, 1) + "\n");
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
