// simul-allowance-probe.js
// Does (with-stacking N) actually get ENFORCED on a pox-5 stake-update, at the
// block the call happens?
//
// WHY THIS EXISTS (historical). Before stxer fixed its PoX lock handler
// (stxer/stxer-sdk#7), runs showed stx-account reporting
// `locked u0` even with a live staker-info -- the lock is scheduled for
// first-reward-cycle, not applied on the spot. If the node writes no stacking
// entry at this block, then assets.get_stacking(owner) is None, the whole
// allowance branch is SKIPPED, and a top-up passes no matter what number the
// allowance names. That would make the "top-up works" pass in that run vacuous,
// and would leave the amount-increase-vs-total fix unverified.
//
// So: two contracts, identical except for the allowance on stake-update.
//   zz-allow-buggy  -> (with-stacking amount-increase)                  [wrong]
//   zz-allow-fixed  -> (with-stacking (+ locked amount-increase))       [ours]
// Each stakes, then tops up.
//
// READING THE RESULT:
//   buggy top-up ABORTS + fixed top-up OK  -> allowance IS enforced here, and
//                                             the fix is what makes it pass.
//   BOTH OK                                -> not enforced at this block; the
//                                             fix is harmless but unproven, and
//                                             the real exposure is a top-up made
//                                             once the lock is actually applied.
//   BOTH ABORT                             -> something else is wrong; read the
//                                             error rather than concluding.
//
// Run: node simul-allowance-probe.js
import {
  uintCV,
  cvToString,
  deserializeCV,
  ClarityVersion,
  PostConditionMode,
} from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";

const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const STX_WHALE = "SP9BP4PN74CNR5XT7CMAMBPA0GWC9HMB69HVVV51";
const STACKS_NODE_API = "http://77.42.3.101/stacks-api";

const FUND = 1_500_000_000;
const STAKE = 1_000_000_000;
const TOPUP = 200_000_000;

// The only difference between the two is the ALLOWANCE expression.
const src = (allowance) => `(define-constant POX5 'SP000000000000000000002Q6VF78.pox-5)
(define-constant SIGNER 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-pool-stx-signer)
(define-read-only (locked-ustx) (get locked (stx-account current-contract)))
(define-public (go-stake (amount uint))
  (begin
    (try! (as-contract? ((with-stacking amount))
      (try! (contract-call? POX5 stake SIGNER amount u96 burn-block-height none))))
    (ok true)))
(define-public (go-topup (amount-increase uint))
  (begin
    (try! (as-contract? ((with-stacking ${allowance}))
      (try! (contract-call? POX5 stake-update SIGNER SIGNER u0 amount-increase none))))
    (ok true)))`;

async function main() {
  const plan = [];
  const b = SimulationBuilder.new({ stacksNodeAPI: STACKS_NODE_API });
  const call = (label, cid, fn, args, note) => {
    b.withSender(DEPLOYER).addContractCall({
      contract_id: cid, function_name: fn, function_args: args,
      post_condition_mode: PostConditionMode.Allow,
    });
    plan.push({ kind: "tx", label, note });
  };

  for (const [name, allowance] of [
    ["zz-allow-buggy", "amount-increase"],
    ["zz-allow-fixed", "(+ (locked-ustx) amount-increase)"],
  ]) {
    b.withSender(DEPLOYER).addContractDeploy({
      contract_name: name,
      source_code: src(allowance),
      clarity_version: ClarityVersion.Clarity5,
    });
    plan.push({ kind: "deploy", label: `deploy ${name}  [with-stacking ${allowance}]` });
    b.withSender(STX_WHALE).addSTXTransfer({
      recipient: `${DEPLOYER}.${name}`, amount: FUND,
    });
    plan.push({ kind: "fund", label: `fund ${name}` });
    call(`${name}: go-stake ${STAKE / 1e6} STX`, `${DEPLOYER}.${name}`, "go-stake", [uintCV(STAKE)]);
    call(`${name}: go-topup +${TOPUP / 1e6} STX   <-- THE DISCRIMINATOR`,
      `${DEPLOYER}.${name}`, "go-topup", [uintCV(TOPUP)]);
    b.addEvalCode(`${DEPLOYER}.${name}`, `(stx-account '${DEPLOYER}.${name})`);
    plan.push({ kind: "eval", label: `${name}: stx-account` });
    b.addEvalCode(`${DEPLOYER}.${name}`,
      `(contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-staker-info '${DEPLOYER}.${name})`);
    plan.push({ kind: "eval", label: `${name}: staker-info` });
  }

  console.log("=== with-stacking enforcement probe ===\n");
  const sessionId = await b.run();
  const url = `https://stxer.xyz/simulations/mainnet/${sessionId}`;
  console.log(`Submitted: ${url}\n`);
  const res = await getSimulationResult(sessionId);

  const dec = (s) => {
    const r = s?.Result?.Transaction;
    if (!r) return "<none>";
    if ("Err" in r) return `ABORT: ${JSON.stringify(r.Err).slice(0, 200)}`;
    try { return cvToString(deserializeCV(r.Ok.result)); } catch (e) { return `dec-fail: ${e.message}`; }
  };
  const decEval = (s) => {
    const r = s?.Result?.Eval;
    if (!r || !("Ok" in r)) return `<eval err>`;
    try { return cvToString(deserializeCV(r.Ok)); } catch { return r.Ok; }
  };

  res.steps.forEach((s, i) => {
    const p = plan[i];
    if (!p) return;
    if (p.kind === "eval") { console.log(`INFO [${i}] ${p.label}: ${decEval(s).slice(0, 170)}`); return; }
    const d = dec(s);
    console.log(`     [${i}] ${p.label}\n           ${d.slice(0, 190)}`);
  });
  console.log(`\nView: ${url}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
