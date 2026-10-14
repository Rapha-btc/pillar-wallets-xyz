;; A gas station that charges NOTHING. Exists to reach the (fee u0) arm of
;; pay-gas-accounted (juice-safe-v6.clar:172): the wallet measures its own balance
;; delta, so a station that moves no sBTC must be accounted as zero rather than
;; underflowing. Same (if true (ok ..) (err ..)) form as zz-gas-station.
(impl-trait 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.gas-station-trait.gas-station-trait)
(define-public (get-gas-amount) (if true (ok u0) (err u0)))
(define-public (pay-gas) (if true (ok true) (err u0)))
(define-public (pay-gas-with-pyth) (if true (ok true) (err u0)))
