// simul-jing-mm-safe.js
// Stxer mainnet-fork simulation for the DEPLOYED jing-mm-safe canonical
// (SPV9K21....jing-mm-safe) and its DEPLOYED helper
// (SPV9K21....mm-safe-auth-helpers-v1), exercising the exact on-chain bytes
// against the LIVE rfq-sbtc-stx-jing market.
//
// Coverage:
//   A  set-verified + fund + onboard (owner, recovery, thresholds)
//   B  stx-transfer under thr, admin path
//   C  stx-transfer under thr, PASSKEY path (rp jingswap.com)
//   RFQ desk:
//     R1 set-rfq-operator by non-admin -> u4001
//     R2 set-rfq-operator by admin -> ok
//     R3 fix-rfq by random -> u4001
//     R4 client opens RFQ on LIVE market (sBTC escrow)
//     R5 OPERATOR fix-rfq (live Hermes VAAs, client sig names the SAFE as
//        winner) -> ok; safe recorded as winner
//     R6 OPERATOR fulfill-rfq -> ok stx-out; safe receives the escrowed sBTC
//   2FA execute-now matrix (passkey lifts cooldown, admin-created ops only):
//     N1 admin OVER-thr stx -> pending op; plain exec immediately -> u4017
//     N2 execute-pending-stx-transfer-now (PASSKEY) -> ok IMMEDIATELY
//     N3 passkey OVER-thr stx -> pending op; execute-now -> u4003 (1 factor)
//     N4 admin OVER-thr stx -> pending; veto (PASSKEY); execute-now -> u4015
//     N5 admin OVER-thr sBTC -> pending; execute-pending-sbtc-transfer-now -> ok
//     N6 admin OVER-thr withdrawal -> pending; execute-...-withdrawal-now -> ok
//     N7 execute-now with sig under example.com (not whitelisted) -> u4002
//     N8 token-lock enabled -> execute-now with VALID sig -> u4023; disable
//     N9 (post-advance) plain exec of the passkey-created op after cooldown -> ok
//   H  2FA wallet transfer escape still works
//
// Fresh-Pyth rule: every fix-price-dependent step runs BEFORE addAdvanceBlocks.
// Run: node simul-jing-mm-safe.js
import crypto from "node:crypto";
import {
  tupleCV,
  uintCV,
  bufferCV,
  noneCV,
  someCV,
  trueCV,
  falseCV,
  principalCV,
  standardPrincipalCV,
  contractPrincipalCV,
  stringAsciiCV,
  serializeCV,
  deserializeCV,
  cvToString,
  PostConditionMode,
  signMessageHashRsv,
  publicKeyFromSignatureRsv,
  getAddressFromPublicKey,
} from "@stacks/transactions";
import { SimulationBuilder, getSimulationResult } from "stxer";
import {
  generateP256Keypair,
  signChallengeWithRpId,
} from "./lib-webauthn-test-signer.mjs";

// -- actors -----------------------------------------------------------------
const DEPLOYER = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const OWNER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2"; // admin; also the sBTC whale
const RECOVERY = "SP3HXJJMJQ06GNAZ8XWDN1QM48JEDC6PP6W3YZPZJ";
const NEW_OWNER = "SP1MGH8BH1KRY49Z7EE5TY0JVKT6C3NT9RTVM8FND";
const RECIPIENT = "SP22WH53NS94VR6N145ZX77BK4S0EWFBE41VW3Z6B";
const RELAYER = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM"; // broadcasts passkey txs
const OPERATOR = RELAYER; // rfq desk hot key (any principal works; seat is what matters)
const STX_WHALE = "SP9BP4PN74CNR5XT7CMAMBPA0GWC9HMB69HVVV51";
let CLIENT; // derived in main() from the client signature's on-chain recovery

// client = synthetic key we control, so it can SIGN the RFQ quote. CLIENT is
// derived from the signature's own recovery (see main) so it is EXACTLY the
// principal the contract's secp256k1-recover? yields on-chain.
const CLIENT_PRIVKEY = "1111111111111111111111111111111111111111111111111111111111111101";

