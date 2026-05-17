// simul-fakfun-v2-init.js
// Stxer mainnet-fork simulation of the 3-step first-init flow + veto path.
//
// Replaces the one-shot add-admin-with-signature with:
//   1. propose-admin-with-signature (webauthn sig 1 from initial-pubkey)
//   2. accept-admin-proposal       (tx-sender = new-admin, no sig)
//   3. confirm-admin-with-signature (webauthn sig 2 from initial-pubkey, after pubkey-cooldown-period burn blocks)
// Plus veto-pending-init (webauthn sig from initial-pubkey clears a pending propose).
//
// USAGE:
//   1. node simul-fakfun-v2-init.js --print-challenges > challenges-init.json
//   2. Open /faktory-v2-sign on fakfun.com (or fak.fun), paste the JSON, sign
//      each operation with your passkey, save the result to
//      signed-bundle-init.json next to this script.
//   3. node simul-fakfun-v2-init.js --signed signed-bundle-init.json
//
// Phases:
//   A. Setup: deploy webauthn + auth-helpers + wallet, register v2 hash, onboard.
//   B. Propose A (auth-id 0) -- this propose will be vetoed.
//   C. Veto (auth-id 1) -- clears pending-init-admin.
//   D. Propose B (auth-id 2) -- this propose will go to finalization.
//   E. Accept (tx-sender = USER, no sig).
//   F. Confirm BEFORE cooldown (auth-id 3) -- expect err-in-cooldown (sig not consumed).
//   G. Advance 440 burn blocks (> pubkey-cooldown-period = u432).
//   H. Confirm AFTER cooldown (auth-id 3 reused -- sig was not consumed at F).
//   I. State assertions: is-initialized = true, owner = USER, pending cleared.

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

// ── Addresses & contracts ───────────────────────────────────────────────────

const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP1G655MB1JVQ5FBE2JJ3E01HEA6KBM4H39F5EW63"; // gates onboard()
const USER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";

