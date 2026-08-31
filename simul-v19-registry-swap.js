// simul-v19-registry-swap.js
// Stxer mainnet-fork harness for the NEW v19 surface:
//   * fakfun-extension-registry lifecycle: seeded approvals, propose ->
//     144-block cooldown -> confirm, immediate revoke, 2-step owner transfer,
//     non-owner rejections.
//   * whitelist-extension-fast: instant (no per-wallet cooldown) whitelist of
//     a registry-approved extension, passkey signature mandatory
//     (build-whitelist-fast-hash in auth-helpers-v11); unapproved extension
//     rejected with u4034 even with a valid signature.
//   * The old slow path (whitelist-extension -> cooldown ->
//     execute-pending-whitelist) still works for non-registry extensions.
//   * usdcx-sbtc-swap-v2: both directions through the Bitflow DLMM pool with
//     the sponsor broadcast fee taken on the sBTC leg (input side for
//     to-usdcx, output side for to-sbtc); fee governance (default u20,
//     propose/confirm with 144 cooldown, MAX-GAS u5000 cap, sponsor-only).
//
// v18's supporting contracts (smart trait, auth helpers v7/v10, router
// registry, wallet-core-v2, usdcx-sbtc-swap v1) are LIVE on mainnet, so only
// the 4 new contracts (+ the sim-only mock) are deployed in-fork.
//
// Run: node simul-v19-registry-swap.js
import crypto from "node:crypto";
import fs from "node:fs";
import {
  tupleCV, uintCV, bufferCV, noneCV, someCV, principalCV,
  standardPrincipalCV, contractPrincipalCV, stringAsciiCV, serializeCV,
  deserializeCV, cvToString, ClarityVersion, PostConditionMode,
} from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";
import { generateP256Keypair, signChallengeWithRpId } from "./lib-webauthn-test-signer.mjs";

const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const OWNER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2"; // holds sBTC
const RELAYER = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM";
const USDCX_WHALE = "SP1MZ5N6YCQ5BFHK4N9NFGXG2K4N53BQ0MFXAKAC1";
const SBTC_WHALE = OWNER;

