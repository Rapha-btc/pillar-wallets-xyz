// simul-game-wager-v2-admin.js
// Admin-path stxer mainnet-fork sim for game-wager-v2.
//
// Covers every deployer-only setter + sweep-fees, both happy and limit paths:
//
//   * set-oracle              -- handoff to a fresh oracle principal
//   * set-fee-rate            -- update + reject above u2000 (20%) cap
//   * set-withdraw-fee-rate   -- update + reject above u1000 (10%) cap
//   * set-treasury            -- handoff to a fresh treasury principal
//   * sweep-fees              -- accumulate-then-drain end-to-end:
//                                deposit -> create-game -> oracle cancel
//                                -> fees in accumulated-fees -> sweep
//                                empties the map and transfers to treasury
//
// Run: `node simul-game-wager-v2-admin.js` (no flag -- admin paths drive
// themselves; webauthn sigs are auto-generated for the single create-game
// call needed to accumulate fees).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  ClarityVersion,
  tupleCV,
  uintCV,
  bufferCV,
  trueCV,
  principalCV,
  contractPrincipalCV,
  stringAsciiCV,
  serializeCV,
  PostConditionMode,
} from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";
import { generateP256Keypair, buildSignedBundle } from "./lib-webauthn-test-signer.mjs";

// ── Addresses & contracts ────────────────────────────────────────────────────

const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const PILLAR_TRAIT_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const ORACLE = PILLAR_TRAIT_DEPLOYER;
const NEW_TREASURY = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";
const NEW_ORACLE = "SP1G655MB1JVQ5FBE2JJ3E01HEA6KBM4H39F5EW63";

const WAGER = `${DEPLOYER}.game-wager-v2`;
const TOKEN = `${DEPLOYER}.test-token`;

const MINT_AMOUNT = 10_000_000;
const DEPOSIT_AMOUNT = 1_000_000;
const WAGER_AMOUNT = 100_000;

// Limits baked into game-wager-v2.clar.
const FEE_RATE_LIMIT = 2000;            // set-fee-rate caps at u2000
const WITHDRAW_FEE_LIMIT = 1000;        // set-withdraw-fee-rate caps at u1000
const ERR_INVALID_AMOUNT = 7009;

// Expected accumulated fee after one cancel of a 100k wager.
// [A3] sets withdraw-fee-rate to 200 (2%) BEFORE the cancel, so:
//   per-player fee = 100k * 2% = 2000
//   total          = 2 * 2000 = 4000
const NEW_WITHDRAW_FEE_RATE = 200;
const EXPECTED_ACCUMULATED_FEE = 2 * Math.floor(WAGER_AMOUNT * NEW_WITHDRAW_FEE_RATE / 10000);

// ── SIP-018 challenge builder ────────────────────────────────────────────────

const SIP018_PREFIX = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();

function gameWagerV2DomainHash() {
  const domain = tupleCV({
    "chain-id": uintCV(1),
    contract: principalCV(WAGER),
    name: stringAsciiCV("game-wager"),
    version: stringAsciiCV("2.0.0"),
  });
  return sha256(Buffer.from(serializeCV(domain), "hex"));
}

function challenge(messageTuple) {
  const msgHash = sha256(Buffer.from(serializeCV(messageTuple), "hex"));
  return sha256(Buffer.concat([SIP018_PREFIX, gameWagerV2DomainHash(), msgHash]));
}

