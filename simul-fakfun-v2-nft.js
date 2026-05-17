// simul-fakfun-v2-nft.js
// Stxer mainnet-fork simulation of fakfun-wallet-v2 NFT marketplace flows.
//
// Mirrors faktory-dao/contracts/fakfun-core/simul-fakfun-v3-nft.js (privy).
// Same 6-op flow against the existing pepe-nft-marketplace + bitcoin-pepe NFT
// on mainnet, only the auth tuple shape changes (webauthn).
//
// USAGE: same two-phase as simul-fakfun-v2-wallet.js — print challenges,
// sign on /faktory-v2-sign, save bundle, then run.
//
// Operations:
//   auth-id 0: faktory-nft-execute BUY  #1731 @ 4B PEPE
//   auth-id 1: faktory-nft-execute LIST #1731 @ 3.5B PEPE
//   auth-id 2: faktory-nft-execute UPDATE-PRICE → 5B PEPE
//   auth-id 3: faktory-nft-execute UPDATE-FT → UNDO @ 2T
//   auth-id 4: faktory-nft-execute UNLIST #1731
//   auth-id 5: sip009-transfer       #1731 → USER

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
const NFTS_CORE = `${DEPLOYER}.fakfun-nfts-core`;
const PEPE_MARKETPLACE = `${DEPLOYER}.pepe-nft-marketplace`;

const PEPE_NFT_ADDR = "SP16SRR777TVB1WS5XSS9QT3YEZEC9JQFKYZENRAJ";
const PEPE_NFT_NAME = "bitcoin-pepe";
const PEPE_NFT = `${PEPE_NFT_ADDR}.${PEPE_NFT_NAME}`;

const PEPE_FT_ADDR = "SP1Z92MPDQEWZXW36VX71Q25HKF5K2EPCJ304F275";
const PEPE_FT_NAME = "tokensoft-token-v4k68639zxz";
const PEPE_FT = `${PEPE_FT_ADDR}.${PEPE_FT_NAME}`;

const UNDO_FT = `${DEPLOYER}.undo-faktory`;

const TOKEN_ID = 1731;

// ── NFT opcodes ─────────────────────────────────────────────────────────────

const NFT_OP_LIST = 0x00;
const NFT_OP_BUY = 0x01;
const NFT_OP_UNLIST = 0x02;
const NFT_OP_UPDATE_PRICE = 0x03;
const NFT_OP_UPDATE_FT = 0x04;

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

function opcodeCV(byte) {
  return someCV(bufferCV(Buffer.from([byte])));
}

function bufferCVFromByte(byte) {
  return bufferCV(Buffer.from([byte]));
}

// ── Topic-specific spec builders (mirror auth-helpers-v7 exactly) ──────────

function specNftExecute(authId, marketplace, tokenId, ftContract, price, opcodeByte) {
  return tupleCV({
    topic: stringAsciiCV("faktory-nft-execute"),
    "auth-id": uintCV(authId),
    marketplace: principalCV(marketplace),
    "token-id": uintCV(tokenId),
    "ft-contract": principalCV(ftContract),
    price: uintCV(price),
    opcode: opcodeCV(opcodeByte),
  });
}

function specSip009Transfer(authId, nftId, recipient, sip009) {
  return tupleCV({
    topic: stringAsciiCV("sip009-transfer"),
    "auth-id": uintCV(authId),
    "nft-id": uintCV(nftId),
    recipient: principalCV(recipient),
    sip009: principalCV(sip009),
  });
}

