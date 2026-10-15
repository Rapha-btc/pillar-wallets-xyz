// juice-safe-v9-memo.test.ts -- juice-safe-v9 = v8 + the mv8wal #3 memo binding.
//
// Run: npx vitest run tests/juice-safe-v9-memo.test.ts -- --manifest tests/cl-v8/Clarinet.toml
//
// v9 is not deployed; it is deployed here at its real SPV9K21T... address from
// contracts/juice-safe-v9.clar (Clarity 6, same as the v8 requirement).
import fs from "node:fs";
import { expect } from "vitest";
import { D, memoBindingSuite } from "./memo-binding-cases";

const SRC = fs.readFileSync("contracts/juice-safe-v9.clar", "utf8");

memoBindingSuite("juice-safe-v9", () => {
  expect(simnet.deployContract("juice-safe-v9", SRC, { clarityVersion: 6 }, D).result).toBeBool(true);
});
