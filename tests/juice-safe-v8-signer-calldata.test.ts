// juice-safe-v8-signer-calldata.test.ts -- v8 forwards signer-calldata to pox-5.
//
// Run: npx vitest run tests/juice-safe-v8-signer-calldata.test.ts -- --manifest tests/cl-v8/Clarinet.toml
//
// stake-stx-juice and update-stake-stx-juice take a last (optional (buff 500))
// argument. The safe passes it to pox-5 stake / stake-update, pox-5 hands it to
// juice-pool-stx-signer validate-stake!, and the deployed pool prints it. The
// safe prints it in its own event too. Since helpers-v2 the passkey challenge
// includes signer-calldata, so a relayer cannot swap or strip it. Setup mirrors
// juice-safe-v8-staking.
import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";
import crypto from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { generateP256Keypair, signChallengeWithRpId } from "../lib-webauthn-test-signer.mjs";

const D = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const WD = D;
const WALLET_NAME = "juice-safe-v8";
const POOL_NAME = "juice-pool-stx-signer";
const POOL_DEPLOYER = D;
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const WALLET = `${WD}.${WALLET_NAME}`;
const CORE = `${D}.fakfun-wallet-core-v2`;
const SIGNER = `${POOL_DEPLOYER}.${POOL_NAME}`;
const RP_ID = "juiceofbtc.com";
const CHAIN_ID = 2147483648;

const accounts = simnet.getAccounts();
const DEPLOYER = accounts.get("deployer")!;
const OWNER = accounts.get("wallet_1")!;
const RECOVERY = accounts.get("wallet_2")!;
const RELAYER = accounts.get("wallet_4")!;

const MIN_COOLDOWN = 144;
const STX_THRESHOLD = 100_000_000;
const SBTC_THRESHOLD = 100_000;
const STAKE = 1_000_000_000;


// --- SIP-018 for the wallet's own passkey challenges --------------------
const SIP018 = Buffer.from("534950303138", "hex");
const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest();
const cvHash = (cv: any) => sha256(Buffer.from(Cl.serialize(cv), "hex"));
const walletDomain = () => cvHash(Cl.tuple({
  name: Cl.stringAscii("smart-wallet-standard"), version: Cl.stringAscii("1.0.0"),
  "chain-id": Cl.uint(CHAIN_ID), wallet: Cl.contractPrincipal(WD, WALLET_NAME),
}));
const challenge = (t: any) => sha256(Buffer.concat([SIP018, walletDomain(), cvHash(t)]));
const pk = generateP256Keypair();
const strip = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);
const pubkeyCV = Cl.bufferFromHex(strip(pk.pubKeyHex));
const sigAuth = (id: number, s: any) => Cl.tuple({
  "auth-id": Cl.uint(id), pubkey: pubkeyCV,
  signature: Cl.bufferFromHex(strip(s.signatureHex)),
  "authenticator-data": Cl.bufferFromHex(strip(s.authenticatorDataHex)),
  "client-data-prefix": Cl.bufferFromHex(strip(s.clientDataPrefixHex)),
  "client-data-suffix": Cl.bufferFromHex(strip(s.clientDataSuffixHex)),
});
const topic = (name: string, f: Record<string, any>) =>
  Cl.tuple({ topic: Cl.stringAscii(name), ...f });
const sign = (t: any, id: number) => sigAuth(id, signChallengeWithRpId(challenge(t), pk.privKey, RP_ID));

// --- pox-5 signer-key grant ---------------------------------------------
/** Mirrors pox-5 get-signer-grant-message-hash exactly. */
function grantMessageHash(signerManager: string, authId: number): Buffer {
  const [addr, name] = signerManager.split(".");
  const domain = cvHash(Cl.tuple({
    name: Cl.stringAscii("pox-5-signer"),
    version: Cl.stringAscii("1.0.0"),
    "chain-id": Cl.uint(CHAIN_ID),
  }));
  const struct = cvHash(Cl.tuple({
    topic: Cl.stringAscii("grant-authorization"),
    "signer-manager": Cl.contractPrincipal(addr, name),
    "auth-id": Cl.uint(authId),
  }));
  return sha256(Buffer.concat([SIP018, domain, struct]));
}

const signerPriv = secp256k1.utils.randomSecretKey
  ? secp256k1.utils.randomSecretKey()
  : crypto.randomBytes(32);
const signerPub = secp256k1.getPublicKey(signerPriv, true); // 33-byte compressed

/** 65-byte recoverable signature: r||s||recovery-id, as secp256k1-recover? wants.
 *  This @noble/curves build returns a bare 64-byte compact signature with no
 *  recovery bit, so the id is discovered by trying it -- a rejected grant rolls
 *  back, so nothing is consumed by the miss. */