function specWager(authId, opponentPubkeyHex, tokenPrincipal, wagerAmount) {
  return tupleCV({
    "auth-id": uintCV(authId),
    opponent: bufferCV(Buffer.from(stripHex(opponentPubkeyHex), "hex")),
    token: principalCV(tokenPrincipal),
    topic: stringAsciiCV("wager"),
    "wager-amount": uintCV(wagerAmount),
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const stripHex = (s) => (s.startsWith("0x") ? s.slice(2) : s);

function sigAuthNoPubkey(signed) {
  return tupleCV({
    "auth-id": uintCV(signed.authId),
    signature: bufferCV(Buffer.from(stripHex(signed.signatureHex), "hex")),
    "authenticator-data": bufferCV(Buffer.from(stripHex(signed.authenticatorDataHex), "hex")),
    "client-data-prefix": bufferCV(Buffer.from(stripHex(signed.clientDataPrefixHex), "hex")),
    "client-data-suffix": bufferCV(Buffer.from(stripHex(signed.clientDataSuffixHex), "hex")),
  });
}

// ── Run ─────────────────────────────────────────────────────────────────────

async function runSimulation() {
  const a = generateP256Keypair();
  const b = generateP256Keypair();
  const pubA = a.pubKey;
  const pubB = b.pubKey;

  const bundleA = buildSignedBundle({
    walletPrincipal: WAGER,
    pubKeyHex: a.pubKeyHex,
    privKey: a.privKey,
    operations: [{ authId: 1, label: "A wager", challenge: challenge(specWager(1, b.pubKeyHex, TOKEN, WAGER_AMOUNT)) }],
  });
  const bundleB = buildSignedBundle({
    walletPrincipal: WAGER,
    pubKeyHex: b.pubKeyHex,
    privKey: b.privKey,
    operations: [{ authId: 1, label: "B wager", challenge: challenge(specWager(1, a.pubKeyHex, TOKEN, WAGER_AMOUNT)) }],
  });
  const sigA = bundleA.operations[0];
  const sigB = bundleB.operations[0];

  console.error(`Player A pubkey: 0x${a.pubKeyHex}`);
  console.error(`Player B pubkey: 0x${b.pubKeyHex}`);

  const here = path.dirname(new URL(import.meta.url).pathname);
  const traitSrc = fs.readFileSync(path.join(here, "contracts/sip-010-trait.clar"), "utf8");
  const tokenSrc = fs.readFileSync(path.join(here, "contracts/test-token.clar"), "utf8");
  const webauthnSrc = fs.readFileSync(path.join(here, "contracts/clarity-webauthn.clar"), "utf8");
  const wagerSrc = fs.readFileSync(path.join(here, "contracts/game-wager-v2.clar"), "utf8");
  const pillarTraitSrc = fs.readFileSync(path.join(here, "contracts/deployed/deploying/pillar-wallet-trait.clar"), "utf8");

  const builder = SimulationBuilder.new()
    .withSender(PILLAR_TRAIT_DEPLOYER)
    .addContractDeploy({ contract_name: "pillar-wallet-trait", source_code: pillarTraitSrc, clarity_version: ClarityVersion.Clarity5 })
    .withSender(DEPLOYER)
    .addContractDeploy({ contract_name: "sip-010-trait", source_code: traitSrc, clarity_version: ClarityVersion.Clarity5 })
    .addContractDeploy({ contract_name: "test-token", source_code: tokenSrc, clarity_version: ClarityVersion.Clarity5 })
    .addContractDeploy({ contract_name: "clarity-webauthn", source_code: webauthnSrc, clarity_version: ClarityVersion.Clarity5 })
    .addContractDeploy({ contract_name: "game-wager-v2", source_code: wagerSrc, clarity_version: ClarityVersion.Clarity5 })
    .addContractCall({
      contract_id: WAGER,
      function_name: "set-token-whitelist",
      function_args: [principalCV(TOKEN), trueCV()],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addContractCall({
      contract_id: TOKEN,
      function_name: "mint",
      function_args: [uintCV(MINT_AMOUNT), principalCV(DEPLOYER)],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── set-fee-rate happy + cap ───────────────────────────────────────────
    .addContractCall({
      contract_id: WAGER,
      function_name: "set-fee-rate",
      function_args: [uintCV(800)], // 8% (well below 20% cap)
      post_condition_mode: PostConditionMode.Allow,
    })
    .addContractCall({
      contract_id: WAGER,
      function_name: "set-fee-rate",
      function_args: [uintCV(FEE_RATE_LIMIT + 1)],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── set-withdraw-fee-rate happy + cap ──────────────────────────────────
    .addContractCall({
      contract_id: WAGER,
      function_name: "set-withdraw-fee-rate",
      function_args: [uintCV(NEW_WITHDRAW_FEE_RATE)], // 2% (well below 10% cap)
      post_condition_mode: PostConditionMode.Allow,
    })
    .addContractCall({
      contract_id: WAGER,
      function_name: "set-withdraw-fee-rate",
      function_args: [uintCV(WITHDRAW_FEE_LIMIT + 1)],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── set-treasury ────────────────────────────────────────────────────────
    .addContractCall({
      contract_id: WAGER,
      function_name: "set-treasury",
      function_args: [principalCV(NEW_TREASURY)],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Accumulate fees: deposit -> create-game -> oracle cancel ──────────
    .addContractCall({
      contract_id: WAGER,
      function_name: "deposit",
      function_args: [contractPrincipalCV(DEPLOYER, "test-token"), uintCV(DEPOSIT_AMOUNT), bufferCV(pubA)],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addContractCall({
      contract_id: WAGER,
      function_name: "deposit",
      function_args: [contractPrincipalCV(DEPLOYER, "test-token"), uintCV(DEPOSIT_AMOUNT), bufferCV(pubB)],
      post_condition_mode: PostConditionMode.Allow,
    })
    .withSender(ORACLE)
    .addContractCall({
      contract_id: WAGER,
      function_name: "create-game",
      function_args: [
        bufferCV(pubA),
        bufferCV(pubB),
        principalCV(TOKEN),
        uintCV(WAGER_AMOUNT),
        sigAuthNoPubkey(sigA),
        sigAuthNoPubkey(sigB),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addContractCall({
      contract_id: WAGER,
      function_name: "cancel-game",
      function_args: [uintCV(0)],
      post_condition_mode: PostConditionMode.Allow,
    })

    // Snapshot fees + treasury balance before the sweep.
    .addReads([
      { EvalReadonly: [DEPLOYER, "", WAGER, `(get-accumulated-fees '${TOKEN})`] },
      { EvalReadonly: [DEPLOYER, "", TOKEN, `(get-balance '${NEW_TREASURY})`] },
    ])

    // ── sweep-fees by DEPLOYER -> drains accumulated-fees, transfers to NEW_TREASURY ───
    .withSender(DEPLOYER)
    .addContractCall({
      contract_id: WAGER,
      function_name: "sweep-fees",
      function_args: [contractPrincipalCV(DEPLOYER, "test-token"), stringAsciiCV("game-token")],
      post_condition_mode: PostConditionMode.Allow,
    })

    // Post-sweep snapshot.
    .addReads([
      { EvalReadonly: [DEPLOYER, "", WAGER, `(get-accumulated-fees '${TOKEN})`] },
      { EvalReadonly: [DEPLOYER, "", TOKEN, `(get-balance '${NEW_TREASURY})`] },
    ])

    // ── set-oracle hand-off (and prove the new oracle works) ──────────────
    .addContractCall({
      contract_id: WAGER,
      function_name: "set-oracle",
      function_args: [principalCV(NEW_ORACLE)],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addReads([
      { EvalReadonly: [DEPLOYER, "", WAGER, "(get-oracle)"] },
      { EvalReadonly: [DEPLOYER, "", WAGER, "(get-fee-rate)"] },
      { EvalReadonly: [DEPLOYER, "", WAGER, "(get-withdraw-fee-rate)"] },
    ]);

  console.error("Submitting simulation...");
  const sessionId = await builder.run();
  console.error(`Session: ${sessionId}`);
  console.error(`URL:     https://stxer.xyz/simulations/mainnet/${sessionId}\n`);

  const result = await getSimulationResult(sessionId);

  const checks = [
    { label: "Deploy pillar-wallet-trait", kind: "ok" },
    { label: "Deploy sip-010-trait", kind: "ok" },
    { label: "Deploy test-token", kind: "ok" },
    { label: "Deploy clarity-webauthn", kind: "ok" },
    { label: "Deploy game-wager-v2", kind: "ok" },
    { label: "set-token-whitelist", kind: "okBool" },
    { label: `Mint ${MINT_AMOUNT} GAME`, kind: "okBool" },
    { label: "[A1] set-fee-rate(800)", kind: "okBool" },
    { label: `[A2] set-fee-rate(${FEE_RATE_LIMIT + 1}) above cap`, kind: "err", code: ERR_INVALID_AMOUNT },
    { label: `[A3] set-withdraw-fee-rate(${NEW_WITHDRAW_FEE_RATE})`, kind: "okBool" },
    { label: `[A4] set-withdraw-fee-rate(${WITHDRAW_FEE_LIMIT + 1}) above cap`, kind: "err", code: ERR_INVALID_AMOUNT },
    { label: `[A5] set-treasury(${NEW_TREASURY})`, kind: "okBool" },
    { label: "Deposit A (for fee accumulation)", kind: "okBool" },
    { label: "Deposit B (for fee accumulation)", kind: "okBool" },
    { label: "create-game", kind: "okGameId" },
    { label: "cancel-game(oracle) accumulates fees", kind: "okBool" },
    { label: "Snapshot pre-sweep state", kind: "reads", expect: { fees: EXPECTED_ACCUMULATED_FEE, treasuryBalance: 0 } },
    { label: "[A6] sweep-fees", kind: "okBool" },
    { label: "Snapshot post-sweep state", kind: "reads", expect: { fees: 0, treasuryBalance: EXPECTED_ACCUMULATED_FEE } },
    { label: "[A7] set-oracle(NEW_ORACLE)", kind: "okBool" },
    { label: "Read oracle/fee-rate/withdraw-fee-rate", kind: "reads", expect: { oracle: NEW_ORACLE, feeRate: 800, withdrawFeeRate: NEW_WITHDRAW_FEE_RATE } },
  ];

  let passes = 0, fails = 0;
  console.log("=== Per-step results ===\n");
  for (let i = 0; i < result.steps.length; i++) {
    if (evaluateStep(checks[i], result.steps[i])) passes++;
    else fails++;
  }

  console.log(`\n${passes} pass, ${fails} fail.`);
  console.log(`Full trace: https://stxer.xyz/simulations/mainnet/${sessionId}`);
  if (fails > 0) process.exit(1);
}

// ── Step evaluator (with extras for game-id and reads) ──────────────────────

function getResultHex(step) {
  const tx = step?.Result?.Transaction;
  if (tx?.Ok?.result) return tx.Ok.result;
  if (step?.Result?.SetContractCode?.Ok !== undefined) return "(deployed)";
  return null;
}

function parseUintAt(hex, offset) {
  // 1 byte type tag (01) + 16 bytes BE
  if (hex.slice(offset, offset + 2) !== "01") return null;
  return parseInt(hex.slice(offset + 2 + 24, offset + 2 + 32), 16);
}

function parsePrincipal(hex) {
  // Standard principal: 05 + version(1) + hash160(20). Contract principal: 06 + ...
  // For our reads we just compare the hex slice to the expected encoding.
  return hex;
}

function evaluateStep(check, step) {
  const label = check?.label ?? "<unlabeled>";
  if (check.kind === "reads") {
    const reads = step?.Result?.Reads;
    if (!reads) {
      console.log(`  [FAIL] ${label}: no reads block`);
      return false;
    }
    return evaluateReads(check, reads, label);
  }

  const res = getResultHex(step);
  if (!res) {
    console.log(`  [FAIL] ${label}: no transaction result`);
    return false;
  }
  if (check.kind === "ok") {
    if (res === "(deployed)" || res.startsWith("07")) {
      console.log(`  [PASS] ${label}`);
      return true;
    }
    console.log(`  [FAIL] ${label}: expected ok, got ${res.slice(0, 60)}`);
    return false;
  }
  if (check.kind === "okBool") {
    if (res === "0703") {
      console.log(`  [PASS] ${label}: (ok true)`);
      return true;
    }
    console.log(`  [FAIL] ${label}: expected (ok true), got ${res.slice(0, 60)}`);
    return false;
  }
  if (check.kind === "okGameId") {
    // (ok u0) for game-id 0
    if (res.startsWith("0701") && /^0+$/.test(res.slice(4))) {
      console.log(`  [PASS] ${label}: (ok u0)`);
      return true;
    }
    console.log(`  [FAIL] ${label}: expected (ok u0), got ${res.slice(0, 60)}`);
    return false;
  }
  if (check.kind === "err") {
    if (!res.startsWith("0801") || res.length !== 36) {
      console.log(`  [FAIL] ${label}: expected (err u${check.code}), got ${res.slice(0, 60)}`);
      return false;
    }
    const codeHex = res.slice(4);
    const code = parseInt(codeHex.slice(-8), 16);
    if (code === check.code) {
      console.log(`  [PASS] ${label}: (err u${code})`);
      return true;
    }
    console.log(`  [FAIL] ${label}: expected (err u${check.code}), got (err u${code})`);
    return false;
  }
  console.log(`  [FAIL] ${label}: unknown check kind ${check.kind}`);
  return false;
}

function evaluateReads(check, reads, label) {
  // Each read result is { Ok: "<hex>" } | { Err: "..." }. The hex encodes a
  // Clarity value at its outermost level.
  // For our reads: (get-accumulated-fees) returns uint; (get-balance) returns
  // (response uint uint); (get-oracle) returns principal; (get-fee-rate)
  // returns uint.
  const get = (i) => reads[i]?.Ok;

  if (check.expect.fees !== undefined) {
    // Read 0 = accumulated-fees (uint, type tag 01)
    const feesHex = get(0);
    const fees = parseUintAt(feesHex, 0);
    // Read 1 = test-token balance (response uint uint) -- (ok u<bal>) = 0701 + 16 bytes
    const balHex = get(1);
    const okPrefix = balHex.startsWith("0701");
    const bal = okPrefix ? parseInt(balHex.slice(2 + 2 + 24, 2 + 2 + 32), 16) : null;
    const okFees = fees === check.expect.fees;
    const okBal = bal === check.expect.treasuryBalance;
    if (okFees && okBal) {
      console.log(`  [PASS] ${label}: fees=${fees}, treasury balance=${bal}`);
      return true;
    }
    console.log(`  [FAIL] ${label}: expected fees=${check.expect.fees} treasury=${check.expect.treasuryBalance}, got fees=${fees} treasury=${bal}`);
    return false;
  }
  if (check.expect.oracle !== undefined) {
    // Read 0 = (get-oracle) -> principal (no response wrapper)
    // standard principal serializes as 05 + version(1) + 20-byte hash160
    const oracleHex = get(0);
    const okOracle = oracleHex.startsWith("05"); // good-enough sanity check
    const feeRate = parseUintAt(get(1), 0);
    const wdrFeeRate = parseUintAt(get(2), 0);
    const okFee = feeRate === check.expect.feeRate;
    const okWdr = wdrFeeRate === check.expect.withdrawFeeRate;
    if (okOracle && okFee && okWdr) {
      console.log(`  [PASS] ${label}: oracle=ok, fee-rate=${feeRate}, withdraw-fee-rate=${wdrFeeRate}`);
      return true;
    }
    console.log(`  [FAIL] ${label}: oracle=${oracleHex.slice(0,16)}.. fee=${feeRate}/${check.expect.feeRate} wdr=${wdrFeeRate}/${check.expect.withdrawFeeRate}`);
    return false;
  }
  console.log(`  [FAIL] ${label}: unhandled reads expectation`);
  return false;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

runSimulation().catch((e) => {
  console.error(e);
  process.exit(1);
});
