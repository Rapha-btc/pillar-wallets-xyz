// simul-fakfun-v2-governance.js
// Stxer mainnet-fork simulation covering the 12 untested wallet public
// functions identified in README-fakfun-v2-stxer.md "coverage" table.
// (zsbtc threshold path and wager-deposit skipped — see notes below.)
//
// Untested functions exercised here:
//   - set-max-gas-amount               (admin)
//   - signal-config-change             (admin)
//   - set-wallet-config                (admin, after cooldown)
//   - signal-pubkey-cooldown-change    (admin)
//   - confirm-pubkey-cooldown-change   (admin, after pubkey-cooldown)
//   - propose-admin-pubkey             (admin)
//   - confirm-admin-pubkey             (admin, after new pubkey-cooldown)
//   - remove-admin-pubkey              (admin)
//   - stx-transfer (over-threshold)    (admin/sig) → execute-pending-stx-transfer
//   - sip010-transfer (sBTC > thresh)  (admin/sig) → execute-pending-sbtc-transfer
//   - confirm-recovery                 (admin, after propose-recovery signed)
//   - recover-inactive-wallet          (recovery-addr, after INACTIVITY-PERIOD)
//
// Reuses these signed payloads from signed-bundle-admin.json:
//   - auth-id 0 : add-admin(USER)
//   - auth-id 6 : propose-recovery(FAKFUN_DEPLOYER)
// Same wallet contract address + identical signed args → identical
// challenge → existing sigs verify. No new user signatures needed.

