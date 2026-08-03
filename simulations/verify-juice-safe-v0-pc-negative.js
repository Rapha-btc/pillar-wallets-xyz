// verify-juice-safe-v0-pc-negative.js
//
// NEGATIVE CONTROL for the one line in juice-safe-v0 that cost two failed
// mainnet transactions:
//
//     (as-contract? ((with-stacking (+ (locked-ustx) amount-increase)))
//                                    ^^^^^^^^^^^^^^^^
//
// Epoch 4.0's stacking allowance is metered against the TOTAL resulting lock,
// not the delta: the node logs amount_locked() AFTER applying the lock and
// INSERTS that into the asset map, and the check is
// `stacked > allowance -> violation`. So declaring only amount-increase must
// abort any top-up onto an existing position, because existing+increase always
// exceeds increase.
//
// The main harness (verify-juice-safe-v0-staking.js) shows the real contract's
// top-up SUCCEEDS. On its own that proves nothing about the (locked-ustx)
// term -- a fork that does not enforce the allowance at all would look exactly
// the same. This harness settles it by running the IDENTICAL top-up against
// two freshly deployed copies that differ in that one expression:
//
//     ctrl   -- unpatched: (+ (locked-ustx) amount-increase)
//     pcbug  -- patched:   amount-increase        <- the bug that hit mainnet
//
// READ THE RESULT LIKE THIS:
//   ctrl ok + pcbug ABORTED  -> the fork enforces it; the fix is proven here.
//   ctrl ok + pcbug ok       -> the fork does NOT model epoch-4.0 STX locking,
//                               so stxer cannot verify this property at all and
//                               the mainnet evidence stands as the only proof.
//   ctrl aborted             -> something else is wrong; investigate.
//
// Run: node simulations/verify-juice-safe-v0-pc-negative.js
import fs from "node:fs";
import {
  uintCV,
  bufferCV,
  noneCV,
  standardPrincipalCV,
  contractPrincipalCV,
  deserializeCV,
  cvToString,
  ClarityVersion,
} from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";

const pcv = (s) =>
  s.includes(".")
    ? contractPrincipalCV(s.split(".")[0], s.split(".")[1])
    : standardPrincipalCV(s);

const SAFE_DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const CORE = `${SAFE_DEPLOYER}.fakfun-wallet-core`;
const POX5 = "SP000000000000000000002Q6VF78.pox-5";
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";

// Deploys the copies, owns them, and funds them. 4.0M free STX on mainnet.
const OWNER = "SP3V37N4ZV9JSE4J7KY58Z3S65HV7K5RKE829JS25";

const STX = (n) => BigInt(n) * 1_000_000n;
const FUND = STX(120_000);
const STAKE = STX(60_000);
const TOPUP = STX(20_000);

const SRC = fs.readFileSync("./contracts/juice-safe-v0.clar", "utf8");

const CTRL = "js-ctrl";
const PCBUG = "js-pcbug";

// Each copy must register its OWN hash, so the register-wallet reference
// inside onboard has to point at the copy rather than the mainnet original.
function sourceFor(name, breakAllowance) {
  let s = SRC.replaceAll(
    `'${SAFE_DEPLOYER}.juice-safe-v0`,
    `'${OWNER}.${name}`
  );
  if (breakAllowance) {
    const from = "(with-stacking (+ (locked-ustx) amount-increase))";
    const to = "(with-stacking amount-increase)";
    if (!s.includes(from)) throw new Error("allowance expression not found to patch");
    s = s.replace(from, to);
  }
  return s;
}

const plan = [];
const b = SimulationBuilder.new();

function deploy(name, breakAllowance) {
  b.withSender(OWNER).addContractDeploy({
    contract_name: name,
    source_code: sourceFor(name, breakAllowance),
    clarity_version: ClarityVersion.Clarity4,
  });
  plan.push({ kind: "tx", label: `deploy ${name}`, expect: null });
}
function callOn(label, sender, contractId, fn, args, expect) {
  b.withSender(sender).addContractCall({
    contract_id: contractId,
    function_name: fn,
    function_args: args,
  });
  plan.push({ kind: "tx", label, expect });
}
function evalOn(label, contractId, code, expect) {
  b.addEvalCode(contractId, code);
  plan.push({ kind: "eval", label, expect });
}
function stxSend(label, recipient, amount) {
  b.withSender(OWNER).addSTXTransfer({ recipient, amount });
  plan.push({ kind: "tx", label, expect: null });
}

const NO_AUTH = [noneCV(), noneCV()];

