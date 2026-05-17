# simul-fakfun-v2-nft — NFT Marketplace (webauthn)

Stxer mainnet-fork simulation of `fakfun-wallet-v2` against the existing
`pepe-nft-marketplace` and `bitcoin-pepe` NFT contracts. Mirrors
`faktory-dao/contracts/fakfun-core/simul-fakfun-v3-nft.js` (privy) step
for step; only the auth tuple shape changes to webauthn.

**Latest run:** https://stxer.xyz/simulations/mainnet/193cc8d5ff49ff6b8c7ab42ab81390ce
**Status:** ✅ 6/6 webauthn-signed marketplace operations executed; NFT #1731 transferred to USER
**Block:** 7978269 · **Epoch:** 3.4 (Clarity 5)
**Signing pubkey:** `02eca875ad4e06371c75a1fb889f69b52c4900d7f4f4d17e2a059152213ba2d785` (P-256)
**Origin / rp.id:** `fak.fun`

## Subjects

* Wallet: `SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-v2`
* Marketplace: `SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.pepe-nft-marketplace`
* NFT: `SP16SRR777TVB1WS5XSS9QT3YEZEC9JQFKYZENRAJ.bitcoin-pepe` — token `#1731`
* PEPE FT (payment): `SP1Z92MPDQEWZXW36VX71Q25HKF5K2EPCJ304F275.tokensoft-token-v4k68639zxz`
* UNDO FT (for UPDATE-FT): `SPV9K21….undo-faktory`

## Auth-IDs

| Auth-ID | Topic | Args | Result |
|---|---|---|---|
| 0 | `faktory-nft-execute` | marketplace, token-id=1731, ft=PEPE, price=4_000_000_000, opcode=0x01 (BUY) | ✅ ok |
| 1 | `faktory-nft-execute` | marketplace, token-id=1731, ft=PEPE, price=3_500_000_000, opcode=0x00 (LIST) | ✅ ok |
| 2 | `faktory-nft-execute` | marketplace, token-id=1731, ft=PEPE, price=5_000_000_000, opcode=0x03 (UPDATE-PRICE) | ✅ ok |
| 3 | `faktory-nft-execute` | marketplace, token-id=1731, ft=UNDO, price=2_000_000_000_000, opcode=0x04 (UPDATE-FT) | ✅ ok |
| 4 | `faktory-nft-execute` | marketplace, token-id=1731, ft=PEPE, price=0, opcode=0x02 (UNLIST) | ✅ ok |
| 5 | `sip009-transfer` | nft-id=1731, recipient=USER, sip009=bitcoin-pepe | ✅ ok |

`nft-contract`, `nft-name`, and `ft-name` are **not** in the signed hash —
`build-faktory-nft-execute-hash` covers `auth-id`, `marketplace`, `token-id`,
`ft-contract`, `price`, and `opcode` only.

## Per-step results

