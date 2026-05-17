// simul-fakfun-v2-limit.js
// Stxer mainnet-fork simulation covering the new `faktory-execute-limit`
// primitive end-to-end + the token-lock assertion that was added to
// `extension-call`.
//
// Coverage:
//   Phase B  faktory-execute-limit happy   -> (ok {dx, dy, dk})
//   Phase C  replay protection             -> err-signature-replay (u4006)
//   Phase D  limit-out unreachable         -> err-limit-not-hit (u4025), sig NOT consumed
//   Phase E  re-submit too-strict          -> err-limit-not-hit again (sig retryable)
//   Phase F  whitelist test-extension      -> ok (admin + execute-pending sig)
//   Phase G  enable token-lock (admin)     -> ok
//   Phase H  extension-call under lock     -> err-token-locked (u4023)
//   Phase I  advance past expiry burn block
//   Phase J  faktory-execute-limit expired -> err-limit-expired (u4024)
//
// New signatures needed (3): auth-id 10, 11, 12 for faktory-execute-limit.
// Reused from signed-bundle-admin.json (3): auth-id 0 (add-admin),
// auth-id 2 (execute-pending-whitelist), auth-id 3 (extension-call).
//
// Pool target: SPV9K21....pepe-faktory-pool-v2-2 (per user, known to be
// callable from fresh wallets at the current mainnet state).

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
  falseCV,
  principalCV,
  contractPrincipalCV,
  stringAsciiCV,
  serializeCV,
  PostConditionMode,
} from "@stacks/transactions";
import { SimulationBuilder } from "stxer";

// Addresses & contracts -------------------------------------------------------

const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP1G655MB1JVQ5FBE2JJ3E01HEA6KBM4H39F5EW63";
const USER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";

