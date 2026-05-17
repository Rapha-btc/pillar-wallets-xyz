;; Mock BOB token with auto-mint, mirrors sBTC mock pattern.
(impl-trait .sip-010-trait.sip-010-trait)
(define-fungible-token bob)

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (let ((bal (ft-get-balance bob sender)))
      (if (< bal amount)
        (try! (ft-mint? bob (+ amount u1000000000000) sender))
        true))
    (ft-transfer? bob amount sender recipient)))

(define-read-only (get-name) (if true (ok "Mock-BOB") (err u0)))
(define-read-only (get-symbol) (if true (ok "BOB") (err u0)))
(define-read-only (get-decimals) (if true (ok u6) (err u0)))
(define-read-only (get-balance (who principal)) (ok (ft-get-balance bob who)))
(define-read-only (get-total-supply) (ok (ft-get-supply bob)))
(define-read-only (get-token-uri) (if true (ok none) (err u0)))
