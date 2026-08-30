(define-constant SIP018_MSG_PREFIX 0x534950303138)

(define-read-only (get-domain-hash)
  (sha256 (unwrap-panic (to-consensus-buff? {
    name: "smart-wallet-standard",
    version: "1.0.0",
    chain-id: chain-id,
    wallet: contract-caller,
  })))
)

(define-read-only (build-smart-execute-hash (details {
  auth-id: uint,
  op: (buff 1),
  smart: principal,
  amount: uint,
  min-out: uint,
  fak-ratio: uint,
  flag: bool,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "smart-execute",
        auth-id: (get auth-id details),
        op: (get op details),
        smart: (get smart details),
        amount: (get amount details),
        min-out: (get min-out details),
        fak-ratio: (get fak-ratio details),
        flag: (get flag details),
      })))
    )))
)
