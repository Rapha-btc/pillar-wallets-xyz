(use-trait extension-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.extension-trait.extension-trait)
(use-trait gas-trait 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.gas-station-trait.gas-station-trait)

(use-trait sip-010-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)
(use-trait sip-009-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)
(use-trait pool-trait 'SP2ZNGJ85ENDY6QRHQ5P2D4FXKGZWCKTB2T0Z55KS.dexterity-traits-v0.liquidity-pool-trait)
(use-trait dex-trait 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.faktory-dex-trait-v2.dex-trait)
(use-trait pre-trait 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.prelaunch-faktory-trait-v1.prelaunch-trait)
(use-trait token-trait 'SP3XXMS38VTAWTVPE5682XSBFXPTH7XCPEBTX8AN2.faktory-trait-v1.sip-010-trait)
(use-trait nftmarket-trait 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-nftmarket-trait.nftmarket-trait)

(impl-trait 'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK.pillar-wallet-trait.pillar-wallet-trait)

(define-constant err-unauthorised (err u4001))
(define-constant err-invalid-signature (err u4002))
(define-constant err-forbidden (err u4003))
(define-constant err-unregistered-pubkey (err u4004))
(define-constant err-not-admin-pubkey (err u4005))
(define-constant err-signature-replay (err u4006))
(define-constant err-no-auth-id (err u4007))
(define-constant err-no-message-hash (err u4008))
(define-constant err-inactive-required (err u4009))
(define-constant err-no-pending-recovery (err u4010))
(define-constant err-not-whitelisted (err u4011))
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
(define-constant err-already-initialized (err u4022))
(define-constant err-token-locked (err u4023))
(define-constant err-limit-expired (err u4024))
(define-constant err-limit-not-hit (err u4025))
(define-constant err-init-already-proposed (err u4026))
(define-constant err-no-pending-init (err u4027))
(define-constant err-init-not-pending-admin (err u4028))
(define-constant err-init-not-accepted (err u4029))
(define-constant err-zero-amount (err u4030))
(define-constant err-fatal-owner-not-admin (err u9999))

(define-constant INACTIVITY-PERIOD u52560)
(define-constant MAX-GAS-CEILING u10000)

(define-constant MAX-CONFIG-COOLDOWN u4032)

(define-constant MIN-COOLDOWN u144)
(define-constant DEPLOYED-BURNT-BLOCK burn-block-height)
(define-constant SBTC-CONTRACT 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)
(define-constant FAKFUN-DEPLOYER 'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK)
(define-constant PUBK 0x000000000000000000000000000000000000000000000000000000000000000000)

(define-constant RP-ID-HASH-FAKFUN-COM 0x5e8ba70d734d2bd57e0225bfd9a25f2c4d70db36fa1128e5eeb00cdab7a1ccdb)
(define-constant RP-ID-HASH-FAK-FUN 0xb877fea5df49f6d2fe544db0c7ced754f117ade85f60266bc217db3b239f2249)

(define-constant POX5 'SP000000000000000000002Q6VF78.pox-5)

(define-constant JUICE-SIGNER
  'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-pool-stx-signer)

(define-constant NUM-CYCLES u96)

(define-constant OPCODE-BUY 0x00)
(define-constant OPCODE-SELL 0x01)
(define-constant OPCODE-BUY-SEATS 0x02)
(define-constant OPCODE-REFUND 0x03)

(define-constant BOB-CONTRACT 'SP2VG7S0R4Z8PYNYCAQ04HCBX1MH75VT11VXCWQ6G.built-on-bitcoin-stxcity)
(define-constant BOB-BURN-AMOUNT u1000000)

(define-constant EXECUTE-OP-BUY 0x00)
(define-constant EXECUTE-OP-SELL 0x01)
(define-constant EXECUTE-OP-ADD-LIQ 0x02)
(define-constant EXECUTE-OP-REMOVE-LIQ 0x03)

(define-constant NFT-OP-LIST 0x00)
(define-constant NFT-OP-BUY 0x01)
(define-constant NFT-OP-UNLIST 0x02)
(define-constant NFT-OP-UPDATE-PRICE 0x03)
(define-constant NFT-OP-UPDATE-FT 0x04)

(define-data-var last-activity-block uint burn-block-height)
(define-data-var recovery-address principal 'SP000000000000000000002Q6VF78)
(define-data-var initial-pubkey (buff 33) PUBK)
(define-data-var is-initialized bool false)
(define-data-var pubkey-initialized bool false)

(define-data-var pending-init-admin {
  new-admin: principal,
  proposed-at: uint,
  accepted: bool,
} {
  new-admin: 'SP000000000000000000002Q6VF78,
  proposed-at: u0,
  accepted: false,
})

(define-data-var owner principal 'SP000000000000000000002Q6VF78)
(define-data-var pending-recovery principal 'SP000000000000000000002Q6VF78)
(define-data-var pending-transfer principal 'SP000000000000000000002Q6VF78)

(define-fungible-token ect)

(define-map used-pubkey-authorizations
  (buff 32)
  (buff 33)
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

(define-data-var pubkey-cooldown-period uint u432)
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

(define-map whitelisted-extensions
  principal
  bool
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
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
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
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
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
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
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
    })
    (var-set operation-nonce (+ op-id u1))
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
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
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
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

(define-public (whitelist-extension (extension principal))
  (begin
    (try! (is-admin-calling tx-sender))
    (create-pending-operation "whitelist-ext" u0 extension none (some extension)
      none
    )
  )
)

(define-public (execute-pending-whitelist
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
    (asserts! (is-eq (get op-type op) "whitelist-ext") err-invalid-operation)
    (asserts! (not (get executed op)) err-already-executed)
    (asserts! (not (get vetoed op)) err-vetoed)
    (asserts! (>= burn-block-height (get execute-after op))
      err-cooldown-not-passed
    )
    (try! (is-authorized (some {
      message-hash: (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
        build-whitelist-extension-hash {
        auth-id: (get auth-id sig-auth),
        op-id: op-id,
        extension: (unwrap! (get extension op) err-invalid-operation),
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
    (map-set whitelisted-extensions
      (unwrap! (get extension op) err-invalid-operation) true
    )
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-extension-whitelisted (unwrap-panic (get extension op))
    ))
    (ok true)
  )
)

(define-public (remove-extension-whitelist
    (extension principal)
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
    (match sig-auth
      sig-auth-details (begin
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-remove-extension-whitelist-hash {
            auth-id: (get auth-id sig-auth-details),
            extension: extension,
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
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-extension-removed extension
    ))
    (ok (map-delete whitelisted-extensions extension))
  )
)

(define-read-only (is-extension-whitelisted (extension principal))
  (default-to false (map-get? whitelisted-extensions extension))
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
        (unwrap-panic (create-pending-operation "stx-transfer" amount recipient none none none))
        (ok true)
      )
      (begin
        (add-spent-stx amount)
        (try! (contract-call?
          'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
          log-stx-transfer amount recipient memo
        ))
        (as-contract? ((with-stx amount))
          (match memo
            to-print (try! (stx-transfer-memo? amount tx-sender recipient to-print))
            (try! (stx-transfer? amount tx-sender recipient))
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
    (map-set pending-operations op-id (merge op { executed: true }))
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-stx-transfer (get amount op) (get recipient op) memo
    ))
    (as-contract? ((with-stx (get amount op)))
      (match memo
        to-print (try! (stx-transfer-memo? (get amount op) tx-sender (get recipient op) to-print))
        (try! (stx-transfer? (get amount op) tx-sender (get recipient op)))
      ))
  )
)

(define-public (extension-call
    (extension <extension-trait>)
    (payload (buff 2048))
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
    (asserts! (is-extension-whitelisted (contract-of extension))
      err-not-whitelisted
    )
    (match sig-auth
      sig-auth-details (begin
        (asserts! (not (var-get token-lock-enabled)) err-token-locked)
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-extension-call-hash {
            auth-id: (get auth-id sig-auth-details),
            extension: (contract-of extension),
            payload: payload,
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
    (try! (ft-mint? ect u1 current-contract))
    (try! (ft-burn? ect u1 current-contract))
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-extension-call (contract-of extension) payload
    ))
    (as-contract? ((with-all-assets-unsafe))
      (try! (contract-call? extension call payload))
    )
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
          (some SBTC-CONTRACT) none none
        ))
        (ok true)
      )
      (begin
        (if (is-eq (contract-of sip010) SBTC-CONTRACT)
          (add-spent-sbtc amount)
          true
        )
        (try! (contract-call?
          'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
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
    (map-set pending-operations op-id (merge op { executed: true }))
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
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
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-sip009-transfer nft-id recipient (contract-of sip009)
    ))
    (as-contract? ((with-nft (contract-of sip009) token-name (list nft-id)))
      (try! (contract-call? sip009 transfer nft-id current-contract recipient))
    )
  )
)

(define-public (faktory-execute
    (pool <pool-trait>)
    (amount uint)
    (opcode (optional (buff 16)))
    (sip010 <sip-010-trait>)
    (sip010-name (string-ascii 128))
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
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-faktory-execute-hash {
            auth-id: (get auth-id sig-auth-details),
            pool: (contract-of pool),
            amount: amount,
            opcode: opcode,
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
    (let ((op (get-byte (default-to 0x00 opcode) u0)))
      (if (or
          (is-eq op EXECUTE-OP-BUY)
          (is-eq op EXECUTE-OP-SELL)
          (is-eq op EXECUTE-OP-REMOVE-LIQ)
        )
        (as-contract? ((with-ft (contract-of sip010) sip010-name amount))
          (try! (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-core-v2 execute
            pool amount opcode
          ))
        )
        (if (is-eq op EXECUTE-OP-ADD-LIQ)
          (let ((liq-quote (unwrap! (contract-call? pool quote amount (some 0x02))
              err-invalid-operation
            )))
            (as-contract?
              (
                (with-ft SBTC-CONTRACT "sbtc-token" (get dx liq-quote))
                (with-ft (contract-of sip010) sip010-name (get dy liq-quote))
              )
              (try! (contract-call?
                'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-core-v2
                execute pool amount opcode
              ))
            )
          )
          err-invalid-operation
        )
      )
    )
  )
)

(define-private (get-byte
    (opcode (buff 16))
    (position uint)
  )
  (default-to 0x00 (element-at? opcode position))
)

(define-public (faktory-execute-limit
    (pool <pool-trait>)
    (amount uint)
    (opcode (optional (buff 16)))
    (sip010 <sip-010-trait>)
    (sip010-name (string-ascii 128))
    (limit-out uint)
    (expiry-burn-block uint)
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
    (update-activity)
    (asserts! (not (var-get token-lock-enabled)) err-token-locked)
    (asserts! (<= burn-block-height expiry-burn-block) err-limit-expired)
    (try! (is-authorized (some {
      message-hash: (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
        build-faktory-execute-limit-hash {
        auth-id: (get auth-id sig-auth),
        pool: (contract-of pool),
        amount: amount,
        opcode: opcode,
        limit-out: limit-out,
        expiry-burn-block: expiry-burn-block,
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
    (let ((op (get-byte (default-to 0x00 opcode) u0)))
      (if (or (is-eq op EXECUTE-OP-BUY) (is-eq op EXECUTE-OP-SELL))
        (let ((result (try! (as-contract? ((with-ft (contract-of sip010) sip010-name amount))
            (try! (contract-call?
              'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-core-v2 execute
              pool amount opcode
            ))
          ))))
          (asserts! (>= (get dy result) limit-out) err-limit-not-hit)
          (ok result)
        )
        err-invalid-operation
      )
    )
  )
)

(define-public (faktory-place-order
    (dex <dex-trait>)
    (token <token-trait>)
    (token-name (string-ascii 128))
    (amount uint)
    (opcode (optional (buff 16)))
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
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-faktory-place-order-hash {
            auth-id: (get auth-id sig-auth-details),
            dex: (contract-of dex),
            amount: amount,
            opcode: opcode,
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
    (let ((op (get-byte (default-to 0x00 opcode) u0)))
      (if (is-eq op OPCODE-BUY)
        (as-contract? ((with-ft SBTC-CONTRACT "sbtc-token" amount))
          (try! (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-core-v2
            place-order dex token amount opcode
          ))
        )
        (if (is-eq op OPCODE-SELL)
          (as-contract? ((with-ft (contract-of token) token-name amount))
            (try! (contract-call?
              'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-core-v2
              place-order dex token amount opcode
            ))
          )
          err-invalid-operation
        )
      )
    )
  )
)

(define-public (faktory-process
    (pre <pre-trait>)
    (seat-count uint)
    (opcode (optional (buff 16)))
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
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-faktory-process-hash {
            auth-id: (get auth-id sig-auth-details),
            pre: (contract-of pre),
            seat-count: seat-count,
            opcode: opcode,
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
    (let ((operation (get-byte (default-to 0x02 opcode) u0)))
      (if (is-eq operation OPCODE-BUY-SEATS)
        (let ((seat-price (try! (contract-call? pre get-seat-price))))
          (as-contract?
            ((with-ft SBTC-CONTRACT "sbtc-token" (* seat-count seat-price)))
            (try! (contract-call?
              'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-core-v2 process
              pre seat-count (some current-contract) opcode
            ))
          )
        )
        (if (is-eq operation OPCODE-REFUND)
          (as-contract? ()
            (try! (contract-call?
              'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-core-v2 process
              pre seat-count (some current-contract) opcode
            ))
          )
          err-invalid-operation
        )
      )
    )
  )
)

(define-public (faktory-process-claim
    (pre <pre-trait>)
    (token <token-trait>)
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
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-faktory-process-claim-hash {
            auth-id: (get auth-id sig-auth-details),
            pre: (contract-of pre),
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
    (as-contract? ()
      (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-core-v2
        process-claim pre token (some current-contract)
      ))
    )
  )
)

(define-public (faktory-fee-airdrop
    (pre <pre-trait>)
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
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-faktory-fee-airdrop-hash {
            auth-id: (get auth-id sig-auth-details),
            pre: (contract-of pre),
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
    (as-contract? ()
      (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-core-v2
        process-fee-airdrop pre
      ))
    )
  )
)

(define-public (faktory-burn-bob
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
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-faktory-burn-bob-hash { auth-id: (get auth-id sig-auth-details) }
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
    (as-contract? ((with-ft BOB-CONTRACT "BOB" BOB-BURN-AMOUNT))
      (try! (contract-call? 'SP29D6YMDNAKN1P045T6Z817RTE1AC0JAA99WAX2B.burn-bob-faktory
        daily-burn
      ))
    )
  )
)

(define-public (faktory-nft-execute
    (marketplace <nftmarket-trait>)
    (token-id uint)
    (nft-contract <sip-009-trait>)
    (nft-name (string-ascii 128))
    (ft-contract <sip-010-trait>)
    (ft-name (string-ascii 128))
    (price uint)
    (opcode (optional (buff 16)))
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
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-faktory-nft-execute-hash {
            auth-id: (get auth-id sig-auth-details),
            marketplace: (contract-of marketplace),
            token-id: token-id,
            ft-contract: (contract-of ft-contract),
            price: price,
            opcode: opcode,
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
    (let ((op (get-byte (default-to 0x00 opcode) u0)))
      (if (is-eq op NFT-OP-LIST)
        (as-contract?
          ((with-nft (contract-of nft-contract) nft-name (list token-id)))
          (try! (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-nfts-core
            list-nft marketplace token-id nft-contract ft-contract price
          ))
        )
        (if (is-eq op NFT-OP-BUY)
          (as-contract? ((with-ft (contract-of ft-contract) ft-name price))
            (try! (contract-call?
              'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-nfts-core
              buy-nft marketplace token-id nft-contract ft-contract
            ))
          )
          (if (is-eq op NFT-OP-UNLIST)
            (as-contract? ()
              (try! (contract-call?
                'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-nfts-core
                unlist-nft marketplace token-id nft-contract
              ))
            )
            (if (is-eq op NFT-OP-UPDATE-PRICE)
              (as-contract? ()
                (try! (contract-call?
                  'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-nfts-core
                  update-price marketplace token-id price
                ))
              )
              (if (is-eq op NFT-OP-UPDATE-FT)
                (as-contract? ()
                  (try! (contract-call?
                    'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-nfts-core
                    update-listing-ft marketplace token-id ft-contract price
                  ))
                )
                err-invalid-operation
              )
            )
          )
        )
      )
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
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
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
    (map-set admins pending true)
    (map-delete admins (var-get owner))
    (var-set owner pending)
    (var-set pending-transfer 'SP000000000000000000002Q6VF78)
    (update-activity)
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
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
      (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.clarity-5-webauthn-v3
        get-rp-id-hash authenticator-data
      )
      err-invalid-signature
    )))
    (try! (is-admin-pubkey pubkey))
    (asserts!
      (or
        (is-eq auth-rp-id RP-ID-HASH-FAKFUN-COM)
        (is-eq auth-rp-id RP-ID-HASH-FAK-FUN)
      )
      err-invalid-signature
    )
    (asserts!
      (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.clarity-5-webauthn-v3
        is-user-verified authenticator-data
      )
      err-invalid-signature
    )
    (ok (asserts!
      (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.clarity-5-webauthn-v3
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
  (begin
    (try! (verify-signature message-hash pubkey signature authenticator-data
      client-data-prefix client-data-suffix
    ))
    (asserts! (is-none (map-get? used-pubkey-authorizations message-hash))
      err-signature-replay
    )
    (map-set used-pubkey-authorizations message-hash pubkey)
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

(define-public (propose-admin-with-signature
    (new-admin principal)
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
    (asserts! (not (var-get is-initialized)) err-already-initialized)
    (asserts! (is-eq (get proposed-at (var-get pending-init-admin)) u0)
      err-init-already-proposed
    )
    (try! (is-authorized (some {
      message-hash: (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
        build-add-admin-hash {
        auth-id: (get auth-id sig-auth),
        new-admin: new-admin,
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
    (var-set pending-init-admin {
      new-admin: new-admin,
      proposed-at: burn-block-height,
      accepted: false,
    })
    (ok true)
  )
)

(define-public (accept-admin-proposal)
  (let ((pending (var-get pending-init-admin)))
    (asserts! (not (var-get is-initialized)) err-already-initialized)
    (asserts! (not (is-eq (get proposed-at pending) u0)) err-no-pending-init)
    (asserts! (is-eq tx-sender (get new-admin pending))
      err-init-not-pending-admin
    )
    (var-set pending-init-admin (merge pending { accepted: true }))
    (ok true)
  )
)

(define-public (confirm-admin-with-signature
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
      (pending (var-get pending-init-admin))
      (new-a (get new-admin pending))
    )
    (asserts! (not (var-get is-initialized)) err-already-initialized)
    (asserts! (not (is-eq (get proposed-at pending) u0)) err-no-pending-init)
    (asserts! (get accepted pending) err-init-not-accepted)
    (asserts!
      (>= burn-block-height
        (+ (get proposed-at pending) (var-get pubkey-cooldown-period))
      )
      err-in-cooldown
    )
    (try! (is-authorized (some {
      message-hash: (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
        build-confirm-admin-hash {
        auth-id: (get auth-id sig-auth),
        new-admin: new-a,
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
    (map-delete admins 'SP000000000000000000002Q6VF78)
    (map-set admins new-a true)
    (map-set pubkey-to-admin (get pubkey sig-auth) new-a)
    (var-set owner new-a)
    (update-activity)
    (var-set is-initialized true)
    (var-set pending-init-admin {
      new-admin: 'SP000000000000000000002Q6VF78,
      proposed-at: u0,
      accepted: false,
    })
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-admin-added new-a
    ))
    (ok true)
  )
)

(define-public (veto-pending-init
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
  (let ((pending (var-get pending-init-admin)))
    (asserts! (not (var-get is-initialized)) err-already-initialized)
    (asserts! (not (is-eq (get proposed-at pending) u0)) err-no-pending-init)
    (try! (is-authorized (some {
      message-hash: (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
        build-veto-init-hash {
        auth-id: (get auth-id sig-auth),
        new-admin: (get new-admin pending),
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
    (var-set pending-init-admin {
      new-admin: 'SP000000000000000000002Q6VF78,
      proposed-at: u0,
      accepted: false,
    })
    (ok true)
  )
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
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
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
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
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
    (var-set last-activity-block burn-block-height)
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-recover-inactive-wallet new-admin tx-sender
    ))
    (ok true)
  )
)

(define-read-only (locked-ustx)
  (get locked (stx-account current-contract))
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

    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-stake-stx-stacking-dao amount-ustx
    ))

    (try! (as-contract? ((with-staking amount-ustx))
      (try! (contract-call? POX5 stake
        JUICE-SIGNER amount-ustx NUM-CYCLES burn-block-height none
      ))
    ))
    (print {
      event: "stake-stx-juice",
      amount-ustx: amount-ustx,
      num-cycles: NUM-CYCLES,
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
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-stake-stx-stacking-dao amount-increase
    ))

    (try! (as-contract? ((with-staking (+ (locked-ustx) amount-increase)))
      (try! (contract-call? POX5 stake-update
        JUICE-SIGNER JUICE-SIGNER cycles-to-extend amount-increase none
      ))
    ))
    (print {
      event: "update-stake-stx-juice",
      amount-increase: amount-increase,
      cycles-to-extend: cycles-to-extend,
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

    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-revoke-fast-pool
    ))

    (try! (as-contract? ((with-pox))
      (try! (contract-call? POX5 unstake JUICE-SIGNER))
    ))
    (print { event: "unstake" })
    (ok true)
  )
)

(define-public (wager-deposit
    (token <sip-010-trait>)
    (token-name (string-ascii 128))
    (amount uint)
    (pubkey (buff 33))
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
        (try! (is-authorized (some {
          message-hash: (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.smart-wallet-standard-auth-helpers-v7
            build-wager-deposit-hash {
            auth-id: (get auth-id sig-auth-details),
            amount: amount,
            pubkey: pubkey,
            token: (contract-of token),
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
    (asserts!
      (is-eq (some current-contract)
        (contract-call? 'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK.game-wager-v2-4
          get-registered-wallet pubkey
        ))
      err-unauthorised
    )
    (as-contract? ((with-ft (contract-of token) token-name amount))
      (try! (contract-call? 'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK.game-wager-v2-4
        deposit token amount pubkey
      ))
    )
  )
)

(map-set admins 'SP000000000000000000002Q6VF78 true)

(define-public (onboard (pubkey (buff 33)))
  (begin
    (asserts! (is-eq tx-sender FAKFUN-DEPLOYER) err-unauthorised)
    (asserts! (not (var-get pubkey-initialized)) err-unauthorised)
    (var-set initial-pubkey pubkey)
    (map-set pubkey-to-admin pubkey 'SP000000000000000000002Q6VF78)
    (var-set pubkey-initialized true)

    (map-set whitelisted-extensions
      'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.xtrata-inscribe true
    )
    (try! (as-contract? ()
      (try! (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
        register-wallet
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-v16
      ))
    ))
    (try! (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-core
      log-wallet-initialized pubkey
    ))
    (ok true)
  )
)
