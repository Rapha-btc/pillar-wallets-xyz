// Shared plumbing for the fakfun-wallet-v16 suites.
//
// v16 is published by deployV16() rather than pulled as a requirement: clarinet
// orders a v16 requirement BEFORE juice-pool-stx-signer even though v16 depends on
// it, so the publish aborts and every call reports "does not exist". Hand-reordering
// the plan does not survive a rerun. The source published here is byte-identical to
// the cached mainnet copy and goes out with sender SPV9K21..., so the tests still run
// the real deployed bytes at the real mainnet address.
import { expect } from "vitest";
import { Cl } from "@stacks/transactions";
import crypto from "node:crypto";
import fs from "node:fs";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { generateP256Keypair, signChallengeWithRpId } from "../lib-webauthn-test-signer.mjs";

export const D = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
// V16_DEPLOYER lets the coverage harness (tests/cl-v16-cov) publish the wallet
// locally, since clarinet --coverage only instruments project contracts. Unset --
// the normal case -- it is the real mainnet deployer.
export const WD = process.env.V16_DEPLOYER ?? D;
export const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
export const WALLET = `${WD}.fakfun-wallet-v16`;
export const CORE = `${D}.fakfun-wallet-core`;
export const SBTC_ID = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
export const SBTC_DEPOSIT = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-deposit";
export const SBTC_SIGNER = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4";
export const JUICE_SIGNER = `${D}.juice-pool-stx-signer`;
export const RP_ID = "fak.fun";
export const CHAIN_ID = 2147483648;      // simnet is TESTNET; mainnet u1 => every sig u4002
export const PUBKEY_COOLDOWN = 432;
export const MIN_COOLDOWN = 144;
export const STX_THRESHOLD = 100_000_000; // v16 defaults, set in the contract not at onboard
export const SBTC_THRESHOLD = 100_000;

export const accounts = simnet.getAccounts();
export const DEPLOYER = accounts.get("deployer")!;
export const OWNER = accounts.get("wallet_1")!;
export const RANDOM = accounts.get("wallet_3")!;
export const RELAYER = accounts.get("wallet_4")!;
export const RECIPIENT = accounts.get("wallet_5")!;
export const NEW_OWNER = accounts.get("wallet_6")!;

export const E = {
  UNAUTH: 4001, BADSIG: 4002, FORBIDDEN: 4003, UNREG_PUBKEY: 4004,
  NOT_ADMIN_PUBKEY: 4005, REPLAY: 4006, INACTIVE_REQ: 4009, NO_PENDING_RECOVERY: 4010,
  NOT_WHITELISTED: 4011, IN_COOLDOWN: 4012, INVALID_OP: 4013, ALREADY_EXECUTED: 4014,
  VETOED: 4015, NOT_SIGNALED: 4016, COOLDOWN_NOT_PASSED: 4017, THRESHOLD: 4018,
  COOLDOWN_TOO_LONG: 4019, NO_PENDING_TRANSFER: 4020, ALREADY_INIT: 4022,
  TOKEN_LOCKED: 4023, INIT_ALREADY_PROPOSED: 4026, NO_PENDING_INIT: 4027,
  INIT_NOT_PENDING_ADMIN: 4028, INIT_NOT_ACCEPTED: 4029, ZERO: 4030,
  COOLDOWN_TOO_SHORT: 4031,
};

const SIP018 = Buffer.from("534950303138", "hex");
const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest();
const cvHash = (cv: any) => sha256(Buffer.from(Cl.serialize(cv), "hex"));
const domainHash = () => cvHash(Cl.tuple({
  name: Cl.stringAscii("smart-wallet-standard"), version: Cl.stringAscii("1.0.0"),
  "chain-id": Cl.uint(CHAIN_ID), wallet: Cl.contractPrincipal(WD, "fakfun-wallet-v16"),
}));
const challenge = (t: any) => sha256(Buffer.concat([SIP018, domainHash(), cvHash(t)]));
export const key = generateP256Keypair();
export const strip = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);
export const pubkeyCV = Cl.bufferFromHex(strip(key.pubKeyHex));

export const topic = (name: string, fields: Record<string, any> = {}) =>
  Cl.tuple({ topic: Cl.stringAscii(name), ...fields });
export function sign(t: any, id: number, k = key) {
  const s = signChallengeWithRpId(challenge(t), k.privKey, RP_ID);
  return Cl.tuple({
    "auth-id": Cl.uint(id), pubkey: Cl.bufferFromHex(strip(k.pubKeyHex)),
    signature: Cl.bufferFromHex(strip(s.signatureHex)),
    "authenticator-data": Cl.bufferFromHex(strip(s.authenticatorDataHex)),
    "client-data-prefix": Cl.bufferFromHex(strip(s.clientDataPrefixHex)),
    "client-data-suffix": Cl.bufferFromHex(strip(s.clientDataSuffixHex)),
  });
}

