// fakfun-wallet-v17-gaps.test.ts -- the error branches the other suites left open.
//
// Run: npx vitest run tests/fakfun-wallet-v17-gaps.test.ts -- --manifest tests/cl-v17/Clarinet.toml
//
// A code-by-code audit of v16 found 31 declared err-* constants, 28 reachable. The
// other three suites asserted 19. Of the 9 remaining, two (u4024 err-limit-expired,
// u4025 err-limit-not-hit) live ONLY in faktory-execute-limit and are out of scope by
// agreement. These are the other seven.
//
// Note on the audit: u4004 and u4005 first looked faktory-only because
// is-admin-pubkey is consulted inside the PRIVATE verify-signature, so a script that
// attributes constants to the nearest preceding define-public blames whatever function
// happens to sit above it. They are in fact reachable from every passkey path, exactly
// as in juice-safe-v6.
import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";
import { generateP256Keypair, signChallengeWithRpId } from "../lib-webauthn-test-signer.mjs";
import {
  D, WD, WALLET, CORE, OWNER, RANDOM, RELAYER, RECIPIENT, NEW_OWNER,
  E, MIN_COOLDOWN, seated, deployV17, fundSTX, sign, topic, pubkeyCV,
  FAKFUN_DEPLOYER, strip, RP_ID, CHAIN_ID,
} from "./v17-helpers";
import crypto from "node:crypto";

let id = 400;
const next = () => ++id;

describe("v16 gaps: pubkey registration", () => {
  it("u4004 a foreign passkey is unregistered", () => {
    seated(); fundSTX();
    const other = generateP256Keypair();
    // rebuild the challenge by hand so we can sign with a key the wallet never saw
    const SIP018 = Buffer.from("534950303138", "hex");
    const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest();
    const cvHash = (cv: any) => sha256(Buffer.from(Cl.serialize(cv), "hex"));
    const dom = cvHash(Cl.tuple({
      name: Cl.stringAscii("smart-wallet-standard"), version: Cl.stringAscii("1.0.0"),
      "chain-id": Cl.uint(CHAIN_ID), wallet: Cl.contractPrincipal(WD, "fakfun-wallet-v17"),
    }));
    const t = topic("stx-transfer", { "auth-id": Cl.uint(500), amount: Cl.uint(1_000),
      recipient: Cl.principal(RECIPIENT), memo: Cl.none() });
    const ch = sha256(Buffer.concat([SIP018, dom, cvHash(t)]));
    const s = signChallengeWithRpId(ch, other.privKey, RP_ID);
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
      RELAYER).result).toBeErr(Cl.uint(E.UNREG_PUBKEY));
  });

  it("u4005 the passkey is orphaned by an admin rotation", () => {
    // same shape as the safe: pubkey-to-admin is written at onboard/seating and never
    // rewritten, while the admins map rotates. After a transfer the passkey points at a
    // principal that is no longer an admin, so the wallet is single-factor under the
    // new admin. Pinned so it stays a decision rather than a surprise.
    seated(); fundSTX();
    expect(simnet.callPublicFn(WALLET, "propose-transfer-wallet",
      [Cl.principal(NEW_OWNER)], OWNER).result).toBeOk(Cl.bool(true));
    expect(simnet.callPublicFn(WALLET, "confirm-transfer-wallet",
      [sign(topic("confirm-transfer",
        { "auth-id": Cl.uint(next()), "new-admin": Cl.principal(NEW_OWNER) }), id), Cl.none()],
      RELAYER).result).toBeOk(Cl.bool(true));

    expect(simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(1_000), Cl.principal(RECIPIENT), Cl.none(),
       Cl.some(sign(topic("stx-transfer", { "auth-id": Cl.uint(next()), amount: Cl.uint(1_000),
         recipient: Cl.principal(RECIPIENT), memo: Cl.none() }), id)), Cl.none()],
      RELAYER).result).toBeErr(Cl.uint(E.NOT_ADMIN_PUBKEY));
    // the new admin holds the wallet on its own
    expect(simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(1_000), Cl.principal(RECIPIENT), Cl.none(), Cl.none(), Cl.none()],
      NEW_OWNER).result).toBeOk(Cl.bool(true));
  });
});

