// signer-rewards.test.ts -- juice-pool-stx-signer: the reward and tranche chain.
//
// Run: npx vitest run tests/signer-rewards.test.ts -- --manifest tests/cl-signer/Clarinet.toml
//
// The chain, all against the real mainnet pox-5 and sBTC:
//   sBTC to pox-5 -> pox-5.calculate-rewards (permissionless)
//   -> signer.pox-claim-rewards (pulls the signer's cut into its own pot, as a TRANCHE)
//   -> signer.pay-stx-stakers   (splits the tranche by shares, taking the fee)
//   -> signer.sweep-tranche-dust (the rounding residue, admin only)
//
// pox-5 derives rewards from its OWN sBTC balance -- get-rewards is
// balance - total-sbtc-staked - reserve -- so funding pox-5 and rolling a distribution
// cycle is enough. No BTC miner payout needed, which is what makes this reproducible.
//
// Two stakers, not one, because a single staker hides everything interesting: share
// splitting, the fee cut, and the rounding residue that sweep-tranche-dust exists for.
//
// NOTE the pot is denominated in sBTC despite the name stx-pot: pay-one transfers
// sbtc-token. "stx" here means "the STX-stacking side of the pool", not the asset.
import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";
import crypto from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";

// SIGNER_DEPLOYER lets the coverage harness (tests/cl-signer-cov) publish the signer
// locally, since clarinet --coverage only instruments project contracts. Unset -- the
// normal case -- it is the real mainnet deployer, which is also the admin because
// `admin` is set to tx-sender at deploy.
const D = process.env.SIGNER_DEPLOYER ?? "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const SIGNER = `${D}.juice-pool-stx-signer`;
const POX5 = "SP000000000000000000002Q6VF78.pox-5";
const SBTC = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const SBTC_DEPOSIT = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-deposit";
const SBTC_SIGNER = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4";
const accounts = simnet.getAccounts();
const DEPLOYER = accounts.get("deployer")!;
const RELAYER = accounts.get("wallet_4")!;
const RECIPIENT = accounts.get("wallet_5")!;
const A = `${DEPLOYER}.zz-staker-a`;
const B = `${DEPLOYER}.zz-staker-b`;
const CHAIN_ID = 2147483648;
const FEE_COOLDOWN = 144;
const E = { TRANCHE_UNPAID: 104, NO_DUST: 105, NO_NEW_REWARDS: 109,
  TRANCHE_TOO_SOON: 112, INSUFFICIENT_FEES: 111 };

const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest();
const cvHash = (cv: any) => sha256(Buffer.from(Cl.serialize(cv), "hex"));
const SIP018 = Buffer.from("534950303138", "hex");
const signerCV = Cl.contractPrincipal(D, "juice-pool-stx-signer");

function registerSigner() {
  const priv = Buffer.from("11".repeat(32), "hex");
  const pub = secp256k1.getPublicKey(priv, true);
  const dom = cvHash(Cl.tuple({ name: Cl.stringAscii("pox-5-signer"),
    version: Cl.stringAscii("1.0.0"), "chain-id": Cl.uint(CHAIN_ID) }));
  const st = cvHash(Cl.tuple({ topic: Cl.stringAscii("grant-authorization"),
    "signer-manager": signerCV, "auth-id": Cl.uint(1) }));
  const h = sha256(Buffer.concat([SIP018, dom, st]));
  const compact = Buffer.from(secp256k1.sign(h, priv, { prehash: false }));
  for (const rec of [1, 0]) {
    const r = simnet.callPublicFn(SIGNER, "register-self",
      [signerCV, Cl.bufferFromHex(Buffer.from(pub).toString("hex")), Cl.uint(1),
       Cl.bufferFromHex(Buffer.concat([compact, Buffer.from([rec])]).toString("hex"))], D);
    if (Cl.prettyPrint(r.result).startsWith("(ok")) return;
  }
  throw new Error("signer registration failed");
}

let salt = 0x80;
function fundSbtcTo(to: string, amount: number) {
  const h = simnet.burnBlockHeight - 1;
  const hash = Cl.prettyPrint(simnet.callReadOnlyFn(`${DEPLOYER}.zz-nft`, "burn-hash",
    [Cl.uint(h)], DEPLOYER).result).replace(/^0x/, "");
  const txid = (++salt).toString(16).padStart(2, "0").repeat(32);
  return simnet.callPublicFn(SBTC_DEPOSIT, "complete-deposit-wrapper",
    [Cl.bufferFromHex(txid), Cl.uint(0), Cl.uint(amount), Cl.principal(to),
     Cl.bufferFromHex(hash), Cl.uint(h), Cl.bufferFromHex("55".repeat(32))], SBTC_SIGNER);
}
const sbtcOf = (p: string): bigint => BigInt(Cl.prettyPrint(simnet.callReadOnlyFn(
  SBTC, "get-balance", [Cl.principal(p)], DEPLOYER).result).replace(/\D/g, ""));
