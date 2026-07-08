# Verification: pillar-safe-v2, jing-mm-safe, mm-safe-auth-helpers-v1

Two complementary layers verify the safe contracts:

1. **stxer mainnet-fork simulations** — deterministic, end-to-end, with REAL
   self-signed P-256 signatures against the DEPLOYED canonicals and the real
   deployed rfq / pyth / webauthn / sbtc contracts. This is the authoritative
   check: every branch is actually reached and verified with real crypto.
2. **Rendezvous (RV) property fuzzing** — random call sequences against the
   pending-operation state machine, checking structural invariants.

## 1. stxer simulations

Prereqs: `npm install` (needs `stxer`, `@stacks/transactions`, `@noble/curves`).
Both scripts self-sign a synthetic P-256 key and submit a mainnet-fork sim; they
print a `stxer.xyz` URL and a pass/fail tally, exiting non-zero on any failure.

### `simul-pillar-safe-v2.js` — 25/25

    node simul-pillar-safe-v2.js

Runs against the deployed `SPV9K21….pillar-safe-v2`. Covers:
- onboard (owner / recovery / thresholds) on the deployed canonical
- admin-path and passkey-path STX transfers
- passkey transfers under ALL THREE whitelisted rp-ids that matter for v2:
  `pillarwallets.xyz`, and the two NEW ones `fak.fun` + `fakfun.com`
- over-threshold pending op + cooldown execution
- sBTC transfer + sBTC withdrawal (passkey)
- NEGATIVE: the four removed functions are gone — `propose-admin-pubkey`,
  `confirm-admin-pubkey`, `signal-pubkey-cooldown-change`,
  `confirm-pubkey-cooldown-change` — plus `remove-admin-pubkey`
- NEGATIVE: a non-whitelisted rp-id (`example.com`) → `err u4002`
- 2FA wallet-transfer escape; old passkey de-authorized afterward

Last run: **25 passed, 0 failed**
(https://stxer.xyz/simulations/mainnet/74f866b38048ac7cf543f9bc11c41f74)

### `simul-jing-mm-safe.js` — 39/39

    node simul-jing-mm-safe.js

Runs against the deployed `SPV9K21….jing-mm-safe` + `…mm-safe-auth-helpers-v1`,
driving the LIVE `rfq-sbtc-stx-jing` market with live Hermes Pyth VAAs. Covers
everything pillar-safe-v2 does, plus:

RFQ desk:
- `set-rfq-operator` gated to admin (non-admin → u4001)
- `fix-rfq` gated to operator/admin (random caller → u4001)
- a REAL open → fix → fulfill against the live market: client escrows 200k sats,
  operator fixes with the client's SIP-018 quote (naming the SAFE as winner)
  using live BTC/USD + STX/USD VAAs, operator fulfills — asserted end state:
  wallet receives the escrowed sBTC, client receives STX, wallet pays the STX

2FA execute-now matrix (passkey lifts the cooldown, ADMIN-created ops only):
- admin-created over-threshold op → plain exec before cooldown = `u4017`;
  `execute-pending-stx-transfer-now` with passkey = immediate OK
- PASSKEY-created op → `execute-*-now` = `u4003` (one factor can't be both)
- vetoed op → `execute-*-now` = `u4015`
- sBTC transfer + sBTC withdrawal fast paths (passkey) = OK
- wrong-domain sig on the fast path = `u4002`
- token-lock enabled → fast path with a VALID sig = `u4023` (kill switch)
- after cooldown, the passkey-created op still clears via the normal path

Last run: **39 passed, 0 failed**
(https://stxer.xyz/simulations/mainnet/d2d662005e5462c1aad389e66f3383e6)

Gotcha baked into the harness: the RFQ client principal is derived from the
signature's own on-chain recovery (compressed pubkey) via
`getAddressFromPublicKey(publicKeyFromSignatureRsv(hash, sig))`, NOT from
`getAddressFromPrivateKey` — the latter disagrees for `…01`-suffixed keys and
would make `fix-price` fail `ERR_BAD_AUTH (u2007)`. The desk backend that signs
quotes must do the same.

## 2. Rendezvous fuzzing — `tests/rv-mm/`

    bash tests/rv-mm/build.sh
    npx rv tests/rv-mm jing-mm-safe invariant --runs=200

What it does and its honest scope: RV drives random calls from random principals
and CANNOT forge a P-256 signature, so the signed paths would normally just
bounce at verify. To fuzz the post-auth logic, `build.sh` rewrites the deployed
source into `.build/jing-mm-safe.clar` with auth STUBBED OPEN — `is-admin-calling`
and `is-admin-pubkey` return ok, and `clarity-5-webauthn-v3` is swapped for a
mock that accepts. That lets RV hammer the **pending-operation state machine**
across random create / execute / execute-now / veto sequences.

This means RV does NOT test the auth boundary (that is the stxer sim's job, with
real sigs). RV tests that no random sequence corrupts the op state machine.

Invariants (`jing-mm-safe.invariants.clar`):
1. `invariant-no-executed-and-vetoed` — no op is both executed and vetoed
2. `invariant-passkey-op-never-fast-tracked` — every executed passkey-created op
   has a matured cooldown (the -now guard is the only thing preventing a
   passkey-created op from executing early; if it regressed this catches it)
3. `invariant-execute-after-nonzero` — no pending op has a genesis-executable
   (`u0`) cooldown stamp
4. `invariant-token-lock-is-bool` — the kill switch never lands in a bad state

Last run: **all 4 invariants passed, 0 failed** at 200 runs (call mix included
veto ×42, sip010-transfer ×23, stx-transfer ×18, toggle-token-lock ×6, plus
execute paths). Random calls with malformed inputs (e.g. a bad token-name) are
reported as IGNORED, not failures.

`.build/` is gitignored — run `build.sh` before `npx rv`.
