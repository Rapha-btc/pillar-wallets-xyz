;; Stub for fakfun-wallet-core -- all log-* fns succeed unconditionally,
;; set-verified-contract / register-wallet always accept, is-whitelisted
;; always true. RV cannot inspect contract-caller checks usefully here.
;;
;; Each `(if true (ok ...) (err u0))` is the cheapest way to force a
;; concrete err type (uint) on Clarity 5 -- a bare `(ok ...)` leaves the
;; err type indeterminate, which breaks the wallet's `(try! ...)` chain.

(define-map verified-contracts principal (buff 32))
(define-map whitelisted-wallets principal bool)

(define-read-only (is-whitelisted (wallet principal))
  (default-to true (map-get? whitelisted-wallets wallet)))

(define-read-only (get-verified-contract-hash (c principal))
  (map-get? verified-contracts c))

(define-public (set-verified-contract (contract principal) (hash (optional (buff 32))))
  (begin
    (match hash h (map-set verified-contracts contract h) true)
    (if true (ok true) (err u0))))

(define-public (register-wallet (wallet principal))
  (begin (map-set whitelisted-wallets wallet true) (if true (ok true) (err u0))))

;; Signatures below match the actual wallet `log-*` invocations
;; (extracted from contracts/fakfun-wallet-v2.clar). Number of args
;; matters; types do not.
(define-public (log-wallet-initialized (pubkey (buff 33))) (if true (ok true) (err u0)))
(define-public (log-admin-added (new-admin principal)) (if true (ok true) (err u0)))
(define-public (log-wallet-transferred (pending principal)) (if true (ok true) (err u0)))
(define-public (log-signal-config-change) (if true (ok true) (err u0)))
(define-public (log-wallet-config-set (stx uint) (sbtc uint) (zsbtc uint) (cooldown uint)) (if true (ok true) (err u0)))
(define-public (log-pending-operation (op-id uint) (op-type (string-ascii 20)) (amount uint) (recipient principal) (token (optional principal)) (extension (optional principal)) (payload (optional (buff 2048))) (execute-after uint)) (if true (ok true) (err u0)))
(define-public (log-operation-vetoed (op-id uint)) (if true (ok true) (err u0)))
(define-public (log-stx-transfer (amount uint) (recipient principal) (memo (optional (buff 34)))) (if true (ok true) (err u0)))
(define-public (log-sip010-transfer (token principal) (amount uint) (recipient principal) (memo (optional (buff 34)))) (if true (ok true) (err u0)))
(define-public (log-sip009-transfer (nft-id uint) (recipient principal) (token principal)) (if true (ok true) (err u0)))
(define-public (log-propose-transfer-wallet (new-admin principal)) (if true (ok true) (err u0)))
(define-public (log-propose-admin-pubkey (pubkey (buff 33))) (if true (ok true) (err u0)))
(define-public (log-confirm-admin-pubkey (pubkey (buff 33)) (admin principal)) (if true (ok true) (err u0)))
(define-public (log-remove-admin-pubkey (pubkey (buff 33))) (if true (ok true) (err u0)))
(define-public (log-signal-pubkey-cooldown-change (new-period uint)) (if true (ok true) (err u0)))
(define-public (log-confirm-pubkey-cooldown-change (effective uint)) (if true (ok true) (err u0)))
(define-public (log-propose-recovery (new-recovery principal)) (if true (ok true) (err u0)))
(define-public (log-confirm-recovery (recovery principal)) (if true (ok true) (err u0)))
(define-public (log-recover-inactive-wallet (new-admin principal) (recovery principal)) (if true (ok true) (err u0)))
(define-public (log-extension-whitelisted (ext principal)) (if true (ok true) (err u0)))
(define-public (log-extension-removed (ext principal)) (if true (ok true) (err u0)))
(define-public (log-extension-call (ext principal) (payload (buff 2048))) (if true (ok true) (err u0)))
(define-public (log-enroll-dual-stacking (ext principal)) (if true (ok true) (err u0)))
(define-public (log-stack-stx-fast-pool (amount uint)) (if true (ok true) (err u0)))
(define-public (log-revoke-fast-pool) (if true (ok true) (err u0)))
(define-public (log-stake-stx-stacking-dao (amount uint)) (if true (ok true) (err u0)))
(define-public (log-token-lock-toggled (enabled bool)) (if true (ok true) (err u0)))
