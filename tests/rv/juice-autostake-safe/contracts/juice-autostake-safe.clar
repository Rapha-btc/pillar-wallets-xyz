(use-trait gas-trait 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.gas-station-trait.gas-station-trait)

(use-trait sip-010-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)
(use-trait sip-009-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)

(impl-trait 'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK.pillar-wallet-trait.pillar-wallet-trait)

(define-constant err-unauthorised (err u4001))
(define-constant err-invalid-signature (err u4002))
(define-constant err-forbidden (err u4003))
(define-constant err-unregistered-pubkey (err u4004))
(define-constant err-not-admin-pubkey (err u4005))
(define-constant err-signature-replay (err u4006))
(define-constant err-inactive-required (err u4009))
(define-constant err-no-pending-recovery (err u4010))
(define-constant err-in-cooldown (err u4012))
(define-constant err-invalid-operation (err u4013))
(define-constant err-already-executed (err u4014))
(define-constant err-vetoed (err u4015))
(define-constant err-not-signaled (err u4016))
(define-constant err-cooldown-not-passed (err u4017))
(define-constant err-threshold-exceeded (err u4018))
(define-constant err-cooldown-too-long (err u4019))
(define-constant err-cooldown-too-short (err u4031))
(define-constant err-no-pending-transfer (err u4020))

(define-constant err-token-locked (err u4023))

(define-constant err-zero-amount (err u4026))
(define-constant err-not-staking (err u4040))

(define-constant INACTIVITY-PERIOD u120)
(define-constant MAX-GAS-CEILING u10000)

(define-constant MAX-CONFIG-COOLDOWN u4032)

(define-constant MIN-COOLDOWN u144)
(define-constant DEPLOYED-BURNT-BLOCK burn-block-height)
(define-constant SBTC-CONTRACT 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)
(define-constant FAKFUN-DEPLOYER 'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK)

(define-constant RP-ID-HASH-JUICEOFBTC-COM 0x1516f9ea2a21f961d99143eedf2aeeab86e3784a34a401b038bb97a7631e668b)

(define-constant POX5 'SP000000000000000000002Q6VF78.pox-5)

(define-constant JUICE-SIGNER
  .juice-autostake-pool)

(define-constant NUM-CYCLES u96)

;; The keeper may only `restake`: add unlocked STX (signer rewards) to the
;; current Juice stake. Default chavita.btc; the owner can change it.
(define-data-var keeper principal 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22)

(define-data-var last-activity-block uint burn-block-height)
(define-data-var recovery-address principal 'SP000000000000000000002Q6VF78)
(define-data-var pubkey-initialized bool false)

(define-data-var owner principal 'SP000000000000000000002Q6VF78)
(define-data-var pending-recovery principal 'SP000000000000000000002Q6VF78)
(define-data-var pending-transfer principal 'SP000000000000000000002Q6VF78)

(define-fungible-token ect)

(define-map used-pubkey-authorizations
  (buff 32)
  (buff 33)
)

(define-map used-assertions
  (buff 32)
  bool
)

(define-data-var wallet-config {
  stx-threshold: uint,
  sbtc-threshold: uint,
  cooldown-period: uint,
  config-signaled-at: (optional uint),
} {
  stx-threshold: u100000000,
  sbtc-threshold: u100000,
  cooldown-period: u144,
  config-signaled-at: none,
})

(define-data-var max-gas-amount uint u1000)

(define-data-var token-lock-enabled bool false)

(define-data-var spent-this-period {
  stx: uint,
  sbtc: uint,
  gas: uint,
  period-start: uint,
} {
  stx: u0,
  sbtc: u0,
  gas: u0,
  period-start: DEPLOYED-BURNT-BLOCK,
})

(define-private (get-current-spent)
  (let (
      (spent (var-get spent-this-period))
      (config (var-get wallet-config))
      (period-expired (> burn-block-height
        (+ (get period-start spent) (get cooldown-period config))
      ))
    )
    (if period-expired
      {
        stx: u0,
        sbtc: u0,
        gas: u0,
        period-start: burn-block-height,
      }
      spent
    )
  )
)

(define-private (add-spent-stx (amount uint))
  (let ((current (get-current-spent)))
    (var-set spent-this-period
      (merge current { stx: (+ (get stx current) amount) })
    )
  )
)

(define-private (add-spent-sbtc (amount uint))
  (let ((current (get-current-spent)))
    (var-set spent-this-period
      (merge current { sbtc: (+ (get sbtc current) amount) })
    )
  )
)

(define-private (add-spent-gas (amount uint))
  (let ((current (get-current-spent)))
    (var-set spent-this-period
      (merge current { gas: (+ (get gas current) amount) })
    )
  )
)

(define-constant GAS-ENFORCED true)
(define-constant GAS-EXEMPT false)

(define-constant GAS-CALLS-PER-PERIOD u25)

(define-private (max-gas-per-period)
  (* (var-get max-gas-amount) GAS-CALLS-PER-PERIOD)
)

(define-private (pay-gas-accounted
    (g <gas-trait>)
    (enforce bool)
  )
  (let ((before (unwrap-panic (contract-call?
      'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token get-balance
      current-contract
    ))))
    (try! (as-contract?
      ((with-ft SBTC-CONTRACT "sbtc-token" (var-get max-gas-amount)))
      (try! (contract-call? g pay-gas))
    ))
    (let (
        (after (unwrap-panic (contract-call?
          'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token get-balance
          current-contract
        )))
        (fee (if (> before after)
          (- before after)
          u0
        ))
      )

      (asserts!
        (not (and enforce
          (> (+ (get gas (get-current-spent)) fee) (max-gas-per-period))
        ))
        err-threshold-exceeded
      )
      (add-spent-gas fee)
      (ok true)
    )
  )
)

(define-map pending-operations
  uint
  {
    op-type: (string-ascii 20),
    amount: uint,
    recipient: principal,
    token: (optional principal),
    extension: (optional principal),
    payload: (optional (buff 2048)),
    execute-after: uint,
    executed: bool,
    vetoed: bool,

    passkey-created: bool,
  }
)

(define-data-var operation-nonce uint u0)

(define-data-var pending-max-gas {
  amount: uint,
  proposed-at: uint,
} {
  amount: u0,
  proposed-at: u0,
})

(define-data-var pending-config {
  stx-threshold: uint,
  sbtc-threshold: uint,
  cooldown-period: uint,
} {
  stx-threshold: u0,
  sbtc-threshold: u0,
  cooldown-period: u0,
})

(define-read-only (get-pending-config)
  (var-get pending-config)
)

(define-read-only (get-pending-max-gas)
  (var-get pending-max-gas)
)

(define-public (propose-max-gas-amount (amount uint))
  (begin
    (try! (is-admin-calling tx-sender))
    (asserts! (<= amount MAX-GAS-CEILING) err-threshold-exceeded)
    (var-set pending-max-gas {
      amount: amount,
      proposed-at: burn-block-height,
    })
    (update-activity)
    (print { event: "propose-max-gas-amount", amount: amount })
    (ok true)
  )
)

(define-public (confirm-max-gas-amount
    (sig-auth {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    })
    (gas (optional <gas-trait>))
  )
  (let (
      (pending (var-get pending-max-gas))
      (config (var-get wallet-config))
      (wallet-cooldown (get cooldown-period config))
      (effective (if (> wallet-cooldown MAX-CONFIG-COOLDOWN)
        MAX-CONFIG-COOLDOWN
        wallet-cooldown
      ))
    )

    (try! (is-authorized (some {
      message-hash: (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v10
        build-confirm-max-gas-amount-hash {
        auth-id: (get auth-id sig-auth),
        amount: (get amount pending),
      }),
      pubkey: (get pubkey sig-auth),
      signature: (get signature sig-auth),
      authenticator-data: (get authenticator-data sig-auth),
      client-data-prefix: (get client-data-prefix sig-auth),
      client-data-suffix: (get client-data-suffix sig-auth),
    })))

    (match gas
      g (try! (pay-gas-accounted g GAS-ENFORCED))
      true
    )
    (asserts! (not (is-eq (get proposed-at pending) u0)) err-not-signaled)
    (asserts! (>= burn-block-height (+ (get proposed-at pending) effective))
      err-in-cooldown
    )
    (var-set max-gas-amount (get amount pending))
    (var-set pending-max-gas { amount: u0, proposed-at: u0 })
    (update-activity)
    (print { event: "confirm-max-gas-amount", amount: (get amount pending) })
    (ok true)
  )
)

(define-read-only (get-token-lock-enabled)
  (var-get token-lock-enabled)
)

(define-public (toggle-token-lock
    (enabled bool)
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (begin
    (asserts! (not (is-eq (var-get owner) 'SP000000000000000000002Q6VF78))
      err-unauthorised
    )
    (if enabled
      (match sig-auth
        sig-auth-details (begin
          (try! (is-authorized (some {
            message-hash: (contract-call?
              'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
              build-toggle-token-lock-hash {
              auth-id: (get auth-id sig-auth-details),
              enabled: enabled,
            }),
            pubkey: (get pubkey sig-auth-details),
            signature: (get signature sig-auth-details),
            authenticator-data: (get authenticator-data sig-auth-details),
            client-data-prefix: (get client-data-prefix sig-auth-details),
            client-data-suffix: (get client-data-suffix sig-auth-details),
          })))
          (match gas
            g (try! (pay-gas-accounted g GAS-ENFORCED))
            true
          )
        )
        (try! (is-authorized none))
      )
      (try! (is-admin-calling tx-sender))
    )
    (var-set token-lock-enabled enabled)
    (update-activity)
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
      log-token-lock-toggled enabled
    ))
    (ok true)
  )
)

(define-public (signal-config-change
    (new-stx-threshold uint)
    (new-sbtc-threshold uint)
    (new-cooldown-period uint)
  )
  (let ((config (var-get wallet-config)))
    (try! (is-authorized none))

    (asserts! (>= new-cooldown-period MIN-COOLDOWN) err-cooldown-too-short)
    (asserts! (<= new-cooldown-period MAX-CONFIG-COOLDOWN) err-cooldown-too-long)
    (var-set pending-config {
      stx-threshold: new-stx-threshold,
      sbtc-threshold: new-sbtc-threshold,
      cooldown-period: new-cooldown-period,
    })
    (var-set wallet-config
      (merge config { config-signaled-at: (some burn-block-height) })
    )
    (update-activity)

    (print {
      event: "signal-config-change",
      stx-threshold: new-stx-threshold,
      sbtc-threshold: new-sbtc-threshold,
      cooldown-period: new-cooldown-period,
      signaled-at: burn-block-height,
    })
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
      log-signal-config-change
    ))
    (ok true)
  )
)

(define-public (set-wallet-config
    (sig-auth {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    })
    (gas (optional <gas-trait>))
  )
  (let (
      (config (var-get wallet-config))
      (pending (var-get pending-config))
      (new-stx-threshold (get stx-threshold pending))
      (new-sbtc-threshold (get sbtc-threshold pending))
      (new-cooldown-period (get cooldown-period pending))
      (signaled-at (default-to u0 (get config-signaled-at config)))
      (wallet-cooldown (get cooldown-period config))
      (effective-config-cooldown (if (> wallet-cooldown MAX-CONFIG-COOLDOWN)
        MAX-CONFIG-COOLDOWN
        wallet-cooldown
      ))
    )

    (try! (is-authorized (some {
      message-hash: (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v10
        build-set-wallet-config-hash {
        auth-id: (get auth-id sig-auth),
        stx-threshold: new-stx-threshold,
        sbtc-threshold: new-sbtc-threshold,
        cooldown-period: new-cooldown-period,
      }),
      pubkey: (get pubkey sig-auth),
      signature: (get signature sig-auth),
      authenticator-data: (get authenticator-data sig-auth),
      client-data-prefix: (get client-data-prefix sig-auth),
      client-data-suffix: (get client-data-suffix sig-auth),
    })))

    (match gas
      g (try! (pay-gas-accounted g GAS-ENFORCED))
      true
    )
    (asserts! (not (is-eq signaled-at u0)) err-not-signaled)
    (asserts! (>= burn-block-height (+ signaled-at effective-config-cooldown))
      err-in-cooldown
    )
    (var-set wallet-config {
      stx-threshold: new-stx-threshold,
      sbtc-threshold: new-sbtc-threshold,
      cooldown-period: new-cooldown-period,
      config-signaled-at: none,
    })

    (var-set pending-config {
      stx-threshold: u0,
      sbtc-threshold: u0,
      cooldown-period: u0,
    })
    (update-activity)
    (print {
      event: "set-wallet-config",
      stx-threshold: new-stx-threshold,
      sbtc-threshold: new-sbtc-threshold,
      cooldown-period: new-cooldown-period,
    })
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
      log-wallet-config-set new-stx-threshold new-sbtc-threshold u0
      new-cooldown-period
    ))
    (ok true)
  )
)

(define-private (create-pending-operation
    (op-type (string-ascii 20))
    (amount uint)
    (recipient principal)
    (token (optional principal))
    (extension (optional principal))
    (payload (optional (buff 2048)))
    (passkey-created bool)
  )
  (let (
      (config (var-get wallet-config))
      (op-id (var-get operation-nonce))
    )
    (map-set pending-operations op-id {
      op-type: op-type,
      amount: amount,
      recipient: recipient,
      token: token,
      extension: extension,
      payload: payload,
      execute-after: (+ burn-block-height (get cooldown-period config)),
      executed: false,
      vetoed: false,
      passkey-created: passkey-created,
    })
    (var-set operation-nonce (+ op-id u1))
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
      log-pending-operation op-id op-type amount recipient token extension
      payload (+ burn-block-height (get cooldown-period config))
    ))
    (ok op-id)
  )
)

(define-public (veto-operation
    (op-id uint)
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (let ((op (unwrap! (map-get? pending-operations op-id) err-invalid-operation)))
    (match sig-auth
      sig-auth-details (begin
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-veto-operation-hash {
            auth-id: (get auth-id sig-auth-details),
            op-id: op-id,
          }),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )
    (asserts! (not (get executed op)) err-already-executed)
    (map-set pending-operations op-id (merge op { vetoed: true }))

    (update-activity)
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
      log-operation-vetoed op-id
    ))
    (ok true)
  )
)

(define-read-only (get-pending-operation (op-id uint))
  (map-get? pending-operations op-id)
)

(define-private (would-exceed-stx-threshold (amount uint))
  (let (
      (config (var-get wallet-config))
      (spent (get-current-spent))
    )
    (> (+ (get stx spent) amount) (get stx-threshold config))
  )
)

(define-private (would-exceed-sbtc-threshold (amount uint))
  (let (
      (config (var-get wallet-config))
      (spent (get-current-spent))
    )
    (> (+ (get sbtc spent) amount) (get sbtc-threshold config))
  )
)

(define-private (is-authorized (sig-message-auth (optional {
  message-hash: (buff 32),
  pubkey: (buff 33),
  signature: (buff 64),
  authenticator-data: (buff 256),
  client-data-prefix: (buff 128),
  client-data-suffix: (buff 512),
})))
  (match sig-message-auth
    sig-message-details (consume-signature (get message-hash sig-message-details)
      (get pubkey sig-message-details) (get signature sig-message-details)
      (get authenticator-data sig-message-details)
      (get client-data-prefix sig-message-details)
      (get client-data-suffix sig-message-details)
    )
    (is-admin-calling tx-sender)
  )
)

(define-read-only (is-admin-calling (caller principal))
  (ok (asserts! (is-some (map-get? admins caller)) err-unauthorised))
)

(define-public (stx-transfer
    (amount uint)
    (recipient principal)
    (memo (optional (buff 34)))
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (begin
    (update-activity)
    (match sig-auth
      sig-auth-details (begin
        (asserts! (not (var-get token-lock-enabled)) err-token-locked)
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-stx-transfer-hash {
            auth-id: (get auth-id sig-auth-details),
            amount: amount,
            recipient: recipient,
            memo: memo,
          }),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )
    (if (would-exceed-stx-threshold amount)
      (begin
        (unwrap-panic (create-pending-operation "stx-transfer" amount recipient none none none
          (is-some sig-auth)
        ))
        (ok true)
      )
      (begin
        (add-spent-stx amount)
        (try! (contract-call?
          'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
          log-stx-transfer amount recipient memo
        ))
        (as-contract? ((with-stx amount))
          (match memo
            to-print (try! (rv-stx-transfer-memo? amount tx-sender recipient to-print))
            (try! (rv-stx-transfer? amount tx-sender recipient))
          ))
      )
    )
  )
)

(define-public (execute-pending-stx-transfer
    (op-id uint)
    (memo (optional (buff 34)))
  )
  (let ((op (unwrap! (map-get? pending-operations op-id) err-invalid-operation)))
    (asserts! (is-eq (get op-type op) "stx-transfer") err-invalid-operation)
    (asserts! (not (get executed op)) err-already-executed)
    (asserts! (not (get vetoed op)) err-vetoed)
    (asserts! (>= burn-block-height (get execute-after op))
      err-cooldown-not-passed
    )
    (try! (is-authorized none))
    (update-activity)
    (map-set pending-operations op-id (merge op { executed: true }))
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
      log-stx-transfer (get amount op) (get recipient op) memo
    ))
    (as-contract? ((with-stx (get amount op)))
      (match memo
        to-print (try! (rv-stx-transfer-memo? (get amount op) tx-sender (get recipient op) to-print))
        (try! (rv-stx-transfer? (get amount op) tx-sender (get recipient op)))
      ))
  )
)

