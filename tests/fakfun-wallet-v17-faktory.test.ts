// fakfun-wallet-v17-faktory.test.ts -- the 8 faktory-* functions.
//
// Run: npx vitest run tests/fakfun-wallet-v17-faktory.test.ts -- --manifest tests/cl-v17/Clarinet.toml
//
// Originally out of scope (unchanged code with tests in another repo), brought in on
// Rapha's call that it is always better to re-test everything. Five trait doubles were
// needed, since each faktory path dispatches through a different trait:
//
//   zz-pool          dexterity liquidity-pool-trait   faktory-execute / -execute-limit
//   zz-dex           faktory dex-trait                faktory-place-order
//   zz-faktory-token faktory-trait-v1 sip-010         (a SEPARATE trait from the
//                                                      standard one, so zz-ft cannot
//                                                      stand in for it)
//   zz-pre           prelaunch-trait                  faktory-process / -process-claim
//                                                     / -fee-airdrop
//   zz-nftmarket     nftmarket-trait                  faktory-nft-execute
//
// Each double records what it was asked to do, so every assertion is "the wallet
// actually reached the counterparty and dispatched the right branch", not just "the
// call returned ok".
//
// The opcode's FIRST BYTE selects the branch, read through the contract's own private
// get-byte helper:
//   faktory-execute      0x00 buy   0x01 sell   0x02 add-liq   0x03 remove-liq
//   faktory-nft-execute  0x00 list  0x01 buy    0x02 unlist    0x03 price  0x04 ft
import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";
import {
  D, WD, WALLET, OWNER, RANDOM, RELAYER, DEPLOYER,
  E, seated, fundSTX, fundSBTC, sign, topic, sbtcCV, stationCV, gasCounter,
  pubkeyCV, key, strip, RP_ID, registerSigner,
} from "./v17-helpers";

let id = 700;
const next = () => ++id;
const POOL = Cl.contractPrincipal(DEPLOYER, "zz-pool");
const DEX = Cl.contractPrincipal(DEPLOYER, "zz-dex");
const FAK = Cl.contractPrincipal(DEPLOYER, "zz-faktory-token");
const PRE = Cl.contractPrincipal(DEPLOYER, "zz-pre");
const MKT = Cl.contractPrincipal(DEPLOYER, "zz-nftmarket");
const NFT = Cl.contractPrincipal(DEPLOYER, "zz-nft");
const GAS_FEE = 20;
const ro = (c: string, fn: string) =>
  simnet.callReadOnlyFn(`${DEPLOYER}.${c}`, fn, [], OWNER).result;
const op = (b: string) => Cl.some(Cl.bufferFromHex(b));

const CORE2 = `${D}.fakfun-core-v2`;

/** fakfun-core-v2 refuses an unregistered pool with ERR_POOL_NOT_FOUND u1003, so the
 *  doubles have to be registered there first, as core-v2's own DEPLOYER. register-dex
 *  registers the prelaunch contract at the same time. `gated` is false by default, so
 *  no approve-caller step is needed. */
