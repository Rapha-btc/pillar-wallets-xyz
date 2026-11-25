(define-constant SIP018_MSG_PREFIX 0x534950303138)

(define-read-only (get-domain-hash)
  (sha256 (unwrap-panic (to-consensus-buff? {
    name: "smart-wallet-standard",
    version: "1.0.0",
    chain-id: chain-id,
    wallet: contract-caller,
  })))
)

(define-read-only (build-stake-stx-juice-pox5-hash (details {
  auth-id: uint,
  amount-ustx: uint,
  signer-calldata: (optional (buff 500)),
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "stake-stx-juice-pox5",
        auth-id: (get auth-id details),
        amount-ustx: (get amount-ustx details),
        signer-calldata: (get signer-calldata details),
      })))
    )))
)

(define-read-only (build-update-stake-stx-juice-hash (details {
  auth-id: uint,
  amount-increase: uint,
  cycles-to-extend: uint,
  signer-calldata: (optional (buff 500)),
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "update-stake-stx-juice",
        auth-id: (get auth-id details),
        amount-increase: (get amount-increase details),
        cycles-to-extend: (get cycles-to-extend details),
        signer-calldata: (get signer-calldata details),
      })))
    )))
)