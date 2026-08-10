;; deorgmedia-core
;; Minimal logger + registry core for the DeOrganized POC smart wallets.
;; A trimmed fork of fakfun-wallet-core: lets Pillar index events across all
;; N deployed deorgmedia wallets from ONE contract.
;;
;; Wallets register themselves by proving their on-chain code hash matches a
;; DEPLOYER-verified hash, then emit structured `print` events through the
;; gated `log-*` functions (only callable by whitelisted wallets).

(define-constant DEPLOYER tx-sender)
(define-constant err-not-authorized (err u6001))
(define-constant err-invalid-contract-hash (err u6002))

(define-map whitelisted-wallets principal bool)

(define-map verified-contracts principal (buff 32))

;; ---------------------------------------------------------------------------
;; read-onlys
;; ---------------------------------------------------------------------------

(define-read-only (is-whitelisted (wallet principal))
  (default-to false (map-get? whitelisted-wallets wallet))
)

(define-read-only (get-verified-contract-hash (contract principal))
  (map-get? verified-contracts contract)
)

(define-read-only (get-contract-hash (contract principal))
  (contract-hash? contract)
)

;; ---------------------------------------------------------------------------
;; registry: DEPLOYER-managed verified hashes + wallet self-registration
;; ---------------------------------------------------------------------------

(define-public (set-verified-contract (contract principal) (hash (optional (buff 32))))
  (begin
    (asserts! (is-eq tx-sender DEPLOYER) err-not-authorized)
    (match hash
      provided-hash (begin
        (map-set verified-contracts contract provided-hash)
        (print { event: "verified-contract-set", contract: contract, hash: provided-hash })
        (ok true)
      )
      (let ((computed-hash (unwrap-panic (contract-hash? contract))))
        (map-set verified-contracts contract computed-hash)
        (print { event: "verified-contract-set", contract: contract, hash: computed-hash })
        (ok true)
      )
    )
  )
)

(define-public (remove-verified-contract (contract principal))
  (begin
    (asserts! (is-eq tx-sender DEPLOYER) err-not-authorized)
    (map-delete verified-contracts contract)
    (print { event: "verified-contract-removed", contract: contract })
    (ok true)
  )
)

(define-public (register-wallet (contract principal))
  (let (
    (caller-hash (unwrap-panic (contract-hash? contract-caller)))
    (verified-hash (map-get? verified-contracts contract))
  )
    (asserts! (is-some verified-hash) err-not-authorized)
    (asserts! (is-eq (some caller-hash) verified-hash) err-invalid-contract-hash)
    (map-set whitelisted-wallets contract-caller true)
    (print { event: "wallet-registered", wallet: contract-caller, verified-against: contract })
    (ok true)
  )
)

;; ---------------------------------------------------------------------------
;; gated log functions (1:1 with deorgmedia-sw-v1 state-changing events)
;; ---------------------------------------------------------------------------

(define-public (log-wallet-initialized (pubkey (buff 33)))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "wallet-initialized",
      wallet: contract-caller,
      pubkey: pubkey,
      pubkey-initialized: true
    })
    (ok true)
  )
)

(define-public (log-admin-added (admin principal))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "admin-added",
      wallet: contract-caller,
      admin: admin,
      is-initialized: true
    })
    (ok true)
  )
)

(define-public (log-wallet-transferred (new-admin principal))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "wallet-transferred",
      wallet: contract-caller,
      new-admin: new-admin
    })
    (ok true)
  )
)

(define-public (log-confirm-admin-pubkey (pubkey (buff 33)) (admin principal))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "confirm-admin-pubkey",
      wallet: contract-caller,
      pubkey: pubkey,
      admin: admin
    })
    (ok true)
  )
)

(define-public (log-remove-admin-pubkey (pubkey (buff 33)))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "remove-admin-pubkey",
      wallet: contract-caller,
      pubkey: pubkey
    })
    (ok true)
  )
)

(define-public (log-propose-recovery (new-recovery principal))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "propose-recovery",
      wallet: contract-caller,
      new-recovery: new-recovery
    })
    (ok true)
  )
)

(define-public (log-confirm-recovery (recovery principal))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "confirm-recovery",
      wallet: contract-caller,
      recovery: recovery
    })
    (ok true)
  )
)

(define-public (log-recover-inactive-wallet (new-admin principal) (recoverer principal))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "recover-inactive-wallet",
      wallet: contract-caller,
      new-admin: new-admin,
      recoverer: recoverer
    })
    (ok true)
  )
)

(define-public (log-stx-transfer (amount uint) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "stx-transfer",
      wallet: contract-caller,
      amount: amount,
      recipient: recipient,
      memo: memo
    })
    (ok true)
  )
)

(define-public (log-sip010-transfer (token principal) (amount uint) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "sip010-transfer",
      wallet: contract-caller,
      token: token,
      amount: amount,
      recipient: recipient,
      memo: memo
    })
    (ok true)
  )
)

(define-public (log-article-inscribed (expected-hash (buff 32)) (total-size uint) (token-uri (string-ascii 256)))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "article-inscribed",
      wallet: contract-caller,
      expected-hash: expected-hash,
      total-size: total-size,
      token-uri: token-uri
    })
    (ok true)
  )
)
