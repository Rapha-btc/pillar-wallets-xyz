# November 26–27 validation and coverage

All listed tests passed with Clarinet CLI/SDK 3.23.2 and Vitest 3.2.4. Sources and SHA-256 hashes are recorded in [latest.json](reports/latest.json).

| Test file | Result | Passed |
|---|---|---:|
| [juice-savings.test.ts](juice-savings.test.ts) | PASS | 7 |
| [juice-trading.test.ts](juice-trading.test.ts) | PASS | 9 |
| [rendezvous-auth.test.ts](rendezvous-auth.test.ts) | PASS | 12 |
| [rendezvous.test.ts](rendezvous.test.ts) | PASS | 4 |
| [wallet-paths.test.ts](wallet-paths.test.ts) | PASS | 20 |

## Whole-contract Clarity coverage

SDK LCOV is merged across fresh simnets. Mock/dependency contracts are excluded from these totals. Function denominators include uncalled functions. Branch coverage is not emitted by this SDK; no branch-coverage percentage is claimed.

| Production source | Baseline lines | Current lines | Functions reached |
|---|---:|---:|---:|
| `contracts/juice-savings.clar` | 8.87% | 28.14% (260/924) | 23/51 |
| `contracts/juice-trading.clar` | 15.92% | 28.81% (380/1319) | 25/63 |
| `contracts/juice-safe-auth-helpers-v3.clar` | 25.4% | 100.0% (63/63) | 7/7 |

## Reproducible fuzzing

Rendezvous 1.0.3 generates ABI-typed inputs; fast-check shrinks failures. Seeds: `20261126`, `20261127`; **500 cases per property**, **8,000 generated cases** in this repository. Assertions run against production contract bodies with local external mocks. There are no discards or skipped properties. These are Rendezvous SDK tests inside Vitest, not runs of the legacy RV CLI suites.

```sh
npm ci --prefix tests/nov27
npm --prefix tests/nov27 test
# Larger campaign; seed values stay fixed for reproducibility:
RV_RUNS=2000 npm --prefix tests/nov27 test
```

The original 88-test baseline is preserved in [baseline.json](reports/baseline.json). Current results, complete uncovered line/function lists and source hashes are in [latest.json](reports/latest.json). Raw LCOV and Vitest JSON remain under `.build/`.

## Scope and next coverage work

Passing mocks do not validate mainnet liquidity, external oracle availability, or node-level PoX locking. Increasing whole-contract coverage requires exercising the remaining production paths, not counting mocks or removing defensive guards.
- `juice-savings`: uncalled functions: `add-spent-gas`, `add-spent-sbtc`, `confirm-max-gas-amount`, `confirm-recovery`, `create-pending-operation`, `execute-pending-sbtc-transfer`, `execute-pending-sbtc-transfer-now`, `execute-pending-sbtc-withdrawal`, `execute-pending-sbtc-withdrawal-now`, `execute-pending-stx-transfer`, `execute-pending-stx-transfer-now`, `get-pending-config`, `get-pending-max-gas`, `get-pending-operation`, `get-token-lock-enabled`, `is-inactive`, `max-gas-per-period`, `pay-gas-accounted`, `propose-max-gas-amount`, `propose-recovery`, `recover-inactive-wallet`, `sbtc-initiate-withdrawal`, `set-wallet-config`, `signal-config-change`, `sip009-transfer`, `sip010-transfer`, `veto-operation`, `would-exceed-sbtc-threshold`.
- `juice-trading`: uncalled functions: `add-spent-gas`, `add-spent-sbtc`, `claim-ladder`, `confirm-max-gas-amount`, `confirm-recovery`, `create-pending-operation`, `execute-pending-sbtc-transfer`, `execute-pending-sbtc-transfer-now`, `execute-pending-sbtc-withdrawal`, `execute-pending-sbtc-withdrawal-now`, `execute-pending-stx-transfer`, `execute-pending-stx-transfer-now`, `faktory-execute-limit`, `faktory-fee-airdrop`, `faktory-process-claim`, `get-pending-config`, `get-pending-max-gas`, `get-pending-operation`, `is-inactive`, `max-gas-per-period`, `pay-gas-accounted`, `place-ladder`, `propose-max-gas-amount`, `propose-recovery`, `recover-inactive-wallet`, `rung-entry`, `rung-principal`, `sbtc-initiate-withdrawal`, `set-wallet-config`, `signal-config-change`, `sip009-transfer`, `sip010-transfer`, `smart-buy-sbtc`, `smart-sell-sbtc`, `smart-sell-stx`, `veto-operation`, `withdraw-ladder`, `would-exceed-sbtc-threshold`.
- `juice-safe-auth-helpers-v3`: all functions reached; remaining uncovered lines are alternate branches.
