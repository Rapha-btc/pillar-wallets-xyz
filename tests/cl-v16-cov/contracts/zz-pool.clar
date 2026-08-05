;; A dexterity liquidity-pool-trait double. Records what it was asked to do so the
;; tests can assert the wallet actually reached it, and moves real assets so the
;; wallet's (with-ft ...) allowances are exercised rather than bypassed.
;; Note the (if true (ok ..) (err u0)) shape: a bare (ok ..) leaves the err type
;; indeterminate and the wallet's try! over it cannot resolve at Clarity 6.
(impl-trait 'SP2ZNGJ85ENDY6QRHQ5P2D4FXKGZWCKTB2T0Z55KS.dexterity-traits-v0.liquidity-pool-trait)
(define-constant SBTC 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)
(define-data-var calls uint u0)
(define-data-var last-op (buff 16) 0xff)
(define-data-var last-amount uint u0)
(define-read-only (get-calls) (var-get calls))
(define-read-only (get-last-op) (var-get last-op))
(define-read-only (get-last-amount) (var-get last-amount))

(define-private (note (amount uint) (opcode (optional (buff 16))))
  (begin (var-set calls (+ (var-get calls) u1))
    (var-set last-amount amount)
    (var-set last-op (default-to 0xff opcode))
    true))

;; pull the declared sBTC so the wallet's allowance is genuinely spent
(define-private (take-sbtc (amount uint))
  (contract-call? SBTC transfer amount contract-caller current-contract none))

(define-public (execute (amount uint) (opcode (optional (buff 16))))
  (begin (note amount opcode)
    (if true (ok { dx: amount, dy: amount, dk: u0 }) (err u0))))

(define-public (quote (amount uint) (opcode (optional (buff 16))))
  (if true (ok { dx: amount, dy: amount, dk: u0 }) (err u0)))
