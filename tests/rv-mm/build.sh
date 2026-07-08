#!/bin/bash
# Build the rewritten jing-mm-safe for Rendezvous fuzzing.
#
# jing-mm-safe references mainnet principals for sbtc-token, sbtc-withdrawal,
# fakfun-wallet-core, pox-4, fast-pool-v3, clarity-5-webauthn-v3, the auth
# helpers, mm-safe-auth-helpers-v1, rfq-sbtc-stx-jing, plus pyth/wormhole/
# enroll/sip-010/nft/gas traits. We rewrite them to local mocks/copies so the
# wallet deploys in simnet.
#
# AUTH IS STUBBED OPEN on purpose: is-admin-calling and is-admin-pubkey are
# rewritten to (ok true) and the webauthn verifier is a mock that accepts, so
# Rendezvous can drive the post-auth pending-op state machine. RV cannot forge
# a real P-256 sig, so this is the only way to fuzz that logic. The real auth
# boundary is covered by the deterministic stxer sim, not RV.
#
# Output: tests/rv-mm/.build/jing-mm-safe.clar (gitignored)
set -eu

SRC="contracts/jing-mm-safe.clar"
INV="tests/rv-mm/jing-mm-safe.invariants.clar"
OUT_DIR="tests/rv-mm/.build"
OUT="$OUT_DIR/jing-mm-safe.clar"

mkdir -p "$OUT_DIR"

python3 - "$SRC" "$INV" "$OUT" <<'PYEOF'
import sys, re
src_path, inv_path, out_path = sys.argv[1:4]
text = open(src_path).read()

NS = "'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22"

replacements = [
    # traits -> local copies
    (f"{NS}.gas-station-trait", ".gas-station-trait"),
    ("'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.xbtc-sbtc-swap-v2", ".enroll-trait"),
    ("'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard", ".sip-010-trait"),
    ("'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait", ".nft-trait"),
    ("'SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y.pyth-traits-v2", ".pyth-traits-v2"),
    ("'SP1CGXWEAMG6P6FT04W66NVGJ7PQWMDAC19R7PJ0Y.wormhole-traits-v2", ".wormhole-traits-v2"),
    ("'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK.pillar-wallet-trait", ".pillar-wallet-trait"),
    # direct contract-call? targets -> mocks
    ("'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token", ".mock-sbtc-token"),
    ("'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal", ".mock-sbtc-withdrawal"),
    (f"{NS}.fakfun-wallet-core", ".mock-fakfun-wallet-core"),
    ("'SP000000000000000000002Q6VF78.pox-4", ".mock-pox-4"),
    ("'SP21YTSM60CAY6D011EZVEVNKXVW8FVZE198XEFFP.pox4-fast-pool-v3", ".mock-pox4-fast-pool-v3"),
    (f"{NS}.clarity-5-webauthn-v3", ".mock-clarity-5-webauthn-v3"),
    (f"{NS}.rfq-sbtc-stx-jing", ".mock-rfq-sbtc-stx-jing"),
    # owned helpers -> local copies (real source)
    (f"{NS}.smart-wallet-standard-auth-helpers-v7", ".smart-wallet-standard-auth-helpers-v7"),
    (f"{NS}.smart-wallet-standard-auth-helpers-v8", ".smart-wallet-standard-auth-helpers-v8"),
    (f"{NS}.mm-safe-auth-helpers-v1", ".mm-safe-auth-helpers-v1"),
    # hardcoded gas-station principal
    (f"{NS}.gas-station", ".mock-gas"),
    # self-reference passed to register-wallet
    (f"{NS}.jing-mm-safe", ".jing-mm-safe"),
]
for old, new in replacements:
    text = text.replace(old, new)

# --- open the auth guards so RV can reach the state machine ---
# is-admin-calling: any caller passes (literal replace of the exact body)
admin_calling_old = (
    "(define-read-only (is-admin-calling (caller principal))\n"
    "  (ok (asserts! (is-some (map-get? admins caller)) err-unauthorised))\n"
    ")"
)
admin_calling_new = "(define-read-only (is-admin-calling (caller principal)) (if (is-eq caller caller) (ok true) err-unauthorised))"
assert admin_calling_old in text, "is-admin-calling source shape changed"
text = text.replace(admin_calling_old, admin_calling_new)

# is-admin-pubkey: any pubkey resolves to admin (literal replace)
admin_pubkey_old = (
    "(define-read-only (is-admin-pubkey (pubkey (buff 33)))\n"
    "  (let ((user-opt (map-get? pubkey-to-admin pubkey)))\n"
    "    (match user-opt\n"
    "      user (ok (unwrap! (is-admin-calling user) err-not-admin-pubkey))\n"
    "      err-unregistered-pubkey\n"
    "    )\n"
    "  )\n"
    ")"
)
admin_pubkey_new = "(define-read-only (is-admin-pubkey (pubkey (buff 33))) (if (is-eq pubkey pubkey) (ok true) err-unregistered-pubkey))"
assert admin_pubkey_old in text, "is-admin-pubkey source shape changed"
text = text.replace(admin_pubkey_old, admin_pubkey_new)

# Append invariants
text += "\n\n" + open(inv_path).read()
open(out_path, "w").write(text)

# sanity: report whether the two guards were actually opened
assert admin_calling_new in text, "is-admin-calling rewrite FAILED"
assert admin_pubkey_new in text, "is-admin-pubkey rewrite FAILED"
print("guards opened OK")
PYEOF

leftovers=$(grep -oE "'S[MP][0-9A-Z]{5,}\.[a-z0-9-]+" "$OUT" | grep -vE "SP000000000000000000002Q6VF78|SP28MP1H|SP1JAG6" | sort -u || true)
if [ -n "$leftovers" ]; then
  echo "WARNING: leftover mainnet refs in $OUT:"
  echo "$leftovers"
fi
echo "built: $OUT"
