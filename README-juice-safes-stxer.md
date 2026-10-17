# Juice safes: stxer mainnet-fork sims (juice-safe-v9 + juice-autostake-safe)

Verified 2026-10-17. The two live Juice safe templates, deployed fresh in a
stxer mainnet fork from the **live template bytes** (hash checked against
`fakfun-wallet-core-v2 get-verified-contract-hash` before every run). Nothing
was broadcast.

- **Earn BTC** = `juice-safe-v9`, stakes with `juice-pool-stx-signer`, rewards in sBTC.
- **Grow STX** = `juice-autostake-safe`, stakes with `juice-pool-sbtc-signer`;
  rewards are swapped to STX by `juice-sbtc-autoswap`, and the keeper calls `restake()`.

Harnesses, step tables and re-run commands live in
[Rapha-btc/juicestx `simulations/README-juice-safes.md`](https://github.com/Rapha-btc/juicestx/blob/main/simulations/README-juice-safes.md)
(commit `e03de67`).

## Runs

| Sim | Covers | Result | stxer |
|---|---|---|---|
| Happy path | deploy, onboard, stake 1,000 STX, unstake, unlock, withdraw | all PASS | https://stxer.xyz/simulations/mainnet/ab4d78476d6bc5393452839c2aaee5e0 |
| Rewards | real pox-5 reward round into both safes; Grow swap + keeper restake | 60/60 | https://stxer.xyz/simulations/mainnet/f0cadb2e81b25c0672546e2aeaf3c613 |
| Limits + passkey + gas | over-limit queue, cooldown, veto, execute-now, real P-256 passkey, replay, domain binding, gas | 115/115 | https://stxer.xyz/simulations/mainnet/eb4b98e60dc722d3e33c895c992ca240 |

Fork-only setup in the rewards sim: reward money comes from an sBTC whale
sending 10 BTC to pox-5, and two fork accounts stake 30k STX each so
`juice-pool-sbtc-signer` clears the 50k STX signer minimum (0 STX on mainnet
today). Claims, the Jing swap (live Lazer update), payouts and restake are real.

## Rules the sims confirmed

- Locked STX cannot leave: `stx-transfer` while staked fails with the native `(err u1)`.
- Over the limit with one key (admin or passkey): queued as a pending op.
  Executing before the 144-block cooldown fails `u4017`; after it, the admin executes.
- Either key can veto: a vetoed op fails `u4015`; executing twice fails `u4014`.
- Both keys = immediate: an admin-created op plus a passkey `execute-*-now` runs
  at once. A passkey-created op cannot be fast-tracked by the same passkey (`u4003`).
- Signatures: replaying an auth-id fails `u4006`; a signature for the Earn safe
  sent to the Grow safe fails `u4002` (each hash binds the safe principal).
- Rewards: the Earn safe received exactly its owed sBTC; the Grow safe was paid
  its owed STX and `restake()` locked exactly that amount.

## Findings (no contract bugs)

1. **Gas takes sBTC first (frontend).** With a gas trait, `pay-gas-accounted`
   pays the gas station 20 sats of sBTC from the safe before the transfer, so
   sending the full sBTC balance fails in `sbtc-token` with `(err u1)`. Seen on
   mainnet in `consistency-safe` op u1. Fix: the "max" amount subtracts the gas
   fee. The admin path ignores the gas param.
2. **Reward keeper fallback (faktory-dao backend).** pox-5 has two active
   protocol bonds (indices 1 and 2). `calculate-rewards` with an empty bond list
   fails `err u33`, and the fallback in `pox5-keeper.ts` still sends an empty
   list. Claims are not affected.
