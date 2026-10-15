(define-constant SIP018_MSG_PREFIX 0x534950303138)

(define-read-only (get-domain-hash)
  (sha256 (unwrap-panic (to-consensus-buff? {
    name: "smart-wallet-standard",
    version: "1.0.0",
    chain-id: chain-id,
    wallet: contract-caller,
  })))
)

(define-read-only (build-set-keeper-hash (details {
  auth-id: uint,
  keeper: principal,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "set-keeper",
        auth-id: (get auth-id details),
        keeper: (get keeper details),
      })))
    )))
)

