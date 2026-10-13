# juice-autostake-safe: review of the keeper restake (2d136c1)

Reviewed and accepted 2026-10-13. The commit adds a keeper to the deployed
`juice-safe-v7` copy and points it at the launch pool.

## What changed

- `JUICE-SIGNER` is `juice-pool-sbtc-signer` (the launch pool), and `onboard`
  registers the wallet as `juice-autostake-safe`.
- `err-not-staking (u4040)`: `restake` on a safe with no position, or one that
  is unstaking.
- `keeper` (default `SPV9K21T...`), `get-keeper`, `set-keeper`: the owner (admin
  or passkey) picks the keeper. The passkey path signs a SIP-018 hash from the
  new `juice-autostake-safe-auth-helpers-v1` (deploy it before the safe).
- `restake` (keeper only): stakes all unlocked STX in the safe and rolls the
  lock back to 96 cycles from the next cycle.

## restake, as reviewed

- `amount` is the STX that arrived since the last restake (the unlocked
  balance), not the total staked. `amount = 0` with `cycles-to-extend > 0` is a
  roll-only restake; both 0 is refused (`u4026`).
- `with-staking (+ (locked-ustx) amount)`: pox-5 checks the allowance against
  the whole lock, so it covers what is already locked plus the new STX, while
  `stake-update` takes only the increase.
- Cycle math: pox-5 sets `num-cycles = unlock - current - 1`, so the target
  `current + 1 + 96` is always exactly the 96-cycle ceiling.
- `(asserts! (> unlock-cycle (+ current-cycle u1)) err-not-staking)`: after an
  unstake pox-5 leaves the lock ending next cycle, so the keeper cannot re-lock
  a safe that is leaving.
- No `update-activity`: keeper calls never hold off the one-year inactivity
  recovery.
- Through the launch pool, every restake passes the new total to
  `validate-stake!`, so it also grows the safe's OG seat while the cap has room.

## Accepted by design

- `restake` stakes all unlocked STX, not only rewards: STX sent into the safe
  for spending can be locked by the keeper before the owner moves it. The
  keeper is owner-chosen and replaceable (set it to the owner to turn
  auto-restake off).
- pox-5 refuses stake updates in the prepare phase, so the keeper runs outside it.
- Safe stakes pass no `signer-calldata`, so they carry no `?ref=`.

## Tests

- Stxer mainnet fork, this repo: `node simul-juice-autostake-safe.js`
  (scenarios A-K: restake guards, roll-only, prepare phase, set-keeper by admin
  and by passkey through a relayer and the gas station, unstake, user copy
  against the canonical hash). It runs against the live `juice-pool-stx-signer`
  because the launch pool is not on mainnet yet.
- Stxer mainnet fork, juicestx: `simulations/pool-autostake-e2e-stxer.mjs`
  (62/62): the launch pool pays STX into the safe, the keeper restakes it, the
  roll, set-keeper, unstake refusal and the recovery clock, on the exact
  pool source.
