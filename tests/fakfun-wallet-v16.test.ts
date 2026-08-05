// fakfun-wallet-v16.test.ts -- Clarinet scenarios against the DEPLOYED contract.
//
// Run:  npx vitest run tests/fakfun-wallet-v16.test.ts -- --manifest tests/cl-v16/Clarinet.toml
//
// v16 is published by deployV16() rather than pulled as a requirement, because
// clarinet orders a v16 requirement BEFORE juice-pool-stx-signer even though v16
// depends on it, so the publish aborts and every call reports "does not exist"
// (reordering the plan by hand does not survive a rerun). The source here is
// byte-identical to the cached mainnet copy and is published with sender SPV9K21...,
// so these tests still run the real deployed bytes at the real mainnet address
// against real mainnet dependencies, with no mocks.
//
// Differences from the safe that shape these tests:
//   * onboard takes ONLY the pubkey. The admin is seated afterwards by a
//     three-step flow: propose-admin-with-signature -> accept-admin-proposal ->
//     (wait pubkey-cooldown-period u432) -> confirm-admin-with-signature.
//   * rp.id is fak.fun / fakfun.com, not juiceofbtc.com.
//   * v16 REMOVED propose-admin-pubkey and confirm-admin-pubkey, so a passkey can
//     never be registered after init. That absence is asserted here.
import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";
import crypto from "node:crypto";
import fs from "node:fs";
import {
  generateP256Keypair,
  signChallengeWithRpId,
} from "../lib-webauthn-test-signer.mjs";

const D = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const WALLET = `${D}.fakfun-wallet-v16`;
const CORE = `${D}.fakfun-wallet-core`;
const RP_ID = "fak.fun";
// simnet runs with the TESTNET chain-id; helpers build the SIP-018 domain from the
// runtime chain-id, so mainnet u1 would make every signature u4002.
const CHAIN_ID = 2147483648;
const PUBKEY_COOLDOWN = 432;

const accounts = simnet.getAccounts();
const OWNER = accounts.get("wallet_1")!;
const RANDOM = accounts.get("wallet_3")!;
const RELAYER = accounts.get("wallet_4")!;
const RECIPIENT = accounts.get("wallet_5")!;

const MIN_COOLDOWN = 144;
const MAX_COOLDOWN = 4032;

const ERR_UNAUTH = 4001;
const ERR_BADSIG = 4002;
const ERR_IN_COOLDOWN = 4012;
const ERR_THRESHOLD = 4018;
const ERR_COOLDOWN_TOO_LONG = 4019;
const ERR_COOLDOWN_TOO_SHORT = 4031;

// --- SIP-018 plumbing ----------------------------------------------------
const SIP018 = Buffer.from("534950303138", "hex");
const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest();
const cvHash = (cv: any) => sha256(Buffer.from(Cl.serialize(cv), "hex"));
const domainHash = () =>
  cvHash(Cl.tuple({
    name: Cl.stringAscii("smart-wallet-standard"),
    version: Cl.stringAscii("1.0.0"),
    "chain-id": Cl.uint(CHAIN_ID),
    wallet: Cl.contractPrincipal(D, "fakfun-wallet-v16"),
  }));
const challenge = (topic: any) => sha256(Buffer.concat([SIP018, domainHash(), cvHash(topic)]));

const key = generateP256Keypair();
const strip = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);
const pubkeyCV = Cl.bufferFromHex(strip(key.pubKeyHex));

function sigAuth(authId: number, signed: any) {
  return Cl.tuple({
    "auth-id": Cl.uint(authId),
    pubkey: pubkeyCV,
    signature: Cl.bufferFromHex(strip(signed.signatureHex)),
    "authenticator-data": Cl.bufferFromHex(strip(signed.authenticatorDataHex)),
    "client-data-prefix": Cl.bufferFromHex(strip(signed.clientDataPrefixHex)),
    "client-data-suffix": Cl.bufferFromHex(strip(signed.clientDataSuffixHex)),
  });
}
const sign = (topic: any, id: number) =>
  sigAuth(id, signChallengeWithRpId(challenge(topic), key.privKey, RP_ID));

const tAddAdmin = (id: number, a: string) => Cl.tuple({
  topic: Cl.stringAscii("add-admin"), "auth-id": Cl.uint(id), "new-admin": Cl.principal(a),
});
const tConfirmAdmin = (id: number, a: string) => Cl.tuple({
  topic: Cl.stringAscii("confirm-admin"), "auth-id": Cl.uint(id), "new-admin": Cl.principal(a),
});
const tConfig = (id: number, stx: number, sbtc: number, cd: number) => Cl.tuple({
  topic: Cl.stringAscii("set-wallet-config"), "auth-id": Cl.uint(id),
  "stx-threshold": Cl.uint(stx), "sbtc-threshold": Cl.uint(sbtc), "cooldown-period": Cl.uint(cd),
});

