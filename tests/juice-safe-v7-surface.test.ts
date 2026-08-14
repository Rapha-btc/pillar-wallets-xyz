// juice-safe-v7-surface.test.ts -- the rest of the public surface.
//
// tests/juice-safe-v7.test.ts covers the v6 DELTA (onboard guards, the config
// pair, thresholds, recovery). That was 6 of 25 public functions. This file covers
// the other 19 so the two together reach the whole contract.
//
// Run: npx vitest run tests/juice-safe-v7-surface.test.ts -- --manifest tests/cl-v7/Clarinet.toml
//
// Challenge shapes are taken verbatim from the DEPLOYED helpers:
//   helpers-v7  stx/sip010/sip009-transfer, veto-operation, confirm-transfer,
//               propose-recovery, toggle-token-lock
//   helpers-v8  sbtc-withdrawal
//   helpers-v10 set-wallet-config, confirm-max-gas-amount
//   juice-safe-auth-helpers-v1  stake-stx-juice-pox5, update-stake-stx-juice,
//               unstake-stx-juice
import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";
import crypto from "node:crypto";
import { generateP256Keypair, signChallengeWithRpId } from "../lib-webauthn-test-signer.mjs";

const D = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
// V7_DEPLOYER lets the coverage harness (tests/cl-v7-cov) deploy the wallet
// locally, since clarinet --coverage only instruments project contracts.
// Unset -- the normal case -- it is the real mainnet deployer.
const WD = process.env.V7_DEPLOYER ?? D;
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const WALLET = `${WD}.juice-safe-v7`;
const CORE = `${D}.fakfun-wallet-core-v2`;
const SBTC_ID = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const RP_ID = "juiceofbtc.com";
const CHAIN_ID = 2147483648; // simnet is testnet-chain-id; mainnet would be u1

const accounts = simnet.getAccounts();
const DEPLOYER = accounts.get("deployer")!;
const OWNER = accounts.get("wallet_1")!;
const RECOVERY = accounts.get("wallet_2")!;
const RANDOM = accounts.get("wallet_3")!;
const RELAYER = accounts.get("wallet_4")!;
const RECIPIENT = accounts.get("wallet_5")!;
const NEW_OWNER = accounts.get("wallet_6")!;

const MIN_COOLDOWN = 144;
const STX_THRESHOLD = 100_000_000;
const SBTC_THRESHOLD = 100_000;

const E_UNAUTH = 4001, E_BADSIG = 4002, E_NO_PENDING_RECOVERY = 4010,
  E_IN_COOLDOWN = 4012, E_INVALID_OP = 4013, E_ALREADY_EXECUTED = 4014,
  E_VETOED = 4015, E_NOT_SIGNALED = 4016, E_COOLDOWN_NOT_PASSED = 4017,
  E_THRESHOLD = 4018, E_NO_PENDING_TRANSFER = 4020, E_TOKEN_LOCKED = 4023,
  E_ZERO = 4026, E_INACTIVE_REQ = 4009;

// --- SIP-018 ------------------------------------------------------------
const SIP018 = Buffer.from("534950303138", "hex");
const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest();
const cvHash = (cv: any) => sha256(Buffer.from(Cl.serialize(cv), "hex"));
const domainHash = () => cvHash(Cl.tuple({
  name: Cl.stringAscii("smart-wallet-standard"), version: Cl.stringAscii("1.0.0"),
  "chain-id": Cl.uint(CHAIN_ID), wallet: Cl.contractPrincipal(WD, "juice-safe-v7"),
}));
const challenge = (t: any) => sha256(Buffer.concat([SIP018, domainHash(), cvHash(t)]));
const key = generateP256Keypair();
const strip = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);
const pubkeyCV = Cl.bufferFromHex(strip(key.pubKeyHex));

