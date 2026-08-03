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

| harness | link | result |
|---|---|---|
| `simul-juice-safe-v0-lifecycle.js` | [`80d666f6`](https://stxer.xyz/simulations/mainnet/80d666f6ff5162bf722852f70f6ebb4b) | **25/25** — full lifecycle + real reward payout |
| `simul-fakfun-wallet-v9.js` | [`6ae99c6e`](https://stxer.xyz/simulations/mainnet/6ae99c6ed0bc6934fed4cf4584bdebed) | **25/25** — v8→v9 delta + gas station |
| `simul-juice-safe-v0.js` | [`d5906be5`](https://stxer.xyz/simulations/mainnet/d5906be5c28aadd893352a840376a17a) | 13/13 — pre-advance baseline |
| `simul-allowance-probe.js` | [`c64d66a2`](https://stxer.xyz/simulations/mainnet/c64d66a2ae5d1d9a7287fba9e8961be7) | **negative result, by design** |
| `simulations/verify-juice-safe-v0-staking.js` | [`efbb19bb`](https://stxer.xyz/simulations/mainnet/efbb19bb97dd8f068285d3a360fc4269) | 32/32 — independent second harness |
| `simulations/verify-juice-safe-v0-pc-negative.js` | [`6b575389`](https://stxer.xyz/simulations/mainnet/6b575389e542484281d6dd1962a7e05c) | negative, agrees with the probe |

All run against the **deployed** contracts, not fresh copies.

### Reward payout IS reproducible on a fork

pox-5 derives rewards from its own sBTC balance —
`(get-rewards) = sbtc-balance(pox-5) - total-sbtc-staked - reserve` — so no BTC
miner payout is needed. Sending sBTC to pox-5 and advancing is sufficient:

```
send 2,000,000 sats -> pox-5      get-new-rewards  u2000000
advance 1100 blocks               (a distribution cycle = HALF a reward cycle)
pox-5.calculate-rewards []        rewards-per-ustx u52721463013
signer.pox-claim-rewards          total-rewards    u5502  -> Juice pot
signer.pox-settle-stakers([safe]) entitlement      u63
signer.pay-stx-stakers([safe])    safe sBTC u0 -> u63
```

`calculate-rewards` and `pox-claim-rewards` are **permissionless** — both were
called from an unrelated relayer, not the admin. Only `set-admin`, `set-paused`
and fee changes are gated. The operator cannot withhold distribution.

The empty `bond-periods` list is accepted only because no sBTC bonds are active.

---

## NOT covered — read this before trusting a green run

### 1. `with-stacking` enforcement is unverifiable on stxer

stxer replays pox-5 *contract* state but does not run the node's PoX lock
handler. Consequences, all directly observed:

- no `STXLockEvent` in any trace — only `CONTRACT_LOG` entries
- `stx-account` reports `locked u0` **even after advancing a full reward cycle**
- no asset-map stacking entry, so `get_stacking(owner)` is `None` and the
  allowance branch is skipped entirely

Therefore **any** `(with-stacking N)` passes regardless of `N`. Two independent
controls confirm it — `simul-allowance-probe.js` and
`verify-juice-safe-v0-pc-negative.js` each deployed the known-bad
`amount-increase` version alongside the correct one and **both passed**.

A green top-up is *not* evidence the `(locked-ustx)` term is right. The evidence
for that line is the two failed mainnet transactions it came from, plus
stacks-core's handler logging `amount_locked()`.

**To actually close it:** stake a small amount from `juice-safe-v0` on mainnet,
then top up. If the allowance were still `amount-increase`, the top-up aborts.

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
