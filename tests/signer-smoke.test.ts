import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";
const D = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const SIGNER = `${D}.juice-pool-stx-signer`;
describe("harness", () => {
  it("deploys at its mainnet address with the deployer as admin", () => {
    expect(simnet.callReadOnlyFn(SIGNER, "get-admin", [], D).result).toBePrincipal(D);
    expect(simnet.callReadOnlyFn(SIGNER, "is-paused", [], D).result).toBeBool(false);
    expect(simnet.callReadOnlyFn(SIGNER, "get-fee-bips", [], D).result).toBeUint(0);
  });
});
