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
* **Cross-curve bridge in `wager-deposit`** — *superseded by the May 2026
  switch to game-wager-v2*. Originally: webauthn sig over the `auth-v7`
  challenge + secp256k1 pubkey registered in game-wager-v1, two
  independent verifications. Now: pure webauthn end-to-end against
  game-wager-v2, no secp256k1 path. See May 2026 amendments below.

## Operational recommendations (not code changes)

These are project-level practices the owner already follows but worth
documenting:

* `onboard` (FAKFUN-DEPLOYER only) sets `initial-pubkey` and registers
  it in `pubkey-to-admin → burn-address`. That mapping is what makes
  the 3-step `propose-admin-with-signature` non-squattable — only the
  user's own passkey can pass `consume-signature` because it's the
  only pubkey accepted by `is-admin-pubkey`. See the May 2026 amendments
  below for the rest of the threat model.
* Monitor `(var-get recovery-address)` for unexpected changes — emit
  a chainhook event or a UI alert.
* Monitor `(var-get pending-init-admin)` for unexpected pending
  proposes — if a malicious frontend slips a propose past the user,
  the ~3-day cooldown is a detection window. Frontend should surface
  a pending-init banner that the user can `veto-pending-init` to
  clear.
* Frontend post-conditions on `extension-call` payloads (showing
  human-readable intent at signing time) carry significant security
  weight. Audit the FE signing flow as carefully as the contract.
* Keep `max-gas-amount` modest (default `u1000` is fine for current
  gas-station economics). See "Gas extension is relayer-chosen" in the
  May 2026 amendments below for why this matters.

## May 2026 amendments

Changes that landed after the initial review, with end-to-end stxer
coverage. Each was authored to close a specific concern or clean up a
labelling inconsistency.

### A. `add-admin-with-signature` → 3-step admin init

**Concern**: the one-shot init finalised the wallet in a single tx.
A compromised frontend could trick the user into signing one webauthn
assertion for `new-admin = attacker`, and the wallet would initialize
directly to the attacker. No second chance for the user to notice.

**Change**: the one-shot is now three steps —
`propose-admin-with-signature` (webauthn sig 1 from `initial-pubkey`)
→ `accept-admin-proposal` (`tx-sender = pending new-admin`, no sig)
→ `confirm-admin-with-signature` (webauthn sig 2 from
`initial-pubkey`, after `pubkey-cooldown-period` burn blocks ≈ 3
days). `veto-pending-init` (webauthn sig from `initial-pubkey`)
clears a pending propose.

* The 3-day cooldown gives the user time to notice a malicious
  pending state in their wallet UI and either (a) refuse to sign
  step 3, or (b) `veto-pending-init`. Doesn't defeat a persistently
  compromised FE, but defeats the "sign two things in one sitting"
  variant.
* `accept-admin-proposal` proves the Leather/Xverse principal that's
  becoming admin actually controls that key. Closes the variant
  where an attacker tricks the user into signing for an STX address
  the attacker doesn't control.
* New err codes: `u4026 err-init-already-proposed`,
  `u4027 err-no-pending-init`,
  `u4028 err-init-not-pending-admin`,
  `u4029 err-init-not-accepted`. All verified by
  `simul-fakfun-v2-negative.js`.

### B. `auth-v7` (mainnet, v1-domain) → local `build-wager-deposit-hash`

**Concern**: the mainnet `auth-v7` contract at
`SP28MP1H...auth-v7` hardcodes
`{contract: 'SP28MP1H...game-wager-v1, name: "game-wager",
version: "1.0.0"}` in its `get-domain-hash` (lines 6 + 8 of the on-chain
source). The wallet's `wager-deposit` used `auth-v7` to build the
user's signing challenge but then routed the actual deposit to
**game-wager-v2**. So the user signed bytes that encoded "v1 deposit
intent" while the funds went to v2.

Functionally safe (v2.deposit is permissionless; the wallet's own
`used-pubkey-authorizations` map prevents reuse), but semantically
inconsistent — and a footgun if a second wallet ever reused the same
auth-v7 builder.

**Change**: added `build-wager-deposit-hash` to the wallet's own
`smart-wallet-standard-auth-helpers-v7`. Domain is
`{name: "smart-wallet-standard", version: "1.0.0", chain-id,
wallet: contract-caller}` — bound to the wallet's principal, not any
game-wager version. The wallet no longer references `auth-v7` at all;
one mainnet dependency removed.

### C. `(impl-trait pillar-wallet-trait)` on the wallet

**Concern**: `game-wager-v2.register-wallet` takes
`(wallet <pillar-wallet-trait>)`. Without an `impl-trait` declaration
on the wallet, that call would reject the wallet with
`BadTraitImplementation`, breaking the deposit flow.

**Change**: added
`(impl-trait 'SP28MP1H...pillar-wallet-trait.pillar-wallet-trait)`
at the top of the wallet. The wallet's existing `is-admin-pubkey`
function already had the matching signature. End-to-end verified by
`simul-fakfun-v2-wager.js`.

### D. `toggle-token-lock` burn-owner assert

**Concern**: pre-init the wallet's `owner = burn-address`. If
someone called `toggle-token-lock(true)` in that window, the wallet
would enter a locked state with no recoverable owner.

