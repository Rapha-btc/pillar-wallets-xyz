# pillar-wallets-xyz

Clarity smart-wallet contracts for Stacks apps that want to onboard mobile
users with **passkeys** (FaceID / TouchID / Windows Hello) instead of seed
phrases — minimal friction, no browser extension, no key custody handoff.

The wallet itself lives on-chain as a smart contract. Auth comes from a
WebAuthn / secp256r1 signature the user produces with their device's
hardware-backed passkey. The signature is verified inside the wallet
contract via [`clarity-webauthn`](contracts/clarity-webauthn.clar), so the
user's private key never leaves the secure enclave and your app never
touches it.

This repo is a framework, not a single product. Each downstream entity
(a meme-coin DEX, a wager game, a DAO, a tournament prize pool, a tipping
app, a subscription service…) can fork the base wallet, swap in the
features they need, and reuse the shared verification + SIP-018 hash
primitives.

---

## Why pillar-wallets

Today's mobile crypto UX is broken for non-power-users:

* Seed phrases scare normal people. They also leak.
* Browser-extension wallets don't exist on iOS.
* Custodial wallets put you on someone else's permission list.

Passkeys solve this. The phone's secure enclave already manages a P-256
keypair the user authenticates with biometrics. Apple, Google, Microsoft,
and 1Password all sync them across devices. **Pillar-wallets bridges that
passkey identity to a Stacks-side smart wallet** so apps can authenticate
spend, governance, and game actions with a single FaceID prompt.

### Design goals

* **Self-custodial.** The user's passkey is the root authority; the app
  cannot move funds on the user's behalf.
* **Recoverable.** Each wallet has a backup admin (a Leather/Xverse
  principal) and a recovery address. Inactive wallets can be recovered
  after a 1-year dormancy window.
* **Gasless-feeling.** Optional gas-station integration pays Stacks fees
  in sBTC sats so users never need STX to transact.
* **Standardized hashing.** All signed payloads go through SIP-018
  domain-separated hashing, with the message domain bound to the wallet
  contract's principal and version — so a sig over one wallet can't be
  replayed against another.
* **Auditable on-chain.** Every wallet emits structured events (admin
  changes, transfers, governance, recovery) through a shared core logger.

### What this framework gives you

| Building block | Where it lives |
|---|---|
| WebAuthn / secp256r1 verifier | [`contracts/clarity-webauthn.clar`](contracts/clarity-webauthn.clar) |
| SIP-018 hash builders (one per wallet op) | [`contracts/smart-wallet-standard-auth-helpers-v7.clar`](contracts/smart-wallet-standard-auth-helpers-v7.clar) |
| Wallet trait (`is-admin-pubkey`) | [`contracts/deployed/deploying/pillar-wallet-trait.clar`](contracts/deployed/deploying/pillar-wallet-trait.clar) |
| Reference wallet (full-featured) | [`contracts/fakfun-wallet-v2.clar`](contracts/fakfun-wallet-v2.clar) |
| Reference downstream consumer | [`contracts/game-wager-v2.clar`](contracts/game-wager-v2.clar) |

A new entity drops in by writing a wallet contract that:

1. `impl-trait`s `pillar-wallet-trait` (so other contracts can ask
   "is this pubkey one of your admins?")
2. Verifies its signed ops via `clarity-webauthn`
3. Hashes those ops via `smart-wallet-standard-auth-helpers-v7` (or its
   own sibling helpers if it has its own message vocabulary)

---

## Where this could go

Today's iteration ships two contracts for the **Faktory / fak.fun**
ecosystem (meme-coin trading + wagering on Stacks). The same primitives
scale to any product where the user is on mobile and friction kills
adoption:

| Future variant | Use case |
|---|---|
| **DAO voting wallets** | Members hold proposal-voting power inside a wallet; voting requires a FaceID prompt. No "lost your seed = lost your seat" problem. |
| **Tournament prize wallets** | An event organizer issues per-player wallets; entries are passkey-signed buy-ins; payouts settle on-chain at the end. |
| **Subscription wallets** | A creator app issues a wallet with a per-period spending ceiling and a designated payee; user signs once with FaceID to authorize the recurring debit. |
| **Game inventory wallets** | NFT items + in-game currency live in a wallet; trades and transfers need a passkey tap. Backup admin = the game studio for support recovery. |
| **Tipping / micro-payment wallets** | Pre-funded with a small sBTC balance; tipping requires only a passkey, no per-tx STX gas (gas-station pays). |
| **Multi-sig org wallets** | Each org member holds their own passkey-backed admin; threshold-N approvals required for high-value ops. |
| **Brand-collab loyalty wallets** | Brand issues stamped reward NFTs into per-user wallets; users redeem via FaceID, app handles recovery. |

The pattern is always the same: app domain → custom wallet contract
deriving from the standard → minimal-friction passkey UX in the
frontend.

---

## Current iteration (in plain English)

Two production contracts, both fuzzed and stxer-simulated end-to-end.

### `fakfun-wallet-v2` — the smart wallet itself

A self-custodial wallet contract that the **fak.fun** app deploys
per-user when they sign up with FaceID. From the user's perspective:

* "Sign in with passkey" creates the wallet — no seed, no STX needed.
* Their sBTC, STX, FAK-tokens, and NFTs live inside their personal
  contract address.
