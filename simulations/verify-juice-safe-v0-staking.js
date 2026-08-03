// verify-juice-safe-v0-staking.js
//
// SELF-VERIFYING stxer mainnet-fork harness for the LIVE
// SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-safe-v0.
//
// Nothing is deployed here: every call hits the contract already on mainnet.
// Its on-chain source was compared against contracts/juice-safe-v0.clar and is
// code-identical.
//
// WHAT THIS COVERS AND WHY. juice-safe-v0 was forked from jing-mm-safe.clar.
// Diffing top-level definitions, the ONLY behavioural change is the pox-5
// staking block:
//   removed  stack-stx-fast-pool / revoke-stacking / stack-stx-juice (all
//            pox-4 delegate-stx), the whole RFQ desk (fix-rfq / fulfill-rfq /
//            set-rfq-operator / rfq-operator / three Pyth traits),
//            PYTH-FEE-ALLOWANCE
//   added    locked-ustx / stake-stx-juice / update-stake-stx-juice / unstake
// Everything else -- onboard, transfers, thresholds, pending ops, the three
// execute-pending-*-now passkey fast-paths, recovery -- is identical to the
// fork parent, so this harness spends its assertions on the new surface.
//
// WHAT THIS HARNESS CANNOT TELL YOU. Epoch 4.0's stacking allowance is metered
// against the TOTAL resulting lock, not the delta, which is why the contract
// declares (+ (locked-ustx) amount-increase) on the update path. This harness
// does NOT verify that term, and no stxer harness can: the fork replays pox-5's
// contract state but not the node's pox lock handler, so stx-account never
// shows a lock, (locked-ustx) reads u0 throughout, and no stacking entry is
// written to the asset map for an allowance to be checked against.
// verify-juice-safe-v0-pc-negative.js proves this by running the identical
// top-up against a copy that declares only amount-increase -- the known-bad
// version -- and watching it pass too:
//   https://stxer.xyz/simulations/mainnet/6b575389e542484281d6dd1962a7e05c
// The evidence for that one line stays the two failed mainnet txs it came from
// (0x85480b07, 0xe8..5107). Everything ELSE below is genuinely verified.
//
// Run: node simulations/verify-juice-safe-v0-staking.js
import {
  uintCV,
  bufferCV,
  noneCV,
  standardPrincipalCV,
  contractPrincipalCV,
  deserializeCV,
  cvToString,
} from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";

// principal CV for either a standard (SP…) or contract (SP….name) principal
const pcv = (s) =>
  s.includes(".")
    ? contractPrincipalCV(s.split(".")[0], s.split(".")[1])
    : standardPrincipalCV(s);

// --- contract under test (live on mainnet) ---
const SAFE_DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const SAFE = `${SAFE_DEPLOYER}.juice-safe-v0`;

// onboard is gated on tx-sender == FAKFUN-DEPLOYER
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";

// Becomes owner/admin at onboard; also the STX source (4.0M free on mainnet).
// Every staking call is sig-auth: none, which routes is-authorized ->
// is-admin-calling tx-sender, so no passkey signature is needed anywhere.
const OWNER = "SP3V37N4ZV9JSE4J7KY58Z3S65HV7K5RKE829JS25";

// Stands in for Juice paying the safe -- see the NOTE at that step.
const SBTC_WHALE = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";

// Never an admin. Used for the authorisation guard.
const STRANGER = "SP9BP4PN74CNR5XT7CMAMBPA0GWC9HMB69HVVV51";

const POX5 = "SP000000000000000000002Q6VF78.pox-5";
const SBTC = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const JUICE_SIGNER = `${SAFE_DEPLOYER}.juice-pool-stx-signer`;
const CORE = `${SAFE_DEPLOYER}.fakfun-wallet-core`;

const STX = (n) => BigInt(n) * 1_000_000n;
const FUND = STX(120_000);
const STAKE = STX(60_000); // above the 50,000 STX pox min-threshold
const TOPUP = STX(20_000);
const SBTC_PAYOUT = 2_500_000n; // 0.025 sBTC

const stakerInfo = `(contract-call? '${POX5} get-staker-info '${SAFE})`;
const siField = (f) => `(get ${f} (unwrap-panic ${stakerInfo}))`;
const sbtcBal = `(contract-call? '${SBTC} get-balance '${SAFE})`;
const stxAcct = `(stx-account '${SAFE})`;

// ---- builder + parallel assertion plan ----
const plan = [];
const b = SimulationBuilder.new();

