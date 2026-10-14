#!/usr/bin/env bash
# mkconfig.sh <mode:invariant|test> <seed> <runs> -> writes rv-<mode>-<seed>.json
# Eligible senders AND principal arguments are restricted to four accounts:
# wallet_1 (owner), wallet_2 (recovery), wallet_3, wallet_4 -- so the owner is
# one sender in four instead of one in ten.
set -euo pipefail
cd "$(dirname "$0")"
mode=$1; seed=$2; runs=$3
dial=""
[ "$mode" = invariant ] && dial=', "dial": "./dialer.mjs"'
printf '{ "seed": %s, "runs": %s, "accounts_mode": "overwrite", "accounts": %s%s }\n' \
  "$seed" "$runs" "$(tr -d '\n' < rv-accounts.json)" "$dial" > "rv-$mode-$seed.json"
echo "rv-$mode-$seed.json"