* Every spend (swap, send, deposit, NFT trade, stacking) is a FaceID
  prompt — no browser extension, no signing pop-up wall.
* Gas is paid in sBTC sats by a fee-relay, so the user never has to
  acquire STX.
* If they ever lose all their passkeys, a designated backup wallet
  (their Leather/Xverse address) or a recovery address can rescue
  the funds.
* All major spending limits and cooldown windows are configurable per
  wallet, with veto windows so a compromised frontend can't silently
  push a malicious config past the user.

Under the hood: 39 public functions, 1,812 lines of Clarity, every
signed op goes `passkey → secp256r1 sig → clarity-webauthn → SIP-018
hash domain` before any state changes. 12 RV invariants over ~4,400
calls confirm the structural protections hold under random fuzz; 7
stxer mainnet-fork sims cover every public function end-to-end.

Docs: [`README-fakfun-v2-stxer.md`](README-fakfun-v2-stxer.md) +
seven [`README-simul-fakfun-v2-*.md`](.) per-flow walkthroughs.

### `game-wager-v2` — a downstream consumer

A 1-vs-1 wager escrow. Players deposit a token, an oracle pairs them
into a game, and the winner gets the pot minus a small fee. v2 replaces
v1's Privy / secp256k1 signatures with the **same passkey-based auth
the wallet uses**, so a user signing into fak.fun can immediately wage
without onboarding to a second auth system.

From the user's perspective:

* Tap "wager 0.001 sBTC against Alice" → one FaceID prompt → done.
* If Alice never shows up to the game, anyone can refund both players
  after a 12-hour timeout.
* If both players want out early, the oracle can cancel the game.
* Players can withdraw their winnings to their wallet contract; the
  contract maps each passkey pubkey to the wallet it belongs to, so the
  payout goes to the right place automatically.

Under the hood: 13 public functions, 532 lines of Clarity. SIP-018
hashes are inlined (game-wager has its own message vocabulary —
`wager`, `register-wallet`, `withdraw`) under a domain bound to the
deployed contract principal so v1 and v2 sigs can't cross. 11 RV
invariants pass over ~870 random calls; 4 stxer mainnet-fork sims (76
step assertions, 0 failures) cover the happy path, both cancel paths,
every negative-path err code, and every admin setter + sweep-fees.

Docs: [`README-simul-game-wager-v2.md`](README-simul-game-wager-v2.md)
+ [`tests/rv-game-wager-v2/README.md`](tests/rv-game-wager-v2/README.md).

---

## Test coverage at a glance

| Contract | Public fns | Stxer sims | Sim step assertions | RV invariants | RV calls |
|---|---|---|---|---|---|
| `fakfun-wallet-v2` | 39 | 7 | (per-sim) | 12 / 12 pass | ~4,400 |
| `game-wager-v2` | 13 | 4 | 76 / 76 pass | 11 / 11 pass | ~870 |

Plus `clarinet check` clean on both.

---

## Repo layout

```
contracts/
  clarity-webauthn.clar                       ← shared P-256/WebAuthn verifier
  smart-wallet-standard-auth-helpers-v7.clar  ← shared SIP-018 hash builders
  fakfun-wallet-v2.clar                       ← reference wallet
  game-wager-v2.clar                          ← reference downstream consumer
  test-wallet.clar / test-token.clar          ← sim fixtures
  deployed/
    deploying/                                ← contracts staged for mainnet deploy
                                                 (incl. pillar-wallet-trait)
    *.clar                                    ← v1 / archived predecessors

simul-fakfun-v2-*.js                          ← stxer mainnet-fork sims (7 scripts)
simul-game-wager-v2*.js                       ← stxer sims for the wager (4 scripts)
lib-webauthn-test-signer.mjs                  ← ephemeral P-256 signer for --test-sign
README-*.md                                   ← per-sim walkthroughs

tests/
  fakfun-wallet-v2.test.ts                    ← vitest scaffold
  game-wager-v2.test.ts                       ← vitest scaffold
  rv/                                         ← Rendezvous fuzz for fakfun-wallet-v2
  rv-game-wager-v2/                           ← Rendezvous fuzz for game-wager-v2
```

---

## Working with this repo

Install dependencies once:

```bash
npm install
```

Type-check the contracts:

```bash
npx clarinet check
```

Run any stxer sim end-to-end without a browser (auto-signs in JS):

```bash
node simul-game-wager-v2.js --test-sign           # happy path
node simul-game-wager-v2-cancel.js --test-sign    # cancel paths
node simul-game-wager-v2-negative.js              # err-code assertions
node simul-game-wager-v2-admin.js                 # admin setters + sweep
```

Run Rendezvous stateful fuzz:

```bash
# fakfun-wallet-v2
bash tests/rv/build.sh
cd tests/rv && npx rv . fakfun-wallet-v2 invariant --runs=100

# game-wager-v2
bash tests/rv-game-wager-v2/build.sh
cd tests/rv-game-wager-v2 && npx rv . game-wager-v2 invariant --runs=100
```

Real-passkey signing (for testing against a wallet you actually own):
emit challenge bundles with `--print-challenges`, sign them on
`https://fak.fun/faktory-v2-sign`, then re-run the sim with the
returned `--signed-*` JSON files. Workflow detailed in each
[`README-simul-*.md`](.).
