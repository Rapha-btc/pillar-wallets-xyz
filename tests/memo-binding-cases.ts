// memo-binding-cases.ts -- shared cases for bounty mv8wal fix #3 (Cunning Nexus).
//
// Before the fix, a queued over-threshold stx-transfer / sbtc sip010-transfer
// dropped its memo (payload none), and execute-pending-*-transfer-now took a
// caller-supplied memo that the passkey never signed (the -now hash is only
// {auth-id, op-id}). A relayer holding a valid -now signature could therefore
// release the funds with ANY memo, e.g. a wrong exchange deposit tag.
//
// The fix stores (to-consensus-buff? memo) in the op payload at queue time and
// makes -now refuse any other memo with err-memo-mismatch (u4041).
//
// Used by tests/juice-safe-v9-memo.test.ts (cl-v8) and
// tests/juice-autostake-safe-memo.test.ts (cl-v7). Each safe is deployed at its
// real SPV9K21T... address with simnet.deployContract, so onboard's
// register-wallet canonical literal matches and no source is edited.
import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";
import crypto from "node:crypto";
import { generateP256Keypair, signChallengeWithRpId } from "../lib-webauthn-test-signer.mjs";

export const D = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const CORE = `${D}.fakfun-wallet-core-v2`;
const SBTC_DEPOSIT = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-deposit";
const SBTC_SIGNER = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4";
const SBTC_TOKEN = `${SBTC_SIGNER}.sbtc-token`;
const RP_ID = "juiceofbtc.com";
const CHAIN_ID = 2147483648;

const MIN_COOLDOWN = 144;
const STX_THRESHOLD = 100_000_000;
const SBTC_THRESHOLD = 100_000;
const E_MEMO_MISMATCH = 4041;

const SIP018 = Buffer.from("534950303138", "hex");
const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest();
const cvHash = (cv: any) => sha256(Buffer.from(Cl.serialize(cv), "hex"));
const strip = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);

const MEMO_A = Cl.some(Cl.bufferFromHex("ab".repeat(34)));
const MEMO_B = Cl.some(Cl.bufferFromHex("cd".repeat(34)));

