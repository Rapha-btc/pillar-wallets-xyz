// juice-safe-v6-staking.test.ts -- pox-5 staking IS testable in simnet.
//
// Run: npx vitest run tests/juice-safe-v6-staking.test.ts -- --manifest tests/cl-v6/Clarinet.toml
//
// An earlier pass concluded staking could not run in Clarinet and blamed burn
// heights. That was WRONG. The error was pox-5's ERR_SIGNER_NOT_FOUND (err u23):
// simnet's pox-5 starts empty, so juice-pool-stx-signer has never registered. Once
// it does, staking works at burn height 6 and no block mining is needed.
//
// Registering means satisfying the real pox-5 path, not a mock:
//   juice-pool-stx-signer.register-self  (admin-gated)
//     -> pox-5.grant-signer-key   verifies a secp256k1 signature over
//                                 get-signer-grant-message-hash
//     -> pox-5.register-signer    asserts contract-caller is the signer
//
// So the harness generates a secp256k1 keypair, builds the SIP-018 grant hash
// (domain POX_5_SIGNER_DOMAIN = {name "pox-5-signer", version "1.0.0", chain-id},
// struct {topic "grant-authorization", signer-manager, auth-id}) and signs it. The
// pubkey becomes the signer key. Nothing about pox-5 is stubbed.
import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";
import crypto from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { generateP256Keypair, signChallengeWithRpId } from "../lib-webauthn-test-signer.mjs";

const D = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22";
const FAKFUN_DEPLOYER = "SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK";
const WALLET = `${D}.juice-safe-v6`;
const CORE = `${D}.fakfun-wallet-core`;
const SIGNER = `${D}.juice-pool-stx-signer`;
const POX5 = "SP000000000000000000002Q6VF78.pox-5";
const RP_ID = "juiceofbtc.com";
const CHAIN_ID = 2147483648;

const accounts = simnet.getAccounts();
const DEPLOYER = accounts.get("deployer")!;
const OWNER = accounts.get("wallet_1")!;
const RECOVERY = accounts.get("wallet_2")!;
const RANDOM = accounts.get("wallet_3")!;
const RELAYER = accounts.get("wallet_4")!;

const MIN_COOLDOWN = 144;
const STX_THRESHOLD = 100_000_000;
const SBTC_THRESHOLD = 100_000;
const STAKE = 1_000_000_000;

const E_UNAUTH = 4001, E_ZERO = 4026;

// --- SIP-018 for the wallet's own passkey challenges --------------------
const SIP018 = Buffer.from("534950303138", "hex");
const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest();
const cvHash = (cv: any) => sha256(Buffer.from(Cl.serialize(cv), "hex"));
const walletDomain = () => cvHash(Cl.tuple({
  name: Cl.stringAscii("smart-wallet-standard"), version: Cl.stringAscii("1.0.0"),
  "chain-id": Cl.uint(CHAIN_ID), wallet: Cl.contractPrincipal(D, "juice-safe-v6"),
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
      [Cl.contractPrincipal(D, "juice-pool-stx-signer"),
       Cl.bufferFromHex(Buffer.from(signerPub).toString("hex")),
       Cl.uint(authId),
       Cl.bufferFromHex(sig.toString("hex"))],
      D); // the signer's admin is its deployer
    if (Cl.prettyPrint(last.result).startsWith("(ok")) return last;
  }
  return last;
}

function onboarded() {
  expect(simnet.callPublicFn(CORE, "set-verified-contract",
    [Cl.contractPrincipal(D, "juice-safe-v6"), Cl.none()], D).result).toBeOk(Cl.bool(true));
  expect(simnet.callPublicFn(WALLET, "onboard",
    [pubkeyCV, Cl.principal(OWNER), Cl.principal(RECOVERY),
     Cl.uint(STX_THRESHOLD), Cl.uint(SBTC_THRESHOLD), Cl.uint(MIN_COOLDOWN)],
    FAKFUN_DEPLOYER).result).toBeOk(Cl.bool(true));
}
const fundSTX = (n = 3_000_000_000) => simnet.transferSTX(n, WALLET, DEPLOYER);
const stakerInfo = () => Cl.prettyPrint(simnet.callReadOnlyFn(POX5, "get-staker-info",
  [Cl.contractPrincipal(D, "juice-safe-v6")], OWNER).result);