(define-public (execute-pending-stx-transfer-now
    (op-id uint)
    (memo (optional (buff 34)))
    (sig-auth {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    })
    (gas (optional <gas-trait>))
  )
  (let ((op (unwrap! (map-get? pending-operations op-id) err-invalid-operation)))
    (asserts! (is-eq (get op-type op) "stx-transfer") err-invalid-operation)
    (asserts! (not (get executed op)) err-already-executed)
    (asserts! (not (get vetoed op)) err-vetoed)

    (asserts! (not (get passkey-created op)) err-forbidden)
    (asserts! (not (var-get token-lock-enabled)) err-token-locked)
    (try! (is-authorized (some {
      message-hash: (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.mm-safe-auth-helpers-v1
        build-execute-now-hash {
        auth-id: (get auth-id sig-auth),
        op-id: op-id,
      }),
      pubkey: (get pubkey sig-auth),
      signature: (get signature sig-auth),
      authenticator-data: (get authenticator-data sig-auth),
      client-data-prefix: (get client-data-prefix sig-auth),
      client-data-suffix: (get client-data-suffix sig-auth),
    })))
    (match gas
      g (try! (pay-gas-accounted g GAS-ENFORCED))
      true
    )
    (map-set pending-operations op-id (merge op { executed: true }))
    (update-activity)
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
      log-stx-transfer (get amount op) (get recipient op) memo
    ))
    (as-contract? ((with-stx (get amount op)))
      (match memo
        to-print (try! (rv-stx-transfer-memo? (get amount op) tx-sender (get recipient op) to-print))
        (try! (rv-stx-transfer? (get amount op) tx-sender (get recipient op)))
      ))
  )
)

