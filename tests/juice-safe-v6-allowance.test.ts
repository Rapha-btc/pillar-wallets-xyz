// juice-safe-v6-allowance.test.ts -- a TOOLING guard, not a contract test.
//
// Run: npx vitest run tests/juice-safe-v6-allowance.test.ts -- --manifest tests/cl-v6/Clarinet.toml
//
// PROVES that clarinet's simnet does NOT enforce the SIP-044 (with-staking N)
// allowance. tests/cl-v6/contracts/zz-allowance-probe.clar stakes a real 51k STX
// twice: once declaring the correct amount, once declaring u1. BOTH succeed.
//
// Why it matters: an under-declared stacking allowance is exactly what broke
// juice-safe-v0 on mainnet -- its unstake declared (with-staking (locked-ustx)) and
// could never succeed, returning (err u128) MAX_ALLOWANCES. A developer "fixing" an
// allowance and seeing green in clarinet would ship that bug. Only stxer catches it,
// because the node's PoX handler actually applies the lock there
// (stxer/stxer-sdk#7) and the asset-map stacking entry exists to check against.
//
// If a future clarinet starts enforcing this, the second test FAILS -- which is the
// signal that the gap closed and stxer is no longer the only witness.
import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";
import crypto from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";

const D = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const SIGNER = `${D}.juice-pool-stx-signer`;
const accounts = simnet.getAccounts();
const DEPLOYER = accounts.get("deployer")!;
const RELAYER = accounts.get("wallet_4")!;
const PROBE = `${DEPLOYER}.zz-allowance-probe`;
const STAKE = 51_000_000_000; // over pox-5's 50k SIGNER_SET_MIN_USTX

const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest();
const cvHash = (cv: any) => sha256(Buffer.from(Cl.serialize(cv), "hex"));
const SIP018 = Buffer.from("534950303138", "hex");
const priv = Buffer.from("11".repeat(32), "hex");
const pub = secp256k1.getPublicKey(priv, true);

function registerSigner() {
  const domain = cvHash(Cl.tuple({
    name: Cl.stringAscii("pox-5-signer"), version: Cl.stringAscii("1.0.0"),
    "chain-id": Cl.uint(2147483648),
  }));
  const struct = cvHash(Cl.tuple({
    topic: Cl.stringAscii("grant-authorization"),
    "signer-manager": Cl.contractPrincipal(D, "juice-pool-stx-signer"),
    "auth-id": Cl.uint(1),
  }));
  const hash = sha256(Buffer.concat([SIP018, domain, struct]));
  const compact = Buffer.from(secp256k1.sign(hash, priv, { prehash: false }));
  for (const rec of [0, 1]) {
    const r = simnet.callPublicFn(SIGNER, "register-self",
      [Cl.contractPrincipal(D, "juice-pool-stx-signer"),
       Cl.bufferFromHex(Buffer.from(pub).toString("hex")), Cl.uint(1),
       Cl.bufferFromHex(Buffer.concat([compact, Buffer.from([rec])]).toString("hex"))],
      D);
    if (Cl.prettyPrint(r.result).startsWith("(ok")) return;
  }
  throw new Error("signer registration failed");
}
const setup = () => { registerSigner(); simnet.transferSTX(60_000_000_000, PROBE, DEPLOYER); };
const signerCV = Cl.contractPrincipal(D, "juice-pool-stx-signer");

describe("simnet allowance enforcement: the control", () => {
  it("a CORRECTLY declared (with-staking amount) succeeds", () => {
    setup();
    expect(Cl.prettyPrint(simnet.callPublicFn(PROBE, "stake-declared",
      [signerCV, Cl.uint(STAKE)], RELAYER).result)).toMatch(/^\(ok /);
  });
});

describe("simnet allowance enforcement: the finding", () => {
  it("an UNDER-declared (with-staking u1) ALSO succeeds -- simnet does not enforce it", () => {
    setup();
    const r = simnet.callPublicFn(PROBE, "stake-underdeclared",
      [signerCV, Cl.uint(STAKE)], RELAYER);
    // On mainnet this must abort: 51,000 STX moves under an allowance of u1.
    // Here it does not. If this ever starts failing, clarinet gained the check.
    expect(Cl.prettyPrint(r.result)).toMatch(/^\(ok /);
    expect(Cl.prettyPrint(r.result)).toContain(`amount-ustx: u${STAKE}`);
  });
});