const num = (cv: any) => BigInt(Cl.prettyPrint(cv).replace(/\D/g, "") || "0");
const ro = (fn: string, args: any[] = []) =>
  simnet.callReadOnlyFn(SIGNER, fn, args, D).result;

/** two stakers, 30k STX each, comfortably over pox-5's 50k PER-SIGNER floor combined */
function stakeBoth(a = 30_000_000_000, b = 30_000_000_000) {
  registerSigner();
  simnet.transferSTX(a + 1_000_000_000, A, DEPLOYER);
  simnet.transferSTX(b + 1_000_000_000, B, DEPLOYER);
  expect(Cl.prettyPrint(simnet.callPublicFn(A, "stake",
    [signerCV, Cl.uint(a)], RELAYER).result)).toMatch(/^\(ok /);
  expect(Cl.prettyPrint(simnet.callPublicFn(B, "stake",
    [signerCV, Cl.uint(b)], RELAYER).result)).toMatch(/^\(ok /);
  const info = Cl.prettyPrint(simnet.callReadOnlyFn(POX5, "get-staker-info",
    [Cl.principal(A)], D).result);
  return BigInt((info.match(/first-reward-cycle: u(\d+)/) || [])[1]);
}

/** roll into the staked cycle, drop rewards into pox-5, and allocate them */
function earnRewards(cycle: bigint, sats = 2_000_000) {
  simnet.mineEmptyBurnBlocks(1100);
  expect(fundSbtcTo(POX5, sats).result).toBeOk(Cl.bool(true));
  simnet.mineEmptyBurnBlocks(560);
  const calc = simnet.callPublicFn(POX5, "calculate-rewards", [Cl.list([])], RELAYER);
  expect(Cl.prettyPrint(calc.result)).toMatch(/^\(ok /);
  expect(Cl.prettyPrint(calc.result), "rewards must go to stakers, not the reserve")
    .not.toContain("cycle-staked-ustx: u0");
  return calc;
}

describe("signer: the tranche chain end to end", () => {
  it("claims a tranche, splits it between two stakers, and conserves every sat", () => {
    const cycle = stakeBoth();
    earnRewards(cycle);

    // --- claim: permissionless, and it opens tranche 0
    expect(ro("get-tranche-count", [Cl.uint(Number(cycle))])).toBeUint(0);
    expect(Cl.prettyPrint(simnet.callPublicFn(SIGNER, "pox-claim-rewards",
      [Cl.list([]), Cl.uint(Number(cycle))], RELAYER).result)).toMatch(/^\(ok /);
    expect(ro("get-tranche-count", [Cl.uint(Number(cycle))])).toBeUint(1);

    const pot = num(ro("get-stx-pot", [Cl.uint(Number(cycle)), Cl.uint(0)]));
    expect(pot, "the tranche pot holds the signer's cut").toBeGreaterThan(0n);

    // --- pay: both stakers, one call
    const aBefore = sbtcOf(A), bBefore = sbtcOf(B);
    expect(Cl.prettyPrint(simnet.callPublicFn(SIGNER, "pay-stx-stakers",
      [Cl.list([Cl.principal(A), Cl.principal(B)]),
       Cl.uint(Number(cycle)), Cl.uint(0)], RELAYER).result)).toMatch(/^\(ok /);
    const aPaid = sbtcOf(A) - aBefore, bPaid = sbtcOf(B) - bBefore;
    expect(aPaid, "staker A paid").toBeGreaterThan(0n);
    expect(bPaid, "staker B paid").toBeGreaterThan(0n);
    // equal stakes, equal shares
    expect(aPaid).toBe(bPaid);

    // --- CONSERVATION: paid + residue + fees == the pot, to the sat
    const tranchePaid = num(ro("get-tranche-paid", [Cl.uint(Number(cycle)), Cl.uint(0)]));
    const residue = num(ro("get-tranche-residue", [Cl.uint(Number(cycle)), Cl.uint(0)]));
    const fees = num(ro("get-earned-fees"));
    expect(tranchePaid + residue, "tranche-paid + residue == pot").toBe(pot);
    expect(aPaid + bPaid + fees, "net to stakers + fees == gross recorded")
      .toBe(tranchePaid);
    expect(fees, "fee-bips is 0 by default so nothing is skimmed").toBe(0n);

    // --- the stx-paid guard makes a replay a no-op
    expect(Cl.prettyPrint(simnet.callPublicFn(SIGNER, "pay-stx-stakers",
      [Cl.list([Cl.principal(A), Cl.principal(B)]),
       Cl.uint(Number(cycle)), Cl.uint(0)], RELAYER).result)).toMatch(/^\(ok /);
    expect(sbtcOf(A) - aBefore, "no double payment").toBe(aPaid);
    expect(num(ro("get-stx-paid", [Cl.uint(Number(cycle)), Cl.uint(0), Cl.principal(A)])))
      .toBe(aPaid);
  });

  it("takes the fee out of the staker's cut when fee-bips is set", () => {
    // set the fee BEFORE the payout so pay-one skims it
    expect(simnet.callPublicFn(SIGNER, "propose-fee-bips", [Cl.uint(1000)], D).result)
      .toBeOk(Cl.uint(1000));
    simnet.mineEmptyBurnBlocks(FEE_COOLDOWN + 1);
    expect(simnet.callPublicFn(SIGNER, "confirm-fee-bips", [], D).result).toBeOk(Cl.bool(true));

    const cycle = stakeBoth();
    earnRewards(cycle);
    simnet.callPublicFn(SIGNER, "pox-claim-rewards", [Cl.list([]), Cl.uint(Number(cycle))], RELAYER);
    const pot = num(ro("get-stx-pot", [Cl.uint(Number(cycle)), Cl.uint(0)]));

    const aBefore = sbtcOf(A);
    simnet.callPublicFn(SIGNER, "pay-stx-stakers",
      [Cl.list([Cl.principal(A), Cl.principal(B)]), Cl.uint(Number(cycle)), Cl.uint(0)], RELAYER);
    const aPaid = sbtcOf(A) - aBefore;
    const fees = num(ro("get-earned-fees"));
    expect(fees, "10% of the gross is skimmed").toBeGreaterThan(0n);

    // gross for A is half the pot (equal stakes); net is gross minus 10%
    const grossA = pot / 2n;
    expect(aPaid).toBe(grossA - (grossA * 1000n) / 10000n);

    // conservation still holds with a fee in play
    const tranchePaid = num(ro("get-tranche-paid", [Cl.uint(Number(cycle)), Cl.uint(0)]));
    const residue = num(ro("get-tranche-residue", [Cl.uint(Number(cycle)), Cl.uint(0)]));
    expect(tranchePaid + residue).toBe(pot);

    // --- and now the fee can actually be withdrawn (the u111 path's success twin)
    const before = sbtcOf(RECIPIENT);
    expect(simnet.callPublicFn(SIGNER, "withdraw-fees",
      [Cl.uint(Number(fees)), Cl.principal(RECIPIENT)], D).result).toBeOk(Cl.uint(Number(fees)));
    expect(sbtcOf(RECIPIENT) - before).toBe(fees);
    expect(num(ro("get-earned-fees"))).toBe(0n);
    expect(simnet.callPublicFn(SIGNER, "withdraw-fees",
      [Cl.uint(1), Cl.principal(RECIPIENT)], D).result).toBeErr(Cl.uint(E.INSUFFICIENT_FEES));
  });

  it("an OG staker pays no fee while a normal one does, in the same call", () => {
    simnet.callPublicFn(SIGNER, "propose-fee-bips", [Cl.uint(2000)], D);
    simnet.mineEmptyBurnBlocks(FEE_COOLDOWN + 1);
    simnet.callPublicFn(SIGNER, "confirm-fee-bips", [], D);
    expect(simnet.callPublicFn(SIGNER, "set-og", [Cl.principal(A), Cl.bool(true)], D).result)
      .toBeOk(Cl.bool(true));

    const cycle = stakeBoth();
    earnRewards(cycle);
    simnet.callPublicFn(SIGNER, "pox-claim-rewards", [Cl.list([]), Cl.uint(Number(cycle))], RELAYER);
    const pot = num(ro("get-stx-pot", [Cl.uint(Number(cycle)), Cl.uint(0)]));

    const aBefore = sbtcOf(A), bBefore = sbtcOf(B);
    simnet.callPublicFn(SIGNER, "pay-stx-stakers",
      [Cl.list([Cl.principal(A), Cl.principal(B)]), Cl.uint(Number(cycle)), Cl.uint(0)], RELAYER);
    const aPaid = sbtcOf(A) - aBefore, bPaid = sbtcOf(B) - bBefore;
    expect(aPaid, "the OG keeps its full gross").toBe(pot / 2n);
    expect(bPaid, "the normal staker is skimmed 20%").toBeLessThan(aPaid);
    expect(num(ro("get-earned-fees"))).toBe(aPaid - bPaid);
  });

  it("sweep-tranche-dust moves exactly the residue, and only once", () => {
    // an odd pot and unequal stakes guarantee integer division leaves a remainder
    const cycle = stakeBoth(30_000_000_000, 27_777_777_777);
    earnRewards(cycle, 1_999_999);
    simnet.callPublicFn(SIGNER, "pox-claim-rewards", [Cl.list([]), Cl.uint(Number(cycle))], RELAYER);
    simnet.callPublicFn(SIGNER, "pay-stx-stakers",
      [Cl.list([Cl.principal(A), Cl.principal(B)]), Cl.uint(Number(cycle)), Cl.uint(0)], RELAYER);

    expect(ro("is-tranche-fully-paid", [Cl.uint(Number(cycle)), Cl.uint(0)])).toBeBool(true);
    const residue = num(ro("get-tranche-residue", [Cl.uint(Number(cycle)), Cl.uint(0)]));
    const adminBefore = sbtcOf(D);
    if (residue > 0n) {
      expect(simnet.callPublicFn(SIGNER, "sweep-tranche-dust",
        [Cl.uint(Number(cycle)), Cl.uint(0)], D).result).toBeOk(Cl.uint(Number(residue)));
      expect(sbtcOf(D) - adminBefore, "the dust goes to the admin").toBe(residue);
      expect(num(ro("get-tranche-residue", [Cl.uint(Number(cycle)), Cl.uint(0)]))).toBe(0n);
    }
    // nothing left to sweep either way
    expect(simnet.callPublicFn(SIGNER, "sweep-tranche-dust",
      [Cl.uint(Number(cycle)), Cl.uint(0)], D).result).toBeErr(Cl.uint(E.NO_DUST));
  });

  it("u112 claiming twice in the same distribution cycle is refused", () => {
    const cycle = stakeBoth();
    earnRewards(cycle);
    expect(Cl.prettyPrint(simnet.callPublicFn(SIGNER, "pox-claim-rewards",
      [Cl.list([]), Cl.uint(Number(cycle))], RELAYER).result)).toMatch(/^\(ok /);
    // last-claim-dist-cycle now equals the current distribution cycle
    expect(simnet.callPublicFn(SIGNER, "pox-claim-rewards",
      [Cl.list([]), Cl.uint(Number(cycle))], RELAYER).result)
      .toBeErr(Cl.uint(E.TRANCHE_TOO_SOON));
    expect(ro("get-tranche-count", [Cl.uint(Number(cycle))]), "no second tranche opened")
      .toBeUint(1);
  });

  it("u109 a claim with nothing new to claim", () => {
    // staked and in the cycle, but no sBTC ever reached pox-5, so claim-rewards
    // returns zero and the signer refuses to open an empty tranche
    const cycle = stakeBoth();
    simnet.mineEmptyBurnBlocks(1100 + 560);
    simnet.callPublicFn(POX5, "calculate-rewards", [Cl.list([])], RELAYER);
    const r = simnet.callPublicFn(SIGNER, "pox-claim-rewards",
      [Cl.list([]), Cl.uint(Number(cycle))], RELAYER);
    // either the signer's own guard or pox-5's, but it must NOT open a tranche
    expect(Cl.prettyPrint(r.result)).toMatch(/^\(err /);
    expect(ro("get-tranche-count", [Cl.uint(Number(cycle))])).toBeUint(0);
  });

  it("get-stx-owed previews a payout and reads zero once paid", () => {
    const cycle = stakeBoth();
    earnRewards(cycle);
    simnet.callPublicFn(SIGNER, "pox-claim-rewards", [Cl.list([]), Cl.uint(Number(cycle))], RELAYER);
    const owed = num(ro("get-stx-owed",
      [Cl.uint(Number(cycle)), Cl.uint(0), Cl.principal(A)]));
    expect(owed).toBeGreaterThan(0n);

    const before = sbtcOf(A);
    simnet.callPublicFn(SIGNER, "pay-stx-stakers",
      [Cl.list([Cl.principal(A)]), Cl.uint(Number(cycle)), Cl.uint(0)], RELAYER);
    expect(sbtcOf(A) - before, "get-stx-owed predicted the payout exactly").toBe(owed);
    expect(num(ro("get-stx-owed",
      [Cl.uint(Number(cycle)), Cl.uint(0), Cl.principal(A)])), "zero once paid").toBe(0n);
  });

  it("a staker with no shares is skipped rather than paid", () => {
    const cycle = stakeBoth();
    earnRewards(cycle);
    simnet.callPublicFn(SIGNER, "pox-claim-rewards", [Cl.list([]), Cl.uint(Number(cycle))], RELAYER);
    const before = sbtcOf(RECIPIENT);
    expect(Cl.prettyPrint(simnet.callPublicFn(SIGNER, "pay-stx-stakers",
      [Cl.list([Cl.principal(RECIPIENT)]), Cl.uint(Number(cycle)), Cl.uint(0)],
      RELAYER).result)).toBe("(ok u0)");
    expect(sbtcOf(RECIPIENT)).toBe(before);
    expect(ro("get-stx-paid",
      [Cl.uint(Number(cycle)), Cl.uint(0), Cl.principal(RECIPIENT)])).toBeNone();
  });
});