(define-public (sip010-transfer
    (amount uint)
    (recipient principal)
    (memo (optional (buff 34)))
    (sip010 <sip-010-trait>)
    (token-name (string-ascii 128))
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (begin
    (update-activity)
    (match sig-auth
      sig-auth-details (begin
        (asserts! (not (var-get token-lock-enabled)) err-token-locked)
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-sip010-transfer-hash {
            auth-id: (get auth-id sig-auth-details),
            amount: amount,
            recipient: recipient,
            memo: memo,
            sip010: (contract-of sip010),
          }),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )
    (if (and (is-eq (contract-of sip010) SBTC-CONTRACT) (would-exceed-sbtc-threshold amount))
      (begin
        (unwrap-panic (create-pending-operation "sbtc-transfer" amount recipient
          (some SBTC-CONTRACT) none none (is-some sig-auth)
        ))
        (ok true)
      )
      (begin
        (if (is-eq (contract-of sip010) SBTC-CONTRACT)
          (add-spent-sbtc amount)
          true
        )
        (try! (contract-call?
          'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
          log-sip010-transfer (contract-of sip010) amount recipient memo
        ))
        (as-contract? ((with-ft (contract-of sip010) token-name amount))
          (try! (contract-call? sip010 transfer amount current-contract recipient memo))
        )
      )
    )
  )
)

(define-public (execute-pending-sbtc-transfer
    (op-id uint)
    (memo (optional (buff 34)))
  )
  (let ((op (unwrap! (map-get? pending-operations op-id) err-invalid-operation)))
    (asserts! (is-eq (get op-type op) "sbtc-transfer") err-invalid-operation)
    (asserts! (not (get executed op)) err-already-executed)
    (asserts! (not (get vetoed op)) err-vetoed)
    (asserts! (>= burn-block-height (get execute-after op))
      err-cooldown-not-passed
    )
    (try! (is-authorized none))
    (update-activity)
    (map-set pending-operations op-id (merge op { executed: true }))
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
      log-sip010-transfer SBTC-CONTRACT (get amount op) (get recipient op)
      memo
    ))
    (as-contract? ((with-ft SBTC-CONTRACT "sbtc-token" (get amount op)))
      (try! (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
        transfer (get amount op) current-contract (get recipient op) memo
      ))
    )
  )
)

(define-public (execute-pending-sbtc-transfer-now
    (op-id uint)
    (memo (optional (buff 34)))
    (sig-auth {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    })
    (gas (optional <gas-trait>))
  )
  (let ((op (unwrap! (map-get? pending-operations op-id) err-invalid-operation)))
    (asserts! (is-eq (get op-type op) "sbtc-transfer") err-invalid-operation)
    (asserts! (not (get executed op)) err-already-executed)
    (asserts! (not (get vetoed op)) err-vetoed)

    (asserts! (not (get passkey-created op)) err-forbidden)
    (asserts! (not (var-get token-lock-enabled)) err-token-locked)
    (try! (is-authorized (some {
      message-hash: (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.mm-safe-auth-helpers-v1
        build-execute-now-hash {
        auth-id: (get auth-id sig-auth),
        op-id: op-id,
      }),
      pubkey: (get pubkey sig-auth),
      signature: (get signature sig-auth),
      authenticator-data: (get authenticator-data sig-auth),
      client-data-prefix: (get client-data-prefix sig-auth),
      client-data-suffix: (get client-data-suffix sig-auth),
    })))
    (match gas
      g (try! (pay-gas-accounted g GAS-ENFORCED))
      true
    )
    (map-set pending-operations op-id (merge op { executed: true }))
    (update-activity)
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
      log-sip010-transfer SBTC-CONTRACT (get amount op) (get recipient op)
      memo
    ))
    (as-contract? ((with-ft SBTC-CONTRACT "sbtc-token" (get amount op)))
      (try! (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
        transfer (get amount op) current-contract (get recipient op) memo
      ))
    )
  )
)

(define-public (sbtc-initiate-withdrawal
    (amount uint)
    (recipient {
      version: (buff 1),
      hashbytes: (buff 32),
    })
    (max-fee uint)
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (begin
    (update-activity)
    (match sig-auth
      sig-auth-details (begin
        (asserts! (not (var-get token-lock-enabled)) err-token-locked)
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v8
            build-sbtc-withdrawal-hash {
            auth-id: (get auth-id sig-auth-details),
            amount: amount,
            recipient: recipient,
            max-fee: max-fee,
          }),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )
    (if (would-exceed-sbtc-threshold (+ amount max-fee))
      (begin
        (unwrap-panic (create-pending-operation "sbtc-withdraw" amount
          current-contract (some SBTC-CONTRACT) none
          (some (unwrap-panic (to-consensus-buff? {
            recipient: recipient,
            max-fee: max-fee,
          })))
          (is-some sig-auth)
        ))
        (ok true)
      )
      (begin
        (add-spent-sbtc (+ amount max-fee))
        (try! (as-contract? ((with-ft SBTC-CONTRACT "sbtc-token" (+ amount max-fee)))
          (try! (contract-call?
            'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal
            initiate-withdrawal-request amount recipient max-fee
          ))
        ))
        (ok true)
      )
    )
  )
)

(define-public (execute-pending-sbtc-withdrawal (op-id uint))
  (let ((op (unwrap! (map-get? pending-operations op-id) err-invalid-operation)))
    (asserts! (is-eq (get op-type op) "sbtc-withdraw") err-invalid-operation)
    (asserts! (not (get executed op)) err-already-executed)
    (asserts! (not (get vetoed op)) err-vetoed)
    (asserts! (>= burn-block-height (get execute-after op))
      err-cooldown-not-passed
    )
    (try! (is-authorized none))
    (update-activity)
    (let (
        (raw (unwrap! (get payload op) err-invalid-operation))
        (parsed (unwrap!
          (from-consensus-buff?
            {
              recipient: { version: (buff 1), hashbytes: (buff 32) },
              max-fee: uint,
            }
            raw
          )
          err-invalid-operation
        ))
        (the-recipient (get recipient parsed))
        (the-max-fee (get max-fee parsed))
        (the-amount (get amount op))
        (lock-total (+ the-amount the-max-fee))
      )
      (map-set pending-operations op-id (merge op { executed: true }))
      (as-contract? ((with-ft SBTC-CONTRACT "sbtc-token" lock-total))
        (try! (contract-call?
          'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal
          initiate-withdrawal-request the-amount the-recipient the-max-fee
        ))
      )
    )
  )
)

(define-public (execute-pending-sbtc-withdrawal-now
    (op-id uint)
    (sig-auth {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    })
    (gas (optional <gas-trait>))
  )
  (let ((op (unwrap! (map-get? pending-operations op-id) err-invalid-operation)))
    (asserts! (is-eq (get op-type op) "sbtc-withdraw") err-invalid-operation)
    (asserts! (not (get executed op)) err-already-executed)
    (asserts! (not (get vetoed op)) err-vetoed)

    (asserts! (not (get passkey-created op)) err-forbidden)
    (asserts! (not (var-get token-lock-enabled)) err-token-locked)
    (try! (is-authorized (some {
      message-hash: (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.mm-safe-auth-helpers-v1
        build-execute-now-hash {
        auth-id: (get auth-id sig-auth),
        op-id: op-id,
      }),
      pubkey: (get pubkey sig-auth),
      signature: (get signature sig-auth),
      authenticator-data: (get authenticator-data sig-auth),
      client-data-prefix: (get client-data-prefix sig-auth),
      client-data-suffix: (get client-data-suffix sig-auth),
    })))
    (match gas
      g (try! (pay-gas-accounted g GAS-ENFORCED))
      true
    )
    (let (
        (raw (unwrap! (get payload op) err-invalid-operation))
        (parsed (unwrap!
          (from-consensus-buff?
            {
              recipient: { version: (buff 1), hashbytes: (buff 32) },
              max-fee: uint,
            }
            raw
          )
          err-invalid-operation
        ))
        (the-recipient (get recipient parsed))
        (the-max-fee (get max-fee parsed))
        (the-amount (get amount op))
        (lock-total (+ the-amount the-max-fee))
      )
      (map-set pending-operations op-id (merge op { executed: true }))
      (update-activity)
      (as-contract? ((with-ft SBTC-CONTRACT "sbtc-token" lock-total))
        (try! (contract-call?
          'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal
          initiate-withdrawal-request the-amount the-recipient the-max-fee
        ))
      )
    )
  )
)

(define-public (sip009-transfer
    (nft-id uint)
    (recipient principal)
    (sip009 <sip-009-trait>)
    (token-name (string-ascii 128))
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (begin
    (update-activity)
    (match sig-auth
      sig-auth-details (begin
        (asserts! (not (var-get token-lock-enabled)) err-token-locked)
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-sip009-transfer-hash {
            auth-id: (get auth-id sig-auth-details),
            nft-id: nft-id,
            recipient: recipient,
            sip009: (contract-of sip009),
          }),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
      log-sip009-transfer nft-id recipient (contract-of sip009)
    ))
    (as-contract? ((with-nft (contract-of sip009) token-name (list nft-id)))
      (try! (contract-call? sip009 transfer nft-id current-contract recipient))
    )
  )
)

(define-map admins
  principal
  bool
)

(define-map pubkey-to-admin
  (buff 33)
  principal
)

(define-read-only (is-admin-pubkey (pubkey (buff 33)))
  (let ((user-opt (map-get? pubkey-to-admin pubkey)))
    (match user-opt
      user (ok (unwrap! (is-admin-calling user) err-not-admin-pubkey))
      err-unregistered-pubkey
    )
  )
)

(define-public (propose-transfer-wallet (new-admin principal))
  (begin
    (try! (is-admin-calling tx-sender))
    (asserts! (not (is-eq new-admin tx-sender)) err-forbidden)
    (var-set pending-transfer new-admin)
    (update-activity)
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
      log-propose-transfer-wallet new-admin
    ))
    (ok true)
  )
)