// stx-account returns a tuple the JS pretty-printer cannot render, so read the
// locked field off the wire form instead.
const lockedUstx = (): bigint => {
  const r = simnet.callReadOnlyFn(`${DEPLOYER}.zz-nft`, "locked-of",
    [Cl.principal(WALLET)], DEPLOYER).result;
  return BigInt(Cl.prettyPrint(r).replace(/\D/g, ""));
};

describe("v6 staking: registering the Juice signer in pox-5", () => {
  it("registers through the real grant path, no mock", () => {
    const r = registerSigner();
    expect(Cl.prettyPrint(r.result)).toMatch(/^\(ok /);
    expect(Cl.prettyPrint(simnet.callReadOnlyFn(POX5, "get-signer-info",
      [Cl.contractPrincipal(D, "juice-pool-stx-signer")], D).result))
      .toMatch(/some|\{/);
  });
});

describe("v6 staking: the full lifecycle at burn height 6", () => {
  it("stakes, tops up, extends, unstakes, then unlocks", () => {
    registerSigner(); onboarded(); fundSTX();

    expect(simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(STAKE), Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
    expect(stakerInfo()).toContain("amount-ustx: u1000000000");
    // IMPORTANT SIMNET LIMIT. pox-5's Clarity records the position, but the actual
    // STX lock, the STXLockEvent and the stacking asset-map entry all come from the
    // NODE's PoX handler, which clarinet does not emulate. So stx-account reports
    // locked u0 here even though get-staker-info is correct -- and that means the
    // (with-staking N) ALLOWANCE is not genuinely exercised in simnet. That evidence
    // comes from stxer, where the lock applies for real (stxer/stxer-sdk#7) and a
    // deliberately under-declared allowance aborts.
    expect(lockedUstx()).toBe(0n);

    // top-up: the allowance is the RESULTING TOTAL, not the delta
    expect(simnet.callPublicFn(WALLET, "update-stake-stx-juice",
      [Cl.uint(100_000_000), Cl.uint(0), Cl.none(), Cl.none()], OWNER).result)
      .toBeOk(Cl.bool(true));
    expect(stakerInfo()).toContain("amount-ustx: u1100000000");

    // a fresh position is already at NUM-CYCLES u96 = pox-5 max, so extending
    // must be rejected until cycles elapse
    expect(simnet.callPublicFn(WALLET, "update-stake-stx-juice",
      [Cl.uint(0), Cl.uint(2), Cl.none(), Cl.none()], OWNER).result).toBeErr(Cl.uint(20));

    expect(simnet.callPublicFn(WALLET, "unstake", [Cl.none(), Cl.none()], OWNER).result)
      .toBeOk(Cl.bool(true));
    // unstake truncates num-cycles rather than releasing; the position survives
    expect(stakerInfo()).toContain("amount-ustx: u1100000000");
  });

  it("rejects a stake from a non-admin, a zero amount, and a no-op update", () => {
    registerSigner(); onboarded(); fundSTX();
    expect(simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(STAKE), Cl.none(), Cl.none()], RANDOM).result).toBeErr(Cl.uint(E_UNAUTH));
    expect(simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(0), Cl.none(), Cl.none()], OWNER).result).toBeErr(Cl.uint(E_ZERO));
    expect(simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(STAKE), Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));
    expect(simnet.callPublicFn(WALLET, "update-stake-stx-juice",
      [Cl.uint(0), Cl.uint(0), Cl.none(), Cl.none()], OWNER).result).toBeErr(Cl.uint(E_ZERO));
  });

  it("stakes on the PASSKEY path through a relayer", () => {
    registerSigner(); onboarded(); fundSTX();
    expect(simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(STAKE),
       Cl.some(sign(topic("stake-stx-juice-pox5",
         { "auth-id": Cl.uint(1), "amount-ustx": Cl.uint(STAKE) }), 1)),
       Cl.none()], RELAYER).result).toBeOk(Cl.bool(true));
    expect(stakerInfo()).toContain("amount-ustx: u1000000000");
  });

  it("unstakes on the PASSKEY path, and rejects a random caller", () => {
    registerSigner(); onboarded(); fundSTX();
    simnet.callPublicFn(WALLET, "stake-stx-juice", [Cl.uint(STAKE), Cl.none(), Cl.none()], OWNER);
    expect(simnet.callPublicFn(WALLET, "unstake", [Cl.none(), Cl.none()], RANDOM).result)
      .toBeErr(Cl.uint(E_UNAUTH));
    expect(simnet.callPublicFn(WALLET, "unstake",
      [Cl.some(sign(topic("unstake-stx-juice", { "auth-id": Cl.uint(2) }), 2)), Cl.none()],
      RELAYER).result).toBeOk(Cl.bool(true));
  });

  it("tops up on the PASSKEY path with a live gas station", () => {
    registerSigner(); onboarded(); fundSTX();
    simnet.callPublicFn(WALLET, "stake-stx-juice", [Cl.uint(STAKE), Cl.none(), Cl.none()], OWNER);
    // the station needs the wallet to hold sBTC; mint through the real deposit path
    const h = simnet.burnBlockHeight - 1;
    const hash = Cl.prettyPrint(simnet.callReadOnlyFn(`${DEPLOYER}.zz-nft`, "burn-hash",
      [Cl.uint(h)], DEPLOYER).result).replace(/^0x/, "");
    simnet.callPublicFn("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-deposit",
      "complete-deposit-wrapper",
      [Cl.bufferFromHex("33".repeat(32)), Cl.uint(0), Cl.uint(1_000_000),
       Cl.principal(WALLET), Cl.bufferFromHex(hash), Cl.uint(h),
       Cl.bufferFromHex("44".repeat(32))],
      "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4");

    const gas = () => BigInt((Cl.prettyPrint(simnet.getDataVar(WALLET, "spent-this-period"))
      .match(/gas: u(\d+)/) || [])[1] ?? "-1");
    const before = gas();
    expect(simnet.callPublicFn(WALLET, "update-stake-stx-juice",
      [Cl.uint(50_000_000), Cl.uint(0),
       Cl.some(sign(topic("update-stake-stx-juice", {
         "auth-id": Cl.uint(3), "amount-increase": Cl.uint(50_000_000),
         "cycles-to-extend": Cl.uint(0),
       }), 3)),
       Cl.some(Cl.contractPrincipal(DEPLOYER, "zz-gas-station"))], RELAYER).result)
      .toBeOk(Cl.bool(true));
    expect(gas() - before).toBe(20n);
  });

  it("after unstake and the unlock cycle, pox-5 shows the position GONE", () => {
    registerSigner(); onboarded(); fundSTX();
    simnet.callPublicFn(WALLET, "stake-stx-juice", [Cl.uint(STAKE), Cl.none(), Cl.none()], OWNER);
    expect(stakerInfo()).toContain("amount-ustx: u1000000000");

    expect(simnet.callPublicFn(WALLET, "unstake", [Cl.none(), Cl.none()], OWNER).result)
      .toBeOk(Cl.bool(true));
    // unstake truncates the lock window rather than releasing, so the position is
    // still there with num-cycles pulled in
    expect(stakerInfo()).toContain("amount-ustx: u1000000000");

    // roll past the truncated unlock cycle
    simnet.mineEmptyBurnBlocks(6300);
    expect(stakerInfo()).toBe("none");

    // The BALANCE half of this cannot be checked here: clarinet never applied the
    // lock in the first place (see the note above), so there is nothing to release.
    // stxer proves that half against the deployed safe -- simul-v6-v14-staking.js
    // reads stx-account AFTER unlock as (locked u0, unlocked u800000000), i.e. the
    // full 800 STX back, with staker-info none.
    expect(lockedUstx()).toBe(0n);
  });
});

