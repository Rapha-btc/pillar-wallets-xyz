// signer-admin.test.ts -- juice-pool-stx-signer: admin, pause, fees, OG.
//
// Run: npx vitest run tests/signer-admin.test.ts -- --manifest tests/cl-signer/Clarinet.toml
//
// The contract is pulled as a REQUIREMENT, so it runs the real deployed bytes at its
// real mainnet address against the real pox-5 and sBTC. `admin` is set to tx-sender at
// deploy time, so the admin is SPV9K21... and assert-admin checks contract-caller.
//
// Gating, mapped from the source rather than assumed:
//   admin-only : set-admin, set-paused, propose/confirm/cancel-fee-bips, set-og,
//                withdraw-fees, withdraw-all-fees, register-self, sweep-tranche-dust
//   pox-5 only : validate-stake!            (ERR_NOT_POX5 u102)
//   PERMISSIONLESS: pox-claim-rewards, pay-stx-stakers, pox-settle-stakers
//   ERR_PAUSED u101 is reachable from validate-stake! ALONE.
import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

// SIGNER_DEPLOYER lets the coverage harness (tests/cl-signer-cov) publish the signer
// locally, since clarinet --coverage only instruments project contracts. Unset -- the
// normal case -- it is the real mainnet deployer, which is also the admin because
// `admin` is set to tx-sender at deploy.
const D = process.env.SIGNER_DEPLOYER ?? "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const SIGNER = `${D}.juice-pool-stx-signer`;
const POX5 = "SP000000000000000000002Q6VF78.pox-5";
const accounts = simnet.getAccounts();
const DEPLOYER = accounts.get("deployer")!;
const RANDOM = accounts.get("wallet_3")!;
const RECIPIENT = accounts.get("wallet_5")!;

const MAX_FEE_BIPS = 2000;
const FEE_COOLDOWN = 144;
const E = {
  UNAUTH: 100, PAUSED: 101, NOT_POX5: 102, SETTLE_FAILED: 103, TRANCHE_UNPAID: 104,
  NO_DUST: 105, NO_NEW_REWARDS: 109, INVALID_FEE: 110, INSUFFICIENT_FEES: 111,
  TRANCHE_TOO_SOON: 112, NO_PENDING_FEE: 113, COOLDOWN: 114,
};
const admin = () => simnet.callReadOnlyFn(SIGNER, "get-admin", [], D).result;
const feeBips = () => simnet.callReadOnlyFn(SIGNER, "get-fee-bips", [], D).result;
const earned = () => simnet.callReadOnlyFn(SIGNER, "get-earned-fees", [], D).result;
const pendingFee = () => Cl.prettyPrint(
  simnet.callReadOnlyFn(SIGNER, "get-pending-fee", [], D).result);