// -- deployed contracts (used DIRECTLY, no local deploys) ---------------------
const WALLET = `${DEPLOYER}.jing-mm-safe`;
const WALLET_CORE = `${DEPLOYER}.fakfun-wallet-core`;
const HELPER = `${DEPLOYER}.mm-safe-auth-helpers-v1`;
const RFQ = `${DEPLOYER}.rfq-sbtc-stx-jing`;
const SBTC_TOKEN = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const PYTH_STORAGE = "SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y.pyth-storage-v4";
const PYTH_DECODER = "SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y.pyth-pnau-decoder-v3";
const WORMHOLE_CORE = "SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y.wormhole-core-v4";

const STACKS_NODE_API = "http://77.42.3.101/stacks-api";

const RP_ID = "jingswap.com"; // MM safes live on jing
const RP_WRONG = "example.com";

// -- amounts ------------------------------------------------------------------
const STX_THRESHOLD = 100_000_000;
const SBTC_THRESHOLD = 100_000;
const STX_UNDER = 10_000_000;
const STX_OVER = 150_000_000;
const SBTC_OVER = 150_000;
const WD_AMOUNT = 120_000;
const WD_MAXFEE = 1_000;
const SBTC_IN = 200_000n; // rfq escrow (0.002 BTC)
const MAX_PREMIUM_BPS = 200;
const AUTH_BIG = 99_999_999_999;

// -- SIP-018 (wallet passkey topics; mirrors helpers-v7 + mm-safe-auth-helpers-v1)
const SIP018_PREFIX = Buffer.from("534950303138", "hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const cvSha256 = (cv) => {
  const out = serializeCV(cv);
  return typeof out === "string" ? sha256(Buffer.from(out, "hex")) : sha256(Buffer.from(out));
};
function walletDomainHash() {
  return cvSha256(tupleCV({
    name: stringAsciiCV("smart-wallet-standard"),
    version: stringAsciiCV("1.0.0"),
    "chain-id": uintCV(1),
    wallet: principalCV(WALLET),
  }));
}
function buildChallenge(topicTuple) {
  return sha256(Buffer.concat([SIP018_PREFIX, walletDomainHash(), cvSha256(topicTuple)]));
}
const tStxTransfer = (authId, amount, recipient) =>
  tupleCV({
    topic: stringAsciiCV("stx-transfer"),
    "auth-id": uintCV(authId),
    amount: uintCV(amount),
    recipient: standardPrincipalCV(recipient),
    memo: noneCV(),
  });
const tExecuteNow = (authId, opId) =>
  tupleCV({
    topic: stringAsciiCV("execute-now"),
    "auth-id": uintCV(authId),
    "op-id": uintCV(opId),
  });
const tVeto = (authId, opId) =>
  tupleCV({
    topic: stringAsciiCV("veto-operation"),
    "auth-id": uintCV(authId),
    "op-id": uintCV(opId),
  });
const tConfirmTransfer = (authId, newAdmin) =>
  tupleCV({
    topic: stringAsciiCV("confirm-transfer"),
    "auth-id": uintCV(authId),
    "new-admin": standardPrincipalCV(newAdmin),
  });

const strip = (h) => (h.startsWith("0x") ? h.slice(2) : h);
function sigAuthTuple(authId, pubKeyHex, signed) {
  return tupleCV({
    "auth-id": uintCV(authId),
    pubkey: bufferCV(Buffer.from(strip(pubKeyHex), "hex")),
    signature: bufferCV(Buffer.from(strip(signed.signatureHex), "hex")),
    "authenticator-data": bufferCV(Buffer.from(strip(signed.authenticatorDataHex), "hex")),
    "client-data-prefix": bufferCV(Buffer.from(strip(signed.clientDataPrefixHex), "hex")),
    "client-data-suffix": bufferCV(Buffer.from(strip(signed.clientDataSuffixHex), "hex")),
  });
}

