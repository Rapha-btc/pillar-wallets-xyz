#!/usr/bin/env bash
# Regenerate the COVERAGE ONLY copies in ./contracts from the repo sources.
#   juice-autostake-safe.clar                 = ../../contracts/juice-autostake-safe.clar
#                                               with exactly 3 principal repoints
#   juice-autostake-safe-auth-helpers-v1.clar = production helper, unchanged
#   juice-autostake-pool.clar                 = live juice-pool-stx-signer (cache)
# The repoints are the same three as tests/rv/juice-autostake-safe/build.sh
# (patch A); each must apply exactly once, so a source change that moves them
# fails loudly instead of producing a silently different copy.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=../..
cp "$ROOT/contracts/juice-autostake-safe-auth-helpers-v1.clar" contracts/
cp "$ROOT/.cache/requirements/SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-pool-stx-signer.clar" \
  contracts/juice-autostake-pool.clar
python3 - "$ROOT/contracts/juice-autostake-safe.clar" contracts/juice-autostake-safe.clar <<'PY'
import sys
src, out = sys.argv[1:3]
t = open(src).read()
D = "'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22"
for old, new in [
  (D + ".juice-pool-sbtc-signer)", ".juice-autostake-pool)"),                  # JUICE-SIGNER
  (D + ".juice-autostake-safe-auth-helpers-v1", ".juice-autostake-safe-auth-helpers-v1"),  # set-keeper helper
  (D + ".juice-autostake-safe\n", ".juice-autostake-safe\n"),                  # onboard register-wallet canonical
]:
  c = t.count(old)
  if c != 1:
    sys.exit(f"repoint expected 1x, found {c}x: {old!r}")
  t = t.replace(old, new)
open(out, "w").write(t)
print(f"built {out}: {len(t)} bytes, 3 repoints")
PY
