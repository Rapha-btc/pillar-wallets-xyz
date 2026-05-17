// simul-fakfun-v2-wallet.js
// Stxer mainnet-fork simulation of the full fakfun-wallet-v2 (webauthn) lifecycle.
//
// Mirrors faktory-dao/contracts/fakfun-core/simul-fakfun-v3-wallet.js (privy)
// but swaps the (auth-id, signature, pubkey) sig-auth tuple for the webauthn
// shape (auth-id, pubkey, signature, authenticator-data, client-data-prefix,
// client-data-suffix).
//
// USAGE:
//   1. node simul-fakfun-v2-wallet.js --print-challenges > challenges.json
//   2. Open /faktory-v2-sign on fakfun.com (or fak.fun) in a browser, paste
//      the JSON, sign each operation with your passkey, copy the signed
//      bundle back into signed-bundle.json next to this script.
//   3. node simul-fakfun-v2-wallet.js  (defaults to ./signed-bundle.json)
//      → submits the simulation to stxer and prints the URL.
//
// Lifecycle (matches v3 sim):
//   1. Setup: deploy clarity-webauthn, auth-helpers-v7, fakfun-wallet-v2,
//      register v2 hash, onboard pubkey, add USER as admin (auth-id 0), fund.
//   2. Prelaunch: 9 regular users buy 2 seats each (18 seats, 9 users).
//   3. Smart wallet completes prelaunch via faktory-process (auth-id 5).
//   4. faktory-process-claim (auth-id 7) — first claim before bonding.
//   5. DEX BUY + SELL via faktory-place-order (auth-ids 3, 4).
//   5.5. SP24MM graduates DEX with 21M sats buy.
//   5.6. Second faktory-process-claim — 60% vested after toggle-bonded.
//   6. faktory-fee-airdrop (auth-id 8) — expected err u324 cooldown.
//   7. Pool BUY + SELL via faktory-execute (auth-ids 1, 2).
//   7.1. ADD-LIQ via faktory-execute (auth-id 10).
//   7.2. REMOVE-LIQ via faktory-execute (auth-id 11).
//   7.5. SP24MM large pool sell (no sig — direct fakfun-core-v2 call).
//   8. faktory-burn-bob (auth-id 9).

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
const FAKFUN_CORE = `${DEPLOYER}.fakfun-core-v2`;

const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const BOB_TOKEN = "SP2VG7S0R4Z8PYNYCAQ04HCBX1MH75VT11VXCWQ6G.built-on-bitcoin-stxcity";
const BURN_BOB_FAKTORY = "SP29D6YMDNAKN1P045T6Z817RTE1AC0JAA99WAX2B.burn-bob-faktory";

// $UNFAIR2 — same token as v3 sim (already on mainnet)
const TOKEN_NAME = "unfair2-faktory";
const TOKEN_CONTRACT = `${DEPLOYER}.${TOKEN_NAME}`;
const TOKEN_POOL = `${DEPLOYER}.unfair2-faktory-pool`;
const TOKEN_DEX = `${DEPLOYER}.unfair2-faktory-dex`;
const TOKEN_PRE = `${DEPLOYER}.unfair2-pre-faktory`;
const TOKEN_ASSET = "UNFAIR2"; // SIP-010 asset name
const LP_ASSET = "sBTC-UNFAIR2"; // LP token asset name

// 9 regular sBTC holders for prelaunch — same set as v3 sim
const SEAT_BUYERS = [
  USER,
  "SP24MM95FEZJY3XWSBGZ5CT8DV04J6NVM5QA4WDXZ",
  "SP10BMXA5HRJYEQYDXDE86ZJYKG5W0FEA0AD7M716",
  "SP8YMPEBK0P9W3SYCAEB1M1XJFEJTP08RWG4G16E",
  "SP3V37N4ZV9JSE4J7KY58Z3S65HV7K5RKE829JS25",
  "SP3EAB6NKWV1QQ449W9N2CPQEPZVPS13N6VAWKP6T",
  "SPQRZQWAZ78SE0Y9R571AGTK9V4GT9CWAFAQRNDK",
  "SP15BAYVB537RQFZRCCTNFD3WHGDRJRE95MZ5BHCJ",
  "SP1DZARHA1GVEWVCDF1J9N044A69Q6VT7KMDPQ5N9",
];

// ── Opcodes (must match wallet contract) ────────────────────────────────────

