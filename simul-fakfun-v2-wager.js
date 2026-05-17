// simul-fakfun-v2-wager.js
// Stxer mainnet-fork sim covering fakfun-wallet-v2.wager-deposit against
// game-wager-v2 (webauthn end-to-end -- no more secp256k1 bridge).
//
// game-wager-v2 + pillar-wallet-trait don't exist on mainnet yet, so the sim
// deploys them under SP28MP1H... (the game-wager deployer principal). The
// wallet declares (impl-trait pillar-wallet-trait); v2.register-wallet then
// accepts it as a <pillar-wallet-trait> arg and calls back into the wallet's
// is-admin-pubkey to verify the pubkey belongs to this wallet.
//
// Coverage:
//   - pillar-wallet-trait deploy
//   - game-wager-v2 deploy
//   - game-wager-v2.set-token-whitelist
//   - game-wager-v2.register-wallet (webauthn sig over v2's SIP-018 domain)
//   - fakfun-wallet-v2.wager-deposit -> game-wager-v2.deposit (webauthn sig
//     over auth-v7's domain, same as v1 flow)
//
// Steps:
//   A. Setup (deploy webauthn + auth-helpers + pillar-wallet-trait +
//      game-wager-v2 + wallet, register hash, onboard, 3-step admin add, fund)
//   B. game-wager-v2.set-token-whitelist(sBTC, true) as v2 deployer
//   C. game-wager-v2.register-wallet(wallet, sig-auth-200)
//   D. fakfun-wallet-v2.wager-deposit(sBTC, amount, USER_PUBKEY, sig-auth-201)
//
// New webauthn sigs needed (2):
//   auth-id 200 = register-wallet on game-wager-v2 (v2 domain)
//   auth-id 201 = wager-deposit on the wallet (auth-v7 domain, embeds USER's
//                 webauthn pubkey -- distinct from the prior secp256k1 pubkey
//                 sig that lived at auth-id 20)
// Reused from signed-bundle-admin.json: auth-id 0 (propose-admin).
// Reused from signed-bundle-followup.json: auth-id 99 (confirm-admin).

import fs from "node:fs";
import crypto from "node:crypto";
import {
  ClarityVersion,
  tupleCV,
  uintCV,
  bufferCV,
  noneCV,
  someCV,
  trueCV,
  principalCV,
  contractPrincipalCV,
  stringAsciiCV,
  serializeCV,
  PostConditionMode,
} from "@stacks/transactions";
import { SimulationBuilder } from "stxer";

// ── Addresses & contracts ───────────────────────────────────────────────────

const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP1G655MB1JVQ5FBE2JJ3E01HEA6KBM4H39F5EW63";
const USER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";
const GAME_WAGER_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";