// -- RFQ client auth (mirrors rfq-sbtc-stx-jing build-auth-hash) --------------
function rfqDomainHash() {
  return cvSha256(tupleCV({
    "chain-id": uintCV(1),
    name: stringAsciiCV("jing-rfq"),
    version: stringAsciiCV("1"),
  }));
}
function buildRfqAuthHashHex(d) {
  const details = tupleCV({
    expiry: uintCV(d.authExpiry),
    market: principalCV(RFQ),
    "max-premium-bps": uintCV(d.maxPremiumBps),
    "rfq-id": uintCV(d.rfqId),
    winner: principalCV(WALLET), // the SAFE is the winner
  });
  return sha256(Buffer.concat([SIP018_PREFIX, rfqDomainHash(), cvSha256(details)])).toString("hex");
}

// -- live Pyth VAAs ------------------------------------------------------------
const BTC_USD_FEED = "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
const STX_USD_FEED = "ec7a775f46379b5e943c3526b1c8d54cd49749176b0b98e02dde68d1bd335c17";
async function fetchPyth(feedHex) {
  const ts = Math.floor(Date.now() / 1000) - 30;
  const url = `https://hermes.pyth.network/v2/updates/price/${ts}?ids[]=${feedHex}`;
  const r = await fetch(url, { headers: { accept: "application/json" } });
  const d = await r.json();
  const bin = d.binary?.data?.[0];
  const p = d.parsed?.[0]?.price;
  if (!bin || !p) throw new Error(`No Pyth data for ${feedHex.slice(0, 8)}...`);
  return { vaa: bin, price: BigInt(p.price) };
}

