// juice-autostake-safe-keeper.test.ts -- the keeper features added in 2d136c1:
// get-keeper, set-keeper (admin and passkey paths) and restake.
//
// Run:
//   npx vitest run tests/juice-autostake-safe-keeper.test.ts -- --manifest tests/cl-v7/Clarinet.toml
// Coverage:
//   npx vitest run tests/juice-autostake-safe-keeper.test.ts -- --manifest tests/cl-v7/Clarinet.toml --coverage
//
// Deploy layout. The safe calls two contracts by literal SPV9K21T... address:
// juice-autostake-safe-auth-helpers-v1 (static contract-call) and
// juice-pool-sbtc-signer (JUICE-SIGNER, passed to pox-5 as a trait). A manifest
// cannot put a project contract at a non-account address, so each test deploys
// the three at SPV9K21T... with simnet.deployContract:
//   - juice-pool-sbtc-signer: the launch pool is not on mainnet, so its stand-in
//     is the LIVE juice-pool-stx-signer source (same signer-manager trait, same
//     validate-stake! surface), as simul-juice-autostake-safe.js does on stxer.
//   - the helper and the safe: this repo's contracts/ sources, unchanged.
// The safe then sits at its real address, so onboard's register-wallet canonical
// literal matches and nothing in the contract is edited.
//
// pox-5 is the real simnet boot contract, not a mock. The pool registers through
// pox-5's real grant path (secp256k1 signature over the SIP-018 grant hash), as
// in juice-safe-v7-staking.test.ts.
//
// SIMNET LIMIT (same as juice-safe-v7-staking.test.ts): clarinet does not run the
// node's PoX lock handler, so stx-account never reports locked STX. Two effects:
//   1. after a stake the staked STX still reads as unlocked, so `restake` adds the
//      whole balance again (pox-5's own unlocked check also sees the full balance);
//   2. the (with-staking (+ (locked-ustx) amount)) allowance is not genuinely
//      exercised -- locked-ustx is always u0 here.
// The allowance = locked + amount, real STX locks and the exact unlocked delta are
// covered on a mainnet fork by stxer: simul-juice-autostake-safe.js (82/82) and
// juicestx simulations/pool-autostake-e2e-stxer.mjs (62/62).
import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";
import crypto from "node:crypto";
import fs from "node:fs";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { generateP256Keypair, signChallengeWithRpId } from "../lib-webauthn-test-signer.mjs";

const D = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
// AUTOSTAKE_DEPLOYER points the suite at tests/cl-autostake-cov, where the plan
// deploys the three contracts locally so --coverage can instrument them. Unset --
// the normal case -- they are deployed at SPV9K21T... by deployAll().
const WD = process.env.AUTOSTAKE_DEPLOYER ?? D;
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const WALLET_NAME = "juice-autostake-safe";
// the coverage harness names its stand-in pool juice-autostake-pool (plan order)
const POOL_NAME = WD === D ? "juice-pool-sbtc-signer" : "juice-autostake-pool";
const HELPER_NAME = "juice-autostake-safe-auth-helpers-v1";
const WALLET = `${WD}.${WALLET_NAME}`;
const POOL = `${WD}.${POOL_NAME}`;
const HELPER = `${WD}.${HELPER_NAME}`;
const CORE = `${D}.fakfun-wallet-core-v2`;
const POX5 = "SP000000000000000000002Q6VF78.pox-5";
const SBTC_DEPOSIT = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-deposit";
const SBTC_DEPLOYER = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4";
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

// a high STX threshold so the owner can drain the safe without a pending op
const STX_THRESHOLD = 10_000_000_000_000;
const SBTC_THRESHOLD = 100_000;
const MIN_COOLDOWN = 144;
const STAKE = 1_000_000_000;
const FUND = 3_000_000_000;
const NUM_CYCLES = 96;
// simnet pox-5 (non-mainnet): 1050-block cycles, 50-block prepare phase, first
// burn height 0
const CYCLE_LEN = 1050;
const PREPARE_LEN = 50;

const E_UNAUTH = 4001, E_INVALID_SIG = 4002, E_REPLAY = 4006, E_TOKEN_LOCKED = 4023, E_ZERO = 4026,
  E_NOT_STAKING = 4040;
const POX_INVALID_NUM_CYCLES = 20, POX_STAKE_IN_PREPARE = 47;

// --- deploy -------------------------------------------------------------------
const POOL_SRC = fs.readFileSync(
  ".cache/requirements/SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-pool-stx-signer.clar", "utf8");
const HELPER_SRC = fs.readFileSync("contracts/juice-autostake-safe-auth-helpers-v1.clar", "utf8");
const WALLET_SRC = fs.readFileSync("contracts/juice-autostake-safe.clar", "utf8");

function deployAll() {
  if (WD !== D) return; // coverage harness: already in the simnet plan
  expect(simnet.deployContract(POOL_NAME, POOL_SRC, { clarityVersion: 5 }, D).result).toBeBool(true);
  expect(simnet.deployContract(HELPER_NAME, HELPER_SRC, { clarityVersion: 4 }, D).result).toBeBool(true);
  expect(simnet.deployContract(WALLET_NAME, WALLET_SRC, { clarityVersion: 6 }, D).result).toBeBool(true);
}

// --- SIP-018 helpers ----------------------------------------------------------
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

// wallet passkey (P-256)
const pk = generateP256Keypair();
const pubkeyCV = Cl.bufferFromHex(strip(pk.pubKeyHex));

