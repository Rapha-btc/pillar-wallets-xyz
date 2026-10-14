// gen-plan.mjs -- regenerate the simnet plan and append the "rv-setup" batch:
// real-path setup the fuzz accounts cannot do themselves (emulated senders).
//   1. core-v2 admin (SPV9K21T...) verifies the safe's contract hash
//   2. the pool registers in pox-5 through the real grant signature (keys.mjs)
//   3. the real FAKFUN-DEPLOYER onboards the safe with the test passkey
//   4. wallet_3 funds the safe (STX, zz-ft, one zz-nft). sBTC is NOT funded
//      here: simnet credits genesis sBTC only after the plan runs, so the
//      fuzzers fund it (rv-fund-sbtc / test-zz-fund).
// Run via ./build.sh (from tests/rv/juice-autostake-safe).
import { execSync } from "node:child_process";
import fs from "node:fs";
import { DEPLOYER, PASSKEY_PUB, SIGNER_PUB, grantSignature } from "./keys.mjs";

const PLAN = "deployments/default.simnet-plan.yaml";
fs.rmSync(PLAN, { force: true });
execSync("clarinet deployments generate --simnet", { stdio: "ignore" });
let plan = fs.readFileSync(PLAN, "utf8");
const ids = [...plan.matchAll(/^  - id: (\d+)$/gm)].map((m) => Number(m[1]));
const id = Math.max(...ids) + 1;
const OWNER = "ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5"; // wallet_1
const RECOVERY = "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG"; // wallet_2
const FUNDER = "ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC"; // wallet_3
const call = (contract, sender, method, params) =>
  `    - transaction-type: emulated-contract-call\n` +
  `      contract-id: ${contract}\n      emulated-sender: ${sender}\n      method: ${method}\n` +
  `      parameters:${params.length ? "" : " []"}\n` + params.map((p) => `      - '${p.replace(/'/g, "''")}'\n`).join("");
const SAFE = `${DEPLOYER}.juice-autostake-safe`;
plan = plan.trimEnd() + "\n" +
  `  - id: ${id}\n    transactions:\n` +
  call("SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2", "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22",
    "set-verified-contract", [`'${SAFE}`, "none"]) +
  call(`${DEPLOYER}.juice-autostake-pool`, DEPLOYER, "register-self",
    [`'${DEPLOYER}.juice-autostake-pool`, `0x${SIGNER_PUB.toString("hex")}`, "u1", `0x${grantSignature().toString("hex")}`]) +
  call(SAFE, "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK", "onboard",
    [`0x${PASSKEY_PUB.toString("hex")}`, `'${OWNER}`, `'${RECOVERY}`, "u1000000000", "u1000000", "u144"]) +
  call(SAFE, FUNDER, "rv-fund", ["u1999000000"]) +
  call(SAFE, FUNDER, "rv-fund-ft", ["u999999"]) +
  call(SAFE, FUNDER, "rv-fund-nft", []) +
  `    epoch: '4.0'\n`;
fs.writeFileSync(PLAN, plan);
console.log(`plan: rv-setup batch id ${id}`);