function registerWithCore() {
  expect(Cl.prettyPrint(simnet.callPublicFn(CORE2, "auto-register-pool",
    [Cl.principal(`${DEPLOYER}.zz-pool`), Cl.stringAscii("zz pool"), Cl.stringAscii("ZZP"),
     Cl.principal("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token"),
     Cl.principal(`${DEPLOYER}.zz-faktory-token`), Cl.uint(1), Cl.uint(30), Cl.none(),
     Cl.uint(1000), Cl.uint(1000), Cl.uint(1000)], D).result)).toMatch(/^\(ok /);
  // fakfun-nfts-core refuses an unregistered marketplace with ERR-NOT-REGISTERED u5002
  expect(simnet.callPublicFn(`${D}.fakfun-nfts-core`, "whitelist-marketplace",
    [Cl.principal(`${DEPLOYER}.zz-nftmarket`), Cl.principal(`${DEPLOYER}.zz-nft`),
     Cl.stringAscii("zz market"), Cl.bool(true)], D).result).toBeOk(Cl.bool(true));
  expect(Cl.prettyPrint(simnet.callPublicFn(CORE2, "register-dex",
    [Cl.principal(`${DEPLOYER}.zz-dex`), Cl.principal(`${DEPLOYER}.zz-pre`), Cl.none(),
     Cl.principal("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token"),
     Cl.principal(`${DEPLOYER}.zz-faktory-token`), Cl.uint(1_000_000), Cl.uint(1_000_000),
     Cl.some(Cl.uint(1_000_000)), Cl.some(Cl.uint(100)), Cl.uint(1)], D).result))
    .toMatch(/^\(ok /);
}

function funded() {
  seated(); fundSTX(); fundSBTC(); registerWithCore();
  simnet.callPublicFn(`${DEPLOYER}.zz-faktory-token`, "mint",
    [Cl.uint(10_000_000), Cl.principal(WALLET)], DEPLOYER);
  simnet.callPublicFn(`${DEPLOYER}.zz-nft`, "mint", [Cl.principal(WALLET)], DEPLOYER);
}

describe("faktory-execute: the four pool opcodes", () => {
  it("BUY (0x00) reaches the pool with the right amount", () => {
    funded();
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "faktory-execute",
      [POOL, Cl.uint(5_000), op("00"), sbtcCV, Cl.stringAscii("sbtc-token"),
       Cl.none(), Cl.none()], OWNER).result)).toMatch(/^\(ok /);
    expect(ro("zz-pool", "get-calls"), "the pool was actually called").toBeUint(1);
    expect(ro("zz-pool", "get-last-amount")).toBeUint(5_000);
    expect(Cl.prettyPrint(ro("zz-pool", "get-last-op"))).toBe("0x00");
  });

  it("SELL (0x01) dispatches with the sell opcode", () => {
    funded();
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "faktory-execute",
      [POOL, Cl.uint(7_000), op("01"), FAK, Cl.stringAscii("zz-fak"),
       Cl.none(), Cl.none()], OWNER).result)).toMatch(/^\(ok /);
    expect(Cl.prettyPrint(ro("zz-pool", "get-last-op"))).toBe("0x01");
  });

  it("ADD-LIQ (0x02) quotes first, then executes under a TWO-asset allowance", () => {
    // this branch declares (with-ft sbtc dx) AND (with-ft token dy) from the quote,
    // so it is the only faktory path that bounds two assets at once
    funded();
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "faktory-execute",
      [POOL, Cl.uint(3_000), op("02"), FAK, Cl.stringAscii("zz-fak"),
       Cl.none(), Cl.none()], OWNER).result)).toMatch(/^\(ok /);
    expect(Cl.prettyPrint(ro("zz-pool", "get-last-op"))).toBe("0x02");
  });

  it("REMOVE-LIQ (0x03) dispatches too", () => {
    funded();
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "faktory-execute",
      [POOL, Cl.uint(2_000), op("03"), FAK, Cl.stringAscii("zz-fak"),
       Cl.none(), Cl.none()], OWNER).result)).toMatch(/^\(ok /);
    expect(Cl.prettyPrint(ro("zz-pool", "get-last-op"))).toBe("0x03");
  });

  it("refuses a non-admin, and works on the passkey path with a gas station", () => {
    funded();
    expect(simnet.callPublicFn(WALLET, "faktory-execute",
      [POOL, Cl.uint(1_000), op("00"), sbtcCV, Cl.stringAscii("sbtc-token"),
       Cl.none(), Cl.none()], RANDOM).result).toBeErr(Cl.uint(E.UNAUTH));

    const g0 = gasCounter();
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "faktory-execute",
      [POOL, Cl.uint(1_000), op("00"), sbtcCV, Cl.stringAscii("sbtc-token"),
       Cl.some(sign(topic("faktory-execute", { "auth-id": Cl.uint(next()), pool: POOL,
         amount: Cl.uint(1_000), opcode: op("00") }), id)),
       Cl.some(stationCV)], RELAYER).result)).toMatch(/^\(ok /);
    expect(gasCounter() - g0).toBe(BigInt(GAS_FEE));
  });

  it("the token lock does NOT block faktory-execute -- only -execute-limit is gated", () => {
    // Worth stating plainly: of the eight faktory paths, ONLY faktory-execute-limit
    // carries err-token-locked. So toggling the token lock does not freeze DEX
    // activity -- a locked wallet can still swap, place orders, buy prelaunch seats
    // and trade NFTs. The lock protects direct asset movement, not trading.
    funded();
    simnet.callPublicFn(WALLET, "toggle-token-lock", [Cl.bool(true), Cl.none(), Cl.none()], OWNER);
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "faktory-execute",
      [POOL, Cl.uint(1_000), op("00"), sbtcCV, Cl.stringAscii("sbtc-token"),
       Cl.some(sign(topic("faktory-execute", { "auth-id": Cl.uint(next()), pool: POOL,
         amount: Cl.uint(1_000), opcode: op("00") }), id)), Cl.none()],
      RELAYER).result), "still executes while locked").toMatch(/^\(ok /);
  });
});