const V16_SRC = fs.readFileSync("contracts/fakfun-wallet-v16.clar", "utf8");
export function deployV16() {
  // In the COVERAGE harness the wallet is already published by the deployment plan
  // (it has to be a project contract to be instrumented), so publishing it again
  // would collide. Everywhere else it must be published here -- see the header.
  if (process.env.V16_DEPLOYER) return;
  expect(simnet.deployContract("fakfun-wallet-v16", V16_SRC,
    { clarityVersion: 6 }, WD).result).toBeBool(true);
}

/** deploy + verify + onboard + seat OWNER as admin through the three-step flow */
export function seated() {
  deployV16();
  expect(simnet.callPublicFn(CORE, "set-verified-contract",
    [Cl.contractPrincipal(WD, "fakfun-wallet-v16"), Cl.none()], D).result).toBeOk(Cl.bool(true));
  expect(simnet.callPublicFn(WALLET, "onboard", [pubkeyCV], FAKFUN_DEPLOYER).result)
    .toBeOk(Cl.bool(true));
  expect(simnet.callPublicFn(WALLET, "propose-admin-with-signature",
    [Cl.principal(OWNER), sign(topic("add-admin",
      { "auth-id": Cl.uint(1), "new-admin": Cl.principal(OWNER) }), 1), Cl.none()],
    RELAYER).result).toBeOk(Cl.bool(true));
  expect(simnet.callPublicFn(WALLET, "accept-admin-proposal", [], OWNER).result)
    .toBeOk(Cl.bool(true));
  simnet.mineEmptyBurnBlocks(PUBKEY_COOLDOWN + 10);
  expect(simnet.callPublicFn(WALLET, "confirm-admin-with-signature",
    [sign(topic("confirm-admin",
      { "auth-id": Cl.uint(2), "new-admin": Cl.principal(OWNER) }), 2), Cl.none()],
    RELAYER).result).toBeOk(Cl.bool(true));
}

export const fundSTX = (n = 2_000_000_000, to = WALLET) => simnet.transferSTX(n, to, DEPLOYER);

let depositNonce = 0;
export function fundSBTC(to = WALLET, amount = 5_000_000) {
  const h = simnet.burnBlockHeight - 1;
  const hash = Cl.prettyPrint(simnet.callReadOnlyFn(`${DEPLOYER}.zz-nft`, "burn-hash",
    [Cl.uint(h)], DEPLOYER).result).replace(/^0x/, "");
  const txid = "44".repeat(31) + (++depositNonce).toString(16).padStart(2, "0");
  simnet.callPublicFn(SBTC_DEPOSIT, "complete-deposit-wrapper",
    [Cl.bufferFromHex(txid), Cl.uint(0), Cl.uint(amount), Cl.principal(to),
     Cl.bufferFromHex(hash), Cl.uint(h), Cl.bufferFromHex("22".repeat(32))], SBTC_SIGNER);
}

/** pox-5 grant path, so staking reaches a registered signer instead of ERR_SIGNER_NOT_FOUND u23 */
export function registerSigner() {
  const priv = Buffer.from("11".repeat(32), "hex");
  const pub = secp256k1.getPublicKey(priv, true);
  const dom = cvHash(Cl.tuple({ name: Cl.stringAscii("pox-5-signer"),
    version: Cl.stringAscii("1.0.0"), "chain-id": Cl.uint(CHAIN_ID) }));
  const st = cvHash(Cl.tuple({ topic: Cl.stringAscii("grant-authorization"),
    "signer-manager": Cl.contractPrincipal(D, "juice-pool-stx-signer"), "auth-id": Cl.uint(1) }));
  const h = sha256(Buffer.concat([SIP018, dom, st]));
  const compact = Buffer.from(secp256k1.sign(h, priv, { prehash: false }));
  for (const rec of [1, 0]) {   // 01 is the right one; see README-clarinet-rv.md
    const r = simnet.callPublicFn(JUICE_SIGNER, "register-self",
      [Cl.contractPrincipal(D, "juice-pool-stx-signer"),
       Cl.bufferFromHex(Buffer.from(pub).toString("hex")), Cl.uint(1),
       Cl.bufferFromHex(Buffer.concat([compact, Buffer.from([rec])]).toString("hex"))], D);
    if (Cl.prettyPrint(r.result).startsWith("(ok")) return;
  }
  throw new Error("signer registration failed");
}

export const sbtcCV = Cl.contractPrincipal(SBTC_SIGNER, "sbtc-token");
export const nftCV = Cl.contractPrincipal(DEPLOYER, "zz-nft");
export const ftCV = Cl.contractPrincipal(DEPLOYER, "zz-ft");
export const stationCV = Cl.contractPrincipal(DEPLOYER, "zz-gas-station");
export const extCV = Cl.contractPrincipal(DEPLOYER, "zz-extension");
export const poxAddr = Cl.tuple({
  version: Cl.bufferFromHex("00"), hashbytes: Cl.bufferFromHex("00".repeat(20)),
});
export const pendingOp = (id: number) =>
  simnet.callReadOnlyFn(WALLET, "get-pending-operation", [Cl.uint(id)], OWNER).result;
export const gasCounter = () => BigInt((Cl.prettyPrint(
  simnet.getDataVar(WALLET, "spent-this-period")).match(/gas: u(\d+)/) || [])[1] ?? "-1");
