# fakfun-wallet-v17 test surface (mirrors fakfun-wallet-v16)

The v16 test surface reproduced for the deployed `fakfun-wallet-v17`. Same three
changes vs v16 as juice-safe-v7 vs v6: verify path -> clarity-5-webauthn-v4,
core -> fakfun-wallet-core-v2, `used-assertions` replay key, `log-stake-stx`
rename. Plus one contract delta of its own (see below).

Deployed (mainnet, Clarity 6, account 0 = SPV9K21):
`fakfun-wallet-v17` tx `7effa3694f62a85b59ab80f20228b598b85a028972214eefe1fb10edf8c00e98`.

## clarinet vitest suites - RUN and GREEN

Six suites, ported one-to-one from the v16 files. Run against the minimal
manifest (v17 published in-test at the real SPV9K21 address = the deployed
bytes):

```
npx vitest run tests/fakfun-wallet-v17.test.ts tests/fakfun-wallet-v17-faktory.test.ts \
  tests/fakfun-wallet-v17-gaps.test.ts tests/fakfun-wallet-v17-new.test.ts \
  tests/fakfun-wallet-v17-parity.test.ts tests/v17-smoke.test.ts -- \
  --manifest tests/cl-v17/Clarinet.toml
```

Result: **6 suites, 83 / 83 pass.** (17 in the base suite; the rest across
faktory / gaps / new / parity / smoke.)

Contract delta found by the port: **v17 REMOVED `faktory-burn-bob`** (v16 had
it; every other faktory-* op is identical). The two v16 tests that exercised it
were dropped from `tests/fakfun-wallet-v17-faktory.test.ts` - the function no
longer exists, so they are obsolete, not failing.

vitest version: pin `~4.0.7`. vitest 4.1.x will not boot the clarinet-sdk worker
(see README-juice-safe-v7-tests.md). This repo now pins it.

## RV (rendezvous) invariant fuzz - RUN and GREEN

`tests/rv-v17/` - 14 invariants over `fakfun-wallet-v17` against real mainnet
deps (clarity-5-webauthn-v4, fakfun-wallet-core-v2, ...).

```
bash tests/rv-v17/build.sh
npx rv tests/rv-v17 fakfun-wallet-v17 invariant --runs 100
```

Result: **OK, invariants passed after 100 runs.** (`update-context` made public
for the installed rendezvous, as in rv-v7.)

## Coverage harnesses

`tests/cl-v17`, `tests/cl-v17-cov`, `tests/cl-v17-lint` mirror the v16 trio, with
the comment-free deployed `fakfun-wallet-v17` source and deps swapped to
clarity-5-webauthn-v4 + fakfun-wallet-core-v2. `tests/fakfun-wallet-v17-cov.test.ts`
runs the suite with local instrumentation for `--coverage`.

Same clarinet-sdk caveat as v7: the coverage harness needs `contract-hash?` to
read a locally-emulated contract's hash; some clarinet-sdk versions return
`none` there and both v16 and v17 coverage error identically on it. Run coverage
on the machine/clarinet-sdk where the v16 coverage worked.
