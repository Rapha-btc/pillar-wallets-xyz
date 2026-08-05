// juice-safe-v6-limits.test.ts -- the guard rails the other four suites left alone.
//
// Run: npx vitest run tests/juice-safe-v6-limits.test.ts -- --manifest tests/cl-v6/Clarinet.toml
//
// Three things live here:
//  1. TOKEN LOCK on the 9 sites that were only ever toggled, never verified to block.
//     v6 gates the lock inside the (match sig-auth ...) Some-branch on every function
//     -- see juice-safe-v6.clar:1334 -- so the lock freezes the PASSKEY and leaves the
//     admin alone. That is the point: the passkey is the phishable factor, and the
//     admin is who flips the switch. Asserted both ways so the asymmetry stays honest.
//  2. THE GAS FUSE. pay-gas-accounted bounds a single call with
//     (with-ft ... max-gas-amount) and the whole period with max-gas-amount * 25
//     (GAS-CALLS-PER-PERIOD), erroring u4018. Nothing tested the period fuse tripping.
//  3. RE-PROPOSE / RE-SIGNAL. Both pending slots are plain data-vars, so a second
//     proposal overwrites the first -- which is how an admin cancels a raise they no
//     longer want without a veto path.
import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";
import crypto from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { generateP256Keypair, signChallengeWithRpId } from "../lib-webauthn-test-signer.mjs";

const D = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
// V6_DEPLOYER lets the coverage harness (tests/cl-v6-cov) deploy the wallet
// locally, since clarinet --coverage only instruments project contracts.
// Unset -- the normal case -- it is the real mainnet deployer.
const WD = process.env.V6_DEPLOYER ?? D;
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const WALLET = `${WD}.juice-safe-v6`;
const CORE = `${D}.fakfun-wallet-core`;
const SBTC_DEPOSIT = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-deposit";
const SBTC_SIGNER = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4";
const JUICE_SIGNER = `${D}.juice-pool-stx-signer`;
const RP_ID = "juiceofbtc.com";
const CHAIN_ID = 2147483648;

const accounts = simnet.getAccounts();
const DEPLOYER = accounts.get("deployer")!;
const OWNER = accounts.get("wallet_1")!;
const RECOVERY = accounts.get("wallet_2")!;
const RANDOM = accounts.get("wallet_3")!;
const RELAYER = accounts.get("wallet_4")!;
const RECIPIENT = accounts.get("wallet_5")!;

const MIN_COOLDOWN = 144;
const STX_THRESHOLD = 100_000_000;
const SBTC_THRESHOLD = 100_000;
const MAX_GAS_CEILING = 10_000;
const GAS_CALLS_PER_PERIOD = 25;
const GAS_FEE = 20;          // zz-gas-station charges this
const E_IN_COOLDOWN = 4012, E_THRESHOLD = 4018, E_TOKEN_LOCKED = 4023;

const SIP018 = Buffer.from("534950303138", "hex");
const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest();
const cvHash = (cv: any) => sha256(Buffer.from(Cl.serialize(cv), "hex"));
const domainHash = () => cvHash(Cl.tuple({
  name: Cl.stringAscii("smart-wallet-standard"), version: Cl.stringAscii("1.0.0"),
  "chain-id": Cl.uint(CHAIN_ID), wallet: Cl.contractPrincipal(WD, "juice-safe-v6"),
}));
const challenge = (t: any) => sha256(Buffer.concat([SIP018, domainHash(), cvHash(t)]));
const key = generateP256Keypair();
const strip = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);
const pubkeyCV = Cl.bufferFromHex(strip(key.pubKeyHex));
const topic = (name: string, fields: Record<string, any>) =>
  Cl.tuple({ topic: Cl.stringAscii(name), ...fields });
