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

## Coverage harnesses - RUN and GREEN (92.8%)

`tests/cl-v17`, `tests/cl-v17-cov`, `tests/cl-v17-lint` mirror the v16 trio, with
the comment-free deployed `fakfun-wallet-v17` source and deps swapped to
clarity-5-webauthn-v4 + fakfun-wallet-core-v2.

The clarinet-sdk 3.23.1 in the sandbox returns an error from `contract-hash?` on
a locally-instrumented contract, which used to break the coverage harness (it hit
`set-verified-contract(..., none)`'s `unwrap-panic`). Fixed with `verifyWallet()`
in `v17-helpers.ts`: run the instrumented wallet under the REAL simnet deployer
(where `contract-hash?` works) and register its hash EXPLICITLY for the principal
register-wallet hardcodes. Run:

```
V17_DEPLOYER=ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM \
  npx vitest run tests/fakfun-wallet-v17*.test.ts tests/v17-smoke.test.ts -- \
    --manifest tests/cl-v17-cov/Clarinet.toml --coverage
```

Result: **104 pass, 1 skipped** (the in-test-publish smoke test, N/A under
instrumentation), **fakfun-wallet-v17 line coverage 1056/1138 = 92.8%**.
