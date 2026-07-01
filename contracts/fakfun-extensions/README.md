# Pillar Smart Wallet — integration guide (x402-style)

**For:** builders integrating Pillar smart wallets, x402-style. **TL;DR:** you already have the x402 machinery (client signs → facilitator
broadcasts → watch anchoring → return proof). To use Pillar, change *what the client signs and
hands over*: instead of a **normal Stacks-wallet signature** over a bare `stx-transfer` /
`sbtc-transfer` / `usdcx-transfer`, the frontend produces a **WebAuthn passkey signature** (Face ID)
over an **`extension-call`** and hands that **sig-auth** to your facilitator, which makes the on-chain
call (params + sig-auth + a gas contract to pay itself). The wallet verifies the signature on-chain.
Your relay / broadcast / anchor plumbing stays.

Repo: https://github.com/Rapha-btc/pillar-wallets-xyz
Wallet: `contracts/fakfun-wallet-v2.clar` · Extensions: `contracts/fakfun-extensions/`

---

## The one substitution

| x402 today | Pillar |
|---|---|
| client signs a bare token-transfer authorization — a **normal Stacks wallet signature (secp256k1**, Leather/Xverse) | client's passkey signs the **`extension-call` hash** (auth-id + extension + payload) — a **WebAuthn signature (secp256r1**, Face ID); that signature is an **input** to the `extension-call` the facilitator invokes, verified on-chain |
| facilitator broadcasts the transfer | **your facilitator** broadcasts the signed `extension-call` (gasless) — same role, Pillar not in the loop |
| returned txid = payment proof; you index anchoring | returned txid = payment proof; **you index anchoring the same way** |
| money moves, chain has no record of *what* was bought | the extension does **pay + record** atomically |

**Who broadcasts is your call.** If *your* facilitator broadcasts the signed op, the broadcast +
anchoring-index path is 100% yours — no Pillar involved at runtime; Pillar is only the on-chain wallet
contract + WebAuthn verification + gas mechanism. (The Pillar relay is just one optional broadcaster
you could point at instead.)

So it's two shifts, not one: **(a) the signature scheme** — a WebAuthn/passkey (secp256r1) signature
that the wallet verifies on-chain via `clarity-5-webauthn-v3`, instead of a standard Stacks-wallet
(secp256k1) signature; and **(b) what's signed** — an `extension-call` intent instead of a bare
transfer. Your relay/broadcast/anchor plumbing is unchanged.

The wallet verifies the passkey (WebAuthn) signature on-chain, pays its own gas, then runs your
extension's logic as the wallet itself. **You don't custody anything and you don't touch the user's
keys** — the enclave signs, the relay broadcasts.

You **don't need the Pillar SDK**: broadcasting the signed op, watching the anchor, and returning
success is exactly what your x402 SDK already does. The only new piece is *what* gets signed (the
extension-call hash) and *deploying an extension contract* with your logic.

Two paths:
- **Leverage Pillar wallets** — get a per-builder template with your extension + rpId baked in;
  deploy per user, done.
- **Fork the wallet** — copy `fakfun-wallet-v2.clar` and customize freely.

---

## The flow (3 steps)

1. **Baked in at deploy — nothing to whitelist manually.** Your wallet template is a **per-builder
   template** (the factory swaps 3 spots: **rpId hash**, **default extension**, canonical name). So on
   deployment your extension (e.g. `dataing-pay-extension`) is **whitelisted by default**, and your
   **rpId (e.g. `dataing.io`) is added** so passkeys created on *your* domain verify on-chain. No
   post-deploy whitelist step for your main extension. (The passkey-signed
   `whitelist-extension → execute-pending-whitelist` flow still exists for adding *further* extensions
   to a live wallet.)
2. **Client's passkey signs the extension-call *hash*** (it does not call anything). The signed
   message is
   `build-extension-call-hash { auth-id, extension, payload }`
   (from `…smart-wallet-standard-auth-helpers-v7`). `auth-id` is the nonce; `payload` is your
   `to-consensus-buff?` tuple (amount, recipient, ids, memo…). **This hash replaces x402's
   transfer-authorization hash** — compute it the same way client-side so the passkey signs it.
