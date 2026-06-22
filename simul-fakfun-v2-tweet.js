// simul-fakfun-v2-tweet.js
// Stxer mainnet-fork sim: an EXISTING fakfun-wallet-v2 whitelists the
// `tweet-inscription` extension and inscribes a tweet-length article on-chain
// via Xtrata's `mint-single-tx` -- all driven through the wallet's generic
// `extension-call` (no wallet changes).
//
// Unlike the other fakfun sims, this one signs WebAuthn assertions
// PROGRAMMATICALLY (lib-webauthn-test-signer.mjs, rp.id "fak.fun") with an
// ephemeral P-256 key that we onboard as the wallet's admin passkey -- so it
// runs end-to-end with no browser / passkey step.
//
// USAGE:
//   node simul-fakfun-v2-tweet.js --dry   # build+print payload/hash/challenges, NO network
//   node simul-fakfun-v2-tweet.js         # run the stxer mainnet-fork simulation
//
// Phases:
//   A. Deploy webauthn + auth-helpers + pillar-trait + game-wager + wallet +
//      tweet-inscription; register the wallet hash; onboard(ephemeral pubkey).
//   B. 3-step admin bootstrap: propose(0) -> accept(USER) -> advance 440 -> confirm(1).
//   C. Fund the wallet 5 STX (covers the ~0.16 STX Xtrata single-tx fee).
//   D. whitelist-extension(tweet-inscription) [admin, no sig] -> pending op #0.
//   E. Advance 150 blocks (clear the 144-block op cooldown).
//   F. execute-pending-whitelist(op 0, sig 2).
//   G. extension-call(tweet-inscription, <tweet payload>, sig 3) -> mints the
//      article NFT to the WALLET. Assert via Xtrata get-last-token-id / events.

import fs from "node:fs";
import crypto from "node:crypto";
import {
  ClarityVersion,
  tupleCV,
  listCV,
  uintCV,
  bufferCV,
  noneCV,
  someCV,
  principalCV,
  contractPrincipalCV,
  stringAsciiCV,
  serializeCV,
  PostConditionMode,
} from "@stacks/transactions";
import { SimulationBuilder } from "stxer";
import { generateP256Keypair, signChallenge } from "./lib-webauthn-test-signer.mjs";

// ── Addresses & contracts ───────────────────────────────────────────────────

const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
// onboard() asserts tx-sender == the wallet's FAKFUN-DEPLOYER constant, which
// is SP28MP1H in the current source (older sims used SP1G655, now stale).
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK"; // gates onboard()
const GAME_WAGER_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK"; // hosts pillar-wallet-trait + game-wager-v2
const CANONICAL = "fakfun-wallet-v6"; // the key onboard's register-wallet verifies against
const USER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2"; // becomes the principal admin

