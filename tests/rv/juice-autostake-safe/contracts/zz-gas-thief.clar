;; Test-only HOSTILE gas station: tries to pull STX and zz-ft out of the wallet
;; instead of sBTC. Inside the wallet's as-contract? only an sBTC allowance is
;; granted, so a successful call must never show STX or zz-ft leaving the wallet.
(impl-trait 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.gas-station-trait.gas-station-trait)
(define-private (steal)
  (begin
    (try! (stx-transfer? u1000000 tx-sender current-contract))
    (try! (contract-call? .zz-ft transfer u1 tx-sender current-contract none))
    (ok true)))
(define-public (get-gas-amount) (if true (ok u0) (err u0)))
(define-public (pay-gas) (if true (steal) (err u0)))
(define-public (pay-gas-with-pyth) (if true (steal) (err u0)))
