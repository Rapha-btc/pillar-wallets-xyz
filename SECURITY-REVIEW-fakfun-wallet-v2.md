# Security Review — `fakfun-wallet-v2`

Static review of `contracts/fakfun-wallet-v2.clar` performed alongside the
end-to-end stxer simulations. Each finding lists the original concern, the
project owner's response, and the final assessment.

The wallet's auth model in brief:
* **Admin path** — `tx-sender` must be in the `admins` map (the wallet's
  owner principal — a "cold" key). Used for kill-switch and
  configuration ops.
* **Signature path** — a WebAuthn / secp256r1 `sig-auth` tuple consumed
  by `consume-signature`. The signed pubkey must be registered in
  `pubkey-to-admin` and that pubkey's mapped principal must itself be
  in `admins` (`is-admin-pubkey`). Used for sponsored / third-party
  broadcast paths.
* The wallet's `verify-signature` enforces that the WebAuthn
  `rp.id` is `fakfun.com` OR `fak.fun` — both project-controlled
  origins. A passkey from any other origin is rejected on-chain.

## 1. `enroll-dual-stacking` — FAKFUN_DEPLOYER bypass

**Concern** (line 1484):
```clarity
(match sig-auth
  sig-auth-details (try! (is-authorized (some {...})))
  (if (is-eq tx-sender FAKFUN-DEPLOYER) true (try! (is-authorized none)))
)
```
When `sig-auth=none` AND `tx-sender = FAKFUN-DEPLOYER (SP1G655…)`, the
admin check is bypassed entirely. The Faktory deployer can enroll any
wallet in dual-stacking without a user signature. If that key is
compromised, an attacker could enroll user wallets in malicious
dual-stacking implementations.

**Response**: enrollment is a positive action (the user is opting into
extra yield); the caller still pays the tx fee; the dual-stacking
trait impl is itself separately vetted; the wallet does not move any
user assets at enrollment time.

**Final assessment**: **not critical**. Power is bounded (enrollment ≠
asset movement), economic cost on the bypass-er (gas), and impact
recoverable (`revoke-stacking` undoes pox-4 delegation, which is the
practical effect of dual-stacking enrollment).

## 2. Recovery-address poisoning

**Concern**: if the admin principal is compromised, the attacker can
- `propose-recovery(self)` — signed call
- `confirm-recovery` — admin-only call
- Wait for `INACTIVITY-PERIOD` (u52_560 burn blocks ≈ 1 year)
- `recover-inactive-wallet` — recovery-address only

The attacker gets a persistent takeover path that survives even if the
original admin recovers their cold key in the meantime.

**Response**: this attack requires **both** the admin tx-sender AND a
passkey-signed `propose-recovery` payload. Owning either alone isn't
sufficient. Two independent compromises is the threshold, not one.

**Final assessment**: **not critical**. 2-of-2 compromise model is
explicit. If both admin AND a fresh webauthn sig leak, the attacker
already has total control via direct admin actions — the recovery path
adds no new capability. Monitoring `(var-get recovery-address)` is
still a reasonable operational hygiene practice.

## 3. Pre-init window race (between `onboard` and `add-admin-with-signature`)

**Concern**: after `onboard` and before `add-admin-with-signature`, the
wallet is operational with `admins[burn-address] = true` and
`pubkey-to-admin[USER_PUBKEY] = burn-address`. Any signed call works
because `is-admin-pubkey` resolves to burn-address which is in
`admins`. If the user's passkey is intercepted in this window, an
attacker can `add-admin-with-signature(attacker-principal)` — first
submitter wins.

**Response**: smooth onboarding is intentional — no backup admin
required, no pre-setup ceremony. The window exists by design so the
user can begin using the wallet immediately after onboard. The passkey
is on-device and not transmitted, so intercepting it requires device
compromise — at which point any wallet model fails.

**Final assessment**: **accepted design tradeoff**. Smooth UX is the
explicit priority. Mitigation in practice is batching `onboard` and
`add-admin-with-signature` into a single sponsored tx (the faktory-dao
backend already does this).

## 4. Token-lock pre-init brick

**Concern**: same pre-init window. `toggle-token-lock(true, sig)` works
via the burn-address admin mapping. `toggle-token-lock(false, …)`
requires `is-admin-calling tx-sender` — burn-address can't be a
tx-sender → **lock cannot be disabled** until `add-admin-with-signature`
runs.

