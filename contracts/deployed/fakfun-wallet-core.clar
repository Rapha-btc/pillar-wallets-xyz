;; SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core

(define-constant DEPLOYER tx-sender)
(define-constant err-not-authorized (err u6001))
(define-constant err-invalid-contract-hash (err u6002))

(define-map whitelisted-wallets principal bool)

(define-data-var open-access bool false)

(define-map verified-contracts principal (buff 32))

(define-read-only (is-whitelisted (wallet principal))
  (or (var-get open-access) (default-to false (map-get? whitelisted-wallets wallet)))
)

(define-read-only (get-verified-contract-hash (contract principal))
  (map-get? verified-contracts contract)
)

(define-read-only (get-contract-hash (contract principal))
  (contract-hash? contract)
)

(define-public (set-open-access (open bool))
  (begin
    (asserts! (is-eq tx-sender DEPLOYER) err-not-authorized)
    (var-set open-access open)
    (ok true)
  )
)

(define-public (whitelist-wallet (wallet principal) (allowed bool))
  (begin
    (asserts! (is-eq tx-sender DEPLOYER) err-not-authorized)
    (map-set whitelisted-wallets wallet allowed)
    (ok true)
  )
)

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

(define-public (log-signal-config-change)
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "signal-config-change",
      wallet: contract-caller,
      signaled-at: burn-block-height
    })
    (ok true)
  )
)

(define-public (log-wallet-config-set
    (stx-threshold uint)
    (sbtc-threshold uint)
    (zsbtc-threshold uint)
    (cooldown-period uint))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "wallet-config-set",
      wallet: contract-caller,
      stx-threshold: stx-threshold,
      sbtc-threshold: sbtc-threshold,
      zsbtc-threshold: zsbtc-threshold,
      cooldown-period: cooldown-period,
      config-signaled-at: none
    })
    (ok true)
  )
)

(define-public (log-pending-operation
    (op-id uint)
    (op-type (string-ascii 20))
    (amount uint)
    (recipient principal)
    (token (optional principal))
    (extension (optional principal))
    (payload (optional (buff 2048)))
    (execute-after uint))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "pending-operation-created",
      wallet: contract-caller,
      op-id: op-id,
      op-type: op-type,
      amount: amount,
      recipient: recipient,
      token: token,
      extension: extension,
      payload: payload,
      execute-after: execute-after,
      executed: false,
      vetoed: false
    })
    (ok true)
  )
)

(define-public (log-operation-vetoed (op-id uint))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "operation-vetoed",
      wallet: contract-caller,
      op-id: op-id,
      vetoed: true
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

(define-public (log-sip009-transfer (nft-id uint) (recipient principal) (sip009 principal))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "sip009-transfer",
      wallet: contract-caller,
      nft-id: nft-id,
      recipient: recipient,
      sip009: sip009
    })
    (ok true)
  )
)

(define-public (log-propose-transfer-wallet (proposed principal))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "propose-transfer-wallet",
      wallet: contract-caller,
      proposed: proposed
    })
    (ok true)
  )
)

(define-public (log-propose-admin-pubkey (pubkey (buff 33)))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "propose-admin-pubkey",
      wallet: contract-caller,
      pubkey: pubkey,
      proposed-at: burn-block-height
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

(define-public (log-signal-pubkey-cooldown-change (new-period uint))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "signal-pubkey-cooldown-change",
      wallet: contract-caller,
      new-period: new-period,
      proposed-at: burn-block-height
    })
    (ok true)
  )
)

(define-public (log-confirm-pubkey-cooldown-change (new-period uint))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "confirm-pubkey-cooldown-change",
      wallet: contract-caller,
      new-period: new-period
    })
    (ok true)
  )
)

(define-public (log-propose-recovery (proposed principal))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "propose-recovery",
      wallet: contract-caller,
      proposed: proposed
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

(define-public (log-recover-inactive-wallet (new-admin principal) (recovered-by principal))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "recover-inactive-wallet",
      wallet: contract-caller,
      new-admin: new-admin,
      recovered-by: recovered-by
    })
    (ok true)
  )
)

(define-public (log-extension-whitelisted (extension principal))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "extension-whitelisted",
      wallet: contract-caller,
      extension: extension,
      whitelisted: true
    })
    (ok true)
  )
)

(define-public (log-extension-removed (extension principal))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "extension-removed",
      wallet: contract-caller,
      extension: extension,
      whitelisted: false
    })
    (ok true)
  )
)

(define-public (log-extension-call (extension principal) (payload (buff 2048)))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "extension-call",
      wallet: contract-caller,
      extension: extension,
      payload: payload
    })
    (ok true)
  )
)

(define-public (log-enroll-dual-stacking (dual-stacking principal))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "enroll-dual-stacking",
      wallet: contract-caller,
      dual-stacking: dual-stacking
    })
    (ok true)
  )
)

(define-public (log-stack-stx-fast-pool (amount-ustx uint))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "stack-stx-fast-pool",
      wallet: contract-caller,
      amount-ustx: amount-ustx
    })
    (ok true)
  )
)

(define-public (log-revoke-fast-pool)
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "revoke-fast-pool",
      wallet: contract-caller
    })
    (ok true)
  )
)

(define-public (log-stake-stx-stacking-dao (stx-amount uint))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "stake-stx-stacking-dao",
      wallet: contract-caller,
      stx-amount: stx-amount
    })
    (ok true)
  )
)

(define-public (log-token-lock-toggled (enabled bool))
  (begin
    (asserts! (is-whitelisted contract-caller) err-not-authorized)
    (print {
      event: "token-lock-toggled",
      wallet: contract-caller,
      enabled: enabled
    })
    (ok true)
  )
)