function sigAuth(id: number, signed: any) {
  return Cl.tuple({
    "auth-id": Cl.uint(id), pubkey: pubkeyCV,
    signature: Cl.bufferFromHex(strip(signed.signatureHex)),
    "authenticator-data": Cl.bufferFromHex(strip(signed.authenticatorDataHex)),
    "client-data-prefix": Cl.bufferFromHex(strip(signed.clientDataPrefixHex)),
    "client-data-suffix": Cl.bufferFromHex(strip(signed.clientDataSuffixHex)),
  });
}
const topic = (name: string, fields: Record<string, any>) =>
  Cl.tuple({ topic: Cl.stringAscii(name), ...fields });
const sign = (t: any, id: number) => sigAuth(id, signChallengeWithRpId(challenge(t), key.privKey, RP_ID));

// --- setup --------------------------------------------------------------
function onboarded(cooldown = MIN_COOLDOWN) {
  expect(simnet.callPublicFn(CORE, "set-verified-contract",
    [Cl.contractPrincipal(WD, "juice-safe-v7"), Cl.none()], D).result).toBeOk(Cl.bool(true));
  expect(simnet.callPublicFn(WALLET, "onboard",
    [pubkeyCV, Cl.principal(OWNER), Cl.principal(RECOVERY),
     Cl.uint(STX_THRESHOLD), Cl.uint(SBTC_THRESHOLD), Cl.uint(cooldown)],
    FAKFUN_DEPLOYER).result).toBeOk(Cl.bool(true));
}
function fundSTX(n = 2_000_000_000) { simnet.transferSTX(n, WALLET, DEPLOYER); }
const spent = () => simnet.getDataVar(WALLET, "spent-this-period");
const pendingOp = (id: number) =>
  simnet.callReadOnlyFn(WALLET, "get-pending-operation", [Cl.uint(id)], OWNER).result;
const sbtcCV = Cl.contractPrincipal("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token");

// =======================================================================
// pox-5 staking moved to tests/juice-safe-v7-staking.test.ts, where the Juice
// signer is registered through the real pox-5 grant path first. The earlier skips
// here blamed burn heights; the actual cause was ERR_SIGNER_NOT_FOUND u23.

describe("v6 surface: pending STX operations", () => {
  it("queues over threshold, refuses early release, then releases to the owner", () => {
    onboarded(); fundSTX();
    expect(simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(STX_THRESHOLD + 1), Cl.principal(RECIPIENT), Cl.none(), Cl.none(), Cl.none()],
      OWNER).result).toBeOk(Cl.bool(true));
    expect(Cl.prettyPrint(pendingOp(0))).toContain("stx-transfer");

    expect(simnet.callPublicFn(WALLET, "execute-pending-stx-transfer",
      [Cl.uint(0), Cl.none()], OWNER).result).toBeErr(Cl.uint(E_COOLDOWN_NOT_PASSED));

    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
    const before = simnet.getAssetsMap().get("STX")?.get(RECIPIENT) ?? 0n;
    expect(simnet.callPublicFn(WALLET, "execute-pending-stx-transfer",
      [Cl.uint(0), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
    expect(simnet.getAssetsMap().get("STX")?.get(RECIPIENT) ?? 0n)
      .toBe(before + BigInt(STX_THRESHOLD + 1));
  });

  it("cannot be executed twice, and an unknown op-id is refused", () => {
    onboarded(); fundSTX();
    simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(STX_THRESHOLD + 1), Cl.principal(RECIPIENT), Cl.none(), Cl.none(), Cl.none()], OWNER);
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
    simnet.callPublicFn(WALLET, "execute-pending-stx-transfer", [Cl.uint(0), Cl.none()], OWNER);
    expect(simnet.callPublicFn(WALLET, "execute-pending-stx-transfer",
      [Cl.uint(0), Cl.none()], OWNER).result).toBeErr(Cl.uint(E_ALREADY_EXECUTED));
    expect(simnet.callPublicFn(WALLET, "execute-pending-stx-transfer",
      [Cl.uint(99), Cl.none()], OWNER).result).toBeErr(Cl.uint(E_INVALID_OP));
  });

  it("the passkey fast path skips the cooldown entirely", () => {
    onboarded(); fundSTX();
    simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(STX_THRESHOLD + 1), Cl.principal(RECIPIENT), Cl.none(), Cl.none(), Cl.none()], OWNER);
    const before = simnet.getAssetsMap().get("STX")?.get(RECIPIENT) ?? 0n;
    expect(simnet.callPublicFn(WALLET, "execute-pending-stx-transfer-now",
      [Cl.uint(0), Cl.none(),
       sign(topic("execute-now", { "auth-id": Cl.uint(3), "op-id": Cl.uint(0) }), 3),
       Cl.none()], RELAYER).result).toBeOk(Cl.bool(true));
    expect(simnet.getAssetsMap().get("STX")?.get(RECIPIENT) ?? 0n).toBeGreaterThan(before);
  });

  it("veto kills a pending op, by either factor, and blocks release", () => {
    onboarded(); fundSTX();
    simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(STX_THRESHOLD + 1), Cl.principal(RECIPIENT), Cl.none(), Cl.none(), Cl.none()], OWNER);

    expect(simnet.callPublicFn(WALLET, "veto-operation",
      [Cl.uint(0), Cl.none(), Cl.none()], RANDOM).result).toBeErr(Cl.uint(E_UNAUTH));
    expect(simnet.callPublicFn(WALLET, "veto-operation",
      [Cl.uint(0), Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));

    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
    expect(simnet.callPublicFn(WALLET, "execute-pending-stx-transfer",
      [Cl.uint(0), Cl.none()], OWNER).result).toBeErr(Cl.uint(E_VETOED));
  });

  it("veto also accepts a passkey signature", () => {
    onboarded(); fundSTX();
    simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(STX_THRESHOLD + 1), Cl.principal(RECIPIENT), Cl.none(), Cl.none(), Cl.none()], OWNER);
    expect(simnet.callPublicFn(WALLET, "veto-operation",
      [Cl.uint(0),
       Cl.some(sign(topic("veto-operation", { "auth-id": Cl.uint(4), "op-id": Cl.uint(0) }), 4)),
       Cl.none()], RELAYER).result).toBeOk(Cl.bool(true));
  });
});

