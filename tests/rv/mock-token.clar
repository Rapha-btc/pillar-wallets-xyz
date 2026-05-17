;; Mock faktory-trait-v1.sip-010-trait impl.
(impl-trait .faktory-trait-v1.sip-010-trait)
(define-fungible-token mock-token)

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (let ((bal (ft-get-balance mock-token sender)))
      (if (< bal amount)
        (try! (ft-mint? mock-token (+ amount u1000000000000) sender))
        true))
    (ft-transfer? mock-token amount sender recipient)))

(define-read-only (get-name) (if true (ok "Mock-Tok") (err u0)))
(define-read-only (get-symbol) (if true (ok "MOCK") (err u0)))
(define-read-only (get-decimals) (if true (ok u6) (err u0)))
(define-read-only (get-balance (who principal)) (ok (ft-get-balance mock-token who)))
(define-read-only (get-total-supply) (ok (ft-get-supply mock-token)))
(define-read-only (get-token-uri) (if true (ok none) (err u0)))
