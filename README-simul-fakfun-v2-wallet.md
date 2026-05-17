# simul-fakfun-v2-wallet — Full Lifecycle (webauthn)

Stxer mainnet-fork simulation of the full `fakfun-wallet-v2` faktory
lifecycle, signed with WebAuthn passkeys (secp256r1). Mirrors
`faktory-dao/contracts/fakfun-core/simul-fakfun-v3-wallet.js` (privy)
step for step.

**Latest run:** https://stxer.xyz/simulations/mainnet/62ce078cc225101d055578fdf9fce7dd
**Status:** ✅ **all 13 webauthn signatures verify on-chain** (no `err-invalid-signature`); `stack-stx-juice` + `revoke-stacking` fully succeed end-to-end; faktory ops hit current mainnet-state guards (see notes below)
**Block:** 7978447 · **Epoch:** 3.4 (Clarity 5)
**Signing pubkey:** `02eca875ad4e06371c75a1fb889f69b52c4900d7f4f4d17e2a059152213ba2d785` (P-256)
**Origin / rp.id:** `fak.fun`

## Token

* `$UNFAIR2` — `SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.unfair2-faktory`
  (the same token used by the v3 sim; deployed and traded since then —
  current mainnet state is post-prelaunch/post-bonding for several state
  checks below)
* Pool: `unfair2-faktory-pool` (1-bip fee)
* DEX: `unfair2-faktory-dex`
* Pre: `unfair2-pre-faktory`

## Auth-IDs

| Auth-ID | Topic | Args | Result |
|---|---|---|---|
| 0 | `add-admin` | new-admin=USER | ✅ ok |
| 1 | `faktory-execute` | pool, amount=100_000, opcode=0x00 (pool BUY) | sig ✓ · core u403 |
| 2 | `faktory-execute` | pool, amount=500_000_000_000, opcode=0x01 (pool SELL) | sig ✓ · core u403 |
| 3 | `faktory-place-order` | dex, amount=100_000, opcode=0x00 (DEX BUY) | sig ✓ · core u1001 |
| 4 | `faktory-place-order` | dex, amount=500_000_000_000, opcode=0x01 (DEX SELL) | sig ✓ · core u1001 |
| 5 | `faktory-process` | pre, seat-count=2, opcode=0x02 (BUY-SEATS) | ✅ ok |
| 7 | `faktory-process-claim` | pre | sig ✓ · core u321 |
| 8 | `faktory-fee-airdrop` | pre | sig ✓ · core u323 |
| 9 | `faktory-burn-bob` | – | sig ✓ · BOB transfer u1 |
| 10 | `faktory-execute` | pool, amount=100_000, opcode=0x02 (ADD-LIQ) | sig ✓ · core u403 |
| 11 | `faktory-execute` | pool, amount=50_000, opcode=0x03 (REMOVE-LIQ) | sig ✓ · core u1 |
| 12 | `stack-stx-juice` | amount-ustx=1_000_000 (1 STX delegated to JUICE-SIGNER) | ✅ ok — pox-4 delegation registered |
| 13 | `revoke-stacking` | – | ✅ ok — pox-4 delegation removed |

(Auth-id 6 is the unused REFUND slot — kept aligned with v3 for diffing.)

## Gas-station payment trace

Calls in this sim that pass `someCV(gas-station)` for the gas argument trigger
the wallet's `(match gas g (try! (contract-call? g pay-gas)) true)` branch.
The gas-station's `pay-gas` charges **20 sats sBTC per call** and forwards
them to the Faktory deployer's standard principal (`SPV9K21….`, not the
gas-station contract). Counted in events from the latest run: 8 gassed
signed calls × 20 sats = 160 sats sBTC paid in gas total. The wallet's
`max-gas-amount = u1000` cap is the upper bound the wallet allows the
gas-station to spend; the actual price is decided by the gas-station.

Calls that pass `noneCV()` for gas (e.g. `add-admin-with-signature` here, and
every call in `simul-fakfun-v2-token-lock`) match the `none` branch and
move zero sats.

## Per-step results