const OP_BUY = bufferCV(Buffer.from([0x00]));
const OP_SELL = bufferCV(Buffer.from([0x01]));
const OP_ADD_LIQ = bufferCV(Buffer.from([0x02]));
const OP_REMOVE_LIQ = bufferCV(Buffer.from([0x03]));
const OP_BUY_SEATS = bufferCV(Buffer.from([0x02]));
const OP_REFUND = bufferCV(Buffer.from([0x03]));

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
// Each spec returns the topic-tuple that auth-helpers-v7's build-*-hash function
// hashes on-chain. Order + field names MUST match the contract exactly.

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

function opcodeCV(byte) {
  return someCV(bufferCV(Buffer.from([byte])));
}

function specFaktoryExecute(authId, pool, amount, opcodeByte) {
  return tupleCV({
    topic: stringAsciiCV("faktory-execute"),
    "auth-id": uintCV(authId),
    pool: principalCV(pool),
    amount: uintCV(amount),
    opcode: opcodeCV(opcodeByte),
  });
}

function specFaktoryPlaceOrder(authId, dex, amount, opcodeByte) {
  return tupleCV({
    topic: stringAsciiCV("faktory-place-order"),
    "auth-id": uintCV(authId),
    dex: principalCV(dex),
    amount: uintCV(amount),
    opcode: opcodeCV(opcodeByte),
  });
}

function specFaktoryProcess(authId, pre, seatCount, opcodeByte) {
  return tupleCV({
    topic: stringAsciiCV("faktory-process"),
    "auth-id": uintCV(authId),
    pre: principalCV(pre),
    "seat-count": uintCV(seatCount),
    opcode: opcodeCV(opcodeByte),
  });
}

function specFaktoryProcessClaim(authId, pre) {
  return tupleCV({
    topic: stringAsciiCV("faktory-process-claim"),
    "auth-id": uintCV(authId),
    pre: principalCV(pre),
  });
}

function specFaktoryFeeAirdrop(authId, pre) {
  return tupleCV({
    topic: stringAsciiCV("faktory-fee-airdrop"),
    "auth-id": uintCV(authId),
    pre: principalCV(pre),
  });
}

function specFaktoryBurnBob(authId) {
  return tupleCV({
    topic: stringAsciiCV("faktory-burn-bob"),
    "auth-id": uintCV(authId),
  });
}

function specStackStxJuice(authId, amountUstx) {
  return tupleCV({
    topic: stringAsciiCV("stack-stx-juice"),
    "auth-id": uintCV(authId),
    "amount-ustx": uintCV(amountUstx),
  });
}

function specRevokeStacking(authId) {
  return tupleCV({
    topic: stringAsciiCV("revoke-stacking"),
    "auth-id": uintCV(authId),
  });
}

// ── Operation table — single source of truth for both print + run modes ────