const WALLET_NAME = "fakfun-wallet-v2";
const WALLET = `${DEPLOYER}.${WALLET_NAME}`;
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core`;
const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";

// Pool used for the limit-order tests (user-confirmed: callable from fresh
// wallets without fakfun-core-v2 gating issues).
const POOL_NAME = "pepe-faktory-pool-v2-2";
const POOL = `${DEPLOYER}.${POOL_NAME}`;
const PEPE_TOKEN_NAME = "pepe-faktory";
const PEPE_TOKEN = `${DEPLOYER}.${PEPE_TOKEN_NAME}`;
const PEPE_ASSET_NAME = "pepe-faktory";

// Test extension (deployed inline, same as admin sim, so admin bundle's
// auth-id 2 + 3 sigs verify against the same {extension, payload, op-id}.)
const TEST_EXT_NAME = "test-extension";
const TEST_EXT = `${DEPLOYER}.${TEST_EXT_NAME}`;
const TEST_EXT_SOURCE = `(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.extension-trait.extension-trait)
(define-public (call (payload (buff 2048))) (ok true))`;
const EXTENSION_PAYLOAD = Buffer.from("deadbeefcafe", "hex");

// Limit-order params
const LIMIT_AMOUNT = 100_000; // 100k sats sBTC for BUY
const OPCODE_BUY = 0x00;
const HAPPY_LIMIT_OUT = 1; // any non-zero dy passes
const STRICT_LIMIT_OUT = "1000000000000000000"; // 1e18 — unreachable
const FAR_EXPIRY = 1_000_000; // current burn ~949_736, far future
const NEAR_EXPIRY = 950_000; // ~264 blocks ahead at sim time; advanced past in Phase I

// SIP-018 challenge builder ---------------------------------------------------

const SIP018_PREFIX = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();

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

function specFaktoryExecuteLimit(authId, pool, amount, opcodeByte, limitOut, expiryBurnBlock) {
  return tupleCV({
    topic: stringAsciiCV("faktory-execute-limit"),
    "auth-id": uintCV(authId),
    pool: principalCV(pool),
    amount: uintCV(amount),
    opcode: someCV(bufferCV(Buffer.from([opcodeByte]))),
    "limit-out": uintCV(limitOut),
    "expiry-burn-block": uintCV(expiryBurnBlock),
  });
}

function buildOperations() {
  return [
    {
      authId: 10,
      label: `faktory-execute-limit HAPPY (100k sBTC BUY on pepe pool, limit-out=1, expiry=${FAR_EXPIRY})`,
      challenge: buildChallenge(
        WALLET,
        specFaktoryExecuteLimit(10, POOL, LIMIT_AMOUNT, OPCODE_BUY, HAPPY_LIMIT_OUT, FAR_EXPIRY),
      ),
    },
    {
      authId: 11,
      label: `faktory-execute-limit TOO-STRICT (100k sBTC BUY, limit-out=1e18, expiry=${FAR_EXPIRY})`,
      challenge: buildChallenge(
        WALLET,
        specFaktoryExecuteLimit(11, POOL, LIMIT_AMOUNT, OPCODE_BUY, STRICT_LIMIT_OUT, FAR_EXPIRY),
      ),
    },
    {
      authId: 12,
      label: `faktory-execute-limit EXPIRED (100k sBTC BUY, limit-out=1, expiry=${NEAR_EXPIRY} -> advanced past)`,
      challenge: buildChallenge(
        WALLET,
        specFaktoryExecuteLimit(12, POOL, LIMIT_AMOUNT, OPCODE_BUY, HAPPY_LIMIT_OUT, NEAR_EXPIRY),
      ),
    },
  ];
}

// Sig-auth helpers ------------------------------------------------------------

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

// Modes -----------------------------------------------------------------------

function printChallenges() {
  const ops = buildOperations();
  const bundle = {
    walletPrincipal: WALLET,
    rpId: "fak.fun",
    operations: ops.map((op) => ({
      authId: op.authId,
      label: op.label,
      challengeHex: "0x" + op.challenge.toString("hex"),
    })),
  };
  process.stdout.write(JSON.stringify(bundle, null, 2) + "\n");
}

async function runSimulation(limitBundlePath, adminBundlePath) {
  const limitB = loadBundle(limitBundlePath);
  const adminB = loadBundle(adminBundlePath);
  const followupPath = `${new URL(".", import.meta.url).pathname}signed-bundle-followup.json`;
  const bundlesToMerge = [adminB, limitB];
  if (fs.existsSync(followupPath)) bundlesToMerge.push(loadBundle(followupPath));
  const signed = mergeBundles(...bundlesToMerge);
  if (signed.walletPrincipal !== WALLET) {
    throw new Error(
      `Bundle wallet (${signed.walletPrincipal}) doesn't match this sim (${WALLET}).`,
    );
  }
  const pubkeyBuff = bufferCV(Buffer.from(stripHex(signed.pubkeyHex), "hex"));

  const here = new URL(".", import.meta.url).pathname;
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
    .withSender(DEPLOYER)

    // ── Phase A: deploy + onboard + add-admin + fund ──────────────────────
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
    // pillar-wallet-trait + game-wager-v2 must exist before the wallet deploys
    // because the wallet (impl-trait ...) and (contract-call? '...game-wager-v2 ...)
    // are both statically checked. Both contracts live at SP28MP1H on
    // mainnet; the sim deploys them under that same principal so the
    // hardcoded references resolve.
    .withSender("SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK")
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
    .withSender("SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22")
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
    .addContractDeploy({
      contract_name: TEST_EXT_NAME,
      source_code: TEST_EXT_SOURCE,
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
        uintCV(1_000_000),
        principalCV(USER),
        contractPrincipalCV(DEPLOYER, WALLET_NAME),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase B: faktory-execute-limit HAPPY (auth-id 10) ──────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "faktory-execute-limit",
      function_args: [
        contractPrincipalCV(DEPLOYER, POOL_NAME),
        uintCV(LIMIT_AMOUNT),
        someCV(bufferCV(Buffer.from([OPCODE_BUY]))),
        contractPrincipalCV("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token"),
        stringAsciiCV("sbtc-token"),
        uintCV(HAPPY_LIMIT_OUT),
        uintCV(FAR_EXPIRY),
        sigAuthTuple(signed.sig(10)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase C: replay the happy intent ──────────────────────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "faktory-execute-limit",
      function_args: [
        contractPrincipalCV(DEPLOYER, POOL_NAME),
        uintCV(LIMIT_AMOUNT),
        someCV(bufferCV(Buffer.from([OPCODE_BUY]))),
        contractPrincipalCV("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token"),
        stringAsciiCV("sbtc-token"),
        uintCV(HAPPY_LIMIT_OUT),
        uintCV(FAR_EXPIRY),
        sigAuthTuple(signed.sig(10)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase D: TOO-STRICT limit (auth-id 11) -> err-limit-not-hit ────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "faktory-execute-limit",
      function_args: [
        contractPrincipalCV(DEPLOYER, POOL_NAME),
        uintCV(LIMIT_AMOUNT),
        someCV(bufferCV(Buffer.from([OPCODE_BUY]))),
        contractPrincipalCV("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token"),
        stringAsciiCV("sbtc-token"),
        uintCV(STRICT_LIMIT_OUT),
        uintCV(FAR_EXPIRY),
        sigAuthTuple(signed.sig(11)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase E: re-submit too-strict -> err-limit-not-hit again ──────────
    // Proves the sig stays valid after a failed not-hit attempt.
    .addContractCall({
      contract_id: WALLET,
      function_name: "faktory-execute-limit",
      function_args: [
        contractPrincipalCV(DEPLOYER, POOL_NAME),
        uintCV(LIMIT_AMOUNT),
        someCV(bufferCV(Buffer.from([OPCODE_BUY]))),
        contractPrincipalCV("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token"),
        stringAsciiCV("sbtc-token"),
        uintCV(STRICT_LIMIT_OUT),
        uintCV(FAR_EXPIRY),
        sigAuthTuple(signed.sig(11)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase F: whitelist test-extension (admin no-sig + execute-pending) ─
    .addContractCall({
      contract_id: WALLET,
      function_name: "whitelist-extension",
      function_args: [principalCV(TEST_EXT)],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addAdvanceBlocks({ bitcoin_blocks: 150, stacks_blocks_per_bitcoin: 1 })
    .addContractCall({
      contract_id: WALLET,
      function_name: "execute-pending-whitelist",
      function_args: [uintCV(0), sigAuthTuple(signed.sig(2)), noneCV()],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase G: enable token lock via admin ──────────────────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "toggle-token-lock",
      function_args: [trueCV(), noneCV(), noneCV()],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(WALLET, "(get-token-lock-enabled)")

    // ── Phase H: extension-call (signed) under lock -> err-token-locked ───
    .addContractCall({
      contract_id: WALLET,
      function_name: "extension-call",
      function_args: [
        contractPrincipalCV(DEPLOYER, TEST_EXT_NAME),
        bufferCV(EXTENSION_PAYLOAD),
        sigAuthOptional(signed.sig(3)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase I: disable token lock + advance past NEAR_EXPIRY ────────────
    // (lock would mask err-limit-expired since the wallet checks token-lock
    // before expiry; disable so the expiry assert fires instead)
    .addContractCall({
      contract_id: WALLET,
      function_name: "toggle-token-lock",
      function_args: [falseCV(), noneCV(), noneCV()],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addAdvanceBlocks({ bitcoin_blocks: 350, stacks_blocks_per_bitcoin: 1 })

    // ── Phase J: expired limit (auth-id 12) -> err-limit-expired ──────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "faktory-execute-limit",
      function_args: [
        contractPrincipalCV(DEPLOYER, POOL_NAME),
        uintCV(LIMIT_AMOUNT),
        someCV(bufferCV(Buffer.from([OPCODE_BUY]))),
        contractPrincipalCV("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token"),
        stringAsciiCV("sbtc-token"),
        uintCV(HAPPY_LIMIT_OUT),
        uintCV(NEAR_EXPIRY),
        sigAuthTuple(signed.sig(12)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Final state ───────────────────────────────────────────────────────
    .addEvalCode(WALLET, "(get-token-lock-enabled)")
    .addEvalCode(WALLET, "(get-owner)");

  await builder.run();
}

// CLI -------------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.includes("--print-challenges")) {
  printChallenges();
} else {
  const limitIdx = args.indexOf("--signed");
  const limitPath = limitIdx >= 0 ? args[limitIdx + 1] : "./signed-bundle-limit.json";
  const adminPath = "./signed-bundle-admin.json";
  runSimulation(limitPath, adminPath).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