| # | Phase | Operation | Sender | Expected | Got | ✓ |
|---|---|---|---|---|---|---|
| 0 | 1 | Deploy `clarity-webauthn` | DEPLOYER | ok | `(ok true)` | ✅ |
| 1 | 1 | Deploy `smart-wallet-standard-auth-helpers-v7` | DEPLOYER | ok | `(ok true)` | ✅ |
| 2 | 1 | `set-verified-contract fakfun-wallet-v2 hash` | DEPLOYER | ok | `(ok true)` | ✅ |
| 3 | 1 | Deploy `fakfun-wallet-v2` | DEPLOYER | ok | `(ok true)` | ✅ |
| 4 | 2 | `onboard pubkey` | FAKFUN_DEPLOYER | ok | `(ok true)` | ✅ |
| 5 | 2 | `nfts-core.whitelist-marketplace(pepe-mkt, true)` | DEPLOYER | ok | `(ok true)` | ✅ |
| 6 | 2 | marketplace `whitelist-ft(UNDO, true)` | DEPLOYER | ok | `(ok true)` | ✅ |
| 7 | 2 | PEPE `transfer 5B → wallet` | DEPLOYER | ok | `(ok true)` | ✅ |
| 8 | 2 | eval `(get-listing #1731)` (initial) | – | some {seller, price, ft, ...} | listing visible | ✅ |
| 9 | 3 | `faktory-nft-execute BUY @ 4B PEPE` auth-id 0 | DEPLOYER | ok | `(ok true)` | ✅ |
| 10 | 3 | eval `(get-owner #1731)` | – | some wallet | `(ok (some 06.fakfun-wallet-v2))` | ✅ |
| 11 | 4 | `faktory-nft-execute LIST @ 3.5B PEPE` auth-id 1 | DEPLOYER | ok | `(ok true)` | ✅ |
| 12 | 4 | eval `(get-listing #1731)` | – | seller=wallet, price=3.5B | listing visible | ✅ |
| 13 | 5 | `faktory-nft-execute UPDATE-PRICE → 5B` auth-id 2 | DEPLOYER | ok | `(ok true)` | ✅ |
| 14 | 5 | eval `(get-listing #1731)` | – | price=5_000_000_000 | listing visible | ✅ |
| 15 | 6 | `faktory-nft-execute UPDATE-FT → UNDO @ 2T` auth-id 3 | DEPLOYER | ok | `(ok true)` | ✅ |
| 16 | 6 | eval `(get-listing #1731)` | – | ft=undo-faktory, price=2T | listing visible | ✅ |
| 17 | 7 | `faktory-nft-execute UNLIST` auth-id 4 | DEPLOYER | ok | `(ok true)` | ✅ |
| 18 | 8 | `sip009-transfer → USER` auth-id 5 | DEPLOYER | ok | `(ok true)` | ✅ |
| 19 | – | eval `(get-owner #1731)` | – | USER | `(ok (some SP9875…))` | ✅ |
| 20 | – | eval `(get-listing #1731)` | – | none | `0x09` (none) | ✅ |
| 21 | – | eval `wallet.(get-owner)` | – | burn (no add-admin) | `(ok (some SP00…))` | ✅ |
| 22 | – | eval `fakfun-wallet-core.(is-whitelisted)` | – | true | `0x03` | ✅ |

## Auth-ID 0 starts the wallet

This sim does **not** call `add-admin-with-signature` before BUY. The
wallet's `onboard` step sets `pubkey-to-admin[PUBKEY] = SP000…burn`, and
the contract body sets `admins[SP000…burn] = true`, so the first signed
call is already authorized via `is-admin-pubkey`. The wallet is fully
usable after `onboard` alone, owned by the burn address until someone
runs `add-admin-with-signature` (not exercised by this sim — see
`simul-fakfun-v2-wallet` for that path).

The final state at step 21 confirms `get-owner` is still the burn address
because no add-admin transition happened. The signed operations all worked
because the pubkey was registered to (the burn-address-as-admin) via
`onboard`, satisfying `is-admin-pubkey`.

## Notable observations

* **Every webauthn signature verified on first try.** Six different topics
  (`faktory-nft-execute` × 5 opcodes + `sip009-transfer`) all consumed
  their signed hashes without producing `(err u4002)`.
* **`get-owner` returns the contract principal of the wallet after BUY**
  (step 10) — `06.fakfun-wallet-v2`. After `sip009-transfer` (step 18),
  ownership flips to `USER` (step 19 — `05` prefix = standard principal).
  Both transitions are correctly visible.
* **`is-whitelisted` on `fakfun-wallet-core` confirms self-registration
  during onboard.** The wallet successfully called
  `fakfun-wallet-core.register-wallet` (as-contract) — proof that the
  `set-verified-contract` hash registration earlier in the sim matched
  the actual wallet source's sha512/256.

## Sig-auth tuple format

Same as `simul-fakfun-v2-token-lock.md`. Variable-length
`client-data-suffix` (Chrome's optional `other_keys_can_be_added_here`
extension up to ~210 bytes) was observed in auth-id 2's signed payload —
the contract's `(buff 512)` cap absorbs it without truncation.