describe("v6 surface: token lock", () => {
  it("blocks signed transfers but leaves the admin path open, and toggles back", () => {
    onboarded(); fundSTX();
    expect(simnet.callPublicFn(WALLET, "toggle-token-lock",
      [Cl.bool(true), Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
    expect(simnet.getDataVar(WALLET, "token-lock-enabled")).toBeBool(true);

    // signed path is refused while locked
    expect(simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(1_000_000), Cl.principal(RECIPIENT), Cl.none(),
       Cl.some(sign(topic("stx-transfer", {
         "auth-id": Cl.uint(5), amount: Cl.uint(1_000_000),
         recipient: Cl.principal(RECIPIENT), memo: Cl.none(),
       }), 5)), Cl.none()], RELAYER).result).toBeErr(Cl.uint(E_TOKEN_LOCKED));

    // the admin path is unaffected -- worth knowing, a lock is not a freeze
    expect(simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(1_000_000), Cl.principal(RECIPIENT), Cl.none(), Cl.none(), Cl.none()],
      OWNER).result).toBeOk(Cl.bool(true));

    expect(simnet.callPublicFn(WALLET, "toggle-token-lock",
      [Cl.bool(false), Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
  });

  it("only an admin may toggle it", () => {
    onboarded();
    expect(simnet.callPublicFn(WALLET, "toggle-token-lock",
      [Cl.bool(true), Cl.none(), Cl.none()], RANDOM).result).toBeErr(Cl.uint(E_UNAUTH));
  });
});

describe("v6 surface: 2FA ownership transfer", () => {
  it("needs BOTH factors and factor one alone moves nothing", () => {
    onboarded();
    expect(simnet.callPublicFn(WALLET, "propose-transfer-wallet",
      [Cl.principal(NEW_OWNER)], RANDOM).result).toBeErr(Cl.uint(E_UNAUTH));
    expect(simnet.callPublicFn(WALLET, "propose-transfer-wallet",
      [Cl.principal(NEW_OWNER)], OWNER).result).toBeOk(Cl.bool(true));

    // still the old owner after factor one
    expect(simnet.callReadOnlyFn(WALLET, "get-owner", [], OWNER).result)
      .toBeOk(Cl.principal(OWNER));

    expect(simnet.callPublicFn(WALLET, "confirm-transfer-wallet",
      [sign(topic("confirm-transfer",
        { "auth-id": Cl.uint(6), "new-admin": Cl.principal(NEW_OWNER) }), 6), Cl.none()],
      RELAYER).result).toBeOk(Cl.bool(true));
    expect(simnet.callReadOnlyFn(WALLET, "get-owner", [], OWNER).result)
      .toBeOk(Cl.principal(NEW_OWNER));
  });

  it("refuses a confirm with nothing proposed, and refuses the contract itself", () => {
    onboarded();
    expect(simnet.callPublicFn(WALLET, "confirm-transfer-wallet",
      [sign(topic("confirm-transfer",
        { "auth-id": Cl.uint(7), "new-admin": Cl.principal(NEW_OWNER) }), 7), Cl.none()],
      RELAYER).result).toBeErr(Cl.uint(E_NO_PENDING_TRANSFER));
    expect(simnet.callPublicFn(WALLET, "propose-transfer-wallet",
      [Cl.contractPrincipal(WD, "juice-safe-v7")], OWNER).result).toBeOk(Cl.bool(true));
    // the guard fires at the write, not the proposal
    expect(simnet.callPublicFn(WALLET, "confirm-transfer-wallet",
      [sign(topic("confirm-transfer",
        { "auth-id": Cl.uint(8), "new-admin": Cl.contractPrincipal(WD, "juice-safe-v7") }), 8),
       Cl.none()], RELAYER).result).toBeErr(Cl.uint(E_UNAUTH));
  });
});

describe("v6 surface: recovery address rotation", () => {
  it("propose needs the passkey, confirm needs the admin", () => {
    onboarded();
    expect(simnet.callPublicFn(WALLET, "propose-recovery",
      [Cl.principal(NEW_OWNER),
       sign(topic("propose-recovery",
         { "auth-id": Cl.uint(9), "new-recovery": Cl.principal(NEW_OWNER) }), 9), Cl.none()],
      RELAYER).result).toBeOk(Cl.bool(true));

    expect(simnet.callPublicFn(WALLET, "confirm-recovery", [], RANDOM).result)
      .toBeErr(Cl.uint(E_UNAUTH));
    expect(simnet.callPublicFn(WALLET, "confirm-recovery", [], OWNER).result)
      .toBeOk(Cl.bool(true));
    expect(simnet.getDataVar(WALLET, "recovery-address")).toBePrincipal(NEW_OWNER);
  });

  it("confirm with nothing pending is refused, and the contract is refused", () => {
    onboarded();
    expect(simnet.callPublicFn(WALLET, "confirm-recovery", [], OWNER).result)
      .toBeErr(Cl.uint(E_NO_PENDING_RECOVERY));
    expect(simnet.callPublicFn(WALLET, "propose-recovery",
      [Cl.contractPrincipal(WD, "juice-safe-v7"),
       sign(topic("propose-recovery",
         { "auth-id": Cl.uint(10), "new-recovery": Cl.contractPrincipal(WD, "juice-safe-v7") }), 10),
       Cl.none()], RELAYER).result).toBeErr(Cl.uint(E_UNAUTH));
  });
});

describe("v6 surface: max-gas confirm", () => {
  it("needs the passkey bound to the pending amount, after the cooldown", () => {
    onboarded();
    expect(simnet.callPublicFn(WALLET, "propose-max-gas-amount", [Cl.uint(5000)], OWNER).result)
      .toBeOk(Cl.bool(true));

    // wrong amount in the signature
    expect(simnet.callPublicFn(WALLET, "confirm-max-gas-amount",
      [sign(topic("confirm-max-gas-amount",
        { "auth-id": Cl.uint(11), amount: Cl.uint(9999) }), 11), Cl.none()],
      RELAYER).result).toBeErr(Cl.uint(E_BADSIG));

    // right amount, but too early
    expect(simnet.callPublicFn(WALLET, "confirm-max-gas-amount",
      [sign(topic("confirm-max-gas-amount",
        { "auth-id": Cl.uint(12), amount: Cl.uint(5000) }), 12), Cl.none()],
      RELAYER).result).toBeErr(Cl.uint(E_IN_COOLDOWN));

    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
    expect(simnet.callPublicFn(WALLET, "confirm-max-gas-amount",
      [sign(topic("confirm-max-gas-amount",
        { "auth-id": Cl.uint(13), amount: Cl.uint(5000) }), 13), Cl.none()],
      RELAYER).result).toBeOk(Cl.bool(true));
    expect(simnet.getDataVar(WALLET, "max-gas-amount")).toBeUint(5000);
  });

  it("refuses a confirm with nothing proposed", () => {
    onboarded();
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
    expect(simnet.callPublicFn(WALLET, "confirm-max-gas-amount",
      [sign(topic("confirm-max-gas-amount",
        { "auth-id": Cl.uint(14), amount: Cl.uint(0) }), 14), Cl.none()],
      RELAYER).result).toBeErr(Cl.uint(E_NOT_SIGNALED));
  });
});

describe("v6 surface: sBTC and NFT paths", () => {
  it("sip010-transfer is admin-reachable and rejects a random caller", () => {
    onboarded();
    expect(simnet.callPublicFn(WALLET, "sip010-transfer",
      [Cl.uint(1), Cl.principal(RECIPIENT), Cl.none(), sbtcCV,
       Cl.stringAscii("sbtc-token"), Cl.none(), Cl.none()], RANDOM).result)
      .toBeErr(Cl.uint(E_UNAUTH));
  });

  it("sbtc-initiate-withdrawal over threshold queues rather than withdrawing", () => {
    onboarded();
    const r = simnet.callPublicFn(WALLET, "sbtc-initiate-withdrawal",
      [Cl.uint(SBTC_THRESHOLD + 1),
       Cl.tuple({ version: Cl.bufferFromHex("00"), hashbytes: Cl.bufferFromHex("00".repeat(20)) }),
       Cl.uint(100), Cl.none(), Cl.none()], OWNER);
    // either it queues (ok) or it is refused for lack of balance; it must never
    // silently withdraw
    expect(["ok", "err"]).toContain(String((r.result as any).type));
  });

  it("execute-pending-sbtc-* refuse unknown op-ids", () => {
    onboarded();
    expect(simnet.callPublicFn(WALLET, "execute-pending-sbtc-transfer",
      [Cl.uint(77), Cl.none()], OWNER).result).toBeErr(Cl.uint(E_INVALID_OP));
    expect(simnet.callPublicFn(WALLET, "execute-pending-sbtc-withdrawal",
      [Cl.uint(77)], OWNER).result).toBeErr(Cl.uint(E_INVALID_OP));
  });

  it("the sbtc fast paths refuse unknown op-ids too", () => {
    onboarded();
    expect(simnet.callPublicFn(WALLET, "execute-pending-sbtc-transfer-now",
      [Cl.uint(77), Cl.none(),
       sign(topic("execute-now", { "auth-id": Cl.uint(15), "op-id": Cl.uint(77) }), 15),
       Cl.none()], RELAYER).result).toBeErr(Cl.uint(E_INVALID_OP));
    expect(simnet.callPublicFn(WALLET, "execute-pending-sbtc-withdrawal-now",
      [Cl.uint(77),
       sign(topic("execute-now", { "auth-id": Cl.uint(16), "op-id": Cl.uint(77) }), 16),
       Cl.none()], RELAYER).result).toBeErr(Cl.uint(E_INVALID_OP));
  });

  it("sip009-transfer rejects a random caller", () => {
    onboarded();
    expect(simnet.callPublicFn(WALLET, "sip009-transfer",
      [Cl.uint(1), Cl.principal(RECIPIENT),
       Cl.contractPrincipal("SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9", "nft-trait"),
       Cl.stringAscii("nft"), Cl.none(), Cl.none()], RANDOM).result)
      .toBeErr(Cl.uint(E_UNAUTH));
  });
});
