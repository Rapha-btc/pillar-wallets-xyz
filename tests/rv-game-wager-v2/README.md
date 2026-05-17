# Rendezvous fuzzing — game-wager-v2

Full-surface stateful fuzz of every public function on
`contracts/game-wager-v2.clar`. Sibling to `tests/rv/` (which fuzzes
`fakfun-wallet-v2`); kept in its own directory because the trait /
mock surface is completely different.

## Layout

| File | Role |
|------|------|
| `Clarinet.toml` | RV-only manifest (2 traits + 2 mocks + 1 production helper + SUT) |
| `build.sh` | Rewrites mainnet principals in `contracts/game-wager-v2.clar` to local mocks; output goes to `.build/game-wager-v2.clar` (gitignored) |
| `game-wager-v2.invariants.clar` | 11 invariants appended to the contract under fuzz |
| `mock-token.clar` | Open-mint SIP-010 token (auto-mints on transfer-short) |
| `mock-wallet.clar` | `pillar-wallet-trait` impl whose `is-admin-pubkey` returns `(ok true)` |
| `sip-010-trait.clar` | Local trait copy |
| `pillar-wallet-trait.clar` | Local trait copy |
| `clarity-webauthn.clar` | Production webauthn verifier (we own it, used verbatim) |
| `settings/Devnet.toml` | Standard simnet wallets |

The build script rewrites three mainnet principals:

| Production import | Rewritten to |
|---|---|
| `'SP3FBR2A….sip-010-trait-ft-standard` | `.sip-010-trait` |
| `'SP28MP1H….pillar-wallet-trait` | `.pillar-wallet-trait` |
| `'SPV9K21T….clarity-webauthn` | `.clarity-webauthn` |

The default `oracle` data-var (`SP28MP1H…`) is intentionally **not**
rewritten — it's a stored principal, not a contract reference. In
simnet no random caller can match it, so create-game / resolve-game
bounce until DEPLOYER calls `set-oracle` (which RV does happen to fire
~6 times across 100 runs).

## Run

```bash
bash tests/rv-game-wager-v2/build.sh
cd tests/rv-game-wager-v2
npx rv . game-wager-v2 invariant --runs=100
```

`build.sh` must be invoked from the project root (it reads
`contracts/game-wager-v2.clar` via a relative path).

`npx rv` must be invoked from `tests/rv-game-wager-v2/` because it picks
up `Clarinet.toml` and `settings/Devnet.toml` from the cwd.

## Result snapshot (2026-05-17, --runs=100)

**`OK, invariants passed after 100 runs.`** — 11/11 invariants held,
0 failed. ~870 total calls executed across all public entrypoints.

| Bucket | Counts |
|---|---|
| SUCCESSFUL public calls | `set-oracle ×6` · `set-token-whitelist ×9` · `set-treasury ×6` · `set-withdraw-fee-rate ×1` · `rv-snapshot-game-nonce ×58` |
| IGNORED (bounce on auth/sig) | `cancel-game ×50` · `create-game ×42` · `deposit ×36` · `register-wallet ×53` · `resolve-game ×69` · `set-fee-rate ×49` · `set-oracle ×49` · `set-token-whitelist ×30` · `set-treasury ×40` · `set-withdraw-fee-rate ×53` · `sweep-fees ×38` · `withdraw ×44` |
| INVARIANT PASSED | every invariant fired 5–13 times, total 100, **0 failed** |

Most signed paths bounce as expected (`err-invalid-signature u7003`,
`err-not-deployer u7002`, `err-not-oracle u7001`) because RV can't
forge webauthn sigs or be DEPLOYER consistently. The pre-auth surface
(arg parsing, error code ordering, state invariants) is what actually
gets exercised under random stress. Signature-forgery / replay attacks
live in the stxer mainnet-fork sims
(`simul-game-wager-v2-negative.js`).

## Invariants

| Name | What it asserts |
|------|-----------------|
| `invariant-game-nonce-monotonic` | `game-nonce` never decreases between snapshots |
| `invariant-fee-rate-bounded` | `fee-rate ≤ u2000` (20% cap from `set-fee-rate`) |
| `invariant-withdraw-fee-rate-bounded` | `withdraw-fee-rate ≤ u1000` (10% cap from `set-withdraw-fee-rate`) |
| `invariant-game-0-status-valid` | game 0, if it exists, has `status ∈ {active, resolved, cancelled}` |
| `invariant-game-1-status-valid` | same for game 1 |
| `invariant-game-0-winner-is-player` | if game 0 is resolved, `winner` is one of `player-a` / `player-b` |
| `invariant-game-0-wager-positive` | if game 0 exists, `wager-amount > 0` |
| `invariant-game-0-distinct-players` | if game 0 exists, `player-a != player-b` |
| `invariant-oracle-nonburn` | `oracle` is never the burn address |
| `invariant-treasury-nonburn` | `treasury` is never the burn address |
| `invariant-game-timeout-constant` | `GAME_TIMEOUT = u144` (compile-time constant) |
