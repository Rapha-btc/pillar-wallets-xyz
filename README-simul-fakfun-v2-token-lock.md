# simul-fakfun-v2-token-lock — Token Lock E2E (webauthn)

Stxer mainnet-fork simulation of `fakfun-wallet-v2`'s `toggle-token-lock`
asymmetric auth flow with WebAuthn passkeys (secp256r1). Mirrors
`faktory-dao/contracts/fakfun-core/simul-fakfun-v3-token-lock.js` (privy/secp256k1).

**Latest run:** https://stxer.xyz/simulations/mainnet/29cbbb44b7b4cf3332bbefca3c63086f
**Status:** ✅ 9/9 phases pass; all webauthn signatures verify on-chain
**Block:** 7978237 · **Epoch:** 3.4 (Clarity 5)
**Wallet hash:** `4869dd8de59e3a0eae809786a2da433e279bcdb1605c6cba3e43c06204400bfb`
**Signing pubkey:** `02eca875ad4e06371c75a1fb889f69b52c4900d7f4f4d17e2a059152213ba2d785` (P-256)
**Origin / rp.id:** `fak.fun`

## What it proves

* `toggle-token-lock` accepts **signature OR admin** when `enabled=true`.
* `toggle-token-lock` **requires admin** when `enabled=false` (locking off
  is a strictly higher-trust action than locking on).
* When the lock is on, `stx-transfer` / `sip010-transfer` / `sip009-transfer`
  all `(err u4023)` in the **signed** branch, but **admin-tx-sender**
  transfers still succeed (admins must always retain a kill-switch).
* The locked-branch assert fires **before** signature verification, so the
  auth-id is **not consumed** — sig fixtures can be reused later.

## Auth-IDs

| Auth-ID | Topic | Args | Result |
|---|---|---|---|
| 0 | `add-admin` | new-admin=USER | ✅ ok |
| 1 | `toggle-token-lock` | enabled=true | ✅ ok |
| 2 | `sip010-transfer` | amount=50_000, recipient=USER, memo=none, sip010=sBTC | ✅ ok |

(Auth-IDs 10/11/12 are dummy webauthn payloads used in Phase 3 — the lock
assert fires before signature verification, so values are never checked.)

## Per-step results

| # | Phase | Operation | Sender | Expected | Got | ✓ |
|---|---|---|---|---|---|---|
| 0 | 1 | Deploy `clarity-webauthn` | DEPLOYER | ok | `(ok true)` | ✅ |
| 1 | 1 | Deploy `smart-wallet-standard-auth-helpers-v7` | DEPLOYER | ok | `(ok true)` | ✅ |
| 2 | 1 | `set-verified-contract fakfun-wallet-v2 hash` | DEPLOYER | ok | `(ok true)` | ✅ |
| 3 | 1 | Deploy `fakfun-wallet-v2` | DEPLOYER | ok | `(ok true)` | ✅ |
| 4 | 1 | `onboard pubkey` | FAKFUN_DEPLOYER | ok | `(ok true)` | ✅ |
| 5 | 1 | `add-admin-with-signature(USER)` auth-id 0 | USER | ok | `(ok true)` | ✅ |
| 6 | 1 | sBTC `transfer` 200_000 → wallet | USER | ok | `(ok true)` | ✅ |
| 7 | 1 | eval `(get-token-lock-enabled)` | – | false | `0x04` (false) | ✅ |
| 8 | 2 | `toggle-token-lock(true, sig)` auth-id 1 | DEPLOYER | ok | `(ok true)` | ✅ |
| 9 | 2 | eval `(get-token-lock-enabled)` | – | true | `0x03` (true) | ✅ |
| 10 | 3 | `sip010-transfer` w/ dummy sig (locked) | DEPLOYER | err u4023 | `(err u4023)` | ✅ |
| 11 | 3 | `sip009-transfer` w/ dummy sig (locked) | DEPLOYER | err u4023 | `(err u4023)` | ✅ |
| 12 | 3 | `stx-transfer` w/ dummy sig (locked) | DEPLOYER | err u4023 | `(err u4023)` | ✅ |
| 13 | 4 | `sip010-transfer` admin path (locked) | USER | ok | `(ok true)` | ✅ |
| 14 | 5 | `toggle-token-lock(false, none)` admin | USER | ok | `(ok true)` | ✅ |
| 15 | 5 | eval `(get-token-lock-enabled)` | – | false | `0x04` | ✅ |
| 16 | 6 | sBTC re-fund 100_000 → wallet | USER | ok | `(ok true)` | ✅ |
| 17 | 6 | `sip010-transfer` w/ sig auth-id 2 (unlocked) | DEPLOYER | ok | `(ok true)` | ✅ |
| 18 | 7 | `toggle-token-lock(true, none)` admin | USER | ok | `(ok true)` | ✅ |
| 19 | 7 | eval `(get-token-lock-enabled)` | – | true | `0x03` | ✅ |
| 20 | 8 | `toggle-token-lock(false, none)` from non-admin | DEPLOYER | err u4001 | `(err u4001)` | ✅ |
| 21 | 8 | eval `(get-token-lock-enabled)` | – | still true | `0x03` | ✅ |
| 22 | 9 | `toggle-token-lock(false, none)` admin | USER | ok | `(ok true)` | ✅ |
| 23 | 9 | eval `(get-token-lock-enabled)` | – | false | `0x04` | ✅ |
| 24 | – | eval `(get-owner)` | – | USER | `(ok (some SP9875…))` | ✅ |
| 25 | – | eval `fakfun-wallet-core.(is-whitelisted)` | – | true | `0x03` | ✅ |

After Phase 1's `add-admin-with-signature`, ownership transferred from
`SP000…burn` to USER. DEPLOYER is no longer an admin — that's why Phase 8
correctly fails with u4001.

## Notable observations

* **WebAuthn auth path validated end-to-end.** Every signed call
  (`add-admin-with-signature`, `toggle-token-lock(true, sig)`,
  `sip010-transfer(sig)`) returned `(ok …)`. Clarity 5's `secp256r1-verify`
  consumed all three webauthn proofs without complaint.
* **Variable-length `clientDataSuffix` works.** Chrome occasionally injects
  the anti-template-comparison string (`other_keys_can_be_added_here: …`)
  into clientDataJSON. The contract's `(buff 512)` cap is sufficient — none
  of the suffixes captured here exceeded ~210 bytes.
* **rp.id matching is permissive.** This run signed from `fak.fun`; the
  wallet accepts both `fakfun.com` and `fak.fun` rp.id hashes (line 1279
  in `fakfun-wallet-v2.clar`).

## Sig-auth tuple format reminder

```
{
  auth-id: uint,
  pubkey: (buff 33),                    ;; compressed secp256r1
  signature: (buff 64),                 ;; raw r || s, low-s normalized by browser
  authenticator-data: (buff 256),       ;; full authData incl. rp.id hash + flags
  client-data-prefix: (buff 128),       ;; clientDataJSON up to b64(challenge)
  client-data-suffix: (buff 512),       ;; clientDataJSON after b64(challenge)
}
```

The 32-byte `message-hash` is built off-chain via
`smart-wallet-standard-auth-helpers-v7.build-toggle-token-lock-hash` (or the
matching builder for the topic) and embedded in clientDataJSON as the
WebAuthn challenge during signing.
