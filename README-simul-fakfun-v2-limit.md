# simul-fakfun-v2-limit — Limit Orders + Token-Lock-in-Extension-Call

Stxer mainnet-fork simulation covering the **new `faktory-execute-limit`
primitive** end-to-end and the **token-lock assert that was added to
`extension-call`**.

**Latest run:** https://stxer.xyz/simulations/mainnet/ab4c481f8099b2e450c7be26b3de5e6f
**Status:** ✅ all assertions pass — happy + replay + not-hit + retryable + expired + extension-call-under-lock
**Block:** 7979287 · **Epoch:** 3.4 (Clarity 5)
**Signing pubkey:** `02eca875ad4e06371c75a1fb889f69b52c4900d7f4f4d17e2a059152213ba2d785`
**Pool:** `SPV9K21….pepe-faktory-pool-v2-2` (user-confirmed callable from fresh wallet)

## What this sim proves

1. **`faktory-execute-limit` happy path** — user pre-signs an intent that a
   third party (here, USER acting as relayer) submits later; if the pool
   quote's `dy ≥ limit-out` and the order isn't expired, the swap executes
   and returns the `{dk, dx, dy}` tuple. Wallet's `as-contract?` wrap +
   `try!` unwrap structure works correctly to extract `dy` from the
   response.
2. **Replay protection** — re-submitting an already-consumed signed payload
   returns `err-signature-replay (u4006)`. The `used-pubkey-authorizations`
   map keys on message-hash, so the same `{auth-id, pool, amount, opcode,
   limit-out, expiry}` tuple can't be played twice.
3. **Min-out enforcement** — submitting a limit-order with an unreachable
   `limit-out` returns `err-limit-not-hit (u4025)`. **The sig is NOT
   consumed** because `(asserts! …)` fires after `consume-signature` but
   the entire tx reverts on assert failure → all state writes including
   the map insert are rolled back.
4. **Retryability** — re-submitting the same too-strict intent returns
   `err-limit-not-hit` again. Same sig, same payload, valid. A backend
   relayer can keep retrying as price moves.
5. **Token-lock in extension-call** — after `toggle-token-lock(true)`, a
   signed `extension-call` returns `err-token-locked (u4023)`. The new
   assert inside the `sig-auth-details` branch blocks third-party signed
   broadcasts when the wallet owner has flipped the kill-switch.
6. **Expiry** — after `addAdvanceBlocks(350)` past the order's
   `expiry-burn-block`, the same signed payload returns
   `err-limit-expired (u4024)`. Order can't be executed after its deadline.

## New auth-IDs signed for this sim

| Auth-ID | Topic | Args |
|---|---|---|
| 10 | `faktory-execute-limit` | pool=pepe, amount=100_000, opcode=BUY, limit-out=1, expiry=1_000_000 |
| 11 | `faktory-execute-limit` | pool=pepe, amount=100_000, opcode=BUY, limit-out=10^18, expiry=1_000_000 |
| 12 | `faktory-execute-limit` | pool=pepe, amount=100_000, opcode=BUY, limit-out=1, expiry=950_000 |

## Reused from `signed-bundle-admin.json`

| Auth-ID | Topic | Use here |
|---|---|---|
| 0 | `add-admin` | Phase A bootstrap |
| 2 | `whitelist-extension` (op-id 0, test-extension) | Phase F execute-pending |
| 3 | `extension-call` (test-extension, payload) | Phase H call under lock |

## Per-step results