function compactSig(hash: Buffer): Buffer {
  const sig = secp256k1.sign(hash, signerPriv, { prehash: false });
  return Buffer.from(sig as any);
}

/** Register juice-pool-stx-signer in pox-5 through the real grant path.
 *  ERR_INVALID_SIGNATURE_PUBKEY u14 just means the recovery id was the other one. */
function registerSigner(authId = 1) {
  const hash = grantMessageHash(SIGNER, authId);
  const compact = compactSig(hash);
  let last: any;
  for (const rec of [0, 1]) {
    const sig = Buffer.concat([compact, Buffer.from([rec])]);
    last = simnet.callPublicFn(SIGNER, "register-self",
      [Cl.contractPrincipal(POOL_DEPLOYER, POOL_NAME),
       Cl.bufferFromHex(Buffer.from(signerPub).toString("hex")),
       Cl.uint(authId),
       Cl.bufferFromHex(sig.toString("hex"))],
      POOL_DEPLOYER); // the signer's admin is its deployer
    if (Cl.prettyPrint(last.result).startsWith("(ok")) return last;
  }
  return last;
}

function onboarded() {
  expect(simnet.callPublicFn(CORE, "set-verified-contract",
    [Cl.contractPrincipal(WD, WALLET_NAME), Cl.none()], D).result).toBeOk(Cl.bool(true));
  expect(simnet.callPublicFn(WALLET, "onboard",
    [pubkeyCV, Cl.principal(OWNER), Cl.principal(RECOVERY),
     Cl.uint(STX_THRESHOLD), Cl.uint(SBTC_THRESHOLD), Cl.uint(MIN_COOLDOWN)],
    FAKFUN_DEPLOYER).result).toBeOk(Cl.bool(true));
}
const fundSTX = (n = 3_000_000_000) => simnet.transferSTX(n, WALLET, DEPLOYER);

const TELEGRAM = Buffer.from("telegram:@juice_staker", "utf8");
const TELEGRAM_CV = Cl.some(Cl.buffer(TELEGRAM));
const TELEGRAM_HEX = `0x${TELEGRAM.toString("hex")}`;
const OTHER_CV = Cl.some(Cl.buffer(Buffer.from("telegram:@someone_else", "utf8")));
const E_INVALID_SIG = 4002;

function prints(events: any[], contract: string): string[] {
  return events
    .filter((e) => e.event === "print_event" && e.data.contract_identifier === contract)
    .map((e) => Cl.prettyPrint(e.data.value));
}
function poolValidate(events: any[]): string[] {
  return prints(events, SIGNER).filter((p) => p.includes('topic: "validate-stake"'));
}
function safeEvent(events: any[], name: string): string[] {
  return prints(events, WALLET).filter((p) => p.includes(`event: "${name}"`));
}