export function memoBindingSuite(walletName: string, deploy: () => void) {
  const WALLET = `${D}.${walletName}`;
  const accounts = simnet.getAccounts();
  const DEPLOYER = accounts.get("deployer")!;
  const OWNER = accounts.get("wallet_1")!;
  const RECOVERY = accounts.get("wallet_2")!;
  const RELAYER = accounts.get("wallet_4")!;
  const RECIPIENT = accounts.get("wallet_5")!;

  const key = generateP256Keypair();
  const pubkeyCV = Cl.bufferFromHex(strip(key.pubKeyHex));
  const domainHash = () => cvHash(Cl.tuple({
    name: Cl.stringAscii("smart-wallet-standard"), version: Cl.stringAscii("1.0.0"),
    "chain-id": Cl.uint(CHAIN_ID), wallet: Cl.contractPrincipal(D, walletName),
  }));
  function signNow(authId: number, opId: number) {
    const t = Cl.tuple({ topic: Cl.stringAscii("execute-now"),
      "auth-id": Cl.uint(authId), "op-id": Cl.uint(opId) });
    const s = signChallengeWithRpId(
      sha256(Buffer.concat([SIP018, domainHash(), cvHash(t)])), key.privKey, RP_ID);
    return Cl.tuple({
      "auth-id": Cl.uint(authId), pubkey: pubkeyCV,
      signature: Cl.bufferFromHex(strip(s.signatureHex)),
      "authenticator-data": Cl.bufferFromHex(strip(s.authenticatorDataHex)),
      "client-data-prefix": Cl.bufferFromHex(strip(s.clientDataPrefixHex)),
      "client-data-suffix": Cl.bufferFromHex(strip(s.clientDataSuffixHex)),
    });
  }

  function ready() {
    deploy();
    expect(simnet.callPublicFn(CORE, "set-verified-contract",
      [Cl.contractPrincipal(D, walletName), Cl.none()], D).result).toBeOk(Cl.bool(true));
    expect(simnet.callPublicFn(WALLET, "onboard",
      [pubkeyCV, Cl.principal(OWNER), Cl.principal(RECOVERY),
       Cl.uint(STX_THRESHOLD), Cl.uint(SBTC_THRESHOLD), Cl.uint(MIN_COOLDOWN)],
      FAKFUN_DEPLOYER).result).toBeOk(Cl.bool(true));
    simnet.transferSTX(2_000_000_000, WALLET, DEPLOYER);
    const h = simnet.burnBlockHeight - 1;
    const hash = Cl.prettyPrint(simnet.callReadOnlyFn(`${DEPLOYER}.zz-nft`, "burn-hash",
      [Cl.uint(h)], DEPLOYER).result);
    expect(simnet.callPublicFn(SBTC_DEPOSIT, "complete-deposit-wrapper",
      [Cl.bufferFromHex("33".repeat(32)), Cl.uint(0), Cl.uint(5_000_000), Cl.principal(WALLET),
       Cl.bufferFromHex(strip(hash)), Cl.uint(h), Cl.bufferFromHex("22".repeat(32))],
      SBTC_SIGNER).result).toBeOk(Cl.bool(true));
  }
  const stxOf = (p: string) => simnet.getAssetsMap().get("STX")?.get(p) ?? 0n;
  const sbtcOf = (p: string) => simnet.getAssetsMap().get(".sbtc-token.sbtc-token")?.get(p)
    ?? simnet.getAssetsMap().get(`${SBTC_TOKEN}.sbtc-token`)?.get(p) ?? 0n;
  const payload = (opId: number) => {
    const op = simnet.callReadOnlyFn(WALLET, "get-pending-operation", [Cl.uint(opId)], OWNER).result as any;
    return op.value.value.payload;
  };
  /** the printed memo of the transfer event, as hex, or "none" */
  function transferMemo(events: any[], kind: "stx" | "ft"): string {
    const e = events.find((x) => x.event === (kind === "stx" ? "stx_transfer_event" : "ft_transfer_event"));
    expect(e).toBeDefined();
    return e.data.memo ?? "";
  }
  function queueStx(memo: any) {
    expect(simnet.callPublicFn(WALLET, "stx-transfer",
      [Cl.uint(STX_THRESHOLD + 1), Cl.principal(RECIPIENT), memo, Cl.none(), Cl.none()],
      OWNER).result).toBeOk(Cl.bool(true));
  }
  function queueSbtc(memo: any) {
    expect(simnet.callPublicFn(WALLET, "sip010-transfer",
      [Cl.uint(SBTC_THRESHOLD + 1), Cl.principal(RECIPIENT), memo,
       Cl.contractPrincipal(SBTC_SIGNER, "sbtc-token"), Cl.stringAscii("sbtc-token"),
       Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
  }

  describe(`${walletName}: queued memo is bound to the -now release (mv8wal #3)`, () => {
    it("queue stores the memo in the op payload (some and none)", () => {
      // arrange
      ready();
      // act
      queueStx(MEMO_A);
      queueSbtc(Cl.none());
      // assert
      expect(payload(0)).toBeSome(Cl.bufferFromHex(Cl.serialize(MEMO_A)));
      expect(payload(1)).toBeSome(Cl.bufferFromHex(Cl.serialize(Cl.none())));
    });

    it("execute-pending-stx-transfer-now refuses a different memo (u4041), then sends with the queued one", () => {
      // arrange
      ready();
      queueStx(MEMO_A);
      const before = stxOf(RECIPIENT);
      // act
      const wrong = simnet.callPublicFn(WALLET, "execute-pending-stx-transfer-now",
        [Cl.uint(0), MEMO_B, signNow(901, 0), Cl.none()], RELAYER);
      const dropped = simnet.callPublicFn(WALLET, "execute-pending-stx-transfer-now",
        [Cl.uint(0), Cl.none(), signNow(902, 0), Cl.none()], RELAYER);
      const right = simnet.callPublicFn(WALLET, "execute-pending-stx-transfer-now",
        [Cl.uint(0), MEMO_A, signNow(903, 0), Cl.none()], RELAYER);
      // assert
      expect(wrong.result).toBeErr(Cl.uint(E_MEMO_MISMATCH));
      expect(dropped.result).toBeErr(Cl.uint(E_MEMO_MISMATCH));
      expect(right.result).toBeOk(Cl.bool(true));
      expect(transferMemo(right.events, "stx")).toBe("ab".repeat(34));
      expect(stxOf(RECIPIENT)).toBe(before + BigInt(STX_THRESHOLD + 1));
    });

    it("a memo-less STX queue refuses an added memo on -now, sends with none", () => {
      // arrange
      ready();
      queueStx(Cl.none());
      // act
      const added = simnet.callPublicFn(WALLET, "execute-pending-stx-transfer-now",
        [Cl.uint(0), MEMO_B, signNow(911, 0), Cl.none()], RELAYER);
      const right = simnet.callPublicFn(WALLET, "execute-pending-stx-transfer-now",
        [Cl.uint(0), Cl.none(), signNow(912, 0), Cl.none()], RELAYER);
      // assert
      expect(added.result).toBeErr(Cl.uint(E_MEMO_MISMATCH));
      expect(right.result).toBeOk(Cl.bool(true));
    });

    it("execute-pending-sbtc-transfer-now refuses a different memo (u4041), then sends with the queued one", () => {
      // arrange
      ready();
      queueSbtc(MEMO_A);
      const before = sbtcOf(RECIPIENT);
      // act
      const wrong = simnet.callPublicFn(WALLET, "execute-pending-sbtc-transfer-now",
        [Cl.uint(0), MEMO_B, signNow(921, 0), Cl.none()], RELAYER);
      const right = simnet.callPublicFn(WALLET, "execute-pending-sbtc-transfer-now",
        [Cl.uint(0), MEMO_A, signNow(922, 0), Cl.none()], RELAYER);
      // assert
      expect(wrong.result).toBeErr(Cl.uint(E_MEMO_MISMATCH));
      expect(right.result).toBeOk(Cl.bool(true));
      expect(sbtcOf(RECIPIENT)).toBe(before + BigInt(SBTC_THRESHOLD + 1));
      // sbtc-token prints the memo; it must be the queued one
      const printed = right.events.filter((x: any) => x.event === "print_event")
        .map((x: any) => Cl.prettyPrint(x.data.value)).join("\n");
      expect(printed).toContain("0x" + "ab".repeat(34));
      expect(printed).not.toContain("cd".repeat(34));
    });

    it("the admin-only execute-pending-* path keeps the admin's memo choice (unchanged)", () => {
      // arrange
      ready();
      queueStx(MEMO_A);
      simnet.mineEmptyBurnBlocks(MIN_COOLDOWN + 5);
      // act
      const r = simnet.callPublicFn(WALLET, "execute-pending-stx-transfer",
        [Cl.uint(0), MEMO_B], OWNER);
      // assert
      expect(r.result).toBeOk(Cl.bool(true));
      expect(transferMemo(r.events, "stx")).toBe("cd".repeat(34));
    });
  });
}
