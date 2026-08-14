// fakfun-wallet-v17-parity.test.ts -- the surface v16 SHARES with juice-safe-v6.
//
// Run: npx vitest run tests/fakfun-wallet-v17-parity.test.ts -- --manifest tests/cl-v17/Clarinet.toml
//
// A mirrored suite rather than a diff test: the same scenarios that hold for v6 are
// re-run against v16, so any behavioural drift shows up as a failure instead of going
// unnoticed. Differences found are recorded inline.
//
// Two structural differences shape everything here:
//   * onboard takes ONLY the pubkey. Thresholds and cooldown come from the contract's
//     own defaults, and the admin is seated afterwards by the three-step flow.
//   * v16 has NO passkey fast path: no execute-pending-*-now variants and
//     passkey-created appears nowhere, so v6's u4003 self-approval rule does not exist.
import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";
import {
  D, WD, WALLET, OWNER, RANDOM, RELAYER, RECIPIENT, NEW_OWNER, DEPLOYER,
  E, MIN_COOLDOWN, STX_THRESHOLD, SBTC_THRESHOLD,
  seated, fundSTX, fundSBTC, registerSigner, sign, topic,
  sbtcCV, nftCV, stationCV, poxAddr, pendingOp, gasCounter,
} from "./v17-helpers";

let id = 100;
const next = () => ++id;

describe("v16 parity: the wallet's own defaults", () => {
  it("starts at the documented thresholds and the u144 cooldown", () => {
    seated();
    expect(simnet.getDataVar(WALLET, "wallet-config")).toBeTuple({
      "stx-threshold": Cl.uint(STX_THRESHOLD), "sbtc-threshold": Cl.uint(SBTC_THRESHOLD),
      "cooldown-period": Cl.uint(MIN_COOLDOWN), "config-signaled-at": Cl.none(),
    });
    // recovery is NOT designated at onboard, unlike the safe which mandates it
    expect(simnet.getDataVar(WALLET, "recovery-address"))
      .toBePrincipal("SP000000000000000000002Q6VF78");
  });
});

describe("v16 parity: token lock freezes the passkey, not the admin", () => {
  it("ON accepts a passkey, OFF requires the admin", () => {
    // deliberate asymmetry, same as the safe: a stolen passkey can LOCK the wallet
    // but must not be able to UNLOCK it. juice-safe-v6 and v16 both gate the
    // enabled=false branch on (is-admin-calling tx-sender) (v16:386).
    seated();
    expect(simnet.callPublicFn(WALLET, "toggle-token-lock",
      [Cl.bool(true), Cl.some(sign(topic("toggle-token-lock",
        { "auth-id": Cl.uint(next()), enabled: Cl.bool(true) }), id)), Cl.none()],
      RELAYER).result, "lock ON via passkey").toBeOk(Cl.bool(true));
    expect(simnet.callReadOnlyFn(WALLET, "get-token-lock-enabled", [], OWNER).result)
      .toBeBool(true);

    // a relayer holding the passkey cannot unlock
    expect(simnet.callPublicFn(WALLET, "toggle-token-lock",
      [Cl.bool(false), Cl.some(sign(topic("toggle-token-lock",
        { "auth-id": Cl.uint(next()), enabled: Cl.bool(false) }), id)), Cl.none()],
      RELAYER).result, "unlock via passkey must fail").toBeErr(Cl.uint(E.UNAUTH));

    // only the admin can
    expect(simnet.callPublicFn(WALLET, "toggle-token-lock",
      [Cl.bool(false), Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
    expect(simnet.callReadOnlyFn(WALLET, "get-token-lock-enabled", [], OWNER).result)
      .toBeBool(false);
    expect(simnet.callPublicFn(WALLET, "toggle-token-lock",
      [Cl.bool(true), Cl.none(), Cl.none()], RANDOM).result).toBeErr(Cl.uint(E.UNAUTH));
  });

  it("blocks the passkey on the asset paths and leaves the admin alone", () => {
    seated(); fundSTX(); fundSBTC();
    simnet.callPublicFn(WALLET, "toggle-token-lock", [Cl.bool(true), Cl.none(), Cl.none()], OWNER);
    expect(simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(1_000), Cl.principal(RECIPIENT), Cl.none(),
       Cl.some(sign(topic("stx-transfer", { "auth-id": Cl.uint(next()), amount: Cl.uint(1_000),
         recipient: Cl.principal(RECIPIENT), memo: Cl.none() }), id)), Cl.none()],
      RELAYER).result, "stx passkey").toBeErr(Cl.uint(E.TOKEN_LOCKED));
    expect(simnet.callPublicFn(WALLET, "sip010-transfer",
      [Cl.uint(2_000), Cl.principal(RECIPIENT), Cl.none(), sbtcCV, Cl.stringAscii("sbtc-token"),
       Cl.some(sign(topic("sip010-transfer", { "auth-id": Cl.uint(next()), amount: Cl.uint(2_000),
         recipient: Cl.principal(RECIPIENT), memo: Cl.none(), sip010: sbtcCV }), id)), Cl.none()],
      RELAYER).result, "sip010 passkey").toBeErr(Cl.uint(E.TOKEN_LOCKED));
    // admin path unaffected
    expect(simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(1_000), Cl.principal(RECIPIENT), Cl.none(), Cl.none(), Cl.none()],
      OWNER).result).toBeOk(Cl.bool(true));
  });
});

