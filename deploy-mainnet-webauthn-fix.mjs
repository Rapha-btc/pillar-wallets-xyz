// deploy-mainnet-webauthn-fix.mjs
// ---------------------------------------------------------------------------
// Deploys the H-01 fix to MAINNET, in order:
//   1. clarity-5-webauthn-v4  (the anchoring fix)
//   2. juice-safe-v7          (repointed to v4)  -- ONLY after v4 confirms
// Both as Clarity 6 (matching the deployed juice-safe-v6).
//
// SAFETY: dry-run by default. It prints exactly what it will do and STOPS.
// Add --confirm to actually broadcast. Real STX, irreversible.
//
//   DEPLOYER_KEY=<hex privkey of SPV9K21...>  node deploy-mainnet-webauthn-fix.mjs            # dry run
//   DEPLOYER_KEY=<hex privkey of SPV9K21...>  node deploy-mainnet-webauthn-fix.mjs --confirm  # go
//
// Fees default to generous values; override with V4_FEE_USTX / V7_FEE_USTX.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import {
  makeContractDeploy, broadcastTransaction, getAddressFromPrivateKey,
} from "@stacks/transactions";

const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const API = process.env.STACKS_API || "https://api.hiro.so";
const CONFIRM = process.argv.includes("--confirm");
const CLARITY6 = 6;
const V4_FEE = BigInt(process.env.V4_FEE_USTX || 1_000_000); // 1 STX
const V7_FEE = BigInt(process.env.V7_FEE_USTX || 3_000_000); // 3 STX

const KEY = process.env.DEPLOYER_KEY;
if (!KEY) { console.error("Set DEPLOYER_KEY (hex private key of the deployer)."); process.exit(1); }

const contracts = [
  { name: "clarity-5-webauthn-v4", path: "./contracts/clarity-5-webauthn-v4.clar", fee: V4_FEE },
  { name: "juice-safe-v7",          path: "./contracts/juice-safe-v7.clar",          fee: V7_FEE },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getNonce(addr) {
  const r = await fetch(`${API}/v2/accounts/${addr}?proof=0`);
  return BigInt((await r.json()).nonce);
}
async function waitConfirmed(txid) {
  for (let i = 0; i < 120; i++) { // ~ up to ~40 min
    const r = await fetch(`${API}/extended/v1/tx/0x${txid.replace(/^0x/, "")}`);
    if (r.ok) {
      const d = await r.json();
      if (d.tx_status === "success") return { ok: true, d };
      if (d.tx_status && d.tx_status.startsWith("abort")) return { ok: false, d };
    }
    await sleep(20_000);
  }
  return { ok: false, timeout: true };
}

async function main() {
  const from = getAddressFromPrivateKey(KEY, "mainnet");
  console.log(`deployer key resolves to: ${from}`);
  if (from !== DEPLOYER) {
    console.error(`REFUSING: key is ${from}, expected ${DEPLOYER}. Wrong key.`);
    process.exit(1);
  }
  for (const c of contracts) {
    const src = fs.readFileSync(c.path, "utf8");
    console.log(`\n- ${c.name}: ${src.length} bytes, Clarity ${CLARITY6}, fee ${Number(c.fee) / 1e6} STX -> ${DEPLOYER}.${c.name}`);
  }
  if (!CONFIRM) {
    console.log("\nDRY RUN. Nothing broadcast. Re-run with --confirm to deploy for real.");
    console.log("Order enforced: v4 is broadcast and CONFIRMED before v7 (v7 references v4).");
    return;
  }

  let nonce = await getNonce(DEPLOYER);
  for (const c of contracts) {
    const src = fs.readFileSync(c.path, "utf8");
    console.log(`\nDeploying ${c.name} (nonce ${nonce}, fee ${Number(c.fee) / 1e6} STX)...`);
    const tx = await makeContractDeploy({
      contractName: c.name, codeBody: src, senderKey: KEY,
      network: "mainnet", clarityVersion: CLARITY6, fee: c.fee, nonce,
    });
    const res = await broadcastTransaction({ transaction: tx, network: "mainnet" });
    if (res.error) { console.error(`BROADCAST FAILED: ${JSON.stringify(res)}`); process.exit(1); }
    const txid = res.txid;
    console.log(`  broadcast: https://explorer.hiro.so/txid/0x${txid}?chain=mainnet`);
    console.log(`  waiting for confirmation before continuing...`);
    const w = await waitConfirmed(txid);
    if (!w.ok) { console.error(`  ${c.name} did NOT confirm (${w.timeout ? "timeout" : w.d?.tx_status}). STOPPING.`); process.exit(1); }
    console.log(`  CONFIRMED: ${c.name}`);
    nonce += 1n;
  }
  console.log("\nBoth deployed. Next: onboard a fresh test safe pointing at juice-safe-v7 and run one real passkey transfer as the mainnet smoke test.");
}
main().catch((e) => { console.error(e); process.exit(1); });
