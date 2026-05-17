;; Mock SIP-010 token used by game-wager-v2 RV. Auto-mints on transfer
;; if sender is short -- keeps RV from getting stuck on empty balances.
(impl-trait .sip-010-trait.sip-010-trait)
(define-fungible-token mock-token)

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (let ((bal (ft-get-balance mock-token sender)))
      (if (< bal amount)
        (try! (ft-mint? mock-token (+ amount u1000000000000) sender))
        true))
    (ft-transfer? mock-token amount sender recipient)))

(define-read-only (get-name) (ok "Mock-Tok"))
(define-read-only (get-symbol) (ok "MOCK"))
(define-read-only (get-decimals) (ok u6))
(define-read-only (get-balance (who principal)) (ok (ft-get-balance mock-token who)))
(define-read-only (get-total-supply) (ok (ft-get-supply mock-token)))
(define-read-only (get-token-uri) (ok none))

;; Open mint so RV can prime balances when calling deposit on game-wager-v2.
(define-public (mint (amount uint) (recipient principal))
  (ft-mint? mock-token amount recipient))