describe("v16 parity: pending STX operations", () => {
  it("queues over threshold, refuses early, then releases with a memo", () => {
    seated(); fundSTX();
    expect(simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(STX_THRESHOLD + 1), Cl.principal(RECIPIENT), Cl.none(), Cl.none(), Cl.none()],
      OWNER).result).toBeOk(Cl.bool(true));
    expect(Cl.prettyPrint(pendingOp(0))).toContain("stx-transfer");
    expect(simnet.callPublicFn(WALLET, "execute-pending-stx-transfer",
      [Cl.uint(0), Cl.none()], OWNER).result).toBeErr(Cl.uint(E.COOLDOWN_NOT_PASSED));

    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
    const before = simnet.getAssetsMap().get("STX")?.get(RECIPIENT) ?? 0n;
    expect(simnet.callPublicFn(WALLET, "execute-pending-stx-transfer",
      [Cl.uint(0), Cl.some(Cl.bufferFromHex("ab".repeat(34)))], OWNER).result)
      .toBeOk(Cl.bool(true));
    expect(simnet.getAssetsMap().get("STX")?.get(RECIPIENT) ?? 0n)
      .toBe(before + BigInt(STX_THRESHOLD + 1));

    expect(simnet.callPublicFn(WALLET, "execute-pending-stx-transfer",
      [Cl.uint(0), Cl.none()], OWNER).result).toBeErr(Cl.uint(E.ALREADY_EXECUTED));
    expect(simnet.callPublicFn(WALLET, "execute-pending-stx-transfer",
      [Cl.uint(99), Cl.none()], OWNER).result).toBeErr(Cl.uint(E.INVALID_OP));
  });

  it("veto kills a queued op and blocks release", () => {
    seated(); fundSTX();
    simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(STX_THRESHOLD + 1), Cl.principal(RECIPIENT), Cl.none(), Cl.none(), Cl.none()], OWNER);
    expect(simnet.callPublicFn(WALLET, "veto-operation",
      [Cl.uint(0), Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
    expect(simnet.callPublicFn(WALLET, "execute-pending-stx-transfer",
      [Cl.uint(0), Cl.none()], OWNER).result).toBeErr(Cl.uint(E.VETOED));
  });
});

