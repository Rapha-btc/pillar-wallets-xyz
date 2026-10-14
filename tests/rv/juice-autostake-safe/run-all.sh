#!/usr/bin/env bash
# run-all.sh [inv-runs] [prop-runs] -- rebuild, verify setup, then run both rv
# modes on seeds 1 and 2. Logs: ./logs/{inv,prop}-<seed>.log (gitignored).
# Exit status is non-zero if any run reports a failure.
set -euo pipefail
cd "$(dirname "$0")"
INV=${1:-2000}; PROP=${2:-10000}
./build.sh
node check-setup.mjs > /dev/null
mkdir -p logs
status=0
for seed in 1 2; do
  ./mkconfig.sh invariant "$seed" "$INV" > /dev/null
  ./mkconfig.sh test "$seed" "$PROP" > /dev/null
  DIAL_SEED=$seed DIAL_STATS=logs/dialer-$seed.json \
    npx rv . juice-autostake-safe invariant --config="rv-invariant-$seed.json" > "logs/inv-$seed.log" 2>&1 || status=1
  npx rv . juice-autostake-safe test --config="rv-test-$seed.json" > "logs/prop-$seed.log" 2>&1 || status=1
  for m in inv prop; do
    if grep -q "OK, .* passed after" "logs/$m-$seed.log"; then
      echo "$m seed $seed: $(grep -o 'OK, .* passed after [0-9]* runs' "logs/$m-$seed.log")"
    else
      echo "$m seed $seed: FAILED (see logs/$m-$seed.log)"; status=1
    fi
  done
done
exit $status
