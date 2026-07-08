;; Stub pox-4: delegate-stx, revoke-delegate-stx, allow-contract-caller
;; all unconditionally succeed. Return shape mirrors mainnet pox-4
;; (response bool int) so wallet's `match` + `to-uint error` typechecks.

(define-map delegations principal { amount-ustx: uint, delegated-to: principal })

(define-read-only (get-delegation-info (wallet principal))
  (map-get? delegations wallet))

(define-public (delegate-stx (amount-ustx uint) (delegate-to principal) (until-burn-ht (optional uint)) (pox-addr (optional (tuple (version (buff 1)) (hashbytes (buff 32))))))
  (begin
    (map-set delegations tx-sender { amount-ustx: amount-ustx, delegated-to: delegate-to })
    (if true (ok true) (err 0))))

(define-public (revoke-delegate-stx)
  (begin
    (map-delete delegations tx-sender)
    (if true (ok true) (err 0))))

(define-public (allow-contract-caller (caller principal) (until-burn-ht (optional uint)))
  (if true (ok true) (err 0)))
