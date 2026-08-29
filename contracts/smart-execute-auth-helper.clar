;; smart-execute-auth-helper
;; v7 plus build-smart-execute-hash, the challenge the v18 wallet's four
;; smart-* trading entries verify. Only the new builder lives here; the v18
;; wallet keeps calling v7 for every inherited hash (extension-call,
;; faktory-execute, ...). Domain is byte-identical to v7 so a wallet can use
;; both. contract-caller in get-domain-hash is the WALLET, exactly as v7.

(define-constant SIP018_MSG_PREFIX 0x534950303138)

(define-read-only (get-domain-hash)
  (sha256 (unwrap-panic (to-consensus-buff? {
    name: "smart-wallet-standard",
    version: "1.0.0",
    chain-id: chain-id,
    wallet: contract-caller,
  })))
)

;; op is a 1-byte tag: 0x00 buy-sbtc, 0x01 buy-stx, 0x02 sell-sbtc,
;; 0x03 sell-stx. Binding it keeps a signature for one direction from
;; replaying as another.
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