**Change**: one-line assert at the top of `toggle-token-lock` —
`(asserts! (not (is-eq (var-get owner) 'SP000000000000000000002Q6VF78))
err-unauthorised)`. Returns `u4001` if owner is burn. Verified in
`simul-fakfun-v2-negative.js` Phase B.

### E. Gas extension is relayer-chosen (operational note, no fix)

**Concern**: every sig-gated public function takes
`(gas (optional <gas-trait>))`. The user's webauthn hash binds
amount/recipient/etc. but NOT the `gas` extension principal — so a
relayer broadcasting the signed tx can swap to any gas-trait impl,
including a malicious one.

**Loss bound**: `max-gas-amount` × `with-ft "sbtc-token"` per call.
A malicious gas contract can drain at most `max-gas-amount` sBTC per
relayed tx, and every relayed tx consumes one auth-id, so the same
sig can't be reused.

**Owner's response**: keep `max-gas-amount` at its current default of
`u1000` (1000 sats). At that level the worst case is a few thousand
sats leaked across many relayed txs — well below operational cost of
running sponsored-tx infrastructure. **No code change**; flagged as
operational risk. Closing it properly would require including
`(contract-of gas)` in every `build-*-hash`, which means re-signing
every existing sim bundle.

## June 2026 amendments — sBTC withdrawal (peg-out)

Two new public functions let a user peg sBTC back out to a Bitcoin
address straight from the wallet, via the canonical
`SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal` bridge:

* **`sbtc-initiate-withdrawal`** (line ~789) — `amount`, BTC `recipient`
  `{version, hashbytes}`, `max-fee`, optional `sig-auth`, optional `gas`.
  Under threshold → calls the bridge inline. Over threshold → parks a
  `"sbtc-withdraw"` pending op.
* **`execute-pending-sbtc-withdrawal`** (line ~861) — admin-only; replays
  a parked op after its cooldown.

These were reviewed against the existing v3 transfer/pending pattern.
**No exploitable finding.** Properties confirmed:

* **Auth binding is full SIP-018.** The signed hash comes from
  `smart-wallet-standard-auth-helpers-v8.build-sbtc-withdrawal-hash` and
  binds `amount`, `recipient`, **and `max-fee`** under
  `topic: "sbtc-withdrawal"`, with the domain hash binding
  `wallet: contract-caller` and `chain-id`. So: no cross-wallet replay
  (wallet-bound domain), no cross-chain replay (chain-id), no
  cross-function collision (distinct topic + the `-v8` builder vs the
  `-v7` builders used by transfers).
* **One-shot signatures.** `consume-signature` records the message-hash
  in `used-pubkey-authorizations`; `auth-id` is the per-withdrawal
  nonce. The signature is consumed on **both** branches (verification
  runs before the threshold split), so parking an over-threshold op also
  burns the sig.
* **Threshold → cooldown → veto intact.** `execute-pending-sbtc-withdrawal`
  asserts `not executed`, `not vetoed`, `burn-block-height >= execute-after`,
  **and** `op-type == "sbtc-withdraw"` — a `sbtc-transfer` op cannot be
  drained through it (sim Phase G → `u4013`).
* **CEI ordering.** Immediate path `add-spent-sbtc` before the bridge
  call; execute sets `executed: true` before the bridge call →
  reentrancy-safe.
* **Bounded asset movement.** Both bridge calls run inside
  `as-contract? ((with-ft SBTC-CONTRACT "sbtc-token" (+ amount max-fee)))`,
  capping the pull at exactly `amount + max-fee`. Gas is separately
  capped at `max-gas-amount`.
* **Stored-op integrity.** The parked payload
  (`to-consensus-buff?` of `{recipient, max-fee}`) and `op.amount` are
  immutable between create and execute, and both came from the signed
  hash — the admin executing later can't redirect or inflate it.

**By-design notes (not bugs):**

* The no-signature path (`is-authorized none`) gives the `admins`
  principal full withdrawal power to any BTC address. That principal is
  set at init by a passkey-signed `confirm-admin` (it's the owner's own
  designated admin, not an operator backdoor) — identical trust to
  `sip010-transfer`.
* `execute-pending-sbtc-withdrawal` does **not** call `add-spent-sbtc`:
  correct and consistent — large ops are rate-limited by the
  cooldown/veto track, not the spend counter (matches
  `execute-pending-sbtc-transfer`).
* `max-fee` is not bounded on-chain (the bridge refunds the unused
  remainder). A malicious frontend could get a user to sign a large
  `max-fee`; mitigate in the signing UI, not the contract.

**Stxer coverage:** `simul-fakfun-v2-sbtc-withdrawal.js`
([`4bd1b6e2…`](https://stxer.xyz/simulations/mainnet/4bd1b6e2a116a68f8e67671e3c048940)),
8 phases on a mainnet fork against the real bridge:
A under-threshold signed · B under-threshold admin · C over-threshold →
pending · D execute after advance (bridge request-id) · E veto blocks
execute (`u4015`) · F cooldown-not-passed (`u4017`) · G wrong op-type
(`u4013`) · H bad address version (`u500`). Both happy paths and every
negative guard pass.