function call(label, sender, fn, args, expect) {
  b.withSender(sender).addContractCall({
    contract_id: SAFE,
    function_name: fn,
    function_args: args,
  });
  plan.push({ kind: "tx", label, expect });
}
function callOn(label, sender, contractId, fn, args, expect) {
  b.withSender(sender).addContractCall({
    contract_id: contractId,
    function_name: fn,
    function_args: args,
  });
  plan.push({ kind: "tx", label, expect });
}
function evalc(label, code, expect, capture) {
  b.addEvalCode(SAFE, code);
  plan.push({ kind: "eval", label, expect, capture });
}
function stxSend(label, sender, recipient, amount) {
  b.withSender(sender).addSTXTransfer({ recipient, amount });
  plan.push({ kind: "tx", label, expect: null });
}
function sbtcSend(label, sender, recipient, amount) {
  b.withSender(sender).addContractCall({
    contract_id: SBTC,
    function_name: "transfer",
    function_args: [
      uintCV(amount),
      standardPrincipalCV(sender),
      pcv(recipient),
      noneCV(),
    ],
  });
  plan.push({ kind: "tx", label, expect: null });
}
function advance(n, label) {
  b.addAdvanceBlocks({
    bitcoin_blocks: n,
    stacks_blocks_per_bitcoin: 1,
    bitcoin_interval_secs: 1,
  });
  plan.push({ kind: "advance", label: label ?? `advance ${n} burn blocks` });
}

// sig-auth = none, gas = none throughout (admin path)
const NO_AUTH = [noneCV(), noneCV()];

// =====================================================================
// Phase 0 -- claim and fund the safe
// =====================================================================
// The live safe is deployed but NOT onboarded: get-owner still returns the
// burn address and `admins` holds only SP000...002Q6VF78. Claiming it is the
// prelude to everything else.
evalc("owner before onboard (burn address)", "(get-owner)", "(ok SP000000000000000000002Q6VF78)");

// A REAL PREREQUISITE, not sim scaffolding. onboard ends in
// fakfun-wallet-core.register-wallet, which asserts the core holds a verified
// hash for juice-safe-v0 and that the calling contract's hash equals it.
// On mainnet today get-verified-contract-hash returns `none`, so onboard
// aborts with (err u6001) err-not-authorized -- the safe is deployed but
// cannot be claimed. set-verified-contract is DEPLOYER-gated and still has to
// be called on mainnet before the first onboard. Passing `none` for the hash
// makes the core compute contract-hash? itself, so it always matches.
evalc(
  "core: verified hash before registration",
  `(contract-call? '${CORE} get-verified-contract-hash '${SAFE})`,
  "none"
);
callOn(
  "core: register juice-safe-v0 canonical hash (DEPLOYER-only prerequisite)",
  SAFE_DEPLOYER,
  CORE,
  "set-verified-contract",
  [pcv(SAFE), noneCV()],
  "(ok true)"
);
evalc(
  "core: verified hash after registration",
  `(contract-call? '${CORE} get-verified-contract-hash '${SAFE})`
);

call(
  "onboard by non-deployer -> err-unauthorised",
  STRANGER,
  "onboard",
  [
    bufferCV(Buffer.alloc(33, 0x02)),
    standardPrincipalCV(STRANGER),
    noneCV(),
    uintCV(STX(1_000_000)),
    uintCV(100_000_000),
  ],
  "(err u4001)"
);

call(
  "onboard by FAKFUN-DEPLOYER -> (ok true)",
  FAKFUN_DEPLOYER,
  "onboard",
  [
    bufferCV(Buffer.alloc(33, 0x02)), // passkey unused on the admin path
    standardPrincipalCV(OWNER),
    noneCV(),
    uintCV(STX(1_000_000)), // thresholds set high: keep pending-ops out of the way
    uintCV(1_000_000_000),
  ],
  "(ok true)"
);
evalc("owner after onboard", "(get-owner)", `(ok ${OWNER})`);

stxSend(`fund safe with ${FUND / 1_000_000n} STX`, OWNER, SAFE, FUND);
evalc("locked-ustx before any stake", "(locked-ustx)", "u0");
evalc("stx-account before stake", stxAcct);

// =====================================================================
// Phase 1 -- guards before a position exists
// =====================================================================
call(
  "stake-stx-juice by stranger -> err-unauthorised",
  STRANGER,
  "stake-stx-juice",
  [uintCV(STAKE), ...NO_AUTH],
  "(err u4001)"
);
call(
  "stake-stx-juice u0 -> err-zero-amount",
  OWNER,
  "stake-stx-juice",
  [uintCV(0), ...NO_AUTH],
  "(err u4026)"
);
call(
  "update-stake before any stake -> pox-5 ERR_NOT_STAKING",
  OWNER,
  "update-stake-stx-juice",
  [uintCV(TOPUP), uintCV(0), ...NO_AUTH],
  "(err u27)"
);
call(
  "unstake before any stake -> pox-5 ERR_NOT_STAKING",
  OWNER,
  "unstake",
  [...NO_AUTH],
  "(err u27)"
);

