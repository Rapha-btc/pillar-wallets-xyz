// simul-fakfun-v2-negative.js
// Stxer mainnet-fork sim hitting every guard / err code on the new 3-step
// admin init + veto + toggle-token-lock burn-owner assert.
//
// Reuses signed-bundle-init.json (sigs 0/1/2/3) -- no new signatures needed.
// Same passkey signs propose-admin twice (auth-ids 0 and 2) so we can test
// err-init-already-proposed without re-signing.
//
// Phase map (each row = one tx):
//   A. Setup: deploy + register-hash + onboard
//   B. toggle-token-lock(true) as USER pre-init -- err-unauthorised (u4001)
//      because owner = burn-address (the asserts I added in toggle-token-lock)
//   C. accept-admin-proposal -- err-no-pending-init (u4027), nothing pending
//   D. veto-pending-init(sig 1) -- err-no-pending-init (u4027)
//   E. propose-admin-with-signature(USER, sig 0) -- ok
//   F. propose-admin-with-signature(USER, sig 2) -- err-init-already-proposed (u4026)
//   G. accept-admin-proposal as DEPLOYER (not USER) -- err-init-not-pending-admin (u4028)
//   H. confirm-admin-with-signature(sig 3) BEFORE accept -- err-init-not-accepted (u4029)
//      sig 3 is NOT consumed (assert fires before is-authorized)
//   I. accept-admin-proposal as USER -- ok
//   J. confirm-admin-with-signature(sig 3) BEFORE cooldown -- err-in-cooldown (u4012)
//      sig 3 still NOT consumed
//   K. addAdvanceBlocks(440)
//   L. confirm-admin-with-signature(sig 3) AFTER cooldown -- ok, finalizes
//   M. propose-admin-with-signature(USER, sig 0) AGAIN after init
//      -- err-already-initialized (u4022)
//   N. veto-pending-init(sig 1) AFTER init -- err-already-initialized (u4022)

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
  falseCV,
  principalCV,
  contractPrincipalCV,
  stringAsciiCV,
  serializeCV,
  PostConditionMode,
} from "@stacks/transactions";
import { SimulationBuilder } from "stxer";

const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP1G655MB1JVQ5FBE2JJ3E01HEA6KBM4H39F5EW63";
const USER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";

const WALLET_NAME = "fakfun-wallet-v2";
const WALLET = `${DEPLOYER}.${WALLET_NAME}`;
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core`;

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

function loadBundle(path) {
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
    sig: (id) => {
      const v = byAuthId.get(id);
      if (!v) throw new Error(`bundle missing auth-id ${id}`);
      return v;
    },
  };
}

async function runSimulation() {
  const signed = loadBundle("./signed-bundle-init.json");
  const pubkeyBuff = bufferCV(Buffer.from(stripHex(signed.pubkeyHex), "hex"));

  const here = new URL(".", import.meta.url).pathname;
  const walletSource = fs.readFileSync(`${here}contracts/fakfun-wallet-v2.clar`, "utf8");
  const webauthnSource = fs.readFileSync(`${here}contracts/clarity-webauthn.clar`, "utf8");
  const authHelpersSource = fs.readFileSync(
    `${here}contracts/smart-wallet-standard-auth-helpers-v7.clar`,
    "utf8",
  );
  const pillarTraitSource = fs.readFileSync(
    `${here}contracts/deployed/deploying/pillar-wallet-trait.clar`,
    "utf8",
  );
  const gameWagerV2Source = fs.readFileSync(
    `${here}contracts/game-wager-v2.clar`,
    "utf8",
  );

  const v2Hash = crypto.createHash("sha512-256").update(walletSource).digest();

  const builder = SimulationBuilder.new()
    .withSender(DEPLOYER)

    // ── Phase A: setup ────────────────────────────────────────────────────
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
    // pillar-wallet-trait + game-wager-v2 must exist before the wallet deploys
    // because the wallet (impl-trait ...) and (contract-call? '...game-wager-v2 ...)
    // are both statically checked. Both contracts live at SP28MP1H on
    // mainnet; the sim deploys them under that same principal so the
    // hardcoded references resolve.
    .withSender("SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK")
    .addContractDeploy({
      contract_name: "pillar-wallet-trait",
      source_code: pillarTraitSource,
      clarity_version: ClarityVersion.Clarity5,
    })
    .addContractDeploy({
      contract_name: "game-wager-v2",
      source_code: gameWagerV2Source,
      clarity_version: ClarityVersion.Clarity5,
    })
    .withSender("SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22")
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

    // ── Phase B: toggle-token-lock pre-init -- owner is burn -> u4001 ─────
    // No-sig path; tx-sender = USER but owner=burn so the burn-owner assert
    // (top of toggle-token-lock) fires before any other check.
    .withSender(USER)
    .addContractCall({
      contract_id: WALLET,
      function_name: "toggle-token-lock",
      function_args: [trueCV(), noneCV(), noneCV()],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase C: accept-admin-proposal with no pending -> u4027 ───────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "accept-admin-proposal",
      function_args: [],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase D: veto-pending-init with no pending -> u4027 ───────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "veto-pending-init",
      function_args: [sigAuthTuple(signed.sig(1)), noneCV()],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase E: propose-admin (sig 0) -> ok ──────────────────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "propose-admin-with-signature",
      function_args: [principalCV(USER), sigAuthTuple(signed.sig(0)), noneCV()],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase F: propose-admin again (sig 2) -> u4026 already-proposed ────
    .addContractCall({
      contract_id: WALLET,
      function_name: "propose-admin-with-signature",
      function_args: [principalCV(USER), sigAuthTuple(signed.sig(2)), noneCV()],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase G: accept as DEPLOYER (not USER) -> u4028 ───────────────────
    .withSender(DEPLOYER)
    .addContractCall({
      contract_id: WALLET,
      function_name: "accept-admin-proposal",
      function_args: [],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase H: confirm before accept (sig 3) -> u4029, sig NOT consumed ─
    .withSender(USER)
    .addContractCall({
      contract_id: WALLET,
      function_name: "confirm-admin-with-signature",
      function_args: [sigAuthTuple(signed.sig(3)), noneCV()],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase I: accept as USER -> ok ─────────────────────────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "accept-admin-proposal",
      function_args: [],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase J: confirm before cooldown (sig 3) -> u4012, NOT consumed ───
    .addContractCall({
      contract_id: WALLET,
      function_name: "confirm-admin-with-signature",
      function_args: [sigAuthTuple(signed.sig(3)), noneCV()],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase K: advance cooldown ─────────────────────────────────────────
    .addAdvanceBlocks({ bitcoin_blocks: 440, stacks_blocks_per_bitcoin: 1 })

    // ── Phase L: confirm after cooldown (sig 3 finally consumed) -> ok ────
    .addContractCall({
      contract_id: WALLET,
      function_name: "confirm-admin-with-signature",
      function_args: [sigAuthTuple(signed.sig(3)), noneCV()],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase M: propose-admin again after init (sig 0 already consumed,
    //            but is-initialized check fires first) -> u4022 ────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "propose-admin-with-signature",
      function_args: [principalCV(USER), sigAuthTuple(signed.sig(0)), noneCV()],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase N: veto after init -> u4022 ─────────────────────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "veto-pending-init",
      function_args: [sigAuthTuple(signed.sig(1)), noneCV()],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Final state ───────────────────────────────────────────────────────
    .addEvalCode(WALLET, "(var-get is-initialized)")
    .addEvalCode(WALLET, "(get-owner)");

  await builder.run();
}

runSimulation().catch((e) => {
  console.error(e);
  process.exit(1);
});
