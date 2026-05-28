# fakfun-wallet-v2 — Stxer Mainnet-Fork Simulations

End-to-end stxer simulations for the webauthn-signed `fakfun-wallet-v2`
contract, ported from the privy/secp256k1 sims at
`faktory-dao/contracts/fakfun-core/simul-fakfun-v3-*.js`.

The wallet logic is identical to v3 in surface (faktory + NFT marketplace +
token-lock). The only thing that changes is how `sig-auth` is verified: v3
uses 65-byte secp256k1 RSV signatures (`secp256k1-recover?`), v2 uses
WebAuthn / secp256r1 (`secp256r1-verify`) over a reconstructed digest
(`authenticatorData || sha256(clientDataJSON)`).

## Sims

Every wallet sim deploys `pillar-wallet-trait` + `game-wager-v2` under
SP28MP1H before the wallet, because the wallet `(impl-trait …)` line
and the `wager-deposit` cross-contract call are both statically
resolved at deploy time.

| File | Auth-IDs | Latest stxer run | What it proves |
|---|---|---|---|
| `simul-fakfun-v2-init.js` | 0–3 (init bundle) | [2441264b…](https://stxer.xyz/simulations/mainnet/2441264b871774cebd3350a2ace45178) | ✅ 3-step admin init + veto path. propose → veto → propose-B → accept → confirm BEFORE cooldown errs `u4012` (sig NOT consumed) → advance 440 blocks → confirm succeeds. Final: `is-initialized=true`, owner=USER, pending cleared. |
| `simul-fakfun-v2-wallet.js` | 0/99 + 1–5, 7–13 | [25572596…](https://stxer.xyz/simulations/mainnet/25572596cbc25490f6ba76eaa048496f) | Full lifecycle + stacking. Bootstrap via 3-step admin (propose → accept → advance440 → confirm). 14 documented downstream errs are pre-existing expected mainnet-state behaviors (cooldowns / DEX not graduated yet / pool not authorized). |
| `simul-fakfun-v2-nft.js` | 0–5 | [193cc8d5…](https://stxer.xyz/simulations/mainnet/193cc8d5ff49ff6b8c7ab42ab81390ce) | ✅ NFT marketplace: BUY → LIST → UPDATE-PRICE → UPDATE-FT → UNLIST → SIP009-TRANSFER. Never used `add-admin-with-signature` so the 3-step bootstrap doesn't apply here. |
| `simul-fakfun-v2-token-lock.js` | 0/99 + 1, 2 (+ 3 dummy) | [27af7847…](https://stxer.xyz/simulations/mainnet/27af7847c107113be2382f768eefac00) | ✅ toggle-token-lock asymmetric auth — all 9 phases pass with the 3-step admin bootstrap. |
| `simul-fakfun-v2-admin.js` | 0/99 + 1–9 | [69d99c3c…](https://stxer.xyz/simulations/mainnet/69d99c3ca81f9470e3ceff70b42cbece) | ✅ stx-transfer, extension flows, veto, recovery, dual-stacking, fast-pool, confirm-transfer-wallet. |
| `simul-fakfun-v2-governance.js` | reuses 0/99 + 6 | [d3582627…](https://stxer.xyz/simulations/mainnet/d35826271389b1fa5243052f7cd528f2) | ✅ set-max-gas-amount, signal-config-change, set-wallet-config, signal-pubkey-cooldown-change, confirm-pubkey-cooldown-change, propose/confirm/remove-admin-pubkey, execute-pending-stx-transfer, execute-pending-sbtc-transfer, confirm-recovery, recover-inactive-wallet (after `addAdvanceBlocks(52_700)`). |
| `simul-fakfun-v2-limit.js` | 10–12 + reuses 0/99 | [98124c6c…](https://stxer.xyz/simulations/mainnet/98124c6c3c46495ed6ed72bba8a915b3) | ✅ faktory-execute-limit happy + replay + min-out (retryable) + expired (after advance) + extension-call under token-lock. |
| `simul-fakfun-v2-wager.js` | 200, 201 + reuses 0/99 | [27582a2b…](https://stxer.xyz/simulations/mainnet/27582a2bea9132cbd7489a3b1055839b) | ✅ wallet → game-wager-v2 webauthn end-to-end (no secp256k1 bridge). `wager-deposit` hash now built via the wallet's local `smart-wallet-standard-auth-helpers-v7.build-wager-deposit-hash` (wallet-bound domain) — the prior `auth-v7` dep that referenced game-wager-v1 in its SIP-018 domain bytes is gone. |
| `simul-fakfun-v2-negative.js` (NEW) | reuses 0–3 (init bundle) | [64eff4ea…](https://stxer.xyz/simulations/mainnet/64eff4ea1ff6b4728b2116ae6e709fe4) | ✅ every guard / err code on the new 3-step admin + veto + toggle-token-lock burn-owner surface: `u4001 / u4012 / u4022 / u4026 / u4027 / u4028 / u4029`. All 19 expected results hit. |
| `simul-fakfun-v2-sbtc-withdrawal.js` (NEW) | ephemeral keypair, inline sigs 0/1/100/101 | [4bd1b6e2…](https://stxer.xyz/simulations/mainnet/4bd1b6e2a116a68f8e67671e3c048940) | ✅ sBTC -> BTC peg-out via `sbtc-withdrawal`. Phases A/B (under-threshold signed + admin) burn (amount+max-fee) from `sbtc-token` and mint to `sbtc-token-locked`, bump `spent-this-period.sbtc`, emit the bridge's `withdrawal-create` print w/ recipient `{version: 0x04, hashbytes: 0xaa…(20 bytes)}`. Phase C parks an over-threshold op (op-type `"sbtc-withdraw"`, amount=200 000 not +max-fee, recipient=wallet placeholder, payload=`to-consensus-buff?` of `{recipient, max-fee}`). Phase D executes after 150-block advance (bridge returns request-id `u1938`). Negative paths: E `u4015` vetoed, F `u4017` cooldown-not-passed, G `u4013` wrong op-type (sbtc-transfer pending), H `u500` `ERR_INVALID_ADDR_VERSION` propagated from the bridge (version 0x07). |

The shared `signed-bundle-followup.json` (auth-id 99 = confirm-admin) is one sig reused across all bootstrap-affected sims because the hash depends only on the wallet principal + topic + auth-id + new-admin (all identical across sims). One signing round → six sims initialize.

For the standalone game-wager-v2 sim suite (separate from this list), see
`simul-game-wager-v2*.js` + `README-simul-game-wager-v2.md`.

Each sim is two-phase: print the SIP-018 challenges, sign them in a browser
with your passkey, paste the bundle back, then run. The `init` and
`negative` sims share `signed-bundle-init.json` (4 sigs).

## auth-helpers-v7 coverage

`smart-wallet-standard-auth-helpers-v7` now defines **25 SIP-018 hash
builders** (originally 22; +3 added with the 3-step admin / veto / local
wager-deposit-hash work). All 25 are exercised via real signed wallet
calls across the sim suite:

| Tested helper | Sim · auth-id |
|---|---|
| `build-add-admin-hash` | init auth-ids 0, 2 (propose-admin); reused by every bootstrap sim at auth-id 0 |
| `build-confirm-admin-hash` (NEW) | init auth-id 3; followup auth-id 99 (reused across 5 bootstrap sims) |
| `build-veto-init-hash` (NEW) | init auth-id 1; negative auth-id 1 |
| `build-toggle-token-lock-hash` | token-lock auth-id 1 |
| `build-sip010-transfer-hash` | token-lock auth-id 2 |
| `build-sip009-transfer-hash` | nft auth-id 5 |
| `build-faktory-execute-hash` | wallet auth-ids 1, 2, 10, 11 |
| `build-faktory-execute-limit-hash` | limit auth-id 10 |
| `build-faktory-place-order-hash` | wallet auth-ids 3, 4 |
| `build-faktory-process-hash` | wallet auth-id 5 |
| `build-faktory-process-claim-hash` | wallet auth-id 7 |
| `build-faktory-fee-airdrop-hash` | wallet auth-id 8 |
| `build-faktory-burn-bob-hash` | wallet auth-id 9 |
| `build-faktory-nft-execute-hash` | nft auth-ids 0–4 |
| `build-stack-stx-juice-hash` | wallet auth-id 12 |
| `build-revoke-stacking-hash` | wallet auth-id 13 |
| `build-wager-deposit-hash` (NEW, local — replaces mainnet `auth-v7`) | wager auth-id 201 |
| `build-stx-transfer-hash` | admin auth-id 1 |
| `build-whitelist-extension-hash` | admin auth-id 2 |
| `build-extension-call-hash` | admin auth-id 3 |
| `build-remove-extension-whitelist-hash` | admin auth-id 4 |
| `build-veto-operation-hash` | admin auth-id 5 |
| `build-propose-recovery-hash` | admin auth-id 6 |
| `build-enroll-dual-stacking-hash` | admin auth-id 7 |
| `build-stack-stx-fast-pool-hash` | admin auth-id 8 |
| `build-confirm-transfer-hash` | admin auth-id 9 |

## Notes on `simul-fakfun-v2-sbtc-withdrawal.js`

Two intentional departures from the pattern of the other sims in this suite:

1. **Inline ephemeral signing instead of `signed-bundle-*.json`.** The new
   `build-sbtc-withdrawal-hash` lives in `smart-wallet-standard-auth-helpers-v8`
   (additive over v7, deployed alongside it in the sim) and produces new
   SIP-018 challenges that no committed signed bundle covers. To keep the
   sim runnable without a browser round-trip, the file uses
   `lib-webauthn-test-signer.mjs` (already used by the `simul-game-wager-v2*`
   sims) to mint an ephemeral P-256 keypair, onboard the wallet with that
   pubkey, and sign all four required challenges (`add-admin` propose +
   `confirm-admin` for the 3-step init, plus over-threshold and
   under-threshold `sbtc-withdrawal`) inline. The wallet's
   `is-authorized → consume-signature → verify-signature → secp256r1-verify`
   path is identical regardless of pubkey provenance.

2. **`addSetContractCode` instead of `addContractDeploy` for already-deployed
   contracts.** `clarity-webauthn`, `smart-wallet-standard-auth-helpers-v7`,
   `pillar-wallet-trait`, `game-wager-v2`, and the older `fakfun-wallet-v2`
   are all already on mainnet — `addContractDeploy` returns
   `"Duplicate contract"`. `addSetContractCode` overwrites code at an
   existing contract_id, which lets the sim install the new committed
   `fakfun-wallet-v2` source (with `sbtc-initiate-withdrawal` +
   `execute-pending-sbtc-withdrawal`) at the same principal `onboard()`
   hardcodes. The genuinely-new `smart-wallet-standard-auth-helpers-v8`
   is the only contract that still uses `addContractDeploy`. The existing
   sims in this suite predate the mainnet deploy and will need the same
   migration before their next run.

### Contract fix applied during this iteration

The committed `sbtc-initiate-withdrawal` failed static checking with
`IfArmsMustMatch ((response bool none), (response uint uint))`. The
pending branch returns `(ok true)` (bool) while the immediate-execute
branch returned the bridge's `(response uint uint)` directly. Wrapped
the immediate branch in `(try! ...) (ok true)` so both arms unify on
`(response bool ...)`. This is a 2-line change in
`contracts/fakfun-wallet-v2.clar`; the contract would otherwise not
deploy at all.

### Independent SDK-based verification of every path

The stxer SPA viewer is JavaScript-rendered and can't be machine-read
(static fetches return only the shell). Instead, every path of the two
new functions was verified by querying the simulation's post-state
directly via the stxer SDK v0.8.0 (`readDataVar`, `simulationBatchReads`
with `maps`). Sim:
**https://stxer.xyz/simulations/mainnet/4bd1b6e2a116a68f8e67671e3c048940**

Global state (via `readDataVar`):

| Var | Actual | Expected | Confirms |
|---|---|---|---|
| `operation-nonce` | `u4` | `u4` | exactly 4 pending ops created (phases C, E, F, G); phase H did NOT create one |
| `spent-this-period.sbtc` | `u62000` | `u62000` | only under-threshold executes (A + B, 31_000 each) bumped the spend counter; over-threshold pending ops correctly didn't |
| `is-initialized` | `true` | `true` | wallet bootstrap completed before any sbtc-initiate-withdrawal call |

Per-op state (via `simulationBatchReads({ maps: [[wallet, "pending-operations", uintHex(id)], …] })`):

| op-id | Phase | `op-type` | `executed` | `vetoed` | `amount` | What this proves |
|---|---|---|---|---|---|---|
| `u0` | C → D | `sbtc-withdraw` | `true` | `false` | `u200000` | over-threshold path created the pending op; `execute-pending-sbtc-withdrawal` flipped `executed` (only possible if the bridge `contract-call?` returned `(ok …)`) |
| `u1` | E | `sbtc-withdraw` | `false` | `true` | `u200000` | `veto-operation` toggled `vetoed`; execute correctly returned `err-vetoed (u4015)` afterward |
| `u2` | F | `sbtc-withdraw` | `false` | `false` | `u200000` | execute before cooldown returned `err-cooldown-not-passed (u4017)` *without* state change |
| `u3` | G | **`sbtc-transfer`** | `false` | `false` | — | `execute-pending-sbtc-withdrawal` rejected it via the `op-type` assert ⇒ `err-invalid-operation (u4013)` |

Payload round-trip: every `sbtc-withdraw` op carries `payload` as a
`(buff 94)` containing `to-consensus-buff?` of
`{ recipient: { version: 0x04, hashbytes: 0xaa…(20 bytes) }, max-fee: u1000 }`.
We decoded the raw payload bytes back with `hexToCV` and got the same
tuple — proving the serialize/deserialize path that
`execute-pending-sbtc-withdrawal` relies on actually works.

Recipient field on all sbtc-withdraw pending ops is the wallet's own
principal (`current-contract` placeholder) and `token` is
`(some sbtc-token)` — matching the design choice that the BTC
destination lives in `payload`, not in the map's `recipient` slot.

References:
* Sim: https://stxer.xyz/simulations/mainnet/4bd1b6e2a116a68f8e67671e3c048940
* stxer SDK release used: https://github.com/stxer/stxer-sdk/releases/tag/v0.8.0
* Static cross-check of err codes against the contract source:
  `err-invalid-operation u4013`, `err-vetoed u4015`,
  `err-cooldown-not-passed u4017` (in `fakfun-wallet-v2.clar`),
  `ERR_INVALID_ADDR_VERSION u500` (in upstream `sbtc-withdrawal.clar`).

### Security review — gating mirrors the rest of the wallet

`sbtc-initiate-withdrawal` is a clean composition of the patterns already
exercised by `sip010-transfer`; `execute-pending-sbtc-withdrawal` mirrors
`execute-pending-sbtc-transfer`. No new attack surface introduced.

**`sbtc-initiate-withdrawal`:**

| Gate | Implementation | Mirrors |
|---|---|---|
| `(update-activity)` first | resets inactivity timer | every public fn |
| Signed-path token-lock guard | `(asserts! (not (var-get token-lock-enabled)) err-token-locked)` | `sip010-transfer` signed path (only sBTC outflows do this) |
| Hash binds all 4 signed args | `build-sbtc-withdrawal-hash {auth-id, amount, recipient, max-fee}` | every other `build-*-hash` — tamper → diff hash → sig fails |
| Replay protection | `consume-signature` in `used-pubkey-authorizations` (via `is-authorized`) | every signed op |
| Admin fallback | `(try! (is-authorized none))` ⇒ `is-admin-calling tx-sender` | every signed-or-admin op |
| Spending-threshold check | `would-exceed-sbtc-threshold (+ amount max-fee)` — meters the FULL lock | matches sip010-transfer (which meters `amount`; here we lock `amount + max-fee`) |
| Pending-op machinery | reuses the existing `create-pending-operation` private fn | no new map / no new helper |
| `as-contract?` post-condition | `(with-ft SBTC-CONTRACT "sbtc-token" (+ amount max-fee))` caps outflow | identical to every sBTC-touching op |

**`execute-pending-sbtc-withdrawal`:**

| Gate | Implementation | Mirrors |
|---|---|---|
| Op lookup | `(unwrap! (map-get? pending-operations op-id) err-invalid-operation)` | `execute-pending-sbtc-transfer` |
| Op-type bound | `(asserts! (is-eq (get op-type op) "sbtc-withdraw") err-invalid-operation)` | every `execute-pending-*` (can't be tricked into running a different op type — verified in sim phase G) |
| No double-execute | `(asserts! (not (get executed op)) err-already-executed)` | identical |
| Veto check | `(asserts! (not (get vetoed op)) err-vetoed)` | identical (verified phase E) |
| Cooldown | `(asserts! (>= burn-block-height (get execute-after op)) err-cooldown-not-passed)` | identical (verified phase F) |
| Auth | `(try! (is-authorized none))` — admin-only | every `execute-pending-*` (originator already signed at create time; cooldown gives the user a veto window) |
| Payload integrity | `from-consensus-buff?` with explicit typed shape; payload is set at create and never updated | admin can't tamper recipient/max-fee between create and execute |
| State flip before bridge call | `executed: true` set BEFORE `(contract-call? .sbtc-withdrawal …)` — re-entry would hit `err-already-executed`; failed bridge call reverts the whole tx | atomic, same as the suite |
| `as-contract?` post-condition | `(with-ft SBTC "sbtc-token" lock-total)` where `lock-total = stored amount + deserialized max-fee` | outflow capped at the lock |

**Trust boundaries worth knowing (not bugs):**

* **Admin path doesn't honor `token-lock-enabled`.** Intentional and identical
  to `sip010-transfer`'s admin path — token-lock defends against a compromised
  *passkey*; the L/X admin owner is trusted to override. No regression.
* **`recipient` field in pending-op = wallet itself** (placeholder). The real
  BTC destination lives in `payload`, bound to the signature via the
  build-hash. On-chain there's no consumer that misuses the placeholder.
  Off-chain indexers need to decode `payload` to surface the BTC dest
  (see "Logs missing from deployed `fakfun-wallet-core`" above).
* **Signed-path trust boundary identical to every other signed op:** the user
  trusts the wallet UI to show the real args being signed. The hash binds
  amount + recipient + max-fee, so tamper-after-sign is impossible.
  Tamper-at-sign-time is a frontend concern — mitigated on our FE by the
  destination-locked-to-connected-wallet rule + the verify checkbox.
* **`from-consensus-buff?` typing** uses `(buff 32)` for hashbytes (max), but
  the bridge's `validate-recipient` enforces the exact length per version
  (20 for `0x00`–`0x04`, 32 for `0x05`–`0x06`). Two-layer guard: even a
  malformed-but-deserializable payload is caught downstream.

## Renames in this iteration

* **`revoke-fast-pool` → `revoke-stacking`** (wallet public function and
  helper builder + topic). The wallet's underlying call is
  `pox-4.revoke-delegate-stx`, which revokes the delegation globally —
  not just from fast-pool. The on-chain `fakfun-wallet-core.log-revoke-fast-pool`
  event name is preserved for indexer compatibility with the existing
  mainnet deployment of `fakfun-wallet-core`. If/when that core is
  upgraded, the event can be renamed to `log-revoke-stacking` for full
  consistency.

## Logs missing from deployed `fakfun-wallet-core`

New wallet ops were added without corresponding log functions in the
already-deployed `fakfun-wallet-core`, so they currently omit the log call.
Each is annotated with a `;; NOTE:` at the call site; a future
`fakfun-wallet-core` upgrade can add the matching log fn and the wallet can
be amended to call it. Not blocking — indexers can still observe these ops
via the underlying `sbtc-withdrawal` contract events.

* **`sbtc-initiate-withdrawal` (immediate execute branch, under threshold)
  and `execute-pending-sbtc-withdrawal`** — would emit a
  `log-sbtc-withdrawal (amount uint) (recipient {version,hashbytes}) (max-fee uint)`.
  Reusing `log-sip010-transfer` was rejected: its `recipient` is a Stacks
  principal and can't represent the BTC `{version, hashbytes}` payout
  target.
* **`sbtc-initiate-withdrawal` (over-threshold pending branch)** — does
  call `create-pending-operation`, which emits the generic
  `log-pending-operation`. That event records `recipient = current-contract`
  (placeholder), with the real BTC destination decodable from the `payload`
  buff via `from-consensus-buff?`. A dedicated
  `log-sbtc-withdrawal-pending (op-id uint) (amount uint) (recipient {version,hashbytes}) (max-fee uint) (execute-after uint)`
  would surface the BTC destination directly to indexers — cleaner, not
  required.

## May 2026 amendments

Major contract-side changes landed during this iteration; the sim suite was
extended to cover them end-to-end.

### `add-admin-with-signature` → 3-step flow

The one-shot init is now `propose-admin-with-signature` →
`accept-admin-proposal` → `confirm-admin-with-signature`, plus
`veto-pending-init` to clear a malicious propose. The confirm step
requires `pubkey-cooldown-period` burn blocks to have elapsed since the
propose (default ~3 days). The accept step requires `tx-sender =
pending new-admin` — proves the Leather/Xverse principal that becomes
the new admin actually controls that key. Three new err codes:
`u4026 err-init-already-proposed`, `u4027 err-no-pending-init`, `u4028
err-init-not-pending-admin`, `u4029 err-init-not-accepted`. Covered by
`simul-fakfun-v2-init.js` (happy + veto path) and `simul-fakfun-v2-negative.js`
(every err code).

### `(impl-trait pillar-wallet-trait)` on the wallet

Required by `game-wager-v2.register-wallet`, which takes
`(wallet <pillar-wallet-trait>)` and calls back to
`wallet.is-admin-pubkey(pubkey)` to prove the pubkey belongs to the
registering wallet. Without the impl-trait declaration the wallet would
be rejected with `BadTraitImplementation`. Covered by
`simul-fakfun-v2-wager.js` end-to-end and by every wallet sim deploying
`pillar-wallet-trait` as a prereq.

### `auth-v7.build-wager-deposit-hash` → local
`smart-wallet-standard-auth-helpers-v7.build-wager-deposit-hash`

The old mainnet `auth-v7` baked `game-wager-v1` into its SIP-018
domain bytes — so the user signed "v1 deposit intent" while the wallet
actually deposited into `game-wager-v2`. The new local helper builds
the hash under the wallet's own domain (`name: "smart-wallet-standard"`,
`version: "1.0.0"`, `wallet: contract-caller`), independent of any
game-wager version. The user's signed bytes now bind to the wallet
itself.

### `toggle-token-lock` burn-owner assert

Added a guard that blocks toggling the token-lock while `owner = burn
address`. Prevents bricking a wallet that's been transferred to the
burn address (or never properly initialized). Covered explicitly in
`simul-fakfun-v2-negative.js` Phase B.

### Public function count: 39 → 42

Net change from 1 removed (`add-admin-with-signature`) and 4 added
(`propose-admin-with-signature`, `accept-admin-proposal`,
`confirm-admin-with-signature`, `veto-pending-init`). All 42 covered
by the sim suite.

## How to run a sim

### 1. Print the challenges

```bash
cd /home/raphastacks/projects/pillar/contracts/pillar-wallets
node simul-fakfun-v2-wallet.js --print-challenges > challenges-wallet.json
```

Each sim emits a JSON bundle of shape:

```json
{
  "walletPrincipal": "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-v2",
  "rpId": "fakfun.com",
  "operations": [
    { "authId": 0, "label": "add-admin (USER)", "challengeHex": "0x…" },
    …
  ]
}
```

Each `challengeHex` is the 32-byte SIP-018 hash that
`smart-wallet-standard-auth-helpers-v7.build-X-hash` computes on-chain. The
sim re-uses the same `to-consensus-buff?` shape in JS so the off-chain hash
matches the on-chain one byte-for-byte. If it doesn't, the wallet returns
`err-invalid-signature (u4002)` on first run.

### 2. Sign in the browser

Open `https://fakfun.com/faktory-v2-sign` (or `https://fak.fun/faktory-v2-sign`
— either rp.id works; the wallet's `verify-signature` accepts both).

First visit: click **Register passkey**. Subsequent visits reuse the stored
credential id from `localStorage`.

Paste the challenges JSON into the textarea. The page renders one row per
operation. Click **Sign all** to walk through each prompt, or **Sign**
on a specific row to retry.

When every row shows ✓ signed, click **Copy to clipboard**. Save the output
as:

| Sim | Default signed-bundle filename |
|---|---|
| wallet | `signed-bundle.json` |
| nft | `signed-bundle-nft.json` |
| token-lock | `signed-bundle-token-lock.json` |

(Each sim accepts `--signed <path>` to override.)

### 3. Run the simulation

```bash
node simul-fakfun-v2-wallet.js
# or:
node simul-fakfun-v2-wallet.js --signed ./signed-bundle.json
```

`SimulationBuilder` from the `stxer` package publishes the run to
`https://stxer.xyz/simulations/mainnet/<id>` and prints the URL. Open it to
see each step's result, post-conditions, and final state.

Capture the URL + observed results into the matching per-sim README:
- `README-simul-fakfun-v2-wallet.md`
- `README-simul-fakfun-v2-nft.md`
- `README-simul-fakfun-v2-token-lock.md`

## Contracts deployed in the simulation

These are not yet on mainnet, so each sim deploys them as part of the run:

| Contract | Source | Notes |
|---|---|---|
| `clarity-webauthn` | `contracts/clarity-webauthn.clar` | base64url + WebAuthn digest reconstruction + `secp256r1-verify` glue |
| `smart-wallet-standard-auth-helpers-v7` | `contracts/smart-wallet-standard-auth-helpers-v7.clar` | SIP-018 hash builders for every signed topic |
| `fakfun-wallet-v2` | `contracts/fakfun-wallet-v2.clar` | the wallet under test |

Already-deployed dependencies the sim relies on but does not redeploy:
`fakfun-wallet-core`, `fakfun-core-v2`, `fakfun-nfts-core`,
`fakfun-nftmarket-trait`, `pepe-nft-marketplace`, `unfair2-*` token suite,
`sbtc-token`, `built-on-bitcoin-stxcity`, `burn-bob-faktory`, `gas-station`.

## Status (2026-05-16)

End-to-end verified on Stacks mainnet fork at epoch 3.4 (Clarity 5):

* **WebAuthn signature path is fully validated.** Across all three sims,
  every signed wallet call (20 distinct webauthn proofs in total) passes
  the `is-authorized → consume-signature → verify-signature
  → clarity-webauthn.verify-webauthn-signature → secp256r1-verify` chain
  without producing `(err u4002)`.
* **Clarity 5's fixed `secp256r1-verify` is the key dependency.** Pre-fork
  the function double-hashed its input (see
  `juice/contracts/webauthn/readme-webauthn.clar` for context); post-fork
  it operates as plain `verify(hash, sig, pubkey)`, which matches what
  WebAuthn signs.
* **Variable-length `clientDataSuffix` works.** Chrome occasionally injects
  the anti-template `other_keys_can_be_added_here: …` extension into
  `clientDataJSON`; the contract's `(buff 512)` cap is sufficient.

### Bug we hit + fixed during this work

`@stacks/transactions` v7's `serializeCV` returns a **hex string**, not a
`Uint8Array`. Initial sims wrapped the return value in `Buffer.from(...)`
without specifying `"hex"`, so the SIP-018 hash was computed over the
ASCII bytes of the hex string — not the binary consensus bytes. The fix
is `Buffer.from(serializeCV(value), "hex")` everywhere the sim builds
domain-hash or message-hash inputs.

The on-chain diagnostic that exposed this:
1. eval `(contract-call? auth-helpers-v7 build-add-admin-hash {…})` →
   on-chain hash `0x11dbc7c4…` (or different depending on contract-caller).
2. JS-computed hash (buggy) → `0x169c3ad1…`.
3. eval `(verify-webauthn-signature pubkey JS-challenge auth-data prefix
   suffix sig)` → returned `true` (so the FE pipeline was correct; the
   signature matched the JS-computed challenge).

Conclusion: the SDK had been hashing ASCII-of-hex while the contract was
hashing the actual bytes. After patching `serializeCV` usage, all three
sims pass their signature checks.

## What v2 changes vs v3 (in plain terms)

* **sig-auth tuple grew**: from `{ auth-id, signature (buff 65), pubkey
  (buff 33) }` to `{ auth-id, pubkey (buff 33), signature (buff 64),
  authenticator-data (buff 256), client-data-prefix (buff 128),
  client-data-suffix (buff 512) }`. The contract reconstructs the WebAuthn
  digest from those four extra fields and runs `secp256r1-verify`.
* **rp.id whitelisting**: `verify-signature` accepts assertions for either
  `fakfun.com` or `fak.fun`. The signing page must be served from one of
  those origins.
* **pubkey is secp256r1, not secp256k1**: 33-byte compressed P-256.
  Browser-generated via `navigator.credentials.create({ alg: -7 })`.
* **Replay protection** still keys on the 32-byte message-hash: re-using
  the same auth-id+args yields `err-signature-replay (u4006)` regardless
  of how many fresh assertions you produce, because the message-hash
  doesn't change.
* **Auth fallback is unchanged**: when sig-auth is `none`, the wallet falls
  back to `(is-admin-calling tx-sender)`. The sims exercise both paths.

## Re-running after a contract edit

Any edit to `fakfun-wallet-v2.clar` — even whitespace — changes its
sha512/256 hash. The sim calls
`fakfun-wallet-core.set-verified-contract` with the freshly-computed
hash before deploying the wallet, so this is handled automatically per
run. If you split the sim across multiple runs against a persisted state
(not the default for stxer), make sure each run starts from a clean
`set-verified-contract` call.

The challenges themselves only depend on the wallet *principal* and the
SIP-018 message contents (auth-id, amounts, etc.) — not on the wallet
source code. Re-running `--print-challenges` after a contract edit
produces the same JSON unless you change the operation parameters.