function buildOperations() {
  return [
    {
      authId: 0,
      label: "add-admin (USER)",
      challenge: buildChallenge(WALLET, specAddAdmin(0, USER)),
    },
    {
      authId: 1,
      label: "faktory-execute BUY (100k sats on pool)",
      challenge: buildChallenge(WALLET, specFaktoryExecute(1, TOKEN_POOL, 100000, 0x00)),
    },
    {
      authId: 2,
      label: "faktory-execute SELL (500B tokens on pool)",
      challenge: buildChallenge(WALLET, specFaktoryExecute(2, TOKEN_POOL, 500_000_000_000, 0x01)),
    },
    {
      authId: 3,
      label: "faktory-place-order BUY (100k sats on dex)",
      challenge: buildChallenge(WALLET, specFaktoryPlaceOrder(3, TOKEN_DEX, 100000, 0x00)),
    },
    {
      authId: 4,
      label: "faktory-place-order SELL (500B tokens on dex)",
      challenge: buildChallenge(WALLET, specFaktoryPlaceOrder(4, TOKEN_DEX, 500_000_000_000, 0x01)),
    },
    {
      authId: 5,
      label: "faktory-process BUY-SEATS (2 seats)",
      challenge: buildChallenge(WALLET, specFaktoryProcess(5, TOKEN_PRE, 2, 0x02)),
    },
    {
      authId: 7,
      label: "faktory-process-claim",
      challenge: buildChallenge(WALLET, specFaktoryProcessClaim(7, TOKEN_PRE)),
    },
    {
      authId: 8,
      label: "faktory-fee-airdrop",
      challenge: buildChallenge(WALLET, specFaktoryFeeAirdrop(8, TOKEN_PRE)),
    },
    {
      authId: 9,
      label: "faktory-burn-bob",
      challenge: buildChallenge(WALLET, specFaktoryBurnBob(9)),
    },
    {
      authId: 10,
      label: "faktory-execute ADD-LIQ (100k LP)",
      challenge: buildChallenge(WALLET, specFaktoryExecute(10, TOKEN_POOL, 100000, 0x02)),
    },
    {
      authId: 11,
      label: "faktory-execute REMOVE-LIQ (50k LP)",
      challenge: buildChallenge(WALLET, specFaktoryExecute(11, TOKEN_POOL, 50000, 0x03)),
    },
    {
      authId: 12,
      label: "stack-stx-juice (delegate 1 STX to JUICE-SIGNER)",
      challenge: buildChallenge(WALLET, specStackStxJuice(12, 1_000_000)),
    },
    {
      authId: 13,
      label: "revoke-stacking (revoke pox-4 delegation)",
      challenge: buildChallenge(WALLET, specRevokeStacking(13)),
    },
    {
      authId: 99,
      label: "confirm-admin (USER) -- finalizes 3-step admin add (after 440-block cooldown)",
      challenge: buildChallenge(WALLET, specConfirmAdmin(99, USER)),
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

function sigAuthOptional(signed) {
  return someCV(sigAuthTuple(signed));
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
        `Run with --print-challenges first, sign at /faktory-v2-sign, then save the result to ${path}.`,
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

  // Contract sources (read from neighbouring paths).
  const here = new URL(".", import.meta.url).pathname;
  const walletSource = fs.readFileSync(`${here}contracts/fakfun-wallet-v2.clar`, "utf8");
  const webauthnSource = fs.readFileSync(`${here}contracts/clarity-webauthn.clar`, "utf8");
  const authHelpersSource = fs.readFileSync(
    `${here}contracts/smart-wallet-standard-auth-helpers-v7.clar`,
    "utf8",
  );

  // sha512/256 of the wallet source — fakfun-wallet-core compares this on
  // register-wallet (called from onboard). Any whitespace change here means
  // re-running set-verified-contract with the new hash.
  const v2Hash = crypto.createHash("sha512-256").update(walletSource).digest();
  console.error("fakfun-wallet-v2 hash:", v2Hash.toString("hex"));

  let builder = SimulationBuilder.new()
    .withSender(DEPLOYER)

    // ── Phase 1: deploy deps + wallet, register hash, onboard, add admin ───

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
    // fakfun-wallet-core assumed already on mainnet — wallet self-registers
    // against it in onboard().

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
      function_args: [
        principalCV(USER),
        sigAuthTuple(signed.sig(0)),
        noneCV(),
      ],
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
      function_args: [
        sigAuthTuple(signed.sig(99)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    .addContractCall({
      contract_id: SBTC_TOKEN,
      function_name: "transfer",
      function_args: [
        uintCV(5_000_000), // 0.05 sBTC
        principalCV(USER),
        contractPrincipalCV(DEPLOYER, WALLET_NAME),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    .addEvalCode(TOKEN_PRE, "(get-contract-status)");

  // ── Phase 2: 9 regular users buy 2 seats each ────────────────────────────

  for (const buyer of SEAT_BUYERS) {
    builder = builder
      .withSender(buyer)
      .addContractCall({
        contract_id: FAKFUN_CORE,
        function_name: "process",
        function_args: [
          contractPrincipalCV(DEPLOYER, "unfair2-pre-faktory"),
          uintCV(2),
          noneCV(),
          someCV(OP_BUY_SEATS),
        ],
        post_condition_mode: PostConditionMode.Allow,
      });
  }

  builder = builder
    .addEvalCode(TOKEN_PRE, "(get-contract-status)")

    // ── Phase 3: smart wallet completes prelaunch ──────────────────────────
    .withSender(DEPLOYER)
    .addContractCall({
      contract_id: WALLET,
      function_name: "faktory-process",
      function_args: [
        contractPrincipalCV(DEPLOYER, "unfair2-pre-faktory"),
        uintCV(2),
        someCV(OP_BUY_SEATS),
        sigAuthOptional(signed.sig(5)),
        someCV(contractPrincipalCV(DEPLOYER, "gas-station")),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(TOKEN_PRE, "(get-contract-status)")

    // ── Phase 4: first claim (before bonding — expected err u304) ──────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "faktory-process-claim",
      function_args: [
        contractPrincipalCV(DEPLOYER, "unfair2-pre-faktory"),
        contractPrincipalCV(DEPLOYER, "unfair2-faktory"),
        sigAuthOptional(signed.sig(7)),
        someCV(contractPrincipalCV(DEPLOYER, "gas-station")),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase 5: DEX trade — place-order BUY then SELL ─────────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "faktory-place-order",
      function_args: [
        contractPrincipalCV(DEPLOYER, "unfair2-faktory-dex"),
        contractPrincipalCV(DEPLOYER, "unfair2-faktory"),
        stringAsciiCV(TOKEN_ASSET),
        uintCV(100000),
        someCV(OP_BUY),
        sigAuthOptional(signed.sig(3)),
        someCV(contractPrincipalCV(DEPLOYER, "gas-station")),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addContractCall({
      contract_id: WALLET,
      function_name: "faktory-place-order",
      function_args: [
        contractPrincipalCV(DEPLOYER, "unfair2-faktory-dex"),
        contractPrincipalCV(DEPLOYER, "unfair2-faktory"),
        stringAsciiCV(TOKEN_ASSET),
        uintCV(500_000_000_000),
        someCV(OP_SELL),
        sigAuthOptional(signed.sig(4)),
        someCV(contractPrincipalCV(DEPLOYER, "gas-station")),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase 5.5: SP24MM graduates DEX ────────────────────────────────────
    .addEvalCode(TOKEN_DEX, "(get-open)")
    .addEvalCode(TOKEN_DEX, "(var-get stx-balance)")
    .addEvalCode(TOKEN_DEX, "(var-get bonded)")

    .withSender("SP24MM95FEZJY3XWSBGZ5CT8DV04J6NVM5QA4WDXZ")
    .addContractCall({
      contract_id: FAKFUN_CORE,
      function_name: "place-order",
      function_args: [
        contractPrincipalCV(DEPLOYER, "unfair2-faktory-dex"),
        contractPrincipalCV(DEPLOYER, "unfair2-faktory"),
        uintCV(21_000_000),
        someCV(OP_BUY),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    .addEvalCode(TOKEN_DEX, "(get-bonded)")
    .addEvalCode(TOKEN_DEX, "(var-get stx-balance)")

    // ── Phase 5.6: second claim — 60% vested after toggle-bonded ──────────
    // NOTE: this reuses auth-id 7. The wallet's used-pubkey-authorizations
    // map keys by message-hash, so reusing the same signed hash triggers
    // err-signature-replay (u4006). The signer must produce a separate sig
    // for the post-bond claim if the same auth-id is required twice.
    // For now we expect the second call to err with u4006 — that proves the
    // replay-protection path. Adjust if you want a distinct auth-id.
    .withSender(DEPLOYER)
    .addContractCall({
      contract_id: WALLET,
      function_name: "faktory-process-claim",
      function_args: [
        contractPrincipalCV(DEPLOYER, "unfair2-pre-faktory"),
        contractPrincipalCV(DEPLOYER, "unfair2-faktory"),
        sigAuthOptional(signed.sig(7)),
        someCV(contractPrincipalCV(DEPLOYER, "gas-station")),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(TOKEN_PRE, `(get-user-info '${WALLET})`)

    // ── Phase 6: fee-airdrop — expected err u324 (cooldown) ───────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "faktory-fee-airdrop",
      function_args: [
        contractPrincipalCV(DEPLOYER, "unfair2-pre-faktory"),
        sigAuthOptional(signed.sig(8)),
        someCV(contractPrincipalCV(DEPLOYER, "gas-station")),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase 7: pool BUY + SELL via faktory-execute ──────────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "faktory-execute",
      function_args: [
        contractPrincipalCV(DEPLOYER, "unfair2-faktory-pool"),
        uintCV(100000),
        someCV(OP_BUY),
        contractPrincipalCV("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token"),
        stringAsciiCV("sbtc-token"),
        sigAuthOptional(signed.sig(1)),
        someCV(contractPrincipalCV(DEPLOYER, "gas-station")),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addContractCall({
      contract_id: WALLET,
      function_name: "faktory-execute",
      function_args: [
        contractPrincipalCV(DEPLOYER, "unfair2-faktory-pool"),
        uintCV(500_000_000_000),
        someCV(OP_SELL),
        contractPrincipalCV(DEPLOYER, "unfair2-faktory"),
        stringAsciiCV(TOKEN_ASSET),
        sigAuthOptional(signed.sig(2)),
        someCV(contractPrincipalCV(DEPLOYER, "gas-station")),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase 7.1: ADD-LIQ ────────────────────────────────────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "faktory-execute",
      function_args: [
        contractPrincipalCV(DEPLOYER, "unfair2-faktory-pool"),
        uintCV(100000),
        someCV(OP_ADD_LIQ),
        contractPrincipalCV(DEPLOYER, "unfair2-faktory"),
        stringAsciiCV(TOKEN_ASSET),
        sigAuthOptional(signed.sig(10)),
        someCV(contractPrincipalCV(DEPLOYER, "gas-station")),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase 7.2: REMOVE-LIQ ─────────────────────────────────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "faktory-execute",
      function_args: [
        contractPrincipalCV(DEPLOYER, "unfair2-faktory-pool"),
        uintCV(50000),
        someCV(OP_REMOVE_LIQ),
        contractPrincipalCV(DEPLOYER, "unfair2-faktory-pool"),
        stringAsciiCV(LP_ASSET),
        sigAuthOptional(signed.sig(11)),
        someCV(contractPrincipalCV(DEPLOYER, "gas-station")),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase 7.5: SP24MM large pool sell (no sig — direct core call) ─────
    .addEvalCode(TOKEN_POOL, `(get-swap-quote u50000000000000 (some 0x01))`)
    .withSender("SP24MM95FEZJY3XWSBGZ5CT8DV04J6NVM5QA4WDXZ")
    .addContractCall({
      contract_id: FAKFUN_CORE,
      function_name: "execute",
      function_args: [
        contractPrincipalCV(DEPLOYER, "unfair2-faktory-pool"),
        uintCV(50_000_000_000_000),
        someCV(OP_SELL),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase 8: BOB burn ─────────────────────────────────────────────────
    .withSender(DEPLOYER)
    .addContractCall({
      contract_id: BOB_TOKEN,
      function_name: "transfer",
      function_args: [
        uintCV(2_000_000),
        principalCV(DEPLOYER),
        contractPrincipalCV(DEPLOYER, WALLET_NAME),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addContractCall({
      contract_id: WALLET,
      function_name: "faktory-burn-bob",
      function_args: [
        sigAuthOptional(signed.sig(9)),
        someCV(contractPrincipalCV(DEPLOYER, "gas-station")),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(BURN_BOB_FAKTORY, `(get-user-stats '${WALLET})`)

    // ── Phase 9: stack-stx-juice — delegate 1 STX to JUICE-SIGNER ──────────
    // This calls pox-4.delegate-stx through the wallet's as-contract. Success
    // depends on (a) signature verification, (b) fakfun-wallet-core
    // log-stake-stx-stacking-dao accepting the call, (c) pox-4 not having a
    // prior delegation for this wallet contract.
    .addContractCall({
      contract_id: WALLET,
      function_name: "stack-stx-juice",
      function_args: [
        uintCV(1_000_000), // 1 STX = u1_000_000 ustx
        sigAuthOptional(signed.sig(12)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(
      "SP000000000000000000002Q6VF78.pox-4",
      `(get-delegation-info '${WALLET})`,
    )

    // ── Phase 10: revoke-stacking — undo the delegation just established ──
    .addContractCall({
      contract_id: WALLET,
      function_name: "revoke-stacking",
      function_args: [
        sigAuthOptional(signed.sig(13)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(
      "SP000000000000000000002Q6VF78.pox-4",
      `(get-delegation-info '${WALLET})`,
    )

    // ── Final state checks ────────────────────────────────────────────────
    .addEvalCode(WALLET, "(get-owner)")
    .addEvalCode(WALLET_CORE, `(is-whitelisted '${WALLET})`)
    .addEvalCode(TOKEN_PRE, `(get-user-info '${WALLET})`)
    .addEvalCode(TOKEN_PRE, "(get-fee-distribution-info)");

  await builder.run();
}

// ── CLI entry ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes("--print-challenges")) {
  printChallenges();
} else {
  const idx = args.indexOf("--signed");
  const signedPath = idx >= 0 ? args[idx + 1] : "./signed-bundle.json";
  runSimulation(signedPath).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