// --- both copies get identical treatment, in lockstep ---
for (const [name, broken] of [
  [CTRL, false],
  [PCBUG, true],
]) {
  const CID = `${OWNER}.${name}`;
  deploy(name, broken);
  callOn(
    `${name}: core registers its canonical hash`,
    SAFE_DEPLOYER,
    CORE,
    "set-verified-contract",
    [pcv(CID), noneCV()],
    "(ok true)"
  );
  callOn(
    `${name}: onboard -> (ok true)`,
    FAKFUN_DEPLOYER,
    CID,
    "onboard",
    [
      bufferCV(Buffer.alloc(33, 0x02)),
      standardPrincipalCV(OWNER),
      noneCV(),
      uintCV(STX(1_000_000)),
      uintCV(1_000_000_000),
    ],
    "(ok true)"
  );
  stxSend(`${name}: fund ${FUND / 1_000_000n} STX`, CID, FUND);
  callOn(
    `${name}: stake ${STAKE / 1_000_000n} STX -> (ok true)`,
    OWNER,
    CID,
    "stake-stx-juice",
    [uintCV(STAKE), ...NO_AUTH],
    "(ok true)"
  );
  evalOn(
    `${name}: pox-5 amount after stake`,
    CID,
    `(get amount-ustx (unwrap-panic (contract-call? '${POX5} get-staker-info '${CID})))`,
    `u${STAKE}`
  );
  // THE COMPARISON. Identical call, identical state; only the declared
  // allowance differs between the two contracts.
  callOn(
    `${name}: TOP-UP ${TOPUP / 1_000_000n} STX  <== the comparison`,
    OWNER,
    CID,
    "update-stake-stx-juice",
    [uintCV(TOPUP), uintCV(0), ...NO_AUTH],
    null // recorded, then compared below
  );
  evalOn(
    `${name}: pox-5 amount after top-up`,
    CID,
    `(get amount-ustx (unwrap-panic (contract-call? '${POX5} get-staker-info '${CID})))`,
    null
  );
}

// =====================================================================
function decodeTx(s) {
  const r = s?.Result?.Transaction;
  if (!r) return "<no transaction result>";
  if ("Err" in r) return `ENGINE-ERR: ${JSON.stringify(r.Err)}`;
  if (r.Ok?.post_condition_aborted) return "POST-CONDITION-ABORTED";
  if (r.Ok?.vm_error) return `VM-ERR: ${r.Ok.vm_error}`;
  try {
    return cvToString(deserializeCV(r.Ok.result));
  } catch (e) {
    return `decode-failed(${r.Ok?.result})`;
  }
}
function decodeEval(s) {
  const r = s?.Result?.Eval;
  if (!r) return "<no eval result>";
  if (!("Ok" in r)) return `ERR: ${JSON.stringify(r.Err)}`;
  try {
    return cvToString(deserializeCV(r.Ok));
  } catch (e) {
    return `decode-failed(${r.Ok})`;
  }
}

(async () => {
  const sessionId = await b.run();
  const url = `https://stxer.xyz/simulations/mainnet/${sessionId}`;
  console.log(`simulation: ${url}\nwaiting...`);
  let res;
  for (let i = 0; i < 90; i++) {
    try {
      res = await getSimulationResult(sessionId);
      if (res?.steps?.length >= plan.length) break;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!res?.steps) {
    console.error("no results");
    process.exit(1);
  }

  const got = {};
  let failures = 0;
  plan.forEach((p, i) => {
    const s = res.steps[i];
    const v = p.kind === "eval" ? decodeEval(s) : decodeTx(s);
    got[p.label] = v;
    if (p.expect == null) {
      console.log(`  ·  ${p.label}\n       -> ${v}`);
    } else if (v === p.expect) {
      console.log(`  ✔  ${p.label}\n       -> ${v}`);
    } else {
      failures++;
      console.log(`  ✘  ${p.label}\n       expected ${p.expect}\n       got      ${v}`);
    }
  });

  const ctrlTop = got[`${CTRL}: TOP-UP ${TOPUP / 1_000_000n} STX  <== the comparison`];
  const bugTop = got[`${PCBUG}: TOP-UP ${TOPUP / 1_000_000n} STX  <== the comparison`];

  console.log("\n================ VERDICT ================");
  console.log(`ctrl  (locked+increase) top-up : ${ctrlTop}`);
  console.log(`pcbug (increase only)   top-up : ${bugTop}`);
  const ctrlOk = ctrlTop === "(ok true)";
  const bugAborted = bugTop !== "(ok true)";
  if (ctrlOk && bugAborted) {
    console.log(
      "\nThe fork ENFORCES the epoch-4.0 stacking allowance.\n" +
        "The (locked-ustx) term is proven load-bearing here: the same top-up\n" +
        "fails without it and succeeds with it."
    );
  } else if (ctrlOk && !bugAborted) {
    console.log(
      "\nThe fork does NOT model epoch-4.0 STX locking: the buggy allowance\n" +
        "passes too. stxer therefore CANNOT verify this property, and the only\n" +
        "evidence for the (locked-ustx) fix remains the two failed mainnet txs\n" +
        "(0x85480b07, 0xe8..5107). Everything else in the staking surface is\n" +
        "still verified by the main harness."
    );
  } else {
    console.log("\nUnexpected: the control itself did not succeed. Investigate.");
  }
  console.log(`\n${url}`);
  if (failures) {
    console.error(`\n${failures} setup assertion(s) FAILED`);
    process.exit(1);
  }
})();
