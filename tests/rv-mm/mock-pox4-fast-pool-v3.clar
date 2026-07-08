;; Stub fast-pool-v3 delegate-stx: returns ok. Err type is uint
;; to satisfy the wallet's `(response ... uint)` typing.
(define-public (delegate-stx (amount-ustx uint))
  (if true (ok true) (err u0)))
