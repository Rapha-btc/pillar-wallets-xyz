# pox-5 staking — contracts, simulations, and what is *not* covered

Covers `juice-safe-v0`, `fakfun-wallet-v9`, and their shared
`juice-safe-auth-helpers-v1`. All three are deployed on mainnet under
`SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22`.

pox-4's last reward cycle was 140 and the chain has forked to pox-5, so the
`stack-stx-juice` path in fakfun-wallet v6–v8 calls pox-4 `delegate-stx` and can
only fail. These contracts stake on pox-5.

---

## Status at a glance

**DEPLOY `juice-safe-v2` and `fakfun-wallet-v11`.** Earlier versions are live but
superseded; none of v0/v1/v9/v10 should be onboarded. Keeping them unregistered
as canonical is what makes them un-onboardable.

| contract | state |
|---|---|
| `juice-safe-v2` | deployed, **62 + 16 + 14 + 39 + 10 pass**, use this |
| `fakfun-wallet-v11` | deployed, **50 + 17 pass**, use this |
| `juice-safe-v1` | superseded -- unbounded `set-max-gas-amount` |
| `juice-safe-v0` | broken -- `unstake` -> `(err u128)`, no exit path |
| `fakfun-wallet-v10` | superseded -- unbounded `set-max-gas-amount` |
| `fakfun-wallet-v9` | broken -- `onboard` -> `(err u6002)` |
| `juice-safe-auth-helpers-v1` | deployed, shared by both wallets |

### What v2 / v11 fixed