**Response**: the unlock-via-owner-only design is intentional. We
**want** the lock to require the owner (admin) to clear it, not the
passkey. A passkey alone is a "warm" credential; the admin is the
"cold" anchor. The pre-init window is small and not a real attack
surface (see #3).

**Final assessment**: **by design**. The kill-switch's value is that
only the cold owner can release it. Pre-init lock is a theoretical
edge case mitigated by the same batching that mitigates #3.

## 5. `extension-call` with-all-assets-unsafe

**Concern** (around line 590):
```clarity
(as-contract? ((with-all-assets-unsafe))
  (try! (contract-call? extension call payload))
)
```
A whitelisted extension can move any asset out of the wallet. Once
whitelisted, every signed `extension-call` passes an arbitrary
`(buff 2048)` payload — the user can't see at-signing-time what the
payload will do.

**Response**: in practice
1. Owner (admin) is the one who whitelists the extension via the
   `whitelist-extension` → cooldown → `execute-pending-whitelist`
   flow — a high-friction action requiring both admin and signed
   confirmation.
2. The frontend that drives the signing UI is the one composing the
   payload. It shows the user post-conditions / human-readable intent
   at the moment of signing, so the user knows what they authorize.
3. The WebAuthn `rp.id` check on-chain (`RP-ID-HASH-FAKFUN-COM` /
   `RP-ID-HASH-FAK-FUN`) means a passkey assertion can ONLY come from
   a browser session on `fakfun.com` or `fak.fun`. A phishing site at
   `evil.com` cannot get the user's passkey to sign an
   extension-call — the browser will refuse because the rp.id
   doesn't match.

**Final assessment**: **acceptable risk envelope**. The rp.id pinning
is the load-bearing defense. Combined with FE post-conditions + admin
whitelisting, the extension surface is a controlled-trust delegation,
not a blank check.

## 6. Gas-station drain via raised `max-gas-amount`

**Concern** (line 197):
```clarity
(define-public (set-max-gas-amount (amount uint))
  (begin
    (try! (is-admin-calling tx-sender))
    (var-set max-gas-amount amount)
    (ok true)))
```
Admin-only, no upper bound. If admin is tricked into setting
`max-gas-amount = huge` while gas-station is malicious, every gas-
attached signed call drains up to that amount.

**Response**: changing `max-gas-amount` already requires admin
tx-sender. If admin is compromised, the attacker has access to
**every** wallet operation (transfers, extension whitelisting,
recovery rotation, etc.) — gas drain is the least of the user's
problems. The constraint can't be tightened without losing the ability
to support higher-cost gas-station ops.

**Final assessment**: **subsumed by full admin compromise**. The
attacker who controls admin can drain assets directly; gas-station
drain is a strictly weaker capability.

## 7. `pubkey-to-admin` map cruft on admin removal

**Concern**: `confirm-transfer-wallet` removes the old admin from
`admins` but doesn't clean up old pubkey-to-admin entries. The map
grows monotonically.

**Response**: this is intentional. When admin transfers, the old
pubkey's entry in `pubkey-to-admin` points to the old (now removed)
admin principal. `is-admin-pubkey` calls `is-admin-calling
old-admin` → fails because the old admin is no longer in `admins`. So
old pubkeys are **automatically invalidated** without the wallet
needing to do explicit removal. The new admin can `propose-admin-pubkey`
+ `confirm-admin-pubkey` to add their own fresh pubkey under the same
flow.

**Final assessment**: **correct design**. Storage cruft is a minor
bookkeeping wart; the security invariant (only admins can authorize)
holds through the indirection.

## Verified safe (no concern)

* **Reentrancy from extensions** — re-entering wallet sets
  `tx-sender = wallet contract`, fails `is-admin-calling`. Sig path
  can't be re-used either: same message-hash is already in
  `used-pubkey-authorizations` by the time the extension runs.
* **Cross-wallet sig replay** — SIP-018 domain hash binds to
  `contract-caller` in `auth-helpers-v7.get-domain-hash`. Wallet A's
  sig has different domain bytes than wallet B's; replay across
  wallets produces a different message-hash → fails verification.
* **Cross-function sig replay** — each topic produces a distinct
  message-hash. `faktory-execute` auth-id 5 ≠ `stx-transfer` auth-id 5.
* **Threshold splitting** — `spent-this-period` accumulates inside the
  cooldown window. Once the period's spend hits threshold, subsequent
  transfers go through the pending-op path (admin-confirmable, with
  cooldown). Max drainable per period = threshold by design.
* **`err-fatal-owner-not-admin (u9999)`** — defined but never raised
  anywhere in the source. Vestigial constant; safe to remove on a
  cleanup pass.
* **`faktory-execute-limit` min-out arithmetic** — checks
  `(get dy result) >= limit-out` AFTER swap completion. If failed,
  `asserts!` reverts the entire tx including `consume-signature`'s
  write to `used-pubkey-authorizations`, so the signed payload stays
  valid for retry. Verified end-to-end in `simul-fakfun-v2-limit`.
* **Cross-curve bridge in `wager-deposit`** — webauthn sig over the
  auth-v7 challenge + secp256k1 pubkey registered in game-wager-v1.
  Two independent verifications must both succeed. Verified end-to-end
  in `simul-fakfun-v2-wager`.

## Operational recommendations (not code changes)

These are project-level practices the owner already follows but worth
documenting:

* Batch `onboard` + `add-admin-with-signature` in a single sponsored
  transaction (faktory-dao BE) to close the pre-init window.
* Monitor `(var-get recovery-address)` for unexpected changes — emit
  a chainhook event or a UI alert.
* Frontend post-conditions on `extension-call` payloads (showing
  human-readable intent at signing time) carry significant security
  weight. Audit the FE signing flow as carefully as the contract.
* Keep `max-gas-amount` modest (default `u1000` is fine for current
  gas-station economics).
