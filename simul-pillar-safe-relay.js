// simul-pillar-safe-relay.js
// Fork-verifies the RELAY deploy flow for pillar-safe wallets:
//   1. deploy canonical SPV9K21.pillar-safe (what the bot deploys)
//   2. set-verified-contract it on fakfun-wallet-core
//   3. deploy a PER-USER wallet SP28MP1H.<name> from the SAME stripped source
//      (byte-identical -> code hash matches the canonical)
//   4. onboard(pubkey, owner, some(recovery), stx-thr, sbtc-thr) from SP28MP1H
//      -> register-wallet hash check passes, owner/recovery/thresholds set
// This is the exact sequence /api/smart-wallet/v2/deploy runs for builder=jing.
//
// Run: node simul-pillar-safe-relay.js
import fs from "node:fs";
import {
  ClarityVersion,
  bufferCV,
  uintCV,
  noneCV,
  someCV,
  principalCV,
  standardPrincipalCV,
  deserializeCV,
  cvToString,
  PostConditionMode,
} from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";

const SPV9K21 = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22"; // canonical + core admin
const SP28MP1H = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK"; // relay per-user deployer + onboard gate
const OWNER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2"; // connected L/X owner
const RECOVERY = "SP3HXJJMJQ06GNAZ8XWDN1QM48JEDC6PP6W3YZPZJ";

const CORE = `${SPV9K21}.fakfun-wallet-core`;
const CANONICAL = `${SPV9K21}.pillar-safe`;
const USER_NAME = "alice-safe";
const USER_WALLET = `${SP28MP1H}.${USER_NAME}`;

const STX_THR = 100_000_000;
const SBTC_THR = 100_000;
const PUBKEY = "0x02" + "ab".repeat(32); // any 33-byte compressed pubkey

// Comment-stripped source the relay deploys (canonical AND per-user use this).
const SRC = fs.readFileSync(
  "/tmp/claude-1000/-home-raphastacks-projects/bd0630f1-31ce-4fc8-aaa3-4cbbe0e84ab0/scratchpad/pillar-safe-stripped.clar",
  "utf8",
);

const plan = [];
const b = SimulationBuilder.new();
const deploy = (sender, name, label) => {
  b.withSender(sender).addContractDeploy({
    contract_name: name, source_code: SRC, clarity_version: ClarityVersion.Clarity5,
  });
  plan.push({ kind: "deploy", label });
};
const call = (label, sender, cid, fn, args, expect) => {
  b.withSender(sender).addContractCall({
    contract_id: cid, function_name: fn, function_args: args,
    post_condition_mode: PostConditionMode.Allow,
  });
  plan.push({ kind: "tx", label, expect });
};
const evalc = (label, code, cap) => { b.addEvalCode(USER_WALLET, code); plan.push({ kind: "eval", label, cap }); };

// 1. canonical
deploy(SPV9K21, "pillar-safe", "deploy canonical SPV9K21.pillar-safe");
// 2. set-verified-contract (core auto-computes hash via contract-hash?)
call("set-verified-contract(canonical)", SPV9K21, CORE, "set-verified-contract",
  [principalCV(CANONICAL), noneCV()], /^\(ok/);
// 3. per-user wallet, identical source, under SP28MP1H
deploy(SP28MP1H, USER_NAME, "deploy per-user SP28MP1H.alice-safe (identical source)");
// 4. onboard from SP28MP1H (the gate) with owner+recovery+thresholds
call("onboard(pubkey, owner, some(recovery), thresholds) -> register-wallet passes", SP28MP1H, USER_WALLET,
  "onboard",
  [bufferCV(Buffer.from(PUBKEY.slice(2), "hex")),
   standardPrincipalCV(OWNER),
   someCV(standardPrincipalCV(RECOVERY)),
   uintCV(STX_THR), uintCV(SBTC_THR)],
  /^\(ok/);
evalc("owner == OWNER", "(get-owner)", "owner");
evalc("recovery-address", "(var-get recovery-address)", "recovery");
evalc("wallet-config thresholds", "(var-get wallet-config)", "config");
evalc("pubkey maps to owner", `(is-admin-pubkey ${PUBKEY})`, "adminpk");

async function main() {
  console.log("=== pillar-safe RELAY flow — fork verify ===\n");
  const sid = await b.run();
  const url = `https://stxer.xyz/simulations/mainnet/${sid}`;
  console.log(`Submitted: ${url}\n`);
  const res = await getSimulationResult(sid);
  const decTx = (s) => {
    const r = s?.Result?.Transaction;
    if (!r) return "<none>";
    if ("Err" in r) return `ENGINE-ERR: ${JSON.stringify(r.Err).slice(0, 200)}`;
    try { return cvToString(deserializeCV(r.Ok.result)); } catch (e) { return `dec-fail: ${e.message}`; }
  };
  const decEval = (s) => {
    const r = s?.Result?.Eval;
    if (!r || !("Ok" in r)) return `<eval err>`;
    try { return cvToString(deserializeCV(r.Ok)); } catch { return r.Ok; }
  };
  let pass = 0, fail = 0; const cap = {};
  res.steps.forEach((s, i) => {
    const p = plan[i]; if (!p) return;
    if (p.kind === "deploy") {
      const ok = !("Err" in (s?.Result?.Transaction || {}));
      console.log(`${ok ? "✅" : "❌"} [${i}] ${p.label}`); ok ? pass++ : fail++; return;
    }
    if (p.kind === "eval") { const v = decEval(s); if (p.cap) cap[p.cap] = v; console.log(`ℹ️  [${i}] ${p.label}: ${String(v).slice(0,120)}`); return; }
    const d = decTx(s);
    const ok = p.expect.test(d);
    console.log(`${ok ? "✅" : "❌"} [${i}] ${p.label}\n        got ${d.slice(0,140)}`); ok ? pass++ : fail++;
  });
  const chk = (l, c) => { console.log(`${c ? "✅" : "❌"} ${l}`); c ? pass++ : fail++; };
  console.log("\n--- state ---");
  chk("owner == OWNER", String(cap.owner).includes(OWNER));
  chk("recovery == RECOVERY", String(cap.recovery).includes(RECOVERY));
  chk("stx-threshold set", String(cap.config).includes(`stx-threshold u${STX_THR}`));
  chk("sbtc-threshold set", String(cap.config).includes(`sbtc-threshold u${SBTC_THR}`));
  chk("pubkey is admin", String(cap.adminpk).startsWith("(ok"));
  console.log(`\n=== ${pass} passed, ${fail} failed ===\nView: ${url}`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
