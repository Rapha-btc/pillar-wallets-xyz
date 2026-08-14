#!/usr/bin/env bash
# Rebuild the RV target. contracts/fakfun-wallet-v17.clar here is a BUILD ARTIFACT:
# the deployed contract with its self-reference repointed at the simnet deployer (rv
# publishes locally) and the invariants appended, because rv reads invariants from the
# contract under test. Nothing regenerates it automatically. Always run this first.
set -euo pipefail
cd "$(dirname "$0")"
SIM=ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM
sed "s/'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22\.fakfun-wallet-v17/'$SIM.fakfun-wallet-v17/g" \
  ../../contracts/fakfun-wallet-v17.clar > contracts/fakfun-wallet-v17.clar
printf '\n' >> contracts/fakfun-wallet-v17.clar
cat fakfun-wallet-v17.invariants.clar >> contracts/fakfun-wallet-v17.clar
echo "built contracts/fakfun-wallet-v17.clar ($(wc -c < contracts/fakfun-wallet-v17.clar) bytes)"
echo "invariants: $(grep -c '^(define-read-only (invariant-' contracts/fakfun-wallet-v17.clar)"
