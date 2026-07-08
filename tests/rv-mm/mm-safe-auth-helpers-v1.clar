;; mm-safe-auth-helpers-v1
;;
;; Standalone SIP-018 hash builder for the jing-mm-safe "execute-now" action
;; (passkey 2FA lifts the pending-op withdrawal cooldown). Split out of the
;; wallet for the same reason as smart-wallet-standard-auth-helpers-v7: the
;; frontend calls the SAME read-only to build the challenge it asks the
;; passkey to sign, so wallet and client can never drift.
;;
;; Byte-compatible with the helpers-v7 scheme:
;;   sha256( SIP018_MSG_PREFIX || domain-hash || sha256(message-tuple) )
;; The domain tuple is IDENTICAL to helpers-v7's (name/version/chain-id and
;; wallet = contract-caller), so when jing-mm-safe calls this the signature
;; binds to that specific wallet -- no cross-wallet replay. auth-id gives
;; uniqueness; the wallet's consume-signature replay map blocks reuse.
;;
;; Deploy from account 0 (SPV9K21T...) BEFORE any jing-mm-safe references it.

(define-constant SIP018_MSG_PREFIX 0x534950303138)

(define-read-only (get-domain-hash)
  (sha256 (unwrap-panic (to-consensus-buff? {
    name: "smart-wallet-standard",
    version: "1.0.0",
    chain-id: chain-id,
    wallet: contract-caller,
  })))
)

(define-read-only (build-execute-now-hash (details {
  auth-id: uint,
  op-id: uint,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "execute-now",
        auth-id: (get auth-id details),
        op-id: (get op-id details),
      })))
    )))
)
