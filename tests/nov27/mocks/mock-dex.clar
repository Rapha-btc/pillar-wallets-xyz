;; Mock dex-trait impl: trivial stubs.
(impl-trait .faktory-dex-trait-v2.dex-trait)

(use-trait faktory-token .faktory-trait-v1.sip-010-trait)

(define-public (buy (token <faktory-token>) (amount uint)) (if true (ok amount) (err u0)))
(define-public (sell (token <faktory-token>) (amount uint)) (if true (ok amount) (err u0)))
(define-read-only (get-open) (if true (ok true) (err u0)))
(define-read-only (get-bonded) (if true (ok false) (err u0)))
(define-read-only (get-in (amount uint))
  (ok { total-stx: u0, total-stk: u0, ft-balance: u0, k: u0, fee: u0,
        stx-in: amount, new-stk: u0, new-ft: u0, tokens-out: amount, new-stx: u0, stx-to-grad: u0 }))
(define-read-only (get-out (amount uint))
  (ok { total-stx: u0, total-stk: u0, ft-balance: u0, k: u0, new-ft: u0,
        new-stk: u0, stx-out: amount, fee: u0, stx-to-receiver: amount, amount-in: amount, new-stx: u0 }))
