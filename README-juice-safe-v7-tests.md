# juice-safe-v7 test surface (mirrors juice-safe-v6)

The v7 stack is deployed on mainnet and the v6 test surface has been reproduced
for it: clarinet vitest suites, stxer integration sims, and RV (rendezvous)
invariant fuzzing. Where it runs, it runs against the DEPLOYED bytes.

## Deployed (mainnet, Clarity 6, account 0 = SPV9K21)

| contract | txid |
|----------|------|
| clarity-5-webauthn-v4 | 4eb9f6670fc96a5f79c5bd4aa2db0839ce2d62e646821a39fb09be0be8fad9e4 |
| fakfun-wallet-core-v2 | e1d5548857790c3f9bcaecbacbb9811c948746fb25fde2458538830d6bad71b1 |
| juice-safe-v7 | 5e0f213ac81d147bd24cf59f95c2979380b6154bd228d81d18a517b6d627de98 |
| fakfun-wallet-v17 | 7effa3694f62a85b59ab80f20228b598b85a028972214eefe1fb10edf8c00e98 |

## 1. stxer integration sims (run against the DEPLOYED contracts)

Each onboards and exercises the live `SPV9K21….juice-safe-v7` on the stxer
mainnet fork. Run with `node <file>.js`.

- `simul-juice-safe-v7-lifecycle.js` - **59 / 62**. Full wallet lifecycle:
  onboard, STX/sBTC transfers, under/over-threshold routing, the passkey 2FA
  fast-path, the cooldown path, staking locks, top-ups, unstake across the
  cycle boundary, gas-station accounting. The 3 failures are the cycle-141
  reward-payout assertions - the fork is now well past cycle 141, so the safe
  holds no cycle-141 shares. **The v6 lifecycle fails the identical 3 on the
  same fork (59/62), so this is time drift, not a v7 regression - full parity.**

- `simul-juice-safe-v7-recovery.js` - **16 / 16**. Inactivity + recovery-address
  path (propose/confirm recovery, recover-inactive-wallet).

- `simul-juice-safe-v7-webauthn-deployed.js` - **11 / 11**. The H-01 security
  check on the deployed bytes: the 3-way challenge multiplex fails `(err u4002)`
  on every split, read-only `verify-signature` rejects each split and accepts an
  honest single-hash assertion, and one honest single-op transfer passes.
  stxer: https://stxer.xyz/simulations/mainnet/54c7a3f6d7b0ea522534f05b91e1e3cb

  (`simul-juice-safe-v7-webauthn-fix-regression.js` is the same check but
  DEPLOYS the four contracts in-sim from `contracts/deploying/*` - use it to
  re-validate a source change before redeploying. 15/15,
  https://stxer.xyz/simulations/mainnet/381bc6a8d4e46dd1d74dc6b8800ab9e7 )

## 2. RV (rendezvous) invariant fuzz

`tests/rv-v7/` - 13 invariants over `juice-safe-v7` against real mainnet
dependencies (clarity-5-webauthn-v4, fakfun-wallet-core-v2, helpers, pox-5).

```
bash tests/rv-v7/build.sh                       # rebuild the target artifact
npx rv tests/rv-v7 juice-safe-v7 invariant --runs 100
```

Result: **OK, invariants passed after 100 runs.** Random senders bounce on
u6001/u4001/u4002 (auth), and no reachable sequence breaks any invariant
(cooldown bounds, spent-within-thresholds, owner/recovery never the contract,
staked-not-above-funded, gas fuse, num-cycles bound, etc.).

Note: the installed rendezvous requires `update-context` to be a PUBLIC function
(older versions accepted private). The v7 invariants define it public; the v6
invariants still define it private and error on this rv version until changed.

## 3. clarinet vitest suites

Eight suites, ported one-to-one from the v6 files (the only deltas are the
`-v7` name, `fakfun-wallet-core` -> `-v2`, and the `log-stake-stx` rename; the
honest webauthn signer already emits anchoring-compliant assertions, so the
happy paths are unchanged):

```
tests/juice-safe-v7.test.ts            tests/juice-safe-v7-auth.test.ts
tests/juice-safe-v7-allowance.test.ts  tests/juice-safe-v7-assets.test.ts
tests/juice-safe-v7-gaps.test.ts       tests/juice-safe-v7-limits.test.ts
tests/juice-safe-v7-staking.test.ts    tests/juice-safe-v7-surface.test.ts
```

Run locally with `npm test` (or `npx vitest run tests/juice-safe-v7-*.test.ts`).

Environment note: these were NOT executed in the CI sandbox used to prepare
this change - vitest's `forks` pool (required by clarinet-sdk) cannot spawn a
worker there, and the same failure hits the known-good v6 suites, so it is an
environment limitation, not a test defect. They are mechanical mirrors of the
green v6 suites and should be run on a normal dev machine.

## Manifest wiring

`Clarinet.toml` gains `clarity-5-webauthn-v4` and `fakfun-wallet-core-v2` as
requirements (both deployed). `juice-safe-v7` is already a project contract
(Clarity 6, epoch 4.0).
