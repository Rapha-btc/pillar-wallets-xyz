// juice-safe-v7-auth.test.ts -- the last four error branches in v6.
//
// Run: npx vitest run tests/juice-safe-v7-auth.test.ts -- --manifest tests/cl-v7/Clarinet.toml
//
// A code-by-code audit of juice-safe-v7.clar found 20 distinct error codes across 79
// assert sites. Sixteen were covered by the other five suites. These are the four
// that were not, and two of them are load-bearing for the 2FA guarantee:
//
//   u4003 err-forbidden          the passkey cannot fast-track an op it queued itself
//   u4006 err-signature-replay   a captured signature cannot be replayed
//   u4004 err-unregistered-pubkey  a foreign passkey is refused
//   u4005 err-not-admin-pubkey     a registered passkey whose principal lost admin
import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";
import crypto from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { generateP256Keypair, signChallengeWithRpId } from "../lib-webauthn-test-signer.mjs";

const D = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
// V7_DEPLOYER lets the coverage harness (tests/cl-v7-cov) deploy the wallet
// locally, since clarinet --coverage only instruments project contracts.
// Unset -- the normal case -- it is the real mainnet deployer.
const WD = process.env.V7_DEPLOYER ?? D;
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const WALLET = `${WD}.juice-safe-v7`;
const CORE = `${D}.fakfun-wallet-core-v2`;
const SBTC_DEPOSIT = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-deposit";
const SBTC_SIGNER = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4";
const JUICE_SIGNER = `${D}.juice-pool-stx-signer`;
const RP_ID = "juiceofbtc.com";
const CHAIN_ID = 2147483648;

const accounts = simnet.getAccounts();
const DEPLOYER = accounts.get("deployer")!;
const OWNER = accounts.get("wallet_1")!;
const RECOVERY = accounts.get("wallet_2")!;
const RANDOM = accounts.get("wallet_3")!;
const RELAYER = accounts.get("wallet_4")!;
const RECIPIENT = accounts.get("wallet_5")!;

const MIN_COOLDOWN = 144;
const STX_THRESHOLD = 100_000_000;
const SBTC_THRESHOLD = 100_000;
const MAX_GAS_CEILING = 10_000;
const GAS_CALLS_PER_PERIOD = 25;
const GAS_FEE = 20;          // zz-gas-station charges this
const E_IN_COOLDOWN = 4012, E_THRESHOLD = 4018, E_TOKEN_LOCKED = 4023;

const SIP018 = Buffer.from("534950303138", "hex");
const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest();
const cvHash = (cv: any) => sha256(Buffer.from(Cl.serialize(cv), "hex"));
const domainHash = () => cvHash(Cl.tuple({
  name: Cl.stringAscii("smart-wallet-standard"), version: Cl.stringAscii("1.0.0"),
  "chain-id": Cl.uint(CHAIN_ID), wallet: Cl.contractPrincipal(WD, "juice-safe-v7"),
}));
const challenge = (t: any) => sha256(Buffer.concat([SIP018, domainHash(), cvHash(t)]));
const key = generateP256Keypair();
const strip = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);
const pubkeyCV = Cl.bufferFromHex(strip(key.pubKeyHex));
const topic = (name: string, fields: Record<string, any>) =>
  Cl.tuple({ topic: Cl.stringAscii(name), ...fields });
function sign(t: any, id: number) {
  const s = signChallengeWithRpId(challenge(t), key.privKey, RP_ID);
  return Cl.tuple({
    "auth-id": Cl.uint(id), pubkey: pubkeyCV,
    signature: Cl.bufferFromHex(strip(s.signatureHex)),
    "authenticator-data": Cl.bufferFromHex(strip(s.authenticatorDataHex)),
    "client-data-prefix": Cl.bufferFromHex(strip(s.clientDataPrefixHex)),
    "client-data-suffix": Cl.bufferFromHex(strip(s.clientDataSuffixHex)),
  });
}

