// signer-gaps.test.ts -- the last error branches and read-onlys.
//
// Run: npx vitest run tests/signer-gaps.test.ts -- --manifest tests/cl-signer/Clarinet.toml
//
// Four codes the other two suites could not reach without extra setup:
//   u101 ERR_PAUSED      only reachable from validate-stake!, which only pox-5 may
//                        call -- so the pause has to be observed through a real stake
//   u103 ERR_SETTLE_FAILED  needs a settle pox-5 rejects
//   u104 ERR_TRANCHE_UNPAID needs a claimed tranche that has NOT been paid out
//   u109 ERR_NO_NEW_REWARDS needs a claim that comes back zero
import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";
import crypto from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";

const D = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const SIGNER = `${D}.juice-pool-stx-signer`;
const POX5 = "SP000000000000000000002Q6VF78.pox-5";
const SBTC_DEPOSIT = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-deposit";
const SBTC_SIGNER = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4";
const accounts = simnet.getAccounts();
const DEPLOYER = accounts.get("deployer")!;
const RELAYER = accounts.get("wallet_4")!;
const RANDOM = accounts.get("wallet_3")!;
const A = `${DEPLOYER}.zz-staker-a`;
const B = `${DEPLOYER}.zz-staker-b`;
const CHAIN_ID = 2147483648;
const E = { PAUSED: 101, SETTLE_FAILED: 103, TRANCHE_UNPAID: 104, NO_NEW_REWARDS: 109 };

const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest();
const cvHash = (cv: any) => sha256(Buffer.from(Cl.serialize(cv), "hex"));
const SIP018 = Buffer.from("534950303138", "hex");
const signerCV = Cl.contractPrincipal(D, "juice-pool-stx-signer");
const ro = (fn: string, args: any[] = []) => simnet.callReadOnlyFn(SIGNER, fn, args, D).result;

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
let salt = 0xa0;
function fundSbtcTo(to: string, amount: number) {
  const h = simnet.burnBlockHeight - 1;
  const hash = Cl.prettyPrint(simnet.callReadOnlyFn(`${DEPLOYER}.zz-nft`, "burn-hash",
    [Cl.uint(h)], DEPLOYER).result).replace(/^0x/, "");
  return simnet.callPublicFn(SBTC_DEPOSIT, "complete-deposit-wrapper",
    [Cl.bufferFromHex((++salt).toString(16).padStart(2, "0").repeat(32)), Cl.uint(0),
     Cl.uint(amount), Cl.principal(to), Cl.bufferFromHex(hash), Cl.uint(h),
     Cl.bufferFromHex("55".repeat(32))], SBTC_SIGNER);
}
function stakeBoth() {
  registerSigner();
  simnet.transferSTX(31_000_000_000, A, DEPLOYER);
  simnet.transferSTX(31_000_000_000, B, DEPLOYER);
  simnet.callPublicFn(A, "stake", [signerCV, Cl.uint(30_000_000_000)], RELAYER);
  simnet.callPublicFn(B, "stake", [signerCV, Cl.uint(30_000_000_000)], RELAYER);
  const info = Cl.prettyPrint(simnet.callReadOnlyFn(POX5, "get-staker-info",
    [Cl.principal(A)], D).result);
  return BigInt((info.match(/first-reward-cycle: u(\d+)/) || [])[1]);
}

