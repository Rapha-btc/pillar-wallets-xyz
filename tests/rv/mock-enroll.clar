;; Mock enroll-trait impl: no-op enroll.
(impl-trait .enroll-trait.enroll-trait)

(define-public (enroll (receiver (optional principal))) (if true (ok true) (err u0)))
