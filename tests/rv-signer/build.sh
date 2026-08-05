#!/usr/bin/env bash
# Rebuild the RV target: the deployed signer with the invariants appended, because rv
# reads invariants from the contract under test. Nothing regenerates it automatically.
set -euo pipefail
cd "$(dirname "$0")"
SRC=../../.cache/requirements/SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-pool-stx-signer.clar
cat "$SRC" > contracts/juice-pool-stx-signer.clar
printf '\n' >> contracts/juice-pool-stx-signer.clar
cat juice-pool-stx-signer.invariants.clar >> contracts/juice-pool-stx-signer.clar
echo "built ($(wc -c < contracts/juice-pool-stx-signer.clar) bytes)"
echo "invariants: $(grep -c '^(define-read-only (invariant-' contracts/juice-pool-stx-signer.clar)"
