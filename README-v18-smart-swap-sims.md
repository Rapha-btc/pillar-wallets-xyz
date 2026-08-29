# fakfun-wallet-v18 — smart-router trading + USDCx↔sBTC swap

v18 extends v17 with two capabilities, both validated on a **stxer mainnet
fork** (`simul-v18-smart-swap.js`). Nothing here is deployed yet; this is the
pre-deploy proof.

## What v18 adds over v17

1. **Native smart split-router trading.** Four passkey/admin-authorized
   entries — `smart-buy-sbtc`, `smart-buy-stx`, `smart-sell-sbtc`,
   `smart-sell-stx` — dispatch to the 9 deployed faktory smart routers
   through `faktory-smart-trait-v1`. Four entries (not one opcode dispatcher)
   because each router call returns a differently-shaped `ok` tuple that an
   if-chain will not unify. The signed challenge (`build-smart-execute-hash`
   in `smart-execute-auth-helper`) binds a 1-byte `op` tag so a buy signature
   cannot replay as a sell. Allowances are surgical: `(with-ft SBTC …)` /
   `(with-stx …)` on buys, `(with-ft <token> …)` on sells.

2. **USDCx pre-whitelisted at onboard.** `onboard` seeds
   `whitelisted-extensions` with `usdcx-sbtc-swap` (fully qualified), so a
   bridged-in wallet can swap USDCx↔sBTC from birth with no whitelist
   ceremony. The swap itself is an **extension** (`fakfun-extensions/
   usdcx-sbtc-swap.clar`), not template code — one venue (Bitflow DLMM
   sBTC/USDCx 10bps), both directions (`to-sbtc` / `to-usdcx`), min-out and
   max-steps enforced.

## New contracts (deploy order matters)

| # | Contract | Purpose |
|---|----------|---------|
| 1 | `faktory-smart-trait-v1.clar` | Shared interface of the 9 smart routers. Response tuples verified identical across all routers. |
| 2 | `smart-execute-auth-helper.clar` | `build-smart-execute-hash` — the smart-trade challenge. A dedicated contract because on-chain `auth-helpers-v8/v9/v10` already exist **without** this builder. |
| 3 | `fakfun-extensions/usdcx-sbtc-swap.clar` | USDCx↔sBTC via Bitflow DLMM router, both directions. |
| 4 | `fakfun-wallet-v18.clar` | The wallet template. Clarity **6** (uses `with-staking`). References 1–3. |

Deploy 1→4 under `SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22`.

## Coverage — `simul-v18-smart-swap.js`

Latest run: **46 passed / 1 (cosmetic) — 9/9 tokens, both sides, both funding
assets, both swap directions.** The single "fail" is a reporting artifact on
the `advance-blocks` step (no tx result to read); it ran fine.

Latest sim: <https://stxer.xyz/simulations/mainnet/150b5efaf5a6c7b45ce74fe5db2be169>

What it drives, on a real mainnet fork:

- **Deploys** all 4 new contracts in-fork (Clarity 6 for v18).
- **verify** in `fakfun-wallet-core-v2`, **onboard** (asserts the swap
  extension is whitelisted from birth), passkey **propose/accept/confirm-admin**.
- **Trait conformance:** all 9 routers (B, MIA, PEPE, FLAT, FAKFUN, LEO, LWB,
  WELSH, ROCK) dispatch through `<smart-trait>` — the deployed routers do not
  declare `impl-trait`; structural conformance is proven at runtime by every
  buy and sell returning `(ok …)`.
- **36 smart trades:** buy + sell on both sBTC and STX, all 9 tokens
  (ADMIN path), plus one **passkey-signed** `smart-buy-sbtc` (PEPE) proving
  `build-smart-execute-hash` end-to-end.
- **USDCx↔sBTC** both directions: `to-sbtc` passkey-signed, `to-usdcx` admin.

### Test-parameter notes

- Trades route `fak-ratio = u100` (100% through the faktory pool) with
  `min-out = u1` under `PostConditionMode.Allow`: this proves the **wallet
  integration** (entry + allowance + as-contract dispatch + trait
  conformance), not the routers' DEX legs, which have their own passing sims.
- Sell sizes are per-token (~0.5% of post-buy holdings). A flat sell size
  fails on high-supply tokens (B/FAKFUN/LWB/ROCK hold ~1e14 units, so a small
  fixed sell is relative dust → ~0 output → pool `u3`). This is a harness
  sizing detail, not a contract issue.

### ROCK note

`rock-smart-faktory` calls `rock-faktory-pool-2.execute` **directly** (not via
core-v2) because the pool was unregistered; that path passes here. Registering
the pool in `fakfun-core-v2` (done 2026-08-29, `register-pool` → pool id 52)
does not change the smart-router path — it separately enables the wallet's
plain `faktory-execute` for ROCK.

## Before mainnet deploy

- [ ] Deploy contracts 1→4 in order.
- [ ] Re-register the v18 template hash (sha512/256) in the wallet registry.
- [ ] Point the SDK/FE signer at `build-smart-execute-hash` (op tag + fields).
- [ ] clarinet lint harness for the extension (references 4 mainnet contracts).

Run: `node simul-v18-smart-swap.js`
