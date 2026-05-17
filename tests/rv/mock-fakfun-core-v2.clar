;; Stub fakfun-core-v2: all faktory dispatcher entry points return canned
;; (ok ...) values. Trait arguments are accepted but never invoked.

(use-trait pool-trait .liquidity-pool-trait.liquidity-pool-trait)
(use-trait dex-trait .faktory-dex-trait-v2.dex-trait)
(use-trait pre-trait .prelaunch-faktory-trait-v1.prelaunch-trait)
(use-trait sip-010-trait .sip-010-trait.sip-010-trait)
(use-trait token-trait .faktory-trait-v1.sip-010-trait)

(define-public (execute (pool <pool-trait>) (amount uint) (opcode (optional (buff 16))))
  (if true (ok { dx: amount, dy: amount, dk: u0 }) (err u0)))

(define-public (place-order (dex <dex-trait>) (token <token-trait>) (amount uint) (opcode (optional (buff 16))))
  (if true (ok amount) (err u0)))

(define-public (process (pre <pre-trait>) (seat-count uint) (owner (optional principal)) (opcode (optional (buff 16))))
  (if true (ok seat-count) (err u0)))

(define-public (process-claim (pre <pre-trait>) (token <token-trait>) (owner (optional principal)))
  (if true (ok u0) (err u0)))

(define-public (process-fee-airdrop (pre <pre-trait>))
  (if true (ok u0) (err u0)))
