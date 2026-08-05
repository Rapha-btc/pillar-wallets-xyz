# Test status: juice-safe-v6, fakfun-wallet-v16, juice-pool-stx-signer

One page, re-verified end to end. Details live in `README-clarinet-rv.md` (v6) and
`README-v16-signer-test-plan.md` (v16 + signer).

## Green, all three

| contract | vitest | reachable-line coverage | raw lcov | RV |
|---|---|---|---|---|
| `juice-safe-v6` | **108** | **100%** | 94.0% (1074/1077 incl. artifacts) | 1500 runs, 12 invariants, 0 fail, 0 skipped fns |
| `fakfun-wallet-v16` | **106** | **99.7%** | 92.8% | 800 runs, 13 invariants, 0 fail |
| `juice-pool-stx-signer` | **32** | **100%** | 99.5% | 1500 runs, 10 invariants, 0 fail, 0 skipped fns |

**246 vitest tests. Zero failures. Zero functions never called on any of the three.**
Every suite runs the real deployed bytes at the real mainnet address against real
mainnet dependencies -- pox-5, sBTC, fakfun-wallet-core, the auth helpers -- with no
mocks on the contract under test.

**No contract defects found in any of the three.**

## "Full coverage" -- the honest version

v6 and the signer are at **100% of reachable lines**. v16 is at **99.7%**, and the
shortfall is real rather than cosmetic, so it is stated rather than rounded away:

| what | status |
|---|---|
| `faktory-burn-bob`'s actual BOB burn | **NOT covered.** The wallet's dispatch, auth, passkey branch and gas handling on that path are; the burn is not. `built-on-bitcoin-stxcity` does not publish in simnet, so `burn-bob-faktory` runs against a stub. See the burn-bob section of the v16 plan doc. |
| 2 `MAX-CONFIG-COOLDOWN` clamp arms (v16), same 2 in v6 | Unreachable by design -- cooldown is bounded at every entry point. Correct to keep. |
| 2 `(match gas ... true)` arms in v16 | The station-present counterpart is covered on both. |
| `u103 ERR_SETTLE_FAILED` (signer) | Unreachable in simnet, proven with four probes. |
| `u109 ERR_NO_NEW_REWARDS` (signer) | Shadowed -- pox-5 answers `u32` first. |
| RV skips 7 v16 faktory fns | They take traits RV has no eligible impl for. Covered by vitest instead. |

Also structural, and unchanged: **clarinet cannot see SIP-044 allowance violations**
(stx-labs/clarinet#2491, proven with an A/B). Any change touching `as-contract?` on a
staking path must be verified on stxer, where the lock actually applies.

## Reproducing

```
# correctness -- real deployed bytes at the real mainnet addresses
npx vitest run tests/juice-safe-v6*.test.ts     -- --manifest tests/cl-v6/Clarinet.toml
npx vitest run tests/fakfun-wallet-v16*.test.ts -- --manifest tests/cl-v16/Clarinet.toml
npx vitest run tests/signer-*.test.ts           -- --manifest tests/cl-signer/Clarinet.toml

# coverage -- separate harnesses, because --coverage instruments PROJECT contracts only
V6_DEPLOYER=ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM     npx vitest run tests/juice-safe-v6*.test.ts     -- --manifest tests/cl-v6-cov/Clarinet.toml --coverage
V16_DEPLOYER=ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM    npx vitest run tests/fakfun-wallet-v16*.test.ts -- --manifest tests/cl-v16-cov/Clarinet.toml --coverage
SIGNER_DEPLOYER=ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM npx vitest run tests/signer-*.test.ts           -- --manifest tests/cl-signer-cov/Clarinet.toml --coverage

# RV -- build.sh FIRST, the target is a contract+invariants artifact nothing regenerates
./tests/rv-v6/build.sh     && npx rv tests/rv-v6     juice-safe-v6         invariant --runs 1500
./tests/rv-v16/build.sh    && npx rv tests/rv-v16    fakfun-wallet-v16     invariant --runs 800
./tests/rv-signer/build.sh && npx rv tests/rv-signer juice-pool-stx-signer invariant --runs 1500
```

## Two habits this work earned

1. **Never trust a proxy metric.** "All public functions covered" was wrong twice: it
   counts a function name appearing in a comment or an unrelated test. Measuring lines
   found `confirm-max-gas-amount` had never been called at all, and that
   `stx-transfer-memo?` -- a different native from `stx-transfer?` -- had never run on
   three sites in either wallet. Both arms return `(ok true)`, so no error-code audit
   could ever have seen it.
2. **Check `.cache/requirements/` for stubs.** A hand-written file there is
   indistinguishable from a fetched one. `burn-bob-faktory` was a 60-byte fake standing
   in for 5,041 real bytes. One command catches the class:

```
for f in .cache/requirements/*.clar; do
  s=$(wc -c < "$f"); [ "$s" -lt 400 ] && printf "%6s  %s\n" "$s" "$(basename $f)"
done
```

## Filed upstream

- **stx-labs/clarinet#2490** -- coverage reports `DA:0` on continuation lines of
  multi-line expressions, so raw lcov cannot reach 100% and a real hole looks identical
  to a formatting artifact.
- **stx-labs/clarinet#2491** -- simnet does not apply PoX locks, so `stx-account` reads
  `locked u0` and `(with-staking N)` allowances are not enforced at all.

A third is worth filing: clarinet ignores inter-requirement dependency order. It
publishes `fakfun-wallet-v16` before `juice-pool-stx-signer`, which v16 depends on, and
hand-reordering the plan does not survive a rerun. Worked around by publishing v16 from
the suites via `deployV16()`.