function sign(t: any, id: number) {
  const s = signChallengeWithRpId(challenge(t), key.privKey, RP_ID);
  return Cl.tuple({
    "auth-id": Cl.uint(id), pubkey: pubkeyCV,
    signature: Cl.bufferFromHex(strip(s.signatureHex)),
    "authenticator-data": Cl.bufferFromHex(strip(s.authenticatorDataHex)),
    "client-data-prefix": Cl.bufferFromHex(strip(s.clientDataPrefixHex)),
    "client-data-suffix": Cl.bufferFromHex(strip(s.clientDataSuffixHex)),
  });
}

const sbtcCV = Cl.contractPrincipal(SBTC_SIGNER, "sbtc-token");
const nftCV = Cl.contractPrincipal(DEPLOYER, "zz-nft");
const stationCV = Cl.contractPrincipal(DEPLOYER, "zz-gas-station");
const poxAddr = Cl.tuple({ version: Cl.bufferFromHex("00"), hashbytes: Cl.bufferFromHex("00".repeat(20)) });

function onboarded(cooldown = MIN_COOLDOWN) {
  simnet.callPublicFn(CORE, "set-verified-contract",
    [Cl.contractPrincipal(WD, "juice-safe-v6"), Cl.none()], D);
  expect(simnet.callPublicFn(WALLET, "onboard",
    [pubkeyCV, Cl.principal(OWNER), Cl.principal(RECOVERY),
     Cl.uint(STX_THRESHOLD), Cl.uint(SBTC_THRESHOLD), Cl.uint(cooldown)],
    FAKFUN_DEPLOYER).result).toBeOk(Cl.bool(true));
}
const fundSTX = (n = 2_000_000_000) => simnet.transferSTX(n, WALLET, DEPLOYER);
let depositNonce = 0;
function fundSBTC(to = WALLET, amount = 5_000_000) {
  const h = simnet.burnBlockHeight - 1;
  const hash = Cl.prettyPrint(simnet.callReadOnlyFn(`${DEPLOYER}.zz-nft`, "burn-hash",
    [Cl.uint(h)], DEPLOYER).result).replace(/^0x/, "");
  const txid = "33".repeat(31) + (++depositNonce).toString(16).padStart(2, "0");
  simnet.callPublicFn(SBTC_DEPOSIT, "complete-deposit-wrapper",
    [Cl.bufferFromHex(txid), Cl.uint(0), Cl.uint(amount), Cl.principal(to),
     Cl.bufferFromHex(strip(hash)), Cl.uint(h), Cl.bufferFromHex("22".repeat(32))], SBTC_SIGNER);
}
const lock = (on: boolean) =>
  expect(simnet.callPublicFn(WALLET, "toggle-token-lock",
    [Cl.bool(on), Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
const gasCounter = () => BigInt((Cl.prettyPrint(simnet.getDataVar(WALLET, "spent-this-period"))
  .match(/gas: u(\d+)/) || [])[1] ?? "-1");

// pox-5 grant path, so the staking token-lock checks reach a real signer.
function registerSigner() {
  const priv = Buffer.from("11".repeat(32), "hex");
  const pub = secp256k1.getPublicKey(priv, true);
  const dom = cvHash(Cl.tuple({ name: Cl.stringAscii("pox-5-signer"),
    version: Cl.stringAscii("1.0.0"), "chain-id": Cl.uint(CHAIN_ID) }));
  const st = cvHash(Cl.tuple({ topic: Cl.stringAscii("grant-authorization"),
    "signer-manager": Cl.contractPrincipal(D, "juice-pool-stx-signer"), "auth-id": Cl.uint(1) }));
  const h = sha256(Buffer.concat([SIP018, dom, st]));
  const compact = Buffer.from(secp256k1.sign(h, priv, { prehash: false }));
  for (const rec of [0, 1]) {
    const r = simnet.callPublicFn(JUICE_SIGNER, "register-self",
      [Cl.contractPrincipal(D, "juice-pool-stx-signer"),
       Cl.bufferFromHex(Buffer.from(pub).toString("hex")), Cl.uint(1),
       Cl.bufferFromHex(Buffer.concat([compact, Buffer.from([rec])]).toString("hex"))], D);
    if (Cl.prettyPrint(r.result).startsWith("(ok")) return;
  }
  throw new Error("signer registration failed");
}

// =====================================================================
// 1. TOKEN LOCK -- the 9 unverified sites
// =====================================================================
describe("v6 limits: the token lock freezes the passkey on every asset path", () => {
  let id = 100;
  beforeEach(() => { onboarded(); fundSTX(); fundSBTC(); });

  it("sip010-transfer: passkey blocked, admin unaffected", () => {
    lock(true);
    expect(simnet.callPublicFn(WALLET, "sip010-transfer",
      [Cl.uint(2_000), Cl.principal(RECIPIENT), Cl.none(), sbtcCV, Cl.stringAscii("sbtc-token"),
       Cl.some(sign(topic("sip010-transfer", { "auth-id": Cl.uint(++id), amount: Cl.uint(2_000),
         recipient: Cl.principal(RECIPIENT), memo: Cl.none(), sip010: sbtcCV }), id)),
       Cl.none()], RELAYER).result).toBeErr(Cl.uint(E_TOKEN_LOCKED));
    expect(simnet.callPublicFn(WALLET, "sip010-transfer",
      [Cl.uint(2_000), Cl.principal(RECIPIENT), Cl.none(), sbtcCV,
       Cl.stringAscii("sbtc-token"), Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
  });

  it("sip009-transfer: passkey blocked, admin unaffected", () => {
    simnet.callPublicFn(`${DEPLOYER}.zz-nft`, "mint", [Cl.principal(WALLET)], DEPLOYER);
    lock(true);
    expect(simnet.callPublicFn(WALLET, "sip009-transfer",
      [Cl.uint(1), Cl.principal(RECIPIENT), nftCV, Cl.stringAscii("zz-nft"),
       Cl.some(sign(topic("sip009-transfer", { "auth-id": Cl.uint(++id), "nft-id": Cl.uint(1),
         recipient: Cl.principal(RECIPIENT), sip009: nftCV }), id)),
       Cl.none()], RELAYER).result).toBeErr(Cl.uint(E_TOKEN_LOCKED));
    expect(simnet.callPublicFn(WALLET, "sip009-transfer",
      [Cl.uint(1), Cl.principal(RECIPIENT), nftCV, Cl.stringAscii("zz-nft"),
       Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
  });

  it("sbtc-initiate-withdrawal: passkey blocked, admin unaffected", () => {
    lock(true);
    expect(simnet.callPublicFn(WALLET, "sbtc-initiate-withdrawal",
      [Cl.uint(10_000), poxAddr, Cl.uint(1_000),
       Cl.some(sign(topic("sbtc-withdrawal", { "auth-id": Cl.uint(++id),
         amount: Cl.uint(10_000), recipient: poxAddr, "max-fee": Cl.uint(1_000) }), id)),
       Cl.none()], RELAYER).result).toBeErr(Cl.uint(E_TOKEN_LOCKED));
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "sbtc-initiate-withdrawal",
      [Cl.uint(10_000), poxAddr, Cl.uint(1_000), Cl.none(), Cl.none()],
      OWNER).result)).toMatch(/^\(ok /);
  });

  it("the three -now fast paths are blocked (they are passkey-only by construction)", () => {
    // queue one op of each kind above its threshold, THEN lock
    simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(STX_THRESHOLD + 1), Cl.principal(RECIPIENT), Cl.none(), Cl.none(), Cl.none()], OWNER);
    simnet.callPublicFn(WALLET, "sip010-transfer",
      [Cl.uint(SBTC_THRESHOLD + 1), Cl.principal(RECIPIENT), Cl.none(), sbtcCV,
       Cl.stringAscii("sbtc-token"), Cl.none(), Cl.none()], OWNER);
    simnet.callPublicFn(WALLET, "sbtc-initiate-withdrawal",
      [Cl.uint(SBTC_THRESHOLD + 1), poxAddr, Cl.uint(1_000), Cl.none(), Cl.none()], OWNER);
    lock(true);
    for (const [fn, opId, withMemo] of [
      ["execute-pending-stx-transfer-now", 0, true],
      ["execute-pending-sbtc-transfer-now", 1, true],
      ["execute-pending-sbtc-withdrawal-now", 2, false],
    ] as [string, number, boolean][]) {
      const s = sign(topic("execute-now", { "auth-id": Cl.uint(++id), "op-id": Cl.uint(opId) }), id);
      const args = withMemo
        ? [Cl.uint(opId), Cl.none(), s, Cl.none()]
        : [Cl.uint(opId), s, Cl.none()];
      expect(simnet.callPublicFn(WALLET, fn, args, RELAYER).result,
        `${fn} must refuse while locked`).toBeErr(Cl.uint(E_TOKEN_LOCKED));
    }
    // and the slow admin release still works once the cooldown passes
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
    expect(simnet.callPublicFn(WALLET, "execute-pending-stx-transfer",
      [Cl.uint(0), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
  });

  it("the three staking paths: passkey blocked, admin still stakes", () => {
    registerSigner();
    lock(true);
    const AMT = 1_000_000_000;
    expect(simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(AMT), Cl.some(sign(topic("stake-stx-juice-pox5",
        { "auth-id": Cl.uint(++id), "amount-ustx": Cl.uint(AMT) }), id)), Cl.none()],
      RELAYER).result).toBeErr(Cl.uint(E_TOKEN_LOCKED));

    // admin path is not gated -- staking locks STX in pox-5, it does not leave the safe
    expect(simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(AMT), Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));

    expect(simnet.callPublicFn(WALLET, "update-stake-stx-juice",
      [Cl.uint(50_000_000), Cl.uint(0),
       Cl.some(sign(topic("update-stake-stx-juice", { "auth-id": Cl.uint(++id),
         "amount-increase": Cl.uint(50_000_000), "cycles-to-extend": Cl.uint(0) }), id)),
       Cl.none()], RELAYER).result).toBeErr(Cl.uint(E_TOKEN_LOCKED));

    expect(simnet.callPublicFn(WALLET, "unstake",
      [Cl.some(sign(topic("unstake-stx-juice", { "auth-id": Cl.uint(++id) }), id)), Cl.none()],
      RELAYER).result).toBeErr(Cl.uint(E_TOKEN_LOCKED));

    // unlocking restores the passkey path
    lock(false);
    expect(simnet.callPublicFn(WALLET, "unstake",
      [Cl.some(sign(topic("unstake-stx-juice", { "auth-id": Cl.uint(++id) }), id)), Cl.none()],
      RELAYER).result).toBeOk(Cl.bool(true));
  });
});

// =====================================================================
// 2. THE GAS FUSE
// =====================================================================
describe("v6 limits: the per-period gas fuse", () => {
  it("trips with u4018 once cumulative gas would pass max-gas-amount * 25", () => {
    // lower max-gas to the station's exact fee so the cap is 20 * 25 = 500 sats.
    onboarded(); fundSTX(); fundSBTC();
    expect(simnet.callPublicFn(WALLET, "propose-max-gas-amount",
      [Cl.uint(GAS_FEE)], OWNER).result).toBeOk(Cl.bool(true));
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
    expect(simnet.callPublicFn(WALLET, "confirm-max-gas-amount",
      [sign(topic("confirm-max-gas-amount",
        { "auth-id": Cl.uint(1), amount: Cl.uint(GAS_FEE) }), 1), Cl.none()],
      RELAYER).result).toBeOk(Cl.bool(true));
    expect(simnet.getDataVar(WALLET, "max-gas-amount")).toBeUint(GAS_FEE);

    const cap = GAS_FEE * GAS_CALLS_PER_PERIOD;   // 500
    const paidTransfer = (n: number) => simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(1_000), Cl.principal(RECIPIENT), Cl.none(),
       Cl.some(sign(topic("stx-transfer", { "auth-id": Cl.uint(n), amount: Cl.uint(1_000),
         recipient: Cl.principal(RECIPIENT), memo: Cl.none() }), n)),
       Cl.some(stationCV)], RELAYER);

    // 25 calls fill the period exactly. Well inside one 144-block period.
    for (let i = 0; i < GAS_CALLS_PER_PERIOD; i++) {
      expect(paidTransfer(200 + i).result, `call ${i + 1} of ${GAS_CALLS_PER_PERIOD}`)
        .toBeOk(Cl.bool(true));
    }
    expect(gasCounter()).toBe(BigInt(cap));

    // the 26th would take gas to 520 > 500
    expect(paidTransfer(999).result).toBeErr(Cl.uint(E_THRESHOLD));
    expect(gasCounter()).toBe(BigInt(cap));   // the failed call banked nothing

    // rolling the period past cooldown-period burn blocks clears it
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
    expect(paidTransfer(1000).result).toBeOk(Cl.bool(true));
    expect(gasCounter()).toBe(BigInt(GAS_FEE));  // fresh period, one call in it
  });

  it("a single call cannot exceed max-gas-amount: the station is starved by the allowance", () => {
    // max-gas below the station's fee means the (with-ft ... max-gas-amount) clause
    // caps the transfer, so the station's own charge cannot go through.
    onboarded(); fundSTX(); fundSBTC();
    simnet.callPublicFn(WALLET, "propose-max-gas-amount", [Cl.uint(GAS_FEE - 1)], OWNER);
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
    simnet.callPublicFn(WALLET, "confirm-max-gas-amount",
      [sign(topic("confirm-max-gas-amount",
        { "auth-id": Cl.uint(2), amount: Cl.uint(GAS_FEE - 1) }), 2), Cl.none()], RELAYER);
    expect(simnet.getDataVar(WALLET, "max-gas-amount")).toBeUint(GAS_FEE - 1);

    const r = simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(1_000), Cl.principal(RECIPIENT), Cl.none(),
       Cl.some(sign(topic("stx-transfer", { "auth-id": Cl.uint(3), amount: Cl.uint(1_000),
         recipient: Cl.principal(RECIPIENT), memo: Cl.none() }), 3)),
       Cl.some(stationCV)], RELAYER);
    // whatever the exact shape, it must NOT succeed while paying the station 20
    expect(Cl.prettyPrint(r.result)).not.toMatch(/^\(ok /);
    expect(gasCounter()).toBeLessThanOrEqual(BigInt(GAS_FEE - 1));
  });
});

// =====================================================================
// 3. RE-PROPOSE / RE-SIGNAL
// =====================================================================
describe("v6 limits: a second proposal overwrites the first", () => {
  it("re-proposing a lower max-gas cancels the pending raise (the implicit veto)", () => {
    onboarded();
    simnet.callPublicFn(WALLET, "propose-max-gas-amount", [Cl.uint(9_000)], OWNER);
    // change of heart, same block-ish: propose something small instead
    simnet.callPublicFn(WALLET, "propose-max-gas-amount", [Cl.uint(50)], OWNER);
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);

    // the signature over the ABANDONED amount no longer validates
    expect(simnet.callPublicFn(WALLET, "confirm-max-gas-amount",
      [sign(topic("confirm-max-gas-amount",
        { "auth-id": Cl.uint(20), amount: Cl.uint(9_000) }), 20), Cl.none()],
      RELAYER).result).toBeErr(Cl.uint(4002));
    // only the latest one does
    expect(simnet.callPublicFn(WALLET, "confirm-max-gas-amount",
      [sign(topic("confirm-max-gas-amount",
        { "auth-id": Cl.uint(21), amount: Cl.uint(50) }), 21), Cl.none()],
      RELAYER).result).toBeOk(Cl.bool(true));
    expect(simnet.getDataVar(WALLET, "max-gas-amount")).toBeUint(50);
  });

  it("re-proposing also restarts the cooldown clock", () => {
    onboarded();
    simnet.callPublicFn(WALLET, "propose-max-gas-amount", [Cl.uint(100)], OWNER);
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN - 2);
    simnet.callPublicFn(WALLET, "propose-max-gas-amount", [Cl.uint(100)], OWNER);
    // the elapsed blocks belonged to the FIRST proposal; the clock is back to zero
    expect(simnet.callPublicFn(WALLET, "confirm-max-gas-amount",
      [sign(topic("confirm-max-gas-amount",
        { "auth-id": Cl.uint(22), amount: Cl.uint(100) }), 22), Cl.none()],
      RELAYER).result).toBeErr(Cl.uint(E_IN_COOLDOWN));
  });

  it("proposing above MAX-GAS-CEILING is refused outright", () => {
    onboarded();
    expect(simnet.callPublicFn(WALLET, "propose-max-gas-amount",
      [Cl.uint(MAX_GAS_CEILING + 1)], OWNER).result).toBeErr(Cl.uint(E_THRESHOLD));
    expect(simnet.callPublicFn(WALLET, "propose-max-gas-amount",
      [Cl.uint(MAX_GAS_CEILING)], OWNER).result).toBeOk(Cl.bool(true));
  });

  it("re-signalling a config change replaces the queued one", () => {
    onboarded();
    simnet.callPublicFn(WALLET, "signal-config-change",
      [Cl.uint(250_000_000), Cl.uint(300_000), Cl.uint(288)], OWNER);
    simnet.callPublicFn(WALLET, "signal-config-change",
      [Cl.uint(1_000), Cl.uint(2_000), Cl.uint(432)], OWNER);
    expect(simnet.callReadOnlyFn(WALLET, "get-pending-config", [], OWNER).result).toBeTuple({
      "stx-threshold": Cl.uint(1_000), "sbtc-threshold": Cl.uint(2_000),
      "cooldown-period": Cl.uint(432),
    });
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
    // the abandoned values cannot be confirmed
    expect(simnet.callPublicFn(WALLET, "set-wallet-config",
      [sign(topic("set-wallet-config", { "auth-id": Cl.uint(23),
        "stx-threshold": Cl.uint(250_000_000), "sbtc-threshold": Cl.uint(300_000),
        "cooldown-period": Cl.uint(288) }), 23), Cl.none()],
      RELAYER).result).toBeErr(Cl.uint(4002));
    expect(simnet.callPublicFn(WALLET, "set-wallet-config",
      [sign(topic("set-wallet-config", { "auth-id": Cl.uint(24),
        "stx-threshold": Cl.uint(1_000), "sbtc-threshold": Cl.uint(2_000),
        "cooldown-period": Cl.uint(432) }), 24), Cl.none()],
      RELAYER).result).toBeOk(Cl.bool(true));
    expect(simnet.getDataVar(WALLET, "wallet-config")).toBeTuple({
      "stx-threshold": Cl.uint(1_000), "sbtc-threshold": Cl.uint(2_000),
      "cooldown-period": Cl.uint(432), "config-signaled-at": Cl.none(),
    });
    // v6 zeroes pending-config after the apply, so the slot cannot be replayed
    expect(simnet.callReadOnlyFn(WALLET, "get-pending-config", [], OWNER).result).toBeTuple({
      "stx-threshold": Cl.uint(0), "sbtc-threshold": Cl.uint(0), "cooldown-period": Cl.uint(0),
    });
  });
});