function walletDomain(): Buffer {
  return cvHash(Cl.tuple({
    name: Cl.stringAscii("smart-wallet-standard"), version: Cl.stringAscii("1.0.0"),
    "chain-id": Cl.uint(CHAIN_ID), wallet: Cl.contractPrincipal(WD, WALLET_NAME),
  }));
}
/** Mirrors juice-autostake-safe-auth-helpers-v1.build-set-keeper-hash. */
function setKeeperHash(authId: number, keeper: string): Buffer {
  const struct = cvHash(Cl.tuple({
    topic: Cl.stringAscii("set-keeper"), "auth-id": Cl.uint(authId), keeper: Cl.principal(keeper),
  }));
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

// pox-5 signer key (secp256k1) for the pool's grant
const signerPriv = secp256k1.utils.randomSecretKey();
const signerPub = secp256k1.getPublicKey(signerPriv, true);

/** Mirrors pox-5 get-signer-grant-message-hash. */
function grantMessageHash(authId: number): Buffer {
  const domain = cvHash(Cl.tuple({
    name: Cl.stringAscii("pox-5-signer"), version: Cl.stringAscii("1.0.0"), "chain-id": Cl.uint(CHAIN_ID),
  }));
  const struct = cvHash(Cl.tuple({
    topic: Cl.stringAscii("grant-authorization"),
    "signer-manager": Cl.contractPrincipal(WD, POOL_NAME), "auth-id": Cl.uint(authId),
  }));
  return sha256(Buffer.concat([SIP018, domain, struct]));
}

/** Registers the pool in pox-5 through the real grant path. The compact sig has
 *  no recovery bit, so try both ids; a miss (u14) rolls back. */
function registerPool() {
  const compact = Buffer.from(secp256k1.sign(grantMessageHash(1), signerPriv, { prehash: false }) as any);
  for (const rec of [0, 1]) {
    const r = simnet.callPublicFn(POOL, "register-self",
      [Cl.contractPrincipal(WD, POOL_NAME), Cl.bufferFromHex(Buffer.from(signerPub).toString("hex")),
       Cl.uint(1), Cl.bufferFromHex(Buffer.concat([compact, Buffer.from([rec])]).toString("hex"))], WD);
    if (Cl.prettyPrint(r.result).startsWith("(ok")) return;
  }
  throw new Error("pool registration failed");
}

function onboard() {
  expect(simnet.callPublicFn(CORE, "set-verified-contract",
    [Cl.contractPrincipal(WD, WALLET_NAME), Cl.none()], D).result).toBeOk(Cl.bool(true));
  expect(simnet.callPublicFn(WALLET, "onboard",
    [pubkeyCV, Cl.principal(OWNER), Cl.principal(RECOVERY),
     Cl.uint(STX_THRESHOLD), Cl.uint(SBTC_THRESHOLD), Cl.uint(MIN_COOLDOWN)],
    FAKFUN_DEPLOYER).result).toBeOk(Cl.bool(true));
}

/** Deployed, pool registered, safe onboarded and funded. */
function readySafe(fund = FUND) {
  deployAll(); registerPool(); onboard();
  if (fund > 0) simnet.transferSTX(fund, WALLET, DEPLOYER);
}

/** readySafe + the owner stakes STAKE through the safe. */
function stakedSafe(fund = FUND) {
  readySafe(fund);
  expect(simnet.callPublicFn(WALLET, "stake-stx-juice",
    [Cl.uint(STAKE), Cl.none(), Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
}

// --- reads ----------------------------------------------------------------------
function keeper(): string {
  return Cl.prettyPrint(simnet.callReadOnlyFn(WALLET, "get-keeper", [], RANDOM).result).replace(/^'/, "");
}
function stakerInfo(): string {
  return Cl.prettyPrint(simnet.callReadOnlyFn(POX5, "get-staker-info", [Cl.principal(WALLET)], RANDOM).result);
}
function infoField(name: string): bigint {
  const m = stakerInfo().match(new RegExp(`${name}: u(\\d+)`));
  if (!m) throw new Error(`no ${name} in ${stakerInfo()}`);
  return BigInt(m[1]);
}
function unlockCycle(): bigint {
  return infoField("first-reward-cycle") + infoField("num-cycles");
}
function currentCycle(): bigint {
  return BigInt(Cl.prettyPrint(simnet.callReadOnlyFn(POX5, "current-pox-reward-cycle", [], RANDOM).result).slice(1));
}
function stxBalance(): bigint {
  return simnet.getAssetsMap().get("STX")?.get(WALLET) ?? 0n;
}
function lastActivity(): bigint {
  return BigInt(Cl.prettyPrint(simnet.getDataVar(WALLET, "last-activity-block")).slice(1));
}
function printed(events: any[], needle: string): string[] {
  return events.filter((e) => e.event === "print_event")
    .map((e) => Cl.prettyPrint(e.data.value)).filter((s) => s.includes(needle));
}
/** Mines to `offset` blocks into reward cycle `cycle`. */
function mineTo(cycle: number, offset = 20) {
  const target = cycle * CYCLE_LEN + offset;
  const n = target - simnet.burnBlockHeight;
  if (n > 0) simnet.mineEmptyBurnBlocks(n);
}
/** The owner sends every uSTX out of the safe (no pending op: threshold is high). */
function drainSafe() {
  expect(simnet.callPublicFn(WALLET, "stx-transfer",
    [Cl.uint(stxBalance()), Cl.principal(SINK), Cl.none(), Cl.none(), Cl.none()], OWNER).result)
    .toBeOk(Cl.bool(true));
  expect(stxBalance()).toBe(0n);
}
function restake(sender = D) {
  return simnet.callPublicFn(WALLET, "restake", [], sender);
}
function setKeeperAdmin(k: string, sender = OWNER) {
  return simnet.callPublicFn(WALLET, "set-keeper", [Cl.principal(k), Cl.none(), Cl.none()], sender);
}
/** The owner turns the token lock on or off (admin path, no passkey). */
function setTokenLock(enabled: boolean) {
  expect(simnet.callPublicFn(WALLET, "toggle-token-lock",
    [Cl.bool(enabled), Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
  expect(simnet.callReadOnlyFn(WALLET, "get-token-lock-enabled", [], RANDOM).result).toBeBool(enabled);
}
function fundSbtc(to: string, amount: number) {
  const h = simnet.burnBlockHeight - 1;
  const hash = Cl.prettyPrint(simnet.callReadOnlyFn(`${DEPLOYER}.zz-nft`, "burn-hash",
    [Cl.uint(h)], DEPLOYER).result).replace(/^0x/, "");
  expect(simnet.callPublicFn(SBTC_DEPOSIT, "complete-deposit-wrapper",
    [Cl.bufferFromHex("33".repeat(32)), Cl.uint(0), Cl.uint(amount), Cl.principal(to),
     Cl.bufferFromHex(hash), Cl.uint(h), Cl.bufferFromHex("44".repeat(32))],
    SBTC_DEPLOYER).result).toBeOk(Cl.bool(true));
}
function sbtcOf(p: string): bigint {
  return simnet.getAssetsMap().get(".sbtc-token.sbtc-token")?.get(p) ?? 0n;
}

// ================================================================================
describe("get-keeper", () => {
  it("defaults to chavita.btc (SPV9K21T...)", () => {
    // arrange
    deployAll();
    // act
    const k = keeper();
    // assert
    expect(k).toBe(D);
  });
});

describe("set-keeper: admin path (sig-auth none)", () => {
  it("the owner sets a new keeper and the event logs old and new", () => {
    // arrange
    readySafe();
    // act
    const r = setKeeperAdmin(NEW_KEEPER);
    // assert
    expect(r.result).toBeOk(Cl.bool(true));
    expect(keeper()).toBe(NEW_KEEPER);
    const ev = printed(r.events, `event: "set-keeper"`);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toContain(`old: '${D}`);
    expect(ev[0]).toContain(`new: '${NEW_KEEPER}`);
  });

  it("refuses a non-admin with u4001 and leaves the keeper unchanged", () => {
    // arrange
    readySafe();
    // act
    const byRandom = setKeeperAdmin(RANDOM, RANDOM);
    const byRelayer = setKeeperAdmin(RELAYER, RELAYER);
    const byOldKeeper = setKeeperAdmin(D, D);
    // assert
    expect(byRandom.result).toBeErr(Cl.uint(E_UNAUTH));
    expect(byRelayer.result).toBeErr(Cl.uint(E_UNAUTH));
    expect(byOldKeeper.result).toBeErr(Cl.uint(E_UNAUTH));
    expect(keeper()).toBe(D);
  });

  it("updates last-activity-block (owner action)", () => {
    // arrange
    readySafe();
    simnet.mineEmptyBurnBlocks(100);
    const before = lastActivity();
    // act
    expect(setKeeperAdmin(NEW_KEEPER).result).toBeOk(Cl.bool(true));
    // assert
    expect(lastActivity()).toBeGreaterThan(before);
    expect(lastActivity()).toBe(BigInt(simnet.burnBlockHeight));
  });

  it("setting the owner as keeper turns auto-restake off for the old keeper", () => {
    // arrange
    stakedSafe();
    // act
    expect(setKeeperAdmin(OWNER).result).toBeOk(Cl.bool(true));
    const byOld = restake(D);
    const byOwner = restake(OWNER);
    // assert
    expect(byOld.result).toBeErr(Cl.uint(E_UNAUTH));
    expect(byOwner.result).toBeOk(Cl.tuple({ amount: Cl.uint(FUND), "cycles-to-extend": Cl.uint(0) }));
  });
});

describe("set-keeper: passkey path (build-set-keeper-hash)", () => {
  it("the helper's hash matches the SIP-018 struct the test signs", () => {
    // arrange
    deployAll();
    // act
    const onChain = simnet.callReadOnlyFn(HELPER, "build-set-keeper-hash",
      [Cl.tuple({ "auth-id": Cl.uint(7), keeper: Cl.principal(NEW_KEEPER) })], RANDOM).result;
    // assert: a direct read has contract-caller = RANDOM, so the domain differs
    // from the wallet's -- the signed path below is the real binding check.
    const randomDomain = cvHash(Cl.tuple({
      name: Cl.stringAscii("smart-wallet-standard"), version: Cl.stringAscii("1.0.0"),
      "chain-id": Cl.uint(CHAIN_ID), wallet: Cl.principal(RANDOM),
    }));
    const struct = cvHash(Cl.tuple({
      topic: Cl.stringAscii("set-keeper"), "auth-id": Cl.uint(7), keeper: Cl.principal(NEW_KEEPER),
    }));
    const expected = sha256(Buffer.concat([SIP018, randomDomain, struct]));
    expect(onChain).toBeBuff(expected);
  });

  it("a relayer submits a passkey-signed set-keeper", () => {
    // arrange
    readySafe();
    const auth = sigAuth(1, setKeeperHash(1, NEW_KEEPER));
    // act
    const r = simnet.callPublicFn(WALLET, "set-keeper",
      [Cl.principal(NEW_KEEPER), Cl.some(auth), Cl.none()], RELAYER);
    // assert
    expect(r.result).toBeOk(Cl.bool(true));
    expect(keeper()).toBe(NEW_KEEPER);
  });

  it("the signature binds the keeper: a different keeper is u4002", () => {
    // arrange
    readySafe();
    const auth = sigAuth(1, setKeeperHash(1, NEW_KEEPER));
    // act
    const r = simnet.callPublicFn(WALLET, "set-keeper",
      [Cl.principal(RANDOM), Cl.some(auth), Cl.none()], RELAYER);
    // assert
    expect(r.result).toBeErr(Cl.uint(E_INVALID_SIG));
    expect(keeper()).toBe(D);
  });

  it("the signature binds the auth-id: a different auth-id is u4002", () => {
    // arrange
    readySafe();
    const s = sigAuth(1, setKeeperHash(1, NEW_KEEPER));
    const tampered = Cl.tuple({ ...(s as any).value, "auth-id": Cl.uint(2) });
    // act
    const r = simnet.callPublicFn(WALLET, "set-keeper",
      [Cl.principal(NEW_KEEPER), Cl.some(tampered), Cl.none()], RELAYER);
    // assert
    expect(r.result).toBeErr(Cl.uint(E_INVALID_SIG));
  });

  it("a replayed set-keeper signature is u4006", () => {
    // arrange
    readySafe();
    const auth = sigAuth(1, setKeeperHash(1, NEW_KEEPER));
    expect(simnet.callPublicFn(WALLET, "set-keeper",
      [Cl.principal(NEW_KEEPER), Cl.some(auth), Cl.none()], RELAYER).result).toBeOk(Cl.bool(true));
    expect(setKeeperAdmin(D).result).toBeOk(Cl.bool(true));
    // act
    const r = simnet.callPublicFn(WALLET, "set-keeper",
      [Cl.principal(NEW_KEEPER), Cl.some(auth), Cl.none()], RELAYER);
    // assert
    expect(r.result).toBeErr(Cl.uint(E_REPLAY));
    expect(keeper()).toBe(D);
  });

  it("pays gas through the station on the passkey path", () => {
    // arrange
    readySafe();
    fundSbtc(WALLET, 1_000_000);
    const station = `${DEPLOYER}.zz-gas-station`;
    const before = sbtcOf(WALLET);
    const auth = sigAuth(1, setKeeperHash(1, NEW_KEEPER));
    // act
    const r = simnet.callPublicFn(WALLET, "set-keeper",
      [Cl.principal(NEW_KEEPER), Cl.some(auth), Cl.some(Cl.contractPrincipal(DEPLOYER, "zz-gas-station"))],
      RELAYER);
    // assert
    expect(r.result).toBeOk(Cl.bool(true));
    expect(keeper()).toBe(NEW_KEEPER);
    expect(before - sbtcOf(WALLET)).toBe(20n);
    expect(sbtcOf(station)).toBe(20n);
  });

  it("the new keeper can restake and the old keeper cannot", () => {
    // arrange
    stakedSafe();
    expect(simnet.callPublicFn(WALLET, "set-keeper",
      [Cl.principal(NEW_KEEPER), Cl.some(sigAuth(1, setKeeperHash(1, NEW_KEEPER))), Cl.none()],
      RELAYER).result).toBeOk(Cl.bool(true));
    // act
    const byOld = restake(D);
    const byNew = restake(NEW_KEEPER);
    // assert
    expect(byOld.result).toBeErr(Cl.uint(E_UNAUTH));
    expect(byNew.result).toBeOk(Cl.tuple({ amount: Cl.uint(FUND), "cycles-to-extend": Cl.uint(0) }));
  });
});

describe("set-keeper: token lock (bounty mv7dfb, Giant Moth)", () => {
  it("token lock on: a passkey set-keeper is u4023 and the keeper is unchanged", () => {
    // arrange
    readySafe();
    setTokenLock(true);
    const auth = sigAuth(1, setKeeperHash(1, NEW_KEEPER));
    // act
    const r = simnet.callPublicFn(WALLET, "set-keeper",
      [Cl.principal(NEW_KEEPER), Cl.some(auth), Cl.none()], RELAYER);
    // assert
    expect(r.result).toBeErr(Cl.uint(E_TOKEN_LOCKED));
    expect(keeper()).toBe(D);
    expect(printed(r.events, `event: "set-keeper"`)).toHaveLength(0);
  });

  it("token lock on: the locked-out passkey cannot hand restake to a new keeper", () => {
    // arrange
    stakedSafe();
    setTokenLock(true);
    const auth = sigAuth(1, setKeeperHash(1, NEW_KEEPER));
    // act
    const r = simnet.callPublicFn(WALLET, "set-keeper",
      [Cl.principal(NEW_KEEPER), Cl.some(auth), Cl.none()], RELAYER);
    const byNew = restake(NEW_KEEPER);
    // assert
    expect(r.result).toBeErr(Cl.uint(E_TOKEN_LOCKED));
    expect(byNew.result).toBeErr(Cl.uint(E_UNAUTH));
    expect(infoField("amount-ustx")).toBe(BigInt(STAKE));
  });

  it("token lock on: the admin path still sets the keeper", () => {
    // arrange
    readySafe();
    setTokenLock(true);
    // act
    const r = setKeeperAdmin(NEW_KEEPER);
    // assert
    expect(r.result).toBeOk(Cl.bool(true));
    expect(keeper()).toBe(NEW_KEEPER);
  });

  it("token lock off again: the same passkey signature now works", () => {
    // arrange
    readySafe();
    setTokenLock(true);
    const auth = sigAuth(1, setKeeperHash(1, NEW_KEEPER));
    expect(simnet.callPublicFn(WALLET, "set-keeper",
      [Cl.principal(NEW_KEEPER), Cl.some(auth), Cl.none()], RELAYER).result)
      .toBeErr(Cl.uint(E_TOKEN_LOCKED));
    setTokenLock(false);
    // act: the refused call rolled back, so auth-id 1 is not spent
    const r = simnet.callPublicFn(WALLET, "set-keeper",
      [Cl.principal(NEW_KEEPER), Cl.some(auth), Cl.none()], RELAYER);
    // assert
    expect(r.result).toBeOk(Cl.bool(true));
    expect(keeper()).toBe(NEW_KEEPER);
  });
});

// ================================================================================
describe("restake: guards", () => {
  it("no position: err-not-staking u4040 (even before the keeper check)", () => {
    // arrange
    readySafe();
    // act
    const byKeeper = restake(D);
    const byRandom = restake(RANDOM);
    // assert: the position unwrap sits in the let, so it fires first
    expect(byKeeper.result).toBeErr(Cl.uint(E_NOT_STAKING));
    expect(byRandom.result).toBeErr(Cl.uint(E_NOT_STAKING));
  });

  it("keeper only: owner, recovery, relayer and random get u4001", () => {
    // arrange
    stakedSafe();
    // act + assert
    for (const who of [OWNER, RECOVERY, RELAYER, RANDOM]) {
      expect(restake(who).result).toBeErr(Cl.uint(E_UNAUTH));
    }
    expect(infoField("amount-ustx")).toBe(BigInt(STAKE));
  });

  it("unstaking safe: u4040 in the unstake cycle and the next one", () => {
    // arrange
    stakedSafe();
    expect(simnet.callPublicFn(WALLET, "unstake", [Cl.none(), Cl.none()], OWNER).result)
      .toBeOk(Cl.bool(true));
    // pox-5 leaves the lock ending next cycle: unlock = current + 1
    expect(unlockCycle()).toBe(currentCycle() + 1n);
    // act
    const sameCycle = restake(D);
    mineTo(Number(currentCycle()) + 1);
    const nextCycle = restake(D);
    // assert
    expect(sameCycle.result).toBeErr(Cl.uint(E_NOT_STAKING));
    expect(nextCycle.result).toBeErr(Cl.uint(E_NOT_STAKING));
  });

  it("after the unstaked lock ends, pox-5 has no position: u4040", () => {
    // arrange
    stakedSafe();
    expect(simnet.callPublicFn(WALLET, "unstake", [Cl.none(), Cl.none()], OWNER).result)
      .toBeOk(Cl.bool(true));
    mineTo(Number(currentCycle()) + 2);
    expect(stakerInfo()).toBe("none");
    // act
    const r = restake(D);
    // assert
    expect(r.result).toBeErr(Cl.uint(E_NOT_STAKING));
  });

  it("nothing to add and the lock at the max: u4026", () => {
    // arrange
    stakedSafe();
    drainSafe();
    expect(unlockCycle()).toBe(currentCycle() + 1n + BigInt(NUM_CYCLES));
    // act
    const r = restake(D);
    // assert
    expect(r.result).toBeErr(Cl.uint(E_ZERO));
  });

  it("inside the prepare phase pox-5 refuses (u47); after the boundary it works", () => {
    // arrange
    stakedSafe();
    mineTo(0, CYCLE_LEN - PREPARE_LEN + 5);
    // act
    const inPrepare = restake(D);
    mineTo(1);
    const after = restake(D);
    // assert
    expect(inPrepare.result).toBeErr(Cl.uint(POX_STAKE_IN_PREPARE));
    expect(after.result).toBeOk(Cl.tuple({ amount: Cl.uint(FUND), "cycles-to-extend": Cl.uint(1) }));
  });
});

describe("restake: what it stakes", () => {
  it("stakes ALL unlocked STX and logs it through core and the pool", () => {
    // arrange
    stakedSafe();
    const unlocked = stxBalance(); // simnet: no lock, so the whole balance
    // act
    const r = restake(D);
    // assert
    expect(r.result).toBeOk(Cl.tuple({ amount: Cl.uint(unlocked), "cycles-to-extend": Cl.uint(0) }));
    expect(infoField("amount-ustx")).toBe(BigInt(STAKE) + unlocked);
    expect(printed(r.events, `event: "stake-stx"`)[0]).toContain(`stx-amount: u${unlocked}`);
    // pox-5 hands the pool the NEW TOTAL, so the launch pool's seat grows with it
    expect(printed(r.events, `topic: "validate-stake"`)[0])
      .toContain(`amount-ustx: u${BigInt(STAKE) + unlocked}`);
    const ev = printed(r.events, `event: "restake"`);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toContain(`keeper: '${D}`);
    expect(ev[0]).toContain(`amount: u${unlocked}`);
    expect(ev[0]).toContain("cycles-to-extend: u0");
  });

  it("a fresh payout is restaked: amount = exactly the new unlocked STX", () => {
    // arrange
    stakedSafe();
    drainSafe();
    simnet.transferSTX(100_000_000, WALLET, DEPLOYER); // a 100 STX payout lands
    // act
    const r = restake(D);
    // assert
    expect(r.result).toBeOk(Cl.tuple({ amount: Cl.uint(100_000_000), "cycles-to-extend": Cl.uint(0) }));
    expect(infoField("amount-ustx")).toBe(BigInt(STAKE + 100_000_000));
  });

  it("the restake goes to the Juice pool, never to another signer", () => {
    // arrange
    stakedSafe();
    // act
    expect(restake(D).result).toBeOk(Cl.tuple({ amount: Cl.uint(FUND), "cycles-to-extend": Cl.uint(0) }));
    // assert
    expect(stakerInfo()).toContain(`signer: '${POOL}`);
  });
});

describe("restake: the lock roll", () => {
  it("one cycle later it adds the STX and rolls the lock to current + 1 + 96", () => {
    // arrange
    stakedSafe();
    const firstUnlock = unlockCycle();
    mineTo(1);
    // act
    const r = restake(D);
    // assert
    expect(r.result).toBeOk(Cl.tuple({ amount: Cl.uint(FUND), "cycles-to-extend": Cl.uint(1) }));
    expect(unlockCycle()).toBe(firstUnlock + 1n);
    expect(unlockCycle()).toBe(currentCycle() + 1n + BigInt(NUM_CYCLES));
  });

  it("roll-only: amount 0 still extends, and the staked amount is unchanged", () => {
    // arrange
    stakedSafe();
    drainSafe();
    mineTo(3); // the keeper missed cycles 1 and 2
    const amountBefore = infoField("amount-ustx");
    // act
    const r = restake(D);
    // assert
    expect(r.result).toBeOk(Cl.tuple({ amount: Cl.uint(0), "cycles-to-extend": Cl.uint(3) }));
    expect(infoField("amount-ustx")).toBe(amountBefore);
    expect(unlockCycle()).toBe(currentCycle() + 1n + BigInt(NUM_CYCLES));
    expect(printed(r.events, `event: "stake-stx"`)[0]).toContain("stx-amount: u0");
  });

  it("the roll target is pox-5's ceiling: an owner +1 after it is u20", () => {
    // arrange
    stakedSafe();
    drainSafe();
    mineTo(2);
    expect(restake(D).result).toBeOk(Cl.tuple({ amount: Cl.uint(0), "cycles-to-extend": Cl.uint(2) }));
    // act
    const r = simnet.callPublicFn(WALLET, "update-stake-stx-juice",
      [Cl.uint(0), Cl.uint(1), Cl.none(), Cl.none(), Cl.none()], OWNER);
    // assert
    expect(r.result).toBeErr(Cl.uint(POX_INVALID_NUM_CYCLES));
  });

  it("a second restake in the same cycle with nothing new is u4026", () => {
    // arrange
    stakedSafe();
    drainSafe();
    mineTo(1);
    expect(restake(D).result).toBeOk(Cl.tuple({ amount: Cl.uint(0), "cycles-to-extend": Cl.uint(1) }));
    // act
    const r = restake(D);
    // assert
    expect(r.result).toBeErr(Cl.uint(E_ZERO));
  });
});

describe("restake: allowance and activity", () => {
  it("does not update last-activity-block (keeper calls never hold off recovery)", () => {
    // arrange
    stakedSafe();
    const before = lastActivity();
    mineTo(1);
    // act
    expect(restake(D).result).toBeOk(Cl.tuple({ amount: Cl.uint(FUND), "cycles-to-extend": Cl.uint(1) }));
    // assert
    expect(lastActivity()).toBe(before);
    expect(BigInt(simnet.burnBlockHeight)).toBeGreaterThan(before);
  });

  it("with-staking (+ locked amount): simnet reports locked u0, so it reduces to amount", () => {
    // arrange
    stakedSafe();
    // act
    const locked = simnet.callReadOnlyFn(WALLET, "locked-ustx", [], RANDOM).result;
    const r = restake(D);
    // assert: the allowance accepted the stake-update. The locked + amount half is
    // only proven on stxer (real locks): simul-juice-autostake-safe.js and
    // juicestx pool-autostake-e2e-stxer.mjs.
    expect(locked).toBeUint(0);
    expect(r.result).toBeOk(Cl.tuple({ amount: Cl.uint(FUND), "cycles-to-extend": Cl.uint(0) }));
  });
});

describe("stake-stx-juice: signer-calldata", () => {
  it("forwards signer-calldata to pox-5 and prints it on the stake event", () => {
    // arrange
    readySafe();
    const calldata = Cl.some(Cl.bufferFromAscii("telegram"));
    // act
    const r = simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(STAKE), Cl.none(), Cl.none(), calldata], OWNER);
    // assert
    expect(r.result).toBeOk(Cl.bool(true));
    const ev = r.events.find((e: any) => e.event === "print_event"
      && Cl.prettyPrint(e.data.value).includes('event: "stake-stx-juice"'));
    expect(ev).toBeDefined();
    expect((ev!.data.value as any).value["signer-calldata"]).toStrictEqual(calldata);
  });

  // juice-safe-auth-helpers-v2 binds signer-calldata into the passkey challenge,
  // so a relayer can neither swap nor strip what the owner signed.
  const X = Cl.some(Cl.bufferFromAscii("telegram:@owner"));
  const Y = Cl.some(Cl.bufferFromAscii("telegram:@relayer"));
  /** Mirrors juice-safe-auth-helpers-v2.build-stake-stx-juice-pox5-hash. */
  function stakeHash(authId: number, amount: number, calldata: any): Buffer {
    const struct = cvHash(Cl.tuple({
      topic: Cl.stringAscii("stake-stx-juice-pox5"), "auth-id": Cl.uint(authId),
      "amount-ustx": Cl.uint(amount), "signer-calldata": calldata,
    }));
    return sha256(Buffer.concat([SIP018, walletDomain(), struct]));
  }
  /** Mirrors juice-safe-auth-helpers-v2.build-update-stake-stx-juice-hash. */
  function updateHash(authId: number, inc: number, cycles: number, calldata: any): Buffer {
    const struct = cvHash(Cl.tuple({
      topic: Cl.stringAscii("update-stake-stx-juice"), "auth-id": Cl.uint(authId),
      "amount-increase": Cl.uint(inc), "cycles-to-extend": Cl.uint(cycles), "signer-calldata": calldata,
    }));
    return sha256(Buffer.concat([SIP018, walletDomain(), struct]));
  }

  it("passkey stake signed over calldata X: Y and none are u4002, X goes through", () => {
    // arrange
    readySafe();
    const auth = sigAuth(1, stakeHash(1, STAKE, X));
    const stake = (calldata: any) => simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(STAKE), Cl.some(auth), Cl.none(), calldata], RELAYER);
    // act
    const withY = stake(Y);
    const withNone = stake(Cl.none());
    const withX = stake(X);
    // assert
    expect(withY.result).toBeErr(Cl.uint(E_INVALID_SIG));
    expect(withNone.result).toBeErr(Cl.uint(E_INVALID_SIG));
    expect(withX.result).toBeOk(Cl.bool(true));
    const ev = withX.events.find((e: any) => e.event === "print_event"
      && Cl.prettyPrint(e.data.value).includes('event: "stake-stx-juice"'));
    expect((ev!.data.value as any).value["signer-calldata"]).toStrictEqual(X);
    expect(infoField("amount-ustx")).toBe(BigInt(STAKE));
  });

  it("passkey top-up signed over calldata X: Y and none are u4002, X goes through", () => {
    // arrange
    stakedSafe();
    const INC = 100_000_000;
    const auth = sigAuth(1, updateHash(1, INC, 0, X));
    const update = (calldata: any) => simnet.callPublicFn(WALLET, "update-stake-stx-juice",
      [Cl.uint(INC), Cl.uint(0), Cl.some(auth), Cl.none(), calldata], RELAYER);
    // act
    const withY = update(Y);
    const withNone = update(Cl.none());
    const withX = update(X);
    // assert
    expect(withY.result).toBeErr(Cl.uint(E_INVALID_SIG));
    expect(withNone.result).toBeErr(Cl.uint(E_INVALID_SIG));
    expect(withX.result).toBeOk(Cl.bool(true));
    expect(infoField("amount-ustx")).toBe(BigInt(STAKE + INC));
  });
});

// --- owner change resets the keeper (bounty mv7dfb, Giant Moth F2, 611873c) ------
const NEW_OWNER = accounts.get("wallet_7")!;
const INACTIVITY_PERIOD = 52560;
const E_INACTIVE_REQUIRED = Number(
  (fs.readFileSync("contracts/juice-autostake-safe.clar", "utf8")
    .match(/\(define-constant err-inactive-required \(err u(\d+)\)\)/) ?? [])[1]);

/** Mirrors smart-wallet-standard-auth-helpers-v7.build-confirm-transfer-hash. */
function confirmTransferHash(authId: number, newAdmin: string): Buffer {
  const struct = cvHash(Cl.tuple({
    topic: Cl.stringAscii("confirm-transfer"), "auth-id": Cl.uint(authId), "new-admin": Cl.principal(newAdmin),
  }));
  return sha256(Buffer.concat([SIP018, walletDomain(), struct]));
}
/** The owner proposes NEW_OWNER and a relayer submits the passkey confirm. */
function transferTo(newOwner: string) {
  expect(simnet.callPublicFn(WALLET, "propose-transfer-wallet",
    [Cl.principal(newOwner)], OWNER).result).toBeOk(Cl.bool(true));
  return simnet.callPublicFn(WALLET, "confirm-transfer-wallet",
    [sigAuth(101, confirmTransferHash(101, newOwner)), Cl.none()], RELAYER);
}
/** Mines past the inactivity period, to a block outside a prepare phase (so a
 *  later restake is not u47). */
function mineInactive() {
  const target = Number(lastActivity()) + INACTIVITY_PERIOD + 1;
  const off = target % CYCLE_LEN, cyc = Math.floor(target / CYCLE_LEN);
  if (off < 20) mineTo(cyc, 20);
  else if (off >= CYCLE_LEN - PREPARE_LEN) mineTo(cyc + 1, 20);
  else mineTo(cyc, off);
}
function owner(): string {
  return Cl.prettyPrint(simnet.callReadOnlyFn(WALLET, "get-owner", [], RANDOM).result)
    .replace(/^\(ok '?/, "").replace(/\)$/, "");
}

describe("owner change resets the keeper (bounty mv7dfb, Giant Moth F2)", () => {
  it("confirm-transfer-wallet: the keeper becomes the new owner", () => {
    // arrange
    stakedSafe();
    expect(setKeeperAdmin(NEW_KEEPER).result).toBeOk(Cl.bool(true));
    // act
    const r = transferTo(NEW_OWNER);
    // assert
    expect(r.result).toBeOk(Cl.bool(true));
    expect(owner()).toBe(NEW_OWNER);
    expect(keeper()).toBe(NEW_OWNER);
  });

  it("confirm-transfer-wallet: the old keeper's restake is u4001", () => {
    // arrange
    stakedSafe();
    expect(setKeeperAdmin(NEW_KEEPER).result).toBeOk(Cl.bool(true));
    expect(transferTo(NEW_OWNER).result).toBeOk(Cl.bool(true));
    // act
    const byOld = restake(NEW_KEEPER);
    const byDefault = restake(D);
    const byOldOwner = restake(OWNER);
    // assert
    expect(byOld.result).toBeErr(Cl.uint(E_UNAUTH));
    expect(byDefault.result).toBeErr(Cl.uint(E_UNAUTH));
    expect(byOldOwner.result).toBeErr(Cl.uint(E_UNAUTH));
  });

  it("confirm-transfer-wallet: the default keeper (chavita) is also reset", () => {
    // arrange
    stakedSafe();
    expect(keeper()).toBe(D);
    // act
    expect(transferTo(NEW_OWNER).result).toBeOk(Cl.bool(true));
    // assert
    expect(keeper()).toBe(NEW_OWNER);
    expect(restake(D).result).toBeErr(Cl.uint(E_UNAUTH));
  });

  it("confirm-transfer-wallet: the new owner sets a keeper again and restake works", () => {
    // arrange
    stakedSafe();
    expect(transferTo(NEW_OWNER).result).toBeOk(Cl.bool(true));
    // act
    const byOldOwnerSet = setKeeperAdmin(D, OWNER);
    const set = setKeeperAdmin(D, NEW_OWNER);
    const r = restake(D);
    // assert
    expect(byOldOwnerSet.result).toBeErr(Cl.uint(E_UNAUTH));
    expect(set.result).toBeOk(Cl.bool(true));
    expect(keeper()).toBe(D);
    expect(r.result).toBeOk(Cl.tuple({ amount: Cl.uint(FUND), "cycles-to-extend": Cl.uint(0) }));
  });

  it("confirm-transfer-wallet: the new owner (as keeper) can restake directly", () => {
    // arrange
    stakedSafe();
    expect(transferTo(NEW_OWNER).result).toBeOk(Cl.bool(true));
    // act
    const r = restake(NEW_OWNER);
    // assert
    expect(r.result).toBeOk(Cl.tuple({ amount: Cl.uint(FUND), "cycles-to-extend": Cl.uint(0) }));
  });

  it("recover-inactive-wallet: refused before the inactivity period, keeper unchanged", () => {
    // arrange
    stakedSafe();
    expect(setKeeperAdmin(NEW_KEEPER).result).toBeOk(Cl.bool(true));
    // act
    const r = simnet.callPublicFn(WALLET, "recover-inactive-wallet", [Cl.principal(NEW_OWNER)], RECOVERY);
    // assert
    expect(r.result).toBeErr(Cl.uint(E_INACTIVE_REQUIRED));
    expect(keeper()).toBe(NEW_KEEPER);
  });

  it("recover-inactive-wallet: the keeper becomes the new owner; the old keeper's restake is u4001", () => {
    // arrange
    stakedSafe();
    expect(setKeeperAdmin(NEW_KEEPER).result).toBeOk(Cl.bool(true));
    mineInactive();
    expect(simnet.callReadOnlyFn(WALLET, "is-inactive", [], RANDOM).result).toBeBool(true);
    // act
    const r = simnet.callPublicFn(WALLET, "recover-inactive-wallet", [Cl.principal(NEW_OWNER)], RECOVERY);
    const byOld = restake(NEW_KEEPER);
    const byDefault = restake(D);
    // assert
    expect(r.result).toBeOk(Cl.bool(true));
    expect(owner()).toBe(NEW_OWNER);
    expect(keeper()).toBe(NEW_OWNER);
    expect(byOld.result).toBeErr(Cl.uint(E_UNAUTH));
    expect(byDefault.result).toBeErr(Cl.uint(E_UNAUTH));
  });

  it("recover-inactive-wallet: the new owner sets a keeper again and restake works", () => {
    // arrange
    stakedSafe();
    expect(setKeeperAdmin(NEW_KEEPER).result).toBeOk(Cl.bool(true));
    mineInactive();
    expect(simnet.callPublicFn(WALLET, "recover-inactive-wallet",
      [Cl.principal(NEW_OWNER)], RECOVERY).result).toBeOk(Cl.bool(true));
    const unlockBefore = unlockCycle();
    // act
    const set = setKeeperAdmin(NEW_KEEPER, NEW_OWNER);
    const r = restake(NEW_KEEPER);
    // assert
    expect(set.result).toBeOk(Cl.bool(true));
    expect(keeper()).toBe(NEW_KEEPER);
    const ext = currentCycle() + 1n + BigInt(NUM_CYCLES) - unlockBefore;
    expect(r.result).toBeOk(Cl.tuple({ amount: Cl.uint(FUND), "cycles-to-extend": Cl.uint(ext) }));
    expect(unlockCycle()).toBe(currentCycle() + 1n + BigInt(NUM_CYCLES));
  });
});
