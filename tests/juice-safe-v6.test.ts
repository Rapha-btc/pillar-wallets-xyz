// juice-safe-v6.test.ts -- Clarinet scenario tests against the DEPLOYED source.
//
// Run:  npx vitest run tests/juice-safe-v6.test.ts -- --manifest tests/cl-v6/Clarinet.toml
//
// The contract compiled here is byte-identical to
// SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-safe-v6 on mainnet, and every
// dependency is a real mainnet contract pulled via clarinet requirements -- no
// mocks. So a pass here says something about the deployed bytes.
//
// Simnet lets us send as any principal, which matters because onboard is gated on
// FAKFUN-DEPLOYER and set-verified-contract on the Faktory deployer.
import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";
import crypto from "node:crypto";
import {
  generateP256Keypair,
  signChallengeWithRpId,
} from "../lib-webauthn-test-signer.mjs";

const D = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
// V6_DEPLOYER lets the coverage harness (tests/cl-v6-cov) deploy the wallet
// locally, since clarinet --coverage only instruments project contracts.
// Unset -- the normal case -- it is the real mainnet deployer.
const WD = process.env.V6_DEPLOYER ?? D;
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const WALLET = `${WD}.juice-safe-v6`;
const CORE = `${D}.fakfun-wallet-core`;
const HELPERS_V10 = `${D}.smart-wallet-standard-auth-helpers-v10`;
const BURN = "SP000000000000000000002Q6VF78";
const RP_ID = "juiceofbtc.com";
const CHAIN_ID = 2147483648; // simnet/testnet; mainnet would be 1

const accounts = simnet.getAccounts();
const OWNER = accounts.get("wallet_1")!;
const RECOVERY = accounts.get("wallet_2")!;
const RANDOM = accounts.get("wallet_3")!;
const RELAYER = accounts.get("wallet_4")!;
const RECIPIENT = accounts.get("wallet_5")!;

const MIN_COOLDOWN = 144;
const MAX_COOLDOWN = 4032;
const STX_THRESHOLD = 100_000_000;
const SBTC_THRESHOLD = 100_000;

const ERR_UNAUTH = 4001;
const ERR_BADSIG = 4002;
const ERR_IN_COOLDOWN = 4012;
const ERR_NOT_SIGNALED = 4016;
const ERR_COOLDOWN_TOO_LONG = 4019;
const ERR_COOLDOWN_TOO_SHORT = 4031;

// --- SIP-018 challenge plumbing, mirroring helpers-v10 -------------------
const SIP018 = Buffer.from("534950303138", "hex");
const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest();
const cvHash = (cv: any) => sha256(Buffer.from(Cl.serialize(cv), "hex"));
const domainHash = () =>
  cvHash(
    Cl.tuple({
      name: Cl.stringAscii("smart-wallet-standard"),
      version: Cl.stringAscii("1.0.0"),
      // simnet runs with the TESTNET chain-id (0x80000000), not mainnet u1.
      // helpers-v10 builds the domain from the runtime chain-id, so the test
      // must match the network it is executing on or every signature is u4002.
      "chain-id": Cl.uint(CHAIN_ID),
      wallet: Cl.contractPrincipal(WD, "juice-safe-v6"),
    }),
  );
const challenge = (topic: any) =>
  sha256(Buffer.concat([SIP018, domainHash(), cvHash(topic)]));

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

function configTopic(authId: number, stx: number, sbtc: number, cooldown: number) {
  return Cl.tuple({
    topic: Cl.stringAscii("set-wallet-config"),
    "auth-id": Cl.uint(authId),
    "stx-threshold": Cl.uint(stx),
    "sbtc-threshold": Cl.uint(sbtc),
    "cooldown-period": Cl.uint(cooldown),
  });
}
const signConfig = (id: number, stx: number, sbtc: number, cd: number) =>
  sigAuth(id, signChallengeWithRpId(challenge(configTopic(id, stx, sbtc, cd)), key.privKey, RP_ID));

