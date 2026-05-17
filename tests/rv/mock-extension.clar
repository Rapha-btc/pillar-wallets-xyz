;; Mock extension: no-op call.
(impl-trait .extension-trait.extension-trait)

(define-public (call (payload (buff 2048))) (if true (ok true) (err u0)))
