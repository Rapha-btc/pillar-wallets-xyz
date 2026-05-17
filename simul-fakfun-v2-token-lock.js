// simul-fakfun-v2-token-lock.js
// Stxer mainnet-fork simulation of fakfun-wallet-v2 token-lock end-to-end.
//
// Mirrors faktory-dao/contracts/fakfun-core/simul-fakfun-v3-token-lock.js
// (privy). Same 9-phase flow; only the auth tuple is the webauthn shape.
//
// USAGE: same two-phase as the other v2 sims — print challenges, sign at
// /faktory-v2-sign, save bundle, run.
//
// Real signed ops (3):
//   auth-id 0: add-admin(USER)
//   auth-id 1: toggle-token-lock(enabled=true)
//   auth-id 2: sip010-transfer(amount=50000, recipient=USER, memo=none, sip010=sBTC)
//
// Phase 3 uses dummy sigs (auth-id 10/11/12) — the token-lock assert fires
// before signature verification, so those values are never checked.

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
  trueCV,
  falseCV,
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
const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";

// ── SIP-018 challenge builder ───────────────────────────────────────────────

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

// ── Topic specs ─────────────────────────────────────────────────────────────

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

function specToggleTokenLock(authId, enabled) {
  return tupleCV({
    topic: stringAsciiCV("toggle-token-lock"),
    "auth-id": uintCV(authId),
    enabled: enabled ? trueCV() : falseCV(),
  });
}

function specSip010Transfer(authId, amount, recipient, memo, sip010) {
  return tupleCV({
    topic: stringAsciiCV("sip010-transfer"),
    "auth-id": uintCV(authId),
    amount: uintCV(amount),
    recipient: principalCV(recipient),
    memo: memo, // ClarityValue (none or someCV(bufferCV(...)))
    sip010: principalCV(sip010),
  });
}

function buildOperations() {
  return [
    {
      authId: 0,
      label: "add-admin (USER)",
      challenge: buildChallenge(WALLET, specAddAdmin(0, USER)),
    },
    {
      authId: 1,
      label: "toggle-token-lock enabled=true",
      challenge: buildChallenge(WALLET, specToggleTokenLock(1, true)),
    },
    {
      authId: 2,
      label: "sip010-transfer 50000 sBTC → USER (memo=none)",
      challenge: buildChallenge(
        WALLET,
        specSip010Transfer(2, 50000, USER, noneCV(), SBTC_TOKEN),
      ),
    },
    {
      authId: 99,
      label: "confirm-admin (USER) -- finalizes 3-step admin add (after 440-block cooldown)",
      challenge: buildChallenge(WALLET, specConfirmAdmin(99, USER)),
    },
  ];
}

// ── Sig-auth helpers ───────────────────────────────────────────────────────

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

/**
 * Dummy webauthn sig-auth tuple — used in Phase 3 where token-lock asserts fire
 * BEFORE signature verification. Buffers must match the contract's expected
 * sizes so deserialization succeeds; values themselves are never checked.
 */