describe("v16 gaps: nothing-pending and wrong-order guards", () => {
  it("u4016 set-wallet-config with nothing signaled", () => {
    // the signature is checked BEFORE the not-signaled assert, and the hash is built
    // from the PENDING values -- so reaching u4016 means signing over the empty
    // pending config (all zeroes). Signing over anything else gives u4002 first.
    seated();
    simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
    expect(simnet.callPublicFn(WALLET, "set-wallet-config",
      [sign(topic("set-wallet-config", { "auth-id": Cl.uint(next()),
        "stx-threshold": Cl.uint(0), "sbtc-threshold": Cl.uint(0),
        "cooldown-period": Cl.uint(0) }), id), Cl.none()],
      RELAYER).result).toBeErr(Cl.uint(E.NOT_SIGNALED));
  });

  it("u4020 confirm-transfer-wallet with nothing proposed", () => {
    seated();
    expect(simnet.callPublicFn(WALLET, "confirm-transfer-wallet",
      [sign(topic("confirm-transfer",
        { "auth-id": Cl.uint(next()), "new-admin": Cl.principal(NEW_OWNER) }), id), Cl.none()],
      RELAYER).result).toBeErr(Cl.uint(E.NO_PENDING_TRANSFER));
  });

  it("u4009 recover-inactive-wallet is refused while the wallet is active", () => {
    seated();
    expect(simnet.callPublicFn(WALLET, "recover-inactive-wallet",
      [Cl.principal(RANDOM)], RANDOM).result).toBeErr(Cl.uint(E.INACTIVE_REQ));
  });
});

describe("v16 gaps: the three-step seating, out of order", () => {
  function onboarded() {
    deployV17();
    expect(simnet.callPublicFn(CORE, "set-verified-contract",
      [Cl.contractPrincipal(WD, "fakfun-wallet-v17"), Cl.none()], D).result).toBeOk(Cl.bool(true));
    expect(simnet.callPublicFn(WALLET, "onboard", [pubkeyCV], FAKFUN_DEPLOYER).result)
      .toBeOk(Cl.bool(true));
  }

  it("u4026 a second proposal while one is already pending", () => {
    onboarded();
    expect(simnet.callPublicFn(WALLET, "propose-admin-with-signature",
      [Cl.principal(OWNER), sign(topic("add-admin",
        { "auth-id": Cl.uint(next()), "new-admin": Cl.principal(OWNER) }), id), Cl.none()],
      RELAYER).result).toBeOk(Cl.bool(true));
    expect(simnet.callPublicFn(WALLET, "propose-admin-with-signature",
      [Cl.principal(NEW_OWNER), sign(topic("add-admin",
        { "auth-id": Cl.uint(next()), "new-admin": Cl.principal(NEW_OWNER) }), id), Cl.none()],
      RELAYER).result).toBeErr(Cl.uint(E.INIT_ALREADY_PROPOSED));
  });

  it("u4029 confirm before the proposal was accepted", () => {
    onboarded();
    simnet.callPublicFn(WALLET, "propose-admin-with-signature",
      [Cl.principal(OWNER), sign(topic("add-admin",
        { "auth-id": Cl.uint(next()), "new-admin": Cl.principal(OWNER) }), id), Cl.none()], RELAYER);
    simnet.mineEmptyBurnBlocks(432 + 10);   // cooldown elapsed, but never accepted
    expect(simnet.callPublicFn(WALLET, "confirm-admin-with-signature",
      [sign(topic("confirm-admin",
        { "auth-id": Cl.uint(next()), "new-admin": Cl.principal(OWNER) }), id), Cl.none()],
      RELAYER).result).toBeErr(Cl.uint(E.INIT_NOT_ACCEPTED));
  });
});
