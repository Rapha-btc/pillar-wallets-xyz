// simul-c6-bisect.js
//
// juice-safe-v4 STILL aborts at Clarity 6 with
//   (err none) / ":0:0: attempted to obtain 'err' value from response,
//    but 'err' type is indeterminate"
// after removing the constant-target contract-call. So that was not the cause.
//
// This isolates the construct. Each probe is a minimal contract deployed at a
// chosen Clarity version. Whichever probe reproduces (err none) names the
// culprit; the same probe at Clarity 5 is the control.
//
// Run: node simul-c6-bisect.js
import { cvToString, deserializeCV } from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";

const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const STACKS_NODE_API = "http://77.42.3.101/stacks-api";
const SBTC = "'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";

// Each probe: [label, clarity_version, source]
const PROBES = [
  // baseline: does ANY trivial contract deploy at C6?
  ["baseline-c6", 6, `(define-data-var x uint u0)
(define-read-only (get-x) (var-get x))`],

  // try! over as-contract? -- 20 of these exist in the WORKING deployed v2 (C5)
  ["try-as-contract-c5", 5, `(define-public (f)
  (begin
    (try! (as-contract? ((with-stx u1)) (ok true)))
    (ok true)
  )
)`],
  ["try-as-contract-c6", 6, `(define-public (f)
  (begin
    (try! (as-contract? ((with-stx u1)) (ok true)))
    (ok true)
  )
)`],

  // as-contract? WITHOUT try! wrapping, at C6
  ["as-contract-bare-c6", 6, `(define-public (f)
  (as-contract? ((with-stx u1)) (ok true))
)`],

  // try! over a literal-target contract-call (what v4 now uses)
  ["try-literal-call-c6", 6, `(define-public (f)
  (let ((b (try! (contract-call? ${SBTC} get-balance tx-sender))))
    (ok b)
  )
)`],

  // the new pox allowances
  ["with-pox-c6", 6, `(define-public (f)
  (as-contract? ((with-pox)) (ok true))
)`],
  ["with-staking-c6", 6, `(define-public (f)
  (as-contract? ((with-staking u1)) (ok true))
)`],
  ["with-stacking-old-name-c6", 6, `(define-public (f)
  (as-contract? ((with-stacking u1)) (ok true))
)`],

  // nested try! inside as-contract? body -- the shape used all over the wallets
  ["nested-try-in-body-c6", 6, `(define-public (f)
  (try! (as-contract? ((with-stx u1))
    (try! (stx-transfer? u1 tx-sender 'SP000000000000000000002Q6VF78))
  ))
)`],
];

async function main() {
  const b = SimulationBuilder.new({ stacksNodeAPI: STACKS_NODE_API });
  b.withSender(DEPLOYER);
  const plan = [];
  PROBES.forEach(([label, cv, src], i) => {
    b.addContractDeploy({
      contract_name: `zzp-${i}-${label}`.slice(0, 40),
      source_code: src,
      clarity_version: cv,
    });
    plan.push({ label, cv });
  });

  const id = await b.run();
  console.log(`\nsimulation: https://stxer.xyz/simulations/mainnet/${id}\n`);
  const res = await getSimulationResult(id);

  res.steps.forEach((s, i) => {
    const p = plan[i];
    if (!p) return;
    const r = s?.Result?.Transaction;
    let verdict, detail = "";
    if (!r) verdict = "NO-RESULT";
    else if ("Err" in r) { verdict = "ENGINE-ERR"; detail = JSON.stringify(r.Err).slice(0, 160); }
    else {
      const ok = r.Ok;
      if (ok.vm_error) { verdict = "ABORT"; detail = ok.vm_error; }
      else {
        try { detail = cvToString(deserializeCV(ok.result)); } catch { detail = ok.result; }
        verdict = String(detail).startsWith("(err") ? "ABORT" : "DEPLOYED";
      }
    }
    console.log(`${verdict.padEnd(11)} C${p.cv}  ${p.label}`);
    if (detail) console.log(`            ${String(detail).slice(0, 150)}`);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