**Gas-station vector** (audit, low severity, demonstrated against v1 at
[`bf0a97e5`](https://stxer.xyz/simulations/mainnet/bf0a97e5584c479e15242447dec7d485)):
the `<gas-trait>` contract is caller-supplied and NOT bound by the signed hash,
and the gas path never consults `would-exceed-sbtc-threshold`. With
`set-max-gas-amount` instant and unbounded, admin + relay compromise drained
400,000 sats in one call -- 4x the threshold, no pending op, no cooldown.

Low, not medium: needs the admin key AND the relay; phishing is impossible
(WebAuthn origin binding + the rp.id whitelist); each drain burns one single-use
signature so it is rate-limited by real user activity; and a compromised
frontend has the strictly better `confirm-transfer` route.

Three layers now, verified on both wallets
([v2 `da4dd815`](https://stxer.xyz/simulations/mainnet/da4dd81584a1c377734fe8e5de8fccec),
[v11 `a12bacf7`](https://stxer.xyz/simulations/mainnet/a12bacf794042a436498598fda435100)):

```
propose 20000 (> MAX-GAS-CEILING u10000)  (err u4018)
propose by a RANDOM principal             (err u4001)
confirm with nothing proposed             (err u4016)
propose 5000 (legal)                      (ok true)   max-gas UNCHANGED
confirm BEFORE the cooldown               (err u4012)
  hostile station mid-cooldown            (err u0)    attacker: 0 sats
advance 150
confirm AFTER the cooldown                (ok true) -> u5000, pending cleared
```

Stronger than designed: mid-cooldown the hostile station asked for more than the
still-current cap and the WHOLE transaction aborted. The attacker gets nothing
and the call fails loudly, rather than leaking the old cap.

Also in v2/v11: **token-lock now gates the gasless staking paths** (it did not
before -- an omission when porting from the pox-4 functions), and **v2 narrows
the rp.id whitelist to `juiceofbtc.com` alone**, dropping the four unrelated
origins inherited from `jing-mm-safe`.

### Audit of the deployed v2 / v11 — accepted, not bugs

On-chain sources fetched and confirmed byte-identical to the shipped templates
(46,542 B / 73,610 B). Two behaviours worth knowing about; both reviewed and
accepted rather than fixed.

**`cooldown-period` has no floor.** `set-wallet-config` accepts any value
including `u0`, and it is `is-authorized none` -- admin key alone, no passkey.
Set to zero, every cooldown in the wallet collapses: pending withdrawal ops
release immediately and `confirm-max-gas-amount` becomes instant, undoing the
gas mitigation.

Accepted because the FIRST change cannot skip its own delay: the path is
`signal-config-change` -> wait the CURRENT cooldown -> `set-wallet-config`, so a
compromised admin needs a full 144 blocks to remove all future ones, and both
steps emit `fakfun-wallet-core` events. The owner has that window to react. This
is inherited from `pillar-safe-v2`, so `jing-mm-safe`, `yguazu-stx-safe` and the
deployed fak.fun wallets carry it too.

**A pending max-gas raise has no explicit veto.** There is no
`veto-max-gas-amount`. The cancel mechanism is implicit: `propose-max-gas-amount`
has no "already proposed" guard, so **re-proposing a lower value overwrites the
pending one and restarts the clock**. That is the documented way to neutralise a
malicious raise -- propose `u1000` (or whatever the current value is) and the
attacker's pending raise is gone.

Everything else in the delta checked clean: the ceiling is asserted at propose
(`u20000` -> `u4018`), both halves are admin-gated (`u4001`), `confirm` before
the cooldown is `u4012`, `confirm` with nothing pending is `u4016`, and the
pending struct clears to `{amount u0, proposed-at u0}`.

### Not fixed, by design

Pending ops still do not count toward the daily period. They are gated by the
cooldown and the veto window, so the threshold was never meant as a rate limit.

**Still not closable in simulation:** live sBTC bonds -- reward runs pass an
empty `bond-periods` list, valid only while no bonds are active.

---

## The contracts

| contract | what it is |
|---|---|
| `juice-safe-auth-helpers-v1` | SIP-018 hash builders for the three pox-5 actions. Both wallets reference it by fully-qualified principal, so it **must deploy first**. |
| `juice-safe-v0` | `pillar-safe-v2` + pox-5 staking with the Juice signer, for juiceofbtc.com/stake. Forked from `jing-mm-safe` with the RFQ desk removed. |
| `fakfun-wallet-v9` | `fakfun-wallet-v8` with the dead pox-4 stacking paths replaced by the same pox-5 surface. |

### The pox-5 surface (identical in both wallets)

| function | pox-5 call | allowance |
|---|---|---|
| `stake-stx-juice(amount-ustx, sig-auth, gas)` | `stake`, `NUM-CYCLES u96`, `burn-block-height` | `(with-stacking amount-ustx)` |
| `update-stake-stx-juice(amount-increase, cycles-to-extend, sig-auth, gas)` | `stake-update`, `JUICE JUICE` | `(with-stacking (+ (locked-ustx) amount-increase))` |
| `unstake(sig-auth, gas)` | `unstake` | `(with-stacking (locked-ustx))` |

Three design points that are easy to "simplify" back into bugs:

**1. The allowance amount is a BALANCE, not a delta.** Post-conditions normally
bound what *moves*; the stacking entry instead reports what the account now
*has* staked. The node computes it as `amount_locked()` after the lock and
INSERTS (not adds) it into the asset map; the check is
`stacked > allowance -> violation`. So a top-up must declare the **resulting
total** — declaring `amount-increase` aborts every top-up, because
`existing + increase` always exceeds `increase`. A first stake only looks fine
because there the increase *is* the total.

**2. `stake` and `update-stake` are separate on purpose.** pox-5 has two entry
points and neither handles both cases (`stake` → `ERR_ALREADY_STAKED` when a
position exists, `stake-update` → `ERR_NOT_STAKING` when it does not). The front
end already reads pox-5 state to choose, so the wallet does not read it again.

**3. `cycles-to-extend` is an input because the lock window ROLLS.**
`stake-update` recomputes `num-cycles` as `unlock-cycle - current-cycle - 1`, so
a position opened at the 96-cycle maximum has only 95 left one cycle later.
Pinning it to `u0` would let the window decay to zero with no way to re-top it.
Extending *before* any cycles elapse is `ERR_INVALID_NUM_CYCLES (u20)` — the FE
should hide extend while `num-cycles` is at the cap.

---

## Simulations

All against the **deployed** contracts. Nothing redeployed. 191 assertions.

| harness | link | result |
|---|---|---|
| `simul-juice-safe-v2-lifecycle.js` | [`7c417156`](https://stxer.xyz/simulations/mainnet/7c4171563d29b62a9852145a90b9c0bf) | **62/62** |
| `simul-fakfun-wallet-v11.js` | [`bfe35568`](https://stxer.xyz/simulations/mainnet/bfe35568b89b55df35d86f0b4e3d02e5) | **50/50** |
| `simul-tranche-attack-v2.js` | [`0f87da02`](https://stxer.xyz/simulations/mainnet/0f87da02fde3f015fd1d1bf1daa7a0e6) | **39/39** |
| `simul-max-gas-cooldown-v11.js` | [`a12bacf7`](https://stxer.xyz/simulations/mainnet/a12bacf794042a436498598fda435100) | **17/17** |
| `simul-juice-safe-v2-recovery.js` | [`46effee6`](https://stxer.xyz/simulations/mainnet/46effee6a217e3cc9f75ceab1e8e4377) | **16/16** |
| `simul-max-gas-cooldown.js` | [`da4dd815`](https://stxer.xyz/simulations/mainnet/da4dd81584a1c377734fe8e5de8fccec) | **14/14** |
| `simul-juice-safe-v2.js` | [`5386b3dc`](https://stxer.xyz/simulations/mainnet/5386b3dcb12ab4aa02801f9af8b52585) | **10/10** |
| `simul-gas-station-exploit.js` | [`bf0a97e5`](https://stxer.xyz/simulations/mainnet/bf0a97e5584c479e15242447dec7d485) | the PoC, against v1 |

Covered on the deployed v2/v11: onboard (and v11's 3-step admin init) · stake ·
top-up · extend · **unstake by admin key AND by passkey**, rejecting anyone else ·
unlock + STX returned · gas station · **reward payout alongside 8 real mainnet
stakers** · double-pay guard · multi-tranche + hostile settle · STX/sBTC
withdrawals with the threshold guard and both release paths · 2FA ownership
transfer · inactivity recovery · **max-gas ceiling, admin gate and cooldown**.

### What the lifecycle run covers

`SPV9K21T....juice-safe-v0`, step by step:

```
 1  set-verified-contract                      (ok true)
 3  onboard                                    (ok true)
 6  stake by a random principal                (err u4001)   auth guard
 7  stake amount u0                            (err u4026)   err-zero-amount
 8  STAKE via passkey (rp juiceofbtc.com)      (ok true)
10  staker-info      amount-ustx u1000000000, cycle 141, 96 cycles,
                     signer = juice-pool-stx-signer
11  TOP-UP (admin)                             (ok true)
    fund 5000 sats sBTC
    GAS-PAID top-up via passkey + gas-station  (ok true)   sBTC 5000 -> 4980
    update with amount u0 AND cycles u0        (err u4026)
    ADVANCE 1360 burn blocks  (cycle 140 -> 141)
    TOP-UP post-advance                        (ok true)
19  EXTEND +1 cycle via passkey                (ok true)   num-cycles 96 -> 97
21  our shares cycle 141   u1250000000
22  pool total cycle 141   u32244932193354
    send 2,000,000 sats -> pox-5;  ADVANCE 1100
    pox-5.calculate-rewards []                 rewards-per-ustx u52721463013
    signer.pox-claim-rewards                   pot u5452
    signer.pay-stx-stakers([safe])             safe sBTC 4980 -> 5045
```

The gas station leg is the `(gas (optional <gas-trait>))` branch: a relayer
broadcasts, and the safe pays the sponsor 20 sats of its own sBTC, bounded by
`(with-ft sbtc-token max-gas-amount)` = `u1000`. Live values read from chain:
`gas-station.get-gas` -> `u20`, `get-sponsor` -> `SPV9K21T...`.

### Reward payout IS reproducible on a fork

pox-5 derives rewards from its own sBTC balance —
`(get-rewards) = sbtc-balance(pox-5) - total-sbtc-staked - reserve` — so no BTC
miner payout is needed. Sending sBTC to pox-5 and advancing past a distribution
cycle (HALF a reward cycle, 1050 blocks) is sufficient.

`calculate-rewards` and `pox-claim-rewards` are **permissionless** — both were
called from an unrelated relayer, not the admin. Only `set-admin`, `set-paused`
and fee changes are gated, so the operator cannot withhold distribution.

The empty `bond-periods` list is accepted only because no sBTC bonds are active.

### The lock lifecycle, per pox-5

`stx-account` is the NODE's view and stxer never populates it (see "NOT covered"
below). pox-5's own `get-staker-info` is the contract's record and tracks
correctly end to end:

```
after stake         1,000,000,000 uSTX   locked
after top-ups       1,450,000,000 uSTX   locked
after unstake       1,450,000,000 uSTX   STILL locked, num-cycles truncated
shares next cycle   u0                   removed from cycle 142 onward
after unlock cycle  none                 RELEASED
```

The exit is two-part: `unstake` leaves `amount-ustx` alone and only truncates
`num-cycles`, while next-cycle shares drop to `u0`. You stop earning at once but
stay locked until the unlock cycle, after which the position is gone. Nothing is
stranded and nobody earns after leaving.

### Withdrawals and the threshold guard

```
STX     50 STX   (under the 100 STX threshold)  -> moves immediately
STX    400 STX   (OVER threshold)               -> pending op, funds DO NOT move
sBTC  1,000 sats (under the 100k sat threshold) -> moves immediately
sBTC 150,000 sats (OVER threshold)              -> pending op, funds DO NOT move
```

Both asset types, both release paths, all verified:

```
plain execute BEFORE cooldown            (err u4017)   the delay is real
execute-pending-*-transfer-NOW (PASSKEY) (ok true)     relayer broadcasts,
                                                       admin key never touches it
...advance 150 blocks (past u144)...
execute-pending-*-transfer by OWNER      (ok true)     owner alone, after the wait
```

The two paths are deliberately asymmetric: the fast path needs the passkey (so
a stolen admin key cannot use it), and the slow path needs only the admin but
costs 144 blocks under veto watch.

**Both unstake paths work on both wallets.** `unstake` is reachable by the admin
key directly AND by a passkey signature relayed by a third party, and rejects
anyone else:

```
unstake by a random principal   (err u4001)
unstake by the ADMIN KEY        (ok true)   no signature
unstake by PASSKEY via relayer  (ok true)
```

**Juice pays BOTH wallets.** The reward chain was verified on v10 as well as v1
([`336cb4c3`](https://stxer.xyz/simulations/mainnet/336cb4c3f3ebf0ba67dda900cde59257)):
sBTC to pox-5 -> advance a distribution cycle -> `calculate-rewards` ->
`pox-claim-rewards` -> `pay-stx-stakers`, wallet sBTC `u4980 -> u5034`, and a
replay of the same tranche pays nothing. Both wallets are paid in the SAME fold
as **8 real mainnet Juice stakers**, so the list handles a mixed set of contract
and standard principals.

**`fakfun-wallet-v10` has NO fast path.** `execute-pending-*-now` appears twice
in `juice-safe-v1` and zero times in v10 -- the passkey 2FA release is a
jing-mm-safe lineage feature that v1 inherited and the fakfun-wallet line never
had. On v10 every over-threshold withdrawal serves the full u144 wait, both
assets, with no way to skip it. Verified in
[`bea10c7c`](https://stxer.xyz/simulations/mainnet/bea10c7ce1085a9419f4527453a17849).
The FE should not offer a "confirm now" action on v10 wallets.

The over-threshold case is the safe working as designed: it returns `(ok true)`
and queues a pending operation rather than transferring, so a compromised admin
key cannot drain in a single transaction.

### Paying the same tranche twice

```
pay tranche 0        (ok u65)   sBTC 4980 -> 5045
pay tranche 0 AGAIN  (ok u0)    sBTC 5045 -> 5045
```

The `stx-paid {reward-cycle, tranche, staker}` guard makes `pay-stx-stakers`
idempotent per tranche, so an operator script is safe to re-run.

### Owner-change escape hatches

Both verified on the deployed contract
([`99298476`](https://stxer.xyz/simulations/mainnet/992984767c70f941318765eac82e1897), on the deployed v1):

```
2FA TRANSFER
  propose-transfer by RANDOM      (err u4001)   not admin
  propose-transfer by ADMIN       (ok true)
  owner after propose             STILL OWNER   <- factor 1 alone moves nothing
  confirm-transfer, WRONG rp.id   (err u4002)   example.com rejected
  confirm-transfer, PASSKEY       (ok true)  -> owner = NEW_OWNER

INACTIVITY RECOVERY  (INACTIVITY-PERIOD u52560 burn blocks, ~1 year)
  recover by RECOVERY while ACTIVE  (err u4009)
  ...advance 52,660 blocks...       is-inactive -> true
  recover by RANDOM                 (err u4001)   wrong principal
  recover by RECOVERY               (ok true)  -> owner = RESCUED
  is-inactive after                 false         clock reset
```

Two consequences worth surfacing in the UI:

- **Every wallet call runs `update-activity`**, restarting the ~1-year clock.
  Recovery is a last resort for an abandoned wallet, not a fast path.
- **Transfer is an exit ramp, not a rotation.** The new owner inherits the
  wallet but has no registered passkey and can never add one, so every
  passkey-gated action becomes unavailable to them. Deliberate -- any
  post-onboard passkey-add path reachable by the admin key alone would let a
  compromised admin key satisfy both factors itself.

### `pox-settle-stakers` is NOT on the payment path

The operator flow is only:

```
sBTC -> pox-5  ->  calculate-rewards  ->  pox-claim-rewards  ->  pay-stx-stakers
```

`pay-one` computes `owed = pot(cycle,tranche) * shares / total-shares`, reading
only Juice's local `stx-pot` and pox-5's `staker-shares-staked-for-cycle`.
`settle` writes neither — it touches `staker-unclaimed-rewards-for-cycle` and
`staker-rewards-per-token-settled-for-cycle`, a reward watermark nothing in the
payout reads. Shares are written **only** by the stake/unstake paths
(`add-/remove-staker-from-signer-for-cycle` and the bond equivalents).

Verified both ways:

- **omitted** — [`767531ff`](https://stxer.xyz/simulations/mainnet/767531ff808902263766f6259534117c)
  pays out with no settle called anywhere
- **abused** — [`9fdaa1db`](https://stxer.xyz/simulations/mainnet/9fdaa1dbdd73445f41efec5d5ccc4d62)
  4 hostile `pox-settle-stakers` calls from an unrelated principal (between
  tranches, after a tranche is claimed but before it is paid, then 3 in a row):
  tranche 1 still pays in full, shares stay `u1250000000`, and replaying a paid
  tranche pays `u0`

`pox-settle-stakers` is permissionless, like `calculate-rewards` and
`pox-claim-rewards`. An attacker calling it burns their own gas and changes
nothing.

## NOT covered — read this before trusting a green run

### 1. `with-stacking` enforcement — RESOLVED

This section previously said the allowance could not be verified, because stxer
did not run the node's PoX lock handler: no `STXLockEvent`, `stx-account` stuck
at `locked u0`, and the allowance branch skipped so any value passed. That was
true of the simulator, not of the contract.

Fixed upstream (stxer/stxer-sdk#7). Locks now apply immediately on `stake`, and
the allowance is genuinely checked — a deliberately under-declared one aborts.
See the status block at the top.

### 1b. Live sBTC bonds are untested

Every reward run passes an empty `bond-periods` list to `calculate-rewards` and
`pox-claim-rewards`. That is accepted only because no sBTC bonds are currently
active — `assert-all-active-bonds-included` passes trivially. Once a bond
exists, both calls must enumerate the active bond periods, and the payout maths
gains a bond leg (`bond-rewards` / `bond-totals`, both `u0`/empty in these runs).
Re-run the reward harness at that point.

### 2. Prerequisite: neither wallet is registered as canonical

`get-verified-contract-hash` returns `none` for both. `onboard` ends in
`fakfun-wallet-core.register-wallet`, which requires it, so the first onboard
fails `(err u6001)` until someone calls, from `SPV9K21T…`:

```
fakfun-wallet-core.set-verified-contract(<wallet principal>, none)
```

Pass `none` for the hash — the core derives it via `(contract-hash? contract)`,
guaranteeing it matches the bytes actually on-chain.

### 3. `fakfun-wallet-v9` IS BROKEN ON MAINNET

Its `onboard` calls `register-wallet` with `.fakfun-wallet-v8` — a copy-paste
leftover, present in the deployed bytes. v8 *is* verified (hash `0xe0c7d14e…`),
so core's first assert passes and the second compares v9's own hash against v8's
and fails:

```
A2 onboard on DEPLOYED v9 -> (err u6002)   err-invalid-contract-hash
```

Proven in `simul-fakfun-wallet-v9.js`. **No v9 wallet can ever be initialised.**
Fixing it needs a `fakfun-wallet-v10` whose `register-wallet` names itself; the
harness's Part B deploys exactly that corrected copy and onboards cleanly, which
isolates the cause to that one line.

`juice-safe-v0` is unaffected — it registers against itself correctly.

---

## Deploy order

`juice-safe-auth-helpers-v1` first — both wallets reference it statically and
fail analysis without it. Then the wallet, then `set-verified-contract`, then
`onboard`. Deploy entries live in the faktory-dao BE at
`server/routes/api/bot/deploy-contract.post.ts`.
