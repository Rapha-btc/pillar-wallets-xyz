// simul-v18-verify-deployed.js
// VERIFICATION: the 5 v18 contracts are DEPLOYED on mainnet, so this forks the
// tip and runs the full scenario against the REAL deployed bytecode (only the
// sim-only mock-smart-router is deployed in-fork). Everything else identical.
// Stxer mainnet-fork harness for the NEW v18 wallet surface:
//   * smart-buy-sbtc / smart-buy-stx / smart-sell-sbtc / smart-sell-stx
//     against ALL 9 deployed faktory smart split routers, typed by
//     faktory-smart-trait-v1 (structural conformance of the deployed
//     routers is the first thing this proves).
//   * USDCx <-> sBTC through the usdcx-sbtc-swap extension, via the
//     inherited extension-call (both directions).
//
// Deploys 4 new contracts under the deployer, onboards a v18 wallet,
// seats OWNER as admin (passkey flow), then drives the surface. Most smart
// trades run the ADMIN path (OWNER caller, no passkey) because that reuses
// one code path; ONE smart buy and ONE USDCx swap run the PASSKEY path to
// prove signature verification end-to-end.
//
// Buys/sells route fak-ratio = u100 (everything through the faktory pool),
// so this tests the WALLET integration (v18 entry + allowance + as-contract
// dispatch + trait conformance), not the routers' DEX legs, which have their
// own passing sims. min-out = u1 + PostConditionMode.Allow: this proves the
// plumbing, not price.
//
// Run: node simul-v18-smart-swap.js
import crypto from "node:crypto";
import fs from "node:fs";
import {
  tupleCV, uintCV, bufferCV, noneCV, someCV, boolCV, principalCV,
  standardPrincipalCV, contractPrincipalCV, stringAsciiCV, serializeCV,
  deserializeCV, cvToString, ClarityVersion, PostConditionMode,
} from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";
import { generateP256Keypair, signChallengeWithRpId } from "./lib-webauthn-test-signer.mjs";

const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const OWNER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2"; // holds sBTC
const RELAYER = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM";
const STX_WHALE = "SP9BP4PN74CNR5XT7CMAMBPA0GWC9HMB69HVVV51";
const SBTC_WHALE = OWNER;
const USDCX_WHALE = "SP1MZ5N6YCQ5BFHK4N9NFGXG2K4N53BQ0MFXAKAC1"; // ~51k USDCx

