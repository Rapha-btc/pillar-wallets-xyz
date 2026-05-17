# Rendezvous fuzzing — fakfun-wallet-v2

Full-surface stateful fuzz of every public function on
`contracts/fakfun-wallet-v2.clar`, mirroring the structure used in
jingswap-v3.

## Layout

| File | Role |
|------|------|
| `Clarinet.toml` | RV-only manifest (28 contracts: 10 traits + 18 mocks + 2 production helpers + SUT) |
| `build.sh` | Rewrites mainnet principals in the wallet source to local mocks; output goes to `.build/fakfun-wallet-v2.clar` (gitignored) |
| `fakfun-wallet-v2.invariants.clar` | 12 invariants appended to the wallet under fuzz |
| `mock-*.clar` | 19 stubs for external principals the wallet calls (sbtc-token, fakfun-core-v2, pox-4, fast-pool-v3, auth-v7, game-wager-v1, nfts-core, etc.) |
| `*-trait.clar` | 10 local trait copies so trait arguments resolve |

The two production contracts we own are referenced directly via
`../../contracts/`:
- `smart-wallet-standard-auth-helpers-v7.clar` (SIP-018 hash builders)
- `clarity-webauthn.clar` (passkey verifier)

## Run

```
bash tests/rv/build.sh
cd tests/rv
npx rv . fakfun-wallet-v2 invariant --runs=100
```

`build.sh` must be invoked from the project root (it reads
`contracts/fakfun-wallet-v2.clar`).

`npx rv` must be invoked from `tests/rv/` because it picks up
`Clarinet.toml` from the cwd.

## Result snapshot (2026-05-16, --runs=100)

- 39/39 wallet entrypoints touched, 10–22 calls each
- 12/12 invariants PASSED, 0 FAILED
- ~4,400 total calls executed
- Most calls IGNORED with `u4001` / `u4002` / `u4011` / `u4013` — RV
  can't forge WebAuthn signatures, so sig-gated paths always bounce.
  The pre-auth surface (arg parsing, ordering, error paths, state
  invariants) is what actually gets exercised here. The
  signature-forgery / replay-style attacks live in the stxer
  mainnet-fork sims (`pillar-wallets-xyz/simul-fakfun-v2-*.js`).

## Invariants

| Name | What it asserts |
|------|----------------|
| `invariant-is-initialized-monotonic` | `is-initialized` only ever flips false→true |
| `invariant-last-activity-not-future` | `last-activity-block` never exceeds `burn-block-height` |
| `invariant-max-gas-bounded` | `max-gas-amount` stays under hard cap |
| `invariant-operation-nonce-monotonic` | `pending-operation-nonce` never decreases |
| `invariant-owner-is-admin-when-initialized` | once initialized, the owner is always in the admins map |
| `invariant-period-start-not-future` | `period-start-block` never exceeds `burn-block-height` |
| `invariant-pubkey-cooldown-bounded` | `pubkey-cooldown-period` stays within configured bounds |
| `invariant-pubkey-initialized-monotonic` | per-pubkey-init counts only grow |
| `invariant-recovery-address-set` | once recovery address set, never reset to none |
| `invariant-thresholds-nonzero` | configured stx/sbtc thresholds remain non-zero |
| `invariant-token-lock-bool` | `token-lock-enabled` is always a defined bool |
| `invariant-wallet-cooldown-bounded` | per-op cooldown stays within `MIN-COOLDOWN`–`MAX-COOLDOWN` |

## Re-running after wallet changes

Any edit to `contracts/fakfun-wallet-v2.clar` requires re-running
`build.sh` before `npx rv`. The `.build/` directory is gitignored so
the rewritten SUT is regenerated on each invocation.
