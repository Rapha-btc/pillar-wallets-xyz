# simul-fakfun-v2-wager — wager-deposit Cross-Curve Bridge

Stxer mainnet-fork simulation covering `fakfun-wallet-v2.wager-deposit`, the
last untested public function. This is the only place in the wallet that
bridges **two distinct signing schemes** in a single transaction.

**Latest run:** https://stxer.xyz/simulations/mainnet/ca433deb9e02b49f3fdf3299a767a56e
**Status:** ✅ all 13 steps pass — 1000 sats sBTC deposited into game-wager-v1 escrow
**Block:** 7979433 · **Epoch:** 3.4 (Clarity 5)

## What this proves

* `wager-deposit` correctly bridges two signing keys:
  1. **WebAuthn / secp256r1** — the user's wallet passkey signs the
     `wager-deposit` `sig-auth` tuple (challenge built by
     `SP28MP1H….auth-v7.build-wager-deposit-hash`).
  2. **secp256k1** — a separate keypair the user registers in
     `SP28MP1H….game-wager-v1.register-wallet` (challenge built by
     `auth-v7.build-register-wallet-hash`, verified by Clarity's
     `secp256k1-recover?` in RSV format).
* The wallet's authority check passes (`is-authorized` consumes the
  webauthn sig).
* The wallet's `(asserts! (is-eq (some current-contract) (game-wager
  get-registered-wallet pubkey)))` passes — the secp256k1 pubkey is
  registered to the wallet contract.
* The wallet wraps `(game-wager-v1.deposit token amount pubkey)` in
  `as-contract?`, so the sBTC transfer moves from the WALLET (not the
  user's EOA) into game-wager-v1's custody.
* `game-wager-v1.deposit` credits the pubkey's balance: post-sim
  `(get-balance 0x033eef… '.sbtc-token)` returns `u1000`.

## Auth domains in play

| Domain | Where it lives | Used for |
|---|---|---|
| `auth-helpers-v7` (smart-wallet-standard) | `SPV9K21….smart-wallet-standard-auth-helpers-v7` | Every wallet sig-auth EXCEPT wager-deposit |
| `auth-v7` (game-wager) | `SP28MP1H….auth-v7` | wager-deposit + game-wager register-wallet |

`auth-v7.get-domain-hash` shape: `{chain-id, contract: game-wager-v1, name:
"game-wager", version: "1.0.0"}` — completely separate from the
smart-wallet-standard domain.

## Hardcoded secp256k1 keypair

Used to register the wallet in game-wager-v1. Stable across sim runs so
the webauthn challenge for `wager-deposit` (which embeds this pubkey)
stays constant and the user signs once.

```
privkey: 945994b4e05d50847dad2f8e34e3d86bc3e6d0f2958bfd22f7b2d1f3e1974cd9
pubkey:  033eef2296419524fe6ccc6c968b7a217bb76aad6b2b68e776e2ef4bf044a6a3d4
```

The privkey is publicly committed — this is a TEST identity only. Real
users would generate keys client-side.

## Per-step results

| # | Phase | Operation | Sender | Result | ✓ |
|---|---|---|---|---|---|
| 0 | A | Deploy clarity-webauthn | DEPLOYER | `(ok true)` | ✅ |
| 1 | A | Deploy auth-helpers-v7 | DEPLOYER | `(ok true)` | ✅ |
| 2 | A | set-verified-contract | DEPLOYER | `(ok true)` | ✅ |
| 3 | A | Deploy fakfun-wallet-v2 | DEPLOYER | `(ok true)` | ✅ |
| 4 | A | onboard pubkey | FAKFUN_DEPLOYER | `(ok true)` | ✅ |
| 5 | A | add-admin-with-signature (auth-id 0 reused) | USER | `(ok true)` | ✅ |
| 6 | A | sBTC transfer 100k → wallet | USER | `(ok true)` | ✅ |
| 7 | B | `game-wager-v1.set-token-whitelist(sBTC, true)` | **SP28MP1H_DEPLOYER** | `(ok true)` | ✅ |
| 8 | C | `game-wager-v1.register-wallet` (secp256k1 sig in RSV form, in-script) | USER (tx-sender; secp256k1 sig recovers to test pubkey) | `(ok true)` | ✅ |
| 9 | C | eval `(get-registered-wallet 0x033eef…)` | – | `(some 'SPV9K21….fakfun-wallet-v2)` | ✅ |
| 10 | D | `wallet.wager-deposit(sBTC, "sbtc-token", 1000, pubkey, sig-auth-20, none)` | USER | `(ok true)` — 1000 sats sBTC transferred WALLET → game-wager-v1 | ✅ |
| 11 | – | eval wallet `(get-owner)` | – | `(ok (some USER))` | ✅ |
| 12 | – | eval `(game-wager-v1.get-balance 0x033eef… '.sbtc-token)` | – | `u1000` | ✅ |

## Why this test is unusual

Most v2 wallet tests verify one signed payload per call. wager-deposit
needs **both** signatures correctly handled:

1. The wallet's `match sig-auth` branch builds the message-hash via
   `auth-v7.build-wager-deposit-hash` (NOT the local auth-helpers-v7).
   `is-authorized` then runs through `verify-signature` →
   `clarity-webauthn.verify-webauthn-signature` →
   `secp256r1-verify`. Standard webauthn path, just with an
   externally-built challenge.
2. **After** sig verification, the wallet runs `(asserts! (is-eq (some
   current-contract) (contract-call? game-wager-v1 get-registered-wallet
   pubkey)) err-unauthorised)` — meaning the secp256k1 registration
   must have happened first AND must map to this wallet contract.
3. Then `as-contract?` switches tx-sender to the wallet contract, and
   the wallet calls `game-wager-v1.deposit`. From game-wager's
   perspective, the depositor is the wallet contract; the
   credit-balance is keyed by the user's secp256k1 pubkey.

The secp256k1 sig is computed in the JS sim (no user interaction
needed) because it's effectively a one-time onboarding action that a
backend could do on the user's behalf. The webauthn sig over the
wager-deposit challenge is the per-deposit authorization that the user
must produce.

## Coverage status after this sim

**`fakfun-wallet-v2` public functions: 39 of 39 tested.** Every public
function has been exercised end-to-end through at least one stxer
mainnet-fork simulation:

| Sim | Stxer URL | Functions newly covered |
|---|---|---|
| `simul-fakfun-v2-wallet` | [62ce078c](https://stxer.xyz/simulations/mainnet/62ce078cc225101d055578fdf9fce7dd) | faktory ops (execute/place-order/process/claim/airdrop/burn-bob/stack-stx-juice/revoke-stacking) + add-admin |
| `simul-fakfun-v2-nft` | [193cc8d5](https://stxer.xyz/simulations/mainnet/193cc8d5ff49ff6b8c7ab42ab81390ce) | faktory-nft-execute + sip009-transfer + whitelist/extension-call/remove |
| `simul-fakfun-v2-token-lock` | [29cbbb44](https://stxer.xyz/simulations/mainnet/29cbbb44b7b4cf3332bbefca3c63086f) | toggle-token-lock (sig and admin paths) + sip010-transfer + assert-locked branches |
| `simul-fakfun-v2-admin` | [fc5737fb](https://stxer.xyz/simulations/mainnet/fc5737fb815ae34a5a580bee318d1de5) | stx-transfer + extension flow + veto + propose-recovery + enroll-dual-stacking + stack-stx-fast-pool + confirm-transfer |
| `simul-fakfun-v2-governance` | [f56c6525](https://stxer.xyz/simulations/mainnet/f56c6525110605ddf73944a960fd66d4) | config + cooldown + pubkey rotation + threshold-breach pending paths + confirm-recovery + recover-inactive-wallet |
| `simul-fakfun-v2-limit` | [ab4c481f](https://stxer.xyz/simulations/mainnet/ab4c481f8099b2e450c7be26b3de5e6f) | faktory-execute-limit (happy + replay + not-hit + retryable + expired) + token-lock-in-extension-call |
| **`simul-fakfun-v2-wager`** | **[ca433deb](https://stxer.xyz/simulations/mainnet/ca433deb9e02b49f3fdf3299a767a56e)** | **wager-deposit + game-wager cross-curve bridge** |

Auth-helpers coverage:
* `smart-wallet-standard-auth-helpers-v7` — 23/23 hash builders tested
* `auth-v7` (game-wager) — 2/2 hash builders tested
  (`build-register-wallet-hash` in-script, `build-wager-deposit-hash`
  end-to-end through the wallet)
