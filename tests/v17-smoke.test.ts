import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";
import fs from "node:fs";
const D = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const WD = process.env.V17_DEPLOYER ?? D;
const WALLET = `${WD}.fakfun-wallet-v17`;
const SRC = fs.readFileSync("contracts/fakfun-wallet-v17.clar", "utf8");
// see tests/cl-v17/Clarinet.toml for why this is not a requirement
export function deployV17() {
  return simnet.deployContract("fakfun-wallet-v17", SRC, { clarityVersion: 6 }, WD);
}
describe("v16 harness", () => {
  // In coverage mode (V17_DEPLOYER set) the wallet is a plan-instrumented contract,
  // so deployV17() is a no-op; this test exercises the in-test publish path only.
  it.skipIf(!!process.env.V17_DEPLOYER)("publishes at its real mainnet address, uninitialised", () => {
    expect(deployV17().result).toBeBool(true);
    expect(simnet.callReadOnlyFn(WALLET, "get-owner", [], D).result)
      .toBeOk(Cl.principal("SP000000000000000000002Q6VF78"));
    expect(simnet.callReadOnlyFn(`${D}.juice-pool-stx-signer`, "get-admin", [], D).result)
      .toBePrincipal(D);
  });
});
