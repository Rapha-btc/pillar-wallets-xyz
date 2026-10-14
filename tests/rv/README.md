# Rendezvous fuzzing — fakfun-wallet-v2

Full-surface stateful fuzz of every public function on
`contracts/fakfun-wallet-v2.clar`, mirroring the structure used in
jingswap-v3.

## Layout

| File | Role |
|------|------|
| `Clarinet.toml` | RV-only manifest (28 contracts: 10 traits + 18 mocks + 2 production helpers + SUT) |
| `build.sh` | Rewrites mainnet principals in the wallet source to local mocks; output goes to `.build/fakfun-wallet-v2.clar` (gitignored) |
| `fakfun-wallet-v2.invariants.clar` | 12 invariants appended to the wallet under fuzz |
| `mock-*.clar` | 19 stubs for external principals the wallet calls (sbtc-token, fakfun-core-v2, pox-4, fast-pool-v3, auth-v7, game-wager-v1, nfts-core, etc.) |
| `*-trait.clar` | 10 local trait copies so trait arguments resolve |

The two production contracts we own are referenced directly via
`../../contracts/`:
- `smart-wallet-standard-auth-helpers-v7.clar` (SIP-018 hash builders)
- `clarity-webauthn.clar` (passkey verifier)

## Run

```
bash tests/rv/build.sh
cd tests/rv
npx rv . fakfun-wallet-v2 invariant --runs=100
```

`build.sh` must be invoked from the project root (it reads
`contracts/fakfun-wallet-v2.clar`).

`npx rv` must be invoked from `tests/rv/` because it picks up
`Clarinet.toml` from the cwd.

## Result snapshot (2026-05-16, --runs=100)

- 39/39 wallet entrypoints touched, 10–22 calls each
- 12/12 invariants PASSED, 0 FAILED
- ~4,400 total calls executed
- Most calls IGNORED with `u4001` / `u4002` / `u4011` / `u4013` — RV
  can't forge WebAuthn signatures, so sig-gated paths always bounce.
  The pre-auth surface (arg parsing, ordering, error paths, state
  invariants) is what actually gets exercised here. The
  signature-forgery / replay-style attacks live in the stxer
  mainnet-fork sims (`pillar-wallets-xyz/simul-fakfun-v2-*.js`).

## Invariants

| Name | What it asserts |
|------|----------------|
| `invariant-is-initialized-monotonic` | `is-initialized` only ever flips false→true |
| `invariant-last-activity-not-future` | `last-activity-block` never exceeds `burn-block-height` |
| `invariant-max-gas-bounded` | `max-gas-amount` stays under hard cap |
| `invariant-operation-nonce-monotonic` | `pending-operation-nonce` never decreases |
| `invariant-owner-is-admin-when-initialized` | once initialized, the owner is always in the admins map |
| `invariant-period-start-not-future` | `period-start-block` never exceeds `burn-block-height` |
| `invariant-pubkey-cooldown-bounded` | `pubkey-cooldown-period` stays within configured bounds |
| `invariant-pubkey-initialized-monotonic` | per-pubkey-init counts only grow |
| `invariant-recovery-address-set` | once recovery address set, never reset to none |
| `invariant-thresholds-nonzero` | configured stx/sbtc thresholds remain non-zero |
| `invariant-token-lock-bool` | `token-lock-enabled` is always a defined bool |
| `invariant-wallet-cooldown-bounded` | per-op cooldown stays within `MIN-COOLDOWN`–`MAX-COOLDOWN` |

## Re-running after wallet changes

Any edit to `contracts/fakfun-wallet-v2.clar` requires re-running
`build.sh` before `npx rv`. The `.build/` directory is gitignored so
the rewritten SUT is regenerated on each invocation.

---

# Rendezvous fuzzing: juice-autostake-safe

Target: `contracts/juice-autostake-safe.clar` on main. Current results are
for 7724b0d (RV-F1 fix), the final source: its comment-stripped deploy bytes
are jing-contracts-v3 `simulations/deploy-bytes-mv7dfb/juice-autostake-safe.clar`
(51,812 B, sha256 599192e3...). The first campaign ran on 611873c (== 16ebb2c)
and is kept below as history. Between the two, 99d69e8 added a trailing
`signer-calldata` argument to `stake-stx-juice` / `update-stake-stx-juice`;
the harness properties pass `none` for it. Its own project is in `juice-autostake-safe/`, with its own
`Clarinet.toml`, simnet plan and build. The production `Clarinet.toml` and
`contracts/*.clar` are not edited.

