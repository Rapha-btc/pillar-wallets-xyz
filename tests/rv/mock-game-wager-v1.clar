;; Stub game-wager-v1. get-registered-wallet ALWAYS returns
;; (some <whatever-wallet-was-passed-most-recently>) for simplicity --
;; the wallet would only reach this call past sig verify, which RV
;; can't do randomly.

(use-trait sip-010-trait .sip-010-trait.sip-010-trait)

(define-data-var any-wallet principal tx-sender)
(define-map balances { pubkey: (buff 33), token: principal } uint)

(define-read-only (get-registered-wallet (pubkey (buff 33)))
  (some (var-get any-wallet)))

(define-read-only (get-balance (pubkey (buff 33)) (token principal))
  (default-to u0 (map-get? balances { pubkey: pubkey, token: token })))

(define-public (register-wallet (pubkey (buff 33)) (wallet principal) (auth-id uint) (signature (buff 65)))
  (begin
    (var-set any-wallet wallet)
    (ok true)))

(define-public (deposit (token <sip-010-trait>) (amount uint) (pubkey (buff 33)))
  (begin
    (try! (contract-call? token transfer amount tx-sender current-contract none))
    (map-set balances { pubkey: pubkey, token: (contract-of token) }
      (+ amount (default-to u0 (map-get? balances { pubkey: pubkey, token: (contract-of token) }))))
    (ok true)))
