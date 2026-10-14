;; Minimal SIP-010 so RV has an eligible <sip-010-trait> implementation.
;; sbtc-token is only a REQUIREMENT, and RV does not treat requirements as eligible
;; trait impls -- without this, sip010-transfer is skipped from the fuzz run.
(impl-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

(define-fungible-token zz-ft)
(define-constant ERR-NOT-OWNER (err u1))

(define-public (transfer (amount uint) (from principal) (to principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender from) ERR-NOT-OWNER)
    (try! (ft-transfer? zz-ft amount from to))
    (ok true)))

(define-public (mint (amount uint) (to principal)) (ft-mint? zz-ft amount to))
(define-read-only (get-name) (ok "zz-ft"))
(define-read-only (get-symbol) (ok "ZZFT"))
(define-read-only (get-decimals) (ok u8))
(define-read-only (get-balance (who principal)) (ok (ft-get-balance zz-ft who)))
(define-read-only (get-total-supply) (ok (ft-get-supply zz-ft)))
(define-read-only (get-token-uri) (ok none))