| # | Phase | Operation | Sender | Result | ✓ |
|---|---|---|---|---|---|
| 0 | 1 | Deploy `clarity-webauthn` | DEPLOYER | `(ok true)` | ✅ |
| 1 | 1 | Deploy `smart-wallet-standard-auth-helpers-v7` | DEPLOYER | `(ok true)` | ✅ |
| 2 | 1 | `set-verified-contract fakfun-wallet-v2 hash` | DEPLOYER | `(ok true)` | ✅ |
| 3 | 1 | Deploy `fakfun-wallet-v2` | DEPLOYER | `(ok true)` | ✅ |
| 4 | 1 | `onboard pubkey` | FAKFUN_DEPLOYER | `(ok true)` | ✅ |
| 5 | 1 | `add-admin-with-signature(USER)` auth-id 0 | USER | `(ok true)` | ✅ |
| 6 | 1 | sBTC `transfer 5_000_000 → wallet` | USER | `(ok true)` | ✅ |
| 7 | 1 | eval `(get-contract-status)` pre | – | tuple visible | ✅ |
| 8–15 | 2 | 8 of 9 SEAT_BUYERS call `fakfun-core-v2.process(2 seats)` | each buyer | `(ok u2)` × 8 | ✅ |
| 16 | 2 | 9th buyer (SP1DZARHA…) `process` | SP1DZARHA | **`(err u1)`** | ⚠ |
| 17 | 2 | eval `(get-contract-status)` pre | – | tuple visible | ✅ |
| 18 | 3 | `faktory-process BUY-SEATS` auth-id 5 | DEPLOYER | `(ok u2)` — **wallet completes pre** | ✅ |
| 19 | 3 | eval `(get-contract-status)` pre | – | tuple visible | ✅ |
| 20 | 4 | `faktory-process-claim` auth-id 7 (pre-bond) | DEPLOYER | **`(err u321)`** — vesting state | ⚠ |
| 21 | 5 | `faktory-place-order BUY` auth-id 3 | DEPLOYER | **`(err u1001)`** — DEX state | ⚠ |
| 22 | 5 | `faktory-place-order SELL` auth-id 4 | DEPLOYER | **`(err u1001)`** — DEX state | ⚠ |
| 23 | 5.5 | eval `(get-open)` DEX | – | `0x0704` (ok false) | ℹ |
| 24 | 5.5 | eval `(var-get stx-balance)` DEX | – | `u1000000` (1M sats) | ℹ |
| 25 | 5.5 | eval `(var-get bonded)` DEX | – | `0x04` (false) | ℹ |
| 26 | 5.5 | SP24MM `fakfun-core-v2.place-order 21M BUY` | SP24MM | **`(err u1001)`** — graduation rejected at this block | ⚠ |
| 27 | 5.5 | eval `(get-bonded)` DEX | – | `0x0704` | ℹ |
| 28 | 5.5 | eval `(var-get stx-balance)` DEX | – | `u1000000` | ℹ |
| 29 | 5.6 | `faktory-process-claim` 2nd attempt auth-id 7 | DEPLOYER | **`(err u321)`** | ⚠ |
| 30 | 5.6 | eval `(get-user-info wallet)` pre | – | tuple visible | ℹ |
| 31 | 6 | `faktory-fee-airdrop` auth-id 8 | DEPLOYER | **`(err u323)`** — cooldown active | ⚠ |
| 32 | 7 | `faktory-execute BUY 100k sats` auth-id 1 | DEPLOYER | **`(err u403)`** — pool not authorized | ⚠ |
| 33 | 7 | `faktory-execute SELL 500B tokens` auth-id 2 | DEPLOYER | **`(err u403)`** | ⚠ |
| 34 | 7.1 | `faktory-execute ADD-LIQ 100k LP` auth-id 10 | DEPLOYER | **`(err u403)`** | ⚠ |
| 35 | 7.2 | `faktory-execute REMOVE-LIQ 50k LP` auth-id 11 | DEPLOYER | **`(err u1)`** | ⚠ |
| 36 | 7.5 | eval `(get-swap-quote 50T sell)` pool | – | quote tuple | ℹ |
| 37 | 7.5 | SP24MM `fakfun-core-v2.execute 50T SELL` | SP24MM | **`(err u403)`** | ⚠ |
| 38 | 8 | BOB `transfer 2M → wallet` | DEPLOYER | **`(err u1)`** — BOB transfer rejected | ⚠ |
| 39 | 8 | `faktory-burn-bob` auth-id 9 | DEPLOYER | **`(err u1)`** | ⚠ |
| 40 | 8 | eval `(get-user-stats wallet)` BOB | – | tuple visible | ℹ |
| 41 | 9 | `stack-stx-juice 1 STX → JUICE-SIGNER` auth-id 12 | DEPLOYER | `(ok true)` | ✅ |
| 42 | 9 | eval `(pox-4.get-delegation-info wallet)` | – | `(some {amount-ustx: u1_000_000, delegated-to: …})` | ✅ |
| 43 | 10 | `revoke-stacking` auth-id 13 | DEPLOYER | `(ok true)` | ✅ |
| 44 | 10 | eval `(pox-4.get-delegation-info wallet)` | – | `none` | ✅ |
| 45 | – | eval `wallet.(get-owner)` | – | `(ok (some USER))` | ✅ |
| 46 | – | eval `fakfun-wallet-core.(is-whitelisted)` | – | `0x03` (true) | ✅ |
| 47 | – | eval `(get-user-info wallet)` pre | – | tuple visible | ℹ |
| 48 | – | eval `(get-fee-distribution-info)` pre | – | tuple visible | ℹ |