3. **Your facilitator broadcasts** `extension-call <ext> <payload> <sig-auth> <gas>`. On-chain the
   wallet verifies the passkey, pays gas in sBTC, then calls your extension `as-contract` (so
   `tx-sender` is the wallet). You **index the txid for successful anchoring** — same as x402 today,
   no Pillar in the loop — and return it to your API as proof.

---

## Highlight 1 — the extension-call (`fakfun-wallet-v2.clar:637`)

```clarity
(define-public (extension-call
    (extension <extension-trait>)
    (payload (buff 2048))
    (sig-auth (optional { auth-id, pubkey, signature,
                          authenticator-data, client-data-prefix, client-data-suffix }))
    (gas (optional <gas-trait>)))
  (begin
    (update-activity)
    (asserts! (is-extension-whitelisted (contract-of extension)) err-not-whitelisted)  ;; 1
    (match sig-auth
      sig-auth-details (begin
        (asserts! (not (var-get token-lock-enabled)) err-token-locked)
        (try! (is-authorized (some {                                                    ;; 2 verify passkey
          message-hash: (contract-call? …smart-wallet-standard-auth-helpers-v7
                          build-extension-call-hash
                          { auth-id: …, extension: (contract-of extension), payload: payload }),
          pubkey: …, signature: …, authenticator-data: …,
          client-data-prefix: …, client-data-suffix: … })))
        (match gas g (try! (as-contract?                                                ;; 3 pay gas in sBTC
            ((with-ft SBTC-CONTRACT "sbtc-token" (var-get max-gas-amount)))
            (try! (contract-call? g pay-gas)))
          true))
      (try! (is-authorized none)))                                                      ;; admin path (direct call)
    (try! (ft-mint? ect u1 current-contract)) (try! (ft-burn? ect u1 current-contract)) ;; event marker
    (try! (contract-call? …fakfun-wallet-core log-extension-call (contract-of extension) payload))
    (as-contract? ((with-all-assets-unsafe))                                            ;; 4 run YOUR logic as the wallet
      (try! (contract-call? extension call payload)))))
```

Key points for you:
- The signature covers **`{auth-id, extension, payload}`** — the whole intent, not a bare transfer.
- `as-contract? ((with-all-assets-unsafe))` makes `tx-sender` = the buyer's wallet through your
  extension, so payment is pulled from *their* wallet and the receipt records *them*.
- Two auth modes via `sig-auth`: **`(some …)`** = passkey path (gasless, relayed — what you use);
  **`none`** = the admin EOA calling directly.

---

## Highlight 2 — verifying the WebAuthn signature

Reusable library (built with Friedger — you can reuse it as-is):
**`SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.clarity-5-webauthn-v3`**

`is-authorized` → `consume-signature` → `verify-signature`:

```clarity
;; is-authorized (:416) — passkey path if a sig is present, else admin EOA
(define-private (is-authorized (sig (optional {…})))
  (match sig d (consume-signature (get message-hash d) (get pubkey d) …)
             (is-admin-calling tx-sender)))

;; consume-signature (:1683) — verify + REPLAY GUARD
(define-private (consume-signature (message-hash …) (pubkey …) (signature …) …)
  (begin
    (try! (verify-signature message-hash pubkey signature …))
    (asserts! (is-none (map-get? used-pubkey-authorizations message-hash)) err-signature-replay)
    (map-set used-pubkey-authorizations message-hash pubkey)   ;; each signature usable once
    (ok true)))

;; verify-signature (:1645) — the actual WebAuthn check
(define-read-only (verify-signature (message-hash …) (pubkey …) (signature …)
                                    (authenticator-data …) (client-data-prefix …) (client-data-suffix …))
  (let ((auth-rp-id (unwrap! (contract-call? …clarity-5-webauthn-v3 get-rp-id-hash authenticator-data) …)))
    (try! (is-admin-pubkey pubkey))                                     ;; pubkey must be a registered admin passkey
    (asserts! (or (is-eq auth-rp-id RP-ID-HASH-FAKFUN-COM)
                  (is-eq auth-rp-id RP-ID-HASH-FAK-FUN)) err-invalid-signature) ;; rpId is domain-bound
    (asserts! (contract-call? …clarity-5-webauthn-v3 is-user-verified authenticator-data) …) ;; UV flag
    (ok (asserts! (contract-call? …clarity-5-webauthn-v3
           verify-webauthn-signature pubkey message-hash authenticator-data
           client-data-prefix client-data-suffix signature) err-invalid-signature))))
```

