#!/usr/bin/env bash
# Rebuild the RV target. tests/rv-v6/contracts/juice-safe-v6.clar is a BUILD ARTIFACT:
# the deployed contract with the invariants appended, because rv reads invariants from
# the contract under test. Nothing regenerates it automatically -- editing
# juice-safe-v6.invariants.clar alone leaves the artifact stale and the new invariants
# silently absent from the run. Always run this first.
set -euo pipefail
cd "$(dirname "$0")"
cat ../../contracts/juice-safe-v6.clar > contracts/juice-safe-v6.clar
printf '\n' >> contracts/juice-safe-v6.clar
cat juice-safe-v6.invariants.clar >> contracts/juice-safe-v6.clar
echo "built contracts/juice-safe-v6.clar ($(wc -c < contracts/juice-safe-v6.clar) bytes)"
grep -c '^(define-read-only (invariant-' contracts/juice-safe-v6.clar \
  | xargs -I{} echo "invariants: {}"
