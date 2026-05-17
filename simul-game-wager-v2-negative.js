// simul-game-wager-v2-negative.js
// Negative-path stxer mainnet-fork sim for game-wager-v2.
//
// Asserts that every guard fires with the expected (err uXXXX) code:
//
//   * err-not-oracle           u7001  -- non-oracle create-game
//   * err-not-deployer         u7002  -- non-deployer set-fee-rate
//   * err-invalid-signature    u7003  -- wrong rp.id authenticator-data
//                                       and random-bytes signature
//   * err-signature-replay     u7010  -- reuse a webauthn sig
//   * err-same-player          u7012  -- create-game with A == B
//   * err-token-not-whitelisted u7013 -- deposit unknown token
//
// Each test step is paired with assertErr() which decodes the contract
// response (SIP-005 binary) and verifies the err-code matches. Steps that
// stxer marks [OK] (because the tx didn't abort) are re-checked here --
// returning (err uXXXX) is the CORRECT behavior for a negative test.
//
// Run: `node simul-game-wager-v2-negative.js --test-sign`

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
import {
  generateP256Keypair,
  signChallenge,
  signChallengeWithRpId,
} from "./lib-webauthn-test-signer.mjs";

// ── Addresses & contracts ────────────────────────────────────────────────────

const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const PILLAR_TRAIT_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const ORACLE = PILLAR_TRAIT_DEPLOYER;          // game-wager-v2 default oracle
const RANDOM_USER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2"; // not oracle, not deployer

const WAGER = `${DEPLOYER}.game-wager-v2`;
const TOKEN = `${DEPLOYER}.test-token`;
// A token that exists but is intentionally NOT whitelisted in game-wager-v2.
const UNAPPROVED_TOKEN = `${DEPLOYER}.unapproved-token`;

const MINT_AMOUNT = 10_000_000;
const DEPOSIT_AMOUNT = 1_000_000;
const WAGER_AMOUNT = 100_000;

// Error codes copied from game-wager-v2.clar.
const ERR_NOT_ORACLE = 7001;
const ERR_NOT_DEPLOYER = 7002;
const ERR_INVALID_SIGNATURE = 7003;
const ERR_SIGNATURE_REPLAY = 7010;
const ERR_SAME_PLAYER = 7012;
const ERR_TOKEN_NOT_WHITELISTED = 7013;

// ── SIP-018 challenge builder (mirrors contract's inline helpers) ───────────

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