// --- helpers -------------------------------------------------------------
function verifyContract() {
  return simnet.callPublicFn(
    CORE, "set-verified-contract",
    [Cl.contractPrincipal(WD, "juice-safe-v6"), Cl.none()], D,
  );
}
function onboard(recovery: string, cooldown: number, owner = OWNER) {
  return simnet.callPublicFn(
    WALLET, "onboard",
    [pubkeyCV, Cl.principal(owner), Cl.principal(recovery),
     Cl.uint(STX_THRESHOLD), Cl.uint(SBTC_THRESHOLD), Cl.uint(cooldown)],
    FAKFUN_DEPLOYER,
  );
}
function onboarded() {
  expect(verifyContract().result).toBeOk(Cl.bool(true));
  expect(onboard(RECOVERY, MIN_COOLDOWN).result).toBeOk(Cl.bool(true));
}
const cfg = () => simnet.getDataVar(WALLET, "wallet-config");
const pending = () => simnet.callReadOnlyFn(WALLET, "get-pending-config", [], OWNER).result;

describe("juice-safe-v6: deploys and initialises against real mainnet dependencies", () => {
  it("is registered as canonical before onboard can succeed", () => {
    const before = onboard(RECOVERY, MIN_COOLDOWN);
    expect(before.result).toBeErr(Cl.uint(6001));

    expect(verifyContract().result).toBeOk(Cl.bool(true));
    expect(onboard(RECOVERY, MIN_COOLDOWN).result).toBeOk(Cl.bool(true));
  });

  it("rejects onboard from anyone but FAKFUN-DEPLOYER", () => {
    expect(verifyContract().result).toBeOk(Cl.bool(true));
    const r = simnet.callPublicFn(
      WALLET, "onboard",
      [pubkeyCV, Cl.principal(OWNER), Cl.principal(RECOVERY),
       Cl.uint(STX_THRESHOLD), Cl.uint(SBTC_THRESHOLD), Cl.uint(MIN_COOLDOWN)],
      RANDOM,
    );
    expect(r.result).toBeErr(Cl.uint(ERR_UNAUTH));
  });

  it("cannot be onboarded twice", () => {
    onboarded();
    expect(onboard(RECOVERY, MIN_COOLDOWN).result).toBeErr(Cl.uint(ERR_UNAUTH));
  });
});

describe("juice-safe-v6: onboard guards", () => {
  it("refuses the contract itself as recovery", () => {
    expect(verifyContract().result).toBeOk(Cl.bool(true));
    const r = simnet.callPublicFn(
      WALLET, "onboard",
      [pubkeyCV, Cl.principal(OWNER), Cl.contractPrincipal(WD, "juice-safe-v6"),
       Cl.uint(STX_THRESHOLD), Cl.uint(SBTC_THRESHOLD), Cl.uint(MIN_COOLDOWN)],
      FAKFUN_DEPLOYER,
    );
    expect(r.result).toBeErr(Cl.uint(ERR_UNAUTH));
  });

  it("refuses the owner as recovery", () => {
    expect(verifyContract().result).toBeOk(Cl.bool(true));
    expect(onboard(OWNER, MIN_COOLDOWN).result).toBeErr(Cl.uint(ERR_UNAUTH));
  });

  it("ACCEPTS the burn sentinel as recovery -- deliberate, no on-chain guard", () => {
    expect(verifyContract().result).toBeOk(Cl.bool(true));
    expect(onboard(BURN, MIN_COOLDOWN).result).toBeOk(Cl.bool(true));
    expect(simnet.getDataVar(WALLET, "recovery-address")).toBePrincipal(BURN);
  });

  it("enforces the cooldown floor and ceiling at onboard", () => {
    expect(verifyContract().result).toBeOk(Cl.bool(true));
    expect(onboard(RECOVERY, MIN_COOLDOWN - 1).result).toBeErr(Cl.uint(ERR_COOLDOWN_TOO_SHORT));
    expect(onboard(RECOVERY, MAX_COOLDOWN + 1).result).toBeErr(Cl.uint(ERR_COOLDOWN_TOO_LONG));
    expect(onboard(RECOVERY, MAX_COOLDOWN).result).toBeOk(Cl.bool(true));
  });

  it("honours a caller-supplied cooldown instead of hardcoding u144", () => {
    expect(verifyContract().result).toBeOk(Cl.bool(true));
    expect(onboard(RECOVERY, 500).result).toBeOk(Cl.bool(true));
    expect(cfg()).toBeTuple({
      "stx-threshold": Cl.uint(STX_THRESHOLD),
      "sbtc-threshold": Cl.uint(SBTC_THRESHOLD),
      "cooldown-period": Cl.uint(500),
      "config-signaled-at": Cl.none(),
    });
  });
});

