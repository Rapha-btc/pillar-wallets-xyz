// juice-autostake-safe-memo.test.ts -- the mv8wal #3 memo binding on the autostake safe.
//
// Run: npx vitest run tests/juice-autostake-safe-memo.test.ts -- --manifest tests/cl-v7/Clarinet.toml
//
// Deploy layout as in juice-autostake-safe-keeper.test.ts: the stand-in pool (live
// juice-pool-stx-signer source), the helper and the safe at SPV9K21T....
import fs from "node:fs";
import { expect } from "vitest";
import { D, memoBindingSuite } from "./memo-binding-cases";

const POOL_SRC = fs.readFileSync(
  ".cache/requirements/SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-pool-stx-signer.clar", "utf8");
const HELPER_SRC = fs.readFileSync("contracts/juice-autostake-safe-auth-helpers-v1.clar", "utf8");
const WALLET_SRC = fs.readFileSync("contracts/juice-autostake-safe.clar", "utf8");

memoBindingSuite("juice-autostake-safe", () => {
  expect(simnet.deployContract("juice-pool-sbtc-signer", POOL_SRC, { clarityVersion: 5 }, D).result).toBeBool(true);
  expect(simnet.deployContract("juice-autostake-safe-auth-helpers-v1", HELPER_SRC, { clarityVersion: 4 }, D).result).toBeBool(true);
  expect(simnet.deployContract("juice-autostake-safe", WALLET_SRC, { clarityVersion: 6 }, D).result).toBeBool(true);
});