describe("faktory-execute-limit: passkey-only, with a limit and an expiry", () => {
  it("executes when the quote clears the limit before expiry", () => {
    funded();
    const h = simnet.burnBlockHeight;
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "faktory-execute-limit",
      [POOL, Cl.uint(5_000), op("00"), sbtcCV, Cl.stringAscii("sbtc-token"),
       Cl.uint(1), Cl.uint(h + 100),
       sign(topic("faktory-execute-limit", { "auth-id": Cl.uint(next()), pool: POOL,
         amount: Cl.uint(5_000), opcode: op("00"), "limit-out": Cl.uint(1),
         "expiry-burn-block": Cl.uint(h + 100) }), id), Cl.none()], RELAYER).result)).toMatch(/^\(ok /);
    expect(ro("zz-pool", "get-calls")).toBeUint(1);
  });

  it("the token lock DOES block it -- the only faktory path that is gated", () => {
    funded();
    const h = simnet.burnBlockHeight;
    simnet.callPublicFn(WALLET, "toggle-token-lock", [Cl.bool(true), Cl.none(), Cl.none()], OWNER);
    expect(simnet.callPublicFn(WALLET, "faktory-execute-limit",
      [POOL, Cl.uint(5_000), op("00"), sbtcCV, Cl.stringAscii("sbtc-token"),
       Cl.uint(1), Cl.uint(h + 100),
       sign(topic("faktory-execute-limit", { "auth-id": Cl.uint(next()), pool: POOL,
         amount: Cl.uint(5_000), opcode: op("00"), "limit-out": Cl.uint(1),
         "expiry-burn-block": Cl.uint(h + 100) }), id), Cl.none()],
      RELAYER).result).toBeErr(Cl.uint(E.TOKEN_LOCKED));
  });

  it("u4024 refuses an EXPIRED limit order", () => {
    funded();
    const h = simnet.burnBlockHeight;
    simnet.mineEmptyBurnBlocks(10);
    expect(simnet.callPublicFn(WALLET, "faktory-execute-limit",
      [POOL, Cl.uint(5_000), op("00"), sbtcCV, Cl.stringAscii("sbtc-token"),
       Cl.uint(1), Cl.uint(h + 1),
       sign(topic("faktory-execute-limit", { "auth-id": Cl.uint(next()), pool: POOL,
         amount: Cl.uint(5_000), opcode: op("00"), "limit-out": Cl.uint(1),
         "expiry-burn-block": Cl.uint(h + 1) }), id), Cl.none()],
      RELAYER).result).toBeErr(Cl.uint(4024));
  });

  it("u4025 refuses when the quote does NOT reach the limit", () => {
    // zz-pool quotes dy == amount, so a limit above the amount cannot be met
    funded();
    const h = simnet.burnBlockHeight;
    expect(simnet.callPublicFn(WALLET, "faktory-execute-limit",
      [POOL, Cl.uint(5_000), op("00"), sbtcCV, Cl.stringAscii("sbtc-token"),
       Cl.uint(99_999_999), Cl.uint(h + 100),
       sign(topic("faktory-execute-limit", { "auth-id": Cl.uint(next()), pool: POOL,
         amount: Cl.uint(5_000), opcode: op("00"), "limit-out": Cl.uint(99_999_999),
         "expiry-burn-block": Cl.uint(h + 100) }), id), Cl.none()],
      RELAYER).result).toBeErr(Cl.uint(4025));
    expect(ro("zz-pool", "get-calls"), "it never executed").toBeUint(0);
  });
});