describe("juice-safe-v6: config change needs two different factors", () => {
  it("signal is admin-only", () => {
    onboarded();
    const args = [Cl.uint(200_000_000), Cl.uint(200_000), Cl.uint(288)];
    expect(simnet.callPublicFn(WALLET, "signal-config-change", args, RANDOM).result)
      .toBeErr(Cl.uint(ERR_UNAUTH));
    expect(simnet.callPublicFn(WALLET, "signal-config-change", args, OWNER).result)
      .toBeOk(Cl.bool(true));
  });

  it("enforces the cooldown bounds at signal", () => {
    onboarded();
    expect(simnet.callPublicFn(WALLET, "signal-config-change",
      [Cl.uint(1), Cl.uint(1), Cl.uint(MIN_COOLDOWN - 1)], OWNER).result)
      .toBeErr(Cl.uint(ERR_COOLDOWN_TOO_SHORT));
    expect(simnet.callPublicFn(WALLET, "signal-config-change",
      [Cl.uint(1), Cl.uint(1), Cl.uint(MAX_COOLDOWN + 1)], OWNER).result)
      .toBeErr(Cl.uint(ERR_COOLDOWN_TOO_LONG));
  });

  it("queues the values publicly and leaves the live config untouched", () => {
    onboarded();
    simnet.callPublicFn(WALLET, "signal-config-change",
      [Cl.uint(250_000_000), Cl.uint(300_000), Cl.uint(288)], OWNER);

    expect(pending()).toBeTuple({
      "stx-threshold": Cl.uint(250_000_000),
      "sbtc-threshold": Cl.uint(300_000),
      "cooldown-period": Cl.uint(288),
    });
    expect(cfg()).toBeTuple({
      "stx-threshold": Cl.uint(STX_THRESHOLD),
      "sbtc-threshold": Cl.uint(SBTC_THRESHOLD),
      "cooldown-period": Cl.uint(MIN_COOLDOWN),
      "config-signaled-at": Cl.some(Cl.uint(simnet.burnBlockHeight)),
    });
  });

  it("the admin key ALONE cannot finish a config change", () => {
    onboarded();
    simnet.callPublicFn(WALLET, "signal-config-change",
      [Cl.uint(250_000_000), Cl.uint(300_000), Cl.uint(288)], OWNER);
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);

    // a garbage signature is the best the admin key can do on its own
    const garbage = Cl.tuple({
      "auth-id": Cl.uint(99),
      pubkey: pubkeyCV,
      signature: Cl.bufferFromHex("00".repeat(64)),
      "authenticator-data": Cl.bufferFromHex("00".repeat(37)),
      "client-data-prefix": Cl.bufferFromHex("7b7d"),
      "client-data-suffix": Cl.bufferFromHex("7b7d"),
    });
    expect(simnet.callPublicFn(WALLET, "set-wallet-config", [garbage, Cl.none()], OWNER).result)
      .toBeErr(Cl.uint(ERR_BADSIG));

    // and the queued change survives the failed attempt
    expect(pending()).toBeTuple({
      "stx-threshold": Cl.uint(250_000_000),
      "sbtc-threshold": Cl.uint(300_000),
      "cooldown-period": Cl.uint(288),
    });
  });

  it("rejects a passkey signature bound to DIFFERENT values", () => {
    onboarded();
    simnet.callPublicFn(WALLET, "signal-config-change",
      [Cl.uint(250_000_000), Cl.uint(300_000), Cl.uint(288)], OWNER);
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);

    expect(simnet.callPublicFn(WALLET, "set-wallet-config",
      [signConfig(1, 999_000_000, 300_000, 288), Cl.none()], RELAYER).result)
      .toBeErr(Cl.uint(ERR_BADSIG));
  });

  it("rejects the correct signature BEFORE the cooldown elapses", () => {
    onboarded();
    simnet.callPublicFn(WALLET, "signal-config-change",
      [Cl.uint(250_000_000), Cl.uint(300_000), Cl.uint(288)], OWNER);

    expect(simnet.callPublicFn(WALLET, "set-wallet-config",
      [signConfig(2, 250_000_000, 300_000, 288), Cl.none()], RELAYER).result)
      .toBeErr(Cl.uint(ERR_IN_COOLDOWN));
  });

  it("applies the pending values with the passkey, then clears the queue", () => {
    onboarded();
    simnet.callPublicFn(WALLET, "signal-config-change",
      [Cl.uint(250_000_000), Cl.uint(300_000), Cl.uint(288)], OWNER);
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);

    expect(simnet.callPublicFn(WALLET, "set-wallet-config",
      [signConfig(3, 250_000_000, 300_000, 288), Cl.none()], RELAYER).result)
      .toBeOk(Cl.bool(true));

    expect(cfg()).toBeTuple({
      "stx-threshold": Cl.uint(250_000_000),
      "sbtc-threshold": Cl.uint(300_000),
      "cooldown-period": Cl.uint(288),
      "config-signaled-at": Cl.none(),
    });
    expect(pending()).toBeTuple({
      "stx-threshold": Cl.uint(0),
      "sbtc-threshold": Cl.uint(0),
      "cooldown-period": Cl.uint(0),
    });
  });

  it("refuses a confirm with nothing queued", () => {
    onboarded();
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
    expect(simnet.callPublicFn(WALLET, "set-wallet-config",
      [signConfig(4, 0, 0, 0), Cl.none()], RELAYER).result)
      .toBeErr(Cl.uint(ERR_NOT_SIGNALED));
  });
});

