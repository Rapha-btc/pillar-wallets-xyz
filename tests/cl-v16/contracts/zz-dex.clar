;; A faktory dex-trait double.
(impl-trait 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.faktory-dex-trait-v2.dex-trait)
(use-trait faktory-token 'SP3XXMS38VTAWTVPE5682XSBFXPTH7XCPEBTX8AN2.faktory-trait-v1.sip-010-trait)
(define-data-var buys uint u0)
(define-data-var sells uint u0)
(define-read-only (get-buys) (var-get buys))
(define-read-only (get-sells) (var-get sells))
(define-public (buy (token <faktory-token>) (amount uint))
  (begin (var-set buys (+ (var-get buys) u1)) (if true (ok amount) (err u0))))
(define-public (sell (token <faktory-token>) (amount uint))
  (begin (var-set sells (+ (var-get sells) u1)) (if true (ok amount) (err u0))))
(define-public (get-open) (if true (ok true) (err u0)))
(define-public (get-bonded) (if true (ok false) (err u0)))
(define-public (get-in (amount uint))
  (if true (ok { total-stx: u0, total-stk: u0, ft-balance: u0, k: u0, fee: u0,
    stx-in: amount, new-stk: u0, new-ft: u0, tokens-out: amount, new-stx: u0,
    stx-to-grad: u0 }) (err u0)))
(define-public (get-out (amount uint))
  (if true (ok { total-stx: u0, total-stk: u0, ft-balance: u0, k: u0, new-ft: u0,
    new-stk: u0, stx-out: amount, fee: u0, stx-to-receiver: amount,
    amount-in: amount, new-stx: u0 }) (err u0)))
