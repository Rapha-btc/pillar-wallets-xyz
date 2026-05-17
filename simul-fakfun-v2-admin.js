// simul-fakfun-v2-admin.js
// Stxer mainnet-fork simulation covering the 10 remaining
// smart-wallet-standard-auth-helpers-v7 hash builders that aren't exercised
// by the wallet / nft / token-lock sims.
//
// Coverage in this sim:
//   auth-id 0 : add-admin           -> build-add-admin-hash               (setup)
//   auth-id 1 : stx-transfer        -> build-stx-transfer-hash
//   auth-id 2 : execute-pending-whitelist -> build-whitelist-extension-hash
//   auth-id 3 : extension-call      -> build-extension-call-hash
//   auth-id 4 : remove-extension-whitelist -> build-remove-extension-whitelist-hash
//   auth-id 5 : veto-operation      -> build-veto-operation-hash
//   auth-id 6 : propose-recovery    -> build-propose-recovery-hash
//   auth-id 7 : enroll-dual-stacking -> build-enroll-dual-stacking-hash
//   auth-id 8 : stack-stx-fast-pool -> build-stack-stx-fast-pool-hash
//   auth-id 9 : confirm-transfer-wallet -> build-confirm-transfer-hash
//
// After auth-id 9 succeeds, ownership transfers from USER to FAKFUN_DEPLOYER,
// so this is intentionally the last signed operation.
//
// USAGE: same two-phase as the other v2 sims.

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
const FAKFUN_DEPLOYER = "SP1G655MB1JVQ5FBE2JJ3E01HEA6KBM4H39F5EW63"; // gates onboard(); also the final transfer recipient
const USER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";

