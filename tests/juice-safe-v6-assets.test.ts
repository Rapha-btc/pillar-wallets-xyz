// juice-safe-v6-assets.test.ts -- the SUCCESS paths, not just the rejections.
//
// Run: npx vitest run tests/juice-safe-v6-assets.test.ts -- --manifest tests/cl-v6/Clarinet.toml
//
// The other two v6 suites reach all 25 public functions but test the sBTC and NFT
// paths only for refusal, because the wallet had no assets. Clarinet requirements
// copy contract CODE from mainnet, never chain STATE, so sbtc-token exists in
// simnet with zero supply and no holders -- an sBTC whale has nothing here. (stxer
// is the opposite: it forks real state, which is why its harnesses can fund from a
// real holder.)
//
// So sBTC is minted through the REAL protocol path rather than mocked:
// sbtc-deposit.complete-deposit-wrapper, sent as the registry's own
// current-signer-principal, which simnet reports as
// SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4. That is legitimate protocol usage --
// the same call the sBTC signers make -- and it exercises sbtc-token.protocol-mint
// for real.
//
// Also adds a live gas station (tests/cl-v6/contracts/zz-gas-station.clar) so the
// gas channel can be driven on sites the earlier suites never paid on, and a local
// SIP-009 NFT so sip009-transfer can move a real token.
import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";
import crypto from "node:crypto";
import { generateP256Keypair, signChallengeWithRpId } from "../lib-webauthn-test-signer.mjs";

const D = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const WALLET = `${D}.juice-safe-v6`;
const CORE = `${D}.fakfun-wallet-core`;
const SBTC_ADDR = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4";
const SBTC = `${SBTC_ADDR}.sbtc-token`;
const SBTC_DEPOSIT = `${SBTC_ADDR}.sbtc-deposit`;
const SIGNER = SBTC_ADDR; // registry's current-signer-principal in simnet
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
const FUND_SATS = 5_000_000;
const GAS_FEE = 20n;

const E_UNAUTH = 4001, E_INVALID_OP = 4013, E_COOLDOWN_NOT_PASSED = 4017;

// --- SIP-018 ------------------------------------------------------------
const SIP018 = Buffer.from("534950303138", "hex");
const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest();
const cvHash = (cv: any) => sha256(Buffer.from(Cl.serialize(cv), "hex"));
const domainHash = () => cvHash(Cl.tuple({
  name: Cl.stringAscii("smart-wallet-standard"), version: Cl.stringAscii("1.0.0"),
  "chain-id": Cl.uint(CHAIN_ID), wallet: Cl.contractPrincipal(D, "juice-safe-v6"),
}));
const challenge = (t: any) => sha256(Buffer.concat([SIP018, domainHash(), cvHash(t)]));
const key = generateP256Keypair();
const strip = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);
const pubkeyCV = Cl.bufferFromHex(strip(key.pubKeyHex));
const sigAuth = (id: number, s: any) => Cl.tuple({
  "auth-id": Cl.uint(id), pubkey: pubkeyCV,
  signature: Cl.bufferFromHex(strip(s.signatureHex)),
  "authenticator-data": Cl.bufferFromHex(strip(s.authenticatorDataHex)),
  "client-data-prefix": Cl.bufferFromHex(strip(s.clientDataPrefixHex)),
  "client-data-suffix": Cl.bufferFromHex(strip(s.clientDataSuffixHex)),
});
const topic = (name: string, f: Record<string, any>) =>
  Cl.tuple({ topic: Cl.stringAscii(name), ...f });
const sign = (t: any, id: number) => sigAuth(id, signChallengeWithRpId(challenge(t), key.privKey, RP_ID));

// --- setup --------------------------------------------------------------
const sbtcCV = Cl.contractPrincipal(SBTC_ADDR, "sbtc-token");
const nftCV = Cl.contractPrincipal(DEPLOYER, "zz-nft");
const stationCV = Cl.contractPrincipal(DEPLOYER, "zz-gas-station");

function onboarded() {
  expect(simnet.callPublicFn(CORE, "set-verified-contract",
    [Cl.contractPrincipal(D, "juice-safe-v6"), Cl.none()], D).result).toBeOk(Cl.bool(true));
  expect(simnet.callPublicFn(WALLET, "onboard",
    [pubkeyCV, Cl.principal(OWNER), Cl.principal(RECOVERY),
     Cl.uint(STX_THRESHOLD), Cl.uint(SBTC_THRESHOLD), Cl.uint(MIN_COOLDOWN)],
    FAKFUN_DEPLOYER).result).toBeOk(Cl.bool(true));
}