describe("v8 signer-calldata: stake", () => {
  it("admin stake with some calldata reaches the pool print and the safe event", () => {
    // arrange
    registerSigner(); onboarded(); fundSTX();

    // act
    const r = simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(STAKE), Cl.none(), Cl.none(), TELEGRAM_CV], OWNER);

    // assert
    expect(r.result).toBeOk(Cl.bool(true));
    const pool = poolValidate(r.events);
    expect(pool).toHaveLength(1);
    expect(pool[0]).toContain(`signer-calldata: (some ${TELEGRAM_HEX})`);
    expect(pool[0]).toContain(`staker: '${WALLET}`);
    const safe = safeEvent(r.events, "stake-stx-juice");
    expect(safe).toHaveLength(1);
    expect(safe[0]).toContain(`signer-calldata: (some ${TELEGRAM_HEX})`);
  });

  it("stake with none prints none in both places", () => {
    // arrange
    registerSigner(); onboarded(); fundSTX();

    // act
    const r = simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(STAKE), Cl.none(), Cl.none(), Cl.none()], OWNER);

    // assert
    expect(r.result).toBeOk(Cl.bool(true));
    expect(poolValidate(r.events)[0]).toContain("signer-calldata: none");
    expect(safeEvent(r.events, "stake-stx-juice")[0]).toContain("signer-calldata: none");
  });

  it("passkey stake: the signature binds the calldata (helpers-v2)", () => {
    // arrange: the passkey signs {auth-id, amount-ustx, signer-calldata: X}
    registerSigner(); onboarded(); fundSTX();
    const auth = sign(topic("stake-stx-juice-pox5", {
      "auth-id": Cl.uint(1), "amount-ustx": Cl.uint(STAKE), "signer-calldata": TELEGRAM_CV,
    }), 1);
    const stake = (calldata: any) => simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(STAKE), Cl.some(auth), Cl.none(), calldata], RELAYER);

    // act + assert: a relayer swapping in calldata Y, or stripping it, is u4002
    const swapped = stake(OTHER_CV);
    expect(swapped.result).toBeErr(Cl.uint(E_INVALID_SIG));
    expect(poolValidate(swapped.events)).toHaveLength(0);
    expect(stake(Cl.none()).result).toBeErr(Cl.uint(E_INVALID_SIG));

    // act + assert: the signed calldata X goes through (auth-id 1 was not burned)
    const r = stake(TELEGRAM_CV);
    expect(r.result).toBeOk(Cl.bool(true));
    expect(poolValidate(r.events)[0]).toContain(`signer-calldata: (some ${TELEGRAM_HEX})`);
    expect(safeEvent(r.events, "stake-stx-juice")[0]).toContain(`signer-calldata: (some ${TELEGRAM_HEX})`);
  });

  it("passkey stake signed over none rejects any attached calldata", () => {
    // arrange
    registerSigner(); onboarded(); fundSTX();
    const auth = sign(topic("stake-stx-juice-pox5", {
      "auth-id": Cl.uint(1), "amount-ustx": Cl.uint(STAKE), "signer-calldata": Cl.none(),
    }), 1);

    // act + assert
    expect(simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(STAKE), Cl.some(auth), Cl.none(), TELEGRAM_CV], RELAYER).result)
      .toBeErr(Cl.uint(E_INVALID_SIG));
    const r = simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(STAKE), Cl.some(auth), Cl.none(), Cl.none()], RELAYER);
    expect(r.result).toBeOk(Cl.bool(true));
    expect(poolValidate(r.events)[0]).toContain("signer-calldata: none");
  });

  it("refuses calldata over 500 bytes", () => {
    // arrange
    registerSigner(); onboarded(); fundSTX();

    // act + assert
    expect(() => simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(STAKE), Cl.none(), Cl.none(), Cl.some(Cl.buffer(Buffer.alloc(501, 1)))], OWNER))
      .toThrow();
  });
});

describe("v8 signer-calldata: update-stake", () => {
  it("admin top-up with some calldata reaches the pool print and the safe event", () => {
    // arrange
    registerSigner(); onboarded(); fundSTX();
    expect(simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(STAKE), Cl.none(), Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));

    // act
    const r = simnet.callPublicFn(WALLET, "update-stake-stx-juice",
      [Cl.uint(100_000_000), Cl.uint(0), Cl.none(), Cl.none(), TELEGRAM_CV], OWNER);

    // assert
    expect(r.result).toBeOk(Cl.bool(true));
    const pool = poolValidate(r.events);
    expect(pool).toHaveLength(1);
    expect(pool[0]).toContain(`signer-calldata: (some ${TELEGRAM_HEX})`);
    const safe = safeEvent(r.events, "update-stake-stx-juice");
    expect(safe).toHaveLength(1);
    expect(safe[0]).toContain(`signer-calldata: (some ${TELEGRAM_HEX})`);
  });

  it("passkey top-up: the signature binds the calldata (helpers-v2)", () => {
    // arrange
    registerSigner(); onboarded(); fundSTX();
    expect(simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(STAKE), Cl.none(), Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
    const auth = sign(topic("update-stake-stx-juice", {
      "auth-id": Cl.uint(1), "amount-increase": Cl.uint(100_000_000), "cycles-to-extend": Cl.uint(0),
      "signer-calldata": TELEGRAM_CV,
    }), 1);
    const update = (calldata: any) => simnet.callPublicFn(WALLET, "update-stake-stx-juice",
      [Cl.uint(100_000_000), Cl.uint(0), Cl.some(auth), Cl.none(), calldata], RELAYER);

    // act + assert: calldata Y or none against a signature over X is u4002
    expect(update(OTHER_CV).result).toBeErr(Cl.uint(E_INVALID_SIG));
    expect(update(Cl.none()).result).toBeErr(Cl.uint(E_INVALID_SIG));

    // act
    const r = update(TELEGRAM_CV);

    // assert
    expect(r.result).toBeOk(Cl.bool(true));
    expect(poolValidate(r.events)[0]).toContain(`signer-calldata: (some ${TELEGRAM_HEX})`);
    expect(safeEvent(r.events, "update-stake-stx-juice")[0])
      .toContain(`signer-calldata: (some ${TELEGRAM_HEX})`);
  });
});
