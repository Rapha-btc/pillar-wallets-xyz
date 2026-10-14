;; Test-only gas station. Charges a fixed fee so the wallet's gas channel can be
;; driven on every site that accepts one. Note the (if true (ok ..) (err ..)) form:
;; a bare (ok ..) leaves the err type indeterminate and the wallet's try! over it
;; cannot resolve at Clarity 6 -- the same fault that aborted the v3/v12 deploys.
(impl-trait 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.gas-station-trait.gas-station-trait)

(define-constant FEE u20)
(define-data-var collected uint u0)

(define-read-only (get-collected) (var-get collected))

(define-private (charge)
  (let ((payer contract-caller))
    (var-set collected (+ (var-get collected) FEE))
    (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
      transfer FEE payer current-contract none)))

(define-public (get-gas-amount) (if true (ok FEE) (err u0)))
(define-public (pay-gas) (if true (charge) (err u0)))
(define-public (pay-gas-with-pyth) (if true (charge) (err u0)))