function buildOperations() {
  return [
    {
      authId: 0,
      label: `faktory-nft-execute BUY #${TOKEN_ID} @ 4B PEPE`,
      challenge: buildChallenge(
        WALLET,
        specNftExecute(0, PEPE_MARKETPLACE, TOKEN_ID, PEPE_FT, 4_000_000_000, NFT_OP_BUY),
      ),
    },
    {
      authId: 1,
      label: `faktory-nft-execute LIST #${TOKEN_ID} @ 3.5B PEPE`,
      challenge: buildChallenge(
        WALLET,
        specNftExecute(1, PEPE_MARKETPLACE, TOKEN_ID, PEPE_FT, 3_500_000_000, NFT_OP_LIST),
      ),
    },
    {
      authId: 2,
      label: `faktory-nft-execute UPDATE-PRICE #${TOKEN_ID} → 5B PEPE`,
      challenge: buildChallenge(
        WALLET,
        specNftExecute(2, PEPE_MARKETPLACE, TOKEN_ID, PEPE_FT, 5_000_000_000, NFT_OP_UPDATE_PRICE),
      ),
    },
    {
      authId: 3,
      label: `faktory-nft-execute UPDATE-FT #${TOKEN_ID} → UNDO @ 2T`,
      challenge: buildChallenge(
        WALLET,
        specNftExecute(3, PEPE_MARKETPLACE, TOKEN_ID, UNDO_FT, 2_000_000_000_000, NFT_OP_UPDATE_FT),
      ),
    },
    {
      authId: 4,
      label: `faktory-nft-execute UNLIST #${TOKEN_ID}`,
      challenge: buildChallenge(
        WALLET,
        specNftExecute(4, PEPE_MARKETPLACE, TOKEN_ID, PEPE_FT, 0, NFT_OP_UNLIST),
      ),
    },
    {
      authId: 5,
      label: `sip009-transfer #${TOKEN_ID} → USER`,
      challenge: buildChallenge(WALLET, specSip009Transfer(5, TOKEN_ID, USER, PEPE_NFT)),
    },
  ];
}

