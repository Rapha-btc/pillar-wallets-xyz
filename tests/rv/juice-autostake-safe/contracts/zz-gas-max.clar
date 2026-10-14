;; Test-only gas station that charges exactly the default max-gas-amount (u1000).
;; 25 enforced calls fill the per-period gas fuse (max-gas * 25).
(impl-trait 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.gas-station-trait.gas-station-trait)
(define-constant FEE u1000)
(define-private (charge)
  (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
    transfer FEE contract-caller current-contract none))
(define-public (get-gas-amount) (if true (ok FEE) (err u0)))
(define-public (pay-gas) (if true (charge) (err u0)))
(define-public (pay-gas-with-pyth) (if true (charge) (err u0)))