describe("juice-safe-v6: max-gas raise needs two different factors", () => {
  it("propose is admin-only and ceilinged", () => {
    onboarded();
    expect(simnet.callPublicFn(WALLET, "propose-max-gas-amount", [Cl.uint(5000)], RANDOM).result)
      .toBeErr(Cl.uint(ERR_UNAUTH));
    expect(simnet.callPublicFn(WALLET, "propose-max-gas-amount", [Cl.uint(20_000)], OWNER).result)
      .toBeErr(Cl.uint(4018));
    expect(simnet.callPublicFn(WALLET, "propose-max-gas-amount", [Cl.uint(5000)], OWNER).result)
      .toBeOk(Cl.bool(true));
    // the live value must not move on propose
    expect(simnet.getDataVar(WALLET, "max-gas-amount")).toBeUint(1000);
  });
});

describe("juice-safe-v6: thresholds queue rather than move", () => {
  it("an under-threshold STX transfer moves immediately", () => {
    onboarded();
    simnet.transferSTX(500_000_000, WALLET, OWNER);
    const r = simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(1_000_000), Cl.principal(RECIPIENT), Cl.none(), Cl.none(), Cl.none()], OWNER);
    expect(r.result).toBeOk(Cl.bool(true));
    expect(simnet.getDataVar(WALLET, "spent-this-period")).toBeTuple({
      stx: Cl.uint(1_000_000),
      sbtc: Cl.uint(0),
      gas: Cl.uint(0),
      "period-start": Cl.uint(simnet.burnBlockHeight),
    });
  });

  it("an OVER-threshold STX transfer queues and moves nothing", () => {
    onboarded();
    simnet.transferSTX(500_000_000, WALLET, OWNER);
    const before = simnet.getAssetsMap().get("STX")?.get(RECIPIENT) ?? 0n;

    const r = simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(STX_THRESHOLD + 1), Cl.principal(RECIPIENT), Cl.none(), Cl.none(), Cl.none()], OWNER);
    expect(r.result).toBeOk(Cl.bool(true));

    const after = simnet.getAssetsMap().get("STX")?.get(RECIPIENT) ?? 0n;
    expect(after).toBe(before);
  });

  it("rejects a transfer from a non-admin", () => {
    onboarded();
    simnet.transferSTX(500_000_000, WALLET, OWNER);
    expect(simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(1_000_000), Cl.principal(RECIPIENT), Cl.none(), Cl.none(), Cl.none()], RANDOM).result)
      .toBeErr(Cl.uint(ERR_UNAUTH));
  });
});