// =====================================================================
// Phase 2 -- first stake (pox-5 `stake`, allowance == amount)
// =====================================================================
call(
  `stake-stx-juice ${STAKE / 1_000_000n} STX -> (ok true)`,
  OWNER,
  "stake-stx-juice",
  [uintCV(STAKE), ...NO_AUTH],
  "(ok true)"
);
evalc("pox-5 amount-ustx after stake", siField("amount-ustx"), `u${STAKE}`);
evalc("pox-5 signer is juice-pool-stx-signer", siField("signer"), JUICE_SIGNER);
evalc("pox-5 num-cycles after stake", siField("num-cycles"), "u96");
evalc("pox-5 first-reward-cycle after stake", siField("first-reward-cycle"));
// FORK LIMITATION -- see the header block. locked-ustx reads stx-account, which
// the node updates, not pox-5. stxer replays contract state but not the node's
// pox lock handler, so this stays u0 on the fork even though pox-5 recorded the
// position above. Recorded, not asserted.
evalc("locked-ustx after stake (fork does not apply the node-side lock)", "(locked-ustx)");
evalc("stx-account after stake", stxAcct);

call(
  "second stake-stx-juice -> pox-5 ERR_ALREADY_STAKED (this is why the fn is split)",
  OWNER,
  "stake-stx-juice",
  [uintCV(STAKE), ...NO_AUTH],
  "(err u19)"
);

// =====================================================================
// Phase 3 -- a cycle passes and Juice pays the safe in sBTC
// =====================================================================
// At the pinned tip we are ~1246 burn blocks from the cycle-141 prepare phase,
// so the stake above lands in cycle 141. Advancing 1400 crosses into 141: the
// first cycle in which the safe actually holds shares and can be paid.
advance(1400, "advance 1400 burn blocks (into the safe's first reward cycle)");

// NOTE ON FIDELITY. Juice pays stakers inside juice-pool-stx-signer's
// pay-stx-stakers, whose per-staker leg is
//     (contract-call? sbtc transfer net <signer> <staker> none)
// funded by a stx-pot that only pox-claim-rewards can fill, and that in turn
// needs real PoX rewards from real BTC miner payouts -- which a fork cannot
// synthesise. So the payout is modelled by its exact on-chain effect on the
// safe: an inbound sBTC transfer. What is being verified here is the SAFE's
// side (it can receive and then spend sBTC while its STX is locked), not
// Juice's accounting, which lives in the signer's own tests.
evalc("safe sBTC before payout", sbtcBal, "(ok u0)");
sbtcSend(
  `Juice pays the safe ${Number(SBTC_PAYOUT) / 1e8} sBTC (modelled)`,
  SBTC_WHALE,
  SAFE,
  SBTC_PAYOUT
);
evalc("safe sBTC after payout", sbtcBal, `(ok u${SBTC_PAYOUT})`);
evalc("pox-5 position unaffected by the payout", siField("amount-ustx"), `u${STAKE}`);

// =====================================================================
// Phase 4 -- top up (pox-5 `stake-update`) == THE CRITICAL ALLOWANCE TEST
// =====================================================================
call(
  "update-stake no-op (0 amount, 0 cycles) -> err-zero-amount",
  OWNER,
  "update-stake-stx-juice",
  [uintCV(0), uintCV(0), ...NO_AUTH],
  "(err u4026)"
);
call(
  "update-stake by stranger -> err-unauthorised",
  STRANGER,
  "update-stake-stx-juice",
  [uintCV(TOPUP), uintCV(0), ...NO_AUTH],
  "(err u4001)"
);
call(
  `top-up ${TOPUP / 1_000_000n} STX -> (ok true)  [allowance = locked + increase]`,
  OWNER,
  "update-stake-stx-juice",
  [uintCV(TOPUP), uintCV(0), ...NO_AUTH],
  "(ok true)"
);
evalc("pox-5 amount-ustx after top-up", siField("amount-ustx"), `u${STAKE + TOPUP}`);
evalc("pox-5 num-cycles unchanged by a 0-cycle top-up", siField("num-cycles"), "u96");