## Run

```
bash tests/rv/juice-autostake-safe/run-all.sh          # 2000 inv / 10000 prop runs, seeds 1 and 2
bash tests/rv/juice-autostake-safe/run-all.sh 300 1000  # quick pass
```

`run-all.sh` runs `build.sh` and then `check-setup.mjs`. That script stops
the run if the setup batch did not take effect: pool not registered, safe
not onboarded, or safe not funded. After that it runs
`npx rv . juice-autostake-safe invariant|test --config=rv-<mode>-<seed>.json`
from the project directory.

## Layout

| File | Role |
|------|------|
| `build.sh` | Builds the three build artifacts in `contracts/`, then runs `gen-plan.mjs` |
| `juice-autostake-safe.rv.clar` | Harness appended to the SUT: rv context, PoX-lock emulation, fuzz aids, 12 invariants, 14 properties |
| `dialer.mjs` | Invariant-mode pre/post dialers: passkey injection and an asset-event oracle |
| `keys.mjs` | Fixed test keys: the P-256 passkey and the pool's secp256k1 signer, with the grant signature |
| `gen-plan.mjs` | Regenerates the simnet plan and appends the `rv-setup` batch (emulated senders) |
| `check-setup.mjs` | Checks that the setup batch ran in rv's simnet |
| `mkconfig.sh`, `rv-accounts.json` | rv config: seed, runs, dialer and 4 accounts |
| `contracts/zz-gas-*.clar` | Gas stations: fee 20 (normal), 0 (free), 1000 (= max-gas, fills the fuse), 5000 (greedy, over the allowance), and a thief that tries to pull STX and zz-ft |

## Setup (real paths, no bypass)

The `rv-setup` plan batch uses emulated senders for setup that the fuzz
accounts cannot do themselves:

1. The core-v2 admin (SPV9K21T...) runs `set-verified-contract` on the safe.
2. The pool registers in the real pox-5 with a real grant signature.
3. The real FAKFUN-DEPLOYER runs `onboard`: owner wallet_1, recovery
   wallet_2, thresholds 1000 STX / 0.01 BTC, cooldown 144.
4. wallet_3 funds the safe with 2000 STX, zz-ft and one zz-nft.

sBTC is funded by the fuzzers, not by the plan. Simnet credits genesis sBTC
only after the plan has run.

The `overwrite` accounts mode limits senders and principal arguments to
wallet_1..4. The owner is then one sender in four, not one in ten.

## Test-only patches (generated copy only; build.sh fails unless each applies the stated number of times)

| # | Patch | Why |
|---|-------|-----|
| A | `JUICE-SIGNER`, the set-keeper helper and the register-wallet canonical are re-pointed to the local deployer (`.juice-autostake-pool`, `.juice-autostake-safe-auth-helpers-v1`, `.juice-autostake-safe`) | rv publishes project contracts under ST1PQ... (same 3 repoints as `tests/cl-autostake-cov`) |
| B | `INACTIVITY-PERIOD` changed from u52560 to u120 (`RV_INACTIVITY`) | At 1000+ runs rv mines at most 100 blocks per run. With the original value, `recover-inactive-wallet` cannot be reached |
| C1 | `(stx-account current-contract)` changed to `(rv-stx-account)` (2 sites: `locked-ustx`, `restake`) | Simnet does not run the node's PoX lock handler, so staked STX reads as unlocked. The emulation reports `locked = active pox-5 amount-ustx` |
| C2 | `stx-transfer?` / `stx-transfer-memo?` changed to the `rv-` wrappers (3+3 sites) | On the node, a transfer of locked STX fails with err u1. The wrappers do the same against the emulated lock |
| C3 | `update-stake-stx-juice` asserts `amount-increase <= emulated unlocked` (err u8) before its pox-5 call | pox-5 does this check against the real `stx-account` (ERR_INSUFFICIENT_STX u8). Simnet sees the full balance |

Without C, `restake` re-stakes the whole balance on every call, the owner
can send locked STX away, and the accounting invariant fails on simnet
behaviour, not on the contract.

## Harness aids (in the appended file, public, called by rv)

