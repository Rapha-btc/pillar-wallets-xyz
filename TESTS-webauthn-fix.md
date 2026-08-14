# H-01 fix - test log (clarity-5-webauthn-v4, wallet-core-v2, juice-safe-v7, fakfun-wallet-v17)

All simulations run on the stxer mainnet fork against real mainnet dependencies.
Green runs are listed with their stxer id; re-run any sim with `node <file>.js`.

## What changed

- `clarity-5-webauthn-v4` - challenge anchoring. `verify-webauthn-signature`
  requires `client-data-prefix` to equal the exact canonical opener
  `{"type":"webauthn.get","challenge":"` and `client-data-suffix` to start with
  the closing quote. The op hash is then the whole `challenge` field, so one
  assertion can no longer authorize several operations (H-01). Also pins
  `type = webauthn.get` (M-02, partial).
- `fakfun-wallet-core-v2` - the verified-contract registry is gated on a
  settable `contract-admin` var (starts = deployer) instead of a fixed deployer
  constant. Handoff to a multisig (an SM... principal) is 2-step and timelocked:
  `propose-admin` -> wait 144 burn blocks -> the new admin `confirm-admin`s.
  `log-stake-stx-stacking-dao` renamed to `log-stake-stx`.
- `juice-safe-v7` - verify path repointed to `clarity-5-webauthn-v4`, core
  repointed to `fakfun-wallet-core-v2`, `used-assertions` replay key already
  present (one assertion cashable once), `log-stake-stx` rename.
- `fakfun-wallet-v17` - same three: verify -> v4, `used-assertions` added, core
  -> core-v2, `log-stake-stx` rename.

## Tests

### 1. Exploit proof on the DEPLOYED (unfixed) juice-safe-v6

`simul-juice-safe-v6-webauthn-multiplex.js`

- stxer: https://stxer.xyz/simulations/mainnet/66bdfc760dd9cdb55decadd6e22445ff
- Result: 13/13. One genuine passkey assertion (one signature, one
  authenticator-data) carrying a 131-char challenge `h1 || A || h2 || A || h3`.
  Three different `stx-transfer` operations each verified via a different
  prefix/suffix split and executed - 60 STX drained on one gesture. Read-only
  `verify-signature` returned `(ok true)` for all three splits. This is the bug.

### 2. Fix regression (v4 + juice-safe-v7)

First regression, commented sources, v1 core.

- stxer: https://stxer.xyz/simulations/mainnet/056fd61606609967bd1e2022d4d33a47
- Result: 13/13. The exact 3-way multiplex now fails: every drain returns
  `(err u4002)` and read-only `verify-signature` rejects each split, while a
  legitimate single-hash transfer still passes and moves the funds.

### 3. Full pre-flight - comment-free deploy sources, all four contracts

`simul-juice-safe-v7-webauthn-fix-regression.js` (reads `contracts/deploying/*`)

- stxer: https://stxer.xyz/simulations/mainnet/381bc6a8d4e46dd1d74dc6b8800ab9e7
- Result: 15/15. Deploys the comment-free `clarity-5-webauthn-v4`,
  `fakfun-wallet-core-v2`, `juice-safe-v7` and `fakfun-wallet-v17` as Clarity 6
  (exactly the bytes the fakdao-be templates ship), then:
  - all four deploy clean (compile + link check, incl. v7/v17 -> v4 + core-v2)
  - `set-verified-contract` on core-v2 by the deployer-admin succeeds
  - `onboard` registers juice-safe-v7 against core-v2 (hash match)
  - the 3-way multiplex fails `(err u4002)` on every split
  - read-only `verify-signature` rejects each multiplex split and accepts an
    honest single-hash assertion
  - one honest single-op transfer passes and moves exactly 15 STX

  This is the run that validates the exact deploy artifacts.

### 4. Off-chain backtest - the fix does not break real users

- Every WebAuthn assertion relayed to the juice/fakfun safes on mainnet (last
  600 relayer txs): 228 / 228 still ACCEPT under the v4 anchoring predicate.
  Coverage: 50+ wallets, 11 function types, 5 origin variants (juiceofbtc.com,
  jingswap.com, fak.fun, fakfun.com, and an escaped-slash `https:\/\/fak.fun`).
  All real prefixes are byte-identical to the canonical 36-byte opener, so the
  full-prefix pin rejects zero real signatures.

## Issues found and fixed during validation

- Contracts are Clarity 6 (SIP-044 `as-contract?`); deploying them as Clarity 5
  fails analysis. Fixed by deploying with clarity version 6.
- `fakfun-wallet-core-v2` first failed to deploy: a top-level `admin` data-var
  collided with the `(admin principal)` parameter of the existing
  `log-admin-added` / `log-confirm-admin-pubkey` functions
  (`defining 'admin' conflicts with previous value`). Fixed by renaming the var
  to `contract-admin`.

## Deploy order

1. `clarity-5-webauthn-v4` and `fakfun-wallet-core-v2` (independent, any order)
2. `juice-safe-v7` and `fakfun-wallet-v17` (both reference v4 + core-v2)

All from account 0 (SPV9K21), Clarity 6.
