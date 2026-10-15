// juice-autostake-safe-cross-safe-replay.test.ts -- repro for the bounty-triage
// lead "one passkey on two safes: a signature made for safe A replays on safe B".
//
// Setup: two byte-identical safes (A = juice-autostake-safe, B = a copy deployed
// as juice-autostake-safe-b), both onboarded with the SAME P-256 passkey. B is a
// byte copy, so its contract-hash? equals A's and core register-wallet accepts it.
//
// Each test signs an op for A, submits it to B first (must fail, and B's state
// must not move), then to A (must pass), then to B again (must still fail). A
// control signs the same op over B's domain and B accepts it, so the B failures
// come from the domain and not from a broken B setup.
//
// Every helper the safe calls builds the SIP-018 domain with
// `wallet: contract-caller`; the safe calls each helper directly, so
// contract-caller = the safe. The last block checks every helper's output
// changes with contract-caller.
//
// Run:
//   npx vitest run tests/juice-autostake-safe-cross-safe-replay.test.ts -- --manifest tests/cl-v7/Clarinet.toml
//   AUTOSTAKE_DEPLOYER=ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM \
//     npx vitest run tests/juice-autostake-safe-cross-safe-replay.test.ts -- --manifest tests/cl-autostake-cov/Clarinet.toml
import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";
import crypto from "node:crypto";
import fs from "node:fs";
import { generateP256Keypair, signChallengeWithRpId } from "../lib-webauthn-test-signer.mjs";

const D = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const WD = process.env.AUTOSTAKE_DEPLOYER ?? D;
const COV = WD !== D;
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const NAME_A = "juice-autostake-safe";
const NAME_B = "juice-autostake-safe-b";
const POOL_NAME = COV ? "juice-autostake-pool" : "juice-pool-sbtc-signer";
const HELPER_NAME = "juice-autostake-safe-auth-helpers-v1";
const SAFE_A = `${WD}.${NAME_A}`;
const SAFE_B = `${WD}.${NAME_B}`;
const CORE = `${D}.fakfun-wallet-core-v2`;
const RP_ID = "juiceofbtc.com";
const CHAIN_ID = 2147483648;

const accounts = simnet.getAccounts();
const DEPLOYER = accounts.get("deployer")!;
const OWNER = accounts.get("wallet_1")!;
const RECOVERY = accounts.get("wallet_2")!;
const RANDOM = accounts.get("wallet_3")!;
const RELAYER = accounts.get("wallet_4")!;
const NEW_KEEPER = accounts.get("wallet_5")!;
const SINK = accounts.get("wallet_6")!;

// low STX threshold: a 2 STX send queues a pending op (op-id u0)
const STX_THRESHOLD = 1_000_000;
const SBTC_THRESHOLD = 100_000;
const MIN_COOLDOWN = 144;
const FUND = 10_000_000;
const SEND = 2_000_000;

const E_INVALID_SIG = 4002, E_REPLAY = 4006;

// --- deploy -------------------------------------------------------------------
const POOL_SRC = fs.readFileSync(
  ".cache/requirements/SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-pool-stx-signer.clar", "utf8");
const HELPER_SRC = fs.readFileSync("contracts/juice-autostake-safe-auth-helpers-v1.clar", "utf8");
// B must be byte-identical to A (register-wallet compares contract-hash?)
const WALLET_SRC = fs.readFileSync(
  COV ? "tests/cl-autostake-cov/contracts/juice-autostake-safe.clar" : "contracts/juice-autostake-safe.clar", "utf8");

function deployAll() {
  if (!COV) {
    expect(simnet.deployContract(POOL_NAME, POOL_SRC, { clarityVersion: 5 }, D).result).toBeBool(true);
    expect(simnet.deployContract(HELPER_NAME, HELPER_SRC, { clarityVersion: 4 }, D).result).toBeBool(true);
    expect(simnet.deployContract(NAME_A, WALLET_SRC, { clarityVersion: 6 }, D).result).toBeBool(true);
  }
  expect(simnet.deployContract(NAME_B, WALLET_SRC, { clarityVersion: 6 }, WD).result).toBeBool(true);
}

// --- SIP-018 ------------------------------------------------------------------
const SIP018 = Buffer.from("534950303138", "hex");
function sha256(b: Buffer): Buffer {
  return crypto.createHash("sha256").update(b).digest();
}
function cvHash(cv: any): Buffer {
  return sha256(Buffer.from(Cl.serialize(cv), "hex"));
}
function strip(h: string): string {
  return h.startsWith("0x") ? h.slice(2) : h;
}

