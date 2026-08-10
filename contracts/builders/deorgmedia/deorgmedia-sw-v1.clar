;; deorgmedia-sw-v1
;; Passkey (WebAuthn) smart wallet for DeOrganized publishing.
;; Trimmed from fakfun-wallet-v2: keeps the full auth / init / recovery /
;; pubkey-management machinery, simple stx-transfer / sip010-transfer funding,
;; gas sponsorship, and adds the headline `inscribe-article` flow that mints a
;; tweet-length on-chain article via Xtrata's deployed master contract.
;;
;; Pure POC: fully self-contained. No central logger/registry contract, no
;; event logging, no canonical-hash registration. A thin fork of
;; fakfun-wallet-v2 with just the killer feature.

(use-trait gas-trait 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.gas-station-trait.gas-station-trait)
(use-trait sip-010-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

(impl-trait 'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK.pillar-wallet-trait.pillar-wallet-trait)

;; --- errors (mirrored from fakfun-wallet-v2, only those used) ---
(define-constant err-unauthorised (err u4001))
(define-constant err-invalid-signature (err u4002))
(define-constant err-forbidden (err u4003))
(define-constant err-unregistered-pubkey (err u4004))
(define-constant err-not-admin-pubkey (err u4005))
(define-constant err-signature-replay (err u4006))
(define-constant err-inactive-required (err u4009))
(define-constant err-no-pending-recovery (err u4010))
(define-constant err-in-cooldown (err u4012))
(define-constant err-no-pending-transfer (err u4020))
(define-constant err-no-pending-pubkey (err u4021))
(define-constant err-already-initialized (err u4022))
(define-constant err-init-already-proposed (err u4026))
(define-constant err-no-pending-init (err u4027))
(define-constant err-init-not-pending-admin (err u4028))
(define-constant err-init-not-accepted (err u4029))

(define-constant INACTIVITY-PERIOD u52560)
(define-constant DEPLOYED-BURNT-BLOCK burn-block-height)
(define-constant SBTC-CONTRACT 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)

;; Backend deployer that onboards wallets (same address pillar uses).
(define-constant DEORG-DEPLOYER 'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK)
(define-constant PUBK 0x000000000000000000000000000000000000000000000000000000000000000000)

;; Dual RP-ID: the POC proves across BOTH fak.fun and DeOrganized.
;; Three accepted WebAuthn RP-IDs.
(define-constant RP-ID-HASH-FAKFUN-COM 0x5e8ba70d734d2bd57e0225bfd9a25f2c4d70db36fa1128e5eeb00cdab7a1ccdb)
(define-constant RP-ID-HASH-FAK-FUN 0xb877fea5df49f6d2fe544db0c7ced754f117ade85f60266bc217db3b239f2249)
;; sha256("deorganized.com")
(define-constant RP-ID-HASH-DEORGANIZED-COM 0x3d702f124b8ac7f832c41f892ca790627b5dbfa3266a52c5a18ed84c81115c00)

;; SIP018 prefix for the inline inscribe-article hash builder.
(define-constant SIP018_MSG_PREFIX 0x534950303138)

(define-data-var last-activity-block uint burn-block-height)
(define-data-var recovery-address principal 'SP000000000000000000002Q6VF78)
(define-data-var initial-pubkey (buff 33) PUBK)
(define-data-var is-initialized bool false)
(define-data-var pubkey-initialized bool false)

(define-data-var pending-pubkey {
  pubkey: (buff 33),
  proposed-at: uint,
} {
  pubkey: (var-get initial-pubkey),
  proposed-at: u0,
})

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

(define-data-var pubkey-cooldown-period uint u432)
(define-data-var max-gas-amount uint u1000)

(define-fungible-token ect)

(define-map used-pubkey-authorizations
  (buff 32)
  (buff 33)
)

(define-map admins
  principal
  bool
)

(define-map pubkey-to-admin
  (buff 33)
  principal
)

;; ---------------------------------------------------------------------------
;; auth machinery
;; ---------------------------------------------------------------------------

(define-read-only (is-admin-calling (caller principal))
  (ok (asserts! (is-some (map-get? admins caller)) err-unauthorised))
)

;; satisfies pillar-wallet-trait
(define-read-only (is-admin-pubkey (pubkey (buff 33)))
  (let ((user-opt (map-get? pubkey-to-admin pubkey)))
    (match user-opt
      user (ok (unwrap! (is-admin-calling user) err-not-admin-pubkey))
      err-unregistered-pubkey
    )
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
        (is-eq auth-rp-id RP-ID-HASH-DEORGANIZED-COM)
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

(define-read-only (get-owner)
  (ok (var-get owner))
)

(define-read-only (is-inactive)
  (> burn-block-height (+ INACTIVITY-PERIOD (var-get last-activity-block)))
)

(define-private (update-activity)
  (var-set last-activity-block burn-block-height)
)

(define-public (set-max-gas-amount (amount uint))
  (begin
    (try! (is-admin-calling tx-sender))
    (var-set max-gas-amount amount)
    (ok true)
  )
)

;; ---------------------------------------------------------------------------
;; init flow
;; ---------------------------------------------------------------------------

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
      g (try! (as-contract?
        ((with-ft SBTC-CONTRACT "sbtc-token" (var-get max-gas-amount)))
        (try! (contract-call? g pay-gas))
      ))
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
      g (try! (as-contract?
        ((with-ft SBTC-CONTRACT "sbtc-token" (var-get max-gas-amount)))
        (try! (contract-call? g pay-gas))
      ))
      true
    )
    (map-delete admins 'SP000000000000000000002Q6VF78)
    (map-set admins new-a true)
    (map-set pubkey-to-admin (get pubkey sig-auth) new-a)
    (var-set owner new-a)
    (update-activity)
    (var-set is-initialized true)
    (try! (contract-call? .deorgmedia-core log-admin-added new-a))
    (var-set pending-init-admin {
      new-admin: 'SP000000000000000000002Q6VF78,
      proposed-at: u0,
      accepted: false,
    })
    (ok true)
  )
)

;; ---------------------------------------------------------------------------
;; admin / pubkey management
;; ---------------------------------------------------------------------------

(define-public (propose-transfer-wallet (new-admin principal))
  (begin
    (try! (is-admin-calling tx-sender))
    (asserts! (not (is-eq new-admin tx-sender)) err-forbidden)
    (var-set pending-transfer new-admin)
    (update-activity)
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
      g (try! (as-contract?
        ((with-ft SBTC-CONTRACT "sbtc-token" (var-get max-gas-amount)))
        (try! (contract-call? g pay-gas))
      ))
      true
    )
    (try! (ft-mint? ect u1 current-contract))
    (try! (ft-burn? ect u1 current-contract))
    (map-set admins pending true)
    (map-delete admins (var-get owner))
    (var-set owner pending)
    (var-set pending-transfer 'SP000000000000000000002Q6VF78)
    (update-activity)
    (try! (contract-call? .deorgmedia-core log-wallet-transferred pending))
    (ok true)
  )
)

(define-public (propose-admin-pubkey (pubkey (buff 33)))
  (begin
    (try! (is-admin-calling tx-sender))
    (var-set pending-pubkey {
      pubkey: pubkey,
      proposed-at: burn-block-height,
    })
    (update-activity)
    (ok true)
  )
)

(define-public (confirm-admin-pubkey)
  (let (
      (pending (var-get pending-pubkey))
      (pubk (get pubkey pending))
    )
    (asserts! (not (is-eq (get proposed-at pending) u0)) err-no-pending-pubkey)
    (asserts!
      (>= burn-block-height
        (+ (get proposed-at pending) (var-get pubkey-cooldown-period))
      )
      err-in-cooldown
    )
    (try! (is-admin-calling tx-sender))
    (map-set pubkey-to-admin pubk tx-sender)
    (var-set pending-pubkey {
      pubkey: PUBK,
      proposed-at: u0,
    })
    (update-activity)
    (try! (contract-call? .deorgmedia-core log-confirm-admin-pubkey pubk tx-sender))
    (ok true)
  )
)

(define-public (remove-admin-pubkey (pubkey (buff 33)))
  (begin
    (try! (is-authorized none))
    (map-delete pubkey-to-admin pubkey)
    (try! (contract-call? .deorgmedia-core log-remove-admin-pubkey pubkey))
    (ok true)
  )
)

;; ---------------------------------------------------------------------------
;; recovery
;; ---------------------------------------------------------------------------

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
      g (try! (as-contract?
        ((with-ft SBTC-CONTRACT "sbtc-token" (var-get max-gas-amount)))
        (try! (contract-call? g pay-gas))
      ))
      true
    )
    (var-set pending-recovery new-recovery)
    (update-activity)
    (try! (contract-call? .deorgmedia-core log-propose-recovery new-recovery))
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
    (try! (contract-call? .deorgmedia-core log-confirm-recovery pending))
    (ok true)
  )
)

(define-public (recover-inactive-wallet (new-admin principal))
  (begin
    (asserts! (is-inactive) err-inactive-required)
    (asserts! (is-eq tx-sender (var-get recovery-address)) err-unauthorised)
    (map-delete admins (var-get owner))
    (map-set admins new-admin true)
    (var-set owner new-admin)
    (var-set last-activity-block burn-block-height)
    (try! (contract-call? .deorgmedia-core log-recover-inactive-wallet new-admin tx-sender))
    (ok true)
  )
)

;; ---------------------------------------------------------------------------
;; funding: simple stx / sip010 transfers (no thresholds)
;; ---------------------------------------------------------------------------

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
          g (try! (as-contract?
            ((with-ft SBTC-CONTRACT "sbtc-token" (var-get max-gas-amount)))
            (try! (contract-call? g pay-gas))
          ))
          true
        )
      )
      (try! (is-authorized none))
    )
    (try! (contract-call? .deorgmedia-core log-stx-transfer amount recipient memo))
    (as-contract? ((with-stx amount))
      (match memo
        to-print (try! (stx-transfer-memo? amount tx-sender recipient to-print))
        (try! (stx-transfer? amount tx-sender recipient))
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
          g (try! (as-contract?
            ((with-ft SBTC-CONTRACT "sbtc-token" (var-get max-gas-amount)))
            (try! (contract-call? g pay-gas))
          ))
          true
        )
      )
      (try! (is-authorized none))
    )
    (try! (contract-call? .deorgmedia-core log-sip010-transfer (contract-of sip010) amount recipient memo))
    (as-contract? ((with-ft (contract-of sip010) token-name amount))
      (try! (contract-call? sip010 transfer amount current-contract recipient memo))
    )
  )
)

