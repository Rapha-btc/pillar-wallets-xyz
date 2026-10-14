// juice-autostake-safe-rv-repro.test.ts -- plain Clarinet SDK repro of the
// Rendezvous counterexample RV-F1 (tests/rv/README.md, "juice-autostake-safe").
//
// Run:
//   npx vitest run tests/juice-autostake-safe-rv-repro.test.ts -- --manifest tests/cl-v7/Clarinet.toml
//
// UNEDITED production source at its real address (same deploy layout as
// juice-autostake-safe-keeper.test.ts), real pox-5, real passkey signatures, real
// INACTIVITY-PERIOD (u52560). No RV harness helper is involved.
//
// RV-F1: a stale pending-transfer that names the CURRENT owner. propose-transfer-
// wallet only refuses new-admin == tx-sender at propose time, and neither
// recover-inactive-wallet nor confirm-transfer-wallet clears or re-checks it.
// When the owner later confirms it, confirm-transfer-wallet does
//   (map-set admins pending true) (map-delete admins (var-get owner))
// on the SAME key, so the admins map ends EMPTY: the owner is no admin, every
// admin path and every passkey path (is-admin-pubkey) fails, and only the
// recovery address can act -- after another full inactivity period.
import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";
import crypto from "node:crypto";
import fs from "node:fs";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { generateP256Keypair, signChallengeWithRpId } from "../lib-webauthn-test-signer.mjs";

const D = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const WALLET_NAME = "juice-autostake-safe";
const POOL_NAME = "juice-pool-sbtc-signer";
const HELPER_NAME = "juice-autostake-safe-auth-helpers-v1";
const WALLET = `${D}.${WALLET_NAME}`;
const POOL = `${D}.${POOL_NAME}`;
const CORE = `${D}.fakfun-wallet-core-v2`;
const RP_ID = "juiceofbtc.com";
const CHAIN_ID = 2147483648;
const INACTIVITY_PERIOD = 52560;

const accounts = simnet.getAccounts();
const DEPLOYER = accounts.get("deployer")!;
const OWNER = accounts.get("wallet_1")!; // A: onboarded owner, holds the passkey
const RECOVERY = accounts.get("wallet_2")!;
const B = accounts.get("wallet_3")!;
const SINK = accounts.get("wallet_6")!;

const E_UNAUTH = 4001, E_NOT_ADMIN_PUBKEY = 4005;

function deployAll() {
  const pool = fs.readFileSync(
    ".cache/requirements/SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-pool-stx-signer.clar", "utf8");
  const helper = fs.readFileSync("contracts/juice-autostake-safe-auth-helpers-v1.clar", "utf8");
  const wallet = fs.readFileSync("contracts/juice-autostake-safe.clar", "utf8");
  expect(simnet.deployContract(POOL_NAME, pool, { clarityVersion: 5 }, D).result).toBeBool(true);
  expect(simnet.deployContract(HELPER_NAME, helper, { clarityVersion: 4 }, D).result).toBeBool(true);
  expect(simnet.deployContract(WALLET_NAME, wallet, { clarityVersion: 6 }, D).result).toBeBool(true);
}

const SIP018 = Buffer.from("534950303138", "hex");
const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest();
const cvHash = (cv: any) => sha256(Buffer.from(Cl.serialize(cv), "hex"));
const strip = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);

const pk = generateP256Keypair();
const pubkeyCV = Cl.bufferFromHex(strip(pk.pubKeyHex));
function walletDomain(): Buffer {
  return cvHash(Cl.tuple({
    name: Cl.stringAscii("smart-wallet-standard"), version: Cl.stringAscii("1.0.0"),
    "chain-id": Cl.uint(CHAIN_ID), wallet: Cl.contractPrincipal(D, WALLET_NAME),
  }));
}
/** Mirrors smart-wallet-standard-auth-helpers-v7.build-confirm-transfer-hash. */
function confirmTransferHash(authId: number, newAdmin: string): Buffer {
  const struct = cvHash(Cl.tuple({
    topic: Cl.stringAscii("confirm-transfer"), "auth-id": Cl.uint(authId), "new-admin": Cl.principal(newAdmin),
  }));
  return sha256(Buffer.concat([SIP018, walletDomain(), struct]));
}
/** Mirrors juice-safe-auth-helpers-v1.build-unstake-stx-juice-hash. */
function unstakeHash(authId: number): Buffer {
  const struct = cvHash(Cl.tuple({ topic: Cl.stringAscii("unstake-stx-juice"), "auth-id": Cl.uint(authId) }));
  return sha256(Buffer.concat([SIP018, walletDomain(), struct]));
}
function sigAuth(authId: number, hash: Buffer) {
  const s = signChallengeWithRpId(hash, pk.privKey, RP_ID);
  return Cl.tuple({
    "auth-id": Cl.uint(authId), pubkey: pubkeyCV,
    signature: Cl.bufferFromHex(strip(s.signatureHex)),
    "authenticator-data": Cl.bufferFromHex(strip(s.authenticatorDataHex)),
    "client-data-prefix": Cl.bufferFromHex(strip(s.clientDataPrefixHex)),
    "client-data-suffix": Cl.bufferFromHex(strip(s.clientDataSuffixHex)),
  });
}

