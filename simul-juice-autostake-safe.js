// simul-juice-autostake-safe.js
// Stxer mainnet-fork simulation of juice-autostake-safe: the keeper's
// `restake` (stake ALL unlocked STX, roll the lock back to 96 cycles) and
// `set-keeper`, against the LIVE pox-5 with REAL STX locks and real burn-block
// advances.
//
// The safe and its helper are deployed FRESH in the sim from this repo's
// sources. The production safe names .juice-pool-sbtc-signer, which is not on
// mainnet yet, so the sim swaps in the LIVE juice-pool-stx-signer (same
// signer-manager trait, admits any staker). restake does not depend on which
// pool it is; the pool's own flow is simulated in juicestx.
//
// Every scenario starts from a known cycle position: the sim first advances to
// 20 blocks into the next reward cycle, then moves in whole cycles.
//
// Scenarios:
//   A  deploy helper + safe, verify, fund, onboard; keeper defaults to chavita
//   B  restake with no stake -> u4040; stake 1000; non-keepers -> u4001;
//      keeper restakes the free 1000 (extend 0, fresh lock is at the max);
//      nothing left -> u4026
//   C  a 100 STX payout lands -> keeper restakes exactly 100, extend 0
//   D  next cycle, 50 STX lands -> restake 50 and extend 1; unlock is back to
//      current + 1 + 96
//   E  keeper misses 2 cycles, no new STX -> roll-only restake, extend 2
//   F  at the max, the owner's +1 extension is refused by pox-5 (u20): the
//      roll target is pox-5's ceiling, not below it
//   G  inside the prepare phase restake is refused by pox-5; after the
//      boundary it goes through
//   H  set-keeper: owner as keeper (auto-restake off), old keeper -> u4001,
//      random -> u4001, passkey set-keeper through a relayer, back to chavita
//   I  owner unstakes -> keeper refused (u4040) this cycle, next cycle, and
//      after the unlock; STX unlocks and the owner withdraws
//   J  passkey set-keeper paying gas through the gas station (safe pays sBTC)
//   K  the production path: the relay deploys a USER COPY under its own name,
//      which onboards against the canonical hash; a tampered copy is refused
//   L  owner change resets the keeper (bounty mv7dfb, Giant Moth F2): a second
//      user copy (own passkey, 400 STX) stakes 200, sets a keeper, then transfers by passkey;
//      keeper = new owner, old keeper and chavita -> u4001; the new owner sets
//      chavita again and the restake works
//   M  same for recover-inactive-wallet: the new owner sets a keeper, the safe
//      goes idle for INACTIVITY-PERIOD (52560 burn blocks), recovery moves it;
//      keeper = recovered owner, old keeper -> u4001; set again, restake works.
//      RV-F1: a transfer to OWNER, proposed before the idle period, names the
//      owner once recovery restores OWNER; its passkey confirm -> u4001 (not
//      u4005: the passkey is live), OWNER stays admin
//
// Run: node simul-juice-autostake-safe.js
import crypto from "node:crypto";
import fs from "node:fs";
import {
  tupleCV,
  uintCV,
  bufferCV,
  noneCV,
  someCV,
  principalCV,
  standardPrincipalCV,
  contractPrincipalCV,
  stringAsciiCV,
  serializeCV,
  deserializeCV,
  cvToString,
  ClarityVersion,
  PostConditionMode,
  randomPrivateKey,
  privateKeyToPublic,
  signMessageHashRsv,
} from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";
import { generateP256Keypair, signChallengeWithRpId } from "./lib-webauthn-test-signer.mjs";
import { installChunkedSubmit } from "./_chunked-submit.mjs";
// the M idle advance (52560 burn blocks) is too slow for one stxer post
installChunkedSubmit(12);

// -- actors ------------------------------------------------------------------
const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22"; // chavita.btc = default keeper
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const OWNER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";
const RECOVERY = "SP3HXJJMJQ06GNAZ8XWDN1QM48JEDC6PP6W3YZPZJ";
const RANDOM = "SP1MGH8BH1KRY49Z7EE5TY0JVKT6C3NT9RTVM8FND";
const RELAYER = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM";
const RECIPIENT = "SP22WH53NS94VR6N145ZX77BK4S0EWFBE41VW3Z6B";
const STX_WHALE = "SP9BP4PN74CNR5XT7CMAMBPA0GWC9HMB69HVVV51";
const SBTC_WHALE = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";
const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const GAS_STATION = "gas-station";   // SPV9K21....gas-station, get-gas u20
const GAS_SATS = 20n;
const USER_COPY = "alice-autostake-safe";
const TAMPERED_COPY = "mallory-autostake-safe";
const XFER_COPY = "bob-autostake-safe";
const INACTIVITY = 52560;