async function main() {
  const key = generateP256Keypair();
  const pubkeyCV = bufferCV(key.pubKey);
  const sign = (challenge, rp = RP_ID) => signChallengeWithRpId(challenge, key.privKey, rp);

  // live prices -> committed-out for the RFQ
  const btc = await fetchPyth(BTC_USD_FEED);
  const stx = await fetchPyth(STX_USD_FEED);
  const cross = (btc.price * 100_000_000n) / stx.price;
  const mid = (SBTC_IN * cross) / 10_000_000_000n; // uSTX gross for SBTC_IN
  const committed = mid;
  const minOut = mid / 2n;
  console.log(`Pyth: btc=${btc.price} stx=${stx.price} mid=${mid} uSTX for ${SBTC_IN} sats`);

  // client quote signature (names the SAFE as winner, rfq id 0 assumed fresh fork)
  // NOTE: rfq ids on the LIVE market keep counting; read next-rfq-id at build
  // time is impossible pre-sim, so we sign for a RANGE of plausible ids and
  // pick at call time -- simpler: fetch next id from the live market NOW.
  const nid = await (async () => {
    const r = await fetch(`${STACKS_NODE_API}/v2/contracts/call-read/${DEPLOYER}/rfq-sbtc-stx-jing/get-next-rfq-id`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sender: DEPLOYER, arguments: [] }),
    }).then((x) => x.json());
    const cv = deserializeCV(r.result);
    return BigInt(cvToString(cv).replace(/^\(?u/, "").replace(/\)?$/, ""));
  })().catch(() => 0n);
  const RFQ_ID = Number(nid);
  console.log(`Live market next-rfq-id: ${RFQ_ID}`);

  const authHash = buildRfqAuthHashHex({ rfqId: RFQ_ID, maxPremiumBps: MAX_PREMIUM_BPS, authExpiry: AUTH_BIG });
  const clientSigRaw = signMessageHashRsv({ messageHash: authHash, privateKey: CLIENT_PRIVKEY });
  const clientSig = typeof clientSigRaw === "string" ? clientSigRaw : clientSigRaw.data;
  // The RFQ contract recovers the signer with secp256k1-recover? (compressed
  // pubkey) and requires it to equal the RFQ's client. Derive CLIENT that same
  // way so open-rfq stores exactly the recovered principal.
  CLIENT = getAddressFromPublicKey(
    publicKeyFromSignatureRsv(authHash, strip(clientSig)),
    "mainnet",
  );
  console.log(`CLIENT (recovered): ${CLIENT}`);

  // pending-op ids: the fresh canonical starts operation-nonce at 0
  // op0 admin stx | op1 passkey stx | op2 admin stx (vetoed) | op3 sbtc | op4 wd | op5 wrong-domain/lock tests
  const sigUnder = sign(buildChallenge(tStxTransfer(1, STX_UNDER, RECIPIENT)));
  const sigOver = sign(buildChallenge(tStxTransfer(11, STX_OVER, RECIPIENT))); // creates op1 (passkey-created)
  const sigNow0 = sign(buildChallenge(tExecuteNow(10, 0)));
  const sigNow1 = sign(buildChallenge(tExecuteNow(12, 1)));
  const sigVeto2 = sign(buildChallenge(tVeto(13, 2)));
  const sigNow2 = sign(buildChallenge(tExecuteNow(14, 2)));
  const sigNow3 = sign(buildChallenge(tExecuteNow(15, 3)));
  const sigNow4 = sign(buildChallenge(tExecuteNow(16, 4)));
  const sigNow5Wrong = sign(buildChallenge(tExecuteNow(17, 5)), RP_WRONG);
  const sigNow5Lock = sign(buildChallenge(tExecuteNow(18, 5)));
  const sigXfer = sign(buildChallenge(tConfirmTransfer(19, NEW_OWNER)));

  const plan = [];
  const b = SimulationBuilder.new({ stacksNodeAPI: STACKS_NODE_API });
  const evalc = (label, code, capture, at = WALLET) => {
    b.addEvalCode(at, code);
    plan.push({ kind: "eval", label, capture });
  };
  const call = (label, sender, cid, fn, args, expect, capture) => {
    b.withSender(sender).addContractCall({
      contract_id: cid, function_name: fn, function_args: args,
      post_condition_mode: PostConditionMode.Allow,
    });
    plan.push({ kind: "tx", label, expect, capture });
  };
  const okre = /^\(ok/;

  // -- A: verify + fund + onboard the DEPLOYED canonical ----------------------
  call("set-verified-contract(jing-mm-safe)", DEPLOYER, WALLET_CORE,
    "set-verified-contract", [principalCV(WALLET), noneCV()], okre);
  b.withSender(STX_WHALE).addSTXTransfer({ recipient: WALLET, amount: 1_500_000_000 });
  plan.push({ kind: "fund", label: "fund wallet 1500 STX (whale)" });
  call("fund wallet 500k sats sBTC", OWNER, SBTC_TOKEN, "transfer",
    [uintCV(500_000), standardPrincipalCV(OWNER), principalCV(WALLET), noneCV()], okre);
  call("fund CLIENT 300k sats sBTC", OWNER, SBTC_TOKEN, "transfer",
    [uintCV(300_000), standardPrincipalCV(OWNER), standardPrincipalCV(CLIENT), noneCV()], okre);
  call("onboard(pubkey, OWNER, some(RECOVERY), thresholds)", FAKFUN_DEPLOYER, WALLET,
    "onboard",
    [pubkeyCV, standardPrincipalCV(OWNER), someCV(standardPrincipalCV(RECOVERY)),
     uintCV(STX_THRESHOLD), uintCV(SBTC_THRESHOLD)],
    okre);
  evalc("owner == OWNER", "(get-owner)", "owner0");

  // -- B/C: basic transfer regression ------------------------------------------
  call("stx-transfer under thr (admin)", OWNER, WALLET,
    "stx-transfer", [uintCV(STX_UNDER), standardPrincipalCV(RECIPIENT), noneCV(), noneCV(), noneCV()],
    okre);
  call("stx-transfer under thr (PASSKEY rp=jingswap.com)", RELAYER, WALLET,
    "stx-transfer", [uintCV(STX_UNDER), standardPrincipalCV(RECIPIENT), noneCV(),
      someCV(sigAuthTuple(1, key.pubKeyHex, sigUnder)), noneCV()],
    okre);

  // -- RFQ desk (all fresh-Pyth steps PRE-advance) ------------------------------
  call("set-rfq-operator by non-admin -> u4001", NEW_OWNER, WALLET,
    "set-rfq-operator", [standardPrincipalCV(OPERATOR)], "(err u4001)");
  call("set-rfq-operator by admin -> ok", OWNER, WALLET,
    "set-rfq-operator", [standardPrincipalCV(OPERATOR)], okre);
  evalc("rfq-operator seated", "(get-rfq-operator)", "rfqop");
  call("fix-rfq by random -> u4001", NEW_OWNER, WALLET,
    "fix-rfq",
    [uintCV(RFQ_ID), uintCV(Number(committed)), uintCV(MAX_PREMIUM_BPS), uintCV(AUTH_BIG),
     bufferCV(Buffer.from(strip(clientSig), "hex")),
     bufferCV(Buffer.from(btc.vaa, "hex")), bufferCV(Buffer.from(stx.vaa, "hex")),
     contractPrincipalCV("SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y", "pyth-storage-v4"),
     contractPrincipalCV("SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y", "pyth-pnau-decoder-v3"),
     contractPrincipalCV("SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y", "wormhole-core-v4")],
    "(err u4001)");

  evalc("client sBTC before", `(contract-call? '${SBTC_TOKEN} get-balance '${CLIENT})`, "c_sbtc_0");
  evalc("client STX before", `(stx-get-balance '${CLIENT})`, "c_stx_0");
  evalc("wallet sBTC before", `(contract-call? '${SBTC_TOKEN} get-balance '${WALLET})`, "w_sbtc_0");
  evalc("wallet STX before", `(stx-get-balance '${WALLET})`, "w_stx_0");

  call(`open-rfq (CLIENT escrows ${SBTC_IN} sats) -> (ok u${RFQ_ID})`, CLIENT, RFQ,
    "open-rfq",
    [uintCV(Number(SBTC_IN)), uintCV(Number(minOut)),
     contractPrincipalCV("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token"),
     stringAsciiCV("sbtc-token")],
    `(ok u${RFQ_ID})`);

  call("fix-rfq by OPERATOR -> ok (safe becomes winner)", OPERATOR, WALLET,
    "fix-rfq",
    [uintCV(RFQ_ID), uintCV(Number(committed)), uintCV(MAX_PREMIUM_BPS), uintCV(AUTH_BIG),
     bufferCV(Buffer.from(strip(clientSig), "hex")),
     bufferCV(Buffer.from(btc.vaa, "hex")), bufferCV(Buffer.from(stx.vaa, "hex")),
     contractPrincipalCV("SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y", "pyth-storage-v4"),
     contractPrincipalCV("SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y", "pyth-pnau-decoder-v3"),
     contractPrincipalCV("SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y", "wormhole-core-v4")],
    okre);

  call("fulfill-rfq by OPERATOR -> ok stx-out", OPERATOR, WALLET,
    "fulfill-rfq",
    [uintCV(RFQ_ID),
     contractPrincipalCV("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token"),
     stringAsciiCV("sbtc-token")],
    okre);

  evalc("client sBTC after", `(contract-call? '${SBTC_TOKEN} get-balance '${CLIENT})`, "c_sbtc_1");
  evalc("client STX after", `(stx-get-balance '${CLIENT})`, "c_stx_1");
  evalc("wallet sBTC after", `(contract-call? '${SBTC_TOKEN} get-balance '${WALLET})`, "w_sbtc_1");
  evalc("wallet STX after", `(stx-get-balance '${WALLET})`, "w_stx_1");

  // -- 2FA execute-now matrix ----------------------------------------------------
  // N1: admin creates op0; cooldown blocks plain exec
  call("N1a admin OVER thr -> pending op0", OWNER, WALLET,
    "stx-transfer", [uintCV(STX_OVER), standardPrincipalCV(RECIPIENT), noneCV(), noneCV(), noneCV()],
    okre);
  call("N1b plain exec op0 immediately -> u4017", OWNER, WALLET,
    "execute-pending-stx-transfer", [uintCV(0), noneCV()], "(err u4017)");
  // N2: passkey executes NOW
  call("N2 execute-now op0 (PASSKEY) -> ok IMMEDIATELY", RELAYER, WALLET,
    "execute-pending-stx-transfer-now",
    [uintCV(0), noneCV(), sigAuthTuple(10, key.pubKeyHex, sigNow0), noneCV()],
    okre);
  // N3: passkey-created op cannot be fast-tracked
  call("N3a PASSKEY OVER thr -> pending op1 (passkey-created)", RELAYER, WALLET,
    "stx-transfer", [uintCV(STX_OVER), standardPrincipalCV(RECIPIENT), noneCV(),
      someCV(sigAuthTuple(11, key.pubKeyHex, sigOver)), noneCV()],
    okre);
  call("N3b execute-now op1 -> u4003 (one factor twice)", RELAYER, WALLET,
    "execute-pending-stx-transfer-now",
    [uintCV(1), noneCV(), sigAuthTuple(12, key.pubKeyHex, sigNow1), noneCV()],
    "(err u4003)");
  // N4: vetoed op cannot be fast-tracked
  call("N4a admin OVER thr -> pending op2", OWNER, WALLET,
    "stx-transfer", [uintCV(STX_OVER), standardPrincipalCV(RECIPIENT), noneCV(), noneCV(), noneCV()],
    okre);
  call("N4b veto op2 (PASSKEY)", RELAYER, WALLET,
    "veto-operation", [uintCV(2), someCV(sigAuthTuple(13, key.pubKeyHex, sigVeto2)), noneCV()],
    okre);
  call("N4c execute-now op2 -> u4015 (vetoed)", RELAYER, WALLET,
    "execute-pending-stx-transfer-now",
    [uintCV(2), noneCV(), sigAuthTuple(14, key.pubKeyHex, sigNow2), noneCV()],
    "(err u4015)");
  // N5: sBTC transfer fast path
  call("N5a admin sBTC OVER thr -> pending op3", OWNER, WALLET,
    "sip010-transfer",
    [uintCV(SBTC_OVER), standardPrincipalCV(RECIPIENT), noneCV(),
     contractPrincipalCV("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token"),
     stringAsciiCV("sbtc-token"), noneCV(), noneCV()],
    okre);
  call("N5b execute-sbtc-now op3 (PASSKEY) -> ok", RELAYER, WALLET,
    "execute-pending-sbtc-transfer-now",
    [uintCV(3), noneCV(), sigAuthTuple(15, key.pubKeyHex, sigNow3), noneCV()],
    okre);
  // N6: withdrawal fast path
  const WD_RECIP = tupleCV({
    version: bufferCV(Buffer.from([0x06])),
    hashbytes: bufferCV(Buffer.alloc(32, 0x11)),
  });
  call("N6a admin withdrawal OVER thr -> pending op4", OWNER, WALLET,
    "sbtc-initiate-withdrawal",
    [uintCV(WD_AMOUNT), WD_RECIP, uintCV(WD_MAXFEE), noneCV(), noneCV()],
    okre);
  call("N6b execute-withdrawal-now op4 (PASSKEY) -> ok", RELAYER, WALLET,
    "execute-pending-sbtc-withdrawal-now",
    [uintCV(4), sigAuthTuple(16, key.pubKeyHex, sigNow4), noneCV()],
    okre);
  // N7/N8: wrong domain + token-lock, on op5
  call("N7a admin OVER thr -> pending op5", OWNER, WALLET,
    "stx-transfer", [uintCV(STX_OVER), standardPrincipalCV(RECIPIENT), noneCV(), noneCV(), noneCV()],
    okre);
  call("N7b execute-now op5 with example.com sig -> u4002", RELAYER, WALLET,
    "execute-pending-stx-transfer-now",
    [uintCV(5), noneCV(), sigAuthTuple(17, key.pubKeyHex, sigNow5Wrong), noneCV()],
    "(err u4002)");
  call("N8a enable token-lock (admin)", OWNER, WALLET,
    "toggle-token-lock", [trueCV(), noneCV(), noneCV()], okre);
  call("N8b execute-now op5 valid sig but LOCKED -> u4023", RELAYER, WALLET,
    "execute-pending-stx-transfer-now",
    [uintCV(5), noneCV(), sigAuthTuple(18, key.pubKeyHex, sigNow5Lock), noneCV()],
    "(err u4023)");
  call("N8c disable token-lock (admin)", OWNER, WALLET,
    "toggle-token-lock", [falseCV(), noneCV(), noneCV()], okre);

  // -- N9: cooldown path still works for the passkey-created op1 -----------------
  b.addAdvanceBlocks({ bitcoin_blocks: 145, stacks_blocks_per_bitcoin: 1 });
  plan.push({ kind: "advance", label: "advance 145 blocks (config cooldown)" });
  call("N9 plain exec op1 (passkey-created) after cooldown -> ok", OWNER, WALLET,
    "execute-pending-stx-transfer", [uintCV(1), noneCV()], okre);

  // -- H: 2FA transfer escape ------------------------------------------------------
  call("propose-transfer-wallet(NEW_OWNER) (admin)", OWNER, WALLET,
    "propose-transfer-wallet", [standardPrincipalCV(NEW_OWNER)], okre);
  call("confirm-transfer-wallet (PASSKEY) -> owner flips", RELAYER, WALLET,
    "confirm-transfer-wallet",
    [sigAuthTuple(19, key.pubKeyHex, sigXfer), noneCV()], okre);
  evalc("owner == NEW_OWNER", "(get-owner)", "owner1");

  // -- run + verify ------------------------------------------------------------------
  console.log("=== jing-mm-safe (DEPLOYED) - stxer harness ===\n");
  const sessionId = await b.run();
  const url = `https://stxer.xyz/simulations/mainnet/${sessionId}`;
  console.log(`Submitted: ${url}\n`);
  const res = await getSimulationResult(sessionId);

  const decTx = (s) => {
    const r = s?.Result?.Transaction;
    if (!r) return "<none>";
    if ("Err" in r) return `ENGINE-ERR: ${JSON.stringify(r.Err).slice(0, 200)}`;
    try { return cvToString(deserializeCV(r.Ok.result)); }
    catch (e) { return `dec-fail: ${e.message}`; }
  };
  const decEval = (s) => {
    const r = s?.Result?.Eval;
    if (!r || !("Ok" in r)) return `<eval:${JSON.stringify(r?.Err ?? "?").slice(0, 120)}>`;
    try { return cvToString(deserializeCV(r.Ok)); } catch { return r.Ok; }
  };
  const uintFrom = (s) => BigInt((String(s).match(/u(\d+)/) || [])[1] ?? "0");

  let pass = 0, fail = 0;
  const cap = {};
  res.steps.forEach((s, i) => {
    const p = plan[i];
    if (!p) return;
    if (p.kind === "fund" || p.kind === "advance") {
      const ok = !("Err" in (s?.Result?.Transaction || {}));
      console.log(`${ok ? "OK " : "WARN"} [${i}] ${p.label}`);
      return;
    }
    if (p.kind === "eval") {
      const v = decEval(s);
      if (p.capture) cap[p.capture] = v;
      console.log(`INFO [${i}] ${p.label}: ${String(v).slice(0, 140)}`);
      return;
    }
    const d = decTx(s);
    if (p.capture) cap[p.capture] = d;
    const ok = p.expect == null ? true
      : typeof p.expect === "function" ? p.expect(d)
      : p.expect instanceof RegExp ? p.expect.test(d)
      : d === p.expect;
    console.log(`${ok ? "PASS" : "FAIL"} [${i}] ${p.label}\n        got ${d.slice(0, 160)}`);
    ok ? pass++ : fail++;
  });

  console.log("\n--- state checks ---");
  const chk = (l, cond) => { console.log(`${cond ? "PASS" : "FAIL"} ${l}`); cond ? pass++ : fail++; };
  chk("owner set at onboard", String(cap.owner0).includes(OWNER));
  chk("rfq-operator seated", String(cap.rfqop).includes(OPERATOR));
  chk("wallet received the escrowed sBTC (+200k exactly; evals bracket the RFQ leg only)",
    uintFrom(cap.w_sbtc_1) === uintFrom(cap.w_sbtc_0) + SBTC_IN);
  chk("client paid the sBTC escrow (-200k)",
    uintFrom(cap.c_sbtc_0) - uintFrom(cap.c_sbtc_1) === SBTC_IN);
  chk("client received STX (committed minus fee > 0)",
    uintFrom(cap.c_stx_1) > uintFrom(cap.c_stx_0));
  chk("wallet paid STX for the fill",
    uintFrom(cap.w_stx_0) > uintFrom(cap.w_stx_1));
  chk("owner flipped after 2FA transfer", String(cap.owner1).includes(NEW_OWNER));

  console.log(`\n=== ${pass} passed, ${fail} failed ===\nView: ${url}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
