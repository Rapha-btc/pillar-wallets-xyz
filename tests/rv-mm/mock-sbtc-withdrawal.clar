;; RV mock: sBTC withdrawal endpoint. Concrete (response uint uint) so the
;; wallet's try! has a determinate err type.
(define-data-var next-id uint u0)
(define-public (initiate-withdrawal-request
    (amount uint)
    (recipient { version: (buff 1), hashbytes: (buff 32) })
    (max-fee uint))
  (let ((id (var-get next-id)))
    (asserts! (> amount u0) (err u1))
    (var-set next-id (+ id u1))
    (ok id)))