const sbtcCV = Cl.contractPrincipal(SBTC_SIGNER, "sbtc-token");
const nftCV = Cl.contractPrincipal(DEPLOYER, "zz-nft");
const stationCV = Cl.contractPrincipal(DEPLOYER, "zz-gas-station");
const poxAddr = Cl.tuple({ version: Cl.bufferFromHex("00"), hashbytes: Cl.bufferFromHex("00".repeat(20)) });

function onboarded(cooldown = MIN_COOLDOWN) {
  simnet.callPublicFn(CORE, "set-verified-contract",
    [Cl.contractPrincipal(WD, "juice-safe-v7"), Cl.none()], D);
  expect(simnet.callPublicFn(WALLET, "onboard",
    [pubkeyCV, Cl.principal(OWNER), Cl.principal(RECOVERY),
     Cl.uint(STX_THRESHOLD), Cl.uint(SBTC_THRESHOLD), Cl.uint(cooldown)],
    FAKFUN_DEPLOYER).result).toBeOk(Cl.bool(true));
}
const fundSTX = (n = 2_000_000_000) => simnet.transferSTX(n, WALLET, DEPLOYER);
let depositNonce = 0;
function fundSBTC(to = WALLET, amount = 5_000_000) {
  const h = simnet.burnBlockHeight - 1;
  const hash = Cl.prettyPrint(simnet.callReadOnlyFn(`${DEPLOYER}.zz-nft`, "burn-hash",
    [Cl.uint(h)], DEPLOYER).result).replace(/^0x/, "");
  const txid = "33".repeat(31) + (++depositNonce).toString(16).padStart(2, "0");
  simnet.callPublicFn(SBTC_DEPOSIT, "complete-deposit-wrapper",
    [Cl.bufferFromHex(txid), Cl.uint(0), Cl.uint(amount), Cl.principal(to),
     Cl.bufferFromHex(strip(hash)), Cl.uint(h), Cl.bufferFromHex("22".repeat(32))], SBTC_SIGNER);
}
const lock = (on: boolean) =>
  expect(simnet.callPublicFn(WALLET, "toggle-token-lock",
    [Cl.bool(on), Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
const gasCounter = () => BigInt((Cl.prettyPrint(simnet.getDataVar(WALLET, "spent-this-period"))
  .match(/gas: u(\d+)/) || [])[1] ?? "-1");

// pox-5 grant path, so the staking token-lock checks reach a real signer.
function registerSigner() {
  const priv = Buffer.from("11".repeat(32), "hex");
  const pub = secp256k1.getPublicKey(priv, true);
  const dom = cvHash(Cl.tuple({ name: Cl.stringAscii("pox-5-signer"),
    version: Cl.stringAscii("1.0.0"), "chain-id": Cl.uint(CHAIN_ID) }));
  const st = cvHash(Cl.tuple({ topic: Cl.stringAscii("grant-authorization"),
    "signer-manager": Cl.contractPrincipal(D, "juice-pool-stx-signer"), "auth-id": Cl.uint(1) }));
  const h = sha256(Buffer.concat([SIP018, dom, st]));
  const compact = Buffer.from(secp256k1.sign(h, priv, { prehash: false }));
  for (const rec of [0, 1]) {
    const r = simnet.callPublicFn(JUICE_SIGNER, "register-self",
      [Cl.contractPrincipal(D, "juice-pool-stx-signer"),
       Cl.bufferFromHex(Buffer.from(pub).toString("hex")), Cl.uint(1),
       Cl.bufferFromHex(Buffer.concat([compact, Buffer.from([rec])]).toString("hex"))], D);
    if (Cl.prettyPrint(r.result).startsWith("(ok")) return;
  }
  throw new Error("signer registration failed");
}

const NEW_OWNER = accounts.get("wallet_6")!;
const E_FORBIDDEN = 4003, E_UNREGISTERED_PUBKEY = 4004, E_NOT_ADMIN_PUBKEY = 4005,
  E_SIG_REPLAY = 4006;
const pendingOp = (id: number) =>
  simnet.callReadOnlyFn(WALLET, "get-pending-operation", [Cl.uint(id)], OWNER).result;

// =====================================================================
// u4003 -- the passkey cannot both queue and release
// =====================================================================
describe("v6 auth: an op the passkey created cannot be fast-tracked by the passkey", () => {
  // This is the whole point of the two-factor split. If the passkey could queue an
  // over-threshold transfer AND then call the -now variant on it, a stolen passkey
  // would drain the safe instantly and the cooldown would be decorative.
  //   juice-safe-v7.clar:694  (asserts! (not (get passkey-created op)) err-forbidden)
  let id = 300;

  it("stx: passkey-queued then passkey-released is u4003, admin release still works", () => {
    onboarded(); fundSTX();
    // queue OVER threshold using the passkey -> marks the op passkey-created
    expect(simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(STX_THRESHOLD + 1), Cl.principal(RECIPIENT), Cl.none(),
       Cl.some(sign(topic("stx-transfer", { "auth-id": Cl.uint(++id),
         amount: Cl.uint(STX_THRESHOLD + 1), recipient: Cl.principal(RECIPIENT),
         memo: Cl.none() }), id)), Cl.none()], RELAYER).result).toBeOk(Cl.bool(true));
    expect(Cl.prettyPrint(pendingOp(0))).toContain("passkey-created: true");

    expect(simnet.callPublicFn(WALLET, "execute-pending-stx-transfer-now",
      [Cl.uint(0), Cl.none(),
       sign(topic("execute-now", { "auth-id": Cl.uint(++id), "op-id": Cl.uint(0) }), id),
       Cl.none()], RELAYER).result).toBeErr(Cl.uint(E_FORBIDDEN));

    // the second factor is the ADMIN plus the cooldown, and that still releases it
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
    const before = simnet.getAssetsMap().get("STX")?.get(RECIPIENT) ?? 0n;
    expect(simnet.callPublicFn(WALLET, "execute-pending-stx-transfer",
      [Cl.uint(0), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
    expect(simnet.getAssetsMap().get("STX")?.get(RECIPIENT) ?? 0n)
      .toBe(before + BigInt(STX_THRESHOLD + 1));
  });

  it("sbtc transfer and sbtc withdrawal enforce the same rule", () => {
    onboarded(); fundSBTC();
    expect(simnet.callPublicFn(WALLET, "sip010-transfer",
      [Cl.uint(SBTC_THRESHOLD + 1), Cl.principal(RECIPIENT), Cl.none(), sbtcCV,
       Cl.stringAscii("sbtc-token"),
       Cl.some(sign(topic("sip010-transfer", { "auth-id": Cl.uint(++id),
         amount: Cl.uint(SBTC_THRESHOLD + 1), recipient: Cl.principal(RECIPIENT),
         memo: Cl.none(), sip010: sbtcCV }), id)), Cl.none()],
      RELAYER).result).toBeOk(Cl.bool(true));
    expect(simnet.callPublicFn(WALLET, "execute-pending-sbtc-transfer-now",
      [Cl.uint(0), Cl.none(),
       sign(topic("execute-now", { "auth-id": Cl.uint(++id), "op-id": Cl.uint(0) }), id),
       Cl.none()], RELAYER).result).toBeErr(Cl.uint(E_FORBIDDEN));

    expect(simnet.callPublicFn(WALLET, "sbtc-initiate-withdrawal",
      [Cl.uint(SBTC_THRESHOLD + 1), poxAddr, Cl.uint(1_000),
       Cl.some(sign(topic("sbtc-withdrawal", { "auth-id": Cl.uint(++id),
         amount: Cl.uint(SBTC_THRESHOLD + 1), recipient: poxAddr,
         "max-fee": Cl.uint(1_000) }), id)), Cl.none()],
      RELAYER).result).toBeOk(Cl.bool(true));
    expect(simnet.callPublicFn(WALLET, "execute-pending-sbtc-withdrawal-now",
      [Cl.uint(1),
       sign(topic("execute-now", { "auth-id": Cl.uint(++id), "op-id": Cl.uint(1) }), id),
       Cl.none()], RELAYER).result).toBeErr(Cl.uint(E_FORBIDDEN));
  });

  it("an ADMIN-queued op is still fast-trackable by the passkey", () => {
    // the mirror image, so the test above is proving the flag and not a typo
    onboarded(); fundSTX();
    simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(STX_THRESHOLD + 1), Cl.principal(RECIPIENT), Cl.none(), Cl.none(), Cl.none()],
      OWNER);
    expect(Cl.prettyPrint(pendingOp(0))).toContain("passkey-created: false");
    expect(simnet.callPublicFn(WALLET, "execute-pending-stx-transfer-now",
      [Cl.uint(0), Cl.none(),
       sign(topic("execute-now", { "auth-id": Cl.uint(++id), "op-id": Cl.uint(0) }), id),
       Cl.none()], RELAYER).result).toBeOk(Cl.bool(true));
  });

  it("an admin cannot propose ITSELF as the next admin", () => {
    //   juice-safe-v7.clar:1117  (asserts! (not (is-eq new-admin tx-sender)) err-forbidden)
    onboarded();
    expect(simnet.callPublicFn(WALLET, "propose-transfer-wallet",
      [Cl.principal(OWNER)], OWNER).result).toBeErr(Cl.uint(E_FORBIDDEN));
  });
});

// =====================================================================
// u4006 -- replay
// =====================================================================
describe("v6 auth: a captured signature cannot be replayed", () => {
  // consume-signature is reached from exactly one place (juice-safe-v7.clar:573), the
  // common passkey branch, so this guard covers EVERY passkey-authorised call.
  //   L1220  (asserts! (is-none (map-get? used-pubkey-authorizations message-hash))
  it("the identical signature fails u4006 the second time", () => {
    onboarded(); fundSTX();
    const sig = sign(topic("stx-transfer", { "auth-id": Cl.uint(400),
      amount: Cl.uint(1_000_000), recipient: Cl.principal(RECIPIENT), memo: Cl.none() }), 400);
    const call = () => simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(1_000_000), Cl.principal(RECIPIENT), Cl.none(), Cl.some(sig), Cl.none()], RELAYER);

    const before = simnet.getAssetsMap().get("STX")?.get(RECIPIENT) ?? 0n;
    expect(call().result).toBeOk(Cl.bool(true));
    // a hostile relayer resubmitting the same bytes gets nothing
    expect(call().result).toBeErr(Cl.uint(E_SIG_REPLAY));
    expect(simnet.getAssetsMap().get("STX")?.get(RECIPIENT) ?? 0n)
      .toBe(before + 1_000_000n);   // paid exactly once
  });

  it("bumping only the auth-id makes it a fresh authorisation", () => {
    onboarded(); fundSTX();
    for (const n of [410, 411]) {
      expect(simnet.callPublicFn(WALLET, "stx-transfer",
        [Cl.uint(1_000_000), Cl.principal(RECIPIENT), Cl.none(),
         Cl.some(sign(topic("stx-transfer", { "auth-id": Cl.uint(n), amount: Cl.uint(1_000_000),
           recipient: Cl.principal(RECIPIENT), memo: Cl.none() }), n)), Cl.none()],
        RELAYER).result, `auth-id ${n}`).toBeOk(Cl.bool(true));
    }
  });
});

