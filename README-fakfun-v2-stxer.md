# fakfun-wallet-v2 — Stxer Mainnet-Fork Simulations

End-to-end stxer simulations for the webauthn-signed `fakfun-wallet-v2`
contract, ported from the privy/secp256k1 sims at
`faktory-dao/contracts/fakfun-core/simul-fakfun-v3-*.js`.

The wallet logic is identical to v3 in surface (faktory + NFT marketplace +
token-lock). The only thing that changes is how `sig-auth` is verified: v3
uses 65-byte secp256k1 RSV signatures (`secp256k1-recover?`), v2 uses
WebAuthn / secp256r1 (`secp256r1-verify`) over a reconstructed digest
(`authenticatorData || sha256(clientDataJSON)`).

## Sims

| File | Auth-IDs signed | Latest stxer run | What it proves |
|---|---|---|---|
| `simul-fakfun-v2-wallet.js` | 0–5, 7–13 | [62ce078c…](https://stxer.xyz/simulations/mainnet/62ce078cc225101d055578fdf9fce7dd) | Full lifecycle + stacking — `stack-stx-juice` and `revoke-stacking` (formerly `revoke-fast-pool`) now covered |
| `simul-fakfun-v2-nft.js` | 0, 1, 2, 3, 4, 5 | [193cc8d5…](https://stxer.xyz/simulations/mainnet/193cc8d5ff49ff6b8c7ab42ab81390ce) | ✅ NFT marketplace: BUY → LIST → UPDATE-PRICE → UPDATE-FT → UNLIST → SIP009-TRANSFER (all 6 ops green) |
| `simul-fakfun-v2-token-lock.js` | 0, 1, 2 (+ 3 dummy) | [29cbbb44…](https://stxer.xyz/simulations/mainnet/29cbbb44b7b4cf3332bbefca3c63086f) | ✅ toggle-token-lock asymmetric auth — all 9 phases pass |
| `simul-fakfun-v2-admin.js` | 0–9 | [fc5737fb…](https://stxer.xyz/simulations/mainnet/fc5737fb815ae34a5a580bee318d1de5) | ✅ all 25 steps pass — covers the 10 remaining helpers (stx-transfer, extension flows, veto, recovery, dual-stacking, fast-pool, confirm-transfer-wallet) |
| `simul-fakfun-v2-governance.js` | reuses 0 + 6 from admin bundle | [f56c6525…](https://stxer.xyz/simulations/mainnet/f56c6525110605ddf73944a960fd66d4) | ✅ all 39 steps pass — covers the 12 untested admin/config/recovery functions: set-max-gas-amount, signal-config-change, set-wallet-config, signal-pubkey-cooldown-change, confirm-pubkey-cooldown-change, propose/confirm/remove-admin-pubkey, execute-pending-stx-transfer, execute-pending-sbtc-transfer, confirm-recovery, recover-inactive-wallet (after `addAdvanceBlocks(52_700)`) |
| `simul-fakfun-v2-limit.js` | 10–12 new + reuses 0/2/3 from admin bundle | [ab4c481f…](https://stxer.xyz/simulations/mainnet/ab4c481f8099b2e450c7be26b3de5e6f) | ✅ faktory-execute-limit happy + replay + min-out (retryable) + expired (after advance) + extension-call under token-lock (NEW assert) |
| `simul-fakfun-v2-wager.js` | 20 new + reuses 0 from admin bundle | [ca433deb…](https://stxer.xyz/simulations/mainnet/ca433deb9e02b49f3fdf3299a767a56e) | ✅ wager-deposit cross-curve bridge — secp256k1 register-wallet + webauthn sig-auth + 1000 sats sBTC deposited into game-wager-v1 (final public function, brings wallet coverage to 39/39) |

Each sim is two-phase: print the SIP-018 challenges, sign them in a browser
with your passkey, paste the bundle back, then run.

## auth-helpers-v7 coverage

`smart-wallet-standard-auth-helpers-v7` defines 22 SIP-018 hash builders.
Across all four sims, **22 of 22** are exercised via real signed wallet
calls — full coverage:

| Tested helper | Sim · auth-id |
|---|---|
| `build-add-admin-hash` | wallet/token-lock auth-id 0 |
| `build-toggle-token-lock-hash` | token-lock auth-id 1 |
| `build-sip010-transfer-hash` | token-lock auth-id 2 |
| `build-sip009-transfer-hash` | nft auth-id 5 |
| `build-faktory-execute-hash` | wallet auth-ids 1, 2, 10, 11 |
| `build-faktory-place-order-hash` | wallet auth-ids 3, 4 |
| `build-faktory-process-hash` | wallet auth-id 5 |
| `build-faktory-process-claim-hash` | wallet auth-id 7 |
| `build-faktory-fee-airdrop-hash` | wallet auth-id 8 |
| `build-faktory-burn-bob-hash` | wallet auth-id 9 |
| `build-faktory-nft-execute-hash` | nft auth-ids 0–4 |
| `build-stack-stx-juice-hash` | wallet auth-id 12 |
| `build-revoke-stacking-hash` | wallet auth-id 13 |
| `build-stx-transfer-hash` | admin auth-id 1 |
| `build-whitelist-extension-hash` | admin auth-id 2 |
| `build-extension-call-hash` | admin auth-id 3 |
| `build-remove-extension-whitelist-hash` | admin auth-id 4 |
| `build-veto-operation-hash` | admin auth-id 5 |
| `build-propose-recovery-hash` | admin auth-id 6 |
| `build-enroll-dual-stacking-hash` | admin auth-id 7 |
| `build-stack-stx-fast-pool-hash` | admin auth-id 8 |
| `build-confirm-transfer-hash` | admin auth-id 9 |

## Renames in this iteration

* **`revoke-fast-pool` → `revoke-stacking`** (wallet public function and
  helper builder + topic). The wallet's underlying call is
  `pox-4.revoke-delegate-stx`, which revokes the delegation globally —
  not just from fast-pool. The on-chain `fakfun-wallet-core.log-revoke-fast-pool`
  event name is preserved for indexer compatibility with the existing
  mainnet deployment of `fakfun-wallet-core`. If/when that core is
  upgraded, the event can be renamed to `log-revoke-stacking` for full
  consistency.

## How to run a sim

### 1. Print the challenges

```bash
cd /home/raphastacks/projects/pillar/contracts/pillar-wallets
node simul-fakfun-v2-wallet.js --print-challenges > challenges-wallet.json
```

Each sim emits a JSON bundle of shape:

```json
{
  "walletPrincipal": "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-v2",
  "rpId": "fakfun.com",
  "operations": [
    { "authId": 0, "label": "add-admin (USER)", "challengeHex": "0x…" },
    …
  ]
}
```

Each `challengeHex` is the 32-byte SIP-018 hash that
`smart-wallet-standard-auth-helpers-v7.build-X-hash` computes on-chain. The
sim re-uses the same `to-consensus-buff?` shape in JS so the off-chain hash
matches the on-chain one byte-for-byte. If it doesn't, the wallet returns
`err-invalid-signature (u4002)` on first run.

### 2. Sign in the browser

Open `https://fakfun.com/faktory-v2-sign` (or `https://fak.fun/faktory-v2-sign`
— either rp.id works; the wallet's `verify-signature` accepts both).

First visit: click **Register passkey**. Subsequent visits reuse the stored
credential id from `localStorage`.

Paste the challenges JSON into the textarea. The page renders one row per
operation. Click **Sign all** to walk through each prompt, or **Sign**
on a specific row to retry.

When every row shows ✓ signed, click **Copy to clipboard**. Save the output
as:

| Sim | Default signed-bundle filename |
|---|---|
| wallet | `signed-bundle.json` |
| nft | `signed-bundle-nft.json` |
| token-lock | `signed-bundle-token-lock.json` |

(Each sim accepts `--signed <path>` to override.)

### 3. Run the simulation

```bash
node simul-fakfun-v2-wallet.js
# or:
node simul-fakfun-v2-wallet.js --signed ./signed-bundle.json
```

`SimulationBuilder` from the `stxer` package publishes the run to
`https://stxer.xyz/simulations/mainnet/<id>` and prints the URL. Open it to
see each step's result, post-conditions, and final state.

Capture the URL + observed results into the matching per-sim README:
- `README-simul-fakfun-v2-wallet.md`
- `README-simul-fakfun-v2-nft.md`
- `README-simul-fakfun-v2-token-lock.md`

## Contracts deployed in the simulation

These are not yet on mainnet, so each sim deploys them as part of the run:

| Contract | Source | Notes |
|---|---|---|
| `clarity-webauthn` | `contracts/clarity-webauthn.clar` | base64url + WebAuthn digest reconstruction + `secp256r1-verify` glue |
| `smart-wallet-standard-auth-helpers-v7` | `contracts/smart-wallet-standard-auth-helpers-v7.clar` | SIP-018 hash builders for every signed topic |
| `fakfun-wallet-v2` | `contracts/fakfun-wallet-v2.clar` | the wallet under test |

Already-deployed dependencies the sim relies on but does not redeploy:
`fakfun-wallet-core`, `fakfun-core-v2`, `fakfun-nfts-core`,
`fakfun-nftmarket-trait`, `pepe-nft-marketplace`, `unfair2-*` token suite,
`sbtc-token`, `built-on-bitcoin-stxcity`, `burn-bob-faktory`, `gas-station`.

## Status (2026-05-16)

End-to-end verified on Stacks mainnet fork at epoch 3.4 (Clarity 5):

* **WebAuthn signature path is fully validated.** Across all three sims,
  every signed wallet call (20 distinct webauthn proofs in total) passes
  the `is-authorized → consume-signature → verify-signature
  → clarity-webauthn.verify-webauthn-signature → secp256r1-verify` chain
  without producing `(err u4002)`.
* **Clarity 5's fixed `secp256r1-verify` is the key dependency.** Pre-fork
  the function double-hashed its input (see
  `juice/contracts/webauthn/readme-webauthn.clar` for context); post-fork
  it operates as plain `verify(hash, sig, pubkey)`, which matches what
  WebAuthn signs.
* **Variable-length `clientDataSuffix` works.** Chrome occasionally injects
  the anti-template `other_keys_can_be_added_here: …` extension into
  `clientDataJSON`; the contract's `(buff 512)` cap is sufficient.

### Bug we hit + fixed during this work

`@stacks/transactions` v7's `serializeCV` returns a **hex string**, not a
`Uint8Array`. Initial sims wrapped the return value in `Buffer.from(...)`
without specifying `"hex"`, so the SIP-018 hash was computed over the
ASCII bytes of the hex string — not the binary consensus bytes. The fix
is `Buffer.from(serializeCV(value), "hex")` everywhere the sim builds
domain-hash or message-hash inputs.

The on-chain diagnostic that exposed this:
1. eval `(contract-call? auth-helpers-v7 build-add-admin-hash {…})` →
   on-chain hash `0x11dbc7c4…` (or different depending on contract-caller).
2. JS-computed hash (buggy) → `0x169c3ad1…`.
3. eval `(verify-webauthn-signature pubkey JS-challenge auth-data prefix
   suffix sig)` → returned `true` (so the FE pipeline was correct; the
   signature matched the JS-computed challenge).

Conclusion: the SDK had been hashing ASCII-of-hex while the contract was
hashing the actual bytes. After patching `serializeCV` usage, all three
sims pass their signature checks.

## What v2 changes vs v3 (in plain terms)

* **sig-auth tuple grew**: from `{ auth-id, signature (buff 65), pubkey
  (buff 33) }` to `{ auth-id, pubkey (buff 33), signature (buff 64),
  authenticator-data (buff 256), client-data-prefix (buff 128),
  client-data-suffix (buff 512) }`. The contract reconstructs the WebAuthn
  digest from those four extra fields and runs `secp256r1-verify`.
* **rp.id whitelisting**: `verify-signature` accepts assertions for either
  `fakfun.com` or `fak.fun`. The signing page must be served from one of
  those origins.
* **pubkey is secp256r1, not secp256k1**: 33-byte compressed P-256.
  Browser-generated via `navigator.credentials.create({ alg: -7 })`.
* **Replay protection** still keys on the 32-byte message-hash: re-using
  the same auth-id+args yields `err-signature-replay (u4006)` regardless
  of how many fresh assertions you produce, because the message-hash
  doesn't change.
* **Auth fallback is unchanged**: when sig-auth is `none`, the wallet falls
  back to `(is-admin-calling tx-sender)`. The sims exercise both paths.

## Re-running after a contract edit

Any edit to `fakfun-wallet-v2.clar` — even whitespace — changes its
sha512/256 hash. The sim calls
`fakfun-wallet-core.set-verified-contract` with the freshly-computed
hash before deploying the wallet, so this is handled automatically per
run. If you split the sim across multiple runs against a persisted state
(not the default for stxer), make sure each run starts from a clean
`set-verified-contract` call.

The challenges themselves only depend on the wallet *principal* and the
SIP-018 message contents (auth-id, amounts, etc.) — not on the wallet
source code. Re-running `--print-challenges` after a contract edit
produces the same JSON unless you change the operation parameters.
