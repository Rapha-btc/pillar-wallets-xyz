// simul-fakfun-v2-wager.js
// Stxer mainnet-fork simulation covering fakfun-wallet-v2.wager-deposit.
//
// Bridges two signing schemes:
//   - The wallet itself authenticates via WebAuthn / secp256r1 (sig-auth tuple
//     and challenge from SP28MP1H...auth-v7.build-wager-deposit-hash).
//   - game-wager-v1 identifies users via secp256k1 pubkeys registered through
//     SP28MP1H...game-wager-v1.register-wallet (consumes a secp256k1 sig built
//     against SP28MP1H...auth-v7.build-register-wallet-hash).
//
// Coverage:
//   - new auth-helpers domain (auth-v7) builds the challenge for the
//     wallet's wager-deposit webauthn sig
//   - register-wallet secp256k1 flow on game-wager-v1
//   - wallet.wager-deposit end-to-end deposit into game-wager-v1
//
// Steps:
//   A  setup (deploy + onboard + add-admin USER + fund wallet sBTC)
//   B  game-wager-v1.set-token-whitelist(sBTC, true) as the SP28MP1H deployer
//   C  game-wager-v1.register-wallet(pubkey, wallet, auth-id, secp256k1-sig)
//      with secp256k1 sig computed in-script (RSV format)
//   D  wallet.wager-deposit(sBTC, "sbtc-token", amount, pubkey, sig-auth, gas)
//      with sig-auth = webauthn signature over the auth-v7-built challenge
//
// New webauthn sigs needed (1): auth-id 20 for wager-deposit.
// Reused from signed-bundle-admin.json (1): auth-id 0 (add-admin).

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
import { secp256k1 } from "@noble/curves/secp256k1.js";

// Addresses & contracts -------------------------------------------------------

const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP1G655MB1JVQ5FBE2JJ3E01HEA6KBM4H39F5EW63";
const USER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";
const GAME_WAGER_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";