describe("v16 parity: sBTC transfer and withdrawal", () => {
  it("queues over the sBTC threshold and releases after the cooldown", () => {
    seated(); fundSBTC();
    expect(simnet.callPublicFn(WALLET, "sip010-transfer",
      [Cl.uint(SBTC_THRESHOLD + 1), Cl.principal(RECIPIENT), Cl.none(), sbtcCV,
       Cl.stringAscii("sbtc-token"), Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
    expect(simnet.callPublicFn(WALLET, "execute-pending-sbtc-transfer",
      [Cl.uint(0), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
  });

  it("sbtc-initiate-withdrawal queues over threshold and executes after cooldown", () => {
    seated(); fundSBTC();
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "sbtc-initiate-withdrawal",
      [Cl.uint(SBTC_THRESHOLD + 1), poxAddr, Cl.uint(1_000), Cl.none(), Cl.none()],
      OWNER).result)).toMatch(/^\(ok /);
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
    // returns the sbtc-withdrawal REQUEST ID, not a bool
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "execute-pending-sbtc-withdrawal",
      [Cl.uint(0)], OWNER).result)).toMatch(/^\(ok u\d+\)/);
  });

  it("an under-threshold sBTC withdrawal goes straight out on the passkey", () => {
    seated(); fundSBTC();
    expect(Cl.prettyPrint(simnet.callPublicFn(WALLET, "sbtc-initiate-withdrawal",
      [Cl.uint(10_000), poxAddr, Cl.uint(1_000),
       Cl.some(sign(topic("sbtc-withdrawal", { "auth-id": Cl.uint(next()),
         amount: Cl.uint(10_000), recipient: poxAddr, "max-fee": Cl.uint(1_000) }), id)),
       Cl.none()], RELAYER).result)).toMatch(/^\(ok /);
  });
});

describe("v16 parity: sip009-transfer moves a real NFT", () => {
  it("admin path and passkey path both move it", () => {
    seated();
    simnet.callPublicFn(`${DEPLOYER}.zz-nft`, "mint", [Cl.principal(WALLET)], DEPLOYER);
    expect(simnet.callPublicFn(WALLET, "sip009-transfer",
      [Cl.uint(1), Cl.principal(RECIPIENT), nftCV, Cl.stringAscii("zz-nft"),
       Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
    expect(simnet.callReadOnlyFn(`${DEPLOYER}.zz-nft`, "get-owner", [Cl.uint(1)], DEPLOYER).result)
      .toBeOk(Cl.some(Cl.principal(RECIPIENT)));
  });
});

describe("v16 parity: admin transfer and recovery", () => {
  it("propose-transfer-wallet then confirm rotates the admin", () => {
    seated();
    expect(simnet.callPublicFn(WALLET, "propose-transfer-wallet",
      [Cl.principal(NEW_OWNER)], OWNER).result).toBeOk(Cl.bool(true));
    expect(simnet.callPublicFn(WALLET, "confirm-transfer-wallet",
      [sign(topic("confirm-transfer",
        { "auth-id": Cl.uint(next()), "new-admin": Cl.principal(NEW_OWNER) }), id), Cl.none()],
      RELAYER).result).toBeOk(Cl.bool(true));
    expect(simnet.getDataVar(WALLET, "owner")).toBePrincipal(NEW_OWNER);
    // the old admin is out
    expect(simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(1_000), Cl.principal(RECIPIENT), Cl.none(), Cl.none(), Cl.none()],
      OWNER).result).toBeErr(Cl.uint(E.UNAUTH));
  });

  it("propose-transfer-wallet refuses the caller itself, and a stranger cannot propose", () => {
    seated();
    expect(simnet.callPublicFn(WALLET, "propose-transfer-wallet",
      [Cl.principal(OWNER)], OWNER).result).toBeErr(Cl.uint(E.FORBIDDEN));
    expect(simnet.callPublicFn(WALLET, "propose-transfer-wallet",
      [Cl.principal(RANDOM)], RANDOM).result).toBeErr(Cl.uint(E.UNAUTH));
  });

  it("propose-recovery needs the passkey, confirm needs the admin", () => {
    seated();
    expect(simnet.callPublicFn(WALLET, "propose-recovery",
      [Cl.principal(NEW_OWNER), sign(topic("propose-recovery",
        { "auth-id": Cl.uint(next()), "new-recovery": Cl.principal(NEW_OWNER) }), id), Cl.none()],
      RELAYER).result).toBeOk(Cl.bool(true));
    expect(simnet.callPublicFn(WALLET, "confirm-recovery", [], RANDOM).result)
      .toBeErr(Cl.uint(E.UNAUTH));
    expect(simnet.callPublicFn(WALLET, "confirm-recovery", [], OWNER).result)
      .toBeOk(Cl.bool(true));
    expect(simnet.getDataVar(WALLET, "recovery-address")).toBePrincipal(NEW_OWNER);
    expect(simnet.callPublicFn(WALLET, "confirm-recovery", [], OWNER).result)
      .toBeErr(Cl.uint(E.NO_PENDING_RECOVERY));
  });
});

describe("v16 parity: pox-5 staking", () => {
  const stakerInfo = () => Cl.prettyPrint(simnet.callReadOnlyFn(
    "SP000000000000000000002Q6VF78.pox-5", "get-staker-info",
    [Cl.contractPrincipal(WD, "fakfun-wallet-v17")], OWNER).result);

  it("stakes, tops up, and unstakes", () => {
    seated(); fundSTX(); registerSigner();
    expect(simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(1_000_000_000), Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
    expect(stakerInfo()).toContain("amount-ustx: u1000000000");

    // the allowance on a top-up is the RESULTING TOTAL, not the delta
    expect(simnet.callPublicFn(WALLET, "update-stake-stx-juice",
      [Cl.uint(100_000_000), Cl.uint(0), Cl.none(), Cl.none()], OWNER).result)
      .toBeOk(Cl.bool(true));
    expect(stakerInfo()).toContain("amount-ustx: u1100000000");

    expect(simnet.callPublicFn(WALLET, "unstake", [Cl.none(), Cl.none()], OWNER).result)
      .toBeOk(Cl.bool(true));
  });

  it("rejects a stake from a non-admin and a zero amount", () => {
    seated(); fundSTX(); registerSigner();
    expect(simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(1_000_000_000), Cl.none(), Cl.none()], RANDOM).result).toBeErr(Cl.uint(E.UNAUTH));
    expect(simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(0), Cl.none(), Cl.none()], OWNER).result).toBeErr(Cl.uint(E.ZERO));
  });

  it("stakes on the passkey path and pays a gas station", () => {
    seated(); fundSTX(); fundSBTC(); registerSigner();
    const g0 = gasCounter();
    expect(simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(1_000_000_000), Cl.some(sign(topic("stake-stx-juice-pox5",
        { "auth-id": Cl.uint(next()), "amount-ustx": Cl.uint(1_000_000_000) }), id)),
       Cl.some(stationCV)], RELAYER).result).toBeOk(Cl.bool(true));
    expect(gasCounter() - g0).toBe(20n);
  });
});

describe("v16 parity: replay and pubkey registration", () => {
  it("the same signature cannot be replayed", () => {
    seated(); fundSTX();
    const sig = sign(topic("stx-transfer", { "auth-id": Cl.uint(900), amount: Cl.uint(1_000),
      recipient: Cl.principal(RECIPIENT), memo: Cl.none() }), 900);
    const call = () => simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(1_000), Cl.principal(RECIPIENT), Cl.none(), Cl.some(sig), Cl.none()], RELAYER);
    expect(call().result).toBeOk(Cl.bool(true));
    expect(call().result).toBeErr(Cl.uint(E.REPLAY));
  });
});