// ── Sig-auth tuple builder ──────────────────────────────────────────────────

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

    // ── Phase 1: deploy webauthn + auth-helpers-v7, register v2 hash ──────
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

    // ── Phase 2: setup — onboard pubkey, whitelist marketplace, fund ──────
    .withSender(FAKFUN_DEPLOYER)
    .addContractCall({
      contract_id: WALLET,
      function_name: "onboard",
      function_args: [pubkeyBuff],
      post_condition_mode: PostConditionMode.Allow,
    })

    .withSender(DEPLOYER)
    .addContractCall({
      contract_id: NFTS_CORE,
      function_name: "whitelist-marketplace",
      function_args: [
        principalCV(PEPE_MARKETPLACE),
        principalCV(PEPE_NFT),
        stringAsciiCV("bitcoin-pepe-marketplace"),
        trueCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    .addContractCall({
      contract_id: PEPE_MARKETPLACE,
      function_name: "whitelist-ft",
      function_args: [contractPrincipalCV(DEPLOYER, "undo-faktory"), trueCV()],
      post_condition_mode: PostConditionMode.Allow,
    })

    .addContractCall({
      contract_id: PEPE_FT,
      function_name: "transfer",
      function_args: [
        uintCV(5_000_000_000),
        principalCV(DEPLOYER),
        contractPrincipalCV(DEPLOYER, WALLET_NAME),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    .addEvalCode(PEPE_MARKETPLACE, `(get-listing u${TOKEN_ID})`)

    // ── Phase 3: BUY #1731 @ 4B PEPE ──────────────────────────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "faktory-nft-execute",
      function_args: [
        contractPrincipalCV(DEPLOYER, "pepe-nft-marketplace"),
        uintCV(TOKEN_ID),
        contractPrincipalCV(PEPE_NFT_ADDR, PEPE_NFT_NAME),
        stringAsciiCV("bitcoin-pepe"),
        contractPrincipalCV(PEPE_FT_ADDR, PEPE_FT_NAME),
        stringAsciiCV("tokensoft-token"),
        uintCV(4_000_000_000),
        someCV(bufferCVFromByte(NFT_OP_BUY)),
        sigAuthOptional(signed.sig(0)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(PEPE_NFT, `(get-owner u${TOKEN_ID})`)

    // ── Phase 4: LIST #1731 @ 3.5B PEPE ───────────────────────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "faktory-nft-execute",
      function_args: [
        contractPrincipalCV(DEPLOYER, "pepe-nft-marketplace"),
        uintCV(TOKEN_ID),
        contractPrincipalCV(PEPE_NFT_ADDR, PEPE_NFT_NAME),
        stringAsciiCV("bitcoin-pepe"),
        contractPrincipalCV(PEPE_FT_ADDR, PEPE_FT_NAME),
        stringAsciiCV("tokensoft-token"),
        uintCV(3_500_000_000),
        someCV(bufferCVFromByte(NFT_OP_LIST)),
        sigAuthOptional(signed.sig(1)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(PEPE_MARKETPLACE, `(get-listing u${TOKEN_ID})`)

    // ── Phase 5: UPDATE-PRICE → 5B PEPE ───────────────────────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "faktory-nft-execute",
      function_args: [
        contractPrincipalCV(DEPLOYER, "pepe-nft-marketplace"),
        uintCV(TOKEN_ID),
        contractPrincipalCV(PEPE_NFT_ADDR, PEPE_NFT_NAME),
        stringAsciiCV("bitcoin-pepe"),
        contractPrincipalCV(PEPE_FT_ADDR, PEPE_FT_NAME),
        stringAsciiCV("tokensoft-token"),
        uintCV(5_000_000_000),
        someCV(bufferCVFromByte(NFT_OP_UPDATE_PRICE)),
        sigAuthOptional(signed.sig(2)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(PEPE_MARKETPLACE, `(get-listing u${TOKEN_ID})`)

    // ── Phase 6: UPDATE-FT → UNDO @ 2T ────────────────────────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "faktory-nft-execute",
      function_args: [
        contractPrincipalCV(DEPLOYER, "pepe-nft-marketplace"),
        uintCV(TOKEN_ID),
        contractPrincipalCV(PEPE_NFT_ADDR, PEPE_NFT_NAME),
        stringAsciiCV("bitcoin-pepe"),
        contractPrincipalCV(DEPLOYER, "undo-faktory"),
        stringAsciiCV("UNDO"),
        uintCV(2_000_000_000_000),
        someCV(bufferCVFromByte(NFT_OP_UPDATE_FT)),
        sigAuthOptional(signed.sig(3)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(PEPE_MARKETPLACE, `(get-listing u${TOKEN_ID})`)

    // ── Phase 7: UNLIST #1731 ─────────────────────────────────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "faktory-nft-execute",
      function_args: [
        contractPrincipalCV(DEPLOYER, "pepe-nft-marketplace"),
        uintCV(TOKEN_ID),
        contractPrincipalCV(PEPE_NFT_ADDR, PEPE_NFT_NAME),
        stringAsciiCV("bitcoin-pepe"),
        contractPrincipalCV(PEPE_FT_ADDR, PEPE_FT_NAME),
        stringAsciiCV("tokensoft-token"),
        uintCV(0),
        someCV(bufferCVFromByte(NFT_OP_UNLIST)),
        sigAuthOptional(signed.sig(4)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase 8: SIP009-TRANSFER #1731 → USER ─────────────────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "sip009-transfer",
      function_args: [
        uintCV(TOKEN_ID),
        principalCV(USER),
        contractPrincipalCV(PEPE_NFT_ADDR, PEPE_NFT_NAME),
        stringAsciiCV("bitcoin-pepe"),
        sigAuthOptional(signed.sig(5)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Final state checks ────────────────────────────────────────────────
    .addEvalCode(PEPE_NFT, `(get-owner u${TOKEN_ID})`)
    .addEvalCode(PEPE_MARKETPLACE, `(get-listing u${TOKEN_ID})`)
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
  const signedPath = idx >= 0 ? args[idx + 1] : "./signed-bundle-nft.json";
  runSimulation(signedPath).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