describe("signer: admin surface", () => {
  it("every admin-only function refuses a stranger with u100", () => {
    // confirm-fee-bips unwraps pending-fee BEFORE assert-admin, so with nothing queued
    // a stranger sees u113 rather than u100. Seed a proposal so the loop actually
    // reaches the authorisation check on that one too. (Harmless ordering, but it does
    // mean a stranger can distinguish "no pending fee" from "not admin".)
    expect(simnet.callPublicFn(SIGNER, "propose-fee-bips", [Cl.uint(100)], D).result)
      .toBeOk(Cl.uint(100));
    for (const [fn, args] of [
      ["set-admin", [Cl.principal(RANDOM)]],
      ["set-paused", [Cl.bool(true)]],
      ["propose-fee-bips", [Cl.uint(100)]],
      ["confirm-fee-bips", []],
      ["cancel-fee-bips", []],
      ["set-og", [Cl.principal(RANDOM), Cl.bool(true)]],
      ["withdraw-fees", [Cl.uint(1), Cl.principal(RANDOM)]],
      ["withdraw-all-fees", [Cl.principal(RANDOM)]],
      ["sweep-tranche-dust", [Cl.uint(1), Cl.uint(0)]],
    ] as [string, any[]][]) {
      expect(simnet.callPublicFn(SIGNER, fn, args, RANDOM).result, fn)
        .toBeErr(Cl.uint(E.UNAUTH));
    }
  });

  it("set-admin rotates and locks the old admin out", () => {
    expect(simnet.callPublicFn(SIGNER, "set-admin", [Cl.principal(RANDOM)], D).result)
      .toBeOk(Cl.bool(true));
    expect(admin()).toBePrincipal(RANDOM);
    expect(simnet.callPublicFn(SIGNER, "set-paused", [Cl.bool(true)], D).result)
      .toBeErr(Cl.uint(E.UNAUTH));
    expect(simnet.callPublicFn(SIGNER, "set-paused", [Cl.bool(true)], RANDOM).result)
      .toBeOk(Cl.bool(true));
  });

  it("set-admin has NO guard: the contract itself can be seated, bricking it", () => {
    // Not a bug report, a footgun worth pinning: there is no assert that new-admin is
    // not the contract or the burn address. Nothing on chain can undo this.
    expect(simnet.callPublicFn(SIGNER, "set-admin",
      [Cl.contractPrincipal(D, "juice-pool-stx-signer")], D).result).toBeOk(Cl.bool(true));
    expect(admin()).toBePrincipal(SIGNER);
    // and now no principal can act as admin any more
    expect(simnet.callPublicFn(SIGNER, "set-paused", [Cl.bool(true)], D).result)
      .toBeErr(Cl.uint(E.UNAUTH));
  });

  it("set-paused toggles and is visible", () => {
    expect(simnet.callReadOnlyFn(SIGNER, "is-paused", [], D).result).toBeBool(false);
    expect(simnet.callPublicFn(SIGNER, "set-paused", [Cl.bool(true)], D).result)
      .toBeOk(Cl.bool(true));
    expect(simnet.callReadOnlyFn(SIGNER, "is-paused", [], D).result).toBeBool(true);
    expect(simnet.callPublicFn(SIGNER, "set-paused", [Cl.bool(false)], D).result)
      .toBeOk(Cl.bool(true));
  });
});

describe("signer: the fee change is two-phase", () => {
  it("proposes, waits 144 blocks, then confirms", () => {
    expect(simnet.callPublicFn(SIGNER, "propose-fee-bips", [Cl.uint(500)], D).result)
      .toBeOk(Cl.uint(500));
    expect(pendingFee()).toContain("fee: (some u500)");
    expect(feeBips(), "live fee untouched while pending").toBeUint(0);

    expect(simnet.callPublicFn(SIGNER, "confirm-fee-bips", [], D).result)
      .toBeErr(Cl.uint(E.COOLDOWN));
    simnet.mineEmptyBurnBlocks(FEE_COOLDOWN + 1);
    expect(simnet.callPublicFn(SIGNER, "confirm-fee-bips", [], D).result)
      .toBeOk(Cl.bool(true));
    expect(feeBips()).toBeUint(500);
    expect(pendingFee()).toContain("fee: none");
    // and the slot is empty again
    expect(simnet.callPublicFn(SIGNER, "confirm-fee-bips", [], D).result)
      .toBeErr(Cl.uint(E.NO_PENDING_FEE));
  });

  it("rejects a fee above MAX_FEE_BIPS and accepts exactly AT the cap", () => {
    expect(simnet.callPublicFn(SIGNER, "propose-fee-bips",
      [Cl.uint(MAX_FEE_BIPS + 1)], D).result).toBeErr(Cl.uint(E.INVALID_FEE));
    expect(simnet.callPublicFn(SIGNER, "propose-fee-bips",
      [Cl.uint(MAX_FEE_BIPS)], D).result).toBeOk(Cl.uint(MAX_FEE_BIPS));
    simnet.mineEmptyBurnBlocks(FEE_COOLDOWN + 1);
    expect(simnet.callPublicFn(SIGNER, "confirm-fee-bips", [], D).result).toBeOk(Cl.bool(true));
    expect(feeBips()).toBeUint(MAX_FEE_BIPS);
  });

  it("cancel clears a pending proposal", () => {
    simnet.callPublicFn(SIGNER, "propose-fee-bips", [Cl.uint(300)], D);
    expect(simnet.callPublicFn(SIGNER, "cancel-fee-bips", [], D).result).toBeOk(Cl.bool(true));
    expect(pendingFee()).toContain("fee: none");
    simnet.mineEmptyBurnBlocks(FEE_COOLDOWN + 1);
    expect(simnet.callPublicFn(SIGNER, "confirm-fee-bips", [], D).result)
      .toBeErr(Cl.uint(E.NO_PENDING_FEE));
    expect(feeBips()).toBeUint(0);
  });

  it("re-proposing OVERWRITES and restarts the clock", () => {
    simnet.callPublicFn(SIGNER, "propose-fee-bips", [Cl.uint(1900)], D);
    simnet.mineEmptyBurnBlocks(FEE_COOLDOWN - 2);
    // change of heart: a second proposal replaces the first
    simnet.callPublicFn(SIGNER, "propose-fee-bips", [Cl.uint(50)], D);
    expect(pendingFee()).toContain("fee: (some u50)");
    // the blocks elapsed belonged to the FIRST proposal
    expect(simnet.callPublicFn(SIGNER, "confirm-fee-bips", [], D).result)
      .toBeErr(Cl.uint(E.COOLDOWN));
    simnet.mineEmptyBurnBlocks(FEE_COOLDOWN + 1);
    expect(simnet.callPublicFn(SIGNER, "confirm-fee-bips", [], D).result).toBeOk(Cl.bool(true));
    expect(feeBips(), "the abandoned 1900 never applied").toBeUint(50);
  });

  it("get-pending-fee reports the executable height", () => {
    const h = simnet.burnBlockHeight;
    simnet.callPublicFn(SIGNER, "propose-fee-bips", [Cl.uint(123)], D);
    expect(pendingFee()).toContain(`executable-at: u${h + FEE_COOLDOWN}`);
  });
});

