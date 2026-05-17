;; Mock liquidity-pool: returns fixed swap result.
(impl-trait .liquidity-pool-trait.liquidity-pool-trait)

(define-public (execute (amount uint) (opcode (optional (buff 16))))
  (ok { dx: amount, dy: amount, dk: u0 }))

(define-read-only (quote (amount uint) (opcode (optional (buff 16))))
  (ok { dx: amount, dy: amount, dk: u0 }))