// --- setup ---------------------------------------------------------------
const V16_SRC = fs.readFileSync("contracts/fakfun-wallet-v16.clar", "utf8");
// see the header: v16 cannot be a requirement, so each test publishes it itself.
// simnet resets between tests, so this runs per test rather than once.
function deployV16() {
  expect(simnet.deployContract("fakfun-wallet-v16", V16_SRC,
    { clarityVersion: 6 }, D).result).toBeBool(true);
}
function verifyContract() {
  deployV16();
  return simnet.callPublicFn(CORE, "set-verified-contract",
    [Cl.contractPrincipal(D, "fakfun-wallet-v16"), Cl.none()], D);
}
function seatAdmin() {
  expect(verifyContract().result).toBeOk(Cl.bool(true));
  expect(simnet.callPublicFn(WALLET, "onboard", [pubkeyCV], FAKFUN_DEPLOYER).result)
    .toBeOk(Cl.bool(true));
  expect(simnet.callPublicFn(WALLET, "propose-admin-with-signature",
    [Cl.principal(OWNER), sign(tAddAdmin(1, OWNER), 1), Cl.none()], RELAYER).result)
    .toBeOk(Cl.bool(true));
  expect(simnet.callPublicFn(WALLET, "accept-admin-proposal", [], OWNER).result)
    .toBeOk(Cl.bool(true));
  simnet.mineEmptyBurnBlocks(PUBKEY_COOLDOWN + 10);
  expect(simnet.callPublicFn(WALLET, "confirm-admin-with-signature",
    [sign(tConfirmAdmin(2, OWNER), 2), Cl.none()], RELAYER).result)
    .toBeOk(Cl.bool(true));
}
const cfg = () => simnet.getDataVar(WALLET, "wallet-config");
const pending = () => simnet.callReadOnlyFn(WALLET, "get-pending-config", [], OWNER).result;

describe("fakfun-wallet-v16: init and admin seating", () => {
  it("onboard takes only the pubkey and needs FAKFUN-DEPLOYER", () => {
    expect(verifyContract().result).toBeOk(Cl.bool(true));
    expect(simnet.callPublicFn(WALLET, "onboard", [pubkeyCV], RANDOM).result)
      .toBeErr(Cl.uint(ERR_UNAUTH));
    expect(simnet.callPublicFn(WALLET, "onboard", [pubkeyCV], FAKFUN_DEPLOYER).result)
      .toBeOk(Cl.bool(true));
  });

  it("seats the admin through the three-step flow", () => {
    seatAdmin();
    expect(simnet.callReadOnlyFn(WALLET, "get-owner", [], OWNER).result)
      .toBeOk(Cl.principal(OWNER));
  });

  it("confirm-admin is refused before the pubkey cooldown elapses", () => {
    expect(verifyContract().result).toBeOk(Cl.bool(true));
    simnet.callPublicFn(WALLET, "onboard", [pubkeyCV], FAKFUN_DEPLOYER);
    simnet.callPublicFn(WALLET, "propose-admin-with-signature",
      [Cl.principal(OWNER), sign(tAddAdmin(1, OWNER), 1), Cl.none()], RELAYER);
    simnet.callPublicFn(WALLET, "accept-admin-proposal", [], OWNER);

    expect(simnet.callPublicFn(WALLET, "confirm-admin-with-signature",
      [sign(tConfirmAdmin(2, OWNER), 2), Cl.none()], RELAYER).result)
      .toBeErr(Cl.uint(ERR_IN_COOLDOWN));
  });

  it("only the proposed principal can accept", () => {
    expect(verifyContract().result).toBeOk(Cl.bool(true));
    simnet.callPublicFn(WALLET, "onboard", [pubkeyCV], FAKFUN_DEPLOYER);
    simnet.callPublicFn(WALLET, "propose-admin-with-signature",
      [Cl.principal(OWNER), sign(tAddAdmin(1, OWNER), 1), Cl.none()], RELAYER);
    // u4028 err-init-not-pending-admin: RANDOM is not who was proposed
    expect(simnet.callPublicFn(WALLET, "accept-admin-proposal", [], RANDOM).result)
      .toBeErr(Cl.uint(4028));
  });

  it("the seating flow cannot be re-run once initialised", () => {
    seatAdmin();
    // u4022 err-already-initialized: the seating flow is one-shot
    expect(simnet.callPublicFn(WALLET, "propose-admin-with-signature",
      [Cl.principal(RANDOM), sign(tAddAdmin(3, RANDOM), 3), Cl.none()], RELAYER).result)
      .toBeErr(Cl.uint(4022));
  });
});