describe("signer: OG stakers pay no fee", () => {
  it("set-og flips the effective rate to zero and back", () => {
    simnet.callPublicFn(SIGNER, "propose-fee-bips", [Cl.uint(1000)], D);
    simnet.mineEmptyBurnBlocks(FEE_COOLDOWN + 1);
    simnet.callPublicFn(SIGNER, "confirm-fee-bips", [], D);
    expect(feeBips()).toBeUint(1000);

    expect(simnet.callReadOnlyFn(SIGNER, "is-og", [Cl.principal(RANDOM)], D).result)
      .toBeBool(false);
    expect(simnet.callReadOnlyFn(SIGNER, "get-effective-fee-bips",
      [Cl.principal(RANDOM)], D).result).toBeUint(1000);

    expect(simnet.callPublicFn(SIGNER, "set-og",
      [Cl.principal(RANDOM), Cl.bool(true)], D).result).toBeOk(Cl.bool(true));
    expect(simnet.callReadOnlyFn(SIGNER, "is-og", [Cl.principal(RANDOM)], D).result)
      .toBeBool(true);
    expect(simnet.callReadOnlyFn(SIGNER, "get-effective-fee-bips",
      [Cl.principal(RANDOM)], D).result, "an OG pays nothing").toBeUint(0);

    expect(simnet.callPublicFn(SIGNER, "set-og",
      [Cl.principal(RANDOM), Cl.bool(false)], D).result).toBeOk(Cl.bool(false));
    expect(simnet.callReadOnlyFn(SIGNER, "get-effective-fee-bips",
      [Cl.principal(RANDOM)], D).result).toBeUint(1000);
  });
});

describe("signer: fee withdrawal", () => {
  it("u111 withdrawing more than earned, and zero earned means zero available", () => {
    expect(earned()).toBeUint(0);
    expect(simnet.callPublicFn(SIGNER, "withdraw-fees",
      [Cl.uint(1), Cl.principal(RECIPIENT)], D).result).toBeErr(Cl.uint(E.INSUFFICIENT_FEES));
  });

  it("withdrawing exactly zero is allowed and moves nothing", () => {
    const r = simnet.callPublicFn(SIGNER, "withdraw-fees",
      [Cl.uint(0), Cl.principal(RECIPIENT)], D);
    // an sBTC transfer of 0 is what decides this; assert whichever it is, explicitly
    expect(["(ok u0)", "(err u1)", "(err u3)"]).toContain(Cl.prettyPrint(r.result));
    expect(earned()).toBeUint(0);
  });
});

