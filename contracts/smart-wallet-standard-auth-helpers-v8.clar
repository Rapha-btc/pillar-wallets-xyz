
(define-constant SIP018_MSG_PREFIX 0x534950303138)

(define-read-only (get-domain-hash)
  (sha256 (unwrap-panic (to-consensus-buff? {
    name: "smart-wallet-standard",
    version: "1.0.0",
    chain-id: chain-id,
    wallet: contract-caller,
  })))
)


(define-read-only (build-sbtc-withdrawal-hash (details {
  auth-id: uint,
  amount: uint,
  recipient: { version: (buff 1), hashbytes: (buff 32) },
  max-fee: uint,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "sbtc-withdrawal",
        auth-id: (get auth-id details),
        amount: (get amount details),
        recipient: (get recipient details),
        max-fee: (get max-fee details),
      })))
    )))
)
