;; Mock prelaunch-trait impl: trivial stubs.
(impl-trait .prelaunch-faktory-trait-v1.prelaunch-trait)

(use-trait faktory-token .faktory-trait-v1.sip-010-trait)

(define-public (buy-up-to (seats uint) (owner (optional principal))) (if true (ok seats) (err u0)))
(define-public (refund (owner (optional principal))) (if true (ok u0) (err u0)))
(define-public (claim (token <faktory-token>)) (if true (ok u0) (err u0)))
(define-public (claim-on-behalf (token <faktory-token>) (who principal)) (if true (ok u0) (err u0)))
(define-public (trigger-fee-airdrop) (if true (ok u0) (err u0)))
(define-read-only (is-market-open) (if true (ok true) (err u0)))
(define-read-only (get-seat-price) (if true (ok u69000) (err u0)))