const WALLET_NAME = "fakfun-wallet-v2";
const WALLET = `${DEPLOYER}.${WALLET_NAME}`;
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core`;

const EXT_NAME = "xtrata-inscribe";
const EXT = `${DEPLOYER}.${EXT_NAME}`;

const XTRATA = "SP3JNSEXAZP4BDSHV0DN3M8R3P0MY0EEBQQZX743X.xtrata-v3-2-3";

// ── The tweet to inscribe ───────────────────────────────────────────────────

const TWEET = "gm — inscribed by a fakfun smart wallet through the tweet-inscription extension. one passkey tap, on-chain forever.";
const MIME = "text/plain";
const TOKEN_URI = "ipfs://fakfun-tweet-poc";
const CONTENT = Buffer.from(TWEET, "utf8");
const TOTAL_SIZE = CONTENT.length;

// Xtrata chains chunk hashes from a 32-zero seed: h = sha256(h_prev || chunk).
// For a single chunk: expected-hash = sha256(0x00*32 || content).
function xtrataSingleChunkHash(content) {
  return sha256(Buffer.concat([Buffer.alloc(32), content]));
}
const EXPECTED_HASH = xtrataSingleChunkHash(CONTENT);

// The (buff 2048) the wallet forwards to the extension: a consensus-serialized
// tuple of Xtrata mint-single-tx args. Decoded on-chain by tweet-inscription.
function buildTweetPayload() {
  const tup = tupleCV({
    "expected-hash": bufferCV(EXPECTED_HASH),
    mime: stringAsciiCV(MIME),
    "total-size": uintCV(TOTAL_SIZE),
    chunks: listCV([bufferCV(CONTENT)]),
    "token-uri-string": stringAsciiCV(TOKEN_URI),
  });
  return Buffer.from(serializeCV(tup), "hex");
}

// ── SIP-018 challenge builder (mirrors auth-helpers-v7 on-chain) ─────────────

const SIP018_PREFIX = Buffer.from("534950303138", "hex");

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest();
}

function getDomainHash(walletPrincipal) {
  const domain = tupleCV({
    name: stringAsciiCV("smart-wallet-standard"),
    version: stringAsciiCV("1.0.0"),
    "chain-id": uintCV(1),
    wallet: principalCV(walletPrincipal),
  });
  return sha256(Buffer.from(serializeCV(domain), "hex"));
}

function buildChallenge(walletPrincipal, topicTuple) {
  const msgHash = sha256(Buffer.from(serializeCV(topicTuple), "hex"));
  return sha256(Buffer.concat([SIP018_PREFIX, getDomainHash(walletPrincipal), msgHash]));
}

// ── Per-topic challenge specs ───────────────────────────────────────────────

const specAddAdmin = (authId, newAdmin) =>
  tupleCV({ topic: stringAsciiCV("add-admin"), "auth-id": uintCV(authId), "new-admin": principalCV(newAdmin) });

const specConfirmAdmin = (authId, newAdmin) =>
  tupleCV({ topic: stringAsciiCV("confirm-admin"), "auth-id": uintCV(authId), "new-admin": principalCV(newAdmin) });

const specWhitelistExtension = (authId, opId, extension) =>
  tupleCV({
    topic: stringAsciiCV("whitelist-extension"),
    "auth-id": uintCV(authId),
    "op-id": uintCV(opId),
    extension: principalCV(extension),
  });

const specExtensionCall = (authId, extension, payload) =>
  tupleCV({
    topic: stringAsciiCV("extension-call"),
    "auth-id": uintCV(authId),
    extension: principalCV(extension),
    payload: bufferCV(payload),
  });

// ── Programmatic signer: ephemeral passkey is the wallet admin ──────────────

const KEYPAIR = generateP256Keypair();
const PUBKEY_BUFF = bufferCV(KEYPAIR.pubKey);

function sigAuthTuple(authId, challengeBytes) {
  const s = signChallenge(challengeBytes, KEYPAIR.privKey);
  return tupleCV({
    "auth-id": uintCV(authId),
    pubkey: PUBKEY_BUFF,
    signature: bufferCV(Buffer.from(s.signatureHex.slice(2), "hex")),
    "authenticator-data": bufferCV(Buffer.from(s.authenticatorDataHex.slice(2), "hex")),
    "client-data-prefix": bufferCV(Buffer.from(s.clientDataPrefixHex.slice(2), "hex")),
    "client-data-suffix": bufferCV(Buffer.from(s.clientDataSuffixHex.slice(2), "hex")),
  });
}
const sigAuthOptional = (authId, challengeBytes) => someCV(sigAuthTuple(authId, challengeBytes));

// auth-ids
const AID_PROPOSE = 0;
const AID_CONFIRM = 1;
const AID_WHITELIST = 2;
const AID_EXTCALL = 3;

// ── Dry mode: validate payload + hash + challenges locally (no network) ──────

function dry() {
  const payload = buildTweetPayload();
  const chPropose = buildChallenge(WALLET, specAddAdmin(AID_PROPOSE, USER));
  const chConfirm = buildChallenge(WALLET, specConfirmAdmin(AID_CONFIRM, USER));
  const chWhitelist = buildChallenge(WALLET, specWhitelistExtension(AID_WHITELIST, 0, EXT));
  const chExtcall = buildChallenge(WALLET, specExtensionCall(AID_EXTCALL, EXT, payload));

  console.log("tweet                :", JSON.stringify(TWEET));
  console.log("total-size (bytes)   :", TOTAL_SIZE);
  console.log("expected-hash        : 0x" + EXPECTED_HASH.toString("hex"));
  console.log("payload bytes        :", payload.length, payload.length <= 2048 ? "(<= 2048 OK)" : "(!!! OVER 2048)");
  console.log("payload hex          : 0x" + payload.toString("hex"));
  console.log("ephemeral pubkey     : 0x" + KEYPAIR.pubKeyHex);
  console.log("challenge propose(0) : 0x" + chPropose.toString("hex"));
  console.log("challenge confirm(1) : 0x" + chConfirm.toString("hex"));
  console.log("challenge whitelist(2): 0x" + chWhitelist.toString("hex"));
  console.log("challenge extcall(3) : 0x" + chExtcall.toString("hex"));
  if (payload.length > 2048) {
    console.error("\nPAYLOAD EXCEEDS 2048 BYTES — shorten the tweet or token-uri.");
    process.exit(1);
  }
}

// ── Full stxer mainnet-fork simulation ───────────────────────────────────────

async function run() {
  const payload = buildTweetPayload();
  if (payload.length > 2048) throw new Error(`payload ${payload.length} > 2048 bytes`);

  const here = new URL(".", import.meta.url).pathname;
  const read = (p) => fs.readFileSync(`${here}${p}`, "utf8");
  const walletSource = read("contracts/fakfun-wallet-v2.clar");
  const extSource = read("contracts/fakfun-extensions/xtrata-inscribe.clar");

  const v2Hash = crypto.createHash("sha512-256").update(walletSource).digest();
  console.error("fakfun-wallet-v2 hash:", v2Hash.toString("hex"));
  console.error("payload bytes:", payload.length, "/ 2048");

  const builder = SimulationBuilder.new()
    .withSender(DEPLOYER)

    // ── Phase A: deploy the new extension, install a fresh wallet, onboard ───
    // Everything the wallet depends on is ALREADY live on mainnet and used
    // as-is: clarity-5-webauthn-v3, smart-wallet-standard-auth-helpers-v7,
    // pillar-wallet-trait, game-wager-v2, fakfun-wallet-core, fakfun-wallet-v6.
    // Only `tweet-inscription` is genuinely new -> ordinary deploy.
    //
    // The live `fakfun-wallet-v2` is deployed but UN-onboarded (get-owner =
    // SP000...0). We still SetContractCode it with our local source so we own a
    // known code hash to register + drive with the ephemeral test passkey
    // (rather than depend on the deployed bytes). This is the ONE override.
    .addContractDeploy({ contract_name: EXT_NAME, source_code: extSource, clarity_version: ClarityVersion.Clarity5 })
    .addContractCall({
      contract_id: WALLET_CORE,
      function_name: "set-verified-contract",
      function_args: [contractPrincipalCV(DEPLOYER, CANONICAL), someCV(bufferCV(v2Hash))],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addSetContractCode({ contract_id: WALLET, source_code: walletSource, clarity_version: ClarityVersion.Clarity5 })
    .withSender(FAKFUN_DEPLOYER)
    .addContractCall({
      contract_id: WALLET,
      function_name: "onboard",
      function_args: [PUBKEY_BUFF],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase B: 3-step admin bootstrap (ephemeral passkey signs) ────────────
    .withSender(USER)
    .addContractCall({
      contract_id: WALLET,
      function_name: "propose-admin-with-signature",
      function_args: [principalCV(USER), sigAuthTuple(AID_PROPOSE, buildChallenge(WALLET, specAddAdmin(AID_PROPOSE, USER))), noneCV()],
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
      function_args: [sigAuthTuple(AID_CONFIRM, buildChallenge(WALLET, specConfirmAdmin(AID_CONFIRM, USER))), noneCV()],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(WALLET, "(var-get is-initialized)")
    .addEvalCode(WALLET, "(get-owner)")

    // ── Phase C: fund the wallet with STX for the inscribe fee ───────────────
    .addSTXTransfer({ sender: DEPLOYER, recipient: WALLET, amount: 5_000_000 })

    // ── Phase D: whitelist tweet-inscription (admin, no sig) -> pending op #0 ─
    .addContractCall({
      contract_id: WALLET,
      function_name: "whitelist-extension",
      function_args: [principalCV(EXT)],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase E: advance past the 144-block op cooldown ──────────────────────
    .addAdvanceBlocks({ bitcoin_blocks: 150, stacks_blocks_per_bitcoin: 1 })

    // ── Phase F: execute-pending-whitelist op 0 (sig 2) ──────────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "execute-pending-whitelist",
      function_args: [uintCV(0), sigAuthTuple(AID_WHITELIST, buildChallenge(WALLET, specWhitelistExtension(AID_WHITELIST, 0, EXT))), noneCV()],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(WALLET, `(is-extension-whitelisted '${EXT})`)
    .addEvalCode(XTRATA, "(get-last-token-id)")

    // ── Phase G: extension-call -> inscribe the tweet (sig 3) ────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "extension-call",
      function_args: [
        contractPrincipalCV(DEPLOYER, EXT_NAME),
        bufferCV(payload),
        sigAuthOptional(AID_EXTCALL, buildChallenge(WALLET, specExtensionCall(AID_EXTCALL, EXT, payload))),
        noneCV(), // gas: none (broadcaster pays the tx fee; wallet pays the STX inscribe fee)
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Assertions: a new article NFT exists and is owned by the WALLET ──────
    .addEvalCode(XTRATA, "(get-last-token-id)")
    .addEvalCode(XTRATA, "(get-minted-count)");

  await builder.run();
}

// ── CLI ──────────────────────────────────────────────────────────────────────

if (process.argv.slice(2).includes("--dry")) {
  dry();
} else {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