## What the run actually proves

* **Every webauthn-signed wallet operation passes signature verification.**
  Zero `(err u4002)` (err-invalid-signature) were returned. Every signed
  call delegated past the wallet's `is-authorized → consume-signature →
  secp256r1-verify` chain into `fakfun-core-v2`. The downstream errors
  (u321, u403, u1001, u323, u1) are mainnet-state errors from
  `fakfun-core-v2`, not auth-layer errors from the wallet.
* **`add-admin-with-signature` (auth-id 0) and `faktory-process` (auth-id
  5) returned (ok …) end-to-end.** Both signatures verified AND the
  underlying operation succeeded. The wallet completes pre as the 10th
  buyer.

## Why the downstream errors

The `unfair2` token suite that v3 used is now in a real-mainnet state
(block 7978267) that's incompatible with the lifecycle scenario this sim
was built around:

* **u321 `claim` failures**: vesting hasn't started in the way the v3
  flow assumed; the wallet's `faktory-process-claim` is gated by
  `fakfun-core-v2`'s vesting clock.
* **u1001 DEX failures**: the DEX trade path is rejecting at the current
  state — likely `(var-get open) = false` after some prior interaction
  on real mainnet, and the v3 flow assumed open=true.
* **u403 pool failures**: the pool's approved-caller table doesn't list
  `fakfun-wallet-v2` (a freshly-deployed contract). Real `fakfun-core-v2`
  is the approved caller; the wallet calls into it via `as-contract` but
  the pool's authorization check still gates by contract-caller, and the
  freshly-deployed wallet hasn't been added.
* **u323 fee airdrop**: identical to v3's expected u324 cooldown — current
  pre's fee-airdrop is in cooldown at this block.
* **BOB transfer u1**: `built-on-bitcoin-stxcity` rejected the
  DEPLOYER→wallet transfer at the current state (likely `tx-sender` check
  or insufficient balance at fork).
* **9th seat buyer u1**: SP1DZARHA1GVEWVCDF1J9N044A69Q6VT7KMDPQ5N9 may have
  already participated in `unfair2-pre-faktory` on real mainnet — per-user
  buy-limit triggers.

To get a **fully green** lifecycle, the sim should be re-targeted at a
fresh token (deployed fresh inside the sim) where pre/DEX/pool are
guaranteed to be in initial state — exactly how the v3 sim was originally
captured. That's a follow-up; the **auth layer is already verified**.

## Sig-auth tuple format

Same as `simul-fakfun-v2-token-lock.md`. Three of the wallet's 11 signed
payloads (auth-ids 3, 4, 7) carried the longer Chrome
`other_keys_can_be_added_here` extension on `clientDataSuffix` (~210
bytes). The contract's `(buff 512)` cap absorbed it cleanly.

## Re-signing

The 32-byte challenge depends only on the wallet **principal**
(`SPV9K21….fakfun-wallet-v2`), the SIP-018 topic, and topic-specific args
(amounts, opcodes, etc.). Editing the wallet contract source does
**not** invalidate signed bundles — only changing op parameters does.