(define-public (confirm-transfer-wallet
    (sig-auth {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    })
    (gas (optional <gas-trait>))
  )
  (let ((pending (var-get pending-transfer)))
    (asserts! (not (is-eq pending 'SP000000000000000000002Q6VF78))
      err-no-pending-transfer
    )
    (try! (is-authorized (some {
      message-hash: (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
        build-confirm-transfer-hash {
        auth-id: (get auth-id sig-auth),
        new-admin: pending,
      }),
      pubkey: (get pubkey sig-auth),
      signature: (get signature sig-auth),
      authenticator-data: (get authenticator-data sig-auth),
      client-data-prefix: (get client-data-prefix sig-auth),
      client-data-suffix: (get client-data-suffix sig-auth),
    })))
    (match gas
      g (try! (pay-gas-accounted g GAS-EXEMPT))
      true
    )
    (try! (ft-mint? ect u1 current-contract))
    (try! (ft-burn? ect u1 current-contract))

    (asserts! (not (is-eq pending current-contract)) err-unauthorised)
    (asserts! (not (is-eq pending (var-get owner))) err-unauthorised)
    (map-set admins pending true)
    (map-delete admins (var-get owner))
    (var-set owner pending)
    ;; a new owner starts with auto-restake off (bounty mv7dfb, Giant Moth F2)
    (var-set keeper pending)
    (var-set pending-transfer 'SP000000000000000000002Q6VF78)
    (update-activity)
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
      log-wallet-transferred pending
    ))
    (ok true)
  )
)

(define-read-only (verify-signature
    (message-hash (buff 32))
    (pubkey (buff 33))
    (signature (buff 64))
    (authenticator-data (buff 256))
    (client-data-prefix (buff 128))
    (client-data-suffix (buff 512))
  )
  (let ((auth-rp-id (unwrap!
      (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.clarity-5-webauthn-v4
        get-rp-id-hash authenticator-data
      )
      err-invalid-signature
    )))
    (try! (is-admin-pubkey pubkey))

    (asserts! (is-eq auth-rp-id RP-ID-HASH-JUICEOFBTC-COM) err-invalid-signature)
    (asserts!
      (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.clarity-5-webauthn-v4
        is-user-verified authenticator-data
      )
      err-invalid-signature
    )
    (ok (asserts!
      (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.clarity-5-webauthn-v4
        verify-webauthn-signature pubkey message-hash authenticator-data
        client-data-prefix client-data-suffix signature
      )
      err-invalid-signature
    ))
  )
)

(define-private (consume-signature
    (message-hash (buff 32))
    (pubkey (buff 33))
    (signature (buff 64))
    (authenticator-data (buff 256))
    (client-data-prefix (buff 128))
    (client-data-suffix (buff 512))
  )
  (let ((assertion-id (sha256 (concat authenticator-data signature))))
    (try! (verify-signature message-hash pubkey signature authenticator-data
      client-data-prefix client-data-suffix
    ))

    (asserts! (is-none (map-get? used-pubkey-authorizations message-hash))
      err-signature-replay
    )

    (asserts! (is-none (map-get? used-assertions assertion-id))
      err-signature-replay
    )
    (map-set used-pubkey-authorizations message-hash pubkey)
    (map-set used-assertions assertion-id true)
    (ok true)
  )
)

(define-read-only (get-owner)
  (ok (var-get owner))
)

(define-read-only (is-inactive)
  (> burn-block-height (+ INACTIVITY-PERIOD (var-get last-activity-block)))
)

(define-private (update-activity)
  (var-set last-activity-block burn-block-height)
)

(define-public (propose-recovery
    (new-recovery principal)
    (sig-auth {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    })
    (gas (optional <gas-trait>))
  )
  (begin
    (try! (is-authorized (some {
      message-hash: (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
        build-propose-recovery-hash {
        auth-id: (get auth-id sig-auth),
        new-recovery: new-recovery,
      }),
      pubkey: (get pubkey sig-auth),
      signature: (get signature sig-auth),
      authenticator-data: (get authenticator-data sig-auth),
      client-data-prefix: (get client-data-prefix sig-auth),
      client-data-suffix: (get client-data-suffix sig-auth),
    })))
    (match gas
      g (try! (pay-gas-accounted g GAS-ENFORCED))
      true
    )

    (asserts! (not (is-eq new-recovery current-contract)) err-unauthorised)
    (var-set pending-recovery new-recovery)
    (update-activity)
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
      log-propose-recovery new-recovery
    ))
    (ok true)
  )
)

(define-public (confirm-recovery)
  (let ((pending (var-get pending-recovery)))
    (asserts! (not (is-eq pending 'SP000000000000000000002Q6VF78))
      err-no-pending-recovery
    )
    (try! (is-admin-calling tx-sender))
    (var-set recovery-address pending)
    (var-set pending-recovery 'SP000000000000000000002Q6VF78)
    (update-activity)
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
      log-confirm-recovery pending
    ))
    (ok true)
  )
)

(define-public (recover-inactive-wallet (new-admin principal))
  (begin
    (asserts! (is-inactive) err-inactive-required)
    (asserts! (is-eq tx-sender (var-get recovery-address)) err-unauthorised)
    (map-delete admins (var-get owner))

    (asserts! (not (is-eq new-admin current-contract)) err-unauthorised)
    (map-set admins new-admin true)
    (var-set owner new-admin)
    ;; a new owner starts with auto-restake off (bounty mv7dfb, Giant Moth F2)
    (var-set keeper new-admin)
    (var-set last-activity-block burn-block-height)
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
      log-recover-inactive-wallet new-admin tx-sender
    ))
    (ok true)
  )
)

(define-read-only (locked-ustx)
  (get locked (rv-stx-account))
)

(define-public (stake-stx-juice
    (amount-ustx uint)
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
    (signer-calldata (optional (buff 500)))
  )
  (begin
    (update-activity)
    (match sig-auth
      sig-auth-details (begin
        (asserts! (not (var-get token-lock-enabled)) err-token-locked)
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-safe-auth-helpers-v1
            build-stake-stx-juice-pox5-hash {
            auth-id: (get auth-id sig-auth-details),
            amount-ustx: amount-ustx,
          }),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )
    (asserts! (> amount-ustx u0) err-zero-amount)

    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
      log-stake-stx amount-ustx
    ))

    (try! (as-contract? ((with-staking amount-ustx))
      (try! (contract-call? POX5 stake
        JUICE-SIGNER amount-ustx NUM-CYCLES burn-block-height signer-calldata
      ))
    ))
    (print {
      event: "stake-stx-juice",
      amount-ustx: amount-ustx,
      num-cycles: NUM-CYCLES,
      signer-calldata: signer-calldata,
    })
    (ok true)
  )
)

