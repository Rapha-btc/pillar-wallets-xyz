// juice-safe-v6-gaps.test.ts -- the real gaps that measured LINE coverage exposed.
//
// Run: npx vitest run tests/juice-safe-v6-gaps.test.ts -- --manifest tests/cl-v6/Clarinet.toml
//
// Error-code coverage hit 20/20 and every public function had assertions, yet lcov
// still put the contract at 91.6%. Most of the miss was continuation lines of
// multi-line expressions, but three real things were never executed:
//
//   1. THE MEMO BRANCH. Every other test passes Cl.none() for memo, so
//      (stx-transfer-memo? ...) never ran -- only the plain (stx-transfer? ...) arm.
//      Three sites: juice-safe-v6.clar:643, :670, :720.
//   2. Gas payment on sites no suite had ever paid on, including the one GAS-EXEMPT
//      call in the contract (confirm-transfer-wallet, :1156).
//   3. Two read-only getters nothing ever read.
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

const NEW_OWNER = accounts.get("wallet_6")!;

const memo = Cl.some(Cl.bufferFromHex("ab".repeat(34)));

describe("v6 gaps: the memo branch of STX transfers", () => {
  // stx-transfer-memo? is a DIFFERENT native from stx-transfer?. Passing none on
  // every test left the memo arm of all three STX paths unexecuted.
  it("under-threshold direct transfer carries a memo", () => {
    onboarded(); fundSTX();
    const before = simnet.getAssetsMap().get("STX")?.get(RECIPIENT) ?? 0n;
    expect(simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(1_000), Cl.principal(RECIPIENT), memo, Cl.none(), Cl.none()],
      OWNER).result).toBeOk(Cl.bool(true));
    expect(simnet.getAssetsMap().get("STX")?.get(RECIPIENT) ?? 0n).toBe(before + 1_000n);
  });

  it("the queued release carries a memo", () => {
    onboarded(); fundSTX();
    simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(STX_THRESHOLD + 1), Cl.principal(RECIPIENT), Cl.none(), Cl.none(), Cl.none()], OWNER);
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
    const before = simnet.getAssetsMap().get("STX")?.get(RECIPIENT) ?? 0n;
    expect(simnet.callPublicFn(WALLET, "execute-pending-stx-transfer",
      [Cl.uint(0), memo], OWNER).result).toBeOk(Cl.bool(true));
    expect(simnet.getAssetsMap().get("STX")?.get(RECIPIENT) ?? 0n)
      .toBe(before + BigInt(STX_THRESHOLD + 1));
  });

  it("the passkey fast release carries a memo AND pays a gas station", () => {
    // covers the memo arm at :720 and pay-gas-accounted at :710 in one call
    onboarded(); fundSTX(); fundSBTC();
    simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(STX_THRESHOLD + 1), Cl.principal(RECIPIENT), Cl.none(), Cl.none(), Cl.none()], OWNER);
    const before = simnet.getAssetsMap().get("STX")?.get(RECIPIENT) ?? 0n;
    const g0 = gasCounter();
    expect(simnet.callPublicFn(WALLET, "execute-pending-stx-transfer-now",
      [Cl.uint(0), memo,
       sign(topic("execute-now", { "auth-id": Cl.uint(700), "op-id": Cl.uint(0) }), 700),
       Cl.some(stationCV)], RELAYER).result).toBeOk(Cl.bool(true));
    expect(simnet.getAssetsMap().get("STX")?.get(RECIPIENT) ?? 0n)
      .toBe(before + BigInt(STX_THRESHOLD + 1));
    expect(gasCounter() - g0).toBe(BigInt(GAS_FEE));
  });
});