- `rv-fund`, `rv-fund-sbtc`, `rv-fund-ft`, `rv-fund-nft` send assets into
  the safe. Anyone can do this on mainnet too.
- `rv-rebind-passkey` points the test passkey back at the current owner.
  The contract has no way to add a passkey after onboard, and rv keeps one
  simnet session across all runs. Without this aid, every passkey path
  would stop working after the first owner change. **Each finding that
  needs this aid is checked again without it** (see RV-F1).
- Property tests call SUT publics directly. An inner `err` does not roll
  back like a top-level transaction, so each property takes a snapshot of
  `last-activity-block` / `spent-this-period` (and of the op or admin entry
  it may touch) and restores it after an `err`.

## The dialer (invariant mode only; rv runs no dialers in property mode)

The pre-dialer works as follows:

- On 60% of optional `sig-auth` calls and 85% of required ones, it puts in
  a VALID passkey signature over the exact SIP-018 message. Messages that
  depend on state (confirm-max-gas, set-wallet-config,
  confirm-transfer-wallet) are signed over values recorded from the
  successful propose/signal calls that wrote them.
- On 10% of calls it puts in a REPLAY of the last successful call (same
  arguments, same signature).
- It also adjusts arguments that rv rarely hits by chance: asset names,
  sBTC as the SIP-010, live op-ids, legal cooldowns and max-gas values,
  valid BTC recipients, and small `cycles-to-extend`.

A seeded PRNG (`DIAL_SEED`) makes runs repeatable. `DIAL_LOG=<file>`
records each injected call.

The post-oracle checks these properties on every successful call:

- **O1**: Every asset that leaves the safe matches the function and its
  arguments, or a tracked pending op. `restake`, staking, config and
  ownership calls move no assets. The safe's own `ect` probe token is
  excluded.
- **O2**: A call makes at most one gas payment. It is in sBTC and is at
  most the current max-gas.
- **O3**: A replayed signature never succeeds.
- **O4**: When the token lock is on, no lock-gated passkey call succeeds.
- **O5**: An op pays at most once and never after a veto, and an op created
  by a passkey never pays through `execute-*-now`.

## Invariants (12)

| Name | Asserts |
|------|---------|
| single-admin-is-owner | `admins` holds exactly the owner. The check covers every probe principal plus the contract |
| no-self-reference | The safe is never owner, recovery or pending-recovery |
| gas-within-ceiling | `max-gas-amount` and the pending max-gas are <= MAX-GAS-CEILING |
| gas-fuse | Gas spent is <= cap * (25 + number of exempt confirm-transfer payments) |
| config-bounds | The cooldown and the pending cooldown stay in [144, 4032] (pending may be 0) |
| spend-within-thresholds | Per-period STX/sBTC spend is <= the thresholds. Checked until the first set-wallet-config succeeds, because that call can legitimately lower a threshold |
| stake-backed-by-balance | The active pox-5 `amount-ustx` is <= the safe's STX balance (staked + liquid = balance) |
| position-signer-is-juice | The only stake target is JUICE-SIGNER |
| lock-at-most-96 | The unlock cycle is <= current + 1 + 96 |
| pending-ops-consistent | Every id below the nonce exists, the nonce slot is free, and no op is both executed and vetoed |
| activity-not-future | `last-activity-block` <= `burn-block-height` |
| keeper-not-placeholder | The keeper is never the placeholder |

## Properties (14). PASSED = the inner call succeeded and every effect was checked

| Name | Asserts on success |
|------|--------------------|
| test-stx-transfer | Caller is admin. An immediate send moves exactly `amount` of unlocked STX to the recipient. Over the threshold, the call queues an admin op and moves nothing |
| test-sbtc-transfer | Same as above for sBTC and its threshold |
| test-ft-transfer | Caller is admin. A non-sBTC transfer never queues and moves exactly `amount` |
| test-sbtc-withdrawal | Caller is admin. The call locks exactly amount + max-fee, or queues an `sbtc-withdraw` op |
| test-execute-pending-once | Caller is admin. The op was not executed or vetoed and is due. It pays exactly its amount, and a second execute returns err u4014 |
| test-veto-blocks-execution | Caller is admin. The op was not executed, and a later execute fails |
| test-stake | Caller is admin. No position existed before. The new position has the exact amount, the Juice signer, cycle +1 and 96 cycles. No STX moves |
| test-update-stake | Caller is admin. The increase is <= unlocked. The amount and the unlock cycle grow by exactly the increase and the extension |
| test-unstake | Caller is admin. The unlock moves to the next cycle, the amount stays locked, and a later `restake` fails |
| test-restake | Caller is the keeper. No STX moves. The call adds exactly the unlocked STX, sets the lock to max(old, current+1+96) and does not change activity |
| test-set-keeper | Caller is admin. The keeper is set and the owner does not change |
| test-recover-inactive | Caller is the recovery address and the safe is inactive. The new admin becomes the only admin, the owner and the keeper |
| test-admin-only-config | Non-admin: propose-max-gas, propose-transfer, toggle-lock and signal-config all fail and change nothing. Admin: the values stay in bounds, and a signal does not apply the config |
| test-zz-fund | Funding aid (STX, sBTC, NFT deltas) |

