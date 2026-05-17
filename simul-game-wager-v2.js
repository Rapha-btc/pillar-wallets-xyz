// simul-game-wager-v2.js
// Stxer mainnet-fork simulation for game-wager-v2 (WebAuthn / passkey edition).
//
// Mirrors the v1 sim (simulations/mainnet-wager.ts in the game-wager repo)
// but with passkey signatures instead of Privy secp256k1. The SIP-018 hashes
// are built INLINE in the contract under domain {name="game-wager", version="2.0.0",
// contract=<deployed-game-wager-v2 principal>}, so the challenges have to use
// that exact principal -- this script encodes it as `${DEPLOYER}.game-wager-v2`.
//
// Two-phase workflow (because the wager hash embeds the OPPONENT's pubkey,
// we need both pubkeys before any signing can happen):
//
//   1) On /faktory-v2-sign in fak.fun, register passkey A, save its pubkeyHex.
//   2) On /faktory-v2-sign (different session / clear credential), register
//      passkey B, save its pubkeyHex.
//   3) Run:
//        node simul-game-wager-v2.js --print-challenges \
//          --pubkey-a 0x<A> --pubkey-b 0x<B>
//      Emits two ChallengeBundles (challenges-player-a.json,
//      challenges-player-b.json).
//   4) Sign each via /faktory-v2-sign with the matching passkey.
//      Save the outputs as signed-bundle-player-a.json /
//      signed-bundle-player-b.json.
//   5) Run:
//        node simul-game-wager-v2.js \
//          --signed-a ./signed-bundle-player-a.json \
//          --signed-b ./signed-bundle-player-b.json
//      Submits the sim to stxer and prints the URL.
//
// Auth-id schema (kept tight to minimize signing rounds):
//   Player A: 1=register-wallet  2=wager  3=withdraw
//   Player B: 1=register-wallet  2=wager
//
// (Player B doesn't withdraw in this sim -- A wins. To test B-side withdraw,
// re-sign with auth-id 3 and add the step.)

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  ClarityVersion,
  tupleCV,
  uintCV,
  bufferCV,
  noneCV,
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
// pillar-wallet-trait lives under this principal -- hard-coded in
// game-wager-v2.clar's use-trait, so the sim must deploy under SP28MP1H.
const PILLAR_TRAIT_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
// game-wager-v2's `oracle` data-var defaults to SP28MP1H (line 32 of the
// contract). create-game / resolve-game / cancel-game gate on tx-sender = oracle,
// so the sim runs them from that address.
const ORACLE = PILLAR_TRAIT_DEPLOYER;

const WAGER = `${DEPLOYER}.game-wager-v2`;
const TOKEN = `${DEPLOYER}.test-token`;
const TRAIT = `${DEPLOYER}.sip-010-trait`;
const WEBAUTHN = `${DEPLOYER}.clarity-webauthn`;

// Player wallets: minimal `test-wallet.clar` deployed twice under DEPLOYER,
// once per player. Each impl-traits pillar-wallet-trait and returns
// (ok true) for is-admin-pubkey.
const PLAYER_A_WALLET = `${DEPLOYER}.test-wallet-a`;
const PLAYER_B_WALLET = `${DEPLOYER}.test-wallet-b`;

// Economic params
const MINT_AMOUNT = 10_000_000;
const DEPOSIT_AMOUNT = 1_000_000;
const WAGER_AMOUNT = 500_000;
const WITHDRAW_AMOUNT = 400_000;

// rp.id host the user signs from. /faktory-v2-sign picks this automatically;
// we declare it in the challenge bundle just for the UI.
const RP_ID = "fak.fun";

// ── SIP-018 challenge builder (mirrors contract's inline helpers) ────────────

const SIP018_PREFIX = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();

