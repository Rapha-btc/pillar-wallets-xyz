# Pillar Smart Wallet — integration guide (x402-style)

**For:** builders integrating Pillar smart wallets, x402-style. **TL;DR:** keep your x402 machinery (collect a signature → facilitator broadcasts →
index anchoring → return proof). Two changes: **(1)** the signature is a **WebAuthn passkey** (secp256r1,
Face ID), not a Stacks-wallet signature; **(2)** it's fed as an **input** to an `extension-call` your
facilitator invokes, not a bare transfer. The wallet verifies the passkey on-chain and runs your
extension. You hold no keys and custody nothing.

Repo: https://github.com/Rapha-btc/pillar-wallets-xyz · Wallet: `contracts/fakfun-wallet-v2.clar` ·
Extensions: `contracts/fakfun-extensions/`

---

## x402 → Pillar

| x402 today | Pillar |
|---|---|
| Stacks-wallet sig (secp256k1) over a bare transfer | passkey sig (secp256r1, Face ID) fed as `sig-auth` into an `extension-call` |
| your facilitator broadcasts | your facilitator broadcasts — **unchanged** |
| index txid → proof | index txid → proof — **unchanged** |
| chain records only the transfer | your extension does **pay + record** atomically |

Only the **on-chain** side is Pillar: the wallet contract, WebAuthn verification
(`clarity-5-webauthn-v3`), and the gas mechanism. Broadcast + anchoring stay entirely yours — **you
don't need the Pillar SDK**.

Two ways to ship:
- **Use Pillar wallets** — a per-builder template with your extension + rpId baked in; deploy per user.
- **Fork** — copy `fakfun-wallet-v2.clar` and customize.

---

## Flow

1. **Deploy — nothing to whitelist.** The per-builder template bakes in your **default extension**
   (pre-whitelisted) and your **rpId** (e.g. `dataing.io`), so passkeys from your domain verify.
   (`whitelist-extension → execute-pending-whitelist` exists for adding *more* extensions later — see
   the security note.)
2. **Sign (frontend).** The passkey signs a WebAuthn assertion whose **challenge is the extension-call
   hash** = `build-extension-call-hash { auth-id, extension, payload }` (`auth-id` = nonce; `payload` =
   your `to-consensus-buff?` tuple). This replaces x402's transfer-authorization hash.
3. **Broadcast (your facilitator).** Call `extension-call <ext> <payload> <sig-auth> <gas>`. The wallet
   verifies the passkey, pays gas in sBTC, then runs your extension `as-contract` (so `tx-sender` = the
   wallet). Index the txid → proof.

---

## 1. `extension-call` (`fakfun-wallet-v2.clar:637`)

```clarity
(define-public (extension-call
    (extension <extension-trait>)
    (payload (buff 2048))
    (sig-auth (optional { auth-id, pubkey, signature,
                          authenticator-data, client-data-prefix, client-data-suffix }))
    (gas (optional <gas-trait>)))
  (begin
    (asserts! (is-extension-whitelisted (contract-of extension)) err-not-whitelisted)   ;; 1 gate
    (match sig-auth
      d (begin
        (try! (is-authorized (some {                                                     ;; 2 verify passkey
          message-hash: (contract-call? …auth-helpers-v7 build-extension-call-hash
                          { auth-id: …, extension: (contract-of extension), payload: payload }),
          pubkey: …, signature: …, authenticator-data: …,
          client-data-prefix: …, client-data-suffix: … })))
        (match gas g (try! (as-contract? ((with-ft SBTC-CONTRACT "sbtc-token" (var-get max-gas-amount)))
                             (contract-call? g pay-gas))) true))       ;; 3 pay gas in sBTC
      (try! (is-authorized none)))                                     ;; (admin EOA path, no sig)
    (contract-call? …fakfun-wallet-core log-extension-call (contract-of extension) payload)
    (as-contract? ((with-all-assets-unsafe))                          ;; 4 run YOUR logic as the wallet
      (contract-call? extension call payload))))
```

- The signature covers `{auth-id, extension, payload}` — the whole intent, not a bare transfer.
- `as-contract? ((with-all-assets-unsafe))` makes `tx-sender` = the buyer's wallet, so payment pulls
  from *their* wallet and the receipt records *them*.
- `sig-auth` present = passkey path (what you use). `none` = admin EOA calling directly.