const WALLET_NAME = "fakfun-wallet-v2";
const WALLET = `${DEPLOYER}.${WALLET_NAME}`;
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core`;
const AUTH_V7 = `${GAME_WAGER_DEPLOYER}.auth-v7`;
const GAME_WAGER = `${GAME_WAGER_DEPLOYER}.game-wager-v1`;
const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";

// Hardcoded secp256k1 keypair (used to register the wallet in game-wager-v1).
// Keeping it stable across sim runs so the webauthn challenge for wager-deposit
// (which embeds this pubkey) stays constant -- the user only ever signs once.
const SECP256K1_PRIVKEY_HEX = "945994b4e05d50847dad2f8e34e3d86bc3e6d0f2958bfd22f7b2d1f3e1974cd9";
const SECP256K1_PUBKEY_HEX = "033eef2296419524fe6ccc6c968b7a217bb76aad6b2b68e776e2ef4bf044a6a3d4";

// Wager-deposit params
const WAGER_AMOUNT = 1000; // 1000 sats sBTC (well below wallet sBTC funding)

// auth-v7 SIP-018 challenge builder ------------------------------------------
// (auth-v7's domain differs from auth-helpers-v7's: it binds to game-wager-v1,
// name="game-wager", version="1.0.0".)

const SIP018_PREFIX = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();

function authV7DomainHash() {
  const domain = tupleCV({
    "chain-id": uintCV(1),
    contract: principalCV(GAME_WAGER),
    name: stringAsciiCV("game-wager"),
    version: stringAsciiCV("1.0.0"),
  });
  return sha256(Buffer.from(serializeCV(domain), "hex"));
}

function authV7Challenge(topicTuple) {
  const msgHash = sha256(Buffer.from(serializeCV(topicTuple), "hex"));
  return sha256(Buffer.concat([SIP018_PREFIX, authV7DomainHash(), msgHash]));
}

function specRegisterWallet(authId, walletPrincipal) {
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
    pubkey: bufferCV(Buffer.from(pubkeyHex, "hex")),
    token: principalCV(tokenPrincipal),
    topic: stringAsciiCV("wager-deposit"),
  });
}

// secp256k1 signing -----------------------------------------------------------
// Clarity's secp256k1-recover? expects RSV (r || s || v). noble's `recovered`
// format returns V || R || S, so we re-pack.

function signSecp256k1Rsv(challenge, privkeyHex) {
  const sk = Buffer.from(privkeyHex, "hex");
  const sig = secp256k1.sign(challenge, sk, { prehash: false, format: "recovered" });
  // sig is 65 bytes: [v, r..(32), s..(32)]
  const v = sig[0];
  const rs = sig.slice(1);
  return Buffer.concat([Buffer.from(rs), Buffer.from([v])]); // r||s||v = 65 bytes
}

function buildOperations() {
  // The webauthn challenge for wager-deposit. user signs this with the v2 wallet
  // passkey; the wallet then verifies via auth-v7.build-wager-deposit-hash +
  // verify-signature.
  const wagerChallenge = authV7Challenge(
    specWagerDeposit(20, WAGER_AMOUNT, SECP256K1_PUBKEY_HEX, SBTC_TOKEN),
  );
  return [
    {
      authId: 20,
      label: `wager-deposit ${WAGER_AMOUNT} sats sBTC into game-wager-v1 (pubkey=${SECP256K1_PUBKEY_HEX.slice(0, 12)}...)`,
      challenge: wagerChallenge,
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

async function runSimulation(wagerBundlePath, adminBundlePath) {
  const wagerB = loadBundle(wagerBundlePath);
  const adminB = loadBundle(adminBundlePath);
  const signed = mergeBundles(adminB, wagerB);
  if (signed.walletPrincipal !== WALLET) {
    throw new Error(`Bundle wallet ${signed.walletPrincipal} != sim wallet ${WALLET}`);
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

  // Build the secp256k1 register-wallet signature in-script.
  const regChallenge = authV7Challenge(specRegisterWallet(0, WALLET));
  const regSig = signSecp256k1Rsv(regChallenge, SECP256K1_PRIVKEY_HEX);
  console.error("register-wallet challenge:", regChallenge.toString("hex"));
  console.error("register-wallet sec256k1 sig (RSV):", regSig.toString("hex"));

  const builder = SimulationBuilder.new()
    .withSender(DEPLOYER)

    // ── Phase A: setup wallet ─────────────────────────────────────────────
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
      function_name: "add-admin-with-signature",
      function_args: [principalCV(USER), sigAuthTuple(signed.sig(0)), noneCV()],
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

    // ── Phase B: whitelist sBTC in game-wager-v1 as its deployer ──────────
    .withSender(GAME_WAGER_DEPLOYER)
    .addContractCall({
      contract_id: GAME_WAGER,
      function_name: "set-token-whitelist",
      function_args: [principalCV(SBTC_TOKEN), trueCV()],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase C: register the wallet's secp256k1 pubkey in game-wager ─────
    // tx-sender can be anyone; game-wager verifies the secp256k1 sig recovers
    // the expected pubkey.
    .withSender(USER)
    .addContractCall({
      contract_id: GAME_WAGER,
      function_name: "register-wallet",
      function_args: [
        bufferCV(Buffer.from(SECP256K1_PUBKEY_HEX, "hex")),
        principalCV(WALLET),
        uintCV(0), // auth-id used inside the secp256k1 message-hash
        bufferCV(regSig),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(
      GAME_WAGER,
      `(get-registered-wallet 0x${SECP256K1_PUBKEY_HEX})`,
    )

    // ── Phase D: wallet.wager-deposit (webauthn-signed auth-id 20) ────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "wager-deposit",
      function_args: [
        contractPrincipalCV("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token"),
        stringAsciiCV("sbtc-token"),
        uintCV(WAGER_AMOUNT),
        bufferCV(Buffer.from(SECP256K1_PUBKEY_HEX, "hex")),
        sigAuthOptional(signed.sig(20)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Final state checks ────────────────────────────────────────────────
    .addEvalCode(WALLET, "(get-owner)")
    .addEvalCode(
      GAME_WAGER,
      `(get-balance 0x${SECP256K1_PUBKEY_HEX} '${SBTC_TOKEN})`,
    );

  await builder.run();
}

// CLI -------------------------------------------------------------------------

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