// Pure extend locks nothing, so the allowance is just the existing balance.
// HOW MUCH HEADROOM EXISTS: pox-5 re-derives num-cycles as
// (first-reward-cycle + stored-num-cycles + extend) - current-cycle - 1 and caps
// it at 96. The position opened AT the cap (96 cycles from 141), so the only
// slack is the cycles already elapsed -- exactly 1 at cycle 141. Extending by 1
// re-tops the window to the cap; 2 overshoots it.
call(
  "pure extend (0 amount, 1 cycle) -> (ok true)",
  OWNER,
  "update-stake-stx-juice",
  [uintCV(0), uintCV(1), ...NO_AUTH],
  "(ok true)"
);
evalc("pox-5 amount-ustx unchanged by a pure extend", siField("amount-ustx"), `u${STAKE + TOPUP}`);
evalc("pox-5 num-cycles after extend", siField("num-cycles"), "u97");

call(
  "extend past the 96-cycle cap -> pox-5 ERR_INVALID_NUM_CYCLES",
  OWNER,
  "update-stake-stx-juice",
  [uintCV(0), uintCV(500), ...NO_AUTH],
  "(err u20)"
);

// =====================================================================
// Phase 5 -- leave (pox-5 `unstake`)
// =====================================================================
call(
  "unstake by stranger -> err-unauthorised",
  STRANGER,
  "unstake",
  [...NO_AUTH],
  "(err u4001)"
);
call("unstake -> (ok true)", OWNER, "unstake", [...NO_AUTH], "(ok true)");
evalc("staker-info after unstake (num-cycles truncated to current+1)", stakerInfo);
evalc("pox-5 amount-ustx untouched by unstake", siField("amount-ustx"), `u${STAKE + TOPUP}`);
evalc("stx-account after unstake", stxAcct);

// The sBTC Juice paid is still there and still spendable after leaving.
evalc("safe sBTC after unstake", sbtcBal, `(ok u${SBTC_PAYOUT})`);

// =====================================================================
// Run + verify
// =====================================================================
function decodeTx(s) {
  const r = s?.Result?.Transaction;
  if (!r) return { ok: false, str: "<no transaction result>" };
  if ("Err" in r) return { ok: false, str: `ENGINE-ERR: ${JSON.stringify(r.Err)}` };
  if (r.Ok?.post_condition_aborted)
    return { ok: false, str: "POST-CONDITION-ABORTED" };
  if (r.Ok?.vm_error) return { ok: false, str: `VM-ERR: ${r.Ok.vm_error}` };
  try {
    return { ok: true, str: cvToString(deserializeCV(r.Ok.result)) };
  } catch (e) {
    return { ok: false, str: `decode-failed(${r.Ok?.result}): ${e.message}` };
  }
}
function decodeEval(s) {
  const r = s?.Result?.Eval;
  if (!r) return "<no eval result>";
  if (!("Ok" in r)) return `ERR: ${JSON.stringify(r.Err)}`;
  try {
    return cvToString(deserializeCV(r.Ok));
  } catch (e) {
    return `decode-failed(${r.Ok}): ${e.message}`;
  }
}

(async () => {
  console.log(`steps planned: ${plan.length}`);
  const sessionId = await b.run();
  const url = `https://stxer.xyz/simulations/mainnet/${sessionId}`;
  console.log(`simulation: ${url}\nwaiting for results...`);

  let res;
  for (let i = 0; i < 60; i++) {
    try {
      res = await getSimulationResult(sessionId);
      if (res?.steps?.length >= plan.length) break;
    } catch (e) {
      /* still running */
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!res?.steps) {
    console.error("no results came back");
    process.exit(1);
  }

  let failures = 0;
  const captured = {};
  plan.forEach((p, i) => {
    const step = res.steps[i];
    let got;
    if (p.kind === "tx") got = decodeTx(step).str;
    else if (p.kind === "eval") got = decodeEval(step);
    else got = step?.Result?.AdvanceBlocks ? "advanced" : "<no advance result>";

    if (p.capture) captured[p.capture] = got;

    if (p.expect == null) {
      console.log(`  ·  ${p.label}\n       -> ${got}`);
      return;
    }
    if (got === p.expect) {
      console.log(`  ✔  ${p.label}\n       -> ${got}`);
    } else {
      failures++;
      console.log(`  ✘  ${p.label}\n       expected ${p.expect}\n       got      ${got}`);
    }
  });

  console.log(`\n${url}`);
  if (failures) {
    console.error(`\n${failures} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log(`\nall ${plan.filter((p) => p.expect != null).length} assertions passed`);
})();
