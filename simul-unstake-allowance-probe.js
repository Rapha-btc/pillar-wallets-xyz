// Which allowance does pox-5 unstake actually require, now that stxer applies
// real locks? The shipped v0 declared (with-stacking (locked-ustx))
// and that returned (err u128) = MAX_ALLOWANCES = "an asset class moved with no
// allowance covering it". Four variants, identical otherwise.
import { uintCV, cvToString, deserializeCV, ClarityVersion, PostConditionMode } from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";

const D = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const WHALE = "SP9BP4PN74CNR5XT7CMAMBPA0GWC9HMB69HVVV51";
const API = "http://77.42.3.101/stacks-api";
const STAKE = 500_000_000;

const src = (allow) => `(define-constant POX5 'SP000000000000000000002Q6VF78.pox-5)
(define-constant SIGNER 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-pool-stx-signer)
(define-read-only (locked-ustx) (get locked (stx-account current-contract)))
(define-public (go-stake (amount uint))
  (begin (try! (as-contract? ((with-stacking amount))
    (try! (contract-call? POX5 stake SIGNER amount u96 burn-block-height none)))) (ok true)))
(define-public (go-unstake)
  (begin (try! (as-contract? (${allow})
    (try! (contract-call? POX5 unstake SIGNER)))) (ok true)))`;

const VARIANTS = [
  ["zz-un-empty",  "",                         "empty allowance list"],
  ["zz-un-unsafe", "(with-all-assets-unsafe)", "escape hatch"],
];

const plan = [];
const b = SimulationBuilder.new({ stacksNodeAPI: API });
for (const [name, allow, note] of VARIANTS) {
  b.withSender(D).addContractDeploy({ contract_name: name, source_code: src(allow), clarity_version: ClarityVersion.Clarity5 });
  plan.push(`deploy ${name}`);
  b.withSender(WHALE).addSTXTransfer({ recipient: `${D}.${name}`, amount: 600_000_000 });
  plan.push(`fund ${name}`);
  b.withSender(D).addContractCall({ contract_id: `${D}.${name}`, function_name: "go-stake", function_args: [uintCV(STAKE)], post_condition_mode: PostConditionMode.Allow });
  plan.push(`${name}: stake`);
  b.withSender(D).addContractCall({ contract_id: `${D}.${name}`, function_name: "go-unstake", function_args: [], post_condition_mode: PostConditionMode.Allow });
  plan.push(`${name}: UNSTAKE  [${allow || "()"}]  -- ${note}`);
}

const id = await b.run();
console.log(`https://stxer.xyz/simulations/mainnet/${id}\n`);
const res = await getSimulationResult(id);
res.steps.forEach((s, i) => {
  const t = s?.Result?.Transaction; if (!t) return;
  const o = "Err" in t ? "ABORT" : cvToString(deserializeCV(t.Ok.result));
  if (plan[i]?.includes("UNSTAKE")) console.log(`  ${o.padEnd(12)} <- ${plan[i]}`);
});
