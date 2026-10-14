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
- Clarinet SDK (vitest), this repo: `tests/juice-autostake-safe-keeper.test.ts`
  (27 tests): get-keeper, set-keeper by admin and by passkey (helper hash,
  keeper and auth-id binding, replay, gas station), and every restake guard,
  the all-unlocked amount, the roll to `current + 1 + 96`, roll-only, the
  prepare phase and the untouched recovery clock, on the real simnet pox-5.
  The pool stand-in is the live `juice-pool-stx-signer` source. Simnet applies
  no STX locks, so the `with-staking (+ locked amount)` allowance is only
  proven on stxer.

  ```
  npx vitest run tests/juice-autostake-safe-keeper.test.ts -- --manifest tests/cl-v7/Clarinet.toml
  AUTOSTAKE_DEPLOYER=ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM \
    npx vitest run tests/juice-autostake-safe-keeper.test.ts -- \
    --manifest tests/cl-autostake-cov/Clarinet.toml --coverage
  ```

  Coverage: set-keeper 4/4 branches, restake 28/28 lines and 10/10 branches.
  The 2 set-keeper lines lcov marks unhit are the contract name and function
  name atoms of the helper call, not expressions.

## Bounty mv7dfb: Giant Moth set-keeper token lock

Finding. The passkey branch of `set-keeper` did not check the token lock.
Every other passkey path does. With the lock on, a locked-out passkey could
still set a keeper. That keeper could then restake all unlocked STX for 96
cycles.

Fix. One line in the sig-auth branch of `set-keeper`, first in the branch, as
in the siblings:

```
(asserts! (not (var-get token-lock-enabled)) err-token-locked)
```

The admin branch (sig-auth none) is unchanged. The same line is in the
coverage copy `tests/cl-autostake-cov/contracts/juice-autostake-safe.clar`, so
it still differs from the repo source only by the three repointed literals.

Tests. `tests/juice-autostake-safe-keeper.test.ts`, new block "set-keeper:
token lock" (4 tests, 31 total, all pass on both manifests):

- lock on: passkey set-keeper is u4023, keeper and events unchanged;
- lock on: the refused passkey cannot hand restake to a new keeper;
- lock on: the admin path still sets the keeper;
- lock off again: the same passkey signature works (auth-id not spent).

Without the fix, the three passkey tests fail.

Hash impact. The source bytes change, so the canonical hash of
`juice-autostake-safe` changes. The safe is not deployed yet. Anything that
pins the hash (BE templates, a registered verified-contract entry) must be
regenerated from this source before deploy. `simul-juice-autostake-safe.js`
reads the repo file and registers the deployed safe on the fork, so the K
user-copy check still compares like with like. Stxer was not re-run.
