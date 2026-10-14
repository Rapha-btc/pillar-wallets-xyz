// keys.mjs -- deterministic TEST keys for the juice-autostake-safe RV harness.
// Both keys are derived from fixed labels so the simnet plan (onboard pubkey,
// pool grant signature) and the dialer (passkey signatures) always agree.
// They guard nothing outside this simnet.
import crypto from "node:crypto";
import { p256 } from "@noble/curves/nist.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { Cl } from "@stacks/transactions";

const sha256 = (b) => crypto.createHash("sha256").update(b).digest();

export const DEPLOYER = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
export const WALLET = `${DEPLOYER}.juice-autostake-safe`;
export const POOL = `${DEPLOYER}.juice-autostake-pool`;
export const CHAIN_ID = 2147483648; // simnet (testnet) chain-id
export const RP_ID = "juiceofbtc.com";
export const SIP018 = Buffer.from("534950303138", "hex");

// passkey (P-256), registered at onboard
export const PASSKEY_PRIV = sha256(Buffer.from("rv-juice-autostake-safe-passkey"));
export const PASSKEY_PUB = Buffer.from(p256.getPublicKey(PASSKEY_PRIV, true));

// pool signer key (secp256k1), for pox-5's grant-authorization
const SIGNER_PRIV = sha256(Buffer.from("rv-juice-autostake-pool-signer"));
export const SIGNER_PUB = Buffer.from(secp256k1.getPublicKey(SIGNER_PRIV, true));

export function cvHash(cv) {
  return sha256(Buffer.from(Cl.serialize(cv), "hex"));
}

/** Mirrors pox-5 get-signer-grant-message-hash. */
export function grantMessageHash(authId) {
  const domain = cvHash(Cl.tuple({
    name: Cl.stringAscii("pox-5-signer"), version: Cl.stringAscii("1.0.0"), "chain-id": Cl.uint(CHAIN_ID),
  }));
  const [addr, name] = POOL.split(".");
  const struct = cvHash(Cl.tuple({
    topic: Cl.stringAscii("grant-authorization"),
    "signer-manager": Cl.contractPrincipal(addr, name), "auth-id": Cl.uint(authId),
  }));
  return sha256(Buffer.concat([SIP018, domain, struct]));
}

/** 65-byte (r || s || recovery-id) grant signature for auth-id 1. */
export function grantSignature() {
  const msg = grantMessageHash(1);
  const compact = Buffer.from(secp256k1.sign(msg, SIGNER_PRIV, { prehash: false }));
  const sig = secp256k1.Signature.fromBytes(compact, "compact");
  for (const rec of [0, 1]) {
    const pub = Buffer.from(sig.addRecoveryBit(rec).recoverPublicKey(msg).toBytes(true));
    if (pub.equals(SIGNER_PUB)) return Buffer.concat([compact, Buffer.from([rec])]);
  }
  throw new Error("no recovery id matches");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("passkey pub", PASSKEY_PUB.toString("hex"));
  console.log("signer pub ", SIGNER_PUB.toString("hex"));
  console.log("grant sig  ", grantSignature().toString("hex"));
}
