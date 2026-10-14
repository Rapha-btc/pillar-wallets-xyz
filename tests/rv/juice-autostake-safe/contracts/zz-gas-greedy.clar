;; Test-only HOSTILE gas station: charges u5000 sats, over the default
;; max-gas-amount (u1000). The wallet's (with-ft sbtc max-gas-amount) allowance
;; must abort the call unless the owner raised max-gas to >= 5000.
(impl-trait 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.gas-station-trait.gas-station-trait)
(define-constant FEE u5000)
(define-private (charge)
  (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
    transfer FEE contract-caller current-contract none))
(define-public (get-gas-amount) (if true (ok FEE) (err u0)))
(define-public (pay-gas) (if true (charge) (err u0)))
(define-public (pay-gas-with-pyth) (if true (charge) (err u0)))
