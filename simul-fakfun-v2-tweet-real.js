// simul-fakfun-v2-tweet-real.js
// Stxer mainnet-fork sim: inscribe a tweet through your REAL, already-onboarded
// fakfun smart wallet, using the two passkey signatures you produced on the
// faktory-dao page /tweet-inscribe-sign. No impersonation of auth, no overrides
// of mainnet contracts -- the only new contract is `tweet-inscription`.
//
// INPUT: signed-bundle-tweet-real.json (paste from the /tweet-inscribe-sign page).
//   { walletPrincipal, owner, rpId, pubkeyHex, extension, opId, tweet, tokenUri,
//     expectedHashHex, payloadHex,
//     operations: [ {authId:0 ...whitelist sig...}, {authId:1 ...extension-call sig...} ] }
//
// USAGE: node simul-fakfun-v2-tweet-real.js [--signed signed-bundle-tweet-real.json]
//
// Phases:
//   A. Deploy tweet-inscription at <extension> (the only new contract).
//   B. whitelist-extension(<extension>)        [sender = OWNER, principal-gated, no sig].
//   C. Advance 150 blocks (clear the 144-block cooldown).
//   D. execute-pending-whitelist(opId, sig#0)  [YOUR passkey sig].
//   E. Fund the wallet 5 STX (covers the ~0.16 STX inscribe fee).
//   F. extension-call(payload, sig#1)          [YOUR passkey sig -- real, not impersonated].
//   G. Assert a new Xtrata NFT mints to <walletPrincipal>.

import fs from "node:fs";
import {
  ClarityVersion,
  tupleCV,
  uintCV,
  bufferCV,
  noneCV,
  someCV,
  principalCV,
  serializeCV,
  PostConditionMode,
} from "@stacks/transactions";
import { SimulationBuilder } from "stxer";

const XTRATA = "SP3JNSEXAZP4BDSHV0DN3M8R3P0MY0EEBQQZX743X.xtrata-v3-2-3";
const COOLDOWN_ADVANCE = 150; // > wallet-config cooldown-period (144)

const stripHex = (s) => (s.startsWith("0x") ? s.slice(2) : s);
const buf = (h) => bufferCV(Buffer.from(stripHex(h), "hex"));

function sigAuthCV(pubkeyHex, op) {
  return tupleCV({
    "auth-id": uintCV(op.authId),
    pubkey: buf(pubkeyHex),
    signature: buf(op.signatureHex),
    "authenticator-data": buf(op.authenticatorDataHex),
    "client-data-prefix": buf(op.clientDataPrefixHex),
    "client-data-suffix": buf(op.clientDataSuffixHex),
  });
}

async function run(path) {
  if (!fs.existsSync(path)) throw new Error(`bundle not found at ${path} (export it from /tweet-inscribe-sign)`);
  const b = JSON.parse(fs.readFileSync(path, "utf8"));
  const { walletPrincipal: WALLET, owner: OWNER, pubkeyHex, extension: EXT, opId, payloadHex } = b;
  const [extAddr, extName] = EXT.split(".");
  const opWhitelist = b.operations.find((o) => o.authId === 0);
  const opExtCall = b.operations.find((o) => o.authId === 1);
  if (!OWNER) throw new Error("bundle.owner missing (wallet owner address needed for whitelist-extension)");
  if (!opWhitelist || !opExtCall) throw new Error("bundle must carry auth-id 0 (whitelist) and 1 (extension-call)");

  const payload = bufferCV(Buffer.from(stripHex(payloadHex), "hex"));
  const here = new URL(".", import.meta.url).pathname;
  const extSource = fs.readFileSync(`${here}contracts/fakfun-extensions/xtrata-inscribe.clar`, "utf8");

  console.error(`wallet=${WALLET} owner=${OWNER} ext=${EXT} opId=${opId} payload=${stripHex(payloadHex).length / 2}B`);

  const builder = SimulationBuilder.new()
    // A. deploy the only new contract
    .withSender(extAddr)
    .addContractDeploy({ contract_name: extName, source_code: extSource, clarity_version: ClarityVersion.Clarity5 })

    // B. whitelist-extension -> pending op (owner principal, no sig)
    .withSender(OWNER)
    .addContractCall({
      contract_id: WALLET,
      function_name: "whitelist-extension",
      function_args: [principalCV(EXT)],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(WALLET, `(get-pending-operation u${opId})`)

    // C. clear the cooldown
    .addAdvanceBlocks({ bitcoin_blocks: COOLDOWN_ADVANCE, stacks_blocks_per_bitcoin: 1 })

    // D. execute-pending-whitelist -- YOUR sig #0
    .addContractCall({
      contract_id: WALLET,
      function_name: "execute-pending-whitelist",
      function_args: [uintCV(opId), sigAuthCV(pubkeyHex, opWhitelist), noneCV()],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(WALLET, `(is-extension-whitelisted '${EXT})`)

    // E. fund for the inscribe fee
    .addSTXTransfer({ sender: extAddr, recipient: WALLET, amount: 5_000_000 })
    .addEvalCode(XTRATA, "(get-last-token-id)")

    // F. inscribe -- YOUR sig #1 (real extension-call signature, not impersonated)
    .withSender(OWNER)
    .addContractCall({
      contract_id: WALLET,
      function_name: "extension-call",
      function_args: [principalCV(EXT), payload, someCV(sigAuthCV(pubkeyHex, opExtCall)), noneCV()],
      post_condition_mode: PostConditionMode.Allow,
    })

    // G. assertions — incl. explicit owner of the just-minted token
    .addEvalCode(XTRATA, "(get-last-token-id)")
    .addEvalCode(XTRATA, "(get-minted-count)")
    .addEvalCode(XTRATA, "(get-owner (unwrap-panic (get-last-token-id)))");

  await builder.run();
}

const idx = process.argv.indexOf("--signed");
run(idx >= 0 ? process.argv[idx + 1] : "./signed-bundle-tweet-real.json").catch((e) => {
  console.error(e);
  process.exit(1);
});
