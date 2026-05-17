#!/bin/bash
# Build the rewritten fakfun-wallet-v2 for Rendezvous fuzzing.
#
# Production source references mainnet principals for sbtc-token,
# fakfun-wallet-core, fakfun-core-v2, pox-4, fast-pool-v3, auth-v7,
# game-wager-v1, burn-bob-faktory, BOB token, plus traits. We rewrite
# all of those to local mocks so the wallet deploys in simnet, then
# append the invariants block.
#
# Output: tests/rv/.build/fakfun-wallet-v2.clar (gitignored)
set -eu

SRC="contracts/fakfun-wallet-v2.clar"
INV="tests/rv/fakfun-wallet-v2.invariants.clar"
OUT_DIR="tests/rv/.build"
OUT="$OUT_DIR/fakfun-wallet-v2.clar"

mkdir -p "$OUT_DIR"

python3 - "$SRC" "$INV" "$OUT" <<'PYEOF'
import sys
src_path, inv_path, out_path = sys.argv[1:4]
text = open(src_path).read()

# Trait references (use-trait) -- production -> local copies
replacements = [
    # Traits
    ("'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.extension-trait",
        ".extension-trait"),
    ("'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.gas-station-trait",
        ".gas-station-trait"),
    ("'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.xbtc-sbtc-swap-v2",
        ".enroll-trait"),
    ("'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard",
        ".sip-010-trait"),
    ("'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait",
        ".nft-trait"),
    ("'SP2ZNGJ85ENDY6QRHQ5P2D4FXKGZWCKTB2T0Z55KS.dexterity-traits-v0",
        ".liquidity-pool-trait"),
    ("'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.faktory-dex-trait-v2",
        ".faktory-dex-trait-v2"),
    ("'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.prelaunch-faktory-trait-v1",
        ".prelaunch-faktory-trait-v1"),
    ("'SP3XXMS38VTAWTVPE5682XSBFXPTH7XCPEBTX8AN2.faktory-trait-v1",
        ".faktory-trait-v1"),
    ("'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-nftmarket-trait",
        ".fakfun-nftmarket-trait"),
    # Direct contract-call? targets
    ("'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
        ".mock-sbtc-token"),
    ("'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core",
        ".mock-fakfun-wallet-core"),
    ("'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-core-v2",
        ".mock-fakfun-core-v2"),
    ("'SP000000000000000000002Q6VF78.pox-4",
        ".mock-pox-4"),
    ("'SP21YTSM60CAY6D011EZVEVNKXVW8FVZE198XEFFP.pox4-fast-pool-v3",
        ".mock-pox4-fast-pool-v3"),
    ("'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK.auth-v7",
        ".mock-auth-v7"),
    ("'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK.game-wager-v1",
        ".mock-game-wager-v1"),
    ("'SP29D6YMDNAKN1P045T6Z817RTE1AC0JAA99WAX2B.burn-bob-faktory",
        ".mock-burn-bob-faktory"),
    ("'SP2VG7S0R4Z8PYNYCAQ04HCBX1MH75VT11VXCWQ6G.built-on-bitcoin-stxcity",
        ".mock-bob-token"),
    # Auth-helpers + webauthn (we own these, use production source directly)
    ("'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7",
        ".smart-wallet-standard-auth-helpers-v7"),
    ("'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.clarity-webauthn",
        ".clarity-webauthn"),
    # Self-reference: wallet passes its own contract id to register-wallet
    ("'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-v2",
        ".fakfun-wallet-v2"),
    # Hardcoded gas-station + nfts-core principal in the wallet
    ("'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.gas-station",
        ".mock-gas"),
    ("'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-nfts-core",
        ".mock-fakfun-nfts-core"),
]

for old, new in replacements:
    text = text.replace(old, new)

# Append invariants
inv = open(inv_path).read()
text += "\n\n" + inv

open(out_path, "w").write(text)
PYEOF

# Verify no leftover mainnet refs
leftovers=$(grep -E "'SM3VDXK3|'SP3FBR2A|'SP2PABAF9|'SP2ZNGJ85|'SP3XXMS3|'SPV9K21T|'SP28MP1H|'SP29D6YM|'SP2VG7S0|'SP000000000000000000002Q6VF78\.pox-4|'SP21YTSM" "$OUT" || true)
# FAKFUN-DEPLOYER (SP1G655...) and JUICE-SIGNER (SP1JAG6...) are intentional constants -- not rewritten.
if [ -n "$leftovers" ]; then
  echo "WARNING: leftover mainnet refs in $OUT:"
  echo "$leftovers" | head -5
fi

echo "built: $OUT"
