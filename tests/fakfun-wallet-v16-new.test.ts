// fakfun-wallet-v16-new.test.ts -- the surface v16 has that juice-safe-v6 does not.
//
// Run: npx vitest run tests/fakfun-wallet-v16-new.test.ts -- --manifest tests/cl-v16/Clarinet.toml
//
// Six functions with no v6 equivalent, so nothing carries over and every scenario is
// written from the contract:
//   whitelist-extension / execute-pending-whitelist / remove-extension-whitelist /
//   extension-call, veto-pending-init, wager-deposit
//
// THE HEADLINE: extension-call invokes the extension under
// (with-all-assets-unsafe) (v16:848). A whitelisted extension can therefore move
// ANYTHING the wallet holds. The whitelist is not a convenience list, it is a grant of
// full custody, and it is the only thing standing between an extension and the funds.
// tests/cl-v16/contracts/zz-extension.clar is deliberately hostile so that claim is
// demonstrated rather than asserted.
import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";
import {
  D, WALLET, OWNER, RANDOM, RELAYER, DEPLOYER, NEW_OWNER,
  E, MIN_COOLDOWN, seated, deployV16, fundSTX, fundSBTC, sign, topic,
  extCV, ftCV, sbtcCV, stationCV, pendingOp, pubkeyCV, FAKFUN_DEPLOYER, CORE,
} from "./v16-helpers";

let id = 200;
const next = () => ++id;
const EXT = `${DEPLOYER}.zz-extension`;
const isWhitelisted = (p: any) =>
  simnet.callReadOnlyFn(WALLET, "is-extension-whitelisted", [p], OWNER).result;
const extCalls = () =>
  simnet.callReadOnlyFn(EXT, "get-calls", [], OWNER).result;

/** whitelist an extension end to end: admin proposes, passkey executes after cooldown */
function whitelist(opId = 0) {
  expect(simnet.callPublicFn(WALLET, "whitelist-extension",
    [Cl.principal(EXT)], OWNER).result).toBeOk(Cl.uint(opId));
  simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
  expect(simnet.callPublicFn(WALLET, "execute-pending-whitelist",
    [Cl.uint(opId), sign(topic("whitelist-extension", { "auth-id": Cl.uint(next()),
      "op-id": Cl.uint(opId), extension: Cl.principal(EXT) }), id), Cl.none()],
    RELAYER).result).toBeOk(Cl.bool(true));
  expect(isWhitelisted(Cl.principal(EXT))).toBeBool(true);
}

