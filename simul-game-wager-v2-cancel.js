// simul-game-wager-v2-cancel.js
// Stxer mainnet-fork simulation for game-wager-v2's two cancel paths:
//
//   1. Oracle-cancel: oracle drops an active game at any time.
//   2. Timeout-cancel: anyone can cancel once burn-block-height has moved
//      past `created-at + GAME_TIMEOUT` (= u144 in the contract).
//
// `addAdvanceBlocks` (stxer SDK 0.8.0) synthesizes burn blocks so the
// sim can cross that boundary in one shot.
//
// Auth-id schema (each player signs two wager hashes; one per game):
//   Player A: 1=wager-game0  2=wager-game1
//   Player B: 1=wager-game0  2=wager-game1
//
// register-wallet / withdraw are not exercised here -- this sim is
// focused on the cancel paths. See simul-game-wager-v2.js for those.

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
const ORACLE = PILLAR_TRAIT_DEPLOYER;        // game-wager-v2 default oracle
const RANDOM_USER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2"; // cancels via timeout

const WAGER = `${DEPLOYER}.game-wager-v2`;
const TOKEN = `${DEPLOYER}.test-token`;

// Two wagers per player; total 200k -- well below deposit so we don't need
// to top up between games. After cancel-with-fee each player gets back
// wager-amount * (1 - withdraw-fee-rate/10000) = 100k * 99/100 = 99k.
const MINT_AMOUNT = 10_000_000;
const DEPOSIT_AMOUNT = 1_000_000;
const WAGER_AMOUNT = 100_000;

const GAME_TIMEOUT_BLOCKS = 144;
const ADVANCE_BLOCKS = 150; // some margin past the timeout

const RP_ID = "fak.fun";

// ── SIP-018 challenge builder (mirrors game-wager-v2.clar inline helpers) ───

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

// ── Bundle helpers ───────────────────────────────────────────────────────────

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

function bundleFromJson(raw, sourceName = "<inline>") {
  const byAuthId = new Map();
  for (const op of raw.operations) {
    byAuthId.set(op.authId, {
      authId: op.authId,
      pubkeyHex: raw.pubkeyHex,
      signatureHex: op.signatureHex,
      authenticatorDataHex: op.authenticatorDataHex,
      clientDataPrefixHex: op.clientDataPrefixHex,
      clientDataSuffixHex: op.clientDataSuffixHex,
    });
  }
  return {
    pubkeyHex: raw.pubkeyHex,
    walletPrincipal: raw.walletPrincipal,
    sig: (id) => {
      const v = byAuthId.get(id);
      if (!v) throw new Error(`signed bundle ${sourceName} missing auth-id ${id}`);
      return v;
    },
  };
}

function loadBundle(p) {
  if (!fs.existsSync(p)) throw new Error(`Signed bundle not found at ${p}`);
  return bundleFromJson(JSON.parse(fs.readFileSync(p, "utf8")), p);
}

// ── Op builders ──────────────────────────────────────────────────────────────

function buildPlayerAOps(pubBHex) {
  const pubB = stripHex(pubBHex);
  return [
    {
      authId: 1,
      label: `Player A · wager (game-0) ${WAGER_AMOUNT} GAME vs 0x${pubB.slice(0, 12)}...`,
      challenge: challenge(specWager(1, pubB, TOKEN, WAGER_AMOUNT)),
    },
    {
      authId: 2,
      label: `Player A · wager (game-1) ${WAGER_AMOUNT} GAME vs 0x${pubB.slice(0, 12)}...`,
      challenge: challenge(specWager(2, pubB, TOKEN, WAGER_AMOUNT)),
    },
  ];
}

function buildPlayerBOps(pubAHex) {
  const pubA = stripHex(pubAHex);
  return [
    {
      authId: 1,
      label: `Player B · wager (game-0) ${WAGER_AMOUNT} GAME vs 0x${pubA.slice(0, 12)}...`,
      challenge: challenge(specWager(1, pubA, TOKEN, WAGER_AMOUNT)),
    },
    {
      authId: 2,
      label: `Player B · wager (game-1) ${WAGER_AMOUNT} GAME vs 0x${pubA.slice(0, 12)}...`,
      challenge: challenge(specWager(2, pubA, TOKEN, WAGER_AMOUNT)),
    },
  ];
}

