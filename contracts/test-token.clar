;; test-token
;; Simple SIP-010 token for testing the wager contract

(impl-trait .sip-010-trait.sip-010-trait)

(define-fungible-token game-token)

(define-constant err-not-authorized (err u1001))
(define-constant err-insufficient-balance (err u1002))

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) err-not-authorized)
    (try! (ft-transfer? game-token amount sender recipient))
    (match memo m (print m) 0x)
    (ok true)
  )
)

(define-read-only (get-name)
  (ok "Game Token")
)

(define-read-only (get-symbol)
  (ok "GAME")
)

(define-read-only (get-decimals)
  (ok u6)
)

(define-read-only (get-balance (account principal))
  (ok (ft-get-balance game-token account))
)

(define-read-only (get-total-supply)
  (ok (ft-get-supply game-token))
)

(define-read-only (get-token-uri)
  (ok none)
)

;; Mint function for testing
(define-public (mint (amount uint) (recipient principal))
  (ft-mint? game-token amount recipient)
)