## 2. Verifying the passkey — `clarity-5-webauthn-v3` (reuse as-is)

`is-authorized` → `consume-signature` → `verify-signature`:

```clarity
;; consume-signature (:1683) — verify + one-time replay guard
(try! (verify-signature message-hash pubkey signature …))
(asserts! (is-none (map-get? used-pubkey-authorizations message-hash)) err-signature-replay)
(map-set used-pubkey-authorizations message-hash pubkey)

;; verify-signature (:1645) — the WebAuthn check
(try! (is-admin-pubkey pubkey))                                    ;; registered admin passkey
(asserts! (or (is-eq auth-rp-id RP-ID-HASH-FAKFUN-COM)
              (is-eq auth-rp-id RP-ID-HASH-FAK-FUN)) …)            ;; rpId domain-bound
(asserts! (…clarity-5-webauthn-v3 is-user-verified authenticator-data) …)   ;; biometric happened
(…clarity-5-webauthn-v3 verify-webauthn-signature pubkey message-hash …)    ;; P-256 check
```

- **`verify-signature`** confirms: the passkey signed *this* `message-hash`, the pubkey is a registered
  admin key, the **rpId matches your domain** (no cross-site replay), and **user-verification**
  (biometric) happened.
- **`consume-signature`** adds a **one-time replay guard** keyed by `message-hash`.
- The **rpId is set at deploy** (your template bakes in `dataing.io`'s hash) — only your domain's
  passkeys pass.

## 3. `onboard` — the trust anchor (deployer's only privilege)

```clarity
(define-public (onboard (pubkey (buff 33)))
  (asserts! (is-eq tx-sender FAKFUN-DEPLOYER) err-unauthorised)   ;; deployer-gated
  (asserts! (not (var-get pubkey-initialized)) err-unauthorised)  ;; one-time
  (var-set initial-pubkey pubkey) (map-set pubkey-to-admin pubkey …)   ;; 1 bind passkey → ownership
  (as-contract? () (contract-call? …fakfun-wallet-core register-wallet …fakfun-wallet-v6)))  ;; 2 verify code == template
```

`onboard` is the **only** function the deployer can call after deployment, and only **once**. It
**(1)** binds the user's passkey as the wallet's admin key — from here only that passkey can move
funds, not the deployer; and **(2)** `register-wallet` checks the deployed source is **byte-identical
to a Pillar-verified template** (canonical hash in `fakfun-wallet-core`) — one altered byte and it's
never trusted. If you fork: register your own template (`set-verified-contract`) and check against it.

---

## How the signature is produced (frontend)

Made on the frontend; the client **never broadcasts or holds STX**. Ref:
`faktory-dao/frontend/src/utils/smart-wallet-auth-webauthn.ts`.

1. **Challenge** = the 32-byte extension-call hash (`build-extension-call-hash`, via `buildXHash`).
2. **`signWithPasskey`** → `navigator.credentials.get({ publicKey: { challenge, rpId, allowCredentials }})`
   → Face ID. The authenticator signs `sha256(authenticatorData ‖ sha256(clientDataJSON))` with the
   P-256 key (never leaves the enclave).
3. Post-process: DER → **raw 64-byte r‖s** (`derToRawSignature`); split `clientDataJSON` around
   `base64url(challenge)` into **prefix + suffix** (`splitClientDataJSON`) so the contract re-splices
   its own challenge; keep `authenticatorData` + 33-byte `pubkey`.
4. **`buildWebAuthnSigAuth`** → the tuple `{ authId, pubkey, signature, authenticatorData,
   clientDataPrefix, clientDataSuffix }`, mirroring the contract's `sig-auth`. POST to the facilitator.

**Facilitator** (ref `…/smart-wallet/v2/execute.post.ts`): **pre-checks** the passkey via the wallet's
read-only `verify-signature` (rejects bad sigs before broadcast → no wasted gas), then builds
`functionArgs = [ …params, <sig-auth>, (some gas-station) ]` and `broadcastTransaction`s it.

---

## Worked example — real gasless buy (mainnet)

A passkey-authorized **sBTC → PEPE buy**, gasless. Same sig-auth + gas pattern as `extension-call`;
here the fn is `faktory-execute` (a first-class buy) — auth mechanics are identical.

**Tx:** [`0x94be9a82…acfc2c7`](https://explorer.hiro.so/txid/0x94be9a82e2091d5e1d8cf4ceb5e9d06cd23c417090de345124697c604acfc2c7?chain=mainnet)
· wallet `SP28MP1…rafshitoshi-wallet` · **fee 0.003 STX paid by the facilitator, not the user**.

What the frontend handed the backend — action params + sig-auth:

```clarity
pool=…pepe-faktory-pool-v2-2  amount=u690 (sats)  opcode=(some 0x00)=buy  sip010=…sbtc-token
(some (tuple
  (auth-id u1779206009706)               ;; nonce (replay-guarded on-chain)
  (pubkey  0x0280d7fd…5bb56f)            ;; 33-byte P-256 admin passkey
  (signature 0x262b8c51…38dd272)         ;; 64-byte r‖s
  (authenticator-data 0xb877fea5…f2249 1d 00000000)
  (client-data-prefix 0x7b2274797065…)   ;; {"type":"webauthn.get","challenge":"
  (client-data-suffix 0x222c226f…)))     ;; ","origin":"https://fak.fun","crossOrigin":false}
gas = (some …gas-station)
```

- `authenticator-data` = `rpIdHash(32) ‖ flags ‖ counter`: `rpIdHash` **= the `RP-ID-HASH-FAK-FUN`
  constant** (domain-bound); `flags 0x1d` = user-verified (biometric).
- The contract rebuilds `clientDataJSON` by splicing **its own** `base64url(hash)` between prefix and
  suffix, so the client can't lie about what was signed.
- On-chain check: `sha256(authenticatorData ‖ sha256(clientDataJSON))` verified against `pubkey`.

The facilitator broadcast it (paid 0.003 STX), then `gas-station` moved **~20 sats sBTC** from the
wallet to cover the fee. **User spent only sBTC, never STX, never touched a seed.** Your version:
`extension-call(<your-ext>, payload, sig-auth, (some gas-station))`.

---

## Gasless (BTC-only wallet)

x402 today: user pays an STX fee *first*, then signs — needs STX. Pillar: the fee is **bundled into the
signed call** via the `gas` param, paid in **sBTC**. The wallet holds sBTC, never STX.

- `extension-call` takes `(gas (optional <gas-trait>))`; present → `as-contract → (contract-call? g
  pay-gas)` pulling ≤ `max-gas-amount` sBTC.
- Example: **`SPV9K21…gas-station`** — pays the facilitator ~**20 sats** to cover ~**0.003 STX**.
- The facilitator pre-checks the passkey off-chain, so a bad sig never burns the fee.

To keep users on **BTC only**, just define a gas contract like `gas-station`.

---

## Template — the two `dataing` extensions

- **`dataing-pay-extension.clar`** — `impl-trait extension-trait`, one `call (payload)` fn:
  `from-consensus-buff?` the payload → forward to the receipts contract.
- **`dataing-market-receipts.clar`** — thin, non-custodial: **pays the supplier + records the receipt
  atomically**, keyed on `purchase-id`. No payment → no receipt, so proof can't be forged.

**`call` is safe open:** called directly (not via a wallet's `as-contract`), `tx-sender` is the caller,
so they spend only their *own* balance.

**The gated action is whitelisting, not `call`.** A whitelisted extension runs
`as-contract ((with-all-assets-unsafe))` — full wallet access — so an **unvetted** one could drain it.
That's why adding an extension needs **2FA (passkey) + a cooldown/veto window**:
`whitelist-extension` only *proposes* (pending op with `execute-after`); `execute-pending-whitelist`
needs the passkey **and** the cooldown to elapse, and can be **vetoed** in between.

**Your move:** write your own extension (your payload + `call` body), deploy, done. Your x402 SDK
handles the rest.

---

## Reference

- Wallet `contracts/fakfun-wallet-v2.clar`: `extension-call` (:637), `is-authorized` (:416),
  `verify-signature` (:1645), `consume-signature` (:1683), `onboard` (:2226)
- Extensions: `contracts/fakfun-extensions/dataing-pay-extension.clar`, `dataing-market-receipts.clar`
- WebAuthn lib: `SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.clarity-5-webauthn-v3`
- Hash builder: `…smart-wallet-standard-auth-helpers-v7.build-extension-call-hash`
- Gas: `SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.gas-station`
- Frontend: `faktory-dao/frontend/src/utils/smart-wallet-auth-webauthn.ts` · Facilitator:
  `…/backend/server/routes/api/smart-wallet/v2/execute.post.ts`
