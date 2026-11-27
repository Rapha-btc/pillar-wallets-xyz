(define-constant SIP018_MSG_PREFIX 0x534950303138)

(define-read-only (get-domain-hash)
  (sha256 (unwrap-panic (to-consensus-buff? {
    name: "smart-wallet-standard",
    version: "1.0.0",
    chain-id: chain-id,
    wallet: contract-caller,
  })))
)

(define-read-only (build-set-wallet-config-hash (details {
  auth-id: uint,
  stx-threshold: uint,
  sbtc-threshold: uint,
  cooldown-period: uint,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "set-wallet-config",
        auth-id: (get auth-id details),
        stx-threshold: (get stx-threshold details),
        sbtc-threshold: (get sbtc-threshold details),
        cooldown-period: (get cooldown-period details),
      })))
    )))
)

(define-read-only (build-confirm-max-gas-amount-hash (details {
  auth-id: uint,
  amount: uint,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "confirm-max-gas-amount",
        auth-id: (get auth-id details),
        amount: (get amount details),
      })))
    )))
)