// ONE passkey, registered on both safes
const pk = generateP256Keypair();
const pubkeyCV = Cl.bufferFromHex(strip(pk.pubKeyHex));

function domain(wallet: string): Buffer {
  return cvHash(Cl.tuple({
    name: Cl.stringAscii("smart-wallet-standard"), version: Cl.stringAscii("1.0.0"),
    "chain-id": Cl.uint(CHAIN_ID), wallet: Cl.principal(wallet),
  }));
}
function envelope(wallet: string, struct: Record<string, any>): Buffer {
  return sha256(Buffer.concat([SIP018, domain(wallet), cvHash(Cl.tuple(struct))]));
}
/** juice-autostake-safe-auth-helpers-v1.build-set-keeper-hash */
function setKeeperHash(wallet: string, authId: number, keeper: string): Buffer {
  return envelope(wallet, {
    topic: Cl.stringAscii("set-keeper"), "auth-id": Cl.uint(authId), keeper: Cl.principal(keeper),
  });
}
/** mm-safe-auth-helpers-v1.build-execute-now-hash */
function executeNowHash(wallet: string, authId: number, opId: number): Buffer {
  return envelope(wallet, {
    topic: Cl.stringAscii("execute-now"), "auth-id": Cl.uint(authId), "op-id": Cl.uint(opId),
  });
}
/** smart-wallet-standard-auth-helpers-v7.build-stx-transfer-hash */
function stxTransferHash(wallet: string, authId: number, amount: number, recipient: string): Buffer {
  return envelope(wallet, {
    topic: Cl.stringAscii("stx-transfer"), "auth-id": Cl.uint(authId), amount: Cl.uint(amount),
    recipient: Cl.principal(recipient), memo: Cl.none(),
  });
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

// --- setup ----------------------------------------------------------------------
function onboard(safe: string) {
  expect(simnet.callPublicFn(safe, "onboard",
    [pubkeyCV, Cl.principal(OWNER), Cl.principal(RECOVERY),
     Cl.uint(STX_THRESHOLD), Cl.uint(SBTC_THRESHOLD), Cl.uint(MIN_COOLDOWN)],
    FAKFUN_DEPLOYER).result).toBeOk(Cl.bool(true));
}
/** Both safes deployed, onboarded with the same passkey, funded. */
function twoSafes() {
  deployAll();
  // core verifies A's hash; B is byte-identical so B registers against A
  expect(simnet.callPublicFn(CORE, "set-verified-contract",
    [Cl.contractPrincipal(WD, NAME_A), Cl.none()], D).result).toBeOk(Cl.bool(true));
  onboard(SAFE_A);
  onboard(SAFE_B);
  simnet.transferSTX(FUND, SAFE_A, DEPLOYER);
  simnet.transferSTX(FUND, SAFE_B, DEPLOYER);
  // same passkey maps to the same owner on both
  for (const s of [SAFE_A, SAFE_B]) {
    expect(simnet.callReadOnlyFn(s, "is-admin-pubkey", [pubkeyCV], RANDOM).result).toBeOk(Cl.bool(true));
  }
}
function keeper(safe: string): string {
  return Cl.prettyPrint(simnet.callReadOnlyFn(safe, "get-keeper", [], RANDOM).result).replace(/^'/, "");
}
function stxOf(p: string): bigint {
  return simnet.getAssetsMap().get("STX")?.get(p) ?? 0n;
}
function setKeeper(safe: string, k: string, auth: any) {
  return simnet.callPublicFn(safe, "set-keeper", [Cl.principal(k), Cl.some(auth), Cl.none()], RELAYER);
}
/** The owner queues an over-threshold send (admin path) -> op-id u0. */
function queueOp(safe: string) {
  expect(simnet.callPublicFn(safe, "stx-transfer",
    [Cl.uint(SEND), Cl.principal(SINK), Cl.none(), Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
  expect(simnet.callReadOnlyFn(safe, "get-pending-operation", [Cl.uint(0)], RANDOM).result)
    .not.toBeNone();
}
function executeNow(safe: string, opId: number, auth: any) {
  return simnet.callPublicFn(safe, "execute-pending-stx-transfer-now",
    [Cl.uint(opId), Cl.none(), auth, Cl.none()], RELAYER);
}
function opExecuted(safe: string, opId: number): boolean {
  const s = Cl.prettyPrint(simnet.callReadOnlyFn(safe, "get-pending-operation", [Cl.uint(opId)], RANDOM).result);
  return s.includes("executed: true");
}

// ================================================================================
describe("cross-safe replay: one passkey on two safes", () => {
  it("set-keeper (autostake helpers-v1): A's signature is u4002 on B, before and after A uses it", () => {
    // arrange
    twoSafes();
    const authA = sigAuth(1, setKeeperHash(SAFE_A, 1, NEW_KEEPER));
    // act
    const onBFirst = setKeeper(SAFE_B, NEW_KEEPER, authA);
    const onA = setKeeper(SAFE_A, NEW_KEEPER, authA);
    const onBAfter = setKeeper(SAFE_B, NEW_KEEPER, authA);
    const onAAgain = setKeeper(SAFE_A, NEW_KEEPER, authA);
    // assert
    expect(onBFirst.result).toBeErr(Cl.uint(E_INVALID_SIG));
    expect(onA.result).toBeOk(Cl.bool(true));
    expect(onBAfter.result).toBeErr(Cl.uint(E_INVALID_SIG));
    expect(onAAgain.result).toBeErr(Cl.uint(E_REPLAY));
    expect(keeper(SAFE_A)).toBe(NEW_KEEPER);
    expect(keeper(SAFE_B)).toBe(D);
  });

  it("set-keeper control: the same op signed over B's domain passes on B", () => {
    // arrange
    twoSafes();
    const authB = sigAuth(1, setKeeperHash(SAFE_B, 1, NEW_KEEPER));
    // act
    const onA = setKeeper(SAFE_A, NEW_KEEPER, authB);
    const onB = setKeeper(SAFE_B, NEW_KEEPER, authB);
    // assert
    expect(onA.result).toBeErr(Cl.uint(E_INVALID_SIG));
    expect(onB.result).toBeOk(Cl.bool(true));
    expect(keeper(SAFE_B)).toBe(NEW_KEEPER);
  });

  it("execute-pending-stx-transfer-now (mm-safe helpers-v1): A's cooldown skip is u4002 on B", () => {
    // arrange: same op-id u0 queued on both safes, same auth-id
    twoSafes();
    queueOp(SAFE_A);
    queueOp(SAFE_B);
    const authA = sigAuth(1, executeNowHash(SAFE_A, 1, 0));
    const sinkBefore = stxOf(SINK);
    // act
    const onBFirst = executeNow(SAFE_B, 0, authA);
    const onA = executeNow(SAFE_A, 0, authA);
    const onBAfter = executeNow(SAFE_B, 0, authA);
    // assert
    expect(onBFirst.result).toBeErr(Cl.uint(E_INVALID_SIG));
    expect(onA.result).toBeOk(Cl.bool(true));
    expect(onBAfter.result).toBeErr(Cl.uint(E_INVALID_SIG));
    expect(opExecuted(SAFE_A, 0)).toBe(true);
    expect(opExecuted(SAFE_B, 0)).toBe(false);
    expect(stxOf(SINK) - sinkBefore).toBe(BigInt(SEND));
    expect(stxOf(SAFE_B)).toBe(BigInt(FUND));
  });

  it("execute-now control: signed over B's domain, B executes", () => {
    // arrange
    twoSafes();
    queueOp(SAFE_B);
    const authB = sigAuth(1, executeNowHash(SAFE_B, 1, 0));
    // act
    const r = executeNow(SAFE_B, 0, authB);
    // assert
    expect(r.result).toBeOk(Cl.bool(true));
    expect(opExecuted(SAFE_B, 0)).toBe(true);
  });

  it("stx-transfer (helpers-v7): A's passkey send is u4002 on B and moves nothing from B", () => {
    // arrange: under-threshold amount, so a valid sig would send at once
    twoSafes();
    const amt = 500_000;
    const authA = sigAuth(1, stxTransferHash(SAFE_A, 1, amt, SINK));
    const send = (safe: string) => simnet.callPublicFn(safe, "stx-transfer",
      [Cl.uint(amt), Cl.principal(SINK), Cl.none(), Cl.some(authA), Cl.none()], RELAYER);
    // act
    const onBFirst = send(SAFE_B);
    const onA = send(SAFE_A);
    const onBAfter = send(SAFE_B);
    // assert
    expect(onBFirst.result).toBeErr(Cl.uint(E_INVALID_SIG));
    expect(onA.result).toBeOk(Cl.bool(true));
    expect(onBAfter.result).toBeErr(Cl.uint(E_INVALID_SIG));
    expect(stxOf(SAFE_A)).toBe(BigInt(FUND - amt));
    expect(stxOf(SAFE_B)).toBe(BigInt(FUND));
  });
});

// Every helper the safe verifies against binds the domain to contract-caller.
// A direct read-only call has contract-caller = the sender, so two senders
// must get two different hashes, each equal to the envelope over its own domain.
describe("every helper's domain = contract-caller", () => {
  const H = (n: string) => `${D}.${n}`;
  const cases: { helper: string; fn: string; details: Record<string, any>; struct: Record<string, any> }[] = [
    { helper: H("smart-wallet-standard-auth-helpers-v7"), fn: "build-stx-transfer-hash",
      details: { "auth-id": Cl.uint(1), amount: Cl.uint(5), recipient: Cl.principal(SINK), memo: Cl.none() },
      struct: { topic: Cl.stringAscii("stx-transfer"), "auth-id": Cl.uint(1), amount: Cl.uint(5),
        recipient: Cl.principal(SINK), memo: Cl.none() } },
    { helper: H("smart-wallet-standard-auth-helpers-v8"), fn: "build-sbtc-withdrawal-hash",
      details: { "auth-id": Cl.uint(1), amount: Cl.uint(5),
        recipient: Cl.tuple({ version: Cl.bufferFromHex("00"), hashbytes: Cl.bufferFromHex("11".repeat(32)) }),
        "max-fee": Cl.uint(9) },
      struct: null as any },
    { helper: H("smart-wallet-standard-auth-helpers-v10"), fn: "build-confirm-max-gas-amount-hash",
      details: { "auth-id": Cl.uint(1), amount: Cl.uint(5) }, struct: null as any },
    { helper: H("mm-safe-auth-helpers-v1"), fn: "build-execute-now-hash",
      details: { "auth-id": Cl.uint(1), "op-id": Cl.uint(0) },
      struct: { topic: Cl.stringAscii("execute-now"), "auth-id": Cl.uint(1), "op-id": Cl.uint(0) } },
    { helper: H("juice-safe-auth-helpers-v1"), fn: "build-unstake-stx-juice-hash",
      details: { "auth-id": Cl.uint(1) },
      struct: { topic: Cl.stringAscii("unstake-stx-juice"), "auth-id": Cl.uint(1) } },
    { helper: H("juice-safe-auth-helpers-v2"), fn: "build-stake-stx-juice-pox5-hash",
      details: { "auth-id": Cl.uint(1), "amount-ustx": Cl.uint(5), "signer-calldata": Cl.some(Cl.bufferFromHex("aa")) },
      struct: { topic: Cl.stringAscii("stake-stx-juice-pox5"), "auth-id": Cl.uint(1), "amount-ustx": Cl.uint(5),
        "signer-calldata": Cl.some(Cl.bufferFromHex("aa")) } },
    { helper: H("juice-safe-auth-helpers-v2"), fn: "build-update-stake-stx-juice-hash",
      details: { "auth-id": Cl.uint(1), "amount-increase": Cl.uint(5), "cycles-to-extend": Cl.uint(2),
        "signer-calldata": Cl.none() },
      struct: { topic: Cl.stringAscii("update-stake-stx-juice"), "auth-id": Cl.uint(1), "amount-increase": Cl.uint(5),
        "cycles-to-extend": Cl.uint(2), "signer-calldata": Cl.none() } },
    { helper: `${WD}.${HELPER_NAME}`, fn: "build-set-keeper-hash",
      details: { "auth-id": Cl.uint(1), keeper: Cl.principal(NEW_KEEPER) },
      struct: { topic: Cl.stringAscii("set-keeper"), "auth-id": Cl.uint(1), keeper: Cl.principal(NEW_KEEPER) } },
  ];
  for (const c of cases) {
    it(`${c.helper.split(".")[1]}.${c.fn} changes with contract-caller`, () => {
      // arrange
      if (!COV) deployAll();
      // act
      const a = simnet.callReadOnlyFn(c.helper, c.fn, [Cl.tuple(c.details)], RANDOM).result;
      const b = simnet.callReadOnlyFn(c.helper, c.fn, [Cl.tuple(c.details)], RELAYER).result;
      // assert
      expect(Cl.prettyPrint(a)).not.toBe(Cl.prettyPrint(b));
      if (c.struct) {
        expect(a).toBeBuff(envelope(RANDOM, c.struct));
        expect(b).toBeBuff(envelope(RELAYER, c.struct));
      }
    });
  }
});
