# simul-game-wager-v2 — passkey-authenticated wager flow

Stxer mainnet-fork simulations for `game-wager-v2`, the WebAuthn / passkey
rewrite of `game-wager-v1` (which used Privy secp256k1 sigs).

Two sim scripts, sharing the same SIP-018 challenge builder and webauthn
signer:

| Script | Covers | Stxer URL (latest test-sign run) |
|---|---|---|
| `simul-game-wager-v2.js` | Full happy path: deposit → wager → resolve → register-wallet → withdraw | https://stxer.xyz/simulations/mainnet/7c5605c594b2dbe64fee555b89603cc5 |
| `simul-game-wager-v2-cancel.js` | Both cancel paths: oracle-cancel (any time) + timeout-cancel (after `GAME_TIMEOUT = u144`, via `addAdvanceBlocks`) | https://stxer.xyz/simulations/mainnet/8d72034e02f6ae9131edca3a48cd69a6 |

Each script has three modes:

| Mode | When | Action |
|---|---|---|
| `--print-challenges --pubkey-a 0x… --pubkey-b 0x…` | Real-passkey signing | Emits ChallengeBundle JSON files (one per player) shaped exactly like `/faktory-v2-sign` expects. |
| (no flag, default) | After collecting SignedBundles | Loads `--signed-a` / `--signed-b` JSON files from `/faktory-v2-sign` and runs the sim. |
| `--test-sign` | Self-verify, no FE | Generates ephemeral P-256 keypairs in-script via `lib-webauthn-test-signer.mjs`, signs in-script, runs the sim. Both sigs end up in `clarity-webauthn.verify-webauthn-signature` so this exercises the real cryptographic path. |

## SIP-018 domain

Built **inline** in `game-wager-v2.clar`:

```clojure
{ chain-id: 1,
  contract: SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.game-wager-v2,
  name: "game-wager",
  version: "2.0.0" }
```

Change `DEPLOYER` at the top of either sim script if you want a different
deploy principal — challenges need to re-emit and re-sign because the
contract principal is part of the domain.

## Auth-id schema

**Happy path** (`simul-game-wager-v2.js`):

| Player A | auth-id | Player B | auth-id |
|---|---|---|---|
| register-wallet | 1 | register-wallet | 1 |
| wager | 2 | wager | 2 |
| withdraw | 3 | – | – |

**Cancel paths** (`simul-game-wager-v2-cancel.js`):

| Player A | auth-id | Player B | auth-id |
|---|---|---|---|
| wager (game 0, oracle-cancelled) | 1 | wager (game 0) | 1 |
| wager (game 1, timeout-cancelled) | 2 | wager (game 1) | 2 |

## Setup the sims rely on

Both sims deploy under two principals to keep the contract's hard-coded
imports working:

| Principal | Contracts deployed |
|---|---|
| `SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK` (PILLAR_TRAIT_DEPLOYER) | `pillar-wallet-trait` |
| `SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22` (DEPLOYER) | `sip-010-trait`, `test-token`, `clarity-webauthn`, `test-wallet-a`, `test-wallet-b`, `game-wager-v2` |

The contract's `oracle` data-var defaults to `SP28MP1H…`, so create-game /
resolve-game / cancel-game run from that sender. `test-wallet-{a,b}` are
minimal `impl-trait pillar-wallet-trait` shims whose `is-admin-pubkey`
returns `(ok true)` for any pubkey — game-wager-v2's signature check is
the real authority gate; the wallet only needs to satisfy the trait so
`register-wallet`'s `(contract-call? wallet is-admin-pubkey pubkey)`
succeeds.

## End-to-end verification

Run either sim with `--test-sign` to verify the contract + sim wiring
without touching the FE:

```bash
node simul-game-wager-v2.js --test-sign           # happy path
node simul-game-wager-v2-cancel.js --test-sign    # cancel paths
```

Latest verified runs (above table) — both report `[OK]` on every step and
the final-state reads decode cleanly:

* **Happy path**: Player A balance = 1,050,000 (1M − 500k wager + 950k
  payout − 400k withdraw), Player B balance = 500,000, accumulated fees =
  54,000 (50k game fee + 4k withdraw fee), game 0 resolved → winner A,
  both pubkey-wallet mappings recorded.
* **Cancel**: Player A balance = Player B balance = 998,000 (1M − 100k
  game 0 wager + 99k refund − 100k game 1 wager + 99k refund), game-nonce
  = u2, both games `cancelled`, accumulated fees = 4,000 (2 cancels × 2
  players × 1k withdraw-fee each).

## Real-passkey workflow (FE-driven)

The wager hash embeds the **opponent's** pubkey, so we need both passkeys
registered before any signing happens.

```bash
# 1. On https://fak.fun/faktory-v2-sign, register passkey A, capture pubkeyHex.
#    Clear localStorage, register passkey B, capture pubkeyHex.

# 2. Emit the challenge bundles:
node simul-game-wager-v2.js --print-challenges \
  --pubkey-a 0x<A> --pubkey-b 0x<B>
# -> challenges-player-a.json + challenges-player-b.json

# 3. Sign each on /faktory-v2-sign with the matching passkey, save as
#    signed-bundle-player-a.json + signed-bundle-player-b.json.

# 4. Run the sim:
node simul-game-wager-v2.js \
  --signed-a ./signed-bundle-player-a.json \
  --signed-b ./signed-bundle-player-b.json
```

Same flow for the cancel sim (`simul-game-wager-v2-cancel.js`), only the
challenge / signed bundle filenames are `*-cancel-*`.

## Files

| File | Purpose |
|---|---|
| `simul-game-wager-v2.js` | Happy-path sim |
| `simul-game-wager-v2-cancel.js` | Cancel-path sim (oracle + timeout) |
| `lib-webauthn-test-signer.mjs` | Shared P-256 ephemeral signer used by `--test-sign` in both sims |
| `contracts/game-wager-v2.clar` | The contract under test |
| `contracts/clarity-webauthn.clar` | WebAuthn verifier (same one fakfun-wallet-v2 uses) |
| `contracts/deployed/deploying/pillar-wallet-trait.clar` | The trait `game-wager-v2.register-wallet` requires |
| `contracts/test-wallet.clar` | Trivial trait impl; deployed twice as `test-wallet-{a,b}` |
| `contracts/sip-010-trait.clar` | SIP-010 trait |
| `contracts/test-token.clar` | Throwaway SIP-010 token |
| `challenges-*.json` / `signed-bundle-*.json` | Per-flow bundle files (gitignored — regenerated per run) |