function gameWagerV2DomainHash() {
  // Matches (get-domain-hash) in game-wager-v2.clar:
  //   { chain-id, contract: (as-contract tx-sender), name: "game-wager", version: "2.0.0" }
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

function specWithdraw(authId, amount, recipient, tokenPrincipal) {
  return tupleCV({
    amount: uintCV(amount),
    "auth-id": uintCV(authId),
    recipient: principalCV(recipient),
    token: principalCV(tokenPrincipal),
    topic: stringAsciiCV("withdraw"),
  });
}

// ── Bundle helpers ───────────────────────────────────────────────────────────

const stripHex = (s) => (s.startsWith("0x") ? s.slice(2) : s);

function sigAuthTuple(signed) {
  return tupleCV({
    "auth-id": uintCV(signed.authId),
    pubkey: bufferCV(Buffer.from(stripHex(signed.pubkeyHex), "hex")),
    signature: bufferCV(Buffer.from(stripHex(signed.signatureHex), "hex")),
    "authenticator-data": bufferCV(Buffer.from(stripHex(signed.authenticatorDataHex), "hex")),
    "client-data-prefix": bufferCV(Buffer.from(stripHex(signed.clientDataPrefixHex), "hex")),
    "client-data-suffix": bufferCV(Buffer.from(stripHex(signed.clientDataSuffixHex), "hex")),
  });
}

// create-game expects a tuple WITHOUT the pubkey field (player pubkey is
// passed as a top-level arg). Same for withdraw / register-wallet.
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

// ── Op builders (shared by --print-challenges and --test-sign) ──────────────

function buildPlayerAOps(pubBHex) {
  const pubB = stripHex(pubBHex);
  return [
    {
      authId: 1,
      label: `Player A · register-wallet -> ${PLAYER_A_WALLET}`,
      challenge: challenge(specRegisterWallet(1, PLAYER_A_WALLET)),
    },
    {
      authId: 2,
      label: `Player A · wager ${WAGER_AMOUNT} GAME vs opponent 0x${pubB.slice(0, 12)}...`,
      challenge: challenge(specWager(2, pubB, TOKEN, WAGER_AMOUNT)),
    },
    {
      authId: 3,
      label: `Player A · withdraw ${WITHDRAW_AMOUNT} GAME -> ${PLAYER_A_WALLET}`,
      // recipient must match the registered wallet (default-to recipient
      // (map-get? pubkey-wallet pubkey)) -- Player A registers PLAYER_A_WALLET.
      challenge: challenge(specWithdraw(3, WITHDRAW_AMOUNT, PLAYER_A_WALLET, TOKEN)),
    },
  ];
}

function buildPlayerBOps(pubAHex) {
  const pubA = stripHex(pubAHex);
  return [
    {
      authId: 1,
      label: `Player B · register-wallet -> ${PLAYER_B_WALLET}`,
      challenge: challenge(specRegisterWallet(1, PLAYER_B_WALLET)),
    },
    {
      authId: 2,
      label: `Player B · wager ${WAGER_AMOUNT} GAME vs opponent 0x${pubA.slice(0, 12)}...`,
      challenge: challenge(specWager(2, pubA, TOKEN, WAGER_AMOUNT)),
    },
  ];
}

// ── Mode: --print-challenges ────────────────────────────────────────────────

function printChallenges(pubkeyAHex, pubkeyBHex) {
  const pubA = stripHex(pubkeyAHex);
  const pubB = stripHex(pubkeyBHex);
  if (pubA.length !== 66 || pubB.length !== 66) {
    throw new Error("pubkey must be 33 bytes / 66 hex chars (compressed)");
  }
  const playerAOps = buildPlayerAOps(pubB);
  const playerBOps = buildPlayerBOps(pubA);

  const bundleA = {
    walletPrincipal: WAGER,
    rpId: RP_ID,
    operations: playerAOps.map((op) => ({
      authId: op.authId,
      label: op.label,
      challengeHex: "0x" + op.challenge.toString("hex"),
    })),
  };
  const bundleB = {
    walletPrincipal: WAGER,
    rpId: RP_ID,
    operations: playerBOps.map((op) => ({
      authId: op.authId,
      label: op.label,
      challengeHex: "0x" + op.challenge.toString("hex"),
    })),
  };

  fs.writeFileSync("./challenges-player-a.json", JSON.stringify(bundleA, null, 2));
  fs.writeFileSync("./challenges-player-b.json", JSON.stringify(bundleB, null, 2));

  console.error("Wrote challenges-player-a.json + challenges-player-b.json");
  console.error("Sign each on /faktory-v2-sign with the matching passkey, then run:");
  console.error("  node simul-game-wager-v2.js --signed-a ./signed-bundle-player-a.json --signed-b ./signed-bundle-player-b.json");
}

// ── Mode: --test-sign (generate ephemeral keys + sign in-script) ────────────

function buildTestBundles() {
  const a = generateP256Keypair();
  const b = generateP256Keypair();
  const playerAOps = buildPlayerAOps(b.pubKeyHex);
  const playerBOps = buildPlayerBOps(a.pubKeyHex);
  const bundleA = buildSignedBundle({
    walletPrincipal: WAGER,
    pubKeyHex: a.pubKeyHex,
    privKey: a.privKey,
    operations: playerAOps,
  });
  const bundleB = buildSignedBundle({
    walletPrincipal: WAGER,
    pubKeyHex: b.pubKeyHex,
    privKey: b.privKey,
    operations: playerBOps,
  });
  return { a, b, bundleA, bundleB };
}

// ── Mode: run simulation ────────────────────────────────────────────────────

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
    // ── pillar-wallet-trait deploys under its hard-coded mainnet address ──
    .withSender(PILLAR_TRAIT_DEPLOYER)
    .addContractDeploy({
      contract_name: "pillar-wallet-trait",
      source_code: pillarTraitSrc,
      clarity_version: ClarityVersion.Clarity5,
    })

    // ── Everything else deploys under DEPLOYER ─────────────────────────────
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

    // ── Setup ─────────────────────────────────────────────────────────────
    .addContractCall({
      contract_id: WAGER,
      function_name: "set-token-whitelist",
      function_args: [principalCV(TOKEN), trueCV()],
      post_condition_mode: PostConditionMode.Allow,
    })
    // Mint enough to cover both deposits (sender = DEPLOYER who mints to self)
    .addContractCall({
      contract_id: TOKEN,
      function_name: "mint",
      function_args: [uintCV(MINT_AMOUNT), principalCV(DEPLOYER)],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Deposit (no sig -- token transfer is the auth) ─────────────────────
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

    // ── Create game (oracle, with both webauthn sigs) ──────────────────────
    .withSender(ORACLE)
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

    // ── Resolve: Player A wins ─────────────────────────────────────────────
    .addContractCall({
      contract_id: WAGER,
      function_name: "resolve-game",
      function_args: [uintCV(0), bufferCV(pubA)],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Register wallets (sig per player; any tx-sender) ───────────────────
    .withSender(DEPLOYER)
    .addContractCall({
      contract_id: WAGER,
      function_name: "register-wallet",
      function_args: [
        contractPrincipalCV(DEPLOYER, "test-wallet-a"),
        sigAuthTuple(bundleA.sig(1)),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addContractCall({
      contract_id: WAGER,
      function_name: "register-wallet",
      function_args: [
        contractPrincipalCV(DEPLOYER, "test-wallet-b"),
        sigAuthTuple(bundleB.sig(1)),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Withdraw 400k for Player A (recipient overridden by mapping) ───────
    .addContractCall({
      contract_id: WAGER,
      function_name: "withdraw",
      function_args: [
        contractPrincipalCV(DEPLOYER, "test-token"),
        stringAsciiCV("game-token"),
        uintCV(WITHDRAW_AMOUNT),
        principalCV(PLAYER_A_WALLET), // matches signed recipient
        sigAuthTuple(bundleA.sig(3)),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Final state reads ──────────────────────────────────────────────────
    .addReads([
      { DataVar: [WAGER, "game-nonce"] },
      { EvalReadonly: [DEPLOYER, "", WAGER, `(get-balance 0x${pubkeyAHex} '${TOKEN})`] },
      { EvalReadonly: [DEPLOYER, "", WAGER, `(get-balance 0x${pubkeyBHex} '${TOKEN})`] },
      { EvalReadonly: [DEPLOYER, "", WAGER, "(get-game u0)"] },
      { EvalReadonly: [DEPLOYER, "", WAGER, `(get-accumulated-fees '${TOKEN})`] },
      { EvalReadonly: [DEPLOYER, "", WAGER, `(get-registered-wallet 0x${pubkeyAHex})`] },
      { EvalReadonly: [DEPLOYER, "", WAGER, `(get-registered-wallet 0x${pubkeyBHex})`] },
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
    "set-token-whitelist(test-token, true)",
    `Mint ${MINT_AMOUNT} GAME to deployer`,
    `Deposit ${DEPOSIT_AMOUNT} for Player A`,
    `Deposit ${DEPOSIT_AMOUNT} for Player B`,
    "create-game (webauthn x2)",
    "resolve-game (A wins)",
    "register-wallet: Player A -> test-wallet-a",
    "register-wallet: Player B -> test-wallet-b",
    `withdraw ${WITHDRAW_AMOUNT} for Player A`,
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
      "game-nonce",
      `Player A balance`,
      `Player B balance`,
      "Game 0",
      "Accumulated fees",
      `Player A registered-wallet`,
      `Player B registered-wallet`,
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
  // End-to-end self-test: ephemeral P-256 keys + in-script signing + run sim.
  const { a, b, bundleA: rawA, bundleB: rawB } = buildTestBundles();
  console.error(`[test-sign] Player A pubkey: 0x${a.pubKeyHex}`);
  console.error(`[test-sign] Player B pubkey: 0x${b.pubKeyHex}`);
  runSimulation(bundleFromJson(rawA, "<test-sign A>"), bundleFromJson(rawB, "<test-sign B>")).catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  const signedA = argVal("--signed-a") ?? "./signed-bundle-player-a.json";
  const signedB = argVal("--signed-b") ?? "./signed-bundle-player-b.json";
  runSimulationFromPaths(signedA, signedB).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