## Results (2026-10-14, source 7724b0d, final)

Rebuilt with `build.sh` from 7724b0d (all 8 patches applied, 12 invariants,
14 properties). Harness change since 611873c: `test-stake` and
`test-update-stake` pass `none` as the new trailing `signer-calldata`
argument (99d69e8). Without it every property run ends at the first
`test-update-stake` with `IncorrectArgumentCount(5, 4)`. The dialer now
also counts RV-F1 attempts: `f1Signed` is the number of valid passkey
`confirm-transfer-wallet` calls signed while pending == owner, and `f1Ok`
is how many of them succeeded. These calls are signed only with
`RV_ALLOW_F1=1`.

| Run | Seed 1 | Seed 2 | RV-F1 attempts (f1Signed / f1Ok) |
|-----|--------|--------|------------------------|
| quick: invariant 300, property 1000 | PASS / PASS | PASS / PASS | n/a (not signed) |
| quick, `RV_ALLOW_F1=1` | PASS / PASS | PASS / PASS | seed 1: 0 / 0; seed 2: 7 / 0 |
| full: invariant 2000, property 10000 | PASS / PASS | PASS / PASS | n/a (not signed) |
| full, `RV_ALLOW_F1=1` | PASS / PASS | PASS / PASS | seed 1: 0 / 0; seed 2: 0 / 0 |

Each run takes about 2 min (quick) or 13.5 min (full, both seeds).
`invariant-single-admin-is-owner` holds in every run. In the quick
`RV_ALLOW_F1=1` run on seed 2, rv signed the RV-F1 message 7 times and the
fixed contract refused it every time. In the full runs the dialer never
reached the pending == owner state. The `RV_ALLOW_F1=1` full run therefore
made the same calls as the default run, with identical dialer stats. The
fix is also proven without harness aids by
`tests/juice-autostake-safe-rv-repro.test.ts` (the confirm is refused
u4001) and on the stxer fork by `simul-juice-autostake-safe.js` step M2
(stand-in 86/86; REAL_POOL 87/87, stxer 50de1e4ae75471c76f55673211c0be2c).

Full-run successful state-changing calls (seed 1 / seed 2): valid-passkey
successes 606/433; confirm-transfer-wallet 54/43; recover-inactive-wallet
0/7; restake 26/37; stake 11/14; update-stake 13/18. Ops tracked 68/91,
executed 10/27, vetoed 33/26. Property PASSED counts: stake 6/4,
update-stake 104/97, restake 52/72, set-keeper 188/190.

## Results, history (2026-10-14, source 611873c == 16ebb2c)

| Suite | Seed 1 | Seed 2 |
|-------|--------|--------|
| invariant (12 inv + oracle), 2000 runs | PASS | PASS |
| property (14), 10000 runs | PASS | PASS |

Successful state-changing calls in the invariant runs (seed 1 / seed 2):

- stx-transfer 70/45, sip010-transfer 26/43, sip009-transfer 34/32,
  sbtc-initiate-withdrawal 55/41
- stake 11/13, update-stake 22/11, unstake 49/28, restake 24/27
- set-keeper 68/43, toggle-token-lock 106/89, veto 110/43
- execute-pending-stx-transfer 10/9, execute-pending-stx-transfer-now 1/3
- confirm-transfer-wallet 57/39, recover-inactive-wallet 2/6,
  confirm-max-gas 2/5 (seed 1 max-gas reached 5288), set-wallet-config 1/5

Valid-passkey successes: 714 (seed 1) / 455 (seed 2). Ops tracked: 56/48,
executed 11/12, vetoed 37/20.

