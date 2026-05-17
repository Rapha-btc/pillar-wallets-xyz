# simul-fakfun-v2-governance — Admin / Config / Recovery / Threshold-Breach Paths

Stxer mainnet-fork simulation covering the **12 untested wallet public
functions** identified in the coverage table — every admin-only path
(no sig required), every threshold-breach pending-operation path, and
the long-wait inactive-wallet recovery flow.

**Latest run:** https://stxer.xyz/simulations/mainnet/f56c6525110605ddf73944a960fd66d4
**Status:** ✅ **39/39 steps pass**
**Block:** 7978805 · **Epoch:** 3.4 (Clarity 5)
**Signing pubkey:** `02eca875ad4e06371c75a1fb889f69b52c4900d7f4f4d17e2a059152213ba2d785` (reused for add-admin + propose-recovery only)
**Origin / rp.id:** `fak.fun`

## Untested functions exercised (12)

| Phase | Function | Auth path | Notes |
|---|---|---|---|
| B | `set-max-gas-amount` | admin | sets max-gas-amount from u1000 → u500 |
| C | `signal-config-change` | admin | marks config-signaled-at=burn-block-height |
| C | `set-wallet-config` | admin (after cooldown) | lowers stx/sbtc thresholds |
| D | `signal-pubkey-cooldown-change` | admin | signals u200 (down from u432) |
| D | `confirm-pubkey-cooldown-change` | admin (after old u432 cooldown) | applies u200 |
| E | `propose-admin-pubkey` | admin | proposes new (dummy) pubkey |
| E | `confirm-admin-pubkey` | admin (after new u200 cooldown) | adds pubkey → USER in `pubkey-to-admin` |
| E | `remove-admin-pubkey` | admin | removes the pubkey |
| F | `execute-pending-stx-transfer` | admin (after cooldown) | follows a 1 STX transfer that breached the 0.1 STX threshold |
| G | `execute-pending-sbtc-transfer` | admin (after cooldown) | follows a 50k-sat sip010-transfer that breached the 10k threshold |
| H | `confirm-recovery` | admin | confirms FAKFUN_DEPLOYER as recovery-address |
| I | `recover-inactive-wallet` | recovery-addr (after INACTIVITY-PERIOD u52_560) | FAKFUN_DEPLOYER takes over admin, USER removed |

## Reused signatures from `signed-bundle-admin.json`

This sim doesn't need any new user signatures. It reuses two from the
admin bundle:

| Auth-ID | Topic | Why it's reusable |
|---|---|---|
| 0 | `add-admin` (new-admin=USER) | Same wallet contract → same SIP-018 challenge → same sig. The wallet's `used-pubkey-authorizations` map is empty at the start of each stxer sim (fresh deploy), so replay protection isn't triggered. |
| 6 | `propose-recovery` (new-recovery=FAKFUN_DEPLOYER) | Same reasoning. |

## Per-step results

| # | Phase | Operation | Sender | Result | ✓ |
|---|---|---|---|---|---|
| 0 | A | Deploy `clarity-webauthn` | DEPLOYER | `(ok true)` | ✅ |
| 1 | A | Deploy `smart-wallet-standard-auth-helpers-v7` | DEPLOYER | `(ok true)` | ✅ |
| 2 | A | `set-verified-contract fakfun-wallet-v2` | DEPLOYER | `(ok true)` | ✅ |
| 3 | A | Deploy `fakfun-wallet-v2` | DEPLOYER | `(ok true)` | ✅ |
| 4 | A | `onboard pubkey` | FAKFUN_DEPLOYER | `(ok true)` | ✅ |
| 5 | A | `add-admin-with-signature(USER)` auth-id 0 (reused) | USER | `(ok true)` | ✅ |
| 6 | A | sBTC `transfer 200_000 → wallet` | USER | `(ok true)` | ✅ |
| 7 | A | STX `transfer 5_000_000 → wallet` | DEPLOYER | `(ok true)` | ✅ |
| 8 | B | `set-max-gas-amount(u500)` | USER | `(ok true)` | ✅ |
| 9 | B | eval `(var-get max-gas-amount)` | – | `u500` | ✅ |
| 10 | C | `signal-config-change` | USER | `(ok true)` | ✅ |
| 11 | C | `addAdvanceBlocks(150)` | – | ok | ✅ |
| 12 | C | `set-wallet-config` (stx=u100_000, sbtc=u10_000, zsbtc=u100_000, cooldown=u144) | USER | `(ok true)` | ✅ |
| 13 | C | eval `(var-get wallet-config)` | – | tuple with new thresholds | ✅ |
| 14 | D | `signal-pubkey-cooldown-change(u200)` | USER | `(ok true)` | ✅ |
| 15 | D | `addAdvanceBlocks(450)` past old cooldown | – | ok | ✅ |
| 16 | D | `confirm-pubkey-cooldown-change` | USER | `(ok true)` | ✅ |
| 17 | D | eval `(var-get pubkey-cooldown-period)` | – | `u200` | ✅ |
| 18 | E | `propose-admin-pubkey(NEW_PUBKEY)` | USER | `(ok true)` | ✅ |
| 19 | E | `addAdvanceBlocks(210)` past new u200 cooldown | – | ok | ✅ |
| 20 | E | `confirm-admin-pubkey` | USER | `(ok true)` | ✅ |
| 21 | E | eval `(map-get? pubkey-to-admin NEW_PUBKEY)` | – | `(some USER)` | ✅ |
| 22 | E | `remove-admin-pubkey(NEW_PUBKEY)` | USER | `(ok true)` | ✅ |
| 23 | E | eval `(map-get? pubkey-to-admin NEW_PUBKEY)` | – | `none` | ✅ |
| 24 | F | `stx-transfer(1 STX)` above 0.1 STX threshold | USER | `(ok true)` — pending op #0 created | ✅ |
| 25 | F | eval `(var-get operation-nonce)` | – | `u1` | ✅ |
| 26 | F | `addAdvanceBlocks(150)` past cooldown | – | ok | ✅ |
| 27 | F | `execute-pending-stx-transfer(op-id 0)` | USER | `(ok true)` | ✅ |
| 28 | G | `sip010-transfer(50k sats sBTC)` above 10k threshold | USER | `(ok true)` — pending op #1 created | ✅ |
| 29 | G | `addAdvanceBlocks(150)` past cooldown | – | ok | ✅ |
| 30 | G | `execute-pending-sbtc-transfer(op-id 1)` | USER | `(ok true)` | ✅ |
| 31 | H | `propose-recovery(FAKFUN_DEPLOYER)` auth-id 6 (reused) | USER | `(ok true)` | ✅ |
| 32 | H | `confirm-recovery` | USER | `(ok true)` | ✅ |
| 33 | H | eval `(var-get recovery-address)` | – | `FAKFUN_DEPLOYER` | ✅ |
| 34 | I | `addAdvanceBlocks(52_700)` past INACTIVITY-PERIOD | – | ok | ✅ |
| 35 | I | `recover-inactive-wallet(FAKFUN_DEPLOYER)` | FAKFUN_DEPLOYER | `(ok true)` | ✅ |
| 36 | – | eval `(get-owner)` | – | `(ok (some FAKFUN_DEPLOYER))` | ✅ |
| 37 | – | eval `(map-get? admins USER)` | – | `none` (USER removed) | ✅ |
| 38 | – | eval `(map-get? admins FAKFUN_DEPLOYER)` | – | `(some true)` | ✅ |

