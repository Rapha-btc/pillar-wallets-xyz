// _safe-bytes.mjs - lets the existing juice-safe / autostake stxer harnesses run
// on other deploy bytes than the ones they were written for, without changing
// any assertion.
//   SAFE_BYTES_DIR=deploy-bytes-memofix  -> the safe + helper come from that
//     folder (sha256 checked against its SHA256SUMS.txt) instead of
//     jing-contracts-v3/simulations/deploy-bytes-mv7dfb or the commented source
// liveIdentical(): a partner contract (Jing stack) that is now LIVE on mainnet
// with exactly the bytes the harness would deploy is not redeployed (a second
// deploy is a "Duplicate contract" failure on the fork); live with OTHER bytes
// is an error.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SAFE_BYTES_DIR = process.env.SAFE_BYTES_DIR ? path.resolve(process.env.SAFE_BYTES_DIR) : null;
export const bytesTag = () => (SAFE_BYTES_DIR ? `-${path.basename(SAFE_BYTES_DIR)}` : "");

export function loadBytes(dir, name) {
  const sums = Object.fromEntries(fs.readFileSync(`${dir}/SHA256SUMS.txt`, "utf8").trim().split("\n")
    .map((l) => l.trim().split(/\s+/)).map(([f, , h]) => [f, h]));
  const s = fs.readFileSync(`${dir}/${name}.clar`, "utf8");
  const h = crypto.createHash("sha256").update(s).digest("hex");
  if (sums[`${name}.clar`] !== h) throw new Error(`${name}: sha256 ${h} != ${dir}/SHA256SUMS.txt (${sums[`${name}.clar`]})`);
  return { s, h, h512: crypto.createHash("sha512-256").update(s).digest("hex") };
}

export async function liveIdentical(node, cid, code) {
  const [a, n] = cid.split(".");
  const r = await fetch(`${node}/v2/contracts/source/${a}/${n}?proof=0`);
  if (!r.ok) return false;
  const live = (await r.json()).source;
  if (live !== code) throw new Error(`${cid} is live on mainnet with different bytes than the harness deploys`);
  return true;
}