const signerPriv = secp256k1.utils.randomSecretKey();
const signerPub = secp256k1.getPublicKey(signerPriv, true);
function grantMessageHash(authId: number): Buffer {
  const domain = cvHash(Cl.tuple({
    name: Cl.stringAscii("pox-5-signer"), version: Cl.stringAscii("1.0.0"), "chain-id": Cl.uint(CHAIN_ID),
  }));
  const struct = cvHash(Cl.tuple({
    topic: Cl.stringAscii("grant-authorization"),
    "signer-manager": Cl.contractPrincipal(D, POOL_NAME), "auth-id": Cl.uint(authId),
  }));
  return sha256(Buffer.concat([SIP018, domain, struct]));
}
function registerPool() {
  const compact = Buffer.from(secp256k1.sign(grantMessageHash(1), signerPriv, { prehash: false }) as any);
  for (const rec of [0, 1]) {
    const r = simnet.callPublicFn(POOL, "register-self",
      [Cl.contractPrincipal(D, POOL_NAME), Cl.bufferFromHex(Buffer.from(signerPub).toString("hex")),
       Cl.uint(1), Cl.bufferFromHex(Buffer.concat([compact, Buffer.from([rec])]).toString("hex"))], D);
    if (Cl.prettyPrint(r.result).startsWith("(ok")) return;
  }
  throw new Error("pool registration failed");
}
function readySafe() {
  deployAll(); registerPool();
  expect(simnet.callPublicFn(CORE, "set-verified-contract",
    [Cl.contractPrincipal(D, WALLET_NAME), Cl.none()], D).result).toBeOk(Cl.bool(true));
  expect(simnet.callPublicFn(WALLET, "onboard",
    [pubkeyCV, Cl.principal(OWNER), Cl.principal(RECOVERY),
     Cl.uint(10_000_000_000_000), Cl.uint(100_000), Cl.uint(144)], FAKFUN_DEPLOYER).result).toBeOk(Cl.bool(true));
  simnet.transferSTX(3_000_000_000, WALLET, DEPLOYER);
}
const isAdmin = (p: string) =>
  Cl.prettyPrint(simnet.callReadOnlyFn(WALLET, "is-admin-calling", [Cl.principal(p)], p).result) === "(ok true)";
const owner = () => Cl.prettyPrint(simnet.callReadOnlyFn(WALLET, "get-owner", [], OWNER).result);

describe("RV-F1: confirming a stale self-transfer empties the admin set", () => {
  it("owner A -> B -> (B proposes A) -> recovery to A -> A confirms: no admin left", () => {
    // arrange: A proposes B and confirms with the passkey -> owner B
    readySafe();
    expect(simnet.callPublicFn(WALLET, "propose-transfer-wallet", [Cl.principal(B)], OWNER).result)
      .toBeOk(Cl.bool(true));
    expect(simnet.callPublicFn(WALLET, "confirm-transfer-wallet",
      [sigAuth(1, confirmTransferHash(1, B)), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
    expect(owner()).toBe(`(ok '${B})`);
    // B (admin, principal key) proposes handing the safe back to A
    expect(simnet.callPublicFn(WALLET, "propose-transfer-wallet", [Cl.principal(OWNER)], B).result)
      .toBeOk(Cl.bool(true));
    // B goes inactive; the recovery address restores A. pending-transfer = A survives.
    simnet.mineEmptyBurnBlocks(INACTIVITY_PERIOD + 1);
    expect(simnet.callPublicFn(WALLET, "recover-inactive-wallet", [Cl.principal(OWNER)], RECOVERY).result)
      .toBeOk(Cl.bool(true));
    expect(owner()).toBe(`(ok '${OWNER})`);
    expect(isAdmin(OWNER)).toBe(true);

    // act: A's passkey confirms the stale transfer, which names A itself
    const r = simnet.callPublicFn(WALLET, "confirm-transfer-wallet",
      [sigAuth(2, confirmTransferHash(2, OWNER)), Cl.none()], OWNER);

    // assert: accepted, and the admin set is now empty
    expect(r.result).toBeOk(Cl.bool(true));
    expect(owner()).toBe(`(ok '${OWNER})`);
    for (const p of [OWNER, RECOVERY, B, SINK, DEPLOYER, D]) expect(isAdmin(p)).toBe(false);
    // the owner's principal key is locked out ...
    expect(simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(1_000_000), Cl.principal(SINK), Cl.none(), Cl.none(), Cl.none()], OWNER).result)
      .toBeErr(Cl.uint(E_UNAUTH));
    // ... and so is the passkey (its principal is no longer an admin)
    expect(simnet.callPublicFn(WALLET, "unstake",
      [Cl.some(sigAuth(3, unstakeHash(3))), Cl.none()], SINK).result).toBeErr(Cl.uint(E_NOT_ADMIN_PUBKEY));
    // the recovery address cannot act until the NEW owner action timestamp ages out
    expect(simnet.callPublicFn(WALLET, "recover-inactive-wallet", [Cl.principal(SINK)], RECOVERY).result)
      .toBeErr(Cl.uint(4009));
    simnet.mineEmptyBurnBlocks(INACTIVITY_PERIOD + 1);
    expect(simnet.callPublicFn(WALLET, "recover-inactive-wallet", [Cl.principal(SINK)], RECOVERY).result)
      .toBeOk(Cl.bool(true));
    expect(isAdmin(SINK)).toBe(true);
  });
});