Property PASSED counts (seed 1 / seed 2):

- stx-transfer 181/167, sbtc-transfer 168/188, sbtc-withdrawal 147/157,
  ft-transfer 30/25
- execute-pending-once 31/19, veto 178/150
- stake 6/4, update-stake 104/97, unstake 194/160, restake 52/72
- set-keeper 188/190

### RV-F1 (counterexample on 611873c; FIXED in 7724b0d)

**Status.** Fixed in 7724b0d. `confirm-transfer-wallet` now starts with
`(asserts! (not (is-eq pending (var-get owner))) err-unauthorised)`
(contract :1166). See the 7724b0d results above.

**Finding.** `confirm-transfer-wallet` empties the admin set when
`pending-transfer` equals the current owner.

**Location.** `contracts/juice-autostake-safe.clar:1166-1167`:

```clarity
(map-set admins pending true)
(map-delete admins (var-get owner))   ;; same key when pending == owner
```

**Root cause.** Three things combine:

- `propose-transfer-wallet` (:1120) refuses only `new-admin == tx-sender`,
  and only at propose time.
- `recover-inactive-wallet` (:1308-1325) never clears `pending-transfer`.
- `confirm-transfer-wallet` never checks `pending != owner`.

**How rv found it.** rv found it at seed 1. The run used the harness aid
`rv-rebind-passkey`, and the minimized sequence was:

1. Owner W4 calls `propose-transfer-wallet(W2)`.
2. The recovery address recovers to W2 after the inactivity period.
3. `rv-rebind-passkey` runs.
4. A passkey call to `confirm-transfer-wallet` succeeds.

After step 4, `invariant-single-admin-is-owner` is false.

**Sequence without any harness aid.** This is what
`tests/juice-autostake-safe-rv-repro.test.ts` runs, with the unedited
source and the real 52560-block inactivity period:

1. A calls `propose-transfer-wallet(B)` and then
   `confirm-transfer-wallet` with the passkey. B is now the owner.
2. B calls `propose-transfer-wallet(A)`.
3. After 52561 blocks, the recovery address calls
   `recover-inactive-wallet(A)`. A is the owner again, and pending is
   still A.
4. A's passkey calls `confirm-transfer-wallet`, which signs
   `new-admin: A`. The call returns `(ok true)`.

**Effect.** After step 4, no principal is an admin and the owner is A:

- Admin calls fail with u4001.
- Passkey calls fail with u4005.
- The keeper (A) can still run `restake`, which keeps re-locking for 96
  cycles.
- The safe stays frozen until a second full inactivity period passes and
  the recovery address recovers it again.

No funds are lost.

**Severity.** Low. It needs the owner to sign a transfer to itself, after
an ownership round-trip that includes an inactivity recovery.

**Fix options (as found on 611873c; the first one is now applied in 7724b0d).**
Either change could prevent it:

- In `confirm-transfer-wallet`, add
  `(asserts! (not (is-eq pending (var-get owner))) err-forbidden)`.
- In `recover-inactive-wallet`, clear `pending-transfer`.

**Dialer setting.** After the finding, the dialer by default stops signing
that one message, so the other invariants stay meaningful.
`RV_ALLOW_F1=1` lets rv reach it again. On 7724b0d the message is refused
(`f1Ok` 0), so `RV_ALLOW_F1=1` runs pass.

### Gaps

- `execute-pending-sbtc-transfer(-now)` and
  `execute-pending-sbtc-withdrawal(-now)` had 0 successes in invariant mode.
  The sBTC queue path and its execution are covered only by the
  test-execute-pending-once property (admin path).
- `test-recover-inactive` had 0 successes in property mode. Owner calls
  keep the safe active, and in that mode rv mines at most 10 blocks per
  run. Recovery is covered in invariant mode (8 successes) and by vitest.
- The keeper reset after `confirm-transfer-wallet` is not an invariant,
  because rv invariants cannot keep ghost state. It is covered for recovery
  (test-recover-inactive) and by `tests/juice-autostake-safe-keeper.test.ts`.
- PoX locking is emulated (patch C). The real node lock handler and the
  `(with-staking N)` allowance are not exercised in simnet. The stxer fork
  sims cover them.
- Property mode runs only the admin path. All passkey coverage is in
  invariant mode, through the dialer.