let depositNonce = 0;
/** Mint sBTC to `to` through the real sbtc-deposit protocol path. */
function fundSBTC(to: string, amount = FUND_SATS) {
  const h = simnet.burnBlockHeight - 1;
  // zz-nft.burn-hash unwraps the optional for us, so this comes back as a plain
  // (buff 32) the JS side can read.
  const hdr = simnet.callReadOnlyFn(`${DEPLOYER}.zz-nft`, "burn-hash", [Cl.uint(h)], DEPLOYER);
  const hash = Cl.prettyPrint(hdr.result).replace(/^0x/, "");
  const txid = "11".repeat(31) + (++depositNonce).toString(16).padStart(2, "0");
  const r = simnet.callPublicFn(SBTC_DEPOSIT, "complete-deposit-wrapper",
    [Cl.bufferFromHex(txid), Cl.uint(0), Cl.uint(amount), Cl.principal(to),
     Cl.bufferFromHex(strip(hash)), Cl.uint(h), Cl.bufferFromHex("22".repeat(32))],
    SIGNER);
  return r;
}
// simnet accounts already hold sBTC at genesis, so absolute assertions are wrong;
// and get-balance sums unlocked + locked, so a withdrawal (which LOCKS) shows no
// change there. Hence both helpers, and deltas everywhere.
const sbtcTotal = (p: string): bigint =>
  BigInt(Cl.prettyPrint(simnet.callReadOnlyFn(SBTC, "get-balance",
    [Cl.principal(p)], DEPLOYER).result).replace(/\D/g, ""));
const sbtcAvail = (p: string): bigint =>
  BigInt(Cl.prettyPrint(simnet.callReadOnlyFn(SBTC, "get-balance-available",
    [Cl.principal(p)], DEPLOYER).result).replace(/\D/g, ""));
const gasCounter = () => {
  const s = Cl.prettyPrint(simnet.getDataVar(WALLET, "spent-this-period"));
  return BigInt((s.match(/gas: u(\d+)/) || [])[1] ?? "-1");
};

describe("v6 assets: sBTC funding works through the real protocol path", () => {
  it("mints sBTC into the wallet via sbtc-deposit, no mock", () => {
    onboarded();
    const before = sbtcTotal(WALLET);
    const r = fundSBTC(WALLET);
    expect(r.result).toBeOk(Cl.bool(true));
    expect(sbtcTotal(WALLET) - before).toBe(BigInt(FUND_SATS));
  });
});

