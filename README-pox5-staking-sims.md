# pox-5 staking — contracts, simulations, and what is *not* covered

Covers `juice-safe-v0`, `fakfun-wallet-v9`, and their shared
`juice-safe-auth-helpers-v1`. All three are deployed on mainnet under
`SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22`.

pox-4's last reward cycle was 140 and the chain has forked to pox-5, so the
`stack-stx-juice` path in fakfun-wallet v6–v8 calls pox-4 `delegate-stx` and can
only fail. These contracts stake on pox-5.

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

Every reference below runs against the **deployed** contracts on a mainnet
fork. Nothing is redeployed; each call hits the on-chain bytes.

| harness | link | result |
|---|---|---|
| `simul-juice-safe-v0-lifecycle.js` | [`12bc1378`](https://stxer.xyz/simulations/mainnet/12bc137820d8110284b7b38d33c05f4c) | **27/27** — full lifecycle, gas station, reward payout |
| `simul-tranche-attack.js` | [`9fdaa1db`](https://stxer.xyz/simulations/mainnet/9fdaa1dbdd73445f41efec5d5ccc4d62) | **39/39** — multi-tranche + hostile settle |
| `simulations/verify-juice-safe-v0-staking.js` | [`efbb19bb`](https://stxer.xyz/simulations/mainnet/efbb19bb97dd8f068285d3a360fc4269) | **32/32** — independent second harness |
| `simul-fakfun-wallet-v9.js` (Part A) | [`6ae99c6e`](https://stxer.xyz/simulations/mainnet/6ae99c6ed0bc6934fed4cf4584bdebed) | deployed v9 `onboard` -> **`(err u6002)`** |

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

- **omitted** — [`12bc1378`](https://stxer.xyz/simulations/mainnet/12bc137820d8110284b7b38d33c05f4c)
  pays the identical 65 sats with no settle anywhere
- **abused** — [`9fdaa1db`](https://stxer.xyz/simulations/mainnet/9fdaa1dbdd73445f41efec5d5ccc4d62)
  4 hostile `pox-settle-stakers` calls from an unrelated principal (between
  tranches, after a tranche is claimed but before it is paid, then 3 in a row):
  tranche 1 still pays in full, shares stay `u1250000000`, and replaying a paid
  tranche pays `u0`

`pox-settle-stakers` is permissionless, like `calculate-rewards` and
`pox-claim-rewards`. An attacker calling it burns their own gas and changes
nothing.

## NOT covered — read this before trusting a green run

### 1. `with-stacking` enforcement is unverifiable on stxer

stxer replays pox-5 *contract* state but does not run the node's PoX lock
handler. Visible directly in the deployed-contract run
([`4723fe69`](https://stxer.xyz/simulations/mainnet/4723fe690d0c022ce27f25e276a9de07)):

- **`stx-account` reports `locked u0` at every step** — before the stake, after
  the stake, after a top-up, after advancing 1360 burn blocks into the first
  reward cycle, and after a further top-up. The lock never applies.
- no `STXLockEvent` in any trace — the event list is all `CONTRACT_LOG`
- pox-5's own event nevertheless declares `unlock-burn-height u1163750`: the
  contract fully intends the lock, the account simply never receives it

The allowance is only consulted when a stacking entry exists in the asset map:

```rust
if let Some(stx_stacked) = assets.get_stacking(owner) {   // None -> skipped
    if stx_stacked > *allowance { record_violation(...) }
}
```

No lock means no entry, means the branch is never taken, means **any**
`(with-stacking N)` passes regardless of `N`. A green top-up is therefore a real
pass of the *function* and a non-result for the *allowance line*.

Corroborated by a control (`simul-allowance-probe.js`, and independently
`simulations/verify-juice-safe-v0-pc-negative.js`): the same contract compiled
two ways — correct allowance vs deliberately under-declared — both pass the
identical `stake-update`.

The evidence for the `(locked-ustx)` term stays the two failed mainnet
transactions it came from, plus stacks-core's handler logging `amount_locked()`.

**To close it:** stake a small amount from `juice-safe-v0` on mainnet, then top
up. With `(+ (locked-ustx) amount-increase)` it succeeds; with `amount-increase`
alone it aborts.

Reported upstream: https://github.com/stxer/stxer-sdk/issues/7

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