describe("juice-safe-v6: the contract is never its own admin", () => {
  it("is-admin-calling rejects the contract's own principal", () => {
    onboarded();
    expect(simnet.callReadOnlyFn(WALLET, "is-admin-calling",
      [Cl.contractPrincipal(WD, "juice-safe-v6")], OWNER).result)
      .toBeErr(Cl.uint(ERR_UNAUTH));
    expect(simnet.callReadOnlyFn(WALLET, "is-admin-calling", [Cl.principal(OWNER)], OWNER).result)
      .toBeOk(Cl.bool(true));
  });

  it("recover-inactive-wallet refuses to seat the contract", () => {
    onboarded();
    simnet.mineEmptyBurnBlocks(52_560 + 10);
    expect(simnet.callPublicFn(WALLET, "recover-inactive-wallet",
      [Cl.contractPrincipal(WD, "juice-safe-v6")], RECOVERY).result)
      .toBeErr(Cl.uint(ERR_UNAUTH));
  });
});

describe("juice-safe-v6: inactivity recovery", () => {
  it("is refused while the wallet is active and allowed once inactive", () => {
    onboarded();
    expect(simnet.callReadOnlyFn(WALLET, "is-inactive", [], OWNER).result).toBeBool(false);
    expect(simnet.callPublicFn(WALLET, "recover-inactive-wallet",
      [Cl.principal(RANDOM)], RECOVERY).result).toBeErr(Cl.uint(4009));

    simnet.mineEmptyBurnBlocks(52_560 + 10);
    expect(simnet.callReadOnlyFn(WALLET, "is-inactive", [], OWNER).result).toBeBool(true);

    // only the recovery principal
    expect(simnet.callPublicFn(WALLET, "recover-inactive-wallet",
      [Cl.principal(RANDOM)], RANDOM).result).toBeErr(Cl.uint(ERR_UNAUTH));
    expect(simnet.callPublicFn(WALLET, "recover-inactive-wallet",
      [Cl.principal(RANDOM)], RECOVERY).result).toBeOk(Cl.bool(true));
    expect(simnet.callReadOnlyFn(WALLET, "get-owner", [], OWNER).result).toBeOk(Cl.principal(RANDOM));
  });

  it("a config change resets the inactivity clock", () => {
    onboarded();
    const t0 = simnet.getDataVar(WALLET, "last-activity-block");
    simnet.mineEmptyBurnBlocks(1000);
    simnet.callPublicFn(WALLET, "signal-config-change",
      [Cl.uint(200_000_000), Cl.uint(200_000), Cl.uint(288)], OWNER);
    const t1 = simnet.getDataVar(WALLET, "last-activity-block");
    expect(Cl.prettyPrint(t1)).not.toBe(Cl.prettyPrint(t0));
  });
});