What matters for you:
- **`verify-signature`** = the on-chain secp256r1/WebAuthn check. It confirms the passkey signed
  *this exact* `message-hash`, that the pubkey is a registered admin key, that the **rpId** matches
  your domain (so a signature from another site can't be replayed), and that **user-verification**
  (biometric) happened.
- **`consume-signature`** wraps it with a **one-time-use replay guard** (`used-pubkey-authorizations`
  keyed by `message-hash`) — a signed op can never be re-broadcast.
- The **rpId is domain-bound and set at deploy** — your template bakes in `dataing.io`'s hash (the
  `RP-ID-HASH-*` constants), so only passkeys created on your domain pass. A signature from any other
  site can't be replayed against your wallets. Keep the `clarity-5-webauthn-v3` library as-is.

---

## Highlight 3 — `onboard`: the trust anchor (deployer's only privilege)

After a wallet is deployed, **`onboard` is the ONE function the deployer has any privilege on** — and
it can only run **once**. It does two things, then the deployer is out forever:

```clarity
(define-public (onboard (pubkey (buff 33)))
  (begin
    (asserts! (is-eq tx-sender FAKFUN-DEPLOYER) err-unauthorised)      ;; deployer-gated
    (asserts! (not (var-get pubkey-initialized)) err-unauthorised)      ;; one-time
    (var-set initial-pubkey pubkey)                                     ;; 1. BIND the user's passkey
    (map-set pubkey-to-admin pubkey …)                                  ;;    → wallet ownership
    (var-set pubkey-initialized true)
    (try! (as-contract? ()
      (contract-call? …fakfun-wallet-core register-wallet …fakfun-wallet-v6))) ;; 2. VERIFY code == template
    (contract-call? …fakfun-wallet-core log-wallet-initialized pubkey)))
```

1. **Binds the user's passkey to ownership** — `pubkey` becomes the wallet's admin key. From here on,
   only that passkey (via the WebAuthn path above) can move funds. The deployer cannot.
2. **Verifies the wallet is genuine** — `register-wallet` checks the deployed contract's source is
   **byte-identical to a template verified by the authority (Pillar)** (canonical hash check in
   `fakfun-wallet-core`). If a single byte was altered, registration fails and the wallet is never
   trusted. This is what lets a user trust a wallet the deployer deployed for them: the code is
   provably the audited template, and ownership is provably their passkey.

So the deployer's power is exactly: *deploy the verified template + bind your passkey once* — nothing
more. **If you fork:** register your own verified template (`set-verified-contract` in your core),
and your `onboard` binds the passkey + checks against *your* template hash.

---

## How the signature is produced & handed off — fakfun frontend reference

The passkey signature is made **on the frontend**; the wallet contract only *verifies* it. The client
**never broadcasts** and **never holds STX** — it hands a sig-auth tuple to the facilitator.
Reference: `faktory-dao/frontend/src/utils/smart-wallet-auth-webauthn.ts`.

1. **Build the challenge** = the exact 32-byte message-hash the contract will rebuild — for an
   extension-call that's `build-extension-call-hash { auth-id, extension, payload }` (via `buildXHash`
   in `smart-wallet-auth.ts`). The passkey must sign *this* or on-chain verify fails.
2. **`signWithPasskey({ credentialId, challenge, rpId })`** →
   `navigator.credentials.get({ publicKey: { challenge, rpId, allowCredentials: [{ id: credentialId }],
   userVerification } })` → **Face ID / Touch ID prompt**. The authenticator signs
   `sha256(authenticatorData ‖ sha256(clientDataJSON))` with the P-256 key that never leaves the enclave.
3. **Post-process the assertion** into contract-ready pieces:
   - DER signature → **raw 64-byte r‖s** (`derToRawSignature`).
   - Split `clientDataJSON` around the base64url(challenge) into **`clientDataPrefix` + `clientDataSuffix`**
     (`splitClientDataJSON`) — the contract splices its *own* base64url(challenge) back in, so the
     client can't lie about what was signed.
   - keep `authenticatorData`, and the 33-byte compressed P-256 `pubkey` (from registration).
4. **`buildWebAuthnSigAuth(...)`** returns the tuple mirroring the contract's `(some { … })`:
   `{ authId, pubkey, signature, authenticatorData, clientDataPrefix, clientDataSuffix }`.
