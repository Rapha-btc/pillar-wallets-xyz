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
  (39 tests): get-keeper, set-keeper by admin and by passkey (helper hash,
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

## Bounty mv7dfb: Giant Moth F2, keeper reset on owner change (611873c)

Finding. `confirm-transfer-wallet` and `recover-inactive-wallet` changed the
owner but kept the keeper. The old keeper could then restake the new owner's
STX for 96 cycles.

Fix. Both functions now set the keeper to the new owner, next to
`(var-set owner ...)`:

```
(var-set keeper pending)    ;; confirm-transfer-wallet
(var-set keeper new-admin)  ;; recover-inactive-wallet
```

A new owner starts with auto-restake off. To turn it on, the new owner calls
`set-keeper`. The same lines are in the coverage copy.

Tests. `tests/juice-autostake-safe-keeper.test.ts`, new block "owner change
resets the keeper" (8 tests, 39 total, all pass on both manifests):

- transfer: the keeper is the new owner;
- transfer: the old keeper, chavita and the old owner get u4001 on restake;
- transfer: the default keeper (chavita) is reset too;
- transfer: the old owner cannot set-keeper (u4001); the new owner sets
  chavita and the restake works;
- transfer: the new owner, as keeper, can restake;
- recovery before the inactivity period is u4009, keeper unchanged;
- recovery after 52560 burn blocks: the keeper is the new owner, the old
  keeper and chavita get u4001;
- recovery: the new owner sets a keeper, restake works and rolls the lock to
  `current + 1 + 96`.

Lcov hits both new lines.

Stxer. `simul-juice-autostake-safe.js` adds scenarios L and M on a second
user copy (`bob-autostake-safe`, same bytes, own passkey). It onboards
against the canonical hash on the fork. L: the owner stakes and sets a
keeper, then a relayer submits the passkey confirm-transfer. The keeper is
the new owner. The old keeper, chavita and the old owner get u4001. The new
owner sets chavita and the restake takes all free STX. M: the new owner sets
a keeper, recovery before the period is u4009. The sim then advances 52,610
burn blocks (13 steps), and recovery goes through. The keeper is the
recovered owner, and the old keeper and chavita get u4001. Once the
recovered owner sets chavita again, the restake adds the payout and extends
25 cycles back to `current + 1 + 96`.

Result: 82/82 (was 55/55),
https://stxer.xyz/simulations/mainnet/837734f0b07aed2a07e62656af381ad0

Stxer notes. The long advance makes one submit post too slow (504, socket
closed). The sim now posts in chunks of 12 steps through `_chunked-submit.mjs`
(copied from jing-contracts-v3). The STX whale holds about 2737 STX and A-K
spend 2185, so bob gets 400 STX and stakes 200.

## Bounty mv7dfb: Frosty Narwhal, none holds

Checked at `611873c`+ (`contracts/juice-autostake-safe.clar`); the same at
the pinned `c910c1b`. No change.

- **M-1 `execute-*-now` hash has only auth-id and op-id: by design.** The
  `-now` paths refuse an op the passkey created (L697, L841, L999), so the
  admin key set the amount, recipient and type when it queued the op. The
  op-id is a nonce that never repeats (L476, L490), and the stored op cannot
  change, so the op-id commits to all of it. The passkey only lifts the
  cooldown of that one op; each `-now` also checks `op-type` in storage.
  Same as the deployed juice-safe-v7.
- **M-2 the admin key resets the inactivity clock: by design.** Inactivity
  recovery (L1308) is for an owner who does nothing for a year. Any owner
  call is activity (`update-activity`, L1247). The safe cannot tell an owner
  from a holder of the owner key. Keeper `restake` does not reset the clock.
- **M-3 `execute-pending-*` skips the token lock: does not hold.** The lock
  shuts the passkey out: every sig-auth branch checks it (for example L608)
  and only the admin key can turn it off (L344). `execute-pending-*` is
  admin-only (`is-authorized none`, L665). A passkey alone cannot run a
  queued op, and the owner can veto it during the cooldown.
- **L-1 zero thresholds queue every transfer: by design.** Only the owner
  can set them (`signal-config-change` L355, then `set-wallet-config` after
  the cooldown). Threshold 0 is the strictest mode: every send waits for
  the cooldown or a passkey `-now`.
- **L-2 other SIP-010 tokens and NFTs skip the threshold queue: by design.**
  The queue covers STX and sBTC, the assets this safe holds (L773). Other
  assets move on one admin or passkey signature, as in juice-safe-v7.
