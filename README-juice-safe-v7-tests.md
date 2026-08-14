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

- `simul-juice-safe-v7-lifecycle.js` - **62 / 62**. Full wallet lifecycle:
  onboard, STX/sBTC transfers, under/over-threshold routing, the passkey 2FA
  fast-path, the cooldown path, staking locks, top-ups, unstake across the
  cycle boundary, gas-station accounting, and the pox-5 reward payout to the
  safe + the real Juice stakers. The reward assertions are pinned to the
  currently-active reward cycle (142 at the current fork height) and the advance
  crosses into it; bump REWARD_CYCLE / ADVANCE_BLOCKS forward when the fork rolls
  to a later cycle (the v6 lifecycle has the same time-pinning).

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

## 4. Line-coverage harness (mirrors cl-v6 / cl-v6-cov)

`clarinet --coverage` only instruments PROJECT contracts, not requirements, so
coverage over the wallet needs it deployed as a LOCAL contract. `tests/cl-v7`
and `tests/cl-v7-cov` are minimal manifests that do exactly that: the
comment-free DEPLOYED `juice-safe-v7` source as a local contract, the real
mainnet deps as requirements (clarity-5-webauthn-v4, fakfun-wallet-core-v2,
helpers, pox-5, sbtc-token), plus the `zz-*` mock stations/tokens the suites
drive. The v7 test files honor `V7_DEPLOYER` so they target the locally-deployed
wallet.

Run coverage locally (any suite, or all):

```
V7_DEPLOYER=<local deployer addr> \
  npx vitest run tests/juice-safe-v7-*.test.ts -- \
    --manifest tests/cl-v7-cov/Clarinet.toml --coverage --costs
```

The local `contracts/juice-safe-v7.clar` in these harnesses is the byte-for-byte
comment-free source deployed on mainnet, so the coverage percentages are over
the deployed bytes (same approach as cl-v6-cov).

## Manifest wiring

`Clarinet.toml` gains `clarity-5-webauthn-v4` and `fakfun-wallet-core-v2` as
requirements (both deployed). `juice-safe-v7` is already a project contract
(Clarity 6, epoch 4.0).