const WALLET_NAME = "fakfun-wallet-v2";
const WALLET = `${DEPLOYER}.${WALLET_NAME}`;
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core`;
const GAME_WAGER_V2 = `${GAME_WAGER_DEPLOYER}.game-wager-v2`;
const PILLAR_TRAIT = `${GAME_WAGER_DEPLOYER}.pillar-wallet-trait`;
const AUTH_V7 = `${GAME_WAGER_DEPLOYER}.auth-v7`;
const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";

// Wager params
const WAGER_AMOUNT = 1000;

// ── SIP-018 challenge builders ──────────────────────────────────────────────

const SIP018_PREFIX = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();

// Wallet domain -- used by the wallet's local auth helpers
// (smart-wallet-standard-auth-helpers-v7). Matches its get-domain-hash:
// name="smart-wallet-standard", version="1.0.0", wallet=contract-caller.
function walletDomainHash() {
  const domain = tupleCV({
    name: stringAsciiCV("smart-wallet-standard"),
    version: stringAsciiCV("1.0.0"),
    "chain-id": uintCV(1),
    wallet: principalCV(WALLET),
  });
  return sha256(Buffer.from(serializeCV(domain), "hex"));
}

function walletChallenge(topicTuple) {
  const msgHash = sha256(Buffer.from(serializeCV(topicTuple), "hex"));
  return sha256(Buffer.concat([SIP018_PREFIX, walletDomainHash(), msgHash]));
}

// game-wager-v2 domain -- used by v2.register-wallet, v2.withdraw, v2.create-game.
function v2DomainHash() {
  const domain = tupleCV({
    "chain-id": uintCV(1),
    contract: principalCV(GAME_WAGER_V2),
    name: stringAsciiCV("game-wager"),
    version: stringAsciiCV("2.0.0"),
  });
  return sha256(Buffer.from(serializeCV(domain), "hex"));
}

function v2Challenge(topicTuple) {
  const msgHash = sha256(Buffer.from(serializeCV(topicTuple), "hex"));
  return sha256(Buffer.concat([SIP018_PREFIX, v2DomainHash(), msgHash]));
}

function specRegisterWalletV2(authId, walletPrincipal) {
  return tupleCV({
    "auth-id": uintCV(authId),
    topic: stringAsciiCV("register-wallet"),
    wallet: principalCV(walletPrincipal),
  });
}

function specWagerDeposit(authId, amount, pubkeyHex, tokenPrincipal) {
  return tupleCV({
    amount: uintCV(amount),
    "auth-id": uintCV(authId),
    pubkey: bufferCV(Buffer.from(stripHex(pubkeyHex), "hex")),
    token: principalCV(tokenPrincipal),
    topic: stringAsciiCV("wager-deposit"),
  });
}

// ── Sig-auth helpers ────────────────────────────────────────────────────────

function stripHex(s) {
  return s.startsWith("0x") ? s.slice(2) : s;
}

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

function sigAuthOptional(signed) {
  return someCV(sigAuthTuple(signed));
}

function loadBundle(path) {
  if (!fs.existsSync(path)) throw new Error(`Signed bundle not found at ${path}`);
  const raw = JSON.parse(fs.readFileSync(path, "utf8"));
  const map = new Map();
  for (const op of raw.operations) {
    map.set(op.authId, {
      authId: op.authId,
      pubkeyHex: raw.pubkeyHex,
      signatureHex: op.signatureHex,
      authenticatorDataHex: op.authenticatorDataHex,
      clientDataPrefixHex: op.clientDataPrefixHex,
      clientDataSuffixHex: op.clientDataSuffixHex,
    });
  }
  return { pubkeyHex: raw.pubkeyHex, walletPrincipal: raw.walletPrincipal, byAuthId: map };
}

function mergeBundles(...bundles) {
  const merged = new Map();
  let pubkey, wallet;
  for (const b of bundles) {
    pubkey = b.pubkeyHex;
    wallet = b.walletPrincipal;
    for (const [k, v] of b.byAuthId) merged.set(k, v);
  }
  return {
    pubkeyHex: pubkey,
    walletPrincipal: wallet,
    sig: (id) => {
      const v = merged.get(id);
      if (!v) throw new Error(`Signed bundle missing auth-id ${id}`);
      return v;
    },
  };
}

// ── Operations ──────────────────────────────────────────────────────────────

function buildOperations(userPubkeyHex) {
  return [
    {
      authId: 200,
      label: "game-wager-v2.register-wallet (wallet=fakfun-wallet-v2)",
      challenge: v2Challenge(specRegisterWalletV2(200, WALLET)),
    },
    {
      authId: 201,
      label: `wager-deposit ${WAGER_AMOUNT} sats sBTC for USER pubkey`,
      challenge: walletChallenge(
        specWagerDeposit(201, WAGER_AMOUNT, userPubkeyHex, SBTC_TOKEN),
      ),
    },
  ];
}

// ── Modes ───────────────────────────────────────────────────────────────────

function printChallenges() {
  // Pull the user pubkey from the existing init bundle (so the wager-deposit
  // hash binds to the same passkey the wallet was initialized with).
  const initBundle = JSON.parse(fs.readFileSync("./signed-bundle-init.json", "utf8"));
  const userPubkeyHex = initBundle.pubkeyHex;
  const ops = buildOperations(userPubkeyHex);
  const bundle = {
    walletPrincipal: WALLET,
    rpId: "fak.fun",
    pubkeyHex: userPubkeyHex,
    operations: ops.map((op) => ({
      authId: op.authId,
      label: op.label,
      challengeHex: "0x" + op.challenge.toString("hex"),
    })),
  };
  process.stdout.write(JSON.stringify(bundle, null, 2) + "\n");
}

async function runSimulation(wagerBundlePath, adminBundlePath) {
  const wagerB = loadBundle(wagerBundlePath);
  const adminB = loadBundle(adminBundlePath);
  const here = new URL(".", import.meta.url).pathname;
  const followupPath = `${here}signed-bundle-followup.json`;
  const bundlesToMerge = [adminB, wagerB];
  if (fs.existsSync(followupPath)) bundlesToMerge.push(loadBundle(followupPath));
  const signed = mergeBundles(...bundlesToMerge);
  if (signed.walletPrincipal !== WALLET) {
    throw new Error(`Bundle wallet ${signed.walletPrincipal} != sim wallet ${WALLET}`);
  }
  const pubkeyHex = signed.pubkeyHex;
  const pubkeyBuff = bufferCV(Buffer.from(stripHex(pubkeyHex), "hex"));

  const walletSource = fs.readFileSync(`${here}contracts/fakfun-wallet-v2.clar`, "utf8");
  const webauthnSource = fs.readFileSync(`${here}contracts/clarity-webauthn.clar`, "utf8");
  const authHelpersSource = fs.readFileSync(
    `${here}contracts/smart-wallet-standard-auth-helpers-v7.clar`,
    "utf8",
  );
  const pillarTraitSource = fs.readFileSync(
    `${here}contracts/deployed/deploying/pillar-wallet-trait.clar`,
    "utf8",
  );
  const gameWagerV2Source = fs.readFileSync(
    `${here}contracts/game-wager-v2.clar`,
    "utf8",
  );

  const v2Hash = crypto.createHash("sha512-256").update(walletSource).digest();
  console.error("fakfun-wallet-v2 hash:", v2Hash.toString("hex"));

  const builder = SimulationBuilder.new()

    // ── Phase A: setup ────────────────────────────────────────────────────
    .withSender(DEPLOYER)
    .addContractDeploy({
      contract_name: "clarity-webauthn",
      source_code: webauthnSource,
      clarity_version: ClarityVersion.Clarity5,
    })
    .addContractDeploy({
      contract_name: "smart-wallet-standard-auth-helpers-v7",
      source_code: authHelpersSource,
      clarity_version: ClarityVersion.Clarity5,
    })
    // pillar-wallet-trait deploys from SP28MP1H so its address matches the
    // wallet's (use-trait .../pillar-wallet-trait.pillar-wallet-trait) ref.
    .withSender(GAME_WAGER_DEPLOYER)
    .addContractDeploy({
      contract_name: "pillar-wallet-trait",
      source_code: pillarTraitSource,
      clarity_version: ClarityVersion.Clarity5,
    })
    .addContractDeploy({
      contract_name: "game-wager-v2",
      source_code: gameWagerV2Source,
      clarity_version: ClarityVersion.Clarity5,
    })
    // back to DEPLOYER to register wallet hash and deploy the wallet
    .withSender(DEPLOYER)
    .addContractCall({
      contract_id: WALLET_CORE,
      function_name: "set-verified-contract",
      function_args: [principalCV(WALLET), someCV(bufferCV(v2Hash))],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addContractDeploy({
      contract_name: WALLET_NAME,
      source_code: walletSource,
      clarity_version: ClarityVersion.Clarity5,
    })
    .withSender(FAKFUN_DEPLOYER)
    .addContractCall({
      contract_id: WALLET,
      function_name: "onboard",
      function_args: [pubkeyBuff],
      post_condition_mode: PostConditionMode.Allow,
    })
    .withSender(USER)
    .addContractCall({
      contract_id: WALLET,
      function_name: "propose-admin-with-signature",
      function_args: [principalCV(USER), sigAuthTuple(signed.sig(0)), noneCV()],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addContractCall({
      contract_id: WALLET,
      function_name: "accept-admin-proposal",
      function_args: [],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addAdvanceBlocks({ bitcoin_blocks: 440, stacks_blocks_per_bitcoin: 1 })
    .addContractCall({
      contract_id: WALLET,
      function_name: "confirm-admin-with-signature",
      function_args: [sigAuthTuple(signed.sig(99)), noneCV()],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addContractCall({
      contract_id: SBTC_TOKEN,
      function_name: "transfer",
      function_args: [
        uintCV(100_000),
        principalCV(USER),
        contractPrincipalCV(DEPLOYER, WALLET_NAME),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase B: whitelist sBTC on game-wager-v2 ──────────────────────────
    .withSender(GAME_WAGER_DEPLOYER)
    .addContractCall({
      contract_id: GAME_WAGER_V2,
      function_name: "set-token-whitelist",
      function_args: [principalCV(SBTC_TOKEN), trueCV()],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase C: register the wallet on game-wager-v2 (webauthn sig 200) ──
    .withSender(USER)
    .addContractCall({
      contract_id: GAME_WAGER_V2,
      function_name: "register-wallet",
      function_args: [
        contractPrincipalCV(DEPLOYER, WALLET_NAME),
        sigAuthTuple(signed.sig(200)),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(GAME_WAGER_V2, `(get-registered-wallet 0x${stripHex(pubkeyHex)})`)

    // ── Phase D: wager-deposit (webauthn sig 201) ─────────────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "wager-deposit",
      function_args: [
        contractPrincipalCV("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token"),
        stringAsciiCV("sbtc-token"),
        uintCV(WAGER_AMOUNT),
        pubkeyBuff,
        sigAuthOptional(signed.sig(201)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Final state checks ────────────────────────────────────────────────
    .addEvalCode(WALLET, "(get-owner)")
    .addEvalCode(GAME_WAGER_V2, `(get-balance 0x${stripHex(pubkeyHex)} '${SBTC_TOKEN})`)
    .addEvalCode(GAME_WAGER_V2, `(is-token-whitelisted '${SBTC_TOKEN})`);

  await builder.run();
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes("--print-challenges")) {
  printChallenges();
} else {
  const idx = args.indexOf("--signed");
  const wagerPath = idx >= 0 ? args[idx + 1] : "./signed-bundle-wager.json";
  const adminPath = "./signed-bundle-admin.json";
  runSimulation(wagerPath, adminPath).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