5. **Hand it to the facilitator** (a POST). The client's job ends here.

**Facilitator (backend) then makes the call** — ref
`faktory-dao/backend/server/routes/api/smart-wallet/v2/execute.post.ts`:
- **Pre-check:** recompute the message-hash and call the wallet's **read-only `verify-signature`**
  off-chain; reject a bad passkey (422) *before* broadcasting, so a bad sig never burns the
  gas-station fee.
- Build `functionArgs = [ …params, <sig-auth tuple>, (some gas-station) ]` — note the **gas contract**
  passed so the facilitator pays itself — then `makeContractCall` + `broadcastTransaction`
  (facilitator-sponsored). Return the txid.

**In one line:** frontend signs (Face ID) → hands over the sig-auth → facilitator calls
`extension-call` with *params + sig-auth + gas* → wallet verifies on-chain and runs your extension.

---

## Worked example — a real gasless buy on mainnet

A live tx: a passkey-authorized **sBTC → PEPE buy** from a smart wallet, gasless. Same sig-auth + gas
pattern as `extension-call` — here the wallet function is `faktory-execute` (a first-class buy) instead
of a custom extension; the auth mechanics are identical.

**Tx:** [`0x94be9a82…acfc2c7`](https://explorer.hiro.so/txid/0x94be9a82e2091d5e1d8cf4ceb5e9d06cd23c417090de345124697c604acfc2c7?chain=mainnet)
· wallet `SP28MP1…rafshitoshi-wallet` · fn `faktory-execute` · **fee 0.003 STX** (paid by the
facilitator, **not** the user).

**What the frontend built and handed to the backend** — the action params + the sig-auth tuple:

```clarity
;; action params (what to do)
pool        = SPV9K21….pepe-faktory-pool-v2-2
amount      = u690            ;; 690 sats sBTC
opcode      = (some 0x00)     ;; 0x00 = buy
sip010      = …sbtc-token
sip010-name = "sbtc-token"

;; sig-auth (the passkey proof, produced by buildWebAuthnSigAuth)
(some (tuple
  (auth-id            u1779206009706)   ;; nonce (one-time; replay-guarded on-chain)
  (pubkey             0x0280d7fd…5bb56f) ;; 33-byte compressed P-256 (the wallet's admin passkey)
  (signature          0x262b8c51…38dd272);; 64-byte raw r‖s (DER→raw on the frontend)
  (authenticator-data 0xb877fea5…f2249 1d 00000000)
  (client-data-prefix 0x7b2274797065…)
  (client-data-suffix 0x222c226f726967696e…)))
gas = (some SPV9K21….gas-station)       ;; the facilitator's reimbursement contract
```

**Decoding the passkey pieces (this is what `verify-signature` checks on-chain):**

- `authenticator-data` = `rpIdHash(32) ‖ flags(1) ‖ counter(4)`:
  - `rpIdHash = b877fea5…f2249` → **exactly the `RP-ID-HASH-FAK-FUN` constant** in the wallet. Domain-bound: a signature from any other origin fails.
  - `flags = 0x1d` → user-present + **user-verified** (biometric happened).
- `client-data-prefix` decodes to `{"type":"webauthn.get","challenge":"`
  `client-data-suffix` decodes to `","origin":"https://fak.fun","crossOrigin":false}`
  The contract rebuilds the full `clientDataJSON` by splicing **its own** `base64url(message-hash)`
  between them — so the client can't lie about *what* was signed. `message-hash` here =
  the faktory-execute hash (for you it'd be `build-extension-call-hash`).
- On-chain, `clarity-5-webauthn-v3` checks: `sha256(authenticatorData ‖ sha256(rebuilt clientDataJSON))`
  was signed by `pubkey` → the P-256 verification.

**What the facilitator did:** took that tuple, built
`faktory-execute(pool, amount, opcode, sip010, sip010-name, sig-auth, (some gas-station))`, and
**broadcast it** (facilitator is the tx-sender, pays the 0.003 STX fee). The wallet verified the
passkey, then `gas-station` moved **~20 sats sBTC** from the wallet to the platform to cover the fee —
so the **user spent only sBTC, never STX**, and never signed a Stacks tx or touched a seed phrase.

For **your** integration: identical, but the facilitator calls `extension-call(<your-ext>, payload,
sig-auth, (some gas-station))` and the signed `message-hash` is your `build-extension-call-hash`.

---

## Gasless model (the user needs no STX — BTC-only wallet)

**vs x402 today:** in your current flow the user pays a small **STX network fee first**, *then* signs
the transfer and hands over the signature — two actions, and they must hold STX. In Pillar there's no
separate fee step: **the fee is bundled into the same signed contract call** via the `gas` param and
paid in **sBTC**. One action, and the user never touches STX. If you want to preserve a **BTC-only
wallet** — users only ever interact with the BTC they deposited into their SW (held as sBTC) — this
is how. You just **define a gas contract like `gas-station`**.

The wallet holds **sBTC**, not STX. The facilitator fronts the ~0.003 STX network fee and is
reimbursed in sBTC from the wallet, capped by `max-gas-amount`:

- `extension-call` takes a `(gas (optional <gas-trait>))`; when present it does
  `as-contract → (contract-call? g pay-gas)` pulling up to `max-gas-amount` sBTC.
- Example gas contract: **`SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.gas-station`** — pays the
  facilitator ~**20 sats** to cover ~**0.003 STX**.
- The facilitator **pre-checks the passkey off-chain** (recompute the hash → call the wallet's
  read-only `verify-signature`) and rejects a bad sig *before* broadcasting, so it never eats a failed
  fee on `err-invalid-signature`. This is the piece that lets the user transact with zero STX.

---

## Template to copy — the two `dataing` extensions

The cleanest example of "replace a bare transfer with pay + verifiable receipt":

- **`dataing-pay-extension.clar`** — the wallet-facing extension. `impl-trait extension-trait`,
  one `call (payload (buff 2048))` fn: `from-consensus-buff?` the payload, forward to the receipts
  contract. Comment in it literally says:
  > *"This is the step that replaces x402's 'sign a bare transfer, facilitator broadcasts': the
  > Pillar relay broadcasts the passkey-signed extension-call (gasless), and the returned txid is
  > the x402 payment proof handed back to the API."*
- **`dataing-market-receipts.clar`** — thin, non-custodial: **pays the supplier directly and records
  the receipt atomically**, keyed on `purchase-id` (dedupe). A receipt can't exist unless the payment
  moved in the same tx → proof can't be forged. Works whether called by a Pillar wallet (tx-sender =
  wallet) *or* directly by an x402 facilitator/EOA.

**Security note (from the code):** `call` is intentionally open. Called directly (not via a wallet's
`as-contract`), `tx-sender` is the direct caller, so they can only spend *their own* balance — no
other wallet's funds are reachable. The passkey signature covers the entire payload, authorizing
exactly that one payment.

**Where the real power (and risk) is — whitelisting, not `call`.** `extension-call` runs a whitelisted
extension `as-contract ((with-all-assets-unsafe))` — i.e. with access to the wallet's *entire*
balance, so an **unvetted** extension could drain it. That's exactly why the sensitive action is
**adding an extension**, and it's deliberately the hardest thing to do: it requires **2FA (a passkey
signature) *and* a cooldown/timelock with a veto window** — the window to catch anything not properly
vetted before it can ever run.
`whitelist-extension` only *proposes* it (creates a pending op with an `execute-after` burn height);
`execute-pending-whitelist` then needs the **passkey signature** *and* the **cooldown to elapse**, and
can be **vetoed** in between. A user can never be tricked into instantly whitelisting a malicious
extension — the open `call` is harmless on its own; granting all-assets access is 2FA + time-locked.

For Toony: write your own extension in place of `dataing-pay-extension` (your payload, your
`call` body), deploy it, whitelist it. Your x402 SDK handles the rest.

---

## Reference

- Wallet: `contracts/fakfun-wallet-v2.clar` — `extension-call` (:637), `is-authorized` (:416),
  `verify-signature` (:1645), `consume-signature` (:1683)
- Extensions: `contracts/fakfun-extensions/dataing-pay-extension.clar`,
  `dataing-market-receipts.clar`
- WebAuthn lib (reuse): `SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.clarity-5-webauthn-v3`
- Hash builder: `…smart-wallet-standard-auth-helpers-v7.build-extension-call-hash`
- Gas example: `SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.gas-station`