| # | Phase | Operation | Sender | Result | ✓ |
|---|---|---|---|---|---|
| 0 | A | Deploy clarity-webauthn | DEPLOYER | `(ok true)` | ✅ |
| 1 | A | Deploy auth-helpers-v7 | DEPLOYER | `(ok true)` | ✅ |
| 2 | A | set-verified-contract | DEPLOYER | `(ok true)` | ✅ |
| 3 | A | Deploy fakfun-wallet-v2 | DEPLOYER | `(ok true)` | ✅ |
| 4 | A | Deploy test-extension | DEPLOYER | `(ok true)` | ✅ |
| 5 | A | onboard pubkey | FAKFUN_DEPLOYER | `(ok true)` | ✅ |
| 6 | A | add-admin-with-signature (auth-id 0) | USER | `(ok true)` | ✅ |
| 7 | A | sBTC transfer 1M sats → wallet | USER | `(ok true)` | ✅ |
| 8 | **B** | **faktory-execute-limit HAPPY (auth-id 10)** | USER | `(ok {dk, dx, dy})` — swap succeeds | ✅ |
| 9 | **C** | faktory-execute-limit replay (auth-id 10 again) | USER | `(err u4006)` err-signature-replay | ✅ |
| 10 | **D** | faktory-execute-limit TOO-STRICT (auth-id 11) | USER | `(err u4025)` err-limit-not-hit | ✅ |
| 11 | **E** | faktory-execute-limit too-strict retry | USER | `(err u4025)` again — sig retryable | ✅ |
| 12 | F | whitelist-extension(test-extension) admin | USER | `(ok u0)` (op-id 0 created) | ✅ |
| 13 | F | addAdvanceBlocks(150) | – | ok | ✅ |
| 14 | F | execute-pending-whitelist (auth-id 2) | USER | `(ok true)` | ✅ |
| 15 | G | toggle-token-lock(true) admin | USER | `(ok true)` | ✅ |
| 16 | G | eval (get-token-lock-enabled) | – | `0x03` (true) | ✅ |
| 17 | **H** | **extension-call signed (auth-id 3) under lock** | USER | `(err u4023)` err-token-locked | ✅ |
| 18 | I | toggle-token-lock(false) admin | USER | `(ok true)` | ✅ |
| 19 | I | addAdvanceBlocks(350) past expiry 950_000 | – | ok | ✅ |
| 20 | **J** | **faktory-execute-limit EXPIRED (auth-id 12)** | USER | `(err u4024)` err-limit-expired | ✅ |
| 21 | – | eval (get-token-lock-enabled) | – | `0x04` (false) | ✅ |
| 22 | – | eval (get-owner) | – | `(ok (some USER))` | ✅ |

## Implementation note: as-contract? + nested try!

The wallet's `faktory-execute-limit` uses a double `try!` to extract the
swap result tuple from the `as-contract?` wrapper:

```clarity
(let ((result (try! (as-contract? ((with-ft (contract-of sip010) sip010-name amount))
                      (try! (contract-call? .fakfun-core-v2 execute pool amount opcode))))))
  (asserts! (>= (get dy result) limit-out) err-limit-not-hit)
  (ok result))
```

The inner `try!` unwraps `(response {tuple} uint)` from the contract-call
to get the raw tuple. `as-contract?` then re-wraps it as
`(response {tuple} uint)`. The outer `try!` unwraps again to bind
`result` directly to the tuple, enabling `(get dy result)`. If anything
errs (contract-call, post-condition, etc.), both `try!`s propagate the
error out of the public function, and the entire tx reverts —
crucially including `consume-signature`'s write to
`used-pubkey-authorizations`, so the sig stays valid for retry.

A first pass that omitted the outer `try!` produced the type error
`expecting tuple, found '(response (tuple (dk uint) (dx uint) (dy uint)) uint)'`
during contract deploy — caught in stxer at simulation
`8712ddb9f94dbf96499d82603b95cd5a` and fixed in the run linked above.

## Coverage status

After this sim:

* **`smart-wallet-standard-auth-helpers-v7`** — 23 of 23 hash builders
  tested (the new `build-faktory-execute-limit-hash` is exercised via
  auth-ids 10/11/12 here).
* **`fakfun-wallet-v2`** public functions — 38 of 39 tested. Still
  untested: `wager-deposit` (uses external `auth-v7.build-wager-deposit-hash`
  from game-wager infrastructure; v2 explicitly out-of-scope for games).