function dummySigAuth(authId, pubkeyHex) {
  return someCV(
    tupleCV({
      "auth-id": uintCV(authId),
      pubkey: bufferCV(Buffer.from(stripHex(pubkeyHex), "hex")),
      signature: bufferCV(Buffer.alloc(64)), // (buff 64)
      "authenticator-data": bufferCV(Buffer.alloc(37)), // 37 bytes is the minimum
      "client-data-prefix": bufferCV(Buffer.alloc(1)),
      "client-data-suffix": bufferCV(Buffer.alloc(1)),
    }),
  );
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
        `Run --print-challenges, sign at /faktory-v2-sign, save bundle to ${path}.`,
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

    // ── Phase 1: deploy deps + wallet, register hash, onboard, add admin ──
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

    .addContractCall({
      contract_id: SBTC_TOKEN,
      function_name: "transfer",
      function_args: [
        uintCV(200000),
        principalCV(USER),
        contractPrincipalCV(DEPLOYER, WALLET_NAME),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    .addEvalCode(WALLET, "(get-token-lock-enabled)")

    // ── Phase 2: lock ON via signature ────────────────────────────────────
    .withSender(DEPLOYER)
    .addContractCall({
      contract_id: WALLET,
      function_name: "toggle-token-lock",
      function_args: [trueCV(), sigAuthOptional(signed.sig(1)), noneCV()],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(WALLET, "(get-token-lock-enabled)")

    // ── Phase 3: transfers blocked while locked (dummy sigs, asserts fire) ─
    .addContractCall({
      contract_id: WALLET,
      function_name: "sip010-transfer",
      function_args: [
        uintCV(50000),
        principalCV(USER),
        noneCV(),
        contractPrincipalCV("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token"),
        stringAsciiCV("sbtc-token"),
        dummySigAuth(10, signed.pubkeyHex),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addContractCall({
      contract_id: WALLET,
      function_name: "sip009-transfer",
      function_args: [
        uintCV(1),
        principalCV(USER),
        contractPrincipalCV("SP16SRR777TVB1WS5XSS9QT3YEZEC9JQFKYZENRAJ", "bitcoin-pepe"),
        stringAsciiCV("bitcoin-pepe"),
        dummySigAuth(11, signed.pubkeyHex),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addContractCall({
      contract_id: WALLET,
      function_name: "stx-transfer",
      function_args: [
        uintCV(1000000),
        principalCV(USER),
        noneCV(),
        dummySigAuth(12, signed.pubkeyHex),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase 4: admin transfer works while locked ────────────────────────
    .withSender(USER)
    .addContractCall({
      contract_id: WALLET,
      function_name: "sip010-transfer",
      function_args: [
        uintCV(50000),
        principalCV(USER),
        noneCV(),
        contractPrincipalCV("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token"),
        stringAsciiCV("sbtc-token"),
        noneCV(),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase 5: lock OFF via admin ───────────────────────────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "toggle-token-lock",
      function_args: [falseCV(), noneCV(), noneCV()],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(WALLET, "(get-token-lock-enabled)")

    // ── Phase 6: transfer works again after unlock ────────────────────────
    .addContractCall({
      contract_id: SBTC_TOKEN,
      function_name: "transfer",
      function_args: [
        uintCV(100000),
        principalCV(USER),
        contractPrincipalCV(DEPLOYER, WALLET_NAME),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .withSender(DEPLOYER)
    .addContractCall({
      contract_id: WALLET,
      function_name: "sip010-transfer",
      function_args: [
        uintCV(50000),
        principalCV(USER),
        noneCV(),
        contractPrincipalCV("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token"),
        stringAsciiCV("sbtc-token"),
        sigAuthOptional(signed.sig(2)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase 7: lock ON via admin ────────────────────────────────────────
    .withSender(USER)
    .addContractCall({
      contract_id: WALLET,
      function_name: "toggle-token-lock",
      function_args: [trueCV(), noneCV(), noneCV()],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(WALLET, "(get-token-lock-enabled)")

    // ── Phase 8: lock OFF fails from non-admin ────────────────────────────
    .withSender(DEPLOYER)
    .addContractCall({
      contract_id: WALLET,
      function_name: "toggle-token-lock",
      function_args: [falseCV(), noneCV(), noneCV()],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(WALLET, "(get-token-lock-enabled)")

    // ── Phase 9: lock OFF succeeds from admin ─────────────────────────────
    .withSender(USER)
    .addContractCall({
      contract_id: WALLET,
      function_name: "toggle-token-lock",
      function_args: [falseCV(), noneCV(), noneCV()],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(WALLET, "(get-token-lock-enabled)")

    // ── Final state checks ────────────────────────────────────────────────
    .addEvalCode(WALLET, "(get-owner)")
    .addEvalCode(WALLET_CORE, `(is-whitelisted '${WALLET})`);

  await builder.run();
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes("--print-challenges")) {
  printChallenges();
} else {
  const idx = args.indexOf("--signed");
  const signedPath = idx >= 0 ? args[idx + 1] : "./signed-bundle-token-lock.json";
  runSimulation(signedPath).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