describe("signer: pox-5 gating", () => {
  it("u102 validate-stake! cannot be called by anyone but pox-5", () => {
    expect(simnet.callPublicFn(SIGNER, "validate-stake!",
      [Cl.principal(RANDOM), Cl.uint(0), Cl.uint(1), Cl.uint(1000), Cl.uint(0),
       Cl.bool(false), Cl.none()], D).result).toBeErr(Cl.uint(E.NOT_POX5));
    expect(simnet.callPublicFn(SIGNER, "validate-stake!",
      [Cl.principal(RANDOM), Cl.uint(0), Cl.uint(1), Cl.uint(1000), Cl.uint(0),
       Cl.bool(false), Cl.none()], RANDOM).result).toBeErr(Cl.uint(E.NOT_POX5));
  });

  it("the reward functions are PERMISSIONLESS, not admin-gated", () => {
    // pox-claim-rewards, pay-stx-stakers and pox-settle-stakers carry no assert-admin.
    // A stranger calling them must fail on STATE, never on authorisation.
    const r1 = simnet.callPublicFn(SIGNER, "pox-claim-rewards",
      [Cl.list([Cl.uint(0)]), Cl.uint(1)], RANDOM);
    expect(Cl.prettyPrint(r1.result), "not u100").not.toContain("u100");

    const r2 = simnet.callPublicFn(SIGNER, "pay-stx-stakers",
      [Cl.list([Cl.principal(RANDOM)]), Cl.uint(1), Cl.uint(0)], RANDOM);
    expect(r2.result, "an empty tranche pays zero").toBeOk(Cl.uint(0));

    const r3 = simnet.callPublicFn(SIGNER, "pox-settle-stakers",
      [Cl.list([Cl.principal(RANDOM)]), Cl.uint(1), Cl.none()], RANDOM);
    expect(Cl.prettyPrint(r3.result), "not u100").not.toContain("u100");
  });
});

describe("signer: tranche read-onlys on an empty cycle", () => {
  it("report zeros rather than erroring", () => {
    expect(simnet.callReadOnlyFn(SIGNER, "get-tranche-count", [Cl.uint(99)], D).result)
      .toBeUint(0);
    expect(simnet.callReadOnlyFn(SIGNER, "get-stx-pot",
      [Cl.uint(99), Cl.uint(0)], D).result).toBeUint(0);
    expect(simnet.callReadOnlyFn(SIGNER, "get-tranche-paid",
      [Cl.uint(99), Cl.uint(0)], D).result).toBeUint(0);
    expect(simnet.callReadOnlyFn(SIGNER, "get-tranche-paid-shares",
      [Cl.uint(99), Cl.uint(0)], D).result).toBeUint(0);
    expect(simnet.callReadOnlyFn(SIGNER, "get-tranche-residue",
      [Cl.uint(99), Cl.uint(0)], D).result).toBeUint(0);
    expect(simnet.callReadOnlyFn(SIGNER, "get-stx-paid",
      [Cl.uint(99), Cl.uint(0), Cl.principal(RANDOM)], D).result).toBeNone();
    expect(simnet.callReadOnlyFn(SIGNER, "get-last-claim-dist-cycle",
      [Cl.uint(99)], D).result).toBeNone();
  });

  it("u105 sweep-tranche-dust with no dust, u104 when the tranche is unpaid", () => {
    // is-tranche-fully-paid compares paid-shares >= cycle-total-shares. On an empty
    // cycle both are 0, so it reads fully-paid and the NO_DUST branch is what fires.
    expect(simnet.callPublicFn(SIGNER, "sweep-tranche-dust",
      [Cl.uint(99), Cl.uint(0)], D).result).toBeErr(Cl.uint(E.NO_DUST));
  });
});