describe("faktory-place-order: the bonding-curve dex", () => {
  it("BUY and SELL reach the dex, and a non-admin is refused", () => {
    funded();
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "faktory-place-order",
      [DEX, FAK, Cl.stringAscii("zz-fak"), Cl.uint(4_000), op("00"), Cl.none(), Cl.none()], OWNER).result)).toMatch(/^\(ok /);
    expect(ro("zz-dex", "get-buys")).toBeUint(1);

    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "faktory-place-order",
      [DEX, FAK, Cl.stringAscii("zz-fak"), Cl.uint(4_000), op("01"), Cl.none(), Cl.none()], OWNER).result)).toMatch(/^\(ok /);
    expect(ro("zz-dex", "get-sells")).toBeUint(1);

    expect(simnet.callPublicFn(WALLET, "faktory-place-order",
      [DEX, FAK, Cl.stringAscii("zz-fak"), Cl.uint(1_000), op("00"), Cl.none(), Cl.none()],
      RANDOM).result).toBeErr(Cl.uint(E.UNAUTH));
  });

  it("works on the passkey path and pays a station", () => {
    funded();
    const g0 = gasCounter();
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "faktory-place-order",
      [DEX, FAK, Cl.stringAscii("zz-fak"), Cl.uint(2_000), op("00"),
       Cl.some(sign(topic("faktory-place-order", { "auth-id": Cl.uint(next()), dex: DEX,
         amount: Cl.uint(2_000), opcode: op("00") }), id)), Cl.some(stationCV)], RELAYER).result)).toMatch(/^\(ok /);
    expect(gasCounter() - g0).toBe(BigInt(GAS_FEE));
  });
});

describe("faktory-process: prelaunch seats and refunds", () => {
  it("BUY-SEATS (0x02) buys the seat count", () => {
    funded();
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "faktory-process",
      [PRE, Cl.uint(3), op("02"), Cl.none(), Cl.none()], OWNER).result)).toMatch(/^\(ok /);
    expect(ro("zz-pre", "get-seats")).toBeUint(3);
  });

  it("REFUND (0x03) refunds instead", () => {
    funded();
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "faktory-process",
      [PRE, Cl.uint(0), op("03"), Cl.none(), Cl.none()], OWNER).result)).toMatch(/^\(ok /);
    expect(ro("zz-pre", "get-refunds")).toBeUint(1);
    expect(ro("zz-pre", "get-seats"), "no seats bought on the refund branch").toBeUint(0);
  });

  it("passkey path with a station, and a non-admin refused", () => {
    funded();
    expect(simnet.callPublicFn(WALLET, "faktory-process",
      [PRE, Cl.uint(1), op("02"), Cl.none(), Cl.none()], RANDOM).result)
      .toBeErr(Cl.uint(E.UNAUTH));
    const g0 = gasCounter();
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "faktory-process",
      [PRE, Cl.uint(2), op("02"),
       Cl.some(sign(topic("faktory-process", { "auth-id": Cl.uint(next()), pre: PRE,
         "seat-count": Cl.uint(2), opcode: op("02") }), id)), Cl.some(stationCV)], RELAYER).result)).toMatch(/^\(ok /);
    expect(gasCounter() - g0).toBe(BigInt(GAS_FEE));
  });
});

describe("faktory-process-claim and faktory-fee-airdrop", () => {
  it("claims the prelaunch allocation", () => {
    funded();
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "faktory-process-claim",
      [PRE, FAK, Cl.none(), Cl.none()], OWNER).result)).toMatch(/^\(ok /);
    expect(ro("zz-pre", "get-claims")).toBeUint(1);
    expect(simnet.callPublicFn(WALLET, "faktory-process-claim",
      [PRE, FAK, Cl.none(), Cl.none()], RANDOM).result).toBeErr(Cl.uint(E.UNAUTH));
  });

  it("triggers the fee airdrop, on both factors", () => {
    funded();
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "faktory-fee-airdrop",
      [PRE, Cl.none(), Cl.none()], OWNER).result)).toMatch(/^\(ok /);
    expect(ro("zz-pre", "get-airdrops")).toBeUint(1);
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "faktory-fee-airdrop",
      [PRE, Cl.some(sign(topic("faktory-fee-airdrop",
        { "auth-id": Cl.uint(next()), pre: PRE }), id)), Cl.none()], RELAYER).result)).toMatch(/^\(ok /);
    expect(ro("zz-pre", "get-airdrops")).toBeUint(2);
  });

  it("claim on the passkey path pays a station", () => {
    funded();
    const g0 = gasCounter();
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "faktory-process-claim",
      [PRE, FAK, Cl.some(sign(topic("faktory-process-claim",
        { "auth-id": Cl.uint(next()), pre: PRE }), id)), Cl.some(stationCV)], RELAYER).result)).toMatch(/^\(ok /);
    expect(gasCounter() - g0).toBe(BigInt(GAS_FEE));
  });
});