// =====================================================================
// u4004 / u4005 -- which pubkeys count
// =====================================================================
describe("v6 auth: pubkey registration", () => {
  it("a foreign passkey is unregistered: u4004", () => {
    //   is-admin-pubkey L1109 -> err-unregistered-pubkey
    onboarded(); fundSTX();
    const other = generateP256Keypair();
    const t = topic("stx-transfer", { "auth-id": Cl.uint(500), amount: Cl.uint(1_000),
      recipient: Cl.principal(RECIPIENT), memo: Cl.none() });
    const s = signChallengeWithRpId(challenge(t), other.privKey, RP_ID);
    const forged = Cl.tuple({
      "auth-id": Cl.uint(500), pubkey: Cl.bufferFromHex(strip(other.pubKeyHex)),
      signature: Cl.bufferFromHex(strip(s.signatureHex)),
      "authenticator-data": Cl.bufferFromHex(strip(s.authenticatorDataHex)),
      "client-data-prefix": Cl.bufferFromHex(strip(s.clientDataPrefixHex)),
      "client-data-suffix": Cl.bufferFromHex(strip(s.clientDataSuffixHex)),
    });
    // a perfectly valid WebAuthn signature over the right challenge, wrong key
    expect(simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(1_000), Cl.principal(RECIPIENT), Cl.none(), Cl.some(forged), Cl.none()],
      RELAYER).result).toBeErr(Cl.uint(E_UNREGISTERED_PUBKEY));
  });

  it("after an admin rotation the onboarded passkey is orphaned: u4005", () => {
    // pubkey-to-admin is written ONLY in onboard (juice-safe-v7.clar:1495) while the
    // admins map is rotated by confirm-transfer-wallet (L1163-1164) and by recovery
    // (L1301-1304). So the pubkey keeps pointing at the OLD owner, who is no longer an
    // admin, and is-admin-pubkey answers u4005.
    //
    // This is the accepted consequence of there being no admin-only way to designate a
    // new passkey: after a rotation the safe is single-factor under the new admin.
    // Pinned here so that stays a decision and not a surprise.
    onboarded(); fundSTX();
    expect(simnet.callPublicFn(WALLET, "propose-transfer-wallet",
      [Cl.principal(NEW_OWNER)], OWNER).result).toBeOk(Cl.bool(true));
    expect(simnet.callPublicFn(WALLET, "confirm-transfer-wallet",
      [sign(topic("confirm-transfer",
        { "auth-id": Cl.uint(510), "new-admin": Cl.principal(NEW_OWNER) }), 510), Cl.none()],
      RELAYER).result).toBeOk(Cl.bool(true));

    // the old admin is out
    expect(simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(1_000), Cl.principal(RECIPIENT), Cl.none(), Cl.none(), Cl.none()],
      OWNER).result).toBeErr(Cl.uint(4001));
    // and so is the passkey that was registered to it
    expect(simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(1_000), Cl.principal(RECIPIENT), Cl.none(),
       Cl.some(sign(topic("stx-transfer", { "auth-id": Cl.uint(511), amount: Cl.uint(1_000),
         recipient: Cl.principal(RECIPIENT), memo: Cl.none() }), 511)), Cl.none()],
      RELAYER).result).toBeErr(Cl.uint(E_NOT_ADMIN_PUBKEY));
    // the new admin holds the safe on its own
    expect(simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(1_000), Cl.principal(RECIPIENT), Cl.none(), Cl.none(), Cl.none()],
      NEW_OWNER).result).toBeOk(Cl.bool(true));
  });
});

