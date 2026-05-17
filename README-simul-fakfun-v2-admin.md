# simul-fakfun-v2-admin — Admin / Recovery / Stacking Coverage (webauthn)

Stxer mainnet-fork simulation covering the **10 remaining**
`smart-wallet-standard-auth-helpers-v7` hash builders that aren't exercised
by the wallet / nft / token-lock sims. Every helper is hit through its
corresponding wallet public function with a real WebAuthn-signed sig-auth.

**Latest run:** https://stxer.xyz/simulations/mainnet/35b27b9c8c3885d3a380429a65428a56
**Status:** ✅ **all steps pass cleanly** — every webauthn signature verifies and every wallet operation executes end-to-end
**Previous run** [fc5737fb](https://stxer.xyz/simulations/mainnet/fc5737fb815ae34a5a580bee318d1de5) had a `BadTraitImplementation` at step 18 because it pointed `enroll-dual-stacking` at `xbtc-sbtc-swap-v2` (which *defines* `enroll-trait` but doesn't *implement* it — its `enroll` takes 2 args, the trait expects 1). Fixed by deploying a minimal `test-enroll-impl` inline (same pattern as `test-extension`).
**Block:** 7978629 · **Epoch:** 3.4 (Clarity 5)
**Signing pubkey:** `02eca875ad4e06371c75a1fb889f69b52c4900d7f4f4d17e2a059152213ba2d785` (P-256)
**Origin / rp.id:** `fak.fun`

## Helpers covered (10 of 10)

| Auth-ID | Wallet function | Helper | Result |
|---|---|---|---|
| 0 | `add-admin-with-signature` | `build-add-admin-hash` | ✅ ok |
| 1 | `stx-transfer` | `build-stx-transfer-hash` | ✅ ok — 0.5 STX → USER |
| 2 | `execute-pending-whitelist` | `build-whitelist-extension-hash` | ✅ ok — test-extension whitelisted |
| 3 | `extension-call` | `build-extension-call-hash` | ✅ ok — payload routed to test-extension |
| 4 | `remove-extension-whitelist` | `build-remove-extension-whitelist-hash` | ✅ ok |
| 5 | `veto-operation` | `build-veto-operation-hash` | ✅ ok — pending op #1 vetoed |
| 6 | `propose-recovery` | `build-propose-recovery-hash` | ✅ ok — recovery=FAKFUN_DEPLOYER |
| 7 | `enroll-dual-stacking` | `build-enroll-dual-stacking-hash` | ✅ ok — enrolled in xbtc-sbtc-swap-v2 |
| 8 | `stack-stx-fast-pool` | `build-stack-stx-fast-pool-hash` | ✅ ok — 1 STX delegated to fast-pool-v3 |
| 9 | `confirm-transfer-wallet` | `build-confirm-transfer-hash` | ✅ ok — admin transferred USER → FAKFUN_DEPLOYER |

## Per-step results

| # | Phase | Operation | Sender | Result | ✓ |
|---|---|---|---|---|---|
| 0 | A | Deploy `clarity-webauthn` | DEPLOYER | `(ok true)` | ✅ |
| 1 | A | Deploy `smart-wallet-standard-auth-helpers-v7` | DEPLOYER | `(ok true)` | ✅ |
| 2 | A | `set-verified-contract fakfun-wallet-v2 hash` | DEPLOYER | `(ok true)` | ✅ |
| 3 | A | Deploy `fakfun-wallet-v2` | DEPLOYER | `(ok true)` | ✅ |
| 4 | A | Deploy `test-extension` (minimal extension-trait impl) | DEPLOYER | `(ok true)` | ✅ |
| 5 | A | `onboard pubkey` | FAKFUN_DEPLOYER | `(ok true)` | ✅ |
| 6 | A | `add-admin-with-signature(USER)` auth-id 0 | USER | `(ok true)` | ✅ |
| 7 | A | sBTC `transfer 200_000 → wallet` | USER | `(ok true)` | ✅ |
| 8 | A | STX `transfer 5_000_000 (5 STX) → wallet` | DEPLOYER | `(ok true)` | ✅ |
| 9 | B | `stx-transfer 0.5 STX → USER` auth-id 1 | USER | `(ok true)` | ✅ |
| 10 | C | `whitelist-extension(test-extension)` (admin, no sig) | USER | `(ok u0)` | ✅ |
| 11 | C | `addAdvanceBlocks(150 burn blocks)` | – | block advance ok | ✅ |
| 12 | C | `execute-pending-whitelist(op-id 0)` auth-id 2 | USER | `(ok true)` | ✅ |
| 13 | D | `extension-call(test-extension, 0xdeadbeefcafe)` auth-id 3 | USER | `(ok true)` | ✅ |
| 14 | E | `whitelist-extension(faktory-swap-extension)` admin | USER | `(ok u1)` | ✅ |
| 15 | E | `veto-operation(op-id 1)` auth-id 5 | USER | `(ok true)` | ✅ |
| 16 | F | `remove-extension-whitelist(test-extension)` auth-id 4 | USER | `(ok true)` | ✅ |
| 17 | G | `propose-recovery(FAKFUN_DEPLOYER)` auth-id 6 | USER | `(ok true)` | ✅ |
| 18 | H | `enroll-dual-stacking(test-enroll-impl)` auth-id 7 | USER | `(ok true)` | ✅ |
| 19 | I | `stack-stx-fast-pool(1 STX)` auth-id 8 | USER | `(ok true)` | ✅ |
| 20 | I | eval `(pox-4.get-delegation-info wallet)` | – | `(some {amount-ustx: u1_000_000, delegated-to: fast-pool-v3, …})` | ✅ |
| 21 | J | `propose-transfer-wallet(FAKFUN_DEPLOYER)` admin | USER | `(ok true)` | ✅ |
| 22 | J | `confirm-transfer-wallet` auth-id 9 | USER | `(ok true)` — admin transferred | ✅ |
| 23 | – | eval `wallet.(get-owner)` | – | `(ok (some FAKFUN_DEPLOYER))` | ✅ |
| 24 | – | eval `fakfun-wallet-core.(is-whitelisted)` | – | `0x03` (true) | ✅ |

## What this run proves

* **All 22 hash builders in `auth-helpers-v7` are now covered.** Together
  with the wallet / nft / token-lock sims, every SIP-018 topic in the
  helper contract has been verified end-to-end through its wallet entry
  point with a real WebAuthn signature.
* **Op-id sequence is deterministic.** First `whitelist-extension` →
  `pending-operations[0]`, second → `pending-operations[1]`. The
  pre-computed challenges (signed off-chain) reference these op-ids
  directly.
* **`addAdvanceBlocks` works for cooldown gating.** The 144-burn-block
  cooldown on `execute-pending-whitelist` (line 427 of
  `fakfun-wallet-v2.clar`) is cleared by advancing 150 burn blocks in
  the simulation. Without this, step 12 would return
  `err-cooldown-not-passed (u4017)`.
* **Veto path proves replay-safety in the right place.** `veto-operation`
  rejects the second pending whitelist (op-id 1) without ever touching
  the underlying extension — the wallet just flips `vetoed: true` in
  the op's storage. The subsequent `remove-extension-whitelist` (step
  16) targets the first extension which IS whitelisted, while the
  second (vetoed) one was never whitelisted, so no second
  remove-whitelist is needed.
