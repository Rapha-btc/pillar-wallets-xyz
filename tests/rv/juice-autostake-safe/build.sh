#!/usr/bin/env bash
# Rebuild the RV target for juice-autostake-safe. Run from anywhere.
# Writes three BUILD ARTIFACTS into ./contracts (never edit them by hand):
#   juice-autostake-safe.clar                = production source + test-only
#                                              patches (each asserted to apply
#                                              exactly as many times as listed)
#                                              + juice-autostake-safe.rv.clar
#   juice-autostake-pool.clar                = live juice-pool-stx-signer (cache)
#   juice-autostake-safe-auth-helpers-v1.clar = production helper, unchanged
# Patches are documented in ../README.md ("juice-autostake-safe").
set -euo pipefail
cd "$(dirname "$0")"
ROOT=../../..
cp "$ROOT/contracts/juice-autostake-safe-auth-helpers-v1.clar" contracts/
cp "$ROOT/.cache/requirements/SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-pool-stx-signer.clar" \
  contracts/juice-autostake-pool.clar
python3 - "$ROOT/contracts/juice-autostake-safe.clar" juice-autostake-safe.rv.clar \
  contracts/juice-autostake-safe.clar "${RV_INACTIVITY:-u120}" <<'PY'
import sys
src, harness, out, inactivity = sys.argv[1:5]
t = open(src).read()
D = "'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22"
patches = [
  # A. address repoints (same three as tests/cl-autostake-cov): rv publishes
  #    project contracts under the simnet deployer, not SPV9K21T...
  (D + ".juice-pool-sbtc-signer)", ".juice-autostake-pool)", 1),
  (D + ".juice-autostake-safe-auth-helpers-v1", ".juice-autostake-safe-auth-helpers-v1", 1),
  (D + ".juice-autostake-safe\n", ".juice-autostake-safe\n", 1),
  # B. inactivity window shortened so recover-inactive-wallet is reachable
  #    inside a fuzz session (rv mines <= 100 burn blocks per run at 1000 runs)
  ("(define-constant INACTIVITY-PERIOD u52560)",
   "(define-constant INACTIVITY-PERIOD " + inactivity + ")", 1),
  # C. PoX lock emulation. Simnet never runs the node's PoX lock handler, so
  #    stx-account reports staked STX as unlocked and stx-transfer? can move it.
  #    C1: the safe's own reads of its account see the emulated lock
  ("(stx-account current-contract)", "(rv-stx-account)", 2),
  #    C2: STX leaving the safe can only spend emulated-unlocked STX
  #        (node: a transfer of locked STX fails with err u1)
  ("(stx-transfer? ", "(rv-stx-transfer? ", 3),
  ("(stx-transfer-memo? ", "(rv-stx-transfer-memo? ", 3),
  #    C3: pox-5 stake-update checks (stx-account tx-sender) unlocked >=
  #        amount-increase (ERR_INSUFFICIENT_STX u8); simnet sees the full
  #        balance, so update-stake-stx-juice gets the same check on the
  #        emulated account before its pox-5 call
  ("    (try! (as-contract? ((with-staking (+ (locked-ustx) amount-increase)))",
   "    (asserts! (<= amount-increase (get unlocked (rv-stx-account))) (err u8))\n"
   "    (try! (as-contract? ((with-staking (+ (locked-ustx) amount-increase)))", 1),
]
for old, new, n in patches:
  c = t.count(old)
  if c != n:
    sys.exit(f"patch expected {n}x, found {c}x: {old!r}")
  t = t.replace(old, new)
t += "\n\n" + open(harness).read()
open(out, "w").write(t)
print(f"built {out}: {len(t)} bytes, {len(patches)} patches")
PY
echo "invariants: $(grep -c '^(define-read-only (invariant-' contracts/juice-autostake-safe.clar)"
echo "properties: $(grep -c '^(define-public (test-' contracts/juice-autostake-safe.clar)"
# regenerate the simnet plan + append the rv-setup batch (gen-plan.mjs)
node gen-plan.mjs