describe("fakfun-wallet-v16: no post-init passkey registration", () => {
  it("propose-admin-pubkey and confirm-admin-pubkey do not exist", () => {
    deployV16();
    const iface = (simnet as any).getContractsInterfaces().get(WALLET);
    const names = iface.functions.map((f: any) => f.name);
    expect(names).not.toContain("propose-admin-pubkey");
    expect(names).not.toContain("confirm-admin-pubkey");
    expect(names).not.toContain("signal-pubkey-cooldown-change");
    expect(names).not.toContain("confirm-pubkey-cooldown-change");
    // and enroll-dual-stacking is gone too
    expect(names).not.toContain("enroll-dual-stacking");
  });

  it("still exposes the surface it should", () => {
    deployV16();
    const iface = (simnet as any).getContractsInterfaces().get(WALLET);
    const names = iface.functions.map((f: any) => f.name);
    for (const fn of ["onboard", "signal-config-change", "set-wallet-config",
                      "propose-max-gas-amount", "confirm-max-gas-amount",
                      "stx-transfer", "sip010-transfer", "sip009-transfer",
                      "recover-inactive-wallet", "veto-operation"]) {
      expect(names).toContain(fn);
    }
  });
});

describe("fakfun-wallet-v16: config change spans two different factors", () => {
  it("signal is admin-only and bounds-checked", () => {
    seatAdmin();
    expect(simnet.callPublicFn(WALLET, "signal-config-change",
      [Cl.uint(2), Cl.uint(2), Cl.uint(288)], RANDOM).result).toBeErr(Cl.uint(ERR_UNAUTH));
    expect(simnet.callPublicFn(WALLET, "signal-config-change",
      [Cl.uint(2), Cl.uint(2), Cl.uint(MIN_COOLDOWN - 1)], OWNER).result)
      .toBeErr(Cl.uint(ERR_COOLDOWN_TOO_SHORT));
    expect(simnet.callPublicFn(WALLET, "signal-config-change",
      [Cl.uint(2), Cl.uint(2), Cl.uint(MAX_COOLDOWN + 1)], OWNER).result)
      .toBeErr(Cl.uint(ERR_COOLDOWN_TOO_LONG));
    expect(simnet.callPublicFn(WALLET, "signal-config-change",
      [Cl.uint(250_000_000), Cl.uint(300_000), Cl.uint(288)], OWNER).result)
      .toBeOk(Cl.bool(true));
  });

  it("queues publicly and leaves the live config untouched", () => {
    seatAdmin();
    const before = cfg();
    simnet.callPublicFn(WALLET, "signal-config-change",
      [Cl.uint(250_000_000), Cl.uint(300_000), Cl.uint(288)], OWNER);
    expect(pending()).toBeTuple({
      "stx-threshold": Cl.uint(250_000_000),
      "sbtc-threshold": Cl.uint(300_000),
      "cooldown-period": Cl.uint(288),
    });
    expect(Cl.prettyPrint(cfg())).toContain("cooldown-period");
    expect(Cl.prettyPrint(cfg())).not.toContain("u250000000");
  });

  it("the admin key ALONE cannot finish it, and the queue survives", () => {
    seatAdmin();
    simnet.callPublicFn(WALLET, "signal-config-change",
      [Cl.uint(250_000_000), Cl.uint(300_000), Cl.uint(288)], OWNER);
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);

    const garbage = Cl.tuple({
      "auth-id": Cl.uint(90), pubkey: pubkeyCV,
      signature: Cl.bufferFromHex("00".repeat(64)),
      "authenticator-data": Cl.bufferFromHex("00".repeat(37)),
      "client-data-prefix": Cl.bufferFromHex("7b7d"),
      "client-data-suffix": Cl.bufferFromHex("7b7d"),
    });
    expect(simnet.callPublicFn(WALLET, "set-wallet-config", [garbage, Cl.none()], OWNER).result)
      .toBeErr(Cl.uint(ERR_BADSIG));
    expect(pending()).toBeTuple({
      "stx-threshold": Cl.uint(250_000_000),
      "sbtc-threshold": Cl.uint(300_000),
      "cooldown-period": Cl.uint(288),
    });
  });

  it("rejects a signature bound to different values", () => {
    seatAdmin();
    simnet.callPublicFn(WALLET, "signal-config-change",
      [Cl.uint(250_000_000), Cl.uint(300_000), Cl.uint(288)], OWNER);
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
    expect(simnet.callPublicFn(WALLET, "set-wallet-config",
      [sign(tConfig(10, 999_000_000, 300_000, 288), 10), Cl.none()], RELAYER).result)
      .toBeErr(Cl.uint(ERR_BADSIG));
  });

  it("applies the pending values with the passkey and clears the queue", () => {
    seatAdmin();
    simnet.callPublicFn(WALLET, "signal-config-change",
      [Cl.uint(250_000_000), Cl.uint(300_000), Cl.uint(288)], OWNER);
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
    expect(simnet.callPublicFn(WALLET, "set-wallet-config",
      [sign(tConfig(11, 250_000_000, 300_000, 288), 11), Cl.none()], RELAYER).result)
      .toBeOk(Cl.bool(true));
    expect(pending()).toBeTuple({
      "stx-threshold": Cl.uint(0), "sbtc-threshold": Cl.uint(0), "cooldown-period": Cl.uint(0),
    });
  });
});