// NOTE: v17 REMOVED faktory-burn-bob (present in v16). Its two tests are dropped.

describe("faktory-nft-execute: the five marketplace opcodes", () => {
  const call = (opcode: string, sender = OWNER, sig: any = Cl.none(), gas: any = Cl.none()) =>
    simnet.callPublicFn(WALLET, "faktory-nft-execute",
      [MKT, Cl.uint(1), NFT, Cl.stringAscii("zz-nft"), sbtcCV, Cl.stringAscii("sbtc-token"),
       Cl.uint(1_000), op(opcode), sig, gas], sender);

  it("dispatches LIST, BUY, UNLIST, UPDATE-PRICE and UPDATE-FT", () => {
    funded();
    for (const [opcode, expected] of [["00", "list"], ["01", "buy"], ["02", "unlist"],
                                      ["03", "price"], ["04", "ft"]] as [string, string][]) {
      expect(Cl.prettyPrint(call(opcode).result), `opcode ${opcode}`).toMatch(/^\(ok /);
      expect(Cl.prettyPrint(ro("zz-nftmarket", "get-last")), `opcode ${opcode} branch`)
        .toContain(expected);
    }
  });

  it("refuses a non-admin, and is NOT gated by the token lock", () => {
    funded();
    expect(call("00", RANDOM).result).toBeErr(Cl.uint(E.UNAUTH));
    simnet.callPublicFn(WALLET, "toggle-token-lock", [Cl.bool(true), Cl.none(), Cl.none()], OWNER);
    expect(Cl.prettyPrint(call("00", RELAYER,
      Cl.some(sign(topic("faktory-nft-execute", { "auth-id": Cl.uint(next()),
        marketplace: MKT, "token-id": Cl.uint(1), "ft-contract": sbtcCV,
        price: Cl.uint(1_000), opcode: op("00") }), id))).result),
      "NFT trading is not frozen by the token lock").toMatch(/^\(ok /);
  });

  it("works on the passkey path with a gas station", () => {
    funded();
    const g0 = gasCounter();
    expect(Cl.prettyPrint(call("00", RELAYER,
      Cl.some(sign(topic("faktory-nft-execute", { "auth-id": Cl.uint(next()),
        marketplace: MKT, "token-id": Cl.uint(1), "ft-contract": sbtcCV,
        price: Cl.uint(1_000), opcode: op("00") }), id)),
      Cl.some(stationCV)).result)).toMatch(/^\(ok /);
    expect(gasCounter() - g0).toBe(BigInt(GAS_FEE));
  });
});

describe("wager-deposit: the success path", () => {
  // Two prerequisites in game-wager-v2-4, both reachable:
  //   1. the token must be whitelisted there (set-token-whitelist, its DEPLOYER only)
  //   2. the wallet must be the registered wallet for the pubkey, because v16 asserts
  //      get-registered-wallet(pubkey) == current-contract before depositing
  // (2) needs a SIP-018 signature over game-wager's OWN domain -- a different domain
  // from the wallet's -- and game-wager then calls back into the wallet's
  // is-admin-pubkey, so the passkey must belong to a live admin. It accepts both
  // fak.fun and fakfun.com as rp-id, so the same test signer works.
  const WAGER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK.game-wager-v2-4";
  const FT = Cl.contractPrincipal(DEPLOYER, "zz-ft");

  function registerWalletWithWager() {
    const crypto = require("node:crypto");
    const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest();
    const cvHash = (cv: any) => sha256(Buffer.from(Cl.serialize(cv), "hex"));
    const SIP018 = Buffer.from("534950303138", "hex");
    const dom = cvHash(Cl.tuple({
      "chain-id": Cl.uint(2147483648),
      contract: Cl.contractPrincipal("SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK", "game-wager-v2-4"),
      name: Cl.stringAscii("game-wager"), version: Cl.stringAscii("2.0.0"),
    }));
    const struct = cvHash(Cl.tuple({
      "auth-id": Cl.uint(1), topic: Cl.stringAscii("register-wallet"),
      wallet: Cl.contractPrincipal(WD, "fakfun-wallet-v17"),
    }));
    const challenge = sha256(Buffer.concat([SIP018, dom, struct]));
    const { signChallengeWithRpId } = require("../lib-webauthn-test-signer.mjs");
    return { challenge, signChallengeWithRpId };
  }

  it("whitelists the token, registers the wallet, then deposits", () => {
    seated();
    simnet.callPublicFn(`${DEPLOYER}.zz-ft`, "mint",
      [Cl.uint(1_000_000), Cl.principal(WALLET)], DEPLOYER);

    // 1. the token has to be whitelisted by game-wager's own deployer
    expect(simnet.callPublicFn(WAGER, "set-token-whitelist",
      [Cl.principal(`${DEPLOYER}.zz-ft`), Cl.bool(true)],
      "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK").result).toBeOk(Cl.bool(true));

    // without registration the wallet refuses: its own assert, before any transfer
    expect(simnet.callPublicFn(WALLET, "wager-deposit",
      [FT, Cl.stringAscii("zz-ft"), Cl.uint(5_000), pubkeyCV, Cl.none(), Cl.none()],
      OWNER).result, "unregistered pubkey").toBeErr(Cl.uint(E.UNAUTH));

    // 2. register the wallet against the pubkey, signing game-wager's own domain
    const { challenge, signChallengeWithRpId } = registerWalletWithWager();
    const s = signChallengeWithRpId(challenge, key.privKey, RP_ID);
    expect(simnet.callPublicFn(WAGER, "register-wallet",
      [Cl.contractPrincipal(WD, "fakfun-wallet-v17"),
       Cl.tuple({ "auth-id": Cl.uint(1), pubkey: pubkeyCV,
         signature: Cl.bufferFromHex(strip(s.signatureHex)),
         "authenticator-data": Cl.bufferFromHex(strip(s.authenticatorDataHex)),
         "client-data-prefix": Cl.bufferFromHex(strip(s.clientDataPrefixHex)),
         "client-data-suffix": Cl.bufferFromHex(strip(s.clientDataSuffixHex)) })],
      RELAYER).result).toBeOk(Cl.bool(true));
    expect(simnet.callReadOnlyFn(WAGER, "get-registered-wallet", [pubkeyCV], OWNER).result)
      .toBeSome(Cl.contractPrincipal(WD, "fakfun-wallet-v17"));

    // 3. now the deposit goes through, under (with-ft token token-name amount)
    const before = Cl.prettyPrint(simnet.callReadOnlyFn(`${DEPLOYER}.zz-ft`, "get-balance",
      [Cl.principal(WALLET)], OWNER).result);
    expect(simnet.callPublicFn(WALLET, "wager-deposit",
      [FT, Cl.stringAscii("zz-ft"), Cl.uint(5_000), pubkeyCV, Cl.none(), Cl.none()],
      OWNER).result).toBeOk(Cl.bool(true));
    const after = Cl.prettyPrint(simnet.callReadOnlyFn(`${DEPLOYER}.zz-ft`, "get-balance",
      [Cl.principal(WALLET)], OWNER).result);
    expect(after, "the wallet's token balance fell").not.toBe(before);
  });

  it("also works on the passkey path with a gas station", () => {
    seated(); fundSBTC();
    simnet.callPublicFn(`${DEPLOYER}.zz-ft`, "mint",
      [Cl.uint(1_000_000), Cl.principal(WALLET)], DEPLOYER);
    simnet.callPublicFn(WAGER, "set-token-whitelist",
      [Cl.principal(`${DEPLOYER}.zz-ft`), Cl.bool(true)],
      "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK");
    const { challenge, signChallengeWithRpId } = registerWalletWithWager();
    const s = signChallengeWithRpId(challenge, key.privKey, RP_ID);
    simnet.callPublicFn(WAGER, "register-wallet",
      [Cl.contractPrincipal(WD, "fakfun-wallet-v17"),
       Cl.tuple({ "auth-id": Cl.uint(1), pubkey: pubkeyCV,
         signature: Cl.bufferFromHex(strip(s.signatureHex)),
         "authenticator-data": Cl.bufferFromHex(strip(s.authenticatorDataHex)),
         "client-data-prefix": Cl.bufferFromHex(strip(s.clientDataPrefixHex)),
         "client-data-suffix": Cl.bufferFromHex(strip(s.clientDataSuffixHex)) })], RELAYER);

    const g0 = gasCounter();
    expect(simnet.callPublicFn(WALLET, "wager-deposit",
      [FT, Cl.stringAscii("zz-ft"), Cl.uint(2_000), pubkeyCV,
       Cl.some(sign(topic("wager-deposit", { "auth-id": Cl.uint(next()),
         amount: Cl.uint(2_000), pubkey: pubkeyCV, token: FT }), id)),
       Cl.some(stationCV)], RELAYER).result).toBeOk(Cl.bool(true));
    expect(gasCounter() - g0).toBe(BigInt(GAS_FEE));
  });
});

describe("faktory: the last branches line coverage flagged", () => {
  it("an INVALID opcode is refused by faktory-execute and faktory-nft-execute", () => {
    // both dispatchers fall through to err-invalid-operation when the first byte
    // matches none of their cases -- the only guard against a malformed opcode
    funded();
    expect(simnet.callPublicFn(WALLET, "faktory-execute",
      [POOL, Cl.uint(1_000), op("09"), sbtcCV, Cl.stringAscii("sbtc-token"),
       Cl.none(), Cl.none()], OWNER).result).toBeErr(Cl.uint(E.INVALID_OP));
    expect(simnet.callPublicFn(WALLET, "faktory-nft-execute",
      [MKT, Cl.uint(1), NFT, Cl.stringAscii("zz-nft"), sbtcCV,
       Cl.stringAscii("sbtc-token"), Cl.uint(1_000), op("09"), Cl.none(), Cl.none()],
      OWNER).result).toBeErr(Cl.uint(E.INVALID_OP));
  });

  // NOTE: v17 REMOVED faktory-burn-bob (present in v16); its passkey-path test dropped.

  it("faktory-execute-limit and faktory-fee-airdrop pay a station", () => {
    funded();
    const h = simnet.burnBlockHeight;
    let g0 = gasCounter();
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "faktory-execute-limit",
      [POOL, Cl.uint(5_000), op("00"), sbtcCV, Cl.stringAscii("sbtc-token"),
       Cl.uint(1), Cl.uint(h + 100),
       sign(topic("faktory-execute-limit", { "auth-id": Cl.uint(next()), pool: POOL,
         amount: Cl.uint(5_000), opcode: op("00"), "limit-out": Cl.uint(1),
         "expiry-burn-block": Cl.uint(h + 100) }), id), Cl.some(stationCV)],
      RELAYER).result)).toMatch(/^\(ok /);
    expect(gasCounter() - g0).toBe(BigInt(GAS_FEE));

    g0 = gasCounter();
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "faktory-fee-airdrop",
      [PRE, Cl.some(sign(topic("faktory-fee-airdrop",
        { "auth-id": Cl.uint(next()), pre: PRE }), id)), Cl.some(stationCV)],
      RELAYER).result)).toMatch(/^\(ok /);
    expect(gasCounter() - g0).toBe(BigInt(GAS_FEE));
  });

  it("place-order, process and process-claim on the passkey path WITHOUT a station", () => {
    // the (match gas ... true) else-arms on the three remaining faktory paths
    funded();
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "faktory-place-order",
      [DEX, FAK, Cl.stringAscii("zz-fak"), Cl.uint(1_000), op("00"),
       Cl.some(sign(topic("faktory-place-order", { "auth-id": Cl.uint(next()), dex: DEX,
         amount: Cl.uint(1_000), opcode: op("00") }), id)), Cl.none()],
      RELAYER).result)).toMatch(/^\(ok /);
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "faktory-process",
      [PRE, Cl.uint(1), op("02"),
       Cl.some(sign(topic("faktory-process", { "auth-id": Cl.uint(next()), pre: PRE,
         "seat-count": Cl.uint(1), opcode: op("02") }), id)), Cl.none()],
      RELAYER).result)).toMatch(/^\(ok /);
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "faktory-process-claim",
      [PRE, FAK, Cl.some(sign(topic("faktory-process-claim",
        { "auth-id": Cl.uint(next()), pre: PRE }), id)), Cl.none()],
      RELAYER).result)).toMatch(/^\(ok /);
    expect(gasCounter(), "nothing charged without a station").toBe(0n);
  });

  it("veto, sip010, stake and unstake on the passkey path WITHOUT a station", () => {
    funded();
    // veto needs a queued op
    simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(200_000_000), Cl.principal(RANDOM), Cl.none(), Cl.none(), Cl.none()], OWNER);
    expect(simnet.callPublicFn(WALLET, "veto-operation",
      [Cl.uint(0), Cl.some(sign(topic("veto-operation",
        { "auth-id": Cl.uint(next()), "op-id": Cl.uint(0) }), id)), Cl.none()],
      RELAYER).result).toBeOk(Cl.bool(true));
    // an OVER-threshold sip010 on the passkey queues, taking the other match arm
    expect(simnet.callPublicFn(WALLET, "sip010-transfer",
      [Cl.uint(200_000), Cl.principal(RANDOM), Cl.none(), sbtcCV,
       Cl.stringAscii("sbtc-token"),
       Cl.some(sign(topic("sip010-transfer", { "auth-id": Cl.uint(next()),
         amount: Cl.uint(200_000), recipient: Cl.principal(RANDOM), memo: Cl.none(),
         sip010: sbtcCV }), id)), Cl.none()], RELAYER).result).toBeOk(Cl.bool(true));
    expect(gasCounter()).toBe(0n);
  });
});