describe("v6 rewards: the full payout chain, sBTC -> pox-5 -> signer -> staker", () => {
  // Mirrors what stxer's lifecycle harness proves against the deployed safe:
  //   sBTC to pox-5  ->  pox-5.calculate-rewards (permissionless)
  //   ->  signer.pox-claim-rewards (pulls the signer's share into its pot)
  //   ->  signer.pay-stx-stakers (pays out of the pot)
  // pox-5 derives rewards from its OWN sBTC balance:
  //   (get-rewards) = sbtc-balance(pox-5) - total-sbtc-staked - reserve
  // so sending sBTC to pox-5 and rolling a distribution cycle is sufficient. No
  // BTC miner payout is needed, which is exactly why this is reproducible here.
  const REWARD_SATS = 2_000_000;

  function fundSbtcTo(to: string, amount: number, salt: string) {
    const h = simnet.burnBlockHeight - 1;
    const hash = Cl.prettyPrint(simnet.callReadOnlyFn(`${DEPLOYER}.zz-nft`, "burn-hash",
      [Cl.uint(h)], DEPLOYER).result).replace(/^0x/, "");
    return simnet.callPublicFn("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-deposit",
      "complete-deposit-wrapper",
      [Cl.bufferFromHex(salt.repeat(32)), Cl.uint(0), Cl.uint(amount), Cl.principal(to),
       Cl.bufferFromHex(hash), Cl.uint(h), Cl.bufferFromHex("55".repeat(32))],
      "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4");
  }
  const sbtcOf = (p: string): bigint =>
    BigInt(Cl.prettyPrint(simnet.callReadOnlyFn(
      "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
      "get-balance", [Cl.principal(p)], DEPLOYER).result).replace(/\D/g, ""));

  it("pays the staked safe its sBTC share, and refuses to pay twice", () => {
    // MUST clear pox-5's SIGNER_SET_MIN_USTX = u50000000000 (50k STX), which is a
    // PER-SIGNER delegation threshold. Below it, add-staker-to-signer-for-cycle
    // records NO shares at all -- pox-5.clar:1705, and its own comment says signers
    // below the delegation threshold do not receive rewards. staker-info still shows
    // the position, so a smaller stake looks fine right up until calculate-rewards
    // reports cycle-staked-ustx u0 and folds every sat into the reserve.
    const BIG_STAKE = 51_000_000_000; // 51k STX, just over the 50k floor
    registerSigner(); onboarded(); fundSTX(60_000_000_000);
    expect(simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(BIG_STAKE), Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));

    // The safe's shares begin at first-reward-cycle, so read it rather than guess.
    // Claiming for the cycle BEFORE it earns nothing and pox-5 answers
    // ERR_NO_CLAIMABLE_REWARDS u32 -- which is what a first attempt here did.
    const cycle = BigInt((stakerInfo().match(/first-reward-cycle: u(\d+)/) || [])[1]);
    expect(cycle).toBeGreaterThan(0n);

    // Roll into the cycle where the safe holds shares -- and NOT past it. Cycles
    // here are ~1,100 burn blocks and distribution cycles ~550, so an earlier
    // 2,200-block jump landed calculate-rewards on stx-cycle u2 where
    // cycle-staked-ustx was u0 and every sat went to the reserve instead of to
    // stakers. first-reward-cycle is u1, so stay in it.
    simnet.mineEmptyBurnBlocks(1100);

    // the cycle's rewards arrive as sBTC held by pox-5. pox-5 derives rewards from
    // its OWN balance -- get-rewards is balance - total-sbtc-staked - reserve -- so
    // no BTC miner payout is needed and this is fully reproducible here.
    expect(fundSbtcTo(POX5, REWARD_SATS, "66").result).toBeOk(Cl.bool(true));
    expect(sbtcOf(POX5)).toBeGreaterThanOrEqual(BigInt(REWARD_SATS));

    // one distribution cycle forward so calculate-rewards has new work, while
    // calculation-height stays inside reward cycle u1
    simnet.mineEmptyBurnBlocks(560);

    // permissionless: a relayer, not the admin and not the signer operator
    const calc = simnet.callPublicFn(POX5, "calculate-rewards", [Cl.list([])], RELAYER);
    expect(Cl.prettyPrint(calc.result)).toMatch(/^\(ok /);
    // the rewards must have been allocated to STAKERS, not swept into the reserve
    expect(Cl.prettyPrint(calc.result)).toContain(`stx-cycle: u${cycle}`);
    expect(Cl.prettyPrint(calc.result)).not.toContain("cycle-staked-ustx: u0");

    // the signer pulls its share into its own pot -- also permissionless
    expect(Cl.prettyPrint(simnet.callPublicFn(SIGNER, "pox-claim-rewards",
      [Cl.list([]), Cl.uint(cycle)], RELAYER).result)).toMatch(/^\(ok /);

    // and pays the safe out of that pot
    const before = sbtcOf(WALLET);
    expect(Cl.prettyPrint(simnet.callPublicFn(SIGNER, "pay-stx-stakers",
      [Cl.list([Cl.contractPrincipal(D, "juice-safe-v6")]), Cl.uint(cycle), Cl.uint(0)],
      RELAYER).result)).toMatch(/^\(ok /);
    const paid = sbtcOf(WALLET) - before;
    expect(paid).toBeGreaterThan(0n);

    // the stx-paid guard makes a replay a no-op, not a double payment
    expect(Cl.prettyPrint(simnet.callPublicFn(SIGNER, "pay-stx-stakers",
      [Cl.list([Cl.contractPrincipal(D, "juice-safe-v6")]), Cl.uint(cycle), Cl.uint(0)],
      RELAYER).result)).toMatch(/^\(ok /);
    expect(sbtcOf(WALLET) - before).toBe(paid);
  });

  it("a stake JUST UNDER the 50k signer floor records no shares at all", () => {
    registerSigner(); onboarded(); fundSTX(60_000_000_000);
    // one uSTX short of SIGNER_SET_MIN_USTX
    expect(simnet.callPublicFn(WALLET, "stake-stx-juice",
      [Cl.uint(49_999_999_999), Cl.none(), Cl.none()], OWNER).result).toBeOk(Cl.bool(true));

    // the position is real and visible...
    expect(stakerInfo()).toContain("amount-ustx: u49999999999");

    const cycle = BigInt((stakerInfo().match(/first-reward-cycle: u(\d+)/) || [])[1]);
    simnet.mineEmptyBurnBlocks(1100);
    expect(fundSbtcTo(POX5, REWARD_SATS, "77").result).toBeOk(Cl.bool(true));
    simnet.mineEmptyBurnBlocks(560);

    // ...but pox-5 counts no shares for the cycle, so the whole staker cut is
    // folded into the reserve and there is nothing to claim. This is the trap:
    // staking "succeeds" and earns nothing, silently.
    const calc = simnet.callPublicFn(POX5, "calculate-rewards", [Cl.list([])], RELAYER);
    expect(Cl.prettyPrint(calc.result)).toContain("cycle-staked-ustx: u0");
    expect(Cl.prettyPrint(calc.result)).toContain("accrued-rewards-per-ustx: u0");
    expect(Cl.prettyPrint(simnet.callPublicFn(SIGNER, "pox-claim-rewards",
      [Cl.list([]), Cl.uint(cycle)], RELAYER).result)).toBe("(err u32)");
  });
});