const WALLET_NAME = "fakfun-wallet-v2";
const WALLET = `${DEPLOYER}.${WALLET_NAME}`;
const AUTH_HELPERS = `${DEPLOYER}.smart-wallet-standard-auth-helpers-v7`;
const WEBAUTHN = `${DEPLOYER}.clarity-webauthn`;
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core`;

const TEST_EXT_NAME = "test-extension";
const TEST_EXT = `${DEPLOYER}.${TEST_EXT_NAME}`;

// Secondary whitelist target — gets queued then vetoed (proves veto path).
// Real on-mainnet extension principal, but never actually invoked.
const VETO_EXT = `${DEPLOYER}.faktory-swap-extension`;

// Dual-stacking trait impl (on mainnet).
const DUAL_STACKING_CONTRACT = `SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.xbtc-sbtc-swap-v2`;

const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";

// Minimal extension-trait impl. Used in Phase D for extension-call.
const TEST_EXT_SOURCE = `(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.extension-trait.extension-trait)
(define-public (call (payload (buff 2048))) (ok true))`;

// stx-transfer params
const STX_TRANSFER_AMOUNT = 500_000; // 0.5 STX — below the wallet's 100 STX threshold (immediate transfer path)

// stack-stx-fast-pool params
const FAST_POOL_AMOUNT = 1_000_000; // 1 STX delegated to fast-pool-v3

// extension-call payload (arbitrary opaque bytes — the test extension ignores them)
const EXTENSION_PAYLOAD = Buffer.from("deadbeefcafe", "hex");

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

// ── Topic specs (mirror auth-helpers-v7 tuple shapes exactly) ──────────────

function specAddAdmin(authId, newAdmin) {
  return tupleCV({
    topic: stringAsciiCV("add-admin"),
    "auth-id": uintCV(authId),
    "new-admin": principalCV(newAdmin),
  });
}

function specStxTransfer(authId, amount, recipient, memoCV) {
  return tupleCV({
    topic: stringAsciiCV("stx-transfer"),
    "auth-id": uintCV(authId),
    amount: uintCV(amount),
    recipient: principalCV(recipient),
    memo: memoCV,
  });
}

function specWhitelistExtension(authId, opId, extension) {
  return tupleCV({
    topic: stringAsciiCV("whitelist-extension"),
    "auth-id": uintCV(authId),
    "op-id": uintCV(opId),
    extension: principalCV(extension),
  });
}

function specExtensionCall(authId, extension, payload) {
  return tupleCV({
    topic: stringAsciiCV("extension-call"),
    "auth-id": uintCV(authId),
    extension: principalCV(extension),
    payload: bufferCV(payload),
  });
}

function specRemoveExtensionWhitelist(authId, extension) {
  return tupleCV({
    topic: stringAsciiCV("remove-extension-whitelist"),
    "auth-id": uintCV(authId),
    extension: principalCV(extension),
  });
}

function specVetoOperation(authId, opId) {
  return tupleCV({
    topic: stringAsciiCV("veto-operation"),
    "auth-id": uintCV(authId),
    "op-id": uintCV(opId),
  });
}

function specProposeRecovery(authId, newRecovery) {
  return tupleCV({
    topic: stringAsciiCV("propose-recovery"),
    "auth-id": uintCV(authId),
    "new-recovery": principalCV(newRecovery),
  });
}

function specEnrollDualStacking(authId) {
  return tupleCV({
    topic: stringAsciiCV("enroll-dual-stacking"),
    "auth-id": uintCV(authId),
  });
}

function specStackStxFastPool(authId, amountUstx) {
  return tupleCV({
    topic: stringAsciiCV("stack-stx-fast-pool"),
    "auth-id": uintCV(authId),
    "amount-ustx": uintCV(amountUstx),
  });
}

function specConfirmTransfer(authId, newAdmin) {
  return tupleCV({
    topic: stringAsciiCV("confirm-transfer"),
    "auth-id": uintCV(authId),
    "new-admin": principalCV(newAdmin),
  });
}

function buildOperations() {
  // op-id sequence inside the wallet's pending-operations:
  //   pending #0 = first whitelist-extension (test-ext)  -> executed via auth-id 2
  //   pending #1 = second whitelist-extension (veto-ext) -> vetoed   via auth-id 5
  return [
    {
      authId: 0,
      label: "add-admin (USER)",
      challenge: buildChallenge(WALLET, specAddAdmin(0, USER)),
    },
    {
      authId: 1,
      label: `stx-transfer 0.5 STX -> USER (memo=none)`,
      challenge: buildChallenge(
        WALLET,
        specStxTransfer(1, STX_TRANSFER_AMOUNT, USER, noneCV()),
      ),
    },
    {
      authId: 2,
      label: `execute-pending-whitelist (op-id 0, ext=test-extension)`,
      challenge: buildChallenge(WALLET, specWhitelistExtension(2, 0, TEST_EXT)),
    },
    {
      authId: 3,
      label: `extension-call (test-extension, payload=0x${EXTENSION_PAYLOAD.toString("hex")})`,
      challenge: buildChallenge(WALLET, specExtensionCall(3, TEST_EXT, EXTENSION_PAYLOAD)),
    },
    {
      authId: 4,
      label: `remove-extension-whitelist (test-extension)`,
      challenge: buildChallenge(WALLET, specRemoveExtensionWhitelist(4, TEST_EXT)),
    },
    {
      authId: 5,
      label: `veto-operation (op-id 1)`,
      challenge: buildChallenge(WALLET, specVetoOperation(5, 1)),
    },
    {
      authId: 6,
      label: `propose-recovery (recovery=FAKFUN_DEPLOYER)`,
      challenge: buildChallenge(WALLET, specProposeRecovery(6, FAKFUN_DEPLOYER)),
    },
    {
      authId: 7,
      label: `enroll-dual-stacking (xbtc-sbtc-swap-v2)`,
      challenge: buildChallenge(WALLET, specEnrollDualStacking(7)),
    },
    {
      authId: 8,
      label: `stack-stx-fast-pool (1 STX -> fast-pool-v3)`,
      challenge: buildChallenge(WALLET, specStackStxFastPool(8, FAST_POOL_AMOUNT)),
    },
    {
      authId: 9,
      label: `confirm-transfer-wallet (new-admin=FAKFUN_DEPLOYER)`,
      challenge: buildChallenge(WALLET, specConfirmTransfer(9, FAKFUN_DEPLOYER)),
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

    // ── Phase A: deploy webauthn + helpers + wallet + test-extension ──────
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
    .addContractDeploy({
      contract_name: TEST_EXT_NAME,
      source_code: TEST_EXT_SOURCE,
      clarity_version: ClarityVersion.Clarity5,
    })

    // onboard pubkey (from FAKFUN_DEPLOYER as required by the wallet)
    .withSender(FAKFUN_DEPLOYER)
    .addContractCall({
      contract_id: WALLET,
      function_name: "onboard",
      function_args: [pubkeyBuff],
      post_condition_mode: PostConditionMode.Allow,
    })

    // add USER as admin (auth-id 0)
    .withSender(USER)
    .addContractCall({
      contract_id: WALLET,
      function_name: "add-admin-with-signature",
      function_args: [principalCV(USER), sigAuthTuple(signed.sig(0)), noneCV()],
      post_condition_mode: PostConditionMode.Allow,
    })

    // fund wallet with sBTC (for gas-station) + STX (for stx-transfer and fast-pool delegation)
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
      sender: DEPLOYER, // independent of USER's nonce sequence; well-funded on mainnet
      recipient: WALLET, // contract principal as string
      amount: 5_000_000, // 5 STX (in microSTX)
    })

    // ── Phase B: stx-transfer 0.5 STX -> USER (auth-id 1) ──────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "stx-transfer",
      function_args: [
        uintCV(STX_TRANSFER_AMOUNT),
        principalCV(USER),
        noneCV(), // memo
        sigAuthOptional(signed.sig(1)),
        noneCV(), // gas
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase C: whitelist test-extension (admin, no sig) -> creates op #0 ─
    .addContractCall({
      contract_id: WALLET,
      function_name: "whitelist-extension",
      function_args: [principalCV(TEST_EXT)],
      post_condition_mode: PostConditionMode.Allow,
    })

    // Advance 150 burn blocks to clear the 144-block cooldown for execute-pending
    .addAdvanceBlocks({
      bitcoin_blocks: 150,
      stacks_blocks_per_bitcoin: 1,
    })

    // execute-pending-whitelist op-id 0 (auth-id 2)
    .addContractCall({
      contract_id: WALLET,
      function_name: "execute-pending-whitelist",
      function_args: [
        uintCV(0), // op-id
        sigAuthTuple(signed.sig(2)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase D: extension-call test-extension (auth-id 3) ─────────────────
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

    // ── Phase E: queue second whitelist + veto it (auth-id 5) ──────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "whitelist-extension",
      function_args: [principalCV(VETO_EXT)],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addContractCall({
      contract_id: WALLET,
      function_name: "veto-operation",
      function_args: [
        uintCV(1), // op-id of the second pending whitelist
        sigAuthOptional(signed.sig(5)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase F: remove test-extension from whitelist (auth-id 4) ──────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "remove-extension-whitelist",
      function_args: [
        principalCV(TEST_EXT),
        sigAuthOptional(signed.sig(4)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase G: propose-recovery (auth-id 6) ──────────────────────────────
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

    // ── Phase H: enroll-dual-stacking (auth-id 7) ──────────────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "enroll-dual-stacking",
      function_args: [
        principalCV(DUAL_STACKING_CONTRACT),
        sigAuthOptional(signed.sig(7)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase I: stack-stx-fast-pool 1 STX (auth-id 8) ─────────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "stack-stx-fast-pool",
      function_args: [
        uintCV(FAST_POOL_AMOUNT),
        sigAuthOptional(signed.sig(8)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(
      "SP000000000000000000002Q6VF78.pox-4",
      `(get-delegation-info '${WALLET})`,
    )

    // ── Phase J: propose-transfer-wallet (admin) + confirm (auth-id 9) ─────
    .addContractCall({
      contract_id: WALLET,
      function_name: "propose-transfer-wallet",
      function_args: [principalCV(FAKFUN_DEPLOYER)],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addContractCall({
      contract_id: WALLET,
      function_name: "confirm-transfer-wallet",
      function_args: [sigAuthTuple(signed.sig(9)), noneCV()],
      post_condition_mode: PostConditionMode.Allow,
    })

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
  const signedPath = idx >= 0 ? args[idx + 1] : "./signed-bundle-admin.json";
  runSimulation(signedPath).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