function buildTestBundles() {
  const a = generateP256Keypair();
  const b = generateP256Keypair();
  const bundleA = buildSignedBundle({
    walletPrincipal: WAGER,
    pubKeyHex: a.pubKeyHex,
    privKey: a.privKey,
    operations: buildPlayerAOps(b.pubKeyHex),
  });
  const bundleB = buildSignedBundle({
    walletPrincipal: WAGER,
    pubKeyHex: b.pubKeyHex,
    privKey: b.privKey,
    operations: buildPlayerBOps(a.pubKeyHex),
  });
  return { a, b, bundleA, bundleB };
}

// ── Mode: --print-challenges ────────────────────────────────────────────────

function printChallenges(pubkeyAHex, pubkeyBHex) {
  const pubA = stripHex(pubkeyAHex);
  const pubB = stripHex(pubkeyBHex);
  if (pubA.length !== 66 || pubB.length !== 66) {
    throw new Error("pubkey must be 33 bytes / 66 hex chars (compressed)");
  }
  const wrap = (operations) => ({
    walletPrincipal: WAGER,
    rpId: RP_ID,
    operations: operations.map((op) => ({
      authId: op.authId,
      label: op.label,
      challengeHex: "0x" + op.challenge.toString("hex"),
    })),
  });
  fs.writeFileSync("./challenges-cancel-player-a.json", JSON.stringify(wrap(buildPlayerAOps(pubB)), null, 2));
  fs.writeFileSync("./challenges-cancel-player-b.json", JSON.stringify(wrap(buildPlayerBOps(pubA)), null, 2));
  console.error("Wrote challenges-cancel-player-a.json + challenges-cancel-player-b.json");
}

// ── Run simulation ──────────────────────────────────────────────────────────

async function runSimulationFromPaths(signedAPath, signedBPath) {
  return runSimulation(loadBundle(signedAPath), loadBundle(signedBPath));
}