import fs from "node:fs";
import crypto from "node:crypto";
import {
  ClarityVersion,
  tupleCV,
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

const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP1G655MB1JVQ5FBE2JJ3E01HEA6KBM4H39F5EW63"; // gates onboard(); also recovery-addr in this sim
const USER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";

const WALLET_NAME = "fakfun-wallet-v2";
const WALLET = `${DEPLOYER}.${WALLET_NAME}`;
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core`;
const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";

// Wallet defaults baked into the contract:
//   stx-threshold:   u100_000_000 (100 STX)
//   sbtc-threshold:  u100_000     (sats)
//   zsbtc-threshold: u100_000     (sats)
//   cooldown-period: u144         (burn blocks)
//   pubkey-cooldown: u432         (burn blocks)
//   INACTIVITY:      u52_560      (burn blocks, ~1 year)
//
// We lower thresholds in Phase B so we can trigger pending-op paths with
// modest amounts.
const NEW_STX_THRESHOLD = 100_000; // 0.1 STX — 1 STX transfer triggers pending
const NEW_SBTC_THRESHOLD = 10_000; // 0.0001 sBTC — 50_000-sat transfer triggers pending
const NEW_COOLDOWN = 144; // keep at default

const NEW_PUBKEY_COOLDOWN = 200; // shorter than default u432

// 33-byte buffer used for propose-admin-pubkey. Doesn't need to correspond
// to any real keypair — confirm-admin-pubkey just records it; remove-admin-pubkey
// removes it. None of these flows actually sign with this key.
const NEW_ADMIN_PUBKEY = "02" + "11".repeat(32);

// Amounts for threshold-breach tests
const STX_BREACH_AMOUNT = 1_000_000; // 1 STX (> 0.1 STX threshold)
const SBTC_BREACH_AMOUNT = 50_000; // 50k sats (> 10k threshold)

// Inactivity advance — has to exceed INACTIVITY-PERIOD (u52_560) from the
// last update-activity call. Phases C–G all touch update-activity, so we
// advance from the END of those phases.
const INACTIVITY_ADVANCE_BURN_BLOCKS = 52_700; // ~1 year + buffer

// SIP-018 challenge builder ---------------------------------------------------

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

function specAddAdmin(authId, newAdmin) {
  return tupleCV({
    topic: stringAsciiCV("add-admin"),
    "auth-id": uintCV(authId),
    "new-admin": principalCV(newAdmin),
  });
}

function specConfirmAdmin(authId, newAdmin) {
  return tupleCV({
    topic: stringAsciiCV("confirm-admin"),
    "auth-id": uintCV(authId),
    "new-admin": principalCV(newAdmin),
  });
}

function specProposeRecovery(authId, newRecovery) {
  return tupleCV({
    topic: stringAsciiCV("propose-recovery"),
    "auth-id": uintCV(authId),
    "new-recovery": principalCV(newRecovery),
  });
}

function buildOperations() {
  return [
    {
      authId: 0,
      label: "add-admin (USER) — REUSED from signed-bundle-admin",
      challenge: buildChallenge(WALLET, specAddAdmin(0, USER)),
    },
    {
      authId: 6,
      label: "propose-recovery (FAKFUN_DEPLOYER) — REUSED from signed-bundle-admin",
      challenge: buildChallenge(WALLET, specProposeRecovery(6, FAKFUN_DEPLOYER)),
    },
    {
      authId: 99,
      label: "confirm-admin (USER) -- finalizes 3-step admin add (after 440-block cooldown)",
      challenge: buildChallenge(WALLET, specConfirmAdmin(99, USER)),
    },
  ];
}

// Sig-auth helpers ------------------------------------------------------------

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

function loadSignedBundle(path) {
  if (!fs.existsSync(path)) {
    throw new Error(
      `Signed bundle not found at ${path}.\n` +
        `This sim reuses signatures from signed-bundle-admin.json — run the admin sim first.`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(path, "utf8"));
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

  // Also load shared followup bundle for the 3-step admin bootstrap
  // (auth-id 99 = confirm-admin). One sig is reused across all
  // bootstrap-affected sims because the hash depends only on the wallet
  // principal + topic + auth-id + new-admin, all of which match.
  const here = new URL(".", import.meta.url).pathname;
  const followupPath = `${here}signed-bundle-followup.json`;
  if (fs.existsSync(followupPath)) {
    const followup = JSON.parse(fs.readFileSync(followupPath, "utf8"));
    for (const op of followup.operations) {
      if (!byAuthId.has(op.authId)) {
        byAuthId.set(op.authId, {
          authId: op.authId,
          pubkeyHex: followup.pubkeyHex,
          signatureHex: op.signatureHex,
          authenticatorDataHex: op.authenticatorDataHex,
          clientDataPrefixHex: op.clientDataPrefixHex,
          clientDataSuffixHex: op.clientDataSuffixHex,
        });
      }
    }
  }
  return {
    pubkeyHex: raw.pubkeyHex,
    walletPrincipal: raw.walletPrincipal,
    sig: (authId) => {
      const s = byAuthId.get(authId);
      if (!s) throw new Error(`Signed bundle missing auth-id ${authId}`);
      return s;
    },
  };
}

// CLI -------------------------------------------------------------------------

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

async function runSimulation(signedPath) {
  const signed = loadSignedBundle(signedPath);
  if (signed.walletPrincipal !== WALLET) {
    throw new Error(
      `Signed bundle wallet (${signed.walletPrincipal}) does not match this sim (${WALLET}).`,
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

  const v2Hash = crypto.createHash("sha512-256").update(walletSource).digest();
  console.error("fakfun-wallet-v2 hash:", v2Hash.toString("hex"));

  const builder = SimulationBuilder.new()
    .withSender(DEPLOYER)

    // ── Phase A: deploy + set-verified-contract + onboard + add-admin ─────
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
    // Fund wallet with sBTC + STX
    .addContractCall({
      contract_id: SBTC_TOKEN,
      function_name: "transfer",
      function_args: [
        uintCV(200_000),
        principalCV(USER),
        contractPrincipalCV(DEPLOYER, WALLET_NAME),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addSTXTransfer({
      sender: DEPLOYER,
      recipient: WALLET,
      amount: 5_000_000,
    })

    // ── Phase B: set-max-gas-amount (admin, no sig) ────────────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "set-max-gas-amount",
      function_args: [uintCV(500)],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(WALLET, "(var-get max-gas-amount)")

    // ── Phase C: signal-config-change + cooldown + set-wallet-config ───────
    .addContractCall({
      contract_id: WALLET,
      function_name: "signal-config-change",
      function_args: [],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addAdvanceBlocks({ bitcoin_blocks: 150, stacks_blocks_per_bitcoin: 1 })
    .addContractCall({
      contract_id: WALLET,
      function_name: "set-wallet-config",
      function_args: [
        uintCV(NEW_STX_THRESHOLD),
        uintCV(NEW_SBTC_THRESHOLD),
        uintCV(NEW_COOLDOWN),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(WALLET, "(var-get wallet-config)")

    // ── Phase D: signal-pubkey-cooldown-change + advance + confirm ─────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "signal-pubkey-cooldown-change",
      function_args: [uintCV(NEW_PUBKEY_COOLDOWN)],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addAdvanceBlocks({ bitcoin_blocks: 450, stacks_blocks_per_bitcoin: 1 })
    .addContractCall({
      contract_id: WALLET,
      function_name: "confirm-pubkey-cooldown-change",
      function_args: [],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(WALLET, "(var-get pubkey-cooldown-period)")

    // ── Phase E: propose-admin-pubkey + advance + confirm + remove ─────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "propose-admin-pubkey",
      function_args: [bufferCV(Buffer.from(NEW_ADMIN_PUBKEY, "hex"))],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addAdvanceBlocks({ bitcoin_blocks: 210, stacks_blocks_per_bitcoin: 1 })
    .addContractCall({
      contract_id: WALLET,
      function_name: "confirm-admin-pubkey",
      function_args: [],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(
      WALLET,
      `(map-get? pubkey-to-admin 0x${NEW_ADMIN_PUBKEY})`,
    )
    .addContractCall({
      contract_id: WALLET,
      function_name: "remove-admin-pubkey",
      function_args: [bufferCV(Buffer.from(NEW_ADMIN_PUBKEY, "hex"))],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(
      WALLET,
      `(map-get? pubkey-to-admin 0x${NEW_ADMIN_PUBKEY})`,
    )

    // ── Phase F: stx-transfer over threshold -> pending op -> execute ──────
    .addContractCall({
      contract_id: WALLET,
      function_name: "stx-transfer",
      function_args: [
        uintCV(STX_BREACH_AMOUNT),
        principalCV(USER),
        noneCV(), // memo
        noneCV(), // sig-auth (admin path)
        noneCV(), // gas
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(WALLET, "(var-get operation-nonce)") // next pending op-id
    .addAdvanceBlocks({ bitcoin_blocks: 150, stacks_blocks_per_bitcoin: 1 })
    .addContractCall({
      contract_id: WALLET,
      function_name: "execute-pending-stx-transfer",
      function_args: [
        uintCV(0), // first pending op
        noneCV(), // memo
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase G: sip010-transfer sBTC over threshold -> pending -> execute ─
    .addContractCall({
      contract_id: WALLET,
      function_name: "sip010-transfer",
      function_args: [
        uintCV(SBTC_BREACH_AMOUNT),
        principalCV(USER),
        noneCV(), // memo
        contractPrincipalCV("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token"),
        stringAsciiCV("sbtc-token"),
        noneCV(), // sig-auth (admin path)
        noneCV(), // gas
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addAdvanceBlocks({ bitcoin_blocks: 150, stacks_blocks_per_bitcoin: 1 })
    .addContractCall({
      contract_id: WALLET,
      function_name: "execute-pending-sbtc-transfer",
      function_args: [
        uintCV(1), // second pending op
        noneCV(), // memo
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase H: propose-recovery (sig auth-id 6) + confirm-recovery ───────
    .addContractCall({
      contract_id: WALLET,
      function_name: "propose-recovery",
      function_args: [
        principalCV(FAKFUN_DEPLOYER),
        sigAuthTuple(signed.sig(6)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addContractCall({
      contract_id: WALLET,
      function_name: "confirm-recovery",
      function_args: [],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(WALLET, "(var-get recovery-address)")

    // ── Phase I: advance INACTIVITY-PERIOD then recover-inactive-wallet ───
    .addAdvanceBlocks({
      bitcoin_blocks: INACTIVITY_ADVANCE_BURN_BLOCKS,
      stacks_blocks_per_bitcoin: 1,
    })
    .withSender(FAKFUN_DEPLOYER) // recovery-address calls recover
    .addContractCall({
      contract_id: WALLET,
      function_name: "recover-inactive-wallet",
      function_args: [principalCV(FAKFUN_DEPLOYER)], // new admin = recovery-addr
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Final state checks ────────────────────────────────────────────────
    .addEvalCode(WALLET, "(get-owner)")
    .addEvalCode(WALLET, `(map-get? admins '${USER})`) // should be none (removed by recovery)
    .addEvalCode(WALLET, `(map-get? admins '${FAKFUN_DEPLOYER})`); // should be true

  await builder.run();
}

const args = process.argv.slice(2);
if (args.includes("--print-challenges")) {
  printChallenges();
} else {
  const idx = args.indexOf("--signed");
  const signedPath = idx >= 0 ? args[idx + 1] : "./signed-bundle-admin.json";
  runSimulation(signedPath).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