describe("v6 assets: sip010-transfer success paths", () => {
  it("moves sBTC under threshold on the admin path", () => {
    onboarded(); fundSBTC(WALLET);
    const b0 = sbtcTotal(RECIPIENT);
    expect(simnet.callPublicFn(WALLET, "sip010-transfer",
      [Cl.uint(1_000), Cl.principal(RECIPIENT), Cl.none(), sbtcCV,
       Cl.stringAscii("sbtc-token"), Cl.none(), Cl.none()], OWNER).result)
      .toBeOk(Cl.bool(true));
    expect(sbtcTotal(RECIPIENT) - b0).toBe(1_000n);
  });

  it("moves sBTC on the PASSKEY path through a relayer", () => {
    onboarded(); fundSBTC(WALLET);
    const b0 = sbtcTotal(RECIPIENT);
    expect(simnet.callPublicFn(WALLET, "sip010-transfer",
      [Cl.uint(2_000), Cl.principal(RECIPIENT), Cl.none(), sbtcCV,
       Cl.stringAscii("sbtc-token"),
       Cl.some(sign(topic("sip010-transfer", {
         "auth-id": Cl.uint(1), amount: Cl.uint(2_000),
         recipient: Cl.principal(RECIPIENT), memo: Cl.none(), sip010: sbtcCV,
       }), 1)), Cl.none()], RELAYER).result).toBeOk(Cl.bool(true));
    expect(sbtcTotal(RECIPIENT) - b0).toBe(2_000n);
  });

  it("queues over the sBTC threshold and releases after the cooldown", () => {
    onboarded(); fundSBTC(WALLET);
    const b0 = sbtcTotal(RECIPIENT);
    expect(simnet.callPublicFn(WALLET, "sip010-transfer",
      [Cl.uint(SBTC_THRESHOLD + 1), Cl.principal(RECIPIENT), Cl.none(), sbtcCV,
       Cl.stringAscii("sbtc-token"), Cl.none(), Cl.none()], OWNER).result)
      .toBeOk(Cl.bool(true));
    expect(sbtcTotal(RECIPIENT) - b0).toBe(0n); // queued, nothing moved

    expect(simnet.callPublicFn(WALLET, "execute-pending-sbtc-transfer",
      [Cl.uint(0), Cl.none()], OWNER).result).toBeErr(Cl.uint(E_COOLDOWN_NOT_PASSED));

    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
    expect(simnet.callPublicFn(WALLET, "execute-pending-sbtc-transfer",
      [Cl.uint(0), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
    expect(sbtcTotal(RECIPIENT) - b0).toBe(BigInt(SBTC_THRESHOLD + 1));
  });

  it("the sBTC fast path releases immediately with the passkey", () => {
    onboarded(); fundSBTC(WALLET);
    const b0 = sbtcTotal(RECIPIENT);
    simnet.callPublicFn(WALLET, "sip010-transfer",
      [Cl.uint(SBTC_THRESHOLD + 1), Cl.principal(RECIPIENT), Cl.none(), sbtcCV,
       Cl.stringAscii("sbtc-token"), Cl.none(), Cl.none()], OWNER);
    expect(simnet.callPublicFn(WALLET, "execute-pending-sbtc-transfer-now",
      [Cl.uint(0), Cl.none(),
       sign(topic("execute-now", { "auth-id": Cl.uint(2), "op-id": Cl.uint(0) }), 2),
       Cl.none()], RELAYER).result).toBeOk(Cl.bool(true));
    expect(sbtcTotal(RECIPIENT) - b0).toBe(BigInt(SBTC_THRESHOLD + 1));
  });
});

describe("v6 assets: sBTC withdrawal (peg-out)", () => {
  const poxAddr = Cl.tuple({
    version: Cl.bufferFromHex("00"),
    hashbytes: Cl.bufferFromHex("00".repeat(20)),
  });

  it("initiates a withdrawal under threshold", () => {
    onboarded(); fundSBTC(WALLET);
    const a0 = sbtcAvail(WALLET);
    expect(simnet.callPublicFn(WALLET, "sbtc-initiate-withdrawal",
      [Cl.uint(10_000), poxAddr, Cl.uint(1_000), Cl.none(), Cl.none()], OWNER).result)
      .toBeOk(Cl.bool(true));
    // amount + max-fee moved from AVAILABLE into the locked withdrawal system
    expect(a0 - sbtcAvail(WALLET)).toBe(11_000n);
  });

  it("queues over threshold, then releases through the slow path", () => {
    onboarded(); fundSBTC(WALLET);
    const a0 = sbtcAvail(WALLET);
    expect(simnet.callPublicFn(WALLET, "sbtc-initiate-withdrawal",
      [Cl.uint(SBTC_THRESHOLD + 1), poxAddr, Cl.uint(1_000), Cl.none(), Cl.none()],
      OWNER).result).toBeOk(Cl.bool(true));
    expect(a0 - sbtcAvail(WALLET)).toBe(0n); // queued, nothing locked yet

    expect(simnet.callPublicFn(WALLET, "execute-pending-sbtc-withdrawal",
      [Cl.uint(0)], OWNER).result).toBeErr(Cl.uint(E_COOLDOWN_NOT_PASSED));
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
    // returns the withdrawal REQUEST ID, not a bool
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "execute-pending-sbtc-withdrawal",
      [Cl.uint(0)], OWNER).result)).toMatch(/^\(ok u\d+\)$/);
    expect(a0 - sbtcAvail(WALLET)).toBe(BigInt(SBTC_THRESHOLD + 1) + 1_000n);
  });

  it("the withdrawal fast path releases immediately with the passkey", () => {
    onboarded(); fundSBTC(WALLET);
    const a0 = sbtcAvail(WALLET);
    simnet.callPublicFn(WALLET, "sbtc-initiate-withdrawal",
      [Cl.uint(SBTC_THRESHOLD + 1), poxAddr, Cl.uint(1_000), Cl.none(), Cl.none()], OWNER);
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "execute-pending-sbtc-withdrawal-now",
      [Cl.uint(0),
       sign(topic("execute-now", { "auth-id": Cl.uint(3), "op-id": Cl.uint(0) }), 3),
       Cl.none()], RELAYER).result)).toMatch(/^\(ok u\d+\)$/);
    expect(a0 - sbtcAvail(WALLET)).toBe(BigInt(SBTC_THRESHOLD + 1) + 1_000n);
  });

  it("a passkey-signed withdrawal is accepted", () => {
    onboarded(); fundSBTC(WALLET);
    expect(simnet.callPublicFn(WALLET, "sbtc-initiate-withdrawal",
      [Cl.uint(10_000), poxAddr, Cl.uint(1_000),
       Cl.some(sign(topic("sbtc-withdrawal", {
         "auth-id": Cl.uint(4), amount: Cl.uint(10_000),
         recipient: poxAddr, "max-fee": Cl.uint(1_000),
       }), 4)), Cl.none()], RELAYER).result).toBeOk(Cl.bool(true));
  });
});