## Coverage status after this sim

`fakfun-wallet-v2` has **39 public functions**. Tested across five sims:

| Sim | Public functions exercised |
|---|---|
| `simul-fakfun-v2-wallet` | 13 |
| `simul-fakfun-v2-nft` | 6 |
| `simul-fakfun-v2-token-lock` | 6 (including dummy-sig branches) |
| `simul-fakfun-v2-admin` | 10 |
| `simul-fakfun-v2-governance` (this sim) | 12 |
| **Total** | **37 of 39** (some functions are reused across sims) |

Still NOT exercised (2):

* **`execute-pending-zsbtc-transfer`** — requires acquiring zsBTC inside
  the sim. Not exercised because no straightforward funding path exists
  on mainnet fork. Same Clarity logic as
  `execute-pending-sbtc-transfer` (only the token contract / asset name
  differ), which IS exercised — gives high confidence in the path.
* **`wager-deposit`** — uses
  `auth-v7.build-wager-deposit-hash` from an external contract on a
  different deployer (game-wager). v2 design notes say games are
  out-of-scope for this contract's first revision; defer to the
  game-wager test suite if/when integration tests are needed.

## Cooldown arithmetic reference

| Cooldown var | Default | After Phase D | Used in |
|---|---|---|---|
| `cooldown-period` | u144 | u144 | wallet-config set, pending-op execute |
| `pubkey-cooldown-period` | u432 | u200 | propose-admin-pubkey → confirm |
| `MAX-CONFIG-COOLDOWN` (constant) | u4032 | u4032 | upper bound for cooldown-period |
| `INACTIVITY-PERIOD` (constant) | u52560 | u52560 | recover-inactive-wallet gate |

Block advances needed in this sim:
- Phase C: 150 burn (past `cooldown-period = 144`)
- Phase D: 450 burn (past old `pubkey-cooldown-period = 432`)
- Phase E: 210 burn (past new `pubkey-cooldown-period = 200`)
- Phase F: 150 burn (past `cooldown-period = 144`)
- Phase G: 150 burn (past `cooldown-period = 144`)
- Phase I: **52_700 burn** (past `INACTIVITY-PERIOD = 52_560`)

Total simulated burn time: ~53.8k blocks ≈ 1 year of bitcoin chain time.

## Notes on tx-sender vs admin vs sig

Every signed path in v2 uses `(match sig-auth sig-auth-details … (try!
(is-authorized none)))`. The fallback branch (`is-authorized none`)
calls `is-admin-calling tx-sender`, which requires the **transaction
sender** to be in `admins`. So all the no-sig admin functions in this
sim (set-max-gas-amount, set-wallet-config, signal-*, propose-*,
confirm-*, execute-pending-*, remove-admin-pubkey, confirm-recovery)
work because USER is the tx-sender and is in `admins` after the Phase A
`add-admin-with-signature`.

`recover-inactive-wallet` is the exception: it explicitly checks
`(asserts! (is-eq tx-sender (var-get recovery-address)) err-unauthorised)`,
so FAKFUN_DEPLOYER (the recovery-address, set in Phase H) must be the
tx-sender for Phase I to succeed.