// =====================================================================
// u4005 everywhere -- the orphaned passkey must be dead on EVERY entry point
// =====================================================================
describe("v6 auth: an orphaned passkey is refused on every passkey path", () => {
  // One u4005 on stx-transfer only proves that ONE function consults
  // is-admin-pubkey. If any passkey entry point skipped it, a passkey orphaned by an
  // admin rotation would still be able to act there. This sweeps all of them.
  //
  // Rotation is done first, so OWNER is no longer an admin and `key` is orphaned.
  // All setup after that point is driven by NEW_OWNER, the live admin.
  let id = 600;
  const orphan = (t: any) => Cl.some(sign(t, ++id));
  const orphanReq = (t: any) => sign(t, ++id);

  function rotated() {
    onboarded(); fundSTX(); fundSBTC();
    simnet.callPublicFn(`${DEPLOYER}.zz-nft`, "mint", [Cl.principal(WALLET)], DEPLOYER);
    simnet.callPublicFn(WALLET, "propose-transfer-wallet", [Cl.principal(NEW_OWNER)], OWNER);
    expect(simnet.callPublicFn(WALLET, "confirm-transfer-wallet",
      [sign(topic("confirm-transfer",
        { "auth-id": Cl.uint(++id), "new-admin": Cl.principal(NEW_OWNER) }), id), Cl.none()],
      RELAYER).result).toBeOk(Cl.bool(true));
  }

  it("asset paths: sip010, sip009, sbtc-withdrawal", () => {
    rotated();
    expect(simnet.callPublicFn(WALLET, "sip010-transfer",
      [Cl.uint(2_000), Cl.principal(RECIPIENT), Cl.none(), sbtcCV, Cl.stringAscii("sbtc-token"),
       orphan(topic("sip010-transfer", { "auth-id": Cl.uint(id + 1), amount: Cl.uint(2_000),
         recipient: Cl.principal(RECIPIENT), memo: Cl.none(), sip010: sbtcCV })), Cl.none()],
      RELAYER).result, "sip010").toBeErr(Cl.uint(E_NOT_ADMIN_PUBKEY));

    expect(simnet.callPublicFn(WALLET, "sip009-transfer",
      [Cl.uint(1), Cl.principal(RECIPIENT), nftCV, Cl.stringAscii("zz-nft"),
       orphan(topic("sip009-transfer", { "auth-id": Cl.uint(id + 1), "nft-id": Cl.uint(1),
         recipient: Cl.principal(RECIPIENT), sip009: nftCV })), Cl.none()],
      RELAYER).result, "sip009").toBeErr(Cl.uint(E_NOT_ADMIN_PUBKEY));

    expect(simnet.callPublicFn(WALLET, "sbtc-initiate-withdrawal",
      [Cl.uint(10_000), poxAddr, Cl.uint(1_000),
       orphan(topic("sbtc-withdrawal", { "auth-id": Cl.uint(id + 1), amount: Cl.uint(10_000),
         recipient: poxAddr, "max-fee": Cl.uint(1_000) })), Cl.none()],
      RELAYER).result, "sbtc-withdrawal").toBeErr(Cl.uint(E_NOT_ADMIN_PUBKEY));
  });

  it("the three -now fast paths on ops queued by the LIVE admin", () => {
    rotated();
    // the new admin queues real over-threshold ops, so passkey-created is false and
    // u4003 cannot be what fires. The only thing left to stop the orphan is u4005.
    simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(STX_THRESHOLD + 1), Cl.principal(RECIPIENT), Cl.none(), Cl.none(), Cl.none()],
      NEW_OWNER);
    simnet.callPublicFn(WALLET, "sip010-transfer",
      [Cl.uint(SBTC_THRESHOLD + 1), Cl.principal(RECIPIENT), Cl.none(), sbtcCV,
       Cl.stringAscii("sbtc-token"), Cl.none(), Cl.none()], NEW_OWNER);
    simnet.callPublicFn(WALLET, "sbtc-initiate-withdrawal",
      [Cl.uint(SBTC_THRESHOLD + 1), poxAddr, Cl.uint(1_000), Cl.none(), Cl.none()], NEW_OWNER);
    for (const [fn, opId, withMemo] of [
      ["execute-pending-stx-transfer-now", 0, true],
      ["execute-pending-sbtc-transfer-now", 1, true],
      ["execute-pending-sbtc-withdrawal-now", 2, false],
    ] as [string, number, boolean][]) {
      expect(Cl.prettyPrint(pendingOp(opId)), fn).toContain("passkey-created: false");
      const s = orphanReq(topic("execute-now",
        { "auth-id": Cl.uint(id + 1), "op-id": Cl.uint(opId) }));
      const args = withMemo ? [Cl.uint(opId), Cl.none(), s, Cl.none()]
                            : [Cl.uint(opId), s, Cl.none()];
      expect(simnet.callPublicFn(WALLET, fn, args, RELAYER).result, fn)
        .toBeErr(Cl.uint(E_NOT_ADMIN_PUBKEY));
    }
  });

  it("veto-operation and toggle-token-lock", () => {
    rotated();
    simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(STX_THRESHOLD + 1), Cl.principal(RECIPIENT), Cl.none(), Cl.none(), Cl.none()],
      NEW_OWNER);
    expect(simnet.callPublicFn(WALLET, "veto-operation",
      [Cl.uint(0), orphan(topic("veto-operation",
        { "auth-id": Cl.uint(id + 1), "op-id": Cl.uint(0) })), Cl.none()],
      RELAYER).result, "veto").toBeErr(Cl.uint(E_NOT_ADMIN_PUBKEY));
    expect(simnet.callPublicFn(WALLET, "toggle-token-lock",
      [Cl.bool(true), orphan(topic("toggle-token-lock",
        { "auth-id": Cl.uint(id + 1), enabled: Cl.bool(true) })), Cl.none()],
      RELAYER).result, "toggle").toBeErr(Cl.uint(E_NOT_ADMIN_PUBKEY));
  });

  it("the second-factor confirms: config, max-gas, recovery, transfer-wallet", () => {
    rotated();
    // each of these needs its first step taken by the LIVE admin, and the cooldown
    // mined, so the orphaned passkey is what the contract is actually judging.
    simnet.callPublicFn(WALLET, "signal-config-change",
      [Cl.uint(1_000), Cl.uint(2_000), Cl.uint(432)], NEW_OWNER);
    simnet.callPublicFn(WALLET, "propose-max-gas-amount", [Cl.uint(500)], NEW_OWNER);
    simnet.callPublicFn(WALLET, "propose-transfer-wallet", [Cl.principal(RANDOM)], NEW_OWNER);
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);

    expect(simnet.callPublicFn(WALLET, "set-wallet-config",
      [orphanReq(topic("set-wallet-config", { "auth-id": Cl.uint(id + 1),
        "stx-threshold": Cl.uint(1_000), "sbtc-threshold": Cl.uint(2_000),
        "cooldown-period": Cl.uint(432) })), Cl.none()],
      RELAYER).result, "set-wallet-config").toBeErr(Cl.uint(E_NOT_ADMIN_PUBKEY));

    expect(simnet.callPublicFn(WALLET, "confirm-max-gas-amount",
      [orphanReq(topic("confirm-max-gas-amount",
        { "auth-id": Cl.uint(id + 1), amount: Cl.uint(500) })), Cl.none()],
      RELAYER).result, "confirm-max-gas").toBeErr(Cl.uint(E_NOT_ADMIN_PUBKEY));

    expect(simnet.callPublicFn(WALLET, "propose-recovery",
      [Cl.principal(RANDOM), orphanReq(topic("propose-recovery",
        { "auth-id": Cl.uint(id + 1), "new-recovery": Cl.principal(RANDOM) })), Cl.none()],
      RELAYER).result, "propose-recovery").toBeErr(Cl.uint(E_NOT_ADMIN_PUBKEY));

    // and it cannot rubber-stamp another rotation away from the new admin
    expect(simnet.callPublicFn(WALLET, "confirm-transfer-wallet",
      [orphanReq(topic("confirm-transfer",
        { "auth-id": Cl.uint(id + 1), "new-admin": Cl.principal(RANDOM) })), Cl.none()],
      RELAYER).result, "confirm-transfer-wallet").toBeErr(Cl.uint(E_NOT_ADMIN_PUBKEY));
    expect(simnet.getDataVar(WALLET, "owner")).toBePrincipal(NEW_OWNER);
  });

  it("the three staking paths", () => {
    rotated(); registerSigner();
    const AMT = 1_000_000_000;
    expect(simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(AMT), orphan(topic("stake-stx-juice-pox5",
        { "auth-id": Cl.uint(id + 1), "amount-ustx": Cl.uint(AMT) })), Cl.none()],
      RELAYER).result, "stake").toBeErr(Cl.uint(E_NOT_ADMIN_PUBKEY));

    // the live admin stakes so update/unstake have a position to act on
    expect(simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(AMT), Cl.none(), Cl.none()], NEW_OWNER).result).toBeOk(Cl.bool(true));

    expect(simnet.callPublicFn(WALLET, "update-stake-stx-juice",
      [Cl.uint(50_000_000), Cl.uint(0), orphan(topic("update-stake-stx-juice",
        { "auth-id": Cl.uint(id + 1), "amount-increase": Cl.uint(50_000_000),
          "cycles-to-extend": Cl.uint(0) })), Cl.none()],
      RELAYER).result, "update-stake").toBeErr(Cl.uint(E_NOT_ADMIN_PUBKEY));

    expect(simnet.callPublicFn(WALLET, "unstake",
      [orphan(topic("unstake-stx-juice", { "auth-id": Cl.uint(id + 1) })), Cl.none()],
      RELAYER).result, "unstake").toBeErr(Cl.uint(E_NOT_ADMIN_PUBKEY));
  });
});
