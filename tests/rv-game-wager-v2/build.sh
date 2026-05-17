#!/bin/bash
# Build the rewritten game-wager-v2 for Rendezvous fuzzing.
#
# Production source references:
#   * SP3FBR2A...sip-010-trait-ft-standard       (sip-010-trait)
#   * SP28MP1H...pillar-wallet-trait             (pillar-wallet-trait)
#   * SPV9K21T...clarity-webauthn                (webauthn verifier)
# Rewrite each to the local copy so the contract deploys in simnet, then
# append the invariants block.
#
# Output: tests/rv-game-wager-v2/.build/game-wager-v2.clar (gitignored)
set -eu

SRC="contracts/game-wager-v2.clar"
INV="tests/rv-game-wager-v2/game-wager-v2.invariants.clar"
OUT_DIR="tests/rv-game-wager-v2/.build"
OUT="$OUT_DIR/game-wager-v2.clar"

mkdir -p "$OUT_DIR"

python3 - "$SRC" "$INV" "$OUT" <<'PYEOF'
import sys
src_path, inv_path, out_path = sys.argv[1:4]
text = open(src_path).read()

replacements = [
    # SIP-010 trait (use-trait)
    ("'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard",
        ".sip-010-trait"),
    # pillar-wallet-trait (use-trait)
    ("'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK.pillar-wallet-trait",
        ".pillar-wallet-trait"),
    # clarity-webauthn (contract-call?)
    ("'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.clarity-webauthn",
        ".clarity-webauthn"),
]

for old, new in replacements:
    text = text.replace(old, new)

inv = open(inv_path).read()
text += "\n\n" + inv

open(out_path, "w").write(text)
PYEOF

# Verify no leftover mainnet contract refs in the SUT.
# (The default oracle principal SP28MP1H is a STORED principal, not a
# contract reference -- intentionally left alone.)
leftovers=$(grep -E "'SP3FBR2A|'SPV9K21T\.|'SP28MP1H\.pillar-wallet-trait" "$OUT" || true)
if [ -n "$leftovers" ]; then
  echo "WARNING: leftover mainnet refs in $OUT:"
  echo "$leftovers" | head -5
fi

echo "built: $OUT"
