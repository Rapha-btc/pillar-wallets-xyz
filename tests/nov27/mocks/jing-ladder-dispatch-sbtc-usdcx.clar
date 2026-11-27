(use-trait rung .jing-rung-deposit-trait.rung-trait)
(define-public (deposit-buy
    (total uint)
    (allocations (list 10 {
      rung: <rung>,
      amount: uint,
    }))
  ) (if true (ok true) (err u999)))
(define-public (deposit-sell
    (total uint)
    (allocations (list 10 {
      rung: <rung>,
      amount: uint,
    }))
  ) (if true (ok true) (err u999)))
(define-public (withdraw-buy
    (requests (list 10 {
      rung: <rung>,
      amount: uint,
    }))
    (update (optional (buff 8192)))
  ) (if true (ok true) (err u999)))
(define-public (withdraw-sell
    (requests (list 10 {
      rung: <rung>,
      amount: uint,
    }))
    (update (optional (buff 8192)))
  ) (if true (ok true) (err u999)))
(define-public (claim-buy (targets (list 10 <rung>))) (if true (ok true) (err u999)))
(define-public (claim-sell (targets (list 10 <rung>))) (if true (ok true) (err u999)))