(define-public (update-stake-stx-juice
    (amount-increase uint)
    (cycles-to-extend uint)
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
    (signer-calldata (optional (buff 500)))
  )
  (begin
    (update-activity)
    (match sig-auth
      sig-auth-details (begin
        (asserts! (not (var-get token-lock-enabled)) err-token-locked)
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-safe-auth-helpers-v1
            build-update-stake-stx-juice-hash {
            auth-id: (get auth-id sig-auth-details),
            amount-increase: amount-increase,
            cycles-to-extend: cycles-to-extend,
          }),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )

    (asserts! (or (> amount-increase u0) (> cycles-to-extend u0)) err-zero-amount)
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
      log-stake-stx amount-increase
    ))

    (asserts! (<= amount-increase (get unlocked (rv-stx-account))) (err u8))
    (try! (as-contract? ((with-staking (+ (locked-ustx) amount-increase)))
      (try! (contract-call? POX5 stake-update
        JUICE-SIGNER JUICE-SIGNER cycles-to-extend amount-increase signer-calldata
      ))
    ))
    (print {
      event: "update-stake-stx-juice",
      amount-increase: amount-increase,
      cycles-to-extend: cycles-to-extend,
      signer-calldata: signer-calldata,
    })
    (ok true)
  )
)

(define-public (unstake
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (begin
    (update-activity)
    (match sig-auth
      sig-auth-details (begin
        (asserts! (not (var-get token-lock-enabled)) err-token-locked)
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-safe-auth-helpers-v1
            build-unstake-stx-juice-hash { auth-id: (get auth-id sig-auth-details) }
          ),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )

    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
      log-revoke-fast-pool
    ))

    (try! (as-contract? ((with-pox))
      (try! (contract-call? POX5 unstake JUICE-SIGNER))
    ))
    (print { event: "unstake" })
    (ok true)
  )
)

(define-read-only (get-keeper)
  (var-get keeper)
)

(define-public (set-keeper
    (new-keeper principal)
    (sig-auth (optional {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
    (gas (optional <gas-trait>))
  )
  (begin
    (update-activity)
    (match sig-auth
      sig-auth-details (begin
        (asserts! (not (var-get token-lock-enabled)) err-token-locked)
        (try! (is-authorized (some {
          message-hash: (contract-call?
            .juice-autostake-safe-auth-helpers-v1
            build-set-keeper-hash {
            auth-id: (get auth-id sig-auth-details),
            keeper: new-keeper,
          }),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (pay-gas-accounted g GAS-ENFORCED))
          true
        )
      )
      (try! (is-authorized none))
    )
    (print {
      event: "set-keeper",
      old: (var-get keeper),
      new: new-keeper,
    })
    (var-set keeper new-keeper)
    (ok true)
  )
)

;; Keeper only. Adds ALL unlocked STX in the safe to the current Juice stake
;; and rolls the lock back to NUM-CYCLES (96, the pox-5 max) from next cycle.
;; The keeper picks nothing: no amount, no signer, no lock length. It cannot
;; move STX out or change the signer.
;; Rolling costs the owner nothing: pox-5 `unstake` works in any cycle and
;; unlocks after the next one. After `unstake` pox-5 leaves 0 cycles to run;
;; restake refuses that case, so the keeper never re-locks a safe that is
;; leaving. Once the lock ends, pox-5 has no position and refuses too.
;; No update-activity: keeper calls must not hold off inactivity recovery.
(define-public (restake)
  (let (
      (amount (get unlocked (rv-stx-account)))
      (info (unwrap! (contract-call? POX5 get-staker-info current-contract)
        err-not-staking
      ))
      (current-cycle (contract-call? POX5 current-pox-reward-cycle))
      (unlock-cycle (+ (get first-reward-cycle info) (get num-cycles info)))
      (target-unlock-cycle (+ current-cycle u1 NUM-CYCLES))
      (cycles-to-extend (if (> target-unlock-cycle unlock-cycle)
        (- target-unlock-cycle unlock-cycle)
        u0
      ))
    )
    (asserts! (is-eq contract-caller (var-get keeper)) err-unauthorised)
    (asserts! (> unlock-cycle (+ current-cycle u1)) err-not-staking)
    (asserts! (or (> amount u0) (> cycles-to-extend u0)) err-zero-amount)
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
      log-stake-stx amount
    ))
    (try! (as-contract? ((with-staking (+ (locked-ustx) amount)))
      (try! (contract-call? POX5 stake-update
        JUICE-SIGNER JUICE-SIGNER cycles-to-extend amount none
      ))
    ))
    (print {
      event: "restake",
      keeper: contract-caller,
      amount: amount,
      cycles-to-extend: cycles-to-extend,
    })
    (ok {
      amount: amount,
      cycles-to-extend: cycles-to-extend,
    })
  )
)

(map-set admins 'SP000000000000000000002Q6VF78 true)

(define-public (onboard
    (pubkey (buff 33))
    (new-owner principal)
    (recovery principal)
    (stx-threshold uint)
    (sbtc-threshold uint)
    (cooldown-period uint)
  )
  (begin
    (asserts! (is-eq tx-sender FAKFUN-DEPLOYER) err-unauthorised)
    (asserts! (not (var-get pubkey-initialized)) err-unauthorised)
    (map-set pubkey-to-admin pubkey new-owner)
    (map-delete admins 'SP000000000000000000002Q6VF78)

    (asserts! (not (is-eq new-owner current-contract)) err-unauthorised)
    (map-set admins new-owner true)
    (var-set owner new-owner)

    (asserts! (not (is-eq recovery current-contract)) err-unauthorised)
    (asserts! (not (is-eq recovery new-owner)) err-unauthorised)

    (asserts! (>= cooldown-period MIN-COOLDOWN) err-cooldown-too-short)
    (asserts! (<= cooldown-period MAX-CONFIG-COOLDOWN) err-cooldown-too-long)
    (var-set recovery-address recovery)
    (var-set wallet-config {
      stx-threshold: stx-threshold,
      sbtc-threshold: sbtc-threshold,
      cooldown-period: cooldown-period,
      config-signaled-at: none,
    })
    (var-set pubkey-initialized true)
    (update-activity)
    (try! (as-contract? ()
      (try! (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
        register-wallet
        .juice-autostake-safe
      ))
    ))
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
      log-admin-added new-owner
    ))
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
      log-confirm-recovery recovery
    ))
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
      log-wallet-config-set stx-threshold sbtc-threshold u0 cooldown-period
    ))
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core-v2
      log-wallet-initialized pubkey
    ))
    (ok true)
  )
)


;; ===========================================================================
;; RV harness for juice-autostake-safe. ./build.sh appends this file to the
;; patched production source, because rv reads invariants and property tests
;; from the contract under test. Nothing here is deployed anywhere but simnet.
;;
;; Setup (deployments/default.simnet-plan.yaml, batch "rv-setup"): the pool is
;; registered in pox-5 through the real grant path, core-v2 verifies the safe,
;; and the safe is onboarded by the real FAKFUN-DEPLOYER with the passkey from
;; keys.mjs, owner wallet_1, recovery wallet_2, thresholds 1000 STX / 0.01 BTC,
;; cooldown 144. Then the plan funds the safe (rv-fund / rv-fund-sbtc / ...).
;;
;; Error codes u91xx..u99xx are HARNESS assertion codes (a failed property).
;; ===========================================================================

;; --- rv bookkeeping ---------------------------------------------------------
(define-map context (string-ascii 100) { called: uint })
(define-public (update-context (function-name (string-ascii 100)) (called uint))
  (ok (map-set context function-name { called: called })))
(define-read-only (rv-called (name (string-ascii 100)))
  (default-to u0 (get called (map-get? context name))))

