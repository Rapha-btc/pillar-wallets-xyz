// simul-fakfun-v2-sbtc-withdrawal.js
// Stxer mainnet-fork simulation for the new sBTC -> BTC peg-out functions on
// fakfun-wallet-v2 (committed in 09ae9f6):
//   - sbtc-initiate-withdrawal (admin + signed paths, under + over threshold)
//   - execute-pending-sbtc-withdrawal (admin-only)
//
// Both functions route through the bridge
// SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal (mainnet, no
// redeploy). Under-threshold: bridge is called inline; (amount + max-fee) is
// pulled from the wallet's sbtc-token balance and moved to sbtc-token-locked.
// Over-threshold: a pending op is parked (op-type "sbtc-withdraw") with the
// BTC recipient {version, hashbytes} + max-fee serialized into `payload` via
// to-consensus-buff?, recipient field set to the wallet itself as a
// placeholder, amount = withdrawal amount (NOT amount+max-fee). After cooldown
// (default 144 burn blocks), admin calls execute-pending-sbtc-withdrawal to
// release the funds to the bridge.
//
// HELPER v8 DEPLOY -- the new signed path hashes via
// SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v8
// (additive over v7: SIP018_MSG_PREFIX + get-domain-hash copied verbatim + the
// new build-sbtc-withdrawal-hash). v7 still backs every existing op. Both are
// deployed under DEPLOYER in Phase A.
//
// SIGNING STRATEGY -- unlike the browser-passkey sims (signed-bundle-*.json),
// this sim uses lib-webauthn-test-signer.mjs to onboard the wallet with an
// EPHEMERAL P-256 keypair and sign all SIP-018 challenges inline. Same shape
// as simul-game-wager-v2.js. No browser round-trip required. The wallet's
// verify-signature path is identical whether the pubkey came from a real
// passkey or a CLI keygen; the test signer mirrors WebAuthn assertion bytes
// exactly (rp.id = fak.fun, authenticatorData flags=UP|UV, compact ES256 sig).
//
// Phase map:
//   A. Setup: deploy webauthn + helpers v7 + v8 + pillar-wallet-trait +
//      game-wager-v2; register wallet hash; deploy wallet; onboard with
//      ephemeral pubkey; 3-step admin init (propose + accept + advance + confirm).
//      Fund wallet with 500_000 sats sBTC + 5 STX (gas).
//   C. Over-threshold signed sbtc-initiate-withdrawal -> pending op-id 0
//      (amount 200_000 + max-fee 1_000 = 201_000 > default 100_000 threshold).
//      Verify: pending entry shape, NO sBTC moved yet, operation-nonce = 1.
//   D. Advance 150 burn blocks (> 144 cooldown) and call
//      execute-pending-sbtc-withdrawal(0). Verify: op marked executed, bridge
//      called, wallet's sbtc-token drops by 201_000, sbtc-token-locked rises
//      by same.
//   E. Create another pending op (admin path, amount 200_000, max-fee 1_000)
//      -> op-id 1. veto-operation(1) (admin path). Advance 150 blocks.
//      execute-pending-sbtc-withdrawal(1) -> err-vetoed (u4015).
//   F. Create another pending op (admin path) -> op-id 2. Immediately call
//      execute-pending-sbtc-withdrawal(2) BEFORE cooldown -> err-cooldown-not-passed (u4017).
//   G. Create a sip010-transfer pending op (sBTC, amount 200_000) -> op-id 3
//      with op-type "sbtc-transfer". Call execute-pending-sbtc-withdrawal(3)
//      -> err-invalid-operation (u4013).
//   A. Under-threshold signed sbtc-initiate-withdrawal (amount 30_000 + max-fee
//      1_000 = 31_000, well under threshold). Verify: bridge called inline,
//      wallet sBTC drops 31_000, sbtc-token-locked rises 31_000,
//      spend-this-period.sbtc += 31_000.
//   B. Under-threshold admin sbtc-initiate-withdrawal (no sig). Same end state.
//   H. Under-threshold admin sbtc-initiate-withdrawal with version = 0x07
//      (unknown address version). The bridge's ERR_INVALID_ADDR_VERSION
//      propagates; tx aborts; no state change.
//
// Test order:
//   C, D execute first (over-threshold pending path) so the pending-op cooldown
//   races don't leak into the under-threshold cases (spend-this-period only
//   accumulates on under-threshold sBTC outflows, never on pending creation).
//   After D, sbtc spent = 0 (D's bridge call goes through as-contract? without
//   touching add-spent-sbtc -- create-pending-operation never calls it, and
//   execute-pending-sbtc-withdrawal doesn't either; the spend was implicit at
//   the pending-op create time but the contract chooses not to meter pending
//   amounts. Confirm by snapshotting spent-this-period after each phase.)

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
import {
  generateP256Keypair,
  signChallenge,
} from "./lib-webauthn-test-signer.mjs";

