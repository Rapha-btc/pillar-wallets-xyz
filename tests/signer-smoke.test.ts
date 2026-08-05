import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";
// SIGNER_DEPLOYER lets the coverage harness (tests/cl-signer-cov) publish the signer
// locally, since clarinet --coverage only instruments project contracts. Unset -- the
// normal case -- it is the real mainnet deployer, which is also the admin because
// `admin` is set to tx-sender at deploy.
const D = process.env.SIGNER_DEPLOYER ?? "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const SIGNER = `${D}.juice-pool-stx-signer`;
describe("harness", () => {
  it("deploys at its mainnet address with the deployer as admin", () => {
    expect(simnet.callReadOnlyFn(SIGNER, "get-admin", [], D).result).toBePrincipal(D);
    expect(simnet.callReadOnlyFn(SIGNER, "is-paused", [], D).result).toBeBool(false);
    expect(simnet.callReadOnlyFn(SIGNER, "get-fee-bips", [], D).result).toBeUint(0);
  });
});