const WALLET_NAME = "fakfun-wallet-v2";
const WALLET = `${DEPLOYER}.${WALLET_NAME}`;
const AUTH_HELPERS = `${DEPLOYER}.smart-wallet-standard-auth-helpers-v7`;
const WEBAUTHN = `${DEPLOYER}.clarity-webauthn`;
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core`;

// ── SIP-018 challenge builder (mirrors auth-helpers-v7 on-chain) ────────────

const SIP018_PREFIX = Buffer.from("534950303138", "hex"); // "SIP018"

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest();
}

function getDomainHash(walletPrincipal) {
  const domain = tupleCV({
    name: stringAsciiCV("smart-wallet-standard"),
    version: stringAsciiCV("1.0.0"),
    "chain-id": uintCV(1), // mainnet
    wallet: principalCV(walletPrincipal),
  });
  return sha256(Buffer.from(serializeCV(domain), "hex"));
}

function buildChallenge(walletPrincipal, topicTuple) {
  const msgHash = sha256(Buffer.from(serializeCV(topicTuple), "hex"));
  return sha256(Buffer.concat([SIP018_PREFIX, getDomainHash(walletPrincipal), msgHash]));
}

// ── Per-topic challenge specs ───────────────────────────────────────────────

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

function specVetoInit(authId, newAdmin) {
  return tupleCV({
    topic: stringAsciiCV("veto-init"),
    "auth-id": uintCV(authId),
    "new-admin": principalCV(newAdmin),
  });
}

// ── Operation table ─────────────────────────────────────────────────────────

function buildOperations() {
  return [
    {
      authId: 0,
      label: "propose-admin (USER) -- to be vetoed",
      challenge: buildChallenge(WALLET, specAddAdmin(0, USER)),
    },
    {
      authId: 1,
      label: "veto-init (USER) -- clears pending after propose A",
      challenge: buildChallenge(WALLET, specVetoInit(1, USER)),
    },
    {
      authId: 2,
      label: "propose-admin (USER) -- second propose, will be confirmed",
      challenge: buildChallenge(WALLET, specAddAdmin(2, USER)),
    },
    {
      authId: 3,
      label: "confirm-admin (USER) -- finalizes after cooldown",
      challenge: buildChallenge(WALLET, specConfirmAdmin(3, USER)),
    },
  ];
}

// ── Sig-auth tuple builders (webauthn shape) ────────────────────────────────

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

function stripHex(s) {
  return s.startsWith("0x") ? s.slice(2) : s;
}

// ── Modes ───────────────────────────────────────────────────────────────────

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

function loadSignedBundle(path) {
  if (!fs.existsSync(path)) {
    throw new Error(
      `Signed bundle not found at ${path}.\n` +
        `Run with --print-challenges first, sign at /faktory-v2-sign, then save to ${path}.`,
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

    // ── Phase A: deploy + register hash + onboard ────────────────────────────
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
    .withSender(FAKFUN_DEPLOYER)
    .addContractCall({
      contract_id: WALLET,
      function_name: "onboard",
      function_args: [pubkeyBuff],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(WALLET, "(var-get initial-pubkey)")
    .addEvalCode(WALLET, "(var-get pubkey-initialized)")
    .addEvalCode(WALLET, "(var-get is-initialized)")
    .addEvalCode(WALLET, "(var-get pending-init-admin)")

    // ── Phase B: propose A (USER as new-admin) ───────────────────────────────
    .withSender(USER)
    .addContractCall({
      contract_id: WALLET,
      function_name: "propose-admin-with-signature",
      function_args: [
        principalCV(USER),
        sigAuthTuple(signed.sig(0)),
        noneCV(), // gas
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(WALLET, "(var-get pending-init-admin)")

    // ── Phase C: veto (USER, webauthn sig 1) ─────────────────────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "veto-pending-init",
      function_args: [
        sigAuthTuple(signed.sig(1)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(WALLET, "(var-get pending-init-admin)")
    .addEvalCode(WALLET, "(var-get is-initialized)")

    // ── Phase D: propose B (USER, sig 2) -- this one will finalize ───────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "propose-admin-with-signature",
      function_args: [
        principalCV(USER),
        sigAuthTuple(signed.sig(2)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(WALLET, "(var-get pending-init-admin)")

    // ── Phase E: accept (tx-sender = USER = new-admin, no sig) ───────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "accept-admin-proposal",
      function_args: [],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(WALLET, "(var-get pending-init-admin)")

    // ── Phase F: confirm BEFORE cooldown -- expect err-in-cooldown ───────────
    // The asserts in confirm-admin-with-signature run BEFORE is-authorized,
    // so the early err short-circuits and sig 3 is NOT consumed. We reuse it
    // in Phase H after advancing blocks.
    .addContractCall({
      contract_id: WALLET,
      function_name: "confirm-admin-with-signature",
      function_args: [
        sigAuthTuple(signed.sig(3)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(WALLET, "(var-get is-initialized)")

    // ── Phase G: advance past pubkey-cooldown-period (u432) ──────────────────
    .addAdvanceBlocks({ bitcoin_blocks: 440, stacks_blocks_per_bitcoin: 1 })

    // ── Phase H: confirm AFTER cooldown -- sig 3 reused, succeeds ────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "confirm-admin-with-signature",
      function_args: [
        sigAuthTuple(signed.sig(3)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase I: final state assertions ──────────────────────────────────────
    .addEvalCode(WALLET, "(var-get is-initialized)")
    .addEvalCode(WALLET, "(get-owner)")
    .addEvalCode(WALLET, "(var-get pending-init-admin)")
    .addEvalCode(WALLET, `(map-get? admins '${USER})`)
    .addEvalCode(WALLET, `(map-get? pubkey-to-admin 0x${stripHex(signed.pubkeyHex)})`)
    .addEvalCode(WALLET_CORE, `(is-whitelisted '${WALLET})`);

  await builder.run();
}

// ── CLI entry ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes("--print-challenges")) {
  printChallenges();
} else {
  const idx = args.indexOf("--signed");
  const signedPath = idx >= 0 ? args[idx + 1] : "./signed-bundle-init.json";
  runSimulation(signedPath).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