describe("fakfun-wallet-v16: max-gas and thresholds", () => {
  it("propose-max-gas is admin-only, ceilinged, and does not move the live value", () => {
    seatAdmin();
    expect(simnet.callPublicFn(WALLET, "propose-max-gas-amount", [Cl.uint(5000)], RANDOM).result)
      .toBeErr(Cl.uint(ERR_UNAUTH));
    expect(simnet.callPublicFn(WALLET, "propose-max-gas-amount", [Cl.uint(20_000)], OWNER).result)
      .toBeErr(Cl.uint(ERR_THRESHOLD));
    expect(simnet.callPublicFn(WALLET, "propose-max-gas-amount", [Cl.uint(5000)], OWNER).result)
      .toBeOk(Cl.bool(true));
    expect(simnet.getDataVar(WALLET, "max-gas-amount")).toBeUint(1000);
  });

  it("an over-threshold STX transfer queues and moves nothing", () => {
    seatAdmin();
    simnet.transferSTX(500_000_000, WALLET, OWNER);
    const before = simnet.getAssetsMap().get("STX")?.get(RECIPIENT) ?? 0n;
    expect(simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(400_000_000), Cl.principal(RECIPIENT), Cl.none(), Cl.none(), Cl.none()],
      OWNER).result).toBeOk(Cl.bool(true));
    expect(simnet.getAssetsMap().get("STX")?.get(RECIPIENT) ?? 0n).toBe(before);
  });

  it("an under-threshold STX transfer moves immediately", () => {
    seatAdmin();
    simnet.transferSTX(500_000_000, WALLET, OWNER);
    const before = simnet.getAssetsMap().get("STX")?.get(RECIPIENT) ?? 0n;
    expect(simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(1_000_000), Cl.principal(RECIPIENT), Cl.none(), Cl.none(), Cl.none()],
      OWNER).result).toBeOk(Cl.bool(true));
    expect(simnet.getAssetsMap().get("STX")?.get(RECIPIENT) ?? 0n).toBe(before + 1_000_000n);
  });
});

describe("fakfun-wallet-v16: never its own admin", () => {
  it("is-admin-calling rejects the contract's own principal", () => {
    seatAdmin();
    expect(simnet.callReadOnlyFn(WALLET, "is-admin-calling",
      [Cl.contractPrincipal(D, "fakfun-wallet-v16")], OWNER).result)
      .toBeErr(Cl.uint(ERR_UNAUTH));
    expect(simnet.callReadOnlyFn(WALLET, "is-admin-calling", [Cl.principal(OWNER)], OWNER).result)
      .toBeOk(Cl.bool(true));
  });

  it("recover-inactive-wallet refuses to seat the contract", () => {
    seatAdmin();
    simnet.mineEmptyBurnBlocks(52_560 + 10);
    // recovery-address is unset on this wallet (never proposed), so the caller
    // check fires first -- the point is that it never succeeds.
    expect(simnet.callPublicFn(WALLET, "recover-inactive-wallet",
      [Cl.contractPrincipal(D, "fakfun-wallet-v16")], OWNER).result)
      .toBeErr(Cl.uint(ERR_UNAUTH));
  });
});
