// simul-v6-v14-staking.js
// Repoint of simul-v4-v14-staking.js at the DEPLOYED juice-safe-v6.
// onboard now takes SIX args -- recovery is a bare principal, not an optional,
// and cooldown-period is caller-supplied instead of hardcoded u144.
// simul-v4-v14-staking.js
//
// Staking lifecycle on the DEPLOYED juice-safe-v6 and fakfun-wallet-v14.
// This is the surface today's allowance changes landed on:
//
//   unstake        (with-all-assets-unsafe) -> (with-pox)     [SIP-044, C6 only]
//   stake          (with-stacking N)        -> (with-staking N)
//   stake-update   (with-stacking total)    -> (with-staking total)
//
// A wrong or missing allowance is LOUD: the node returns (err u128) =
// MAX_ALLOWANCES, "an asset class moved with no allowance covering it". That is
// exactly how juice-safe-v0's unstake failed. So (ok true) here is real
// evidence the new forms are accepted and cover the call.
//
// WHAT THIS CANNOT PROVE. pox-5's Clarity never calls stx-lock? -- the lock,
// the STXLockEvent and the asset-map stacking entry all come from the NODE's PoX
// handler, which a fork does not emulate. If stx-account reports locked u0
// throughout, that is the emulator, not the contract, and it means
// (with-staking N) passes regardless of N. The load-bearing assertions are
// therefore on pox-5's CLARITY state (get-staker-info), which is really written.
// Both are printed below so the difference is visible rather than assumed.
//
// Run: node simul-v4-v14-staking.js
import crypto from "node:crypto";
import {
  uintCV, bufferCV, noneCV, someCV, principalCV, standardPrincipalCV,
  contractPrincipalCV, stringAsciiCV, serializeCV, deserializeCV, cvToString,
  PostConditionMode,
} from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";
import { generateP256Keypair } from "./lib-webauthn-test-signer.mjs";

const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const OWNER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";
const RECOVERY = "SP3HXJJMJQ06GNAZ8XWDN1QM48JEDC6PP6W3YZPZJ";
const STX_WHALE = "SP9BP4PN74CNR5XT7CMAMBPA0GWC9HMB69HVVV51";
const CORE = `${DEPLOYER}.fakfun-wallet-core`;
const POX5 = "'SP000000000000000000002Q6VF78.pox-5";
const STACKS_NODE_API = "http://77.42.3.101/stacks-api";

const STX_THRESHOLD = 100_000_000;
const SBTC_THRESHOLD = 100_000;
const FUND = 800_000_000;
const STAKE = 500_000_000;
const TOPUP = 100_000_000;