const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const USDCX = "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx";
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core-v2`;
const STACKS_NODE_API = "http://77.42.3.101/stacks-api";
const RP_ID = "fak.fun";

const FIXED_NAME = "fakfun-wallet-v18";
const FIXED = `${DEPLOYER}.${FIXED_NAME}`;
const SWAP_EXT = `${DEPLOYER}.usdcx-sbtc-swap`;

const FUND_USTX = 3_000_000_000;
const SBTC_FUND = 2_000_000;      // sats: bankrolls every sBTC buy leg
const USDCX_FUND = 20_000_000;    // 20 USDCx (6 decimals)
const STX_PER_BUY = 20_000_000;   // 20 STX per STX-buy leg
const SBTC_PER_BUY = 50_000;      // sats per sBTC-buy leg
const COOLDOWN_BLOCKS = 440;      // > pubkey cooldown u432

// The 9 live smart routers. contractName = the on-chain principal name;
// token = the SIP-010 the router pays out; asset = its FT asset name (for
// clarity — trades use PostConditionMode.Allow so asset names are not load
// bearing here).
const TOKENS = [
  { sym: "B",          name: "b-smart-faktory",        token: `${DEPLOYER}.b-faktory`,                                      asset: "B",          sell: 700_000_000_000 },
  { sym: "MIA",        name: "mia-smart-faktory",      token: "SP1H1733V5MZ3SZ9XRW9FKYGEZT0JDGEB8Y634C7R.miamicoin-token-v2", asset: "miamicoin",  sell: 500_000_000 },
  { sym: "PEPE",       name: "pepe-smart-faktory",     token: "SP1Z92MPDQEWZXW36VX71Q25HKF5K2EPCJ304F275.tokensoft-token-v4k68639zxz", asset: "tokensoft-token", sell: 500_000_000 },
  { sym: "FLAT",       name: "flatearth-smart-faktory",token: "SP3W69VDG9VTZNG7NTW1QNCC1W45SNY98W1JSZBJH.flat-earth-stxcity", asset: "FlatEarth",  sell: 500_000_000 },
  { sym: "FAKFUN",     name: "fakfun-smart-faktory",   token: `${DEPLOYER}.fakfun-faktory`,                                 asset: "FAKFUN",     sell: 700_000_000_000 },
  { sym: "LEO",        name: "leo-smart-faktory",      token: "SP1AY6K3PQV5MRT6R4S671NWW2FRVPKM0BR162CT6.leo-token",         asset: "leo",        sell: 500_000_000 },
  { sym: "LWB",        name: "lwb-smart-faktory",      token: "SP277HZA8AGXV42MZKDW5B2NNN61RHQ42MTAHVNB1.little-whiny-bitch-stxcity", asset: "LWB", sell: 500_000_000_000 },
  { sym: "WELSH",      name: "welsh-smart-faktory",    token: "SP3NE50GEXFG9SZGTT51P40X2CKYSZ5CC4ZTZ7A2G.welshcorgicoin-token", asset: "welshcorgicoin", sell: 500_000_000 },
  { sym: "ROCK",       name: "rock-smart-faktory",     token: "SP4M2C88EE8RQZPYTC4PZ88CE16YGP825EYF6KBQ.stacks-rock",        asset: "rock",       sell: 900_000_000_000 },
];

const FAK = 100; // fak-ratio TOTAL: u100 = everything through the faktory pool

const SIP018_PREFIX = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const cvSha256 = (cv) => {
  const o = serializeCV(cv);
  return typeof o === "string" ? sha256(Buffer.from(o, "hex")) : sha256(Buffer.from(o));
};
const domainHash = (wallet) => cvSha256(tupleCV({
  name: stringAsciiCV("smart-wallet-standard"),
  version: stringAsciiCV("1.0.0"),
  "chain-id": uintCV(1),
  wallet: principalCV(wallet),
}));
const challenge = (wallet, topicTuple) =>
  sha256(Buffer.concat([SIP018_PREFIX, domainHash(wallet), cvSha256(topicTuple)]));

// smart-execute topic tuple: mirrors auth-helpers-v8 build-smart-execute-hash.
const tSmart = (id, opByte, smart, amount, minOut, fakRatio, flag) => tupleCV({
  topic: stringAsciiCV("smart-execute"),
  "auth-id": uintCV(id),
  op: bufferCV(Buffer.from([opByte])),
  smart: principalCV(smart),
  amount: uintCV(amount),
  "min-out": uintCV(minOut),
  "fak-ratio": uintCV(fakRatio),
  flag: boolCV(flag),
});
// extension-call topic tuple: mirrors auth-helpers-v7 build-extension-call-hash.
const tExt = (id, ext, payload) => tupleCV({
  topic: stringAsciiCV("extension-call"),
  "auth-id": uintCV(id),
  extension: principalCV(ext),
  payload: bufferCV(payload),
});

const strip = (h) => (h.startsWith("0x") ? h.slice(2) : h);
const tAddAdmin = (id, a) => tupleCV({ topic: stringAsciiCV("add-admin"), "auth-id": uintCV(id), "new-admin": standardPrincipalCV(a) });
const tConfirmAdmin = (id, a) => tupleCV({ topic: stringAsciiCV("confirm-admin"), "auth-id": uintCV(id), "new-admin": standardPrincipalCV(a) });
const sigAuth = (id, pk, s) => tupleCV({
  "auth-id": uintCV(id),
  pubkey: bufferCV(Buffer.from(strip(pk), "hex")),
  signature: bufferCV(Buffer.from(strip(s.signatureHex), "hex")),
  "authenticator-data": bufferCV(Buffer.from(strip(s.authenticatorDataHex), "hex")),
  "client-data-prefix": bufferCV(Buffer.from(strip(s.clientDataPrefixHex), "hex")),
  "client-data-suffix": bufferCV(Buffer.from(strip(s.clientDataSuffixHex), "hex")),
});

// USDCx swap payloads, encoded exactly like the extension's encode-* helpers:
// { action: (string-ascii 12), amount: uint, min-out: uint, max-steps: uint }.
const toBuf = (s) => (typeof s === "string" ? Buffer.from(strip(s), "hex") : Buffer.from(s));
const swapPayload = (action, amount, minOut, maxSteps) => toBuf(serializeCV(tupleCV({
  action: stringAsciiCV(action),
  amount: uintCV(amount),
  "min-out": uintCV(minOut),
  "max-steps": uintCV(maxSteps),
})));

const CLARITY_6 = ClarityVersion.Clarity6 ?? 6;
const CDIR = "./contracts";
const read = (rel) => fs.readFileSync(`${CDIR}/${rel}`, "utf8");

async function main() {
  const key = generateP256Keypair();
  const sign = (c) => signChallengeWithRpId(c, key.privKey, RP_ID);
  const pubkeyCV = bufferCV(Buffer.from(strip(key.pubKeyHex), "hex"));

  const sPropose = sign(challenge(FIXED, tAddAdmin(1, OWNER)));
  const sConfirm = sign(challenge(FIXED, tConfirmAdmin(2, OWNER)));

  const plan = [];
  const b = SimulationBuilder.new({ stacksNodeAPI: STACKS_NODE_API });
  const call = (label, sender, cid, fn, args, expect) => {
    b.withSender(sender).addContractCall({
      contract_id: cid, function_name: fn, function_args: args,
      post_condition_mode: PostConditionMode.Allow,
    });
    plan.push({ kind: "tx", label, expect });
  };
  const evalc = (label, code, at) => { b.addEvalCode(at, code); plan.push({ kind: "eval", label }); };
  const okre = /^\(ok/;

  // ── Deploy the 4 new contracts (trait + v8 helpers + extension, then v18) ──
  b.withSender(DEPLOYER).addContractDeploy({
    contract_name: "mock-smart-router",
    source_code: read("mock-smart-router.clar"),
    clarity_version: ClarityVersion.Clarity5,
  });
  plan.push({ kind: "deploy", label: "deploy mock-smart-router (unapproved)" });
  // Registry seeded the 9 routers at deploy; sanity-read two.
  evalc("registry: pepe-smart-faktory approved?",
    `(is-approved-router '${DEPLOYER}.pepe-smart-faktory)`, `${DEPLOYER}.fakfun-smart-router-registry`);
  evalc("registry: mock-smart-router approved? (expect false)",
    `(is-approved-router '${DEPLOYER}.mock-smart-router)`, `${DEPLOYER}.fakfun-smart-router-registry`);

  // ── Verify + onboard + seat OWNER as admin ──
  call("verify v18 in core-v2", DEPLOYER, WALLET_CORE,
    "set-verified-contract", [principalCV(FIXED), noneCV()], okre);
  call("onboard(pubkey) -> ok (pre-whitelists usdcx-sbtc-swap)", FAKFUN_DEPLOYER, FIXED,
    "onboard", [pubkeyCV], okre);
  evalc("usdcx-sbtc-swap whitelisted from birth?",
    `(is-extension-whitelisted '${SWAP_EXT})`, FIXED);
  call("propose-admin (PASSKEY)", RELAYER, FIXED, "propose-admin-with-signature",
    [standardPrincipalCV(OWNER), sigAuth(1, key.pubKeyHex, sPropose), noneCV()], okre);
  call("accept-admin (OWNER)", OWNER, FIXED, "accept-admin-proposal", [], okre);
  b.addAdvanceBlocks({ bitcoin_blocks: COOLDOWN_BLOCKS, stacks_blocks_per_bitcoin: 1 });
  plan.push({ kind: "advance", label: `advance ${COOLDOWN_BLOCKS} (pubkey cooldown)` });
  call("confirm-admin (PASSKEY) -> OWNER seated", RELAYER, FIXED,
    "confirm-admin-with-signature", [sigAuth(2, key.pubKeyHex, sConfirm), noneCV()], okre);

  // ── Fund the wallet: STX, sBTC, USDCx ──
  b.withSender(STX_WHALE).addSTXTransfer({ recipient: FIXED, amount: FUND_USTX });
  plan.push({ kind: "fund", label: `fund ${FUND_USTX / 1e6} STX` });
  call(`fund ${SBTC_FUND} sats sBTC`, SBTC_WHALE, SBTC_TOKEN, "transfer",
    [uintCV(SBTC_FUND), standardPrincipalCV(SBTC_WHALE), principalCV(FIXED), noneCV()], okre);
  call(`fund ${USDCX_FUND / 1e6} USDCx`, USDCX_WHALE, USDCX, "transfer",
    [uintCV(USDCX_FUND), standardPrincipalCV(USDCX_WHALE), principalCV(FIXED), noneCV()], okre);

  // ── USDCx <-> sBTC via the extension (both directions) ──
  // First one PASSKEY-signed to prove sig verification through extension-call,
  // second ADMIN-path (OWNER, no sig).
  const pToSbtc = swapPayload("to-sbtc", 10_000_000, 1, 20); // 10 USDCx -> sBTC
  const sSwap = sign(challenge(FIXED, tExt(3, SWAP_EXT, pToSbtc)));
  evalc("sBTC before USDCx->sBTC", `(contract-call? '${SBTC_TOKEN} get-balance '${FIXED})`, FIXED);
  call("USDCx->sBTC via extension (PASSKEY)", RELAYER, FIXED, "extension-call", [
    contractPrincipalCV(DEPLOYER, "usdcx-sbtc-swap"),
    bufferCV(toBuf(pToSbtc)),
    someCV(sigAuth(3, key.pubKeyHex, sSwap)),
    noneCV(),
  ], okre);
  evalc("sBTC after USDCx->sBTC (expect up)", `(contract-call? '${SBTC_TOKEN} get-balance '${FIXED})`, FIXED);

  const pToUsdcx = swapPayload("to-usdcx", 20_000, 1, 20); // 20k sats -> USDCx
  evalc("USDCx before sBTC->USDCx", `(contract-call? '${USDCX} get-balance '${FIXED})`, FIXED);
  call("sBTC->USDCx via extension (ADMIN)", OWNER, FIXED, "extension-call", [
    contractPrincipalCV(DEPLOYER, "usdcx-sbtc-swap"),
    bufferCV(toBuf(pToUsdcx)),
    noneCV(),
    noneCV(),
  ], okre);
  evalc("USDCx after sBTC->USDCx (expect up)", `(contract-call? '${USDCX} get-balance '${FIXED})`, FIXED);

  // ── Smart routers: buy + sell on sBTC and STX, all 9 tokens ──
  // ADMIN path (OWNER, sig-auth none) for all, plus a single PASSKEY-signed
  // smart-buy-sbtc on PEPE to prove build-smart-execute-hash end-to-end.
  let authId = 100;
  for (const t of TOKENS) {
    const [addr, cname] = t.token.split(".");
    const routerAddr = DEPLOYER, routerName = t.name;

    // smart-buy-sbtc (ADMIN)
    call(`${t.sym} smart-buy-sbtc (ADMIN)`, OWNER, FIXED, "smart-buy-sbtc", [
      contractPrincipalCV(routerAddr, routerName),
      uintCV(SBTC_PER_BUY), uintCV(1), uintCV(FAK), boolCV(false),
      noneCV(), noneCV(),
    ], okre);
    evalc(`${t.sym} token balance after buy-sbtc`,
      `(contract-call? '${t.token} get-balance '${FIXED})`, FIXED);

    // smart-sell-sbtc (ADMIN) — sell a slice of what we just bought
    call(`${t.sym} smart-sell-sbtc (ADMIN)`, OWNER, FIXED, "smart-sell-sbtc", [
      contractPrincipalCV(routerAddr, routerName),
      contractPrincipalCV(addr, cname), stringAsciiCV(t.asset),
      uintCV(t.sell), uintCV(1), uintCV(FAK), boolCV(false),
      noneCV(), noneCV(),
    ], okre);

    // smart-buy-stx (ADMIN)
    call(`${t.sym} smart-buy-stx (ADMIN)`, OWNER, FIXED, "smart-buy-stx", [
      contractPrincipalCV(routerAddr, routerName),
      uintCV(STX_PER_BUY), uintCV(1), uintCV(FAK), boolCV(false),
      noneCV(), noneCV(),
    ], okre);

    // smart-sell-stx (ADMIN)
    call(`${t.sym} smart-sell-stx (ADMIN)`, OWNER, FIXED, "smart-sell-stx", [
      contractPrincipalCV(routerAddr, routerName),
      contractPrincipalCV(addr, cname), stringAsciiCV(t.asset),
      uintCV(t.sell), uintCV(1), uintCV(FAK), boolCV(false),
      noneCV(), noneCV(),
    ], okre);
  }

  // One PASSKEY-signed smart buy to prove the signature path (PEPE).
  const pepe = TOKENS.find((x) => x.sym === "PEPE");
  const sPepe = sign(challenge(FIXED, tSmart(200, 0x00, `${DEPLOYER}.${pepe.name}`, SBTC_PER_BUY, 1, FAK, false)));
  call("PEPE smart-buy-sbtc (PASSKEY)", RELAYER, FIXED, "smart-buy-sbtc", [
    contractPrincipalCV(DEPLOYER, pepe.name),
    uintCV(SBTC_PER_BUY), uintCV(1), uintCV(FAK), boolCV(false),
    someCV(sigAuth(200, key.pubKeyHex, sPepe)), noneCV(),
  ], okre);

  // NEGATIVE: an unapproved (but trait-conforming) router must be rejected by
  // the registry gate, even from the admin. err-router-not-approved = u4033.
  call("UNAPPROVED mock-smart-router buy -> u4033 (ADMIN)", OWNER, FIXED, "smart-buy-sbtc", [
    contractPrincipalCV(DEPLOYER, "mock-smart-router"),
    uintCV(SBTC_PER_BUY), uintCV(1), uintCV(FAK), boolCV(false),
    noneCV(), noneCV(),
  ], /\(err u4033\)/);

  console.log("=== v18 VERIFY against DEPLOYED mainnet bytecode ===\n");
  const id = await b.run();
  const url = `https://stxer.xyz/simulations/mainnet/${id}`;
  console.log(`Submitted: ${url}\n`);
  const res = await getSimulationResult(id);

  const decTx = (s) => {
    const r = s?.Result?.Transaction;
    if (!r) return "<none>";
    if ("Err" in r) return `ENGINE-ERR: ${JSON.stringify(r.Err).slice(0, 160)}`;
    try { return cvToString(deserializeCV(r.Ok.result)); } catch (e) { return `dec-fail: ${e.message}`; }
  };
  const decEval = (s) => {
    const r = s?.Result?.Eval;
    if (!r || !("Ok" in r)) return `<eval:${JSON.stringify(r?.Err ?? "?").slice(0, 90)}>`;
    try { return cvToString(deserializeCV(r.Ok)); } catch { return String(r.Ok).slice(0, 80); }
  };

  let pass = 0, fail = 0;
  (res.steps || []).forEach((s, i) => {
    const p = plan[i]; if (!p) return;
    if (p.kind === "eval") { console.log(`   eval ${p.label} = ${decEval(s)}`); return; }
    if (p.kind === "deploy" || p.kind === "advance" || p.kind === "fund") {
      const tx = s?.Result?.Transaction;
      const ve = tx?.Ok?.vm_error;
      const ok = tx && !("Err" in tx) && !ve;
      console.log(`${ok ? "OK  " : "FAIL"} [${i}] ${p.label}${ok ? "" : "  " + (ve || decTx(s))}`);
      if (!ok) fail++;
      return;
    }
    const repr = decTx(s);
    const ok = p.expect ? p.expect.test(repr) : true;
    console.log(`${ok ? "PASS" : "FAIL"} [${i}] ${p.label}  => ${repr.slice(0, 60)}`);
    ok ? pass++ : fail++;
  });
  console.log(`\n=== ${pass} passed, ${fail} failed ===\n${url}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