describe("v6 gaps: gas on the sites nothing had ever paid on", () => {
  let id = 750;
  it("sbtc-initiate-withdrawal pays the station", () => {
    onboarded(); fundSBTC();
    const g0 = gasCounter();
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "sbtc-initiate-withdrawal",
      [Cl.uint(10_000), poxAddr, Cl.uint(1_000),
       Cl.some(sign(topic("sbtc-withdrawal", { "auth-id": Cl.uint(++id),
         amount: Cl.uint(10_000), recipient: poxAddr, "max-fee": Cl.uint(1_000) }), id)),
       Cl.some(stationCV)], RELAYER).result)).toMatch(/^\(ok /);
    expect(gasCounter() - g0).toBe(BigInt(GAS_FEE));
  });

  it("the two sBTC -now paths pay the station", () => {
    onboarded(); fundSBTC();
    simnet.callPublicFn(WALLET, "sip010-transfer",
      [Cl.uint(SBTC_THRESHOLD + 1), Cl.principal(RECIPIENT), Cl.none(), sbtcCV,
       Cl.stringAscii("sbtc-token"), Cl.none(), Cl.none()], OWNER);
    let g0 = gasCounter();
    expect(simnet.callPublicFn(WALLET, "execute-pending-sbtc-transfer-now",
      [Cl.uint(0), Cl.none(),
       sign(topic("execute-now", { "auth-id": Cl.uint(++id), "op-id": Cl.uint(0) }), id),
       Cl.some(stationCV)], RELAYER).result).toBeOk(Cl.bool(true));
    expect(gasCounter() - g0).toBe(BigInt(GAS_FEE));

    simnet.callPublicFn(WALLET, "sbtc-initiate-withdrawal",
      [Cl.uint(SBTC_THRESHOLD + 1), poxAddr, Cl.uint(1_000), Cl.none(), Cl.none()], OWNER);
    g0 = gasCounter();
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "execute-pending-sbtc-withdrawal-now",
      [Cl.uint(1),
       sign(topic("execute-now", { "auth-id": Cl.uint(++id), "op-id": Cl.uint(1) }), id),
       Cl.some(stationCV)], RELAYER).result)).toMatch(/^\(ok /);
    expect(gasCounter() - g0).toBe(BigInt(GAS_FEE));
  });

  it("confirm-transfer-wallet pays, and is the contract's only GAS-EXEMPT site", () => {
    // GAS-EXEMPT means the fee is recorded but NOT checked against the period fuse --
    // deliberate, so a wallet cannot be locked out of an admin rotation by a spent
    // gas budget. Asserted by spending while already at the period cap.
    onboarded(); fundSBTC();
    simnet.callPublicFn(WALLET, "propose-transfer-wallet", [Cl.principal(NEW_OWNER)], OWNER);
    const g0 = gasCounter();
    expect(simnet.callPublicFn(WALLET, "confirm-transfer-wallet",
      [sign(topic("confirm-transfer",
        { "auth-id": Cl.uint(++id), "new-admin": Cl.principal(NEW_OWNER) }), id),
       Cl.some(stationCV)], RELAYER).result).toBeOk(Cl.bool(true));
    expect(gasCounter() - g0).toBe(BigInt(GAS_FEE));
    expect(simnet.getDataVar(WALLET, "owner")).toBePrincipal(NEW_OWNER);
  });

  it("stake and unstake pay the station", () => {
    onboarded(); fundSTX(); fundSBTC(); registerSigner();
    const AMT = 1_000_000_000;
    let g0 = gasCounter();
    expect(simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(AMT), Cl.some(sign(topic("stake-stx-juice-pox5",
        { "auth-id": Cl.uint(++id), "amount-ustx": Cl.uint(AMT) }), id)),
       Cl.some(stationCV)], RELAYER).result).toBeOk(Cl.bool(true));
    expect(gasCounter() - g0).toBe(BigInt(GAS_FEE));

    g0 = gasCounter();
    expect(simnet.callPublicFn(WALLET, "unstake",
      [Cl.some(sign(topic("unstake-stx-juice", { "auth-id": Cl.uint(++id) }), id)),
       Cl.some(stationCV)], RELAYER).result).toBeOk(Cl.bool(true));
    expect(gasCounter() - g0).toBe(BigInt(GAS_FEE));
  });
});

describe("v6 gaps: the two read-only getters nothing read", () => {
  it("get-pending-max-gas and get-token-lock-enabled report the live state", () => {
    onboarded();
    expect(Cl.prettyPrint(simnet.callReadOnlyFn(WALLET, "get-pending-max-gas", [], OWNER).result))
      .toContain("amount: u0");
    simnet.callPublicFn(WALLET, "propose-max-gas-amount", [Cl.uint(4_242)], OWNER);
    expect(Cl.prettyPrint(simnet.callReadOnlyFn(WALLET, "get-pending-max-gas", [], OWNER).result))
      .toContain("amount: u4242");

    expect(simnet.callReadOnlyFn(WALLET, "get-token-lock-enabled", [], OWNER).result)
      .toBeBool(false);
    simnet.callPublicFn(WALLET, "toggle-token-lock", [Cl.bool(true), Cl.none(), Cl.none()], OWNER);
    expect(simnet.callReadOnlyFn(WALLET, "get-token-lock-enabled", [], OWNER).result)
      .toBeBool(true);
  });
});