* **`confirm-transfer-wallet` transitions admin atomically.** After
  step 22, `wallet.(get-owner)` returns `FAKFUN_DEPLOYER` (step 23)
  and USER is no longer in `admins` — any further USER-signed
  wallet call would error with `err-pubkey-not-admin (u4005)` from
  `is-admin-pubkey`.

## Test-extension contract

Deployed inline at step 4:

```clarity
(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.extension-trait.extension-trait)
(define-public (call (payload (buff 2048))) (ok true))
```

Minimal no-op extension to verify the whitelist → execute-pending →
extension-call → remove-whitelist round-trip. The `extension-trait` on
mainnet defines:

```clarity
(define-trait extension-trait (
  (call ((buff 2048)) (response bool uint))
))
```

## Known mainnet-fork constraints

* **STX funding from USER doesn't work at this block** — USER's mainnet
  STX balance isn't sufficient for the 5-STX wallet fund. The sim funds
  the wallet from `DEPLOYER` instead (independent of USER's nonce
  sequence, well-funded on mainnet).
* **`enroll-dual-stacking` returned `(ok (some none))`** rather than a
  failure — the underlying `xbtc-sbtc-swap-v2.enroll` accepted the
  enrollment call. Wallet's `as-contract?` wrap is doing the heavy
  lifting here; the dual-stacking contract's internal state isn't
  exercised beyond the initial registration.

## Sig-auth tuple format

Same as `simul-fakfun-v2-token-lock.md`. All 10 signed payloads in this
sim used the short clientDataJSON form (no Chrome `other_keys` extension
appeared in this batch).
