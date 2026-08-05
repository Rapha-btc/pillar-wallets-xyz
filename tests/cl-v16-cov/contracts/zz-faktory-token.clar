;; A faktory-trait-v1 token. Its trait is a SEPARATE definition from the standard
;; sip-010-trait, so the standard zz-ft cannot stand in for it.
(impl-trait 'SP3XXMS38VTAWTVPE5682XSBFXPTH7XCPEBTX8AN2.faktory-trait-v1.sip-010-trait)
(define-fungible-token zz-fak)
(define-public (transfer (amount uint) (from principal) (to principal) (memo (optional (buff 34))))
  (begin (asserts! (is-eq tx-sender from) (err u1))
    (try! (ft-transfer? zz-fak amount from to)) (ok true)))
(define-public (mint (amount uint) (to principal)) (ft-mint? zz-fak amount to))
(define-read-only (get-name) (ok "zz-fak"))
(define-read-only (get-symbol) (ok "ZZFAK"))
(define-read-only (get-decimals) (ok u6))
(define-read-only (get-balance (who principal)) (ok (ft-get-balance zz-fak who)))
(define-read-only (get-total-supply) (ok (ft-get-supply zz-fak)))
(define-read-only (get-token-uri) (ok none))
