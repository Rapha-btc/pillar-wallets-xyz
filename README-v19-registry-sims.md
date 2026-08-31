# fakfun-wallet-v19 — extension registry + fast whitelist + usdcx-sbtc-swap-v2

**Status: NOT deployed. Pre-deploy proof on a stxer mainnet fork.**
Verified sim, **54/0**: <https://stxer.xyz/simulations/mainnet/749231b435c245f86ce81775cce0b3b7>
(`simul-v19-registry-swap.js`)

## What v19 adds over v18

1. **Central extension registry** (`fakfun-extension-registry.clar`). The
   whitelisting cooldown moves from every wallet to ONE place: the registry
   owner proposes an extension, waits 144 burn blocks, confirms. Revocation
   is immediate (pulling a bad extension must not wait out a cooldown).
   Two-step owner transfer, also cooled down. Seeds `xtrata-inscribe` and
   `usdcx-sbtc-swap` (v1) at deploy.

2. **Instant whitelist for vetted extensions** (`whitelist-extension-fast`).
   A wallet whitelists a registry-approved extension in ONE tx: passkey
   signature mandatory (the 2FA), no pending operation, no per-wallet
   cooldown. Gate: `is-approved-extension` on the registry, else
   `err-not-registry-approved` (**u4034**). The old slow path
   (`whitelist-extension` -> cooldown -> `execute-pending-whitelist`) stays
   for arbitrary extensions. The challenge is `build-whitelist-fast-hash
   { auth-id, extension }` in **`smart-wallet-standard-auth-helpers-v11`** —
   a NEW topic (`"whitelist-fast"`), so a fast signature can never replay
   into the v7 op-id-bound `execute-pending-whitelist` hash or vice versa.

3. **`usdcx-sbtc-swap-v2`** (`fakfun-extensions/`). Same Bitflow DLMM swap
   as v1, plus a sponsor broadcast fee on the **sBTC leg**:
   - `to-usdcx` (sBTC in): fee off the **input** — sponsor paid first, the
     pool swaps `amount - fee`.
   - `to-sbtc` (sBTC out): fee off the **output** — swap first, then pay the
     sponsor; `min-out > fee` is enforced so the output always covers it.
   Fee defaults to **u20 sats**, hard cap `MAX-GAS u5000`, changeable only
   by the sponsor through propose -> 144 burn blocks -> confirm. Sponsor
   rotation uses the same two-step cooldown. **FE note:** quote `to-usdcx`
   on `amount - fee`, since that is what hits the pool.

4. **Onboard births**: `whitelisted-extensions` seeds `xtrata-inscribe` +
   `usdcx-sbtc-swap-v2` (v1 is no longer pre-whitelisted; it stays
   registry-approved so any wallet can fast-whitelist it), and
   `register-wallet` registers the **v19** template.

## New contracts (deploy order matters)

| # | Contract | Clarity | Purpose |
|---|----------|---------|---------|
| 1 | `fakfun-extension-registry.clar` | 5 | Central vetted-extension allowlist; owns the whitelisting cooldown. |
| 2 | `smart-wallet-standard-auth-helpers-v11.clar` | 5 | `build-whitelist-fast-hash` — new topic, replay-isolated from v7. |
| 3 | `fakfun-extensions/usdcx-sbtc-swap-v2.clar` | 5 | DLMM swap + sponsor fee on the sBTC leg. |
| 4 | `fakfun-wallet-v19.clar` | 6 | The wallet template. References 1–3 (+ everything v18 used, already live). |

Deploy 1 -> 4 under `SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22`. 1–3 must be
live before 4: v19 calls the registry on every fast whitelist, helpers-v11 on
its challenge, and onboard pre-whitelists swap-v2. All v18 supporting
contracts (wallet-core-v2, auth-helpers v7/v10, router registry, swap v1) are
already on mainnet, so the sim deploys only these 4 (+ a sim-only mock).

## Sim coverage (54 tx checks + 26 balance/state evals, all green)

- **Registry**: seeds; propose (owner) ok; confirm pre-cooldown u7103;
  propose by non-owner u7101; confirm post-cooldown ok; immediate revoke;
  revoke-pending; double-propose of approved u7104; two-step owner transfer
  (accept pre-cooldown u7103, post ok, old owner locked out).
- **Fast whitelist from a v19 wallet**: unapproved extension rejected u4034
  *with a valid passkey signature*; registry-approved extension whitelists
  instantly with passkey, zero wallet cooldown; replayed signature u4006;
  signature over the wrong extension u4002. The passkey is MANDATORY
  (non-optional arg) and `verify-signature` enforces registered admin
  pubkey + rpId + the WebAuthn user-verified flag — device possession plus
  FaceID/PIN, both checked on-chain. tx-sender is a relayer, as designed.
- **Slow path intact**: pending op -> u4017 pre-cooldown -> executes after;
  veto -> execute u4015; `remove-extension-whitelist` (admin path).
- **Onboard births**: swap-v2 + xtrata whitelisted, v1 not, v19 registered.
- **swap-v2, driven through v19 `extension-call`** (one passkey-signed, rest
  admin): both directions against the live DLMM pool, sponsor balance
  verified +20 (output-side), +20 (input-side), +100 after the fee change;
  wallet received 12,637 net sats on the 10-USDCx leg. Payload guards u300
  (garbage), u301 (bad action), u302/u303 (zeros), u304 both sides
  (amount<=fee, min-out<=fee). Fee governance: non-sponsor u305, over-cap
  u308, confirm pre-cooldown u307, confirm post-cooldown -> u100 applied.
  Sponsor rotation: cancel path, confirm-no-pending u306, full rotation
  post-cooldown, old sponsor locked out u305, next swap pays the NEW sponsor
  (+100 balance-verified).

Not exercised here (inherited, proven by prior v18 sims): the
`pay-gas-accounted` gas-trait leg on the new entrypoints — `whitelist-
extension-fast` calls the identical plumbing every v18 function uses.

## Still open before deploy

- Register the v19 template hash in the wallet registry (canonical-hash
  check) and point the SDK/FE at `build-whitelist-fast-hash` + the
  `amount - fee` quote rule.
- Decide the registry owner (currently `tx-sender` at deploy) and the
  swap-v2 sponsor (same default).
