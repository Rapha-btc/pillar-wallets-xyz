;; deorgmedia-wallet-auth
;; SIP-018 structured-data hash builder(s) for deorgmedia-sw-v1 signed
;; authorizations. Shared singleton: deployed once, every wallet calls in,
;; so the builder bytecode is not duplicated per wallet.
;;
;; Critically, because this is a SEPARATE contract, `contract-caller` inside
;; `get-domain-hash` resolves to the *calling wallet* -- binding each signature
;; to that specific wallet and preventing cross-wallet replay. (An inline copy
;; inside the wallet would bind to whoever called the wallet, which is wrong.)
;;
;; Envelope:  sha256( SIP018_MSG_PREFIX || domain-hash || sha256(message-tuple) )
;; The domain matches smart-wallet-standard-auth-helpers-v7 so the wallet's
;; entire signed-message set shares one consistent, wallet-bound domain.

(define-constant SIP018_MSG_PREFIX 0x534950303138)

(define-read-only (get-domain-hash)
  (sha256 (unwrap-panic (to-consensus-buff? {
    name: "smart-wallet-standard",
    version: "1.0.0",
    chain-id: chain-id,
    wallet: contract-caller,
  })))
)

(define-read-only (build-inscribe-article-hash (details {
  auth-id: uint,
  expected-hash: (buff 32),
  total-size: uint,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "inscribe-article",
        auth-id: (get auth-id details),
        expected-hash: (get expected-hash details),
        total-size: (get total-size details),
      })))
    )))
)
