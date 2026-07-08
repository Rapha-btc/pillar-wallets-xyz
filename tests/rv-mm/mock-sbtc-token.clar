;; Mock SIP-010 with auto-mint: any transfer mints to sender if insufficient.
;; Lets RV's random principals freely move balances without setup.
(impl-trait .sip-010-trait.sip-010-trait)
(define-fungible-token sbtc-token)

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (let ((bal (ft-get-balance sbtc-token sender)))
      (if (< bal amount)
        (try! (ft-mint? sbtc-token (+ amount u1000000000000) sender))
        true))
    (ft-transfer? sbtc-token amount sender recipient)))

(define-read-only (get-name) (if true (ok "Mock-sBTC") (err u0)))
(define-read-only (get-symbol) (if true (ok "sBTC") (err u0)))
(define-read-only (get-decimals) (if true (ok u8) (err u0)))
(define-read-only (get-balance (who principal)) (ok (ft-get-balance sbtc-token who)))
(define-read-only (get-total-supply) (ok (ft-get-supply sbtc-token)))
(define-read-only (get-token-uri) (if true (ok none) (err u0)))