describe("faktory: invalid opcodes on the remaining dispatchers", () => {
  it("execute-limit, place-order and process all reject a bad opcode", () => {
    funded();
    const h = simnet.burnBlockHeight;
    expect(simnet.callPublicFn(WALLET, "faktory-execute-limit",
      [POOL, Cl.uint(1_000), op("09"), sbtcCV, Cl.stringAscii("sbtc-token"),
       Cl.uint(1), Cl.uint(h + 100),
       sign(topic("faktory-execute-limit", { "auth-id": Cl.uint(next()), pool: POOL,
         amount: Cl.uint(1_000), opcode: op("09"), "limit-out": Cl.uint(1),
         "expiry-burn-block": Cl.uint(h + 100) }), id), Cl.none()],
      RELAYER).result).toBeErr(Cl.uint(E.INVALID_OP));

    expect(simnet.callPublicFn(WALLET, "faktory-place-order",
      [DEX, FAK, Cl.stringAscii("zz-fak"), Cl.uint(1_000), op("09"), Cl.none(), Cl.none()],
      OWNER).result).toBeErr(Cl.uint(E.INVALID_OP));

    expect(simnet.callPublicFn(WALLET, "faktory-process",
      [PRE, Cl.uint(1), op("09"), Cl.none(), Cl.none()], OWNER).result)
      .toBeErr(Cl.uint(E.INVALID_OP));
  });

  it("the last no-gas match arms: sip010 under threshold, stake, unstake", () => {
    funded(); registerSigner();
    // an UNDER-threshold sip010 on the passkey, no station
    expect(simnet.callPublicFn(WALLET, "sip010-transfer",
      [Cl.uint(1_000), Cl.principal(RANDOM), Cl.none(), sbtcCV, Cl.stringAscii("sbtc-token"),
       Cl.some(sign(topic("sip010-transfer", { "auth-id": Cl.uint(next()),
         amount: Cl.uint(1_000), recipient: Cl.principal(RANDOM), memo: Cl.none(),
         sip010: sbtcCV }), id)), Cl.none()], RELAYER).result).toBeOk(Cl.bool(true));

    // stake on the passkey, no station
    expect(simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(1_000_000_000), Cl.some(sign(topic("stake-stx-juice-pox5",
        { "auth-id": Cl.uint(next()), "amount-ustx": Cl.uint(1_000_000_000) }), id)),
       Cl.none()], RELAYER).result).toBeOk(Cl.bool(true));

    // unstake on the passkey, no station
    expect(simnet.callPublicFn(WALLET, "unstake",
      [Cl.some(sign(topic("unstake-stx-juice", { "auth-id": Cl.uint(next()) }), id)),
       Cl.none()], RELAYER).result).toBeOk(Cl.bool(true));
    expect(gasCounter(), "no station, nothing charged").toBe(0n);
  });
});
