#!/usr/bin/env bash
# Rebuild the RV target. contracts/fakfun-smart-router-registry.clar here is a
# BUILD ARTIFACT: the cleaned registry with the invariants appended, because rv
# reads invariants from the contract under test. Run this before rv.
set -euo pipefail
cd "$(dirname "$0")"
cp ../../contracts/fakfun-smart-router-registry.clar contracts/fakfun-smart-router-registry.clar
printf '\n' >> contracts/fakfun-smart-router-registry.clar
cat registry.invariants.clar >> contracts/fakfun-smart-router-registry.clar
echo "built contracts/fakfun-smart-router-registry.clar ($(wc -c < contracts/fakfun-smart-router-registry.clar) bytes)"
echo "invariants: $(grep -c '^(define-read-only (invariant-' contracts/fakfun-smart-router-registry.clar)"
