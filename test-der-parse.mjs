// Sanity-check derToRawSignature against a known DER signature.
// Mirrors the FE's parser exactly.

import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha256";

function concatBytes(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function derToRawSignature(der) {
  if (der[0] !== 0x30) throw new Error("Invalid DER: expected 0x30 sequence");
  let offset = 2;
  if (der[1] & 0x80) {
    offset = 2 + (der[1] & 0x7f);
  }
  if (der[offset] !== 0x02) throw new Error("Invalid DER: expected 0x02 for R");
  const rLen = der[offset + 1];
  let r = der.slice(offset + 2, offset + 2 + rLen);
  offset = offset + 2 + rLen;
  if (der[offset] !== 0x02) throw new Error("Invalid DER: expected 0x02 for S");
  const sLen = der[offset + 1];
  let s = der.slice(offset + 2, offset + 2 + sLen);
  if (r.length === 33 && r[0] === 0x00) r = r.slice(1);
  if (s.length === 33 && s[0] === 0x00) s = s.slice(1);
  const r32 = new Uint8Array(32);
  const s32 = new Uint8Array(32);
  r32.set(r, 32 - r.length);
  s32.set(s, 32 - s.length);
  return concatBytes(r32, s32);
}

// Generate a fresh P-256 key, sign a known message, DER → raw, then verify
// against our reconstructed raw r||s.
const priv = p256.utils.randomSecretKey();
const pub = p256.getPublicKey(priv);
const msg = new TextEncoder().encode("hello fakfun");
const hash = sha256(msg);

const sigDer = p256.sign(priv, hash, { format: "der" });
console.log("DER length:", sigDer.length, "first bytes:", Buffer.from(sigDer.slice(0, 6)).toString("hex"));

const raw = derToRawSignature(sigDer);
console.log("Raw length:", raw.length);
console.log("r:", Buffer.from(raw.slice(0, 32)).toString("hex"));
console.log("s:", Buffer.from(raw.slice(32, 64)).toString("hex"));

// Verify the raw form
const ok = p256.verify(raw, hash, pub, { format: "compact" });
console.log("verify (compact):", ok);
