;; Mock gas-station: pay-gas returns ok unconditionally.
(impl-trait .gas-station-trait.gas-station-trait)

(define-public (pay-gas) (if true (ok true) (err u0)))
(define-public (pay-gas-with-pyth) (if true (ok true) (err u0)))
(define-read-only (get-gas-amount) (if true (ok u1000) (err u0)))
