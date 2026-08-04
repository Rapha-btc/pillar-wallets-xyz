// simul-deploy-v4-v14.js
//
// Does the DEPLOY ITSELF succeed? That is the whole question here.
//
// juice-safe-v3 and fakfun-wallet-v12 both aborted on mainnet with
// abort_by_response / (err none):
//   0xc84209a5e957bbf9d54bf53dd9bd11f02b62b329c994c7e16f6f732925e9c166
//   0x34aa030406e00381dbed2e7dd0c40d80134700c6bcb485f75138b26096c1fe64
//   vm_error ":0:0: attempted to obtain 'err' value from response, but 'err'
//   type is indeterminate"
//
// CAUSE (bisected in simul-c6-bisect.js, NOT the first guess): `try!` over the
// get-balance contract-call in pay-gas-accounted. try! must read the err value
// out in order to propagate it, which requires the err type to be resolved. At
// Clarity 6 it is not, so contract INIT aborts before any function can run.
// It reproduces in isolation with a LITERAL target, so the SBTC-CONTRACT
// constant -- the first suspect -- was never the problem.
//
// FIX: unwrap-panic, which discards the err instead of reading it and so needs
// no err type. That is what the code originally used; it was changed to try!
// purely to silence a clarinet warning. The warning was wrong and the
// unwrap-panic was load-bearing.
//
// The same bisect also confirmed with-stacking is REMOVED at Clarity 6
// ("use of unresolved function 'with-stacking'"), so the with-staking rename
// was required, not cosmetic.
//
// clarinet cannot catch any of this: 3.19.0 and 3.23.1 both accept a completely
// made-up allowance form and both accept `no-such-method` on a constant target.
// stxer running the real VM is the only pre-deploy check that would have.
//
// Run: node simul-deploy-v4-v14.js
import fs from "node:fs";
import { ClarityVersion, cvToString, deserializeCV } from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";

const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
// Own node: dodges Hiro 429s on a payload this size (~46KB + ~72KB).
const STACKS_NODE_API = "http://77.42.3.101/stacks-api";

// Clarity 6 -- (with-pox) and with-staking do not exist below it. The enum in
// this repo's @stacks/transactions may predate Clarity6, so fall back to the
// raw version byte rather than silently deploying at 5 (which would "pass" the
// sim while testing the wrong thing).
const CLARITY_6 = ClarityVersion.Clarity6 ?? 6;

const TARGETS = [
  { name: "juice-safe-v4", path: "contracts/juice-safe-v4.clar" },
  { name: "fakfun-wallet-v14", path: "contracts/fakfun-wallet-v14.clar" },
];

// Same stripper the deploy templates are generated with, so the bytes simulated
// are the bytes deployed. A sim of the commented source would prove nothing
// about the artifact that actually goes on chain.
function stripComments(src) {
  const out = [];
  for (const line of src.split("\n")) {
    let inq = false, cut = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inq = !inq;
      else if (c === ";" && !inq && line[i + 1] === ";") { cut = i; break; }
    }
    out.push((cut === null ? line : line.slice(0, cut)).replace(/\s+$/, ""));
  }
  const res = [];
  let blank = false;
  for (const l of out) {
    if (!l) { if (!blank && res.length) res.push(""); blank = true; }
    else { res.push(l); blank = false; }
  }
  while (res.length && !res[res.length - 1]) res.pop();
  return res.join("\n");
}

async function main() {
  console.log(`Clarity version for deploy: ${CLARITY_6}`);
  const b = SimulationBuilder.new({ stacksNodeAPI: STACKS_NODE_API });
  b.withSender(DEPLOYER);

  const plan = [];
  for (const t of TARGETS) {
    const source = stripComments(fs.readFileSync(t.path, "utf8"));
    if (source.includes("`") || source.includes("${")) {
      throw new Error(`${t.name}: template-literal hazard in stripped source`);
    }
    // The exact regression, asserted before we spend a simulation on it.
    if (/try!\s*\(contract-call\?\s+SBTC-CONTRACT/.test(source)) {
      throw new Error(`${t.name}: still has try! over a constant-target contract-call`);
    }
    console.log(`  ${t.name}: ${source.length} bytes, ${source.split("\n").length} lines`);
    b.addContractDeploy({
      contract_name: t.name,
      source_code: source,
      clarity_version: CLARITY_6,
    });
    plan.push({ kind: "deploy", label: `deploy ${t.name} (Clarity ${CLARITY_6})` });

    // Contract init already ran by here. Reading a data var proves the contract
    // exists and its top level completed -- the precise thing that failed
    // before. spent-this-period also shows the new `gas` counter is present.
    b.addEvalCode(`${DEPLOYER}.${t.name}`, `(var-get spent-this-period)`);
    plan.push({ kind: "eval", label: `${t.name}: spent-this-period (expect gas: u0)` });
    b.addEvalCode(`${DEPLOYER}.${t.name}`, `(get-owner)`);
    plan.push({ kind: "eval", label: `${t.name}: get-owner` });
  }

  const id = await b.run();
  console.log(`\nsimulation: https://stxer.xyz/simulations/mainnet/${id}\n`);

  const res = await getSimulationResult(id);

  let pass = 0, fail = 0;
  res.steps.forEach((s, i) => {
    const p = plan[i];
    if (!p) return;
    const r = s?.Result?.Transaction ?? s?.Result?.Eval;
    let verdict, detail = "";
    if (!r) { verdict = "NO-RESULT"; }
    else if ("Err" in r) { verdict = "FAIL"; detail = JSON.stringify(r.Err).slice(0, 200); }
    else if (p.kind === "eval") {
      verdict = "info";
      try { detail = cvToString(deserializeCV(r.Ok)); } catch { detail = String(r.Ok).slice(0, 120); }
    } else {
      const ok = r.Ok;
      if (ok.vm_error) { verdict = "FAIL"; detail = ok.vm_error; }
      else {
        try { detail = cvToString(deserializeCV(ok.result)); } catch { detail = ok.result; }
        verdict = String(detail).startsWith("(err") ? "FAIL" : "ok";
      }
    }
    if (verdict === "FAIL" || verdict === "NO-RESULT") fail++;
    else if (verdict === "ok") pass++;
    console.log(`${verdict.padEnd(9)} ${p.label}`);
    if (detail) console.log(`          ${String(detail).slice(0, 160)}`);
  });

  console.log(`\n${pass} deployed / ${fail} failed`);
  if (fail) { console.log("\nDEPLOY STILL BROKEN - do not broadcast."); process.exit(1); }
  console.log("\nBoth contracts initialise cleanly at Clarity 6.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