// -- contracts ---------------------------------------------------------------
const WALLET_NAME = "juice-autostake-safe";
const HELPER_NAME = "juice-autostake-safe-auth-helpers-v1";
const WALLET = `${DEPLOYER}.${WALLET_NAME}`;
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core-v2`;
const POX5 = "SP000000000000000000002Q6VF78.pox-5";
const PROD_POOL = `${DEPLOYER}.juice-pool-sbtc-signer`;
const SIM_POOL = `${DEPLOYER}.juice-pool-stx-signer`;
const CLARITY_6 = ClarityVersion.Clarity6 ?? 6;

const STACKS_NODE_API = "http://77.42.3.101/stacks-api";
const RP_ID = "juiceofbtc.com";

// -- pox-5 timing (read from /v2/pox at start) -------------------------------
const FIRST_BURN = 666050;
const CYCLE = 2100;
const PREPARE = 100;

// -- amounts -----------------------------------------------------------------
const FUND = 2_000_000_000;      // 2000 STX into the safe
const STAKE = 1_000_000_000;     // owner stakes 1000
const PAYOUT_1 = 100_000_000;    // 100 STX "reward" (C)
const PAYOUT_2 = 50_000_000;     // 50 STX (D)
const PAYOUT_3 = 10_000_000;     // 10 STX (G)
const PAYOUT_4 = 5_000_000;      // 5 STX (H)
const PAYOUT_5 = 20_000_000;     // 20 STX (I)
const WITHDRAW = 30_000_000;
// bob (L/M): small, the whale holds ~2737 STX and A-K spend 2185
const BOB_FUND = 400_000_000;
const BOB_STAKE = 200_000_000;     // 30 STX out after the unlock (under threshold)

// -- SIP-018 (mirrors juice-autostake-safe-auth-helpers-v1) --------------------
const SIP018_PREFIX = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const cvSha256 = (cv) => {
  const out = serializeCV(cv);
  return sha256(Buffer.from(typeof out === "string" ? out : Buffer.from(out).toString("hex"), "hex"));
};
const walletDomainHash = (wallet = WALLET) =>
  cvSha256(tupleCV({
    name: stringAsciiCV("smart-wallet-standard"),
    version: stringAsciiCV("1.0.0"),
    "chain-id": uintCV(1),
    wallet: principalCV(wallet),
  }));
const buildChallenge = (t, wallet = WALLET) =>
  sha256(Buffer.concat([SIP018_PREFIX, walletDomainHash(wallet), cvSha256(t)]));
// mirrors smart-wallet-standard-auth-helpers-v7.build-confirm-transfer-hash
const tConfirmTransfer = (authId, newAdmin) =>
  tupleCV({ topic: stringAsciiCV("confirm-transfer"), "auth-id": uintCV(authId), "new-admin": principalCV(newAdmin) });
const tSetKeeper = (authId, keeper) =>
  tupleCV({ topic: stringAsciiCV("set-keeper"), "auth-id": uintCV(authId), keeper: principalCV(keeper) });
const strip = (h) => (h.startsWith("0x") ? h.slice(2) : h);
const sigAuthTuple = (authId, pubKeyHex, s) =>
  tupleCV({
    "auth-id": uintCV(authId),
    pubkey: bufferCV(Buffer.from(strip(pubKeyHex), "hex")),
    signature: bufferCV(Buffer.from(strip(s.signatureHex), "hex")),
    "authenticator-data": bufferCV(Buffer.from(strip(s.authenticatorDataHex), "hex")),
    "client-data-prefix": bufferCV(Buffer.from(strip(s.clientDataPrefixHex), "hex")),
    "client-data-suffix": bufferCV(Buffer.from(strip(s.clientDataSuffixHex), "hex")),
  });

const cycleOf = (h) => Math.floor((h - FIRST_BURN) / CYCLE);
const cycleStart = (c) => FIRST_BURN + c * CYCLE;

async function main() {
  // Sources: the exact repo files, with only the pool swapped (see header).
  const helperSrc = fs.readFileSync(`contracts/${HELPER_NAME}.clar`, "utf8");
  const prodSrc = fs.readFileSync(`contracts/${WALLET_NAME}.clar`, "utf8");
  if (!prodSrc.includes(PROD_POOL)) throw new Error("safe source no longer names the production pool");
  // REAL_POOL=1: keep the production pool binding and deploy the pool (with
  // the Jing stack, trait-v2 and autoswap its deploy needs) on the fork, from
  // jing-contracts-v3 simulations/deploy-bytes-mv7dfb (the exact deploy bytes).
  const REAL_POOL = !!process.env.REAL_POOL;
  const walletSrc = REAL_POOL ? prodSrc : prodSrc.split(PROD_POOL).join(SIM_POOL);

  const pox = await (await fetch(`${STACKS_NODE_API}/v2/pox`)).json();
  if (pox.first_burnchain_block_height !== FIRST_BURN || pox.reward_cycle_length !== CYCLE ||
      pox.prepare_phase_block_length !== PREPARE) {
    throw new Error(`pox timing changed: ${JSON.stringify(pox).slice(0, 200)}`);
  }
  const info = await (await fetch(`${STACKS_NODE_API}/v2/info`)).json();
  const startBurn = info.burn_block_height;
  // 20 blocks into the next cycle. stxer pins the session at its creation, a
  // second after this read; a few blocks of drift still lands in the cycle.
  const c1 = cycleOf(startBurn) + 1;
  const toC1 = cycleStart(c1) + 20 - startBurn;
  let burn = startBurn;

  const key = generateP256Keypair();
  const sign = (c) => signChallengeWithRpId(c, key.privKey, RP_ID);
  const pubkeyCV = bufferCV(Buffer.from(strip(key.pubKeyHex), "hex"));
  const sigKeeper = sign(buildChallenge(tSetKeeper(11, RANDOM)));
  const sigKeeperGas = sign(buildChallenge(tSetKeeper(12, DEPLOYER)));

  const plan = [];
  const b = SimulationBuilder.new({ stacksNodeAPI: STACKS_NODE_API });
  const evalc = (label, code, capture) => {
    b.addEvalCode(WALLET, code);
    plan.push({ kind: "eval", label, capture });
  };
  const call = (label, sender, cid, fn, args, expect, capture) => {
    b.withSender(sender).addContractCall({
      contract_id: cid, function_name: fn, function_args: args,
      post_condition_mode: PostConditionMode.Allow,
    });
    plan.push({ kind: "tx", label, expect, capture });
  };
  const fund = (label, amount) => {
    b.withSender(STX_WHALE).addSTXTransfer({ recipient: WALLET, amount });
    plan.push({ kind: "fund", label });
  };
  const advance = (label, n) => {
    b.addAdvanceBlocks({ bitcoin_blocks: n, stacks_blocks_per_bitcoin: 1 });
    burn += n;
    plan.push({ kind: "advance", label: `${label} (+${n} -> burn ${burn}, cycle ${cycleOf(burn)}, offset ${(burn - FIRST_BURN) % CYCLE})` });
  };
  const restake = (label, sender, expect, capture) => call(label, sender, WALLET, "restake", [], expect, capture);
  const snap = (tag) => {
    evalc(`${tag} stx-account`, `(stx-account '${WALLET})`, `acct_${tag}`);
    evalc(`${tag} staker-info`, `(contract-call? '${POX5} get-staker-info '${WALLET})`, `info_${tag}`);
    evalc(`${tag} current cycle`, `(contract-call? '${POX5} current-pox-reward-cycle)`, `cyc_${tag}`);
  };
  const okre = /^\(ok/;

  if (REAL_POOL) {
    const DB = `${process.env.HOME}/projects/jing-contracts-v3/simulations/deploy-bytes-mv7dfb`;
    for (const [n, v] of [["jing-core-v6", ClarityVersion.Clarity5], ["jing-ladder-v1", ClarityVersion.Clarity5], ["markets-sbtc-stx-jing-v6-3", ClarityVersion.Clarity5],
      ["swap-router-sbtc-stx-jing-v5-3", ClarityVersion.Clarity5], ["juice-swap-vault-trait-v2", CLARITY_6], ["juice-sbtc-autoswap", CLARITY_6], ["juice-pool-sbtc-signer", CLARITY_6]]) {
      b.withSender(DEPLOYER).addContractDeploy({ contract_name: n, source_code: fs.readFileSync(`${DB}/${n}.clar`, "utf8"), clarity_version: v });
      plan.push({ kind: "fund", label: `REAL_POOL: deploy ${n} (deploy bytes)` });
    }
    const priv = randomPrivateKey(), skey = privateKeyToPublic(priv);
    const gr = await (await fetch(`${STACKS_NODE_API}/v2/contracts/call-read/SP000000000000000000002Q6VF78/pox-5/get-signer-grant-message-hash`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sender: DEPLOYER, arguments: [contractPrincipalCV(DEPLOYER, "juice-pool-sbtc-signer"), uintCV(7)].map((c) => "0x" + serializeCV(c).replace(/^0x/, "")) }) })).json();
    const ssig = signMessageHashRsv({ messageHash: gr.result.replace(/^0x/, "").slice(2 + 8), privateKey: priv });
    call("REAL_POOL: register-self (real pox-5 grant)", DEPLOYER, PROD_POOL, "register-self",
      [contractPrincipalCV(DEPLOYER, "juice-pool-sbtc-signer"), bufferCV(Buffer.from(skey.replace(/^0x/, ""), "hex")), uintCV(7), bufferCV(Buffer.from(ssig.replace(/^0x/, ""), "hex"))], okre);
  }
  // -- A: deploy, verify, fund, onboard -------------------------------------
  b.withSender(DEPLOYER).addContractDeploy({ contract_name: HELPER_NAME, source_code: helperSrc, clarity_version: ClarityVersion.Clarity4 });
  plan.push({ kind: "fund", label: `deploy ${HELPER_NAME} (Clarity 4)` });
  b.withSender(DEPLOYER).addContractDeploy({ contract_name: WALLET_NAME, source_code: walletSrc, clarity_version: CLARITY_6 });
  plan.push({ kind: "fund", label: `deploy ${WALLET_NAME} (Clarity 6, pool -> juice-pool-stx-signer)` });
  call("A set-verified-contract(safe)", DEPLOYER, WALLET_CORE, "set-verified-contract",
    [principalCV(WALLET), noneCV()], okre);
  fund(`A fund safe ${FUND / 1e6} STX`, FUND);
  call("A onboard", FAKFUN_DEPLOYER, WALLET, "onboard",
    [pubkeyCV, standardPrincipalCV(OWNER), standardPrincipalCV(RECOVERY),
     uintCV(100_000_000), uintCV(100_000), uintCV(144)], okre);
  evalc("A get-keeper", "(get-keeper)", "keeper0");

  advance("move to 20 blocks into the next cycle", toC1);

  // -- B: stake, keeper gate, first restake -----------------------------------
  restake("B1 restake before any stake -> u4040", DEPLOYER, "(err u4040)");
  call("B2 owner stakes 1000 STX", OWNER, WALLET, "stake-stx-juice",
    [uintCV(STAKE), noneCV(), noneCV(), noneCV()], okre);
  snap("B2");
  restake("B3 restake by OWNER (not keeper) -> u4001", OWNER, "(err u4001)");
  restake("B4 restake by RANDOM -> u4001", RANDOM, "(err u4001)");
  restake("B5 keeper restakes the free 1000, extend 0", DEPLOYER, okre, "rB5");
  snap("B5");
  restake("B6 nothing unlocked, already at max -> u4026", DEPLOYER, "(err u4026)");

  // -- C: a payout lands --------------------------------------------------------
  fund(`C payout ${PAYOUT_1 / 1e6} STX lands`, PAYOUT_1);
  restake("C1 keeper restakes exactly the payout, extend 0", DEPLOYER, okre, "rC1");
  snap("C1");

  // -- D: next cycle ------------------------------------------------------------
  advance("D one cycle later", CYCLE);
  fund(`D payout ${PAYOUT_2 / 1e6} STX lands`, PAYOUT_2);
  restake("D1 restake: amount 50, extend 1", DEPLOYER, okre, "rD1");
  snap("D1");

  // -- E: keeper missed two cycles, nothing new -------------------------------
  advance("E two cycles later", 2 * CYCLE);
  restake("E1 roll-only restake: amount 0, extend 2", DEPLOYER, okre, "rE1");
  snap("E1");

  // -- F: the roll target is pox-5's ceiling ----------------------------------
  call("F1 owner extends +1 at the max -> pox-5 u20", OWNER, WALLET, "update-stake-stx-juice",
    [uintCV(0), uintCV(1), noneCV(), noneCV(), noneCV()], "(err u20)");

  // -- G: prepare phase ---------------------------------------------------------
  advance("G into the prepare phase (50 blocks before the boundary)", CYCLE - 20 - 50);
  fund(`G payout ${PAYOUT_3 / 1e6} STX lands`, PAYOUT_3);
  restake("G1 restake in the prepare phase -> refused by pox-5", DEPLOYER, /^\(err/, "rG1");
  advance("G past the boundary (50 into the next cycle)", 100);
  restake("G2 after the boundary: amount 10, extend 1", DEPLOYER, okre, "rG2");
  snap("G2");

  // -- H: set-keeper ------------------------------------------------------------
  call("H1 RANDOM set-keeper -> u4001", RANDOM, WALLET, "set-keeper",
    [standardPrincipalCV(RANDOM), noneCV(), noneCV()], "(err u4001)");
  call("H2 keeper (chavita) cannot set-keeper -> u4001", DEPLOYER, WALLET, "set-keeper",
    [standardPrincipalCV(DEPLOYER), noneCV(), noneCV()], "(err u4001)");
  call("H3 owner sets itself as keeper (auto-restake off)", OWNER, WALLET, "set-keeper",
    [standardPrincipalCV(OWNER), noneCV(), noneCV()], okre);
  fund(`H payout ${PAYOUT_4 / 1e6} STX lands`, PAYOUT_4);
  restake("H4 old keeper chavita -> u4001", DEPLOYER, "(err u4001)");
  evalc("H4 stx-account (5 STX stays unlocked)", `(stx-account '${WALLET})`, "acct_H4");
  restake("H5 owner-as-keeper restakes by hand", OWNER, okre, "rH5");
  call("H6 passkey set-keeper(RANDOM) via relayer", RELAYER, WALLET, "set-keeper",
    [standardPrincipalCV(RANDOM), someCV(sigAuthTuple(11, key.pubKeyHex, sigKeeper)), noneCV()], okre);
  evalc("H6 get-keeper", "(get-keeper)", "keeperH6");
  call("H7 same passkey signature replayed -> refused", RELAYER, WALLET, "set-keeper",
    [standardPrincipalCV(RANDOM), someCV(sigAuthTuple(11, key.pubKeyHex, sigKeeper)), noneCV()], /^\(err/);
  call("H8 owner sets chavita back", OWNER, WALLET, "set-keeper",
    [standardPrincipalCV(DEPLOYER), noneCV(), noneCV()], okre);
  evalc("H8 get-keeper", "(get-keeper)", "keeperH8");

  // -- I: owner leaves ----------------------------------------------------------
  call("I1 owner unstakes", OWNER, WALLET, "unstake", [noneCV(), noneCV()], okre);
  snap("I1");
  fund(`I payout ${PAYOUT_5 / 1e6} STX lands`, PAYOUT_5);
  restake("I2 keeper after unstake -> u4040", DEPLOYER, "(err u4040)");
  advance("I one cycle later", CYCLE);
  restake("I3 keeper next cycle -> u4040", DEPLOYER, "(err u4040)");
  snap("I3");
  advance("I another cycle (past the unlock)", CYCLE);
  restake("I4 keeper after the unlock -> u4040", DEPLOYER, "(err u4040)");
  snap("I4");
  evalc("I5 recipient STX before", `(stx-get-balance '${RECIPIENT})`, "rcpt0");
  call(`I5 owner withdraws ${WITHDRAW / 1e6} STX`, OWNER, WALLET, "stx-transfer",
    [uintCV(WITHDRAW), standardPrincipalCV(RECIPIENT), noneCV(), noneCV(), noneCV()], okre);
  evalc("I5 recipient STX after", `(stx-get-balance '${RECIPIENT})`, "rcpt1");

  // -- J: passkey set-keeper paying gas ------------------------------------------
  call("J0 fund the safe 5000 sats sBTC (for gas)", SBTC_WHALE, SBTC_TOKEN, "transfer",
    [uintCV(5000), standardPrincipalCV(SBTC_WHALE), principalCV(WALLET), noneCV()], okre);
  evalc("J0 safe sBTC before", `(contract-call? '${SBTC_TOKEN} get-balance '${WALLET})`, "gas0");
  call("J1 passkey set-keeper(chavita) with the gas station", RELAYER, WALLET, "set-keeper",
    [standardPrincipalCV(DEPLOYER), someCV(sigAuthTuple(12, key.pubKeyHex, sigKeeperGas)),
     someCV(contractPrincipalCV(DEPLOYER, GAS_STATION))], okre);
  evalc("J1 safe sBTC after", `(contract-call? '${SBTC_TOKEN} get-balance '${WALLET})`, "gas1");
  evalc("J1 get-keeper", "(get-keeper)", "keeperJ1");

  // -- K: user copies, as the relay deploys them -------------------------------
  b.withSender(FAKFUN_DEPLOYER).addContractDeploy({ contract_name: USER_COPY, source_code: walletSrc, clarity_version: CLARITY_6 });
  plan.push({ kind: "fund", label: `K1 relay deploys a user copy ${FAKFUN_DEPLOYER}.${USER_COPY} (same bytes)` });
  call("K2 onboard the user copy -> matches the canonical hash", FAKFUN_DEPLOYER, `${FAKFUN_DEPLOYER}.${USER_COPY}`, "onboard",
    [bufferCV(Buffer.from("02" + "cd".repeat(32), "hex")), standardPrincipalCV(OWNER), standardPrincipalCV(RECOVERY),
     uintCV(100_000_000), uintCV(100_000), uintCV(144)], okre);
  b.addEvalCode(`${FAKFUN_DEPLOYER}.${USER_COPY}`, "(get-keeper)");
  plan.push({ kind: "eval", label: "K2 user copy keeper", capture: "keeperK2" });
  b.withSender(FAKFUN_DEPLOYER).addContractDeploy({ contract_name: TAMPERED_COPY, source_code: walletSrc + "\n;; one extra byte\n", clarity_version: CLARITY_6 });
  plan.push({ kind: "fund", label: `K3 relay deploys a TAMPERED copy ${TAMPERED_COPY}` });
  call("K4 onboard the tampered copy -> refused by core-v2", FAKFUN_DEPLOYER, `${FAKFUN_DEPLOYER}.${TAMPERED_COPY}`, "onboard",
    [bufferCV(Buffer.from("02" + "ef".repeat(32), "hex")), standardPrincipalCV(OWNER), standardPrincipalCV(RECOVERY),
     uintCV(100_000_000), uintCV(100_000), uintCV(144)], /^\(err/);

  // -- L: transfer resets the keeper (Giant Moth F2) ------------------------------
  // bob = a second user copy with its own passkey, onboarded on the canonical hash
  const BOB = `${FAKFUN_DEPLOYER}.${XFER_COPY}`;
  const key2 = generateP256Keypair();
  const pubkey2CV = bufferCV(Buffer.from(strip(key2.pubKeyHex), "hex"));
  const sigXfer = signChallengeWithRpId(buildChallenge(tConfirmTransfer(21, RECIPIENT), BOB), key2.privKey, RP_ID);
  const sigStale = signChallengeWithRpId(buildChallenge(tConfirmTransfer(22, OWNER), BOB), key2.privKey, RP_ID);
  const evalBob = (label, code, capture) => {
    b.addEvalCode(BOB, code);
    plan.push({ kind: "eval", label, capture });
  };
  const fundBob = (label, amount) => {
    b.withSender(STX_WHALE).addSTXTransfer({ recipient: BOB, amount });
    plan.push({ kind: "fund", label });
  };
  const restakeBob = (label, sender, expect, capture) => call(label, sender, BOB, "restake", [], expect, capture);
  const snapBob = (tag) => {
    evalBob(`${tag} stx-account`, `(stx-account '${BOB})`, `acct_${tag}`);
    evalBob(`${tag} staker-info`, `(contract-call? '${POX5} get-staker-info '${BOB})`, `info_${tag}`);
    evalBob(`${tag} current cycle`, `(contract-call? '${POX5} current-pox-reward-cycle)`, `cyc_${tag}`);
  };
  b.withSender(FAKFUN_DEPLOYER).addContractDeploy({ contract_name: XFER_COPY, source_code: walletSrc, clarity_version: CLARITY_6 });
  plan.push({ kind: "fund", label: `L0 relay deploys ${BOB} (same bytes)` });
  call("L0 onboard bob (canonical hash, own passkey)", FAKFUN_DEPLOYER, BOB, "onboard",
    [pubkey2CV, standardPrincipalCV(OWNER), standardPrincipalCV(RECOVERY),
     uintCV(100_000_000), uintCV(100_000), uintCV(144)], okre);
  fundBob(`L0 fund bob ${BOB_FUND / 1e6} STX`, BOB_FUND);
  call(`L1 owner stakes ${BOB_STAKE / 1e6} STX in bob`, OWNER, BOB, "stake-stx-juice", [uintCV(BOB_STAKE), noneCV(), noneCV(), noneCV()], okre);
  call("L1 owner sets keeper RANDOM", OWNER, BOB, "set-keeper", [standardPrincipalCV(RANDOM), noneCV(), noneCV()], okre);
  call("L2 owner proposes transfer to RECIPIENT", OWNER, BOB, "propose-transfer-wallet", [standardPrincipalCV(RECIPIENT)], okre);
  call("L2 relayer submits the passkey confirm-transfer", RELAYER, BOB, "confirm-transfer-wallet",
    [sigAuthTuple(21, key2.pubKeyHex, sigXfer), noneCV()], okre);
  evalBob("L2 get-owner", "(get-owner)", "ownerL2");
  evalBob("L2 get-keeper", "(get-keeper)", "keeperL2");
  restakeBob("L3 old keeper RANDOM -> u4001", RANDOM, "(err u4001)");
  restakeBob("L3 chavita -> u4001", DEPLOYER, "(err u4001)");
  restakeBob("L3 old owner -> u4001", OWNER, "(err u4001)");
  call("L4 old owner set-keeper -> u4001", OWNER, BOB, "set-keeper", [standardPrincipalCV(DEPLOYER), noneCV(), noneCV()], "(err u4001)");
  call("L4 new owner sets chavita as keeper", RECIPIENT, BOB, "set-keeper", [standardPrincipalCV(DEPLOYER), noneCV(), noneCV()], okre);
  restakeBob(`L5 chavita restakes the free ${(BOB_FUND - BOB_STAKE) / 1e6}`, DEPLOYER, okre, "rL5");
  snapBob("L5");

  // -- M: inactivity recovery resets the keeper -------------------------------------
  call("M0 new owner sets keeper RANDOM (last owner action)", RECIPIENT, BOB, "set-keeper",
    [standardPrincipalCV(RANDOM), noneCV(), noneCV()], okre);
  // RV-F1 setup: a pending transfer that will name the owner once recovery runs
  call("M0 new owner proposes transfer to OWNER (left pending)", RECIPIENT, BOB, "propose-transfer-wallet",
    [standardPrincipalCV(OWNER)], okre);
  call("M0 recovery before the period -> u4009", RECOVERY, BOB, "recover-inactive-wallet",
    [standardPrincipalCV(OWNER)], "(err u4009)");
  {
    // past INACTIVITY, landing near offset 1000 (clear of the prepare phase)
    const base = INACTIVITY + 40;
    const off = (burn + base - FIRST_BURN) % CYCLE;
    let left = base + ((1000 - off + CYCLE) % CYCLE);
    // in chunks: one huge advance step times out the stxer request
    for (let k = 1; left > 0; k++) {
      const n = Math.min(left, 2 * CYCLE);
      advance(`M1 idle past the inactivity period, chunk ${k}`, n);
      left -= n;
    }
  }
  evalBob("M1 is-inactive", "(is-inactive)", "inactiveM1");
  call("M2 recovery moves bob to OWNER", RECOVERY, BOB, "recover-inactive-wallet", [standardPrincipalCV(OWNER)], okre);
  evalBob("M2 get-owner", "(get-owner)", "ownerM2");
  evalBob("M2 get-keeper", "(get-keeper)", "keeperM2");
  // RV-F1: the stale pending transfer now names the current owner -> refused
  call("M2 RV-F1 passkey confirm-transfer naming the current owner -> u4001", RELAYER, BOB, "confirm-transfer-wallet",
    [sigAuthTuple(22, key2.pubKeyHex, sigStale), noneCV()], "(err u4001)");
  evalBob("M2 RV-F1 owner unchanged", "(get-owner)", "ownerM2b");
  evalBob("M2 RV-F1 owner still admin", `(is-admin-calling '${OWNER})`, "adminM2b");
  fundBob(`M3 payout ${PAYOUT_3 / 1e6} STX lands`, PAYOUT_3);
  restakeBob("M3 old keeper RANDOM -> u4001", RANDOM, "(err u4001)");
  restakeBob("M3 chavita -> u4001", DEPLOYER, "(err u4001)");
  call("M4 recovered owner sets chavita as keeper", OWNER, BOB, "set-keeper", [standardPrincipalCV(DEPLOYER), noneCV(), noneCV()], okre);
  restakeBob("M5 chavita restakes the payout and rolls the lock", DEPLOYER, okre, "rM5");
  snapBob("M5");

  // -- run + verify ---------------------------------------------------------------
  console.log("=== juice-autostake-safe - stxer harness ===");
  console.log(`start burn ${startBurn} (cycle ${cycleOf(startBurn)}), first move to cycle ${c1}\n`);
  const sessionId = await b.run();
  const url = `https://stxer.xyz/simulations/mainnet/${sessionId}`;
  console.log(`Submitted: ${url}\n`);
  const res = await getSimulationResult(sessionId);

  const decTx = (s) => {
    const r = s?.Result?.Transaction;
    if (!r) return "<none>";
    if ("Err" in r) return `ENGINE-ERR: ${JSON.stringify(r.Err).slice(0, 220)}`;
    try { return cvToString(deserializeCV(r.Ok.result)); } catch (e) { return `dec-fail: ${e.message}`; }
  };
  const decEval = (s) => {
    const r = s?.Result?.Eval;
    if (!r || !("Ok" in r)) return `<eval:${JSON.stringify(r?.Err ?? "?").slice(0, 160)}>`;
    try { return cvToString(deserializeCV(r.Ok)); } catch { return r.Ok; }
  };

  let pass = 0, fail = 0;
  const cap = {};
  res.steps.forEach((s, i) => {
    const p = plan[i];
    if (!p) return;
    if (p.kind === "fund" || p.kind === "advance") {
      const ok = !("Err" in (s?.Result?.Transaction || {}));
      console.log(`${ok ? "OK  " : "FAIL"} [${i}] ${p.label}`);
      if (!ok) { fail++; console.log(`        ${decTx(s)}`); }
      return;
    }
    if (p.kind === "eval") {
      const v = decEval(s);
      if (p.capture) cap[p.capture] = v;
      console.log(`INFO [${i}] ${p.label}: ${String(v).slice(0, 200)}`);
      return;
    }
    const d = decTx(s);
    if (p.capture) cap[p.capture] = d;
    const ok = p.expect == null ? true : p.expect instanceof RegExp ? p.expect.test(d) : d === p.expect;
    console.log(`${ok ? "PASS" : "FAIL"} [${i}] ${p.label}\n        got ${d.slice(0, 200)}`);
    ok ? pass++ : fail++;
  });

  console.log("\n--- state checks ---");
  const chk = (l, cond) => { console.log(`${cond ? "PASS" : "FAIL"} ${l}`); cond ? pass++ : fail++; };
  const num = (s, field) => BigInt((String(s).match(new RegExp(`${field} u(\\d+)`)) || [])[1] ?? "-1");
  const locked = (t) => num(cap[`acct_${t}`], "locked");
  const unlocked = (t) => num(cap[`acct_${t}`], "unlocked");
  const amt = (t) => num(cap[`info_${t}`], "amount-ustx");
  const unlockCycle = (t) => num(cap[`info_${t}`], "first-reward-cycle") + num(cap[`info_${t}`], "num-cycles");
  const cyc = (t) => BigInt((String(cap[`cyc_${t}`]).match(/u(\d+)/) || [])[1] ?? "-1");
  const r = (k) => ({ amount: num(cap[k], "amount"), ext: num(cap[k], "cycles-to-extend") });
  const atMax = (t) => unlockCycle(t) === cyc(t) + 1n + 96n;

  const bal = (x) => BigInt((String(x).match(/u(\d+)/) || [])[1] ?? "-1");
  chk("A keeper defaults to chavita.btc", String(cap.keeper0).includes(DEPLOYER));
  chk("B2 stake locks 1000 STX for real", locked("B2") === BigInt(STAKE));
  chk("B2 fresh stake is already at the 96-cycle max", atMax("B2"));
  chk("B5 restake staked the whole free 1000, extend 0",
    r("rB5").amount === BigInt(FUND - STAKE) && r("rB5").ext === 0n);
  chk("B5 everything locked, nothing unlocked", locked("B5") === BigInt(FUND) && unlocked("B5") === 0n);
  chk("C1 restake staked exactly the payout, extend 0", r("rC1").amount === BigInt(PAYOUT_1) && r("rC1").ext === 0n);
  chk("C1 lock grew by the payout", locked("C1") === BigInt(FUND + PAYOUT_1) && amt("C1") === BigInt(FUND + PAYOUT_1));
  chk("D1 next cycle: amount 50, extend 1", r("rD1").amount === BigInt(PAYOUT_2) && r("rD1").ext === 1n);
  chk("D1 unlock is back at current + 1 + 96", atMax("D1"));
  chk("E1 missed two cycles: amount 0, extend 2", r("rE1").amount === 0n && r("rE1").ext === 2n);
  chk("E1 unlock is back at current + 1 + 96", atMax("E1"));
  chk("G2 after the prepare phase: amount 10, extend 1", r("rG2").amount === BigInt(PAYOUT_3) && r("rG2").ext === 1n);
  chk("G2 unlock at current + 1 + 96", atMax("G2"));
  chk("H4 with the owner as keeper, the payout stays unlocked", unlocked("H4") === BigInt(PAYOUT_4));
  chk("H5 owner-as-keeper restaked the 5 STX", r("rH5").amount === BigInt(PAYOUT_4));
  chk("H6 passkey set-keeper took effect", String(cap.keeperH6).includes(RANDOM));
  chk("H8 keeper back to chavita", String(cap.keeperH8).includes(DEPLOYER));
  chk("I1 unstake leaves the lock ending next cycle", unlockCycle("I1") === cyc("I1") + 1n);
  chk("I4 past the unlock: pox-5 position gone", String(cap.info_I4).trim() === "none");
  chk("I4 past the unlock: nothing locked", locked("I4") === 0n);
  chk(`J1 the gas station charged the safe exactly ${GAS_SATS} sats`, bal(cap.gas0) - bal(cap.gas1) === GAS_SATS);
  chk("J1 keeper is chavita after the gas-paid passkey call", String(cap.keeperJ1).includes(DEPLOYER));
  chk("K2 the onboarded user copy defaults to chavita as keeper", String(cap.keeperK2).includes(DEPLOYER));
  chk("I5 owner withdrew after the unlock", bal(cap.rcpt1) - bal(cap.rcpt0) === BigInt(WITHDRAW));
  chk("L2 owner is RECIPIENT after confirm-transfer", String(cap.ownerL2).includes(RECIPIENT));
  chk("L2 keeper reset to the new owner", String(cap.keeperL2).includes(RECIPIENT));
  chk("L5 restake by the re-set keeper: all free STX, extend 0", r("rL5").amount === BigInt(BOB_FUND - BOB_STAKE) && r("rL5").ext === 0n);
  chk("L5 everything locked", locked("L5") === BigInt(BOB_FUND) && unlocked("L5") === 0n);
  chk("M1 bob is inactive", String(cap.inactiveM1).trim() === "true");
  chk("M2 owner is OWNER after recovery", String(cap.ownerM2).includes(OWNER));
  chk("M2 keeper reset to the recovered owner", String(cap.keeperM2).includes(OWNER));
  chk("M2 RV-F1 owner still OWNER after the refused confirm", String(cap.ownerM2b).includes(OWNER));
  chk("M2 RV-F1 owner still admin (admins map not emptied)", String(cap.adminM2b) === "(ok true)");
  chk("M5 restake after recovery: amount 10, extend > 0", r("rM5").amount === BigInt(PAYOUT_3) && r("rM5").ext > 0n);
  chk("M5 unlock is back at current + 1 + 96", atMax("M5"));

  console.log("\n--- lock timeline (pox-5 amount-ustx / unlock cycle / current cycle) ---");
  for (const t of ["B2", "B5", "C1", "D1", "E1", "G2", "I1", "I3"]) {
    console.log(`   ${t.padEnd(3)} amount ${amt(t)}  unlock ${unlockCycle(t)}  current ${cyc(t)}  locked ${locked(t)}  unlocked ${unlocked(t)}`);
  }
  console.log(`\n=== ${pass} passed, ${fail} failed ===\nView: ${url}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
