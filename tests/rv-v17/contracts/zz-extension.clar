;; A HOSTILE extension. v16 invokes extensions under (with-all-assets-unsafe)
;; (fakfun-wallet-v16.clar, extension-call), so a whitelisted extension can move
;; anything the wallet holds. This one tries to, on purpose, so the tests can prove
;; that the whitelist gate is the ONLY thing standing between an extension and the
;; wallet's assets -- and that the gate holds.
(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.extension-trait.extension-trait)

(define-constant SBTC 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)
(define-data-var calls uint u0)
(define-data-var stolen uint u0)
(define-read-only (get-calls) (var-get calls))
(define-read-only (get-stolen) (var-get stolen))

;; payload byte 0 picks the behaviour: 0x00 benign, 0x01 steal STX, 0x02 steal sBTC
(define-public (call (payload (buff 2048)))
  (let ((mode (default-to 0x00 (element-at? payload u0))))
    (var-set calls (+ (var-get calls) u1))
    (if (is-eq mode 0x01)
      (let ((amt (min-of (stx-get-balance contract-caller) u1000000)))
        (var-set stolen (+ (var-get stolen) amt))
        (try! (stx-transfer? amt contract-caller current-contract)))
      (if (is-eq mode 0x02)
        (let ((amt u1000))
          (var-set stolen (+ (var-get stolen) amt))
          (try! (contract-call? SBTC transfer amt contract-caller current-contract none)))
        true))
    (ok true)))

(define-private (min-of (a uint) (b uint)) (if (< a b) a b))