function specRegisterWallet(authId, walletPrincipal) {
  return tupleCV({
    "auth-id": uintCV(authId),
    topic: stringAsciiCV("register-wallet"),
    wallet: principalCV(walletPrincipal),
  });
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

function sigAuthTupleFromBytes({ authId, pubKey, signatureHex, authenticatorDataHex, clientDataPrefixHex, clientDataSuffixHex }) {
  return tupleCV({
    "auth-id": uintCV(authId),
    pubkey: bufferCV(pubKey),
    signature: bufferCV(Buffer.from(stripHex(signatureHex), "hex")),
    "authenticator-data": bufferCV(Buffer.from(stripHex(authenticatorDataHex), "hex")),
    "client-data-prefix": bufferCV(Buffer.from(stripHex(clientDataPrefixHex), "hex")),
    "client-data-suffix": bufferCV(Buffer.from(stripHex(clientDataSuffixHex), "hex")),
  });
}

function sigAuthNoPubkey({ authId, signatureHex, authenticatorDataHex, clientDataPrefixHex, clientDataSuffixHex }) {
  return tupleCV({
    "auth-id": uintCV(authId),
    signature: bufferCV(Buffer.from(stripHex(signatureHex), "hex")),
    "authenticator-data": bufferCV(Buffer.from(stripHex(authenticatorDataHex), "hex")),
    "client-data-prefix": bufferCV(Buffer.from(stripHex(clientDataPrefixHex), "hex")),
    "client-data-suffix": bufferCV(Buffer.from(stripHex(clientDataSuffixHex), "hex")),
  });
}

// ── Run ─────────────────────────────────────────────────────────────────────

async function runSimulation() {
  const a = generateP256Keypair();
  const b = generateP256Keypair();
  const pubA = a.pubKey;
  const pubB = b.pubKey;
  console.error(`Player A pubkey: 0x${a.pubKeyHex}`);
  console.error(`Player B pubkey: 0x${b.pubKeyHex}`);

  // ── Build the signatures we'll need ────────────────────────────────────
  // (1) Valid register-wallet sig for replay attack: signed twice, first
  //     use succeeds, second use must fail err-signature-replay.
  const registerChallengeA = challenge(specRegisterWallet(1, `${DEPLOYER}.test-wallet-a`));
  const validRegSigA = signChallenge(registerChallengeA, a.privKey);

  // (2) Wrong-rp.id sig for the same register hash -- correct key, correct
  //     digest, but authenticator-data carries sha256("evil.com").
  const wrongRpRegSigA = signChallengeWithRpId(registerChallengeA, a.privKey, "evil.com");

  // (3) Garbage signature bytes (right shape, random content).
  const garbageRegSigA = {
    signatureHex: "0x" + Buffer.alloc(64, 0xff).toString("hex"),
    authenticatorDataHex: validRegSigA.authenticatorDataHex,
    clientDataPrefixHex: validRegSigA.clientDataPrefixHex,
    clientDataSuffixHex: validRegSigA.clientDataSuffixHex,
  };

  // (4) Valid wager sigs for the same-player attack. Player A wagers
  //     against THEMSELVES -- the contract's `not (is-eq player-a
  //     player-b)` assertion must fire before consume-signature, so the
  //     sig content doesn't actually matter, but we use a real one for
  //     realism. opponent in the hash is also A (since A == B).
  const samePlayerChallenge = challenge(specWager(2, a.pubKeyHex, TOKEN, WAGER_AMOUNT));
  const samePlayerSigA = signChallenge(samePlayerChallenge, a.privKey);

  // ── Sources ────────────────────────────────────────────────────────────
  const here = path.dirname(new URL(import.meta.url).pathname);
  const traitSrc = fs.readFileSync(path.join(here, "contracts/sip-010-trait.clar"), "utf8");
  const tokenSrc = fs.readFileSync(path.join(here, "contracts/test-token.clar"), "utf8");
  const webauthnSrc = fs.readFileSync(path.join(here, "contracts/clarity-webauthn.clar"), "utf8");
  const wagerSrc = fs.readFileSync(path.join(here, "contracts/game-wager-v2.clar"), "utf8");
  const pillarTraitSrc = fs.readFileSync(path.join(here, "contracts/deployed/deploying/pillar-wallet-trait.clar"), "utf8");
  const testWalletSrc = fs.readFileSync(path.join(here, "contracts/test-wallet.clar"), "utf8");

  // ── Build the sim ──────────────────────────────────────────────────────
  const builder = SimulationBuilder.new()
    // Setup
    .withSender(PILLAR_TRAIT_DEPLOYER)
    .addContractDeploy({ contract_name: "pillar-wallet-trait", source_code: pillarTraitSrc, clarity_version: ClarityVersion.Clarity5 })
    .withSender(DEPLOYER)
    .addContractDeploy({ contract_name: "sip-010-trait", source_code: traitSrc, clarity_version: ClarityVersion.Clarity5 })
    .addContractDeploy({ contract_name: "test-token", source_code: tokenSrc, clarity_version: ClarityVersion.Clarity5 })
    // unapproved-token = identical test-token source deployed under a
    // different name so it has a different principal; never whitelisted.
    .addContractDeploy({ contract_name: "unapproved-token", source_code: tokenSrc, clarity_version: ClarityVersion.Clarity5 })
    .addContractDeploy({ contract_name: "clarity-webauthn", source_code: webauthnSrc, clarity_version: ClarityVersion.Clarity5 })
    .addContractDeploy({ contract_name: "test-wallet-a", source_code: testWalletSrc, clarity_version: ClarityVersion.Clarity5 })
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
    .addContractCall({
      contract_id: UNAPPROVED_TOKEN,
      function_name: "mint",
      function_args: [uintCV(MINT_AMOUNT), principalCV(DEPLOYER)],
      post_condition_mode: PostConditionMode.Allow,
    })
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

    // ── Negative tests ─────────────────────────────────────────────────
    // [E1] register-wallet with wrong-rp.id sig (correct key + digest, but
    //      authenticator-data carries sha256("evil.com")).
    .addContractCall({
      contract_id: WAGER,
      function_name: "register-wallet",
      function_args: [
        contractPrincipalCV(DEPLOYER, "test-wallet-a"),
        sigAuthTupleFromBytes({ authId: 1, pubKey: pubA, ...wrongRpRegSigA }),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    // [E2] register-wallet with random-bytes signature.
    .addContractCall({
      contract_id: WAGER,
      function_name: "register-wallet",
      function_args: [
        contractPrincipalCV(DEPLOYER, "test-wallet-a"),
        sigAuthTupleFromBytes({ authId: 1, pubKey: pubA, ...garbageRegSigA }),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // [E3] register-wallet succeeds with valid sig (sets up replay attack).
    .addContractCall({
      contract_id: WAGER,
      function_name: "register-wallet",
      function_args: [
        contractPrincipalCV(DEPLOYER, "test-wallet-a"),
        sigAuthTupleFromBytes({ authId: 1, pubKey: pubA, ...validRegSigA }),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    // [E4] register-wallet REPLAY -- same sig reused -> err-signature-replay.
    .addContractCall({
      contract_id: WAGER,
      function_name: "register-wallet",
      function_args: [
        contractPrincipalCV(DEPLOYER, "test-wallet-a"),
        sigAuthTupleFromBytes({ authId: 1, pubKey: pubA, ...validRegSigA }),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // [E5] deposit with non-whitelisted token -> err-token-not-whitelisted.
    .addContractCall({
      contract_id: WAGER,
      function_name: "deposit",
      function_args: [
        contractPrincipalCV(DEPLOYER, "unapproved-token"),
        uintCV(DEPOSIT_AMOUNT),
        bufferCV(pubA),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // [E6] create-game from non-oracle (RANDOM_USER) -> err-not-oracle.
    .withSender(RANDOM_USER)
    .addContractCall({
      contract_id: WAGER,
      function_name: "create-game",
      function_args: [
        bufferCV(pubA),
        bufferCV(pubB),
        principalCV(TOKEN),
        uintCV(WAGER_AMOUNT),
        sigAuthNoPubkey({ authId: 99, ...samePlayerSigA }),
        sigAuthNoPubkey({ authId: 99, ...samePlayerSigA }),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // [E7] create-game with player-a == player-b -> err-same-player.
    .withSender(ORACLE)
    .addContractCall({
      contract_id: WAGER,
      function_name: "create-game",
      function_args: [
        bufferCV(pubA),
        bufferCV(pubA),
        principalCV(TOKEN),
        uintCV(WAGER_AMOUNT),
        sigAuthNoPubkey({ authId: 2, ...samePlayerSigA }),
        sigAuthNoPubkey({ authId: 2, ...samePlayerSigA }),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // [E8] set-fee-rate by non-deployer -> err-not-deployer.
    .withSender(RANDOM_USER)
    .addContractCall({
      contract_id: WAGER,
      function_name: "set-fee-rate",
      function_args: [uintCV(1000)],
      post_condition_mode: PostConditionMode.Allow,
    });

  console.error("Submitting simulation...");
  const sessionId = await builder.run();
  console.error(`Session: ${sessionId}`);
  console.error(`URL:     https://stxer.xyz/simulations/mainnet/${sessionId}\n`);

  const result = await getSimulationResult(sessionId);

  // ── Step labels paired with expected behavior ──────────────────────────
  const checks = [
    { label: "Deploy pillar-wallet-trait", kind: "ok" },
    { label: "Deploy sip-010-trait", kind: "ok" },
    { label: "Deploy test-token", kind: "ok" },
    { label: "Deploy unapproved-token", kind: "ok" },
    { label: "Deploy clarity-webauthn", kind: "ok" },
    { label: "Deploy test-wallet-a", kind: "ok" },
    { label: "Deploy game-wager-v2", kind: "ok" },
    { label: "set-token-whitelist(test-token)", kind: "okBool" },
    { label: `Mint ${MINT_AMOUNT} GAME to deployer`, kind: "okBool" },
    { label: `Mint ${MINT_AMOUNT} unapproved-token`, kind: "okBool" },
    { label: `Deposit ${DEPOSIT_AMOUNT} for Player A (setup)`, kind: "okBool" },
    { label: "[E1] register-wallet wrong-rp.id sig", kind: "err", code: ERR_INVALID_SIGNATURE },
    { label: "[E2] register-wallet random-bytes sig", kind: "err", code: ERR_INVALID_SIGNATURE },
    { label: "[E3] register-wallet valid sig (sets up replay)", kind: "okBool" },
    { label: "[E4] register-wallet REPLAY of same sig", kind: "err", code: ERR_SIGNATURE_REPLAY },
    { label: "[E5] deposit unapproved-token", kind: "err", code: ERR_TOKEN_NOT_WHITELISTED },
    { label: "[E6] create-game from non-oracle", kind: "err", code: ERR_NOT_ORACLE },
    { label: "[E7] create-game same-player (A vs A)", kind: "err", code: ERR_SAME_PLAYER },
    { label: "[E8] set-fee-rate by non-deployer", kind: "err", code: ERR_NOT_DEPLOYER },
  ];

  let passes = 0, fails = 0;
  console.log("=== Per-step results ===\n");
  for (let i = 0; i < result.steps.length; i++) {
    const check = checks[i];
    const step = result.steps[i];
    const ok = evaluateStep(check, step);
    if (ok) { passes++; } else { fails++; }
  }

  console.log(`\n${passes} pass, ${fails} fail.`);
  console.log(`Full trace: https://stxer.xyz/simulations/mainnet/${sessionId}`);
  if (fails > 0) process.exit(1);
}

// ── Step evaluator ──────────────────────────────────────────────────────────

function getResultHex(step) {
  const tx = step?.Result?.Transaction;
  if (tx?.Ok?.result) return tx.Ok.result;
  if (step?.Result?.SetContractCode?.Ok !== undefined) return "(deployed)";
  return null;
}

function evaluateStep(check, step) {
  const label = check?.label ?? "<unlabeled>";
  const res = getResultHex(step);
  if (!res) {
    console.log(`  [FAIL] ${label}: no transaction result`);
    return false;
  }
  if (check.kind === "ok") {
    if (res === "(deployed)") {
      console.log(`  [PASS] ${label}`);
      return true;
    }
    if (res.startsWith("07")) { // any ResponseOk
      console.log(`  [PASS] ${label}: ${res.slice(0, 30)}`);
      return true;
    }
    console.log(`  [FAIL] ${label}: expected ok, got ${res.slice(0, 60)}`);
    return false;
  }
  if (check.kind === "okBool") {
    // (ok true) = 0703
    if (res === "0703") {
      console.log(`  [PASS] ${label}: (ok true)`);
      return true;
    }
    console.log(`  [FAIL] ${label}: expected (ok true), got ${res.slice(0, 60)}`);
    return false;
  }
  if (check.kind === "err") {
    // (err u<code>) = 08 01 <16-byte BE uint>
    if (!res.startsWith("0801") || res.length !== 36) {
      console.log(`  [FAIL] ${label}: expected (err u${check.code}), got ${res.slice(0, 60)}`);
      return false;
    }
    const codeHex = res.slice(4);
    const code = parseInt(codeHex.slice(-8), 16); // u32 is enough for our codes
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

// ── CLI ──────────────────────────────────────────────────────────────────────

runSimulation().catch((e) => {
  console.error(e);
  process.exit(1);
});