async function runSimulation(bundleA, bundleB) {
  const pubkeyAHex = stripHex(bundleA.pubkeyHex);
  const pubkeyBHex = stripHex(bundleB.pubkeyHex);
  const pubA = Buffer.from(pubkeyAHex, "hex");
  const pubB = Buffer.from(pubkeyBHex, "hex");

  const here = path.dirname(new URL(import.meta.url).pathname);
  const traitSrc = fs.readFileSync(path.join(here, "contracts/sip-010-trait.clar"), "utf8");
  const tokenSrc = fs.readFileSync(path.join(here, "contracts/test-token.clar"), "utf8");
  const webauthnSrc = fs.readFileSync(path.join(here, "contracts/clarity-webauthn.clar"), "utf8");
  const wagerSrc = fs.readFileSync(path.join(here, "contracts/game-wager-v2.clar"), "utf8");
  const pillarTraitSrc = fs.readFileSync(path.join(here, "contracts/deployed/deploying/pillar-wallet-trait.clar"), "utf8");
  const testWalletSrc = fs.readFileSync(path.join(here, "contracts/test-wallet.clar"), "utf8");

  console.error(`Player A pubkey: 0x${pubkeyAHex}`);
  console.error(`Player B pubkey: 0x${pubkeyBHex}`);
  console.error(`game-wager-v2:   ${WAGER}`);

  const builder = SimulationBuilder.new()
    .withSender(PILLAR_TRAIT_DEPLOYER)
    .addContractDeploy({
      contract_name: "pillar-wallet-trait",
      source_code: pillarTraitSrc,
      clarity_version: ClarityVersion.Clarity5,
    })

    .withSender(DEPLOYER)
    .addContractDeploy({
      contract_name: "sip-010-trait",
      source_code: traitSrc,
      clarity_version: ClarityVersion.Clarity5,
    })
    .addContractDeploy({
      contract_name: "test-token",
      source_code: tokenSrc,
      clarity_version: ClarityVersion.Clarity5,
    })
    .addContractDeploy({
      contract_name: "clarity-webauthn",
      source_code: webauthnSrc,
      clarity_version: ClarityVersion.Clarity5,
    })
    // test-wallet contracts aren't strictly required for cancel paths
    // (register-wallet isn't called) but cheap to deploy and keeps
    // parity with the happy-path sim.
    .addContractDeploy({
      contract_name: "test-wallet-a",
      source_code: testWalletSrc,
      clarity_version: ClarityVersion.Clarity5,
    })
    .addContractDeploy({
      contract_name: "test-wallet-b",
      source_code: testWalletSrc,
      clarity_version: ClarityVersion.Clarity5,
    })
    .addContractDeploy({
      contract_name: "game-wager-v2",
      source_code: wagerSrc,
      clarity_version: ClarityVersion.Clarity5,
    })

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

    // ── Deposits (anyone can deposit on behalf of a pubkey) ────────────────
    .addContractCall({
      contract_id: WAGER,
      function_name: "deposit",
      function_args: [
        contractPrincipalCV(DEPLOYER, "test-token"),
        uintCV(DEPOSIT_AMOUNT),
        bufferCV(pubA),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addContractCall({
      contract_id: WAGER,
      function_name: "deposit",
      function_args: [
        contractPrincipalCV(DEPLOYER, "test-token"),
        uintCV(DEPOSIT_AMOUNT),
        bufferCV(pubB),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Game 0: oracle-cancel path ─────────────────────────────────────────
    .withSender(ORACLE)
    .addContractCall({
      contract_id: WAGER,
      function_name: "create-game",
      function_args: [
        bufferCV(pubA),
        bufferCV(pubB),
        principalCV(TOKEN),
        uintCV(WAGER_AMOUNT),
        sigAuthNoPubkey(bundleA.sig(1)),
        sigAuthNoPubkey(bundleB.sig(1)),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addContractCall({
      contract_id: WAGER,
      function_name: "cancel-game",
      function_args: [uintCV(0)],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Game 1: timeout-cancel path ────────────────────────────────────────
    .addContractCall({
      contract_id: WAGER,
      function_name: "create-game",
      function_args: [
        bufferCV(pubA),
        bufferCV(pubB),
        principalCV(TOKEN),
        uintCV(WAGER_AMOUNT),
        sigAuthNoPubkey(bundleA.sig(2)),
        sigAuthNoPubkey(bundleB.sig(2)),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // Skip past GAME_TIMEOUT (u144 burn blocks).
    .addAdvanceBlocks({
      bitcoin_blocks: ADVANCE_BLOCKS,
      stacks_blocks_per_bitcoin: 1,
    })

    // Anyone (not oracle) can cancel after the timeout.
    .withSender(RANDOM_USER)
    .addContractCall({
      contract_id: WAGER,
      function_name: "cancel-game",
      function_args: [uintCV(1)],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Final state reads ──────────────────────────────────────────────────
    .addReads([
      { DataVar: [WAGER, "game-nonce"] },
      { EvalReadonly: [DEPLOYER, "", WAGER, `(get-balance 0x${pubkeyAHex} '${TOKEN})`] },
      { EvalReadonly: [DEPLOYER, "", WAGER, `(get-balance 0x${pubkeyBHex} '${TOKEN})`] },
      { EvalReadonly: [DEPLOYER, "", WAGER, "(get-game u0)"] },
      { EvalReadonly: [DEPLOYER, "", WAGER, "(get-game u1)"] },
      { EvalReadonly: [DEPLOYER, "", WAGER, `(get-accumulated-fees '${TOKEN})`] },
    ]);

  console.error("Submitting simulation...");
  const sessionId = await builder.run();
  console.error(`Session: ${sessionId}`);
  console.error(`URL:     https://stxer.xyz/simulations/mainnet/${sessionId}\n`);

  const result = await getSimulationResult(sessionId);

  const labels = [
    "Deploy pillar-wallet-trait (SP28MP1H)",
    "Deploy sip-010-trait",
    "Deploy test-token",
    "Deploy clarity-webauthn",
    "Deploy test-wallet-a",
    "Deploy test-wallet-b",
    "Deploy game-wager-v2",
    "set-token-whitelist",
    `Mint ${MINT_AMOUNT} GAME`,
    `Deposit ${DEPOSIT_AMOUNT} for Player A`,
    `Deposit ${DEPOSIT_AMOUNT} for Player B`,
    "Game 0: create-game",
    "Game 0: oracle cancel-game (immediate)",
    "Game 1: create-game",
    `AdvanceBlocks(${ADVANCE_BLOCKS}) past GAME_TIMEOUT`,
    "Game 1: timeout cancel-game (by RANDOM_USER)",
    "Read final state",
  ];

  console.log("=== Per-step results ===\n");
  for (let i = 0; i < result.steps.length; i++) {
    printStep(labels[i] ?? `Step ${i}`, result.steps[i]);
  }

  const finalReads = result.steps[result.steps.length - 1]?.Result?.Reads;
  if (finalReads) {
    console.log("\n=== Final state ===\n");
    const readLabels = [
      "game-nonce (expect u2)",
      "Player A balance",
      "Player B balance",
      "Game 0 (oracle-cancelled)",
      "Game 1 (timeout-cancelled)",
      "Accumulated fees",
    ];
    finalReads.forEach((r, i) => {
      console.log(`  ${readLabels[i]}: ${JSON.stringify(r)}`);
    });
  }

  console.log(`\nFull trace: https://stxer.xyz/simulations/mainnet/${sessionId}`);
}

function printStep(label, step) {
  const res = step?.Result;
  let status = "OK";
  let result = "";
  let error = "";

  if (res?.Transaction) {
    const tx = res.Transaction;
    if (tx.Ok) {
      result = tx.Ok.result || "";
      error = tx.Ok.vm_error || "";
    } else if (tx.Err) {
      error = typeof tx.Err === "string" ? tx.Err : JSON.stringify(tx.Err);
    }
  } else if (res?.Eval) {
    if (res.Eval.Ok !== undefined) result = res.Eval.Ok;
    else if (res.Eval.Err !== undefined) error = res.Eval.Err;
  } else if (res?.SetContractCode) {
    if (res.SetContractCode.Ok !== undefined) result = "(deployed)";
    else if (res.SetContractCode.Err !== undefined) error = res.SetContractCode.Err;
  } else if (res?.AdvanceBlocks) {
    result = "(advanced)";
  } else if (res?.Reads) {
    result = JSON.stringify(res.Reads).slice(0, 300);
  }

  if (error) status = "FAIL";
  console.log(`  [${status}] ${label}`);
  if (result) console.log(`         ${String(result).slice(0, 200)}`);
  if (error) console.log(`         ERROR: ${error}`);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function argVal(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const args = process.argv.slice(2);
if (args.includes("--print-challenges")) {
  const a = argVal("--pubkey-a");
  const b = argVal("--pubkey-b");
  if (!a || !b) {
    console.error("Usage: --print-challenges --pubkey-a 0x<33-byte hex> --pubkey-b 0x<33-byte hex>");
    process.exit(1);
  }
  printChallenges(a, b);
} else if (args.includes("--test-sign")) {
  const { a, b, bundleA: rawA, bundleB: rawB } = buildTestBundles();
  console.error(`[test-sign] Player A pubkey: 0x${a.pubKeyHex}`);
  console.error(`[test-sign] Player B pubkey: 0x${b.pubKeyHex}`);
  runSimulation(bundleFromJson(rawA), bundleFromJson(rawB)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  const signedA = argVal("--signed-a") ?? "./signed-bundle-cancel-player-a.json";
  const signedB = argVal("--signed-b") ?? "./signed-bundle-cancel-player-b.json";
  runSimulationFromPaths(signedA, signedB).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