// ── Addresses & contracts ───────────────────────────────────────────────────

const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP1G655MB1JVQ5FBE2JJ3E01HEA6KBM4H39F5EW63"; // gates onboard()
const USER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";
const GAME_WAGER_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";

const WALLET_NAME = "fakfun-wallet-v2";
const WALLET = `${DEPLOYER}.${WALLET_NAME}`;
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core`;
const HELPERS_V7_NAME = "smart-wallet-standard-auth-helpers-v7";
const HELPERS_V8_NAME = "smart-wallet-standard-auth-helpers-v8";

const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const SBTC_WITHDRAWAL = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal";

// ── Sim parameters ──────────────────────────────────────────────────────────

// Wallet default sbtc-threshold = u100_000. Pick amounts well above and well
// below so threshold drift doesn't break the test order.
const OVER_AMOUNT = 200_000; // > threshold even with max-fee = 0
const OVER_MAX_FEE = 1_000; // 201_000 total -> over
const UNDER_AMOUNT = 30_000;
const UNDER_MAX_FEE = 1_000; // 31_000 total -> well under 100_000

// BTC recipient -- P2WPKH (version 0x04). The wallet's recipient field is
// (buff 32) but the bridge's validate-recipient asserts:
//   - hashbytes MUST be 20 bytes when version <= 0x04 (P2PKH / P2SH / P2WPKH)
//   - hashbytes MUST be 32 bytes when version >= 0x05 (P2WSH / P2TR)
// Pass a 20-byte buff for version 0x04 -- Clarity (buff 32) accepts any
// length up to 32, and on the wire to-consensus-buff? serializes the actual
// length (so the signed challenge + payload reflect the 20-byte recipient).
const P2WPKH_VERSION = "04";
const RECIPIENT_HASHBYTES = Buffer.from("aa".repeat(20), "hex");

// Invalid address version -- bridge whitelists 0x00 / 0x01 / 0x02 / 0x03 / 0x04
// / 0x05 / 0x06 (MAX_ADDRESS_VERSION = u6). 0x07 should err with u500
// (ERR_INVALID_ADDR_VERSION) and the tx aborts.
const INVALID_VERSION = "07";

// Fund amount -- needs to cover both over-threshold attempts (3 × 201_000 =
// 603_000 sats, though only one of those actually locks sBTC; the rest end
// up vetoed / err) plus the two under-threshold drains (62_000) plus a bit
// of headroom for the over-threshold create (which doesn't move sBTC).
// Generous: 1_000_000 sats.
const FUND_SBTC_SATS = 1_000_000;

// Auth IDs
const AUTH_ID_PROPOSE = 0;
const AUTH_ID_CONFIRM = 1;
const AUTH_ID_WITHDRAW_OVER = 100; // over-threshold signed call
const AUTH_ID_WITHDRAW_UNDER = 101; // under-threshold signed call

// ── SIP-018 challenge builders ──────────────────────────────────────────────

const SIP018_PREFIX = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();

// Wallet domain (identical between helpers v7 and v8 -- v8 copies v7's
// get-domain-hash verbatim, and (contract-caller) in either case is the
// wallet when the wallet does the contract-call?).
function walletDomainHash() {
  const domain = tupleCV({
    name: stringAsciiCV("smart-wallet-standard"),
    version: stringAsciiCV("1.0.0"),
    "chain-id": uintCV(1),
    wallet: principalCV(WALLET),
  });
  return sha256(Buffer.from(serializeCV(domain), "hex"));
}

function walletChallenge(topicTuple) {
  const msgHash = sha256(Buffer.from(serializeCV(topicTuple), "hex"));
  return sha256(Buffer.concat([SIP018_PREFIX, walletDomainHash(), msgHash]));
}

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

// Mirrors smart-wallet-standard-auth-helpers-v8.build-sbtc-withdrawal-hash:
//   topic = "sbtc-withdrawal" (not "sbtc-withdraw" -- the contract op-type
//   differs from the SIP-018 topic intentionally, see v8 source).
//   recipient is a nested {version, hashbytes} tuple; to-consensus-buff?
//   serializes it deterministically.
function specSbtcWithdrawal(authId, amount, recipientVersionHex, recipientHashbytes, maxFee) {
  return tupleCV({
    topic: stringAsciiCV("sbtc-withdrawal"),
    "auth-id": uintCV(authId),
    amount: uintCV(amount),
    recipient: tupleCV({
      version: bufferCV(Buffer.from(recipientVersionHex, "hex")),
      hashbytes: bufferCV(recipientHashbytes),
    }),
    "max-fee": uintCV(maxFee),
  });
}

function recipientTupleCV(versionHex, hashbytesBuf) {
  return tupleCV({
    version: bufferCV(Buffer.from(versionHex, "hex")),
    hashbytes: bufferCV(hashbytesBuf),
  });
}

// ── Sig-auth helpers (inline ephemeral signer) ──────────────────────────────

function sigAuthTuple(authId, signed, pubKeyHex) {
  const stripHex = (s) => (s.startsWith("0x") ? s.slice(2) : s);
  return tupleCV({
    "auth-id": uintCV(authId),
    pubkey: bufferCV(Buffer.from(stripHex(pubKeyHex), "hex")),
    signature: bufferCV(Buffer.from(stripHex(signed.signatureHex), "hex")),
    "authenticator-data": bufferCV(
      Buffer.from(stripHex(signed.authenticatorDataHex), "hex"),
    ),
    "client-data-prefix": bufferCV(
      Buffer.from(stripHex(signed.clientDataPrefixHex), "hex"),
    ),
    "client-data-suffix": bufferCV(
      Buffer.from(stripHex(signed.clientDataSuffixHex), "hex"),
    ),
  });
}

// ── Main ────────────────────────────────────────────────────────────────────

async function runSimulation() {
  // Generate an ephemeral P-256 keypair. The pubkey gets baked into onboard()
  // and every signed challenge below is signed with the matching privkey.
  const kp = generateP256Keypair();
  const pubKeyHex = kp.pubKeyHex;
  const pubkeyBuff = bufferCV(kp.pubKey);
  console.error("Ephemeral pubkey:", pubKeyHex);

  // Build all challenges up front so we can fail-fast on a hash mismatch
  // rather than mid-sim.
  const challengePropose = walletChallenge(specAddAdmin(AUTH_ID_PROPOSE, USER));
  const challengeConfirm = walletChallenge(specConfirmAdmin(AUTH_ID_CONFIRM, USER));
  const challengeWithdrawOver = walletChallenge(
    specSbtcWithdrawal(
      AUTH_ID_WITHDRAW_OVER,
      OVER_AMOUNT,
      P2WPKH_VERSION,
      RECIPIENT_HASHBYTES,
      OVER_MAX_FEE,
    ),
  );
  const challengeWithdrawUnder = walletChallenge(
    specSbtcWithdrawal(
      AUTH_ID_WITHDRAW_UNDER,
      UNDER_AMOUNT,
      P2WPKH_VERSION,
      RECIPIENT_HASHBYTES,
      UNDER_MAX_FEE,
    ),
  );

  const sigPropose = signChallenge(challengePropose, kp.privKey);
  const sigConfirm = signChallenge(challengeConfirm, kp.privKey);
  const sigWithdrawOver = signChallenge(challengeWithdrawOver, kp.privKey);
  const sigWithdrawUnder = signChallenge(challengeWithdrawUnder, kp.privKey);

  // ── Contract sources ────────────────────────────────────────────────────
  const here = new URL(".", import.meta.url).pathname;
  const walletSource = fs.readFileSync(
    `${here}contracts/fakfun-wallet-v2.clar`,
    "utf8",
  );
  const webauthnSource = fs.readFileSync(
    `${here}contracts/clarity-webauthn.clar`,
    "utf8",
  );
  const authHelpersV7Source = fs.readFileSync(
    `${here}contracts/smart-wallet-standard-auth-helpers-v7.clar`,
    "utf8",
  );
  const authHelpersV8Source = fs.readFileSync(
    `${here}contracts/smart-wallet-standard-auth-helpers-v8.clar`,
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
  console.error("fakfun-wallet-v2 hash:", v2Hash.toString("hex"));

  // Op-id counters reflect operation-nonce progression:
  //   op-id 0: over-threshold pending (Phase C), executed in D
  //   op-id 1: over-threshold pending (Phase E), vetoed
  //   op-id 2: over-threshold pending (Phase F), cooldown-not-passed
  //   op-id 3: sip010-transfer (sbtc-transfer) pending (Phase G), wrong op-type
  const OP_C_EXECUTE = 0;
  const OP_E_VETO = 1;
  const OP_F_COOLDOWN = 2;
  const OP_G_WRONG_TYPE = 3;

  const builder = SimulationBuilder.new()
    .withSender(DEPLOYER)

    // ── Phase A: refresh on-mainnet contracts to local sources, deploy new v8 ─
    // clarity-webauthn, helpers-v7, fakfun-wallet-v2 are already deployed on
    // mainnet (the existing sims predate that). addContractDeploy now fails
    // with "Duplicate contract"; addSetContractCode overrides the source at
    // the existing contract_id, which is the right tool here.
    .addSetContractCode({
      contract_id: `${DEPLOYER}.clarity-webauthn`,
      source_code: webauthnSource,
      clarity_version: ClarityVersion.Clarity5,
    })
    .addSetContractCode({
      contract_id: `${DEPLOYER}.${HELPERS_V7_NAME}`,
      source_code: authHelpersV7Source,
      clarity_version: ClarityVersion.Clarity5,
    })
    // helpers-v8 is genuinely new -- ordinary deploy.
    .addContractDeploy({
      contract_name: HELPERS_V8_NAME,
      source_code: authHelpersV8Source,
      clarity_version: ClarityVersion.Clarity5,
    })
    // pillar-wallet-trait + game-wager-v2 are already on mainnet too.
    .addSetContractCode({
      contract_id: `${GAME_WAGER_DEPLOYER}.pillar-wallet-trait`,
      source_code: pillarTraitSource,
      clarity_version: ClarityVersion.Clarity5,
    })
    .addSetContractCode({
      contract_id: `${GAME_WAGER_DEPLOYER}.game-wager-v2`,
      source_code: gameWagerV2Source,
      clarity_version: ClarityVersion.Clarity5,
    })
    .addContractCall({
      contract_id: WALLET_CORE,
      function_name: "set-verified-contract",
      function_args: [principalCV(WALLET), someCV(bufferCV(v2Hash))],
      post_condition_mode: PostConditionMode.Allow,
    })
    // Same story for the wallet itself: it's already on mainnet (the old
    // 2139-line version without sBTC withdrawal). Use SetContractCode to
    // install the new 2331-line source at the same principal so onboard()'s
    // hardcoded 'SPV9K....fakfun-wallet-v2 reference resolves to our code.
    .addSetContractCode({
      contract_id: WALLET,
      source_code: walletSource,
      clarity_version: ClarityVersion.Clarity5,
    })
    // Sanity: confirm v8 builds the same hash JS computes for the over-threshold
    // intent. If the two diverge, every signed-path test below would fail with
    // u4002; emitting it as an eval surfaces the mismatch directly.
    .addEvalCode(
      `${DEPLOYER}.${HELPERS_V8_NAME}`,
      `(build-sbtc-withdrawal-hash { auth-id: u${AUTH_ID_WITHDRAW_OVER}, amount: u${OVER_AMOUNT}, recipient: { version: 0x${P2WPKH_VERSION}, hashbytes: 0x${RECIPIENT_HASHBYTES.toString("hex")} }, max-fee: u${OVER_MAX_FEE} })`,
    )

    .withSender(FAKFUN_DEPLOYER)
    .addContractCall({
      contract_id: WALLET,
      function_name: "onboard",
      function_args: [pubkeyBuff],
      post_condition_mode: PostConditionMode.Allow,
    })

    // 3-step admin init (propose -> accept -> advance cooldown -> confirm)
    .withSender(USER)
    .addContractCall({
      contract_id: WALLET,
      function_name: "propose-admin-with-signature",
      function_args: [
        principalCV(USER),
        sigAuthTuple(AUTH_ID_PROPOSE, sigPropose, pubKeyHex),
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
        sigAuthTuple(AUTH_ID_CONFIRM, sigConfirm, pubKeyHex),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // Fund the wallet with sBTC. USER holds sBTC on mainnet; fork should resolve.
    .addContractCall({
      contract_id: SBTC_TOKEN,
      function_name: "transfer",
      function_args: [
        uintCV(FUND_SBTC_SATS),
        principalCV(USER),
        contractPrincipalCV(DEPLOYER, WALLET_NAME),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(
      SBTC_TOKEN,
      `(get-balance '${WALLET})`,
    )

    // ── Phase C: over-threshold signed sbtc-initiate-withdrawal -> pending ─
    // amount(200k) + max-fee(1k) = 201k > 100k default threshold.
    // Signed path -- exercises is-authorized(some {...}) on the new v8 hash.
    .addContractCall({
      contract_id: WALLET,
      function_name: "sbtc-initiate-withdrawal",
      function_args: [
        uintCV(OVER_AMOUNT),
        recipientTupleCV(P2WPKH_VERSION, RECIPIENT_HASHBYTES),
        uintCV(OVER_MAX_FEE),
        someCV(sigAuthTuple(AUTH_ID_WITHDRAW_OVER, sigWithdrawOver, pubKeyHex)),
        noneCV(), // gas
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    // Phase C verifies:
    //   - pending op shape: op-type = "sbtc-withdraw" (NOT "sbtc-withdrawal" --
    //     that's the SIP-018 topic), amount = OVER_AMOUNT (not +max-fee),
    //     token = (some SBTC-CONTRACT), recipient = WALLET (placeholder),
    //     payload non-none.
    //   - operation-nonce bumped from 0 to 1.
    //   - sBTC balance unchanged (no immediate transfer).
    .addEvalCode(WALLET, `(get-pending-operation u${OP_C_EXECUTE})`)
    .addEvalCode(WALLET, "(var-get operation-nonce)")
    .addEvalCode(SBTC_TOKEN, `(get-balance '${WALLET})`)
    .addEvalCode(WALLET, "(var-get spent-this-period)")

    // ── Phase D: advance past cooldown then execute pending op 0 ──────────
    .addAdvanceBlocks({ bitcoin_blocks: 150, stacks_blocks_per_bitcoin: 1 })
    .withSender(USER) // admin
    .addContractCall({
      contract_id: WALLET,
      function_name: "execute-pending-sbtc-withdrawal",
      function_args: [uintCV(OP_C_EXECUTE)],
      post_condition_mode: PostConditionMode.Allow,
    })
    // Phase D verifies:
    //   - op marked executed (eval map-get? after).
    //   - sbtc-token balance dropped by (OVER_AMOUNT + OVER_MAX_FEE) = 201_000.
    //   - sbtc-token-locked balance rose by 201_000.
    //   - bridge create-withdrawal-request print event observable.
    .addEvalCode(WALLET, `(get-pending-operation u${OP_C_EXECUTE})`)
    .addEvalCode(SBTC_TOKEN, `(get-balance-available '${WALLET})`)
    .addEvalCode(SBTC_TOKEN, `(get-balance-locked '${WALLET})`)

    // ── Phase E: veto blocks execute ──────────────────────────────────────
    // Create another over-threshold pending op (admin path, no sig).
    .addContractCall({
      contract_id: WALLET,
      function_name: "sbtc-initiate-withdrawal",
      function_args: [
        uintCV(OVER_AMOUNT),
        recipientTupleCV(P2WPKH_VERSION, RECIPIENT_HASHBYTES),
        uintCV(OVER_MAX_FEE),
        noneCV(), // admin path
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(WALLET, `(get-pending-operation u${OP_E_VETO})`)
    // Veto it (admin path).
    .addContractCall({
      contract_id: WALLET,
      function_name: "veto-operation",
      function_args: [
        uintCV(OP_E_VETO),
        noneCV(), // sig-auth
        noneCV(), // gas
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addAdvanceBlocks({ bitcoin_blocks: 150, stacks_blocks_per_bitcoin: 1 })
    .addContractCall({
      contract_id: WALLET,
      function_name: "execute-pending-sbtc-withdrawal",
      function_args: [uintCV(OP_E_VETO)],
      post_condition_mode: PostConditionMode.Allow,
    })
    // Phase E expects err-vetoed (u4015) on the execute.

    // ── Phase F: cooldown not passed ──────────────────────────────────────
    .addContractCall({
      contract_id: WALLET,
      function_name: "sbtc-initiate-withdrawal",
      function_args: [
        uintCV(OVER_AMOUNT),
        recipientTupleCV(P2WPKH_VERSION, RECIPIENT_HASHBYTES),
        uintCV(OVER_MAX_FEE),
        noneCV(),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addContractCall({
      contract_id: WALLET,
      function_name: "execute-pending-sbtc-withdrawal",
      function_args: [uintCV(OP_F_COOLDOWN)],
      post_condition_mode: PostConditionMode.Allow,
    })
    // Phase F expects err-cooldown-not-passed (u4017).

    // ── Phase G: wrong op-type ────────────────────────────────────────────
    // Create a sip010-transfer (sBTC) pending op. amount > sbtc-threshold so
    // it parks; op-type will be "sbtc-transfer", NOT "sbtc-withdraw".
    .addContractCall({
      contract_id: WALLET,
      function_name: "sip010-transfer",
      function_args: [
        uintCV(OVER_AMOUNT),
        principalCV(USER),
        noneCV(), // memo
        contractPrincipalCV(
          "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4",
          "sbtc-token",
        ),
        stringAsciiCV("sbtc-token"),
        noneCV(), // admin
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(WALLET, `(get-pending-operation u${OP_G_WRONG_TYPE})`)
    // Try executing it as a withdrawal -- should err-invalid-operation (u4013).
    .addContractCall({
      contract_id: WALLET,
      function_name: "execute-pending-sbtc-withdrawal",
      function_args: [uintCV(OP_G_WRONG_TYPE)],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Phase A: under-threshold signed sbtc-initiate-withdrawal ──────────
    // 30_000 + 1_000 = 31_000 sats. After D drained 201_000 sats, the wallet
    // still has 1_000_000 - 201_000 = 799_000. spent-this-period.sbtc has only
    // been touched by under-threshold immediate paths (none yet -- C/E/F/G all
    // parked or vetoed), so it's still 0.
    .addContractCall({
      contract_id: WALLET,
      function_name: "sbtc-initiate-withdrawal",
      function_args: [
        uintCV(UNDER_AMOUNT),
        recipientTupleCV(P2WPKH_VERSION, RECIPIENT_HASHBYTES),
        uintCV(UNDER_MAX_FEE),
        someCV(sigAuthTuple(AUTH_ID_WITHDRAW_UNDER, sigWithdrawUnder, pubKeyHex)),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    // Phase A verifies:
    //   - sBTC balance dropped by 31_000 (now 799_000 - 31_000 = 768_000).
    //   - sbtc-token-locked rose by 31_000.
    //   - spend-this-period.sbtc bumped to 31_000.
    //   - bridge create-withdrawal-request print event w/ version 0x04.
    .addEvalCode(SBTC_TOKEN, `(get-balance-available '${WALLET})`)
    .addEvalCode(SBTC_TOKEN, `(get-balance-locked '${WALLET})`)
    .addEvalCode(WALLET, "(var-get spent-this-period)")

    // ── Phase B: under-threshold admin sbtc-initiate-withdrawal ───────────
    // No sig. After A, spent.sbtc = 31_000; 31_000 + (30k+1k) = 62_000 < 100k.
    .addContractCall({
      contract_id: WALLET,
      function_name: "sbtc-initiate-withdrawal",
      function_args: [
        uintCV(UNDER_AMOUNT),
        recipientTupleCV(P2WPKH_VERSION, RECIPIENT_HASHBYTES),
        uintCV(UNDER_MAX_FEE),
        noneCV(),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })
    .addEvalCode(SBTC_TOKEN, `(get-balance-available '${WALLET})`)
    .addEvalCode(SBTC_TOKEN, `(get-balance-locked '${WALLET})`)
    .addEvalCode(WALLET, "(var-get spent-this-period)")

    // ── Phase H: malformed recipient version 0x07 -> bridge aborts ────────
    // Admin path; amount + fee well under threshold so it would otherwise hit
    // the inline-execute branch. The bridge's ERR_INVALID_ADDR_VERSION should
    // propagate and revert the entire tx (no balance / nonce change).
    .addContractCall({
      contract_id: WALLET,
      function_name: "sbtc-initiate-withdrawal",
      function_args: [
        uintCV(UNDER_AMOUNT),
        recipientTupleCV(INVALID_VERSION, RECIPIENT_HASHBYTES),
        uintCV(UNDER_MAX_FEE),
        noneCV(),
        noneCV(),
      ],
      post_condition_mode: PostConditionMode.Allow,
    })

    // ── Final state ───────────────────────────────────────────────────────
    .addEvalCode(WALLET, "(var-get operation-nonce)") // expect u4 (ops 0..3 created)
    .addEvalCode(WALLET, `(get-pending-operation u${OP_C_EXECUTE})`)
    .addEvalCode(WALLET, `(get-pending-operation u${OP_E_VETO})`)
    .addEvalCode(WALLET, `(get-pending-operation u${OP_F_COOLDOWN})`)
    .addEvalCode(WALLET, `(get-pending-operation u${OP_G_WRONG_TYPE})`)
    .addEvalCode(WALLET, "(var-get spent-this-period)")
    .addEvalCode(SBTC_TOKEN, `(get-balance-available '${WALLET})`)
    .addEvalCode(SBTC_TOKEN, `(get-balance-locked '${WALLET})`);

  await builder.run();
}

runSimulation().catch((e) => {
  console.error(e);
  process.exit(1);
});