describe("signer gaps: the pause is enforced where it matters", () => {
  it("u101 a PAUSED signer cannot be staked to", () => {
    // validate-stake! is pox-5's callback into the signer, so the pause is only
    // observable through a real stake attempt. This is the whole point of the flag:
    // it stops NEW delegation without touching existing positions.
    registerSigner();
    expect(simnet.callPublicFn(SIGNER, "set-paused", [Cl.bool(true)], D).result)
      .toBeOk(Cl.bool(true));
    simnet.transferSTX(31_000_000_000, A, DEPLOYER);
    const r = simnet.callPublicFn(A, "stake", [signerCV, Cl.uint(30_000_000_000)], RELAYER);
    expect(Cl.prettyPrint(r.result), "the stake must be rejected").toMatch(/^\(err /);
    expect(Cl.prettyPrint(r.result)).toContain(String(E.PAUSED));

    // unpausing lets the same stake through
    expect(simnet.callPublicFn(SIGNER, "set-paused", [Cl.bool(false)], D).result)
      .toBeOk(Cl.bool(true));
    expect(Cl.prettyPrint(simnet.callPublicFn(A, "stake",
      [signerCV, Cl.uint(30_000_000_000)], RELAYER).result)).toMatch(/^\(ok /);
  });
});

describe("signer gaps: tranche guards", () => {
  it("u104 sweep-tranche-dust on a claimed but UNPAID tranche", () => {
    const cycle = stakeBoth();
    simnet.mineEmptyBurnBlocks(1100);
    fundSbtcTo(POX5, 2_000_000);
    simnet.mineEmptyBurnBlocks(560);
    simnet.callPublicFn(POX5, "calculate-rewards", [Cl.list([])], RELAYER);
    expect(Cl.prettyPrint(simnet.callPublicFn(SIGNER, "pox-claim-rewards",
      [Cl.list([]), Cl.uint(Number(cycle))], RELAYER).result)).toMatch(/^\(ok /);

    // shares exist for the cycle but nothing has been paid, so paid-shares (0) is
    // below cycle-total-shares and the tranche is NOT fully paid
    expect(ro("is-tranche-fully-paid", [Cl.uint(Number(cycle)), Cl.uint(0)])).toBeBool(false);
    expect(simnet.callPublicFn(SIGNER, "sweep-tranche-dust",
      [Cl.uint(Number(cycle)), Cl.uint(0)], D).result).toBeErr(Cl.uint(E.TRANCHE_UNPAID));

    // paying makes it sweepable (the residue may legitimately be zero)
    simnet.callPublicFn(SIGNER, "pay-stx-stakers",
      [Cl.list([Cl.principal(A), Cl.principal(B)]), Cl.uint(Number(cycle)), Cl.uint(0)], RELAYER);
    expect(ro("is-tranche-fully-paid", [Cl.uint(Number(cycle)), Cl.uint(0)])).toBeBool(true);
    expect(Cl.prettyPrint(simnet.callPublicFn(SIGNER, "sweep-tranche-dust",
      [Cl.uint(Number(cycle)), Cl.uint(0)], D).result)).not.toContain(String(E.TRANCHE_UNPAID));
  });

  it("u109 is SHADOWED by pox-5: claim-rewards errors u32 first", () => {
    // The signer guards with (asserts! (> claimed u0) ERR_NO_NEW_REWARDS), but it sits
    // AFTER (try! (contract-call? POX5 claim-rewards ...)). When there is nothing to
    // claim pox-5 answers ERR_NO_CLAIMABLE_REWARDS u32 and the try! propagates that, so
    // u109 can only fire if pox-5 ever returns ok with total-rewards u0 -- no reachable
    // state produces that. Defence in depth, correct to keep, not coverable here.
    const cycle = stakeBoth();
    simnet.mineEmptyBurnBlocks(1100 + 560);
    simnet.callPublicFn(POX5, "calculate-rewards", [Cl.list([])], RELAYER);
    expect(simnet.callPublicFn(SIGNER, "pox-claim-rewards",
      [Cl.list([]), Cl.uint(Number(cycle))], RELAYER).result).toBeErr(Cl.uint(32));
    // the important property either way: no empty tranche is opened
    expect(ro("get-tranche-count", [Cl.uint(Number(cycle))])).toBeUint(0);
  });

  it("u103 is UNREACHABLE in simnet: settle is tolerant of every input tried", () => {
    // settle-one flags `failed` only if pox-5's claim-staker-rewards-for-signer errors,
    // and it does not error for: a future cycle, a bogus bond-index, a principal pox-5
    // has never seen, or an empty list. All four answer (ok u0), so the fold never sets
    // the flag and the assert never fires. Recorded rather than faked.
    const cycle = stakeBoth();
    simnet.mineEmptyBurnBlocks(1100);
    for (const [label, args] of [
      ["a future cycle", [Cl.list([Cl.principal(A)]), Cl.uint(99), Cl.none()]],
      ["a bogus bond-index", [Cl.list([Cl.principal(A)]), Cl.uint(Number(cycle)), Cl.some(Cl.uint(99))]],
      ["an unknown staker", [Cl.list([Cl.principal(RANDOM)]), Cl.uint(Number(cycle)), Cl.none()]],
      ["an empty batch", [Cl.list([]), Cl.uint(Number(cycle)), Cl.none()]],
    ] as [string, any[]][]) {
      expect(simnet.callPublicFn(SIGNER, "pox-settle-stakers", args, RELAYER).result, label)
        .toBeOk(Cl.uint(0));
    }
    // What DOES matter and is provable: the batch is all-or-nothing by construction --
    // settle-one only accumulates, and the assert at the end reverts the whole fold. So
    // a partial settle cannot be observed.
  });

});

describe("signer gaps: the pox-5 passthrough read-onlys", () => {
  it("report the signer's own view of a live cycle", () => {
    const cycle = stakeBoth();
    simnet.mineEmptyBurnBlocks(1100);
    // total shares for the cycle is what every payout divides by
    const total = Cl.prettyPrint(ro("get-cycle-total-shares", [Cl.uint(Number(cycle))]));
    expect(total).toMatch(/^u\d+$/);
    expect(BigInt(total.slice(1)), "two 30k stakes register shares").toBeGreaterThan(0n);

    expect(Cl.prettyPrint(ro("get-unclaimed-signer-rewards",
      [Cl.uint(Number(cycle)), Cl.none()]))).toMatch(/u\d+/);
    expect(Cl.prettyPrint(ro("get-staker-entitlement",
      [Cl.principal(A), Cl.uint(Number(cycle)), Cl.none()]))).toMatch(/u\d+/);
  });
});
