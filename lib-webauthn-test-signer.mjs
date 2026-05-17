// lib-webauthn-test-signer.mjs
// Ephemeral P-256 keypair + WebAuthn-style assertion signer for self-test sims.
// Produces sig-auth tuples that pass clarity-webauthn.verify-webauthn-signature
// against rp.id "fak.fun" -- mirrors what /faktory-v2-sign would emit for a real
// passkey, but without needing a browser.

import crypto from "node:crypto";
import { p256 } from "@noble/curves/nist.js";

const sha256 = (b) => crypto.createHash("sha256").update(b).digest();

// rp.id host. clientDataJSON.origin = `https://<RP_ID>` and authenticator-data
// starts with sha256(RP_ID). Must match the constants in game-wager-v2.clar.
export const TEST_RP_ID = "fak.fun";
export const TEST_RP_ID_HASH = sha256(Buffer.from(TEST_RP_ID, "ascii"));
// Quick parity check against the constant baked into the contract.
const EXPECTED_RP_ID_HASH = Buffer.from(
  "b877fea5df49f6d2fe544db0c7ced754f117ade85f60266bc217db3b239f2249",
  "hex",
);
if (!TEST_RP_ID_HASH.equals(EXPECTED_RP_ID_HASH)) {
  throw new Error(
    `sha256("${TEST_RP_ID}") mismatch -- expected ${EXPECTED_RP_ID_HASH.toString("hex")}, got ${TEST_RP_ID_HASH.toString("hex")}`,
  );
}

// base64url (no padding) — what WebAuthn embeds in clientDataJSON.challenge.
function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Build authenticatorData: [rpIdHash(32) | flags(1) | signCount(4)] = 37 bytes.
// flags bit 0 = UP (user-present). signCount can be anything; we keep it at 5.
function buildAuthenticatorData() {
  const flags = Buffer.from([0x05]); // UP + UV
  const signCount = Buffer.from([0x00, 0x00, 0x00, 0x05]);
  return Buffer.concat([TEST_RP_ID_HASH, flags, signCount]);
}

// Real browsers' clientDataJSON for `navigator.credentials.get` follows this
// layout. The contract reconstructs the middle (challenge in base64url) so
// only the prefix/suffix are caller-supplied.
const CLIENT_DATA_PREFIX = Buffer.from('{"type":"webauthn.get","challenge":"', "utf8");
const CLIENT_DATA_SUFFIX = Buffer.from(`","origin":"https://${TEST_RP_ID}","crossOrigin":false}`, "utf8");

/**
 * Generate a fresh P-256 keypair for a test "player".
 * Returns { privKeyHex, pubKeyHex } -- pubKey is the 33-byte compressed form
 * that game-wager-v2 stores as (buff 33).
 */
export function generateP256Keypair() {
  // noble's p256.keygen() returns Uint8Array secret + uncompressed public.
  // We need compressed (33 bytes).
  const { secretKey } = p256.keygen();
  const pubUncompressed = p256.getPublicKey(secretKey, false);
  const pubCompressed = p256.getPublicKey(secretKey, true);
  return {
    privKey: Buffer.from(secretKey),
    privKeyHex: Buffer.from(secretKey).toString("hex"),
    pubKey: Buffer.from(pubCompressed),
    pubKeyHex: Buffer.from(pubCompressed).toString("hex"),
    pubKeyUncompressedHex: Buffer.from(pubUncompressed).toString("hex"),
  };
}

/**
 * Produce a sig-auth tuple over `challengeBytes` (32 bytes -- the SIP-018
 * message hash the contract reconstructs). The returned shape matches
 * /faktory-v2-sign's SignedBundle.operations[i] exactly.
 */
export function signChallenge(challengeBytes, privKey) {
  if (challengeBytes.length !== 32) {
    throw new Error(`challenge must be 32 bytes, got ${challengeBytes.length}`);
  }
  const authenticatorData = buildAuthenticatorData();
  const challengeB64 = base64url(challengeBytes);
  const clientDataJSON = Buffer.concat([
    CLIENT_DATA_PREFIX,
    Buffer.from(challengeB64, "ascii"),
    CLIENT_DATA_SUFFIX,
  ]);
  // WebAuthn signs: sha256( authenticatorData || sha256(clientDataJSON) )
  const signedDigest = sha256(Buffer.concat([authenticatorData, sha256(clientDataJSON)]));
  // p256.sign defaults: low-s normalized, returns compact (r||s) when asked.
  const sig = p256.sign(signedDigest, privKey, { prehash: false, format: "compact", lowS: true });
  return {
    signatureHex: "0x" + Buffer.from(sig).toString("hex"),
    authenticatorDataHex: "0x" + authenticatorData.toString("hex"),
    clientDataPrefixHex: "0x" + CLIENT_DATA_PREFIX.toString("hex"),
    clientDataSuffixHex: "0x" + CLIENT_DATA_SUFFIX.toString("hex"),
  };
}

/**
 * Build a SignedBundle (the shape /faktory-v2-sign would emit) for a player
 * over a list of { authId, label, challenge } ops.
 */
export function buildSignedBundle({ walletPrincipal, pubKeyHex, privKey, operations }) {
  return {
    walletPrincipal,
    rpId: TEST_RP_ID,
    pubkeyHex: "0x" + pubKeyHex,
    operations: operations.map((op) => ({
      authId: op.authId,
      label: op.label,
      challengeHex: "0x" + op.challenge.toString("hex"),
      ...signChallenge(op.challenge, privKey),
    })),
  };
}