describe("v16 new: the extension whitelist is two-step", () => {
  it("onboard pre-whitelists xtrata-inscribe and nothing else", () => {
    seated();
    expect(isWhitelisted(Cl.contractPrincipal(D, "xtrata-inscribe"))).toBeBool(true);
    expect(isWhitelisted(Cl.principal(EXT))).toBeBool(false);
  });

  it("admin proposes, the passkey executes after the cooldown", () => {
    seated();
    expect(simnet.callPublicFn(WALLET, "whitelist-extension",
      [Cl.principal(EXT)], RANDOM).result).toBeErr(Cl.uint(E.UNAUTH));
    expect(simnet.callPublicFn(WALLET, "whitelist-extension",
      [Cl.principal(EXT)], OWNER).result).toBeOk(Cl.uint(0));
    expect(Cl.prettyPrint(pendingOp(0))).toContain("whitelist-ext");
    // still not whitelisted until the second factor lands
    expect(isWhitelisted(Cl.principal(EXT))).toBeBool(false);

    expect(simnet.callPublicFn(WALLET, "execute-pending-whitelist",
      [Cl.uint(0), sign(topic("whitelist-extension", { "auth-id": Cl.uint(next()),
        "op-id": Cl.uint(0), extension: Cl.principal(EXT) }), id), Cl.none()],
      RELAYER).result, "early").toBeErr(Cl.uint(E.COOLDOWN_NOT_PASSED));

    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
    // a signature bound to a DIFFERENT extension must not work
    expect(simnet.callPublicFn(WALLET, "execute-pending-whitelist",
      [Cl.uint(0), sign(topic("whitelist-extension", { "auth-id": Cl.uint(next()),
        "op-id": Cl.uint(0), extension: Cl.principal(RANDOM) }), id), Cl.none()],
      RELAYER).result, "wrong extension in sig").toBeErr(Cl.uint(E.BADSIG));

    expect(simnet.callPublicFn(WALLET, "execute-pending-whitelist",
      [Cl.uint(0), sign(topic("whitelist-extension", { "auth-id": Cl.uint(next()),
        "op-id": Cl.uint(0), extension: Cl.principal(EXT) }), id), Cl.none()],
      RELAYER).result).toBeOk(Cl.bool(true));
    expect(isWhitelisted(Cl.principal(EXT))).toBeBool(true);
  });

  it("a whitelist op cannot be executed twice, and veto kills it", () => {
    seated();
    whitelist(0);
    expect(simnet.callPublicFn(WALLET, "execute-pending-whitelist",
      [Cl.uint(0), sign(topic("whitelist-extension", { "auth-id": Cl.uint(next()),
        "op-id": Cl.uint(0), extension: Cl.principal(EXT) }), id), Cl.none()],
      RELAYER).result).toBeErr(Cl.uint(E.ALREADY_EXECUTED));

    // a second proposal, vetoed
    expect(simnet.callPublicFn(WALLET, "whitelist-extension",
      [Cl.principal(RANDOM)], OWNER).result).toBeOk(Cl.uint(1));
    expect(simnet.callPublicFn(WALLET, "veto-operation",
      [Cl.uint(1), Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
    expect(simnet.callPublicFn(WALLET, "execute-pending-whitelist",
      [Cl.uint(1), sign(topic("whitelist-extension", { "auth-id": Cl.uint(next()),
        "op-id": Cl.uint(1), extension: Cl.principal(RANDOM) }), id), Cl.none()],
      RELAYER).result).toBeErr(Cl.uint(E.VETOED));
  });
});

describe("v16 new: extension-call and the blast radius of a whitelist", () => {
  it("refuses a non-whitelisted extension with u4011", () => {
    seated();
    expect(simnet.callPublicFn(WALLET, "extension-call",
      [extCV, Cl.bufferFromHex("00"), Cl.none(), Cl.none()], OWNER).result)
      .toBeErr(Cl.uint(E.NOT_WHITELISTED));
    expect(extCalls()).toBeUint(0);   // never reached the extension at all
  });

  it("calls a whitelisted extension on the admin path and the passkey path", () => {
    seated(); whitelist(0);
    expect(simnet.callPublicFn(WALLET, "extension-call",
      [extCV, Cl.bufferFromHex("00"), Cl.none(), Cl.none()], OWNER).result)
      .toBeOk(Cl.bool(true));
    expect(extCalls()).toBeUint(1);
    expect(simnet.callPublicFn(WALLET, "extension-call",
      [extCV, Cl.bufferFromHex("00"),
       Cl.some(sign(topic("extension-call", { "auth-id": Cl.uint(next()),
         extension: Cl.principal(EXT), payload: Cl.bufferFromHex("00") }), id)),
       Cl.none()], RELAYER).result).toBeOk(Cl.bool(true));
    expect(extCalls()).toBeUint(2);
  });

  it("a WHITELISTED extension can drain STX and sBTC: with-all-assets-unsafe", () => {
    // This is not a bug report, it is the documented blast radius. Whitelisting is
    // equivalent to handing over custody, so the two-step + passkey gate on
    // whitelisting is the real control and must never be weakened.
    seated(); whitelist(0); fundSTX(); fundSBTC();
    const stxBefore = simnet.getAssetsMap().get("STX")?.get(WALLET) ?? 0n;
    expect(simnet.callPublicFn(WALLET, "extension-call",
      [extCV, Cl.bufferFromHex("01"), Cl.none(), Cl.none()], OWNER).result)
      .toBeOk(Cl.bool(true));
    const stxAfter = simnet.getAssetsMap().get("STX")?.get(WALLET) ?? 0n;
    expect(stxAfter, "the extension moved STX out of the wallet").toBeLessThan(stxBefore);
    expect(simnet.callReadOnlyFn(EXT, "get-stolen", [], OWNER).result).toBeUint(1_000_000);

    expect(simnet.callPublicFn(WALLET, "extension-call",
      [extCV, Cl.bufferFromHex("02"), Cl.none(), Cl.none()], OWNER).result)
      .toBeOk(Cl.bool(true));
    expect(simnet.callReadOnlyFn(EXT, "get-stolen", [], OWNER).result).toBeUint(1_001_000);
  });

  it("the token lock blocks the passkey path into an extension", () => {
    seated(); whitelist(0);
    simnet.callPublicFn(WALLET, "toggle-token-lock", [Cl.bool(true), Cl.none(), Cl.none()], OWNER);
    expect(simnet.callPublicFn(WALLET, "extension-call",
      [extCV, Cl.bufferFromHex("01"),
       Cl.some(sign(topic("extension-call", { "auth-id": Cl.uint(next()),
         extension: Cl.principal(EXT), payload: Cl.bufferFromHex("01") }), id)),
       Cl.none()], RELAYER).result).toBeErr(Cl.uint(E.TOKEN_LOCKED));
  });

  it("remove-extension-whitelist revokes, and a later call is refused", () => {
    seated(); whitelist(0);
    expect(simnet.callPublicFn(WALLET, "remove-extension-whitelist",
      [Cl.principal(EXT), Cl.none(), Cl.none()], RANDOM).result).toBeErr(Cl.uint(E.UNAUTH));
    expect(simnet.callPublicFn(WALLET, "remove-extension-whitelist",
      [Cl.principal(EXT), Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
    expect(isWhitelisted(Cl.principal(EXT))).toBeBool(false);
    expect(simnet.callPublicFn(WALLET, "extension-call",
      [extCV, Cl.bufferFromHex("00"), Cl.none(), Cl.none()], OWNER).result)
      .toBeErr(Cl.uint(E.NOT_WHITELISTED));
  });

  it("removal works on the passkey path too", () => {
    seated(); whitelist(0);
    expect(simnet.callPublicFn(WALLET, "remove-extension-whitelist",
      [Cl.principal(EXT), Cl.some(sign(topic("remove-extension-whitelist",
        { "auth-id": Cl.uint(next()), extension: Cl.principal(EXT) }), id)), Cl.none()],
      RELAYER).result).toBeOk(Cl.bool(true));
    expect(isWhitelisted(Cl.principal(EXT))).toBeBool(false);
  });
});

describe("v16 new: veto-pending-init", () => {
  // the escape hatch on the three-step admin seating: the passkey can kill a proposal
  // before it is confirmed, which is what saves a wallet whose admin was proposed by
  // mistake or under duress.
  function proposedNotConfirmed() {
    deployV16();
    expect(simnet.callPublicFn(CORE, "set-verified-contract",
      [Cl.contractPrincipal(D, "fakfun-wallet-v16"), Cl.none()], D).result).toBeOk(Cl.bool(true));
    expect(simnet.callPublicFn(WALLET, "onboard", [pubkeyCV], FAKFUN_DEPLOYER).result)
      .toBeOk(Cl.bool(true));
    expect(simnet.callPublicFn(WALLET, "propose-admin-with-signature",
      [Cl.principal(OWNER), sign(topic("add-admin",
        { "auth-id": Cl.uint(next()), "new-admin": Cl.principal(OWNER) }), id), Cl.none()],
      RELAYER).result).toBeOk(Cl.bool(true));
  }

  it("vetoes a proposal so it can never be confirmed", () => {
    proposedNotConfirmed();
    expect(simnet.callPublicFn(WALLET, "veto-pending-init",
      [sign(topic("veto-init", { "auth-id": Cl.uint(next()),
        "new-admin": Cl.principal(OWNER) }), id), Cl.none()], RELAYER).result)
      .toBeOk(Cl.bool(true));
    // accepting after a veto is refused
    expect(simnet.callPublicFn(WALLET, "accept-admin-proposal", [], OWNER).result)
      .toBeErr(Cl.uint(E.NO_PENDING_INIT));
  });

  it("refuses a veto when nothing is pending", () => {
    deployV16();
    simnet.callPublicFn(CORE, "set-verified-contract",
      [Cl.contractPrincipal(D, "fakfun-wallet-v16"), Cl.none()], D);
    simnet.callPublicFn(WALLET, "onboard", [pubkeyCV], FAKFUN_DEPLOYER);
    expect(simnet.callPublicFn(WALLET, "veto-pending-init",
      [sign(topic("veto-init", { "auth-id": Cl.uint(next()),
        "new-admin": Cl.principal(OWNER) }), id), Cl.none()], RELAYER).result)
      .toBeErr(Cl.uint(E.NO_PENDING_INIT));
  });

  it("after a veto a fresh proposal can be made and seated", () => {
    proposedNotConfirmed();
    simnet.callPublicFn(WALLET, "veto-pending-init",
      [sign(topic("veto-init", { "auth-id": Cl.uint(next()),
        "new-admin": Cl.principal(OWNER) }), id), Cl.none()], RELAYER);
    expect(simnet.callPublicFn(WALLET, "propose-admin-with-signature",
      [Cl.principal(NEW_OWNER), sign(topic("add-admin",
        { "auth-id": Cl.uint(next()), "new-admin": Cl.principal(NEW_OWNER) }), id), Cl.none()],
      RELAYER).result).toBeOk(Cl.bool(true));
    expect(simnet.callPublicFn(WALLET, "accept-admin-proposal", [], NEW_OWNER).result)
      .toBeOk(Cl.bool(true));
  });
});

describe("v16 new: wager-deposit", () => {
  it("is admin-gated and moves the token", () => {
    seated(); fundSBTC();
    simnet.callPublicFn(`${DEPLOYER}.zz-ft`, "mint",
      [Cl.uint(1_000_000), Cl.principal(WALLET)], DEPLOYER);
    const r = simnet.callPublicFn(WALLET, "wager-deposit",
      [ftCV, Cl.stringAscii("zz-ft"), Cl.uint(5_000), pubkeyCV, Cl.none(), Cl.none()], RANDOM);
    expect(r.result, "non-admin").toBeErr(Cl.uint(E.UNAUTH));
  });
});