;; --- constants --------------------------------------------------------------
(define-constant RV-PUBKEY 0x03becee7a253dc4a2744f69dafa13338d3456b6da7c292caf6cf84395deea2f7ee)
(define-constant RV-PLACEHOLDER 'SP000000000000000000002Q6VF78)
(define-constant RV-BTC-RECIPIENT { version: 0x00, hashbytes: 0x0000000000000000000000000000000000000001 })
;; every principal that can plausibly end up in `admins`: all simnet accounts,
;; the default keeper, the placeholder and the fakfun deployer
(define-constant RV-PROBES (list
  'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM 'STNHKEPYEPJ8ET55ZZ0M5A34J0R3N5FM2CMMMAZ6
  'ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG
  'ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC 'ST2NEB84ASENDXKYGJPQW86YXQCEFEX2ZQPG87ND
  'ST2REHHS5J3CERCRBEPMGH7921Q6PYKAADT7JP2VB 'ST3AM1A56AK2C1XAFJ4115ZSV26EB49BVQ10MGCS0
  'ST3PF13W7Z0RRM42A8VZRVFQ75SV1K26RXEP8YGKJ 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP
  'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22 'SP000000000000000000002Q6VF78
  'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK))
(define-constant RV-OP-PROBES (list u0 u1 u2 u3 u4 u5 u6 u7 u8 u9 u10 u11 u12 u13 u14 u15
  u16 u17 u18 u19 u20 u21 u22 u23 u24 u25 u26 u27 u28 u29 u30 u31))

;; --- PoX lock emulation (patch C in build.sh) ---------------------------------
;; The node locks a pox-5 staker's amount-ustx until the unlock height; pox-5's
;; get-staker-info returns none from exactly that cycle on. Simnet never locks,
;; so the safe's account reads and outgoing STX transfers go through these.
(define-read-only (rv-staked-active)
  (match (contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-staker-info current-contract)
    info (get amount-ustx info)
    u0))
(define-read-only (rv-stx-account)
  (let ((bal (stx-get-balance current-contract)) (lk (rv-staked-active)))
    { locked: (if (> lk bal) bal lk), unlocked: (if (> lk bal) u0 (- bal lk)), unlock-height: u0 }))
(define-private (rv-stx-transfer? (amount uint) (sender principal) (recipient principal))
  (if (> amount (get unlocked (rv-stx-account)))
    (err u1)
    (stx-transfer? amount sender recipient)))
(define-private (rv-stx-transfer-memo? (amount uint) (sender principal) (recipient principal) (memo (buff 34)))
  (if (> amount (get unlocked (rv-stx-account)))
    (err u1)
    (stx-transfer-memo? amount sender recipient memo)))

;; --- RV-ONLY fuzz aids (public, so rv calls them in invariant mode) ---------
;; Anyone can send assets to the safe on mainnet too; these just give rv a way.
(define-data-var rv-stx-funded uint u0)
(define-public (rv-fund (amount uint))
  (let ((a (+ u1000000 (mod amount u3000000000))))
    (try! (stx-transfer? a tx-sender current-contract))
    (var-set rv-stx-funded (+ (var-get rv-stx-funded) a))
    (ok a)))
(define-public (rv-fund-sbtc (amount uint))
  (let ((a (+ u1000 (mod amount u2000000))))
    (try! (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token transfer
      a tx-sender current-contract none))
    (ok a)))
(define-public (rv-fund-ft (amount uint))
  (contract-call? .zz-ft mint (+ u1 (mod amount u1000000000)) current-contract))
(define-public (rv-fund-nft)
  (contract-call? .zz-nft mint current-contract))
;; The production contract has no way to register a passkey after onboard, so
;; after the first owner change every passkey path would be dead for the rest of
;; the (single, shared) rv session. This re-points the test passkey at the
;; current owner -- the onboard-time state shape. HARNESS-ONLY: any finding that
;; needs it must be re-checked without it (see ../README.md).
(define-public (rv-rebind-passkey)
  (ok (map-set pubkey-to-admin RV-PUBKEY (var-get owner))))

;; --- helpers -----------------------------------------------------------------
(define-read-only (rv-is-admin (p principal)) (is-some (map-get? admins p)))
;; AVAILABLE sBTC: sbtc-token get-balance also counts sbtc-token-locked, which a
;; withdrawal request mints in place of the burned sBTC
(define-read-only (rv-sbtc-of (p principal))
  (unwrap-panic (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token get-balance-available p)))
(define-read-only (rv-unlock-cycle)
  (match (contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-staker-info current-contract)
    info (+ (get first-reward-cycle info) (get num-cycles info))
    u0))
(define-read-only (rv-cycle)
  (contract-call? 'SP000000000000000000002Q6VF78.pox-5 current-pox-reward-cycle))

;; Property tests call the SUT's public functions directly, and an inner public
;; call that returns err does NOT roll back like a top-level tx. Every property
;; therefore snapshots what the SUT can write before its first failing assert
;; and restores it on err, so a failed inner call leaves the state it would
;; leave on chain.
(define-read-only (rv-snap)
  { act: (var-get last-activity-block), spent: (var-get spent-this-period) })
(define-private (rv-restore (s { act: uint, spent: { stx: uint, sbtc: uint, gas: uint, period-start: uint } }))
  (begin
    (var-set last-activity-block (get act s))
    (var-set spent-this-period (get spent s))
    true))

;; ===========================================================================
;; INVARIANTS (invariant mode: checked after every random call sequence)
;; ===========================================================================

;; I1. exactly one admin, and it is the owner. Every owner change
;; (onboard / confirm-transfer-wallet / recover-inactive-wallet) must move the
;; single admin seat; an empty or doubled seat means a bricked or co-owned safe.
(define-read-only (invariant-single-admin-is-owner)
  (let ((o (var-get owner)))
    (and (rv-is-admin o)
         (not (rv-is-admin current-contract))
         (is-eq (len (filter rv-is-admin RV-PROBES))
                (if (is-some (index-of? RV-PROBES o)) u1 u0)))))

;; I2. the safe never names itself as owner or recovery
(define-read-only (invariant-no-self-reference)
  (and (not (is-eq (var-get owner) current-contract))
       (not (is-eq (var-get recovery-address) current-contract))
       (not (is-eq (var-get pending-recovery) current-contract))))

;; I3. max-gas and a queued max-gas never exceed the hard ceiling
(define-read-only (invariant-gas-within-ceiling)
  (and (<= (var-get max-gas-amount) MAX-GAS-CEILING)
       (<= (get amount (var-get pending-max-gas)) MAX-GAS-CEILING)))

;; I4. the gas fuse. Enforced payments check (spent + fee) <= max-gas * 25;
;; only confirm-transfer-wallet is GAS-EXEMPT, and each exempt fee is capped by
;; the (with-ft sbtc max-gas-amount) allowance. So spent gas is bounded by the
;; cap at payment time plus one max-gas per exempt payment.
(define-read-only (invariant-gas-fuse)
  (let ((g (get gas (var-get spent-this-period)))
        (exempt (rv-called "confirm-transfer-wallet")))
    (if (is-eq (rv-called "confirm-max-gas-amount") u0)
      (<= g (* (var-get max-gas-amount) (+ GAS-CALLS-PER-PERIOD exempt)))
      (<= g (* MAX-GAS-CEILING (+ GAS-CALLS-PER-PERIOD exempt))))))

;; I5. cooldown inside its bounds; a queued config is empty or legal
(define-read-only (invariant-config-bounds)
  (let ((cd (get cooldown-period (var-get wallet-config)))
        (pcd (get cooldown-period (var-get pending-config))))
    (and (>= cd MIN-COOLDOWN) (<= cd MAX-CONFIG-COOLDOWN)
         (or (is-eq pcd u0) (and (>= pcd MIN-COOLDOWN) (<= pcd MAX-CONFIG-COOLDOWN))))))

;; I6. per-period spend never passes the thresholds without a pending op.
;; set-wallet-config may LOWER a threshold below what the period already spent,
;; so the check holds strictly until the first successful set-wallet-config.
(define-read-only (invariant-spend-within-thresholds)
  (let ((s (var-get spent-this-period)) (c (var-get wallet-config)))
    (or (> (rv-called "set-wallet-config") u0)
        (and (<= (get stx s) (get stx-threshold c))
             (<= (get sbtc s) (get sbtc-threshold c))))))

;; I7. accounting: the active pox-5 position is fully backed by STX the safe
;; holds (staked + liquid == balance, liquid >= 0). Fails if STX can leave while
;; locked or if a stake/update/restake can lock more than the safe has.
(define-read-only (invariant-stake-backed-by-balance)
  (<= (rv-staked-active) (stx-get-balance current-contract)))

;; I8. the only stake target is the Juice signer pool
(define-read-only (invariant-position-signer-is-juice)
  (match (contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-staker-info current-contract)
    info (is-eq (get signer info) JUICE-SIGNER)
    true))

;; I9. no lock ever runs past next cycle + NUM-CYCLES (96)
(define-read-only (invariant-lock-at-most-96)
  (match (contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-staker-info current-contract)
    info (<= (+ (get first-reward-cycle info) (get num-cycles info)) (+ (rv-cycle) u1 NUM-CYCLES))
    true))

;; I10. pending ops: ids below the nonce exist, the nonce slot is free, and no
;; op is ever both executed and vetoed (so a veto always means "never pays").
(define-private (rv-op-ok (id uint) (acc bool))
  (and acc
    (match (map-get? pending-operations id)
      op (and (< id (var-get operation-nonce)) (not (and (get executed op) (get vetoed op))))
      (>= id (var-get operation-nonce)))))
(define-read-only (invariant-pending-ops-consistent)
  (let ((n (var-get operation-nonce)))
    (and (fold rv-op-ok RV-OP-PROBES true)
         (is-none (map-get? pending-operations n))
         (or (is-eq n u0) (is-some (map-get? pending-operations (- n u1)))))))

;; I11. activity is never stamped in the future
(define-read-only (invariant-activity-not-future)
  (<= (var-get last-activity-block) burn-block-height))

;; I12. the keeper is never the safe itself unless the owner put it there
;; (set-keeper accepts any principal); and never the placeholder
(define-read-only (invariant-keeper-not-placeholder)
  (not (is-eq (var-get keeper) RV-PLACEHOLDER)))

;; ===========================================================================
;; PROPERTIES (property mode: one public test-* call per run, random caller and args,
;; admin paths only -- rv cannot sign passkeys here and property mode runs no
;; dialers). (err u9xxx) = FAIL. (ok true) = the inner call SUCCEEDED and every
;; effect was checked, so rv's PASSED count is the number of successful
;; state-changing calls. A refused inner call is restored and DISCARDED
;; (ok false); "only X may call" is enforced in the success branch (a success
;; by anyone else fails the property), so a discard never hides it.
;; ===========================================================================

;; funding aid inside property mode (the rv-* helpers are not called in this mode)
(define-public (test-zz-fund (amount uint))
  (let ((b0 (stx-get-balance current-contract)) (s0 (rv-sbtc-of current-contract))
        (a (try! (rv-fund amount))) (sa (try! (rv-fund-sbtc amount))))
    (try! (rv-fund-nft))
    (asserts! (is-eq (stx-get-balance current-contract) (+ b0 a)) (err u9001))
    (asserts! (is-eq (rv-sbtc-of current-contract) (+ s0 sa)) (err u9002))
    (ok true)))

;; P1. stx-transfer: only an admin moves STX; an immediate send moves exactly
;; `amount` from unlocked STX to `recipient`; over the threshold it queues an
;; admin-created op and moves nothing.
(define-public (test-stx-transfer (amount uint) (recipient principal))
  (let ((s (rv-snap)) (admin (rv-is-admin tx-sender))
        (bal0 (stx-get-balance current-contract)) (rbal0 (stx-get-balance recipient))
        (n0 (var-get operation-nonce)) (queue (would-exceed-stx-threshold amount))
        (unl (get unlocked (rv-stx-account))))
    (match (stx-transfer amount recipient none none none)
      okv (begin
        (asserts! admin (err u9100))
        (if queue
          (let ((op (unwrap! (map-get? pending-operations n0) (err u9101))))
            (asserts! (is-eq (var-get operation-nonce) (+ n0 u1)) (err u9102))
            (asserts! (is-eq (stx-get-balance current-contract) bal0) (err u9103))
            (asserts! (and (is-eq (get op-type op) "stx-transfer") (is-eq (get amount op) amount)
                           (is-eq (get recipient op) recipient) (not (get executed op))
                           (not (get vetoed op)) (not (get passkey-created op))) (err u9104))
            (ok true))
          (begin
            (asserts! (<= amount unl) (err u9105))
            (asserts! (is-eq (stx-get-balance current-contract) (- bal0 amount)) (err u9106))
            (asserts! (is-eq (stx-get-balance recipient) (+ rbal0 amount)) (err u9107))
            (asserts! (is-eq (var-get operation-nonce) n0) (err u9108))
            (ok true))))
      e (begin
        (rv-restore s)
        (asserts! (is-eq (stx-get-balance current-contract) bal0) (err u9109))
        (ok false)))))

;; P2. sBTC through sip010-transfer: same rules with the sBTC threshold
(define-public (test-sbtc-transfer (amount uint) (recipient principal))
  (let ((s (rv-snap)) (admin (rv-is-admin tx-sender))
        (bal0 (rv-sbtc-of current-contract)) (rbal0 (rv-sbtc-of recipient))
        (n0 (var-get operation-nonce)) (queue (would-exceed-sbtc-threshold amount)))
    (match (sip010-transfer amount recipient none
             'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token "sbtc-token" none none)
      okv (begin
        (asserts! admin (err u9200))
        (if queue
          (let ((op (unwrap! (map-get? pending-operations n0) (err u9201))))
            (asserts! (is-eq (var-get operation-nonce) (+ n0 u1)) (err u9202))
            (asserts! (is-eq (rv-sbtc-of current-contract) bal0) (err u9203))
            (asserts! (and (is-eq (get op-type op) "sbtc-transfer") (is-eq (get amount op) amount)
                           (is-eq (get recipient op) recipient)
                           (is-eq (get token op) (some SBTC-CONTRACT))
                           (not (get passkey-created op))) (err u9204))
            (ok true))
          (begin
            (asserts! (is-eq (rv-sbtc-of current-contract) (- bal0 amount)) (err u9205))
            (asserts! (is-eq (rv-sbtc-of recipient) (+ rbal0 amount)) (err u9206))
            (asserts! (is-eq (var-get operation-nonce) n0) (err u9207))
            (ok true))))
      e (begin
        (rv-restore s)
        (asserts! (is-eq (rv-sbtc-of current-contract) bal0) (err u9208))
        (ok false)))))

;; P3. a non-sBTC SIP-010 never queues and moves exactly `amount`
(define-public (test-ft-transfer (amount uint) (recipient principal) (t <sip-010-trait>))
  (let ((s (rv-snap)) (admin (rv-is-admin tx-sender))
        (bal0 (unwrap-panic (contract-call? .zz-ft get-balance current-contract)))
        (n0 (var-get operation-nonce)))
    (match (sip010-transfer amount recipient none t "zz-ft" none none)
      okv (begin
        (asserts! admin (err u9300))
        (asserts! (is-eq (contract-of t) .zz-ft) (err u9301))
        (asserts! (is-eq (var-get operation-nonce) n0) (err u9302))
        (asserts! (is-eq (unwrap-panic (contract-call? .zz-ft get-balance current-contract))
                         (- bal0 amount)) (err u9303))
        (ok true))
      e (begin (rv-restore s) (ok false)))))

;; P4. sBTC withdrawal: only an admin; moves (locks) exactly amount + max-fee,
;; or queues an sbtc-withdraw op that moves nothing
(define-public (test-sbtc-withdrawal (amount uint) (max-fee uint))
  (let ((s (rv-snap)) (admin (rv-is-admin tx-sender))
        (a (+ u547 (mod amount u200000))) (f (mod max-fee u5000))
        (bal0 (rv-sbtc-of current-contract))
        (n0 (var-get operation-nonce)) (queue (would-exceed-sbtc-threshold (+ a f))))
    (match (sbtc-initiate-withdrawal a RV-BTC-RECIPIENT f none none)
      okv (begin
        (asserts! admin (err u9400))
        (if queue
          (let ((op (unwrap! (map-get? pending-operations n0) (err u9401))))
            (asserts! (is-eq (rv-sbtc-of current-contract) bal0) (err u9402))
            (asserts! (and (is-eq (get op-type op) "sbtc-withdraw") (is-eq (get amount op) a)
                           (is-eq (get recipient op) current-contract)) (err u9403))
            (ok true))
          (begin
            (asserts! (is-eq (rv-sbtc-of current-contract) (- bal0 (+ a f))) (err u9404))
            (asserts! (is-eq (var-get operation-nonce) n0) (err u9405))
            (ok true))))
      e (begin (rv-restore s) (ok false)))))

;; P5. a pending op pays out at most once, never after a veto, never before its
;; cooldown, only for an admin, and exactly its recorded amount.
(define-private (rv-exec (id uint) (op-type (string-ascii 20)))
  (if (is-eq op-type "stx-transfer")
    (execute-pending-stx-transfer id none)
    (if (is-eq op-type "sbtc-transfer")
      (execute-pending-sbtc-transfer id none)
      (match (execute-pending-sbtc-withdrawal id) v (ok true) e (err e)))))
(define-public (test-execute-pending-once (seed uint))
  (let ((n (var-get operation-nonce)))
    (if (is-eq n u0)
      (ok false)
      (let ((id (mod seed n))
            (op (unwrap-panic (map-get? pending-operations id)))
            (t (get op-type op))
            (s (rv-snap)) (admin (rv-is-admin tx-sender))
            (stx0 (stx-get-balance current-contract)) (sb0 (rv-sbtc-of current-contract))
            (due (>= burn-block-height (get execute-after op))))
        (match (rv-exec id t)
          okv (begin
            (asserts! admin (err u9500))
            (asserts! (not (get executed op)) (err u9501))
            (asserts! (not (get vetoed op)) (err u9502))
            (asserts! due (err u9503))
            (asserts! (get executed (unwrap-panic (map-get? pending-operations id))) (err u9504))
            (asserts! (if (is-eq t "stx-transfer")
                        (and (is-eq (stx-get-balance current-contract) (- stx0 (get amount op)))
                             (is-eq (rv-sbtc-of current-contract) sb0))
                        (and (is-eq (stx-get-balance current-contract) stx0)
                             (<= (rv-sbtc-of current-contract) (- sb0 (get amount op)))))
              (err u9505))
            ;; the same op again must be refused with err-already-executed
            (asserts! (is-eq (match (rv-exec id t) v u0 e2 e2) u4014) (err u9506))
            (ok true))
          e (begin
            (rv-restore s)
            (map-set pending-operations id op)
            (asserts! (is-eq (stx-get-balance current-contract) stx0) (err u9507))
            (ok false)))))))

;; P6. veto: only an admin, never after execution; a vetoed op never pays
(define-public (test-veto-blocks-execution (seed uint))
  (let ((n (var-get operation-nonce)))
    (if (is-eq n u0)
      (ok false)
      (let ((id (mod seed n))
            (op (unwrap-panic (map-get? pending-operations id)))
            (s (rv-snap)) (admin (rv-is-admin tx-sender))
            (stx0 (stx-get-balance current-contract)) (sb0 (rv-sbtc-of current-contract)))
        (match (veto-operation id none none)
          okv (begin
            (asserts! admin (err u9600))
            (asserts! (not (get executed op)) (err u9601))
            (asserts! (get vetoed (unwrap-panic (map-get? pending-operations id))) (err u9602))
            (asserts! (is-err (rv-exec id (get op-type op))) (err u9603))
            (asserts! (and (is-eq (stx-get-balance current-contract) stx0)
                           (is-eq (rv-sbtc-of current-contract) sb0)) (err u9604))
            (ok true))
          e (begin
            (rv-restore s)
            (ok false)))))))

;; P7. stake: only an admin; the position is exactly {amount, Juice signer,
;; next cycle, 96 cycles}; no STX leaves the safe
(define-public (test-stake (amount uint))
  (let ((s (rv-snap)) (admin (rv-is-admin tx-sender))
        (info0 (contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-staker-info current-contract))
        (bal0 (stx-get-balance current-contract)) (cyc (rv-cycle)))
    (match (stake-stx-juice amount none none none)
      okv (let ((info (unwrap! (contract-call? 'SP000000000000000000002Q6VF78.pox-5
                          get-staker-info current-contract) (err u9701))))
        (asserts! admin (err u9700))
        (asserts! (is-none info0) (err u9702))
        (asserts! (and (is-eq (get amount-ustx info) amount) (is-eq (get signer info) JUICE-SIGNER)
                       (is-eq (get num-cycles info) NUM-CYCLES)
                       (is-eq (get first-reward-cycle info) (+ cyc u1))) (err u9703))
        (asserts! (<= amount bal0) (err u9704))
        (asserts! (is-eq (stx-get-balance current-contract) bal0) (err u9705))
        (ok true))
      e (begin (rv-restore s) (ok false)))))

;; P8. update-stake: only an admin; amount grows by exactly the increase, which
;; must come from unlocked STX; the lock grows by exactly cycles-to-extend
(define-public (test-update-stake (amount-increase uint) (cycles uint))
  (let ((s (rv-snap)) (admin (rv-is-admin tx-sender)) (c (mod cycles u4))
        (info0 (contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-staker-info current-contract))
        (unl0 (get unlocked (rv-stx-account))) (unl-c0 (rv-unlock-cycle))
        (bal0 (stx-get-balance current-contract)))
    (match (update-stake-stx-juice amount-increase c none none none)
      okv (let ((i0 (unwrap! info0 (err u9801)))
                (info (unwrap! (contract-call? 'SP000000000000000000002Q6VF78.pox-5
                          get-staker-info current-contract) (err u9802))))
        (asserts! admin (err u9800))
        (asserts! (<= amount-increase unl0) (err u9803))
        (asserts! (is-eq (get amount-ustx info) (+ (get amount-ustx i0) amount-increase)) (err u9804))
        (asserts! (is-eq (rv-unlock-cycle) (+ unl-c0 c)) (err u9805))
        (asserts! (is-eq (get signer info) JUICE-SIGNER) (err u9806))
        (asserts! (is-eq (stx-get-balance current-contract) bal0) (err u9807))
        (ok true))
      e (begin (rv-restore s) (ok false)))))

;; P9. unstake: only an admin; the position ends after the NEXT cycle with the
;; same amount still locked until then; after it the keeper cannot re-lock
(define-public (test-unstake)
  (let ((s (rv-snap)) (admin (rv-is-admin tx-sender))
        (info0 (contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-staker-info current-contract))
        (bal0 (stx-get-balance current-contract)) (cyc (rv-cycle)))
    (match (unstake none none)
      okv (let ((i0 (unwrap! info0 (err u9901)))
                (info (unwrap! (contract-call? 'SP000000000000000000002Q6VF78.pox-5
                          get-staker-info current-contract) (err u9902))))
        (asserts! admin (err u9900))
        (asserts! (is-eq (rv-unlock-cycle) (+ cyc u1)) (err u9903))
        (asserts! (is-eq (get amount-ustx info) (get amount-ustx i0)) (err u9904))
        (asserts! (is-eq (stx-get-balance current-contract) bal0) (err u9905))
        (asserts! (is-err (restake)) (err u9906))
        (ok true))
      e (begin (rv-restore s) (ok false)))))

;; P10. restake: only the keeper (contract-caller); moves no STX; adds exactly
;; the unlocked STX; rolls the lock to next cycle + 96 and never shortens it;
;; keeps the Juice signer; does NOT refresh owner activity
(define-public (test-restake)
  (let ((is-keeper (is-eq tx-sender (var-get keeper)))
        (act0 (var-get last-activity-block))
        (info0 (contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-staker-info current-contract))
        (unl0 (get unlocked (rv-stx-account))) (unl-c0 (rv-unlock-cycle))
        (bal0 (stx-get-balance current-contract)) (cyc (rv-cycle)))
    (match (restake)
      res (let ((i0 (unwrap! info0 (err u9951)))
                (info (unwrap! (contract-call? 'SP000000000000000000002Q6VF78.pox-5
                          get-staker-info current-contract) (err u9952)))
                (target (+ cyc u1 NUM-CYCLES)))
        (asserts! is-keeper (err u9950))
        (asserts! (> unl-c0 (+ cyc u1)) (err u9953))
        (asserts! (is-eq (get amount res) unl0) (err u9954))
        (asserts! (is-eq (get amount-ustx info) (+ (get amount-ustx i0) unl0)) (err u9955))
        (asserts! (is-eq (rv-unlock-cycle) (if (> target unl-c0) target unl-c0)) (err u9956))
        (asserts! (is-eq (get signer info) JUICE-SIGNER) (err u9957))
        (asserts! (is-eq (stx-get-balance current-contract) bal0) (err u9958))
        (asserts! (is-eq (var-get last-activity-block) act0) (err u9959))
        (ok true))
      e (begin
        ;; a non-keeper is refused (u4001, or u4040 first when nothing is staked)
        (asserts! (or is-keeper (is-eq e u4001) (is-eq e u4040)) (err u9960))
        (ok false)))))

;; P11. set-keeper: only an admin
(define-public (test-set-keeper (k principal))
  (let ((s (rv-snap)) (admin (rv-is-admin tx-sender)) (k0 (var-get keeper)) (o0 (var-get owner)))
    (match (set-keeper k none none)
      okv (begin
        (asserts! admin (err u9970))
        (asserts! (is-eq (var-get keeper) k) (err u9971))
        (asserts! (is-eq (var-get owner) o0) (err u9972))
        (ok true))
      e (begin
        (rv-restore s)
        (asserts! (is-eq (var-get keeper) k0) (err u9973))
        (ok false)))))

;; P12. recover-inactive-wallet: only the recovery address, only when inactive;
;; the new admin is the only admin, the owner, and the keeper (auto-restake off)
(define-public (test-recover-inactive (new-admin principal))
  (let ((s (rv-snap)) (o0 (var-get owner)) (o0-admin (rv-is-admin (var-get owner)))
        (k0 (var-get keeper))
        (allowed (and (is-inactive) (is-eq tx-sender (var-get recovery-address)))))
    (match (recover-inactive-wallet new-admin)
      okv (begin
        (asserts! allowed (err u9980))
        (asserts! (is-eq (var-get owner) new-admin) (err u9981))
        (asserts! (rv-is-admin new-admin) (err u9982))
        (asserts! (or (is-eq o0 new-admin) (not (rv-is-admin o0))) (err u9983))
        (asserts! (is-eq (var-get keeper) new-admin) (err u9984))
        (asserts! (is-eq (var-get last-activity-block) burn-block-height) (err u9985))
        (ok true))
      e (begin
        (rv-restore s)
        (if o0-admin (map-set admins o0 true) true)
        (asserts! (and (is-eq (var-get owner) o0) (is-eq (var-get keeper) k0)) (err u9986))
        (ok false)))))

;; P13. owner-only configuration entry points refuse everyone else
(define-public (test-admin-only-config (amount uint) (who principal) (enabled bool) (cd uint))
  (let ((s (rv-snap)) (admin (rv-is-admin tx-sender))
        (gas0 (var-get pending-max-gas)) (cfg0 (var-get wallet-config))
        (pt0 (var-get pending-transfer)) (lock0 (var-get token-lock-enabled))
        (r1 (propose-max-gas-amount amount))
        (r2 (propose-transfer-wallet who))
        (r3 (toggle-token-lock enabled none none))
        (r4 (signal-config-change amount amount (+ u100 (mod cd u4100)))))
    (if admin
      (begin
        ;; an admin's proposals stay inside their bounds
        (asserts! (is-eq (is-ok r1) (<= amount MAX-GAS-CEILING)) (err u9990))
        (asserts! (<= (get amount (var-get pending-max-gas)) MAX-GAS-CEILING) (err u9991))
        (asserts! (is-eq (is-ok r2) (not (is-eq who tx-sender))) (err u9992))
        (asserts! (is-ok r3) (err u9993))
        (asserts! (is-eq (var-get token-lock-enabled) enabled) (err u9994))
        ;; signalling never applies the new thresholds by itself
        (asserts! (and (is-eq (get stx-threshold (var-get wallet-config)) (get stx-threshold cfg0))
                       (is-eq (get sbtc-threshold (var-get wallet-config)) (get sbtc-threshold cfg0))
                       (is-eq (get cooldown-period (var-get wallet-config)) (get cooldown-period cfg0)))
          (err u9995))
        (ok true))
      (begin
        (asserts! (and (is-err r1) (is-err r2) (is-err r3) (is-err r4)) (err u9996))
        (rv-restore s)
        (asserts! (and (is-eq (var-get pending-max-gas) gas0) (is-eq (var-get wallet-config) cfg0)
                       (is-eq (var-get pending-transfer) pt0)
                       (is-eq (var-get token-lock-enabled) lock0)) (err u9997))
        (ok true)))))