describe("v6 assets: sip009-transfer moves a real NFT", () => {
  it("transfers on the admin path", () => {
    onboarded();
    const m = simnet.callPublicFn(`${DEPLOYER}.zz-nft`, "mint", [Cl.principal(WALLET)], DEPLOYER);
    expect(m.result).toBeOk(Cl.uint(1));
    expect(simnet.callPublicFn(WALLET, "sip009-transfer",
      [Cl.uint(1), Cl.principal(RECIPIENT), nftCV, Cl.stringAscii("zz-nft"),
       Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
    expect(simnet.callReadOnlyFn(`${DEPLOYER}.zz-nft`, "get-owner", [Cl.uint(1)], DEPLOYER).result)
      .toBeOk(Cl.some(Cl.principal(RECIPIENT)));
  });

  it("transfers on the PASSKEY path", () => {
    onboarded();
    simnet.callPublicFn(`${DEPLOYER}.zz-nft`, "mint", [Cl.principal(WALLET)], DEPLOYER);
    expect(simnet.callPublicFn(WALLET, "sip009-transfer",
      [Cl.uint(1), Cl.principal(RECIPIENT), nftCV, Cl.stringAscii("zz-nft"),
       Cl.some(sign(topic("sip009-transfer", {
         "auth-id": Cl.uint(5), "nft-id": Cl.uint(1),
         recipient: Cl.principal(RECIPIENT), sip009: nftCV,
       }), 5)), Cl.none()], RELAYER).result).toBeOk(Cl.bool(true));
  });
});

describe("v6 assets: the gas channel on sites the other suites never paid on", () => {
  it("charges the station on a passkey sip010-transfer", () => {
    onboarded(); fundSBTC(WALLET);
    const before = gasCounter();
    expect(simnet.callPublicFn(WALLET, "sip010-transfer",
      [Cl.uint(1_000), Cl.principal(RECIPIENT), Cl.none(), sbtcCV,
       Cl.stringAscii("sbtc-token"),
       Cl.some(sign(topic("sip010-transfer", {
         "auth-id": Cl.uint(6), amount: Cl.uint(1_000),
         recipient: Cl.principal(RECIPIENT), memo: Cl.none(), sip010: sbtcCV,
       }), 6)), Cl.some(stationCV)], RELAYER).result).toBeOk(Cl.bool(true));
    expect(gasCounter() - before).toBe(GAS_FEE);
  });

  it("charges the station on a passkey sip009-transfer", () => {
    onboarded(); fundSBTC(WALLET);
    simnet.callPublicFn(`${DEPLOYER}.zz-nft`, "mint", [Cl.principal(WALLET)], DEPLOYER);
    const before = gasCounter();
    expect(simnet.callPublicFn(WALLET, "sip009-transfer",
      [Cl.uint(1), Cl.principal(RECIPIENT), nftCV, Cl.stringAscii("zz-nft"),
       Cl.some(sign(topic("sip009-transfer", {
         "auth-id": Cl.uint(7), "nft-id": Cl.uint(1),
         recipient: Cl.principal(RECIPIENT), sip009: nftCV,
       }), 7)), Cl.some(stationCV)], RELAYER).result).toBeOk(Cl.bool(true));
    expect(gasCounter() - before).toBe(GAS_FEE);
  });

  it("charges the station on veto-operation and toggle-token-lock", () => {
    onboarded(); fundSBTC(WALLET);
    simnet.transferSTX(500_000_000, WALLET, DEPLOYER);
    simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(STX_THRESHOLD + 1), Cl.principal(RECIPIENT), Cl.none(), Cl.none(), Cl.none()], OWNER);

    let before = gasCounter();
    expect(simnet.callPublicFn(WALLET, "veto-operation",
      [Cl.uint(0),
       Cl.some(sign(topic("veto-operation", { "auth-id": Cl.uint(8), "op-id": Cl.uint(0) }), 8)),
       Cl.some(stationCV)], RELAYER).result).toBeOk(Cl.bool(true));
    expect(gasCounter() - before).toBe(GAS_FEE);

    before = gasCounter();
    expect(simnet.callPublicFn(WALLET, "toggle-token-lock",
      [Cl.bool(true),
       Cl.some(sign(topic("toggle-token-lock",
         { "auth-id": Cl.uint(9), enabled: Cl.bool(true) }), 9)),
       Cl.some(stationCV)], RELAYER).result).toBeOk(Cl.bool(true));
    expect(gasCounter() - before).toBe(GAS_FEE);
  });

  it("charges the station on propose-recovery and on the config confirm", () => {
    onboarded(); fundSBTC(WALLET);
    let before = gasCounter();
    expect(simnet.callPublicFn(WALLET, "propose-recovery",
      [Cl.principal(RANDOM),
       sign(topic("propose-recovery",
         { "auth-id": Cl.uint(10), "new-recovery": Cl.principal(RANDOM) }), 10),
       Cl.some(stationCV)], RELAYER).result).toBeOk(Cl.bool(true));
    expect(gasCounter() - before).toBe(GAS_FEE);

    simnet.callPublicFn(WALLET, "signal-config-change",
      [Cl.uint(250_000_000), Cl.uint(300_000), Cl.uint(288)], OWNER);
    // Mining past the cooldown ROLLS the spend period. The contract resets the
    // counters lazily inside get-current-spent, so the raw data-var still shows the
    // old value until the next write -- a delta would read 0 even though the fee was
    // charged. Assert the absolute instead: after a roll the counter restarts from
    // this fee alone.
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
    expect(simnet.callPublicFn(WALLET, "set-wallet-config",
      [sign(topic("set-wallet-config", {
        "auth-id": Cl.uint(11), "stx-threshold": Cl.uint(250_000_000),
        "sbtc-threshold": Cl.uint(300_000), "cooldown-period": Cl.uint(288),
      }), 11), Cl.some(stationCV)], RELAYER).result).toBeOk(Cl.bool(true));
    expect(gasCounter()).toBe(GAS_FEE);
  });

  it("charges the station on the max-gas confirm and on a pending fast release", () => {
    onboarded(); fundSBTC(WALLET);
    simnet.callPublicFn(WALLET, "propose-max-gas-amount", [Cl.uint(5000)], OWNER);
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5); // rolls the period, see above
    expect(simnet.callPublicFn(WALLET, "confirm-max-gas-amount",
      [sign(topic("confirm-max-gas-amount",
        { "auth-id": Cl.uint(12), amount: Cl.uint(5000) }), 12),
       Cl.some(stationCV)], RELAYER).result).toBeOk(Cl.bool(true));
    expect(gasCounter()).toBe(GAS_FEE);
    let before = gasCounter();

    simnet.callPublicFn(WALLET, "sip010-transfer",
      [Cl.uint(SBTC_THRESHOLD + 1), Cl.principal(RECIPIENT), Cl.none(), sbtcCV,
       Cl.stringAscii("sbtc-token"), Cl.none(), Cl.none()], OWNER);
    before = gasCounter();
    expect(simnet.callPublicFn(WALLET, "execute-pending-sbtc-transfer-now",
      [Cl.uint(0), Cl.none(),
       sign(topic("execute-now", { "auth-id": Cl.uint(13), "op-id": Cl.uint(0) }), 13),
       Cl.some(stationCV)], RELAYER).result).toBeOk(Cl.bool(true));
    expect(gasCounter() - before).toBe(GAS_FEE);
  });

  it("the station is IGNORED on an unsigned admin call -- documented footgun", () => {
    onboarded(); fundSBTC(WALLET);
    const before = gasCounter();
    expect(simnet.callPublicFn(WALLET, "sip010-transfer",
      [Cl.uint(1_000), Cl.principal(RECIPIENT), Cl.none(), sbtcCV,
       Cl.stringAscii("sbtc-token"), Cl.none(), Cl.some(stationCV)], OWNER).result)
      .toBeOk(Cl.bool(true));
    expect(gasCounter()).toBe(before); // gas is matched inside the sig-auth branch
  });
});