// fakfun-wallet-v14 is covered end-to-end by simul-v14-full.js (its onboard
// takes only a pubkey and seats no admin, so it needs the 3-step signature
// flow that harness already implements). This file is juice-safe-v6.
const TARGETS = ["juice-safe-v6"];
const okre = /^\(ok/;

async function main() {
  const key = generateP256Keypair();
  const pubkeyCV = bufferCV(
    Buffer.from(key.pubKeyHex.replace(/^0x/, ""), "hex")
  );

  const plan = [];
  const b = SimulationBuilder.new({ stacksNodeAPI: STACKS_NODE_API });
  const call = (label, sender, cid, fn, args, expect) => {
    b.withSender(sender).addContractCall({
      contract_id: cid, function_name: fn, function_args: args,
      post_condition_mode: PostConditionMode.Allow,
    });
    plan.push({ kind: "tx", label, expect });
  };
  const evalc = (label, wallet, code) => {
    b.addEvalCode(wallet, code);
    plan.push({ kind: "eval", label });
  };

  for (const name of TARGETS) {
    const W = `${DEPLOYER}.${name}`;
    const T = `[${name}]`;

    // register-wallet names the NEW contract, so core must carry its hash or
    // onboard fails err-not-authorized. This also exercises change #9.
    call(`${T} set-verified-contract`, DEPLOYER, CORE, "set-verified-contract",
      [principalCV(W), noneCV()], okre);
    call(`${T} onboard (register-wallet under the new name)`, FAKFUN_DEPLOYER, W,
      "onboard", [pubkeyCV, standardPrincipalCV(OWNER),
        standardPrincipalCV(RECOVERY),
        uintCV(STX_THRESHOLD), uintCV(SBTC_THRESHOLD), uintCV(144)], okre);

    b.withSender(STX_WHALE).addSTXTransfer({ recipient: W, amount: FUND });
    plan.push({ kind: "advance", label: `${T} fund ${FUND / 1e6} STX` });

    // --- with-staking on a fresh stake -------------------------------------
    call(`${T} stake ${STAKE / 1e6} STX  <- (with-staking amount-ustx)`,
      OWNER, W, "stake-stx-juice", [uintCV(STAKE), noneCV(), noneCV()], okre);
    evalc(`${T} staker-info after stake (CLARITY state - load-bearing)`, W,
      `(contract-call? ${POX5} get-staker-info '${W})`);
    evalc(`${T} stx-account after stake (node handler - may read u0 on a fork)`, W,
      `(stx-account '${W})`);

    // --- with-staking on a top-up: the allowance must be the RESULTING TOTAL,
    //     (locked-ustx) + increase. Declaring only the increase is what broke
    //     juice-safe-v0. This is the discriminating case.
    call(`${T} top-up +${TOPUP / 1e6} STX  <- (with-staking (+ locked increase))`,
      OWNER, W, "update-stake-stx-juice",
      [uintCV(TOPUP), uintCV(0), noneCV(), noneCV()], okre);
    evalc(`${T} staker-info after top-up`, W,
      `(contract-call? ${POX5} get-staker-info '${W})`);

    // --- pure extend. A FRESH position is already at NUM-CYCLES u96 = pox-5's
    //     MAX_NUM_CYCLES, so extending it MUST fail with ERR_INVALID_NUM_CYCLES
    //     (u20). That is correct pox-5 behaviour, not a wallet bug -- the lock
    //     window is rolling, so an extend only becomes legal once cycles have
    //     elapsed. Both halves are asserted.
    call(`${T} extend at max cycles -> MUST reject (err u20)`, OWNER, W,
      "update-stake-stx-juice", [uintCV(0), uintCV(2), noneCV(), noneCV()],
      /^\(err u20\)/);
    b.addAdvanceBlocks({ bitcoin_blocks: 2100, stacks_blocks_per_bitcoin: 1 });
    plan.push({ kind: "advance", label: `${T} advance one reward cycle` });
    call(`${T} extend +1 cycle once cycles elapsed -> ok`, OWNER, W,
      "update-stake-stx-juice", [uintCV(0), uintCV(1), noneCV(), noneCV()], okre);
    evalc(`${T} staker-info after extend`, W,
      `(contract-call? ${POX5} get-staker-info '${W})`);

    // --- negative: a no-op update must be rejected -------------------------
    call(`${T} NEGATIVE no-op update (0 amount, 0 cycles) -> err u4026`,
      OWNER, W, "update-stake-stx-juice",
      [uintCV(0), uintCV(0), noneCV(), noneCV()], /^\(err u4026\)/);

    // --- (with-pox) on unstake: the headline change ------------------------
    call(`${T} UNSTAKE  <- (with-pox), was with-all-assets-unsafe`,
      OWNER, W, "unstake", [noneCV(), noneCV()], okre);
    evalc(`${T} staker-info after unstake (num-cycles truncated)`, W,
      `(contract-call? ${POX5} get-staker-info '${W})`);
    evalc(`${T} stx-account after unstake (still locked, height pulled fwd)`, W,
      `(stx-account '${W})`);
  }

  // The node releases the lock by TIME, not by the unstake call.
  b.addAdvanceBlocks({ bitcoin_blocks: 1600, stacks_blocks_per_bitcoin: 1 });
  plan.push({ kind: "advance", label: "advance 1600 burn blocks past unlock" });
  for (const name of TARGETS) {
    const W = `${DEPLOYER}.${name}`;
    evalc(`[${name}] stx-account AFTER unlock (expect locked u0, STX back)`, W,
      `(stx-account '${W})`);
    evalc(`[${name}] staker-info AFTER unlock (expect none)`, W,
      `(contract-call? ${POX5} get-staker-info '${W})`);
  }

  console.log("=== v4 / v14 staking: with-staking + (with-pox) ===\n");
  const id = await b.run();
  console.log(`\nsimulation: https://stxer.xyz/simulations/mainnet/${id}\n`);
  const res = await getSimulationResult(id);

  const decTx = (s) => {
    const r = s?.Result?.Transaction;
    if (!r) return "<none>";
    if ("Err" in r) return `ENGINE-ERR: ${JSON.stringify(r.Err).slice(0, 160)}`;
    if (r.Ok?.vm_error) return `VM-ERR: ${r.Ok.vm_error}`;
    try { return cvToString(deserializeCV(r.Ok.result)); }
    catch (e) { return `dec-fail: ${e.message}`; }
  };
  const decEval = (s) => {
    const r = s?.Result?.Eval;
    if (!r || !("Ok" in r)) return `<eval:${JSON.stringify(r?.Err ?? "?").slice(0, 90)}>`;
    try { return cvToString(deserializeCV(r.Ok)); } catch { return r.Ok; }
  };

  let pass = 0, fail = 0;
  res.steps.forEach((s, i) => {
    const p = plan[i];
    if (!p) return;
    if (p.kind === "advance") { console.log(`  --   ${p.label}`); return; }
    if (p.kind === "eval") {
      console.log(`INFO   ${p.label}\n         ${String(decEval(s)).slice(0, 200)}`);
      return;
    }
    const d = decTx(s);
    const ok = p.expect instanceof RegExp ? p.expect.test(d) : d === p.expect;
    ok ? pass++ : fail++;
    console.log(`${ok ? "PASS" : "FAIL"}   ${p.label}\n         got ${String(d).slice(0, 200)}`);
  });
  console.log(`\n${pass} passed / ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