const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const USDCX = "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx";
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core-v2`;
const STACKS_NODE_API = "http://77.42.3.101/stacks-api";
const RP_ID = "fak.fun";

const FIXED_NAME = "fakfun-wallet-v19";
const FIXED = `${DEPLOYER}.${FIXED_NAME}`;
const EXT_REGISTRY = `${DEPLOYER}.fakfun-extension-registry`;
const SWAP_V2 = `${DEPLOYER}.usdcx-sbtc-swap-v2`;
const SWAP_V1 = `${DEPLOYER}.usdcx-sbtc-swap`;
const XTRATA = `${DEPLOYER}.xtrata-inscribe`;
const MOCK = `${DEPLOYER}.mock-smart-router`; // stands in for a non-registry extension

const SBTC_FUND = 200_000;     // sats
const USDCX_FUND = 20_000_000; // 20 USDCx (6 decimals)
const COOLDOWN_BLOCKS = 440;   // > pubkey cooldown u432, > registry/wallet u144
const FEE_COOLDOWN = 150;      // > swap-v2 / wallet u144

const SIP018_PREFIX = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const cvSha256 = (cv) => {
  const o = serializeCV(cv);
  return typeof o === "string" ? sha256(Buffer.from(o, "hex")) : sha256(Buffer.from(o));
};
const domainHash = (wallet) => cvSha256(tupleCV({
  name: stringAsciiCV("smart-wallet-standard"),
  version: stringAsciiCV("1.0.0"),
  "chain-id": uintCV(1),
  wallet: principalCV(wallet),
}));
const challenge = (wallet, topicTuple) =>
  sha256(Buffer.concat([SIP018_PREFIX, domainHash(wallet), cvSha256(topicTuple)]));

const tAddAdmin = (id, a) => tupleCV({ topic: stringAsciiCV("add-admin"), "auth-id": uintCV(id), "new-admin": standardPrincipalCV(a) });
const tConfirmAdmin = (id, a) => tupleCV({ topic: stringAsciiCV("confirm-admin"), "auth-id": uintCV(id), "new-admin": standardPrincipalCV(a) });
// whitelist-fast topic tuple: mirrors auth-helpers-v11 build-whitelist-fast-hash.
const tFast = (id, ext) => tupleCV({
  topic: stringAsciiCV("whitelist-fast"),
  "auth-id": uintCV(id),
  extension: principalCV(ext),
});
// execute-pending-whitelist topic tuple: mirrors auth-helpers-v7.
const tWhitelist = (id, opId, ext) => tupleCV({
  topic: stringAsciiCV("whitelist-extension"),
  "auth-id": uintCV(id),
  "op-id": uintCV(opId),
  extension: principalCV(ext),
});
// extension-call topic tuple: mirrors auth-helpers-v7.
const tExt = (id, ext, payload) => tupleCV({
  topic: stringAsciiCV("extension-call"),
  "auth-id": uintCV(id),
  extension: principalCV(ext),
  payload: bufferCV(payload),
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

const toBuf = (s) => (typeof s === "string" ? Buffer.from(strip(s), "hex") : Buffer.from(s));
const swapPayload = (action, amount, minOut, maxSteps) => toBuf(serializeCV(tupleCV({
  action: stringAsciiCV(action),
  amount: uintCV(amount),
  "min-out": uintCV(minOut),
  "max-steps": uintCV(maxSteps),
})));

const CLARITY_6 = ClarityVersion.Clarity6 ?? 6;
const CDIR = "./contracts";
const read = (rel) => fs.readFileSync(`${CDIR}/${rel}`, "utf8");

async function main() {
  const key = generateP256Keypair();
  const sign = (c) => signChallengeWithRpId(c, key.privKey, RP_ID);
  const pubkeyCV = bufferCV(Buffer.from(strip(key.pubKeyHex), "hex"));

  const plan = [];
  const b = SimulationBuilder.new({ stacksNodeAPI: STACKS_NODE_API });
  const call = (label, sender, cid, fn, args, expect) => {
    b.withSender(sender).addContractCall({
      contract_id: cid, function_name: fn, function_args: args,
      post_condition_mode: PostConditionMode.Allow,
    });
    plan.push({ kind: "tx", label, expect });
  };
  const evalc = (label, code, at) => { b.addEvalCode(at, code); plan.push({ kind: "eval", label }); };
  const okre = /^\(ok/;

  // ── Deploy the 4 new contracts + sim-only mock ──
  const deploy = (name, path, ver) => {
    b.withSender(DEPLOYER).addContractDeploy({
      contract_name: name, source_code: read(path), clarity_version: ver,
    });
    plan.push({ kind: "deploy", label: `deploy ${name}` });
  };
  deploy("fakfun-extension-registry", "fakfun-extension-registry.clar", ClarityVersion.Clarity5);
  deploy("smart-wallet-standard-auth-helpers-v11", "smart-wallet-standard-auth-helpers-v11.clar", ClarityVersion.Clarity5);
  deploy("usdcx-sbtc-swap-v2", "fakfun-extensions/usdcx-sbtc-swap-v2.clar", ClarityVersion.Clarity5);
  deploy("mock-smart-router", "mock-smart-router.clar", ClarityVersion.Clarity5);
  deploy(FIXED_NAME, "fakfun-wallet-v19.clar", CLARITY_6);

  // ── Registry: seeds + propose/cooldown gate ──
  evalc("registry: xtrata-inscribe seeded?", `(is-approved-extension '${XTRATA})`, EXT_REGISTRY);
  evalc("registry: usdcx-sbtc-swap v1 seeded?", `(is-approved-extension '${SWAP_V1})`, EXT_REGISTRY);
  evalc("registry: swap-v2 approved? (expect false)", `(is-approved-extension '${SWAP_V2})`, EXT_REGISTRY);
  call("registry: propose swap-v2 (owner)", DEPLOYER, EXT_REGISTRY,
    "propose-extension", [principalCV(SWAP_V2)], okre);
  call("registry: confirm swap-v2 pre-cooldown -> u7103", DEPLOYER, EXT_REGISTRY,
    "confirm-extension", [principalCV(SWAP_V2)], /\(err u7103\)/);
  call("registry: propose by non-owner -> u7101", RELAYER, EXT_REGISTRY,
    "propose-extension", [principalCV(MOCK)], /\(err u7101\)/);
  call("registry: propose-owner RELAYER (2-step starts)", DEPLOYER, EXT_REGISTRY,
    "propose-owner", [standardPrincipalCV(RELAYER)], okre);
  call("registry: accept-owner pre-cooldown -> u7103", RELAYER, EXT_REGISTRY,
    "accept-owner", [], /\(err u7103\)/);

  // ── Verify + onboard v19 + seat OWNER as admin ──
  call("verify v19 in core-v2", DEPLOYER, WALLET_CORE,
    "set-verified-contract", [principalCV(FIXED), noneCV()], okre);
  call("onboard(pubkey) -> ok (registers v19, pre-whitelists v1 exts)", FAKFUN_DEPLOYER, FIXED,
    "onboard", [pubkeyCV], okre);
  evalc("swap-v2 whitelisted from birth? (expect true)", `(is-extension-whitelisted '${SWAP_V2})`, FIXED);
  evalc("xtrata whitelisted from birth? (expect true)", `(is-extension-whitelisted '${XTRATA})`, FIXED);
  evalc("swap v1 whitelisted from birth? (expect false)", `(is-extension-whitelisted '${SWAP_V1})`, FIXED);
  const sPropose = sign(challenge(FIXED, tAddAdmin(1, OWNER)));
  call("propose-admin (PASSKEY)", RELAYER, FIXED, "propose-admin-with-signature",
    [standardPrincipalCV(OWNER), sigAuth(1, key.pubKeyHex, sPropose), noneCV()], okre);
  call("accept-admin (OWNER)", OWNER, FIXED, "accept-admin-proposal", [], okre);

  b.addAdvanceBlocks({ bitcoin_blocks: COOLDOWN_BLOCKS, stacks_blocks_per_bitcoin: 1 });
  plan.push({ kind: "advance", label: `advance ${COOLDOWN_BLOCKS} (pubkey + registry cooldowns)` });

  const sConfirm = sign(challenge(FIXED, tConfirmAdmin(2, OWNER)));
  call("confirm-admin (PASSKEY) -> OWNER seated", RELAYER, FIXED,
    "confirm-admin-with-signature", [sigAuth(2, key.pubKeyHex, sConfirm), noneCV()], okre);

  // ── Registry: confirm after cooldown; owner transfer completes ──
  call("registry: confirm swap-v2 post-cooldown -> ok", DEPLOYER, EXT_REGISTRY,
    "confirm-extension", [principalCV(SWAP_V2)], okre);
  evalc("registry: swap-v2 approved now?", `(is-approved-extension '${SWAP_V2})`, EXT_REGISTRY);
  call("registry: revoke xtrata (immediate)", DEPLOYER, EXT_REGISTRY,
    "revoke-extension", [principalCV(XTRATA)], okre);
  evalc("registry: xtrata revoked? (expect false)", `(is-approved-extension '${XTRATA})`, EXT_REGISTRY);
  call("registry: accept-owner post-cooldown -> RELAYER owns", RELAYER, EXT_REGISTRY,
    "accept-owner", [], okre);
  evalc("registry: owner is RELAYER?", `(get-owner)`, EXT_REGISTRY);
  call("registry: old owner propose -> u7101", DEPLOYER, EXT_REGISTRY,
    "propose-extension", [principalCV(MOCK)], /\(err u7101\)/);

  // ── whitelist-extension-fast: negative then positive ──
  // swap-v2 is whitelisted from birth now, so first REMOVE it (admin path)
  // to make the fast re-whitelist meaningful.
  call("remove-extension-whitelist swap-v2 (ADMIN)", OWNER, FIXED,
    "remove-extension-whitelist", [principalCV(SWAP_V2), noneCV(), noneCV()], okre);
  evalc("swap-v2 removed? (expect false)", `(is-extension-whitelisted '${SWAP_V2})`, FIXED);
  const sFastBad = sign(challenge(FIXED, tFast(3, MOCK)));
  call("fast-whitelist UNAPPROVED mock -> u4034", RELAYER, FIXED,
    "whitelist-extension-fast",
    [principalCV(MOCK), sigAuth(3, key.pubKeyHex, sFastBad), noneCV()], /\(err u4034\)/);
  const sFast = sign(challenge(FIXED, tFast(4, SWAP_V2)));
  call("fast-whitelist swap-v2 (PASSKEY, no wallet cooldown) -> ok", RELAYER, FIXED,
    "whitelist-extension-fast",
    [principalCV(SWAP_V2), sigAuth(4, key.pubKeyHex, sFast), noneCV()], okre);
  evalc("swap-v2 whitelisted now?", `(is-extension-whitelisted '${SWAP_V2})`, FIXED);

  // ── Slow path still works for a NON-registry extension ──
  call("slow path: whitelist-extension mock (ADMIN) -> pending op 0", OWNER, FIXED,
    "whitelist-extension", [principalCV(MOCK)], okre);
  const sExec0 = sign(challenge(FIXED, tWhitelist(5, 0, MOCK)));
  call("slow path: execute op 0 pre-cooldown -> u4017", RELAYER, FIXED,
    "execute-pending-whitelist",
    [uintCV(0), sigAuth(5, key.pubKeyHex, sExec0), noneCV()], /\(err u4017\)/);

  // ── Fund the wallet, then swap-v2 both directions with sponsor fee ──
  call(`fund ${SBTC_FUND} sats sBTC`, SBTC_WHALE, SBTC_TOKEN, "transfer",
    [uintCV(SBTC_FUND), standardPrincipalCV(SBTC_WHALE), principalCV(FIXED), noneCV()], okre);
  call(`fund ${USDCX_FUND / 1e6} USDCx`, USDCX_WHALE, USDCX, "transfer",
    [uintCV(USDCX_FUND), standardPrincipalCV(USDCX_WHALE), principalCV(FIXED), noneCV()], okre);

  evalc("swap-v2 fee (expect u20)", `(get-fee)`, SWAP_V2);
  evalc("sponsor sBTC before swaps", `(contract-call? '${SBTC_TOKEN} get-balance '${DEPLOYER})`, SWAP_V2);
  evalc("wallet sBTC before to-sbtc", `(contract-call? '${SBTC_TOKEN} get-balance '${FIXED})`, FIXED);

  // to-sbtc: 10 USDCx in, sBTC out; fee u20 comes off the OUTPUT.
  // min-out must exceed the fee (u1000 >> u20 and safely below real quote).
  const pToSbtc = swapPayload("to-sbtc", 10_000_000, 1_000, 20);
  const sSwap1 = sign(challenge(FIXED, tExt(6, SWAP_V2, pToSbtc)));
  call("swap-v2 USDCx->sBTC (PASSKEY): fee u20 from output", RELAYER, FIXED, "extension-call", [
    contractPrincipalCV(DEPLOYER, "usdcx-sbtc-swap-v2"),
    bufferCV(pToSbtc),
    someCV(sigAuth(6, key.pubKeyHex, sSwap1)),
    noneCV(),
  ], okre);
  evalc("wallet sBTC after to-sbtc (expect up)", `(contract-call? '${SBTC_TOKEN} get-balance '${FIXED})`, FIXED);
  evalc("sponsor sBTC after to-sbtc (expect +20)", `(contract-call? '${SBTC_TOKEN} get-balance '${DEPLOYER})`, SWAP_V2);

  // to-usdcx: 20k sats in; fee u20 comes off the INPUT (swaps 19,980).
  const pToUsdcx = swapPayload("to-usdcx", 20_000, 1, 20);
  evalc("wallet USDCx before to-usdcx", `(contract-call? '${USDCX} get-balance '${FIXED})`, FIXED);
  call("swap-v2 sBTC->USDCx (ADMIN): fee u20 from input", OWNER, FIXED, "extension-call", [
    contractPrincipalCV(DEPLOYER, "usdcx-sbtc-swap-v2"),
    bufferCV(pToUsdcx),
    noneCV(),
    noneCV(),
  ], okre);
  evalc("wallet USDCx after to-usdcx (expect up)", `(contract-call? '${USDCX} get-balance '${FIXED})`, FIXED);
  evalc("sponsor sBTC after to-usdcx (expect +40 total)", `(contract-call? '${SBTC_TOKEN} get-balance '${DEPLOYER})`, SWAP_V2);

  // ── swap-v2 fee governance ──
  call("swap-v2: propose-fee by non-sponsor -> u305", RELAYER, SWAP_V2,
    "propose-fee", [uintCV(100)], /\(err u305\)/);
  call("swap-v2: propose-fee 6000 > MAX-GAS -> u308", DEPLOYER, SWAP_V2,
    "propose-fee", [uintCV(6000)], /\(err u308\)/);
  call("swap-v2: propose-fee 100 (sponsor) -> ok", DEPLOYER, SWAP_V2,
    "propose-fee", [uintCV(100)], okre);
  call("swap-v2: confirm-fee pre-cooldown -> u307", DEPLOYER, SWAP_V2,
    "confirm-fee", [], /\(err u307\)/);

  b.addAdvanceBlocks({ bitcoin_blocks: FEE_COOLDOWN, stacks_blocks_per_bitcoin: 1 });
  plan.push({ kind: "advance", label: `advance ${FEE_COOLDOWN} (fee + wallet whitelist cooldowns)` });

  call("swap-v2: confirm-fee post-cooldown -> ok", DEPLOYER, SWAP_V2, "confirm-fee", [], okre);
  evalc("swap-v2 fee now (expect u100)", `(get-fee)`, SWAP_V2);
  call("swap-v2 sBTC->USDCx (ADMIN): fee u100 from input", OWNER, FIXED, "extension-call", [
    contractPrincipalCV(DEPLOYER, "usdcx-sbtc-swap-v2"),
    bufferCV(pToUsdcx),
    noneCV(),
    noneCV(),
  ], okre);
  evalc("sponsor sBTC after 3rd swap (expect +140 total)", `(contract-call? '${SBTC_TOKEN} get-balance '${DEPLOYER})`, SWAP_V2);

  // amount <= fee must abort inside the extension (input side)
  const pTiny = swapPayload("to-usdcx", 50, 1, 20);
  call("swap-v2: to-usdcx amount 50 <= fee 100 -> u304", OWNER, FIXED, "extension-call", [
    contractPrincipalCV(DEPLOYER, "usdcx-sbtc-swap-v2"),
    bufferCV(pTiny),
    noneCV(),
    noneCV(),
  ], /\(err u304\)/);
  // min-out <= fee must abort on the output side too
  const pTinyOut = swapPayload("to-sbtc", 1_000_000, 50, 20);
  call("swap-v2: to-sbtc min-out 50 <= fee 100 -> u304", OWNER, FIXED, "extension-call", [
    contractPrincipalCV(DEPLOYER, "usdcx-sbtc-swap-v2"),
    bufferCV(pTinyOut),
    noneCV(),
    noneCV(),
  ], /\(err u304\)/);
  // payload guards
  const pBadAction = swapPayload("to-nowhere", 20_000, 1_000, 20);
  call("swap-v2: unknown action -> u301", OWNER, FIXED, "extension-call", [
    contractPrincipalCV(DEPLOYER, "usdcx-sbtc-swap-v2"),
    bufferCV(pBadAction),
    noneCV(),
    noneCV(),
  ], /\(err u301\)/);
  const pZeroAmt = swapPayload("to-usdcx", 0, 1_000, 20);
  call("swap-v2: zero amount -> u302", OWNER, FIXED, "extension-call", [
    contractPrincipalCV(DEPLOYER, "usdcx-sbtc-swap-v2"),
    bufferCV(pZeroAmt),
    noneCV(),
    noneCV(),
  ], /\(err u302\)/);
  const pZeroMin = swapPayload("to-usdcx", 20_000, 0, 20);
  call("swap-v2: zero min-out -> u303", OWNER, FIXED, "extension-call", [
    contractPrincipalCV(DEPLOYER, "usdcx-sbtc-swap-v2"),
    bufferCV(pZeroMin),
    noneCV(),
    noneCV(),
  ], /\(err u303\)/);

  // ── swap-v2 sponsor rotation (propose/negative/cancel) ──
  call("swap-v2: propose-sponsor RELAYER (sponsor) -> ok", DEPLOYER, SWAP_V2,
    "propose-sponsor", [standardPrincipalCV(RELAYER)], okre);
  call("swap-v2: confirm-sponsor pre-cooldown -> u307", DEPLOYER, SWAP_V2,
    "confirm-sponsor", [], /\(err u307\)/);
  call("swap-v2: cancel-sponsor-change -> ok", DEPLOYER, SWAP_V2,
    "cancel-sponsor-change", [], okre);
  evalc("swap-v2 sponsor unchanged?", `(get-sponsor)`, SWAP_V2);
  call("swap-v2: cancel-fee-change (no pending, still ok)", DEPLOYER, SWAP_V2,
    "cancel-fee-change", [], okre);
  call("swap-v2: confirm-sponsor with no pending -> u306", DEPLOYER, SWAP_V2,
    "confirm-sponsor", [], /\(err u306\)/);
  // full rotation: propose again, ride a fresh cooldown, confirm
  call("swap-v2: re-propose-sponsor RELAYER -> ok", DEPLOYER, SWAP_V2,
    "propose-sponsor", [standardPrincipalCV(RELAYER)], okre);

  // ── Slow whitelist path completes after cooldown ──
  const sExec0b = sign(challenge(FIXED, tWhitelist(7, 0, MOCK)));
  call("slow path: execute op 0 post-cooldown -> ok", RELAYER, FIXED,
    "execute-pending-whitelist",
    [uintCV(0), sigAuth(7, key.pubKeyHex, sExec0b), noneCV()], okre);
  evalc("mock whitelisted via slow path?", `(is-extension-whitelisted '${MOCK})`, FIXED);

  // ── veto path: pending whitelist op can be vetoed, then never executes ──
  call("slow path: whitelist-extension swap v1 (ADMIN) -> pending op 1", OWNER, FIXED,
    "whitelist-extension", [principalCV(SWAP_V1)], /\(ok u1\)/);
  call("veto-operation op 1 (ADMIN)", OWNER, FIXED,
    "veto-operation", [uintCV(1), noneCV(), noneCV()], okre);
  const sExec1 = sign(challenge(FIXED, tWhitelist(8, 1, SWAP_V1)));
  call("execute vetoed op 1 -> u4015", RELAYER, FIXED,
    "execute-pending-whitelist",
    [uintCV(1), sigAuth(8, key.pubKeyHex, sExec1), noneCV()], /\(err u4015\)/);

  // ── registry: revoke-pending under the new owner ──
  call("registry: new owner proposes mock", RELAYER, EXT_REGISTRY,
    "propose-extension", [principalCV(MOCK)], okre);
  call("registry: revoke-pending mock", RELAYER, EXT_REGISTRY,
    "revoke-pending", [principalCV(MOCK)], okre);
  evalc("registry: mock pending cleared? (expect none)", `(get-pending '${MOCK})`, EXT_REGISTRY);
  call("registry: propose already-approved swap-v2 -> u7104", RELAYER, EXT_REGISTRY,
    "propose-extension", [principalCV(SWAP_V2)], /\(err u7104\)/);

  // ── security: replayed passkey signature on fast whitelist -> u4006 ──
  call("fast-whitelist REPLAYED sig (auth-id 4 again) -> u4006", RELAYER, FIXED,
    "whitelist-extension-fast",
    [principalCV(SWAP_V2), sigAuth(4, key.pubKeyHex, sFast), noneCV()], /\(err u4006\)/);

  // ── security: sig over the WRONG extension must be rejected (u4002) ──
  // swap v1 is registry-approved but the signature commits to MOCK.
  const sWrong = sign(challenge(FIXED, tFast(9, MOCK)));
  call("fast-whitelist v1 with sig for MOCK -> u4002", RELAYER, FIXED,
    "whitelist-extension-fast",
    [principalCV(SWAP_V1), sigAuth(9, key.pubKeyHex, sWrong), noneCV()], /\(err u4002\)/);
  // correctly signed, registry-approved v1 -> instant whitelist
  const sV1 = sign(challenge(FIXED, tFast(10, SWAP_V1)));
  call("fast-whitelist v1 correctly signed -> ok", RELAYER, FIXED,
    "whitelist-extension-fast",
    [principalCV(SWAP_V1), sigAuth(10, key.pubKeyHex, sV1), noneCV()], okre);
  evalc("swap v1 whitelisted via fast path?", `(is-extension-whitelisted '${SWAP_V1})`, FIXED);

  // ── garbage payload into swap-v2 -> u300 ──
  call("swap-v2: garbage payload -> u300", OWNER, FIXED, "extension-call", [
    contractPrincipalCV(DEPLOYER, "usdcx-sbtc-swap-v2"),
    bufferCV(Buffer.from("deadbeef", "hex")),
    noneCV(),
    noneCV(),
  ], /\(err u300\)/);

  // ── sponsor rotation completes after its own cooldown ──
  b.addAdvanceBlocks({ bitcoin_blocks: FEE_COOLDOWN, stacks_blocks_per_bitcoin: 1 });
  plan.push({ kind: "advance", label: `advance ${FEE_COOLDOWN} (sponsor rotation cooldown)` });
  call("swap-v2: confirm-sponsor post-cooldown -> RELAYER", DEPLOYER, SWAP_V2,
    "confirm-sponsor", [], okre);
  evalc("swap-v2 sponsor is RELAYER now?", `(get-sponsor)`, SWAP_V2);
  call("swap-v2: old sponsor propose-fee -> u305", DEPLOYER, SWAP_V2,
    "propose-fee", [uintCV(20)], /\(err u305\)/);
  evalc("relayer sBTC before rotated-sponsor swap", `(contract-call? '${SBTC_TOKEN} get-balance '${RELAYER})`, SWAP_V2);
  call("swap-v2 sBTC->USDCx: fee u100 now pays RELAYER", OWNER, FIXED, "extension-call", [
    contractPrincipalCV(DEPLOYER, "usdcx-sbtc-swap-v2"),
    bufferCV(pToUsdcx),
    noneCV(),
    noneCV(),
  ], okre);
  evalc("relayer sBTC after (expect +100)", `(contract-call? '${SBTC_TOKEN} get-balance '${RELAYER})`, SWAP_V2);

  console.log("=== v19 extension-registry + fast whitelist + usdcx-sbtc-swap-v2 harness ===\n");
  const id = await b.run();
  const url = `https://stxer.xyz/simulations/mainnet/${id}`;
  console.log(`Submitted: ${url}\n`);
  const res = await getSimulationResult(id);

  const decTx = (s) => {
    const r = s?.Result?.Transaction;
    if (!r) return "<none>";
    if ("Err" in r) return `ENGINE-ERR: ${JSON.stringify(r.Err).slice(0, 160)}`;
    try { return cvToString(deserializeCV(r.Ok.result)); } catch (e) { return `dec-fail: ${e.message}`; }
  };
  const decEval = (s) => {
    const r = s?.Result?.Eval;
    if (!r || !("Ok" in r)) return `<eval:${JSON.stringify(r?.Err ?? "?").slice(0, 90)}>`;
    try { return cvToString(deserializeCV(r.Ok)); } catch { return String(r.Ok).slice(0, 80); }
  };

  let pass = 0, fail = 0;
  (res.steps || []).forEach((s, i) => {
    const p = plan[i]; if (!p) return;
    if (p.kind === "eval") { console.log(`   eval ${p.label} = ${decEval(s)}`); return; }
    if (p.kind === "advance") { console.log(`OK   [${i}] ${p.label}`); return; }
    if (p.kind === "deploy" || p.kind === "fund") {
      const tx = s?.Result?.Transaction;
      const ve = tx?.Ok?.vm_error;
      const ok = tx && !("Err" in tx) && !ve;
      console.log(`${ok ? "OK  " : "FAIL"} [${i}] ${p.label}${ok ? "" : "  " + (ve || decTx(s))}`);
      if (!ok) fail++;
      return;
    }
    const repr = decTx(s);
    const ok = p.expect ? p.expect.test(repr) : true;
    console.log(`${ok ? "PASS" : "FAIL"} [${i}] ${p.label}  => ${repr.slice(0, 70)}`);
    ok ? pass++ : fail++;
  });
  console.log(`\n=== ${pass} passed, ${fail} failed ===\n${url}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