;; ---------------------------------------------------------------------------
;; THE HEADLINE FUNCTION: inscribe-article
;; ---------------------------------------------------------------------------

;; Inline SIP018 message-hash builder for the signed path.
(define-read-only (get-domain-hash)
  (sha256 (unwrap-panic (to-consensus-buff? {
    name: "deorgmedia-sw",
    version: "1.0.0",
    chain-id: chain-id,
    wallet: contract-caller,
  })))
)

(define-read-only (build-inscribe-article-hash (details {
  auth-id: uint,
  expected-hash: (buff 32),
  total-size: uint,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "inscribe-article",
        auth-id: (get auth-id details),
        expected-hash: (get expected-hash details),
        total-size: (get total-size details),
      })))
    )))
)

(define-public (inscribe-article
    (expected-hash (buff 32))
    (mime (string-ascii 64))
    (total-size uint)
    (chunks (list 32 (buff 16384)))
    (token-uri-string (string-ascii 256))
    (max-inscribe-fee uint)
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
          message-hash: (build-inscribe-article-hash {
            auth-id: (get auth-id sig-auth-details),
            expected-hash: expected-hash,
            total-size: total-size,
          }),
          pubkey: (get pubkey sig-auth-details),
          signature: (get signature sig-auth-details),
          authenticator-data: (get authenticator-data sig-auth-details),
          client-data-prefix: (get client-data-prefix sig-auth-details),
          client-data-suffix: (get client-data-suffix sig-auth-details),
        })))
        (match gas
          g (try! (as-contract?
            ((with-ft SBTC-CONTRACT "sbtc-token" (var-get max-gas-amount)))
            (try! (contract-call? g pay-gas))
          ))
          true
        )
      )
      (try! (is-authorized none))
    )
    (let ((inscribe-result (try! (as-contract? ((with-stx max-inscribe-fee))
        (try! (contract-call? 'SP3JNSEXAZP4BDSHV0DN3M8R3P0MY0EEBQQZX743X.xtrata-v3-2-3
          mint-single-tx expected-hash mime total-size chunks token-uri-string
        ))
      ))))
      (try! (contract-call? .deorgmedia-core log-article-inscribed expected-hash total-size token-uri-string))
      (ok inscribe-result)
    )
  )
)

;; ---------------------------------------------------------------------------
;; init defaults & onboarding
;; ---------------------------------------------------------------------------

(map-set admins 'SP000000000000000000002Q6VF78 true)

(define-public (onboard (pubkey (buff 33)))
  (begin
    (asserts! (is-eq tx-sender DEORG-DEPLOYER) err-unauthorised)
    (asserts! (not (var-get pubkey-initialized)) err-unauthorised)
    (var-set initial-pubkey pubkey)
    (map-set pubkey-to-admin pubkey 'SP000000000000000000002Q6VF78)
    (var-set pubkey-initialized true)
    (try! (as-contract? () (try! (contract-call? .deorgmedia-core register-wallet current-contract))))
    (try! (contract-call? .deorgmedia-core log-wallet-initialized pubkey))
    (ok true)
  )
)
