
(use-trait sip-010-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)
(use-trait pillar-wallet-trait 'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK.pillar-wallet-trait.pillar-wallet-trait)

(define-constant DEPLOYER tx-sender)
(define-constant GAME_TIMEOUT u144)
(define-constant SIP018_MSG_PREFIX 0x534950303138)

(define-constant RP-ID-HASH-FAKFUN-COM 0x5e8ba70d734d2bd57e0225bfd9a25f2c4d70db36fa1128e5eeb00cdab7a1ccdb)

(define-constant RP-ID-HASH-FAK-FUN 0xb877fea5df49f6d2fe544db0c7ced754f117ade85f60266bc217db3b239f2249)

(define-constant err-not-oracle (err u7001))
(define-constant err-not-deployer (err u7002))
(define-constant err-invalid-signature (err u7003))
(define-constant err-insufficient-balance (err u7004))
(define-constant err-game-not-found (err u7005))
(define-constant err-game-not-active (err u7006))
(define-constant err-game-not-expired (err u7007))
(define-constant err-invalid-amount (err u7009))
(define-constant err-signature-replay (err u7010))
(define-constant err-invalid-winner (err u7011))
(define-constant err-same-player (err u7012))
(define-constant err-token-not-whitelisted (err u7013))
(define-constant err-wallet-mismatch (err u7014))

(define-data-var oracle principal 'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK)
(define-data-var game-nonce uint u0)
(define-data-var fee-rate uint u500)
(define-data-var withdraw-fee-rate uint u100)
(define-data-var treasury principal DEPLOYER)

(define-map balances { pubkey: (buff 33), token: principal } uint)
(define-map used-signatures (buff 32) (buff 33))
(define-map games uint {
  player-a: (buff 33),
  player-b: (buff 33),
  token: principal,
  wager-amount: uint,
  status: (string-ascii 10),
  winner: (optional (buff 33)),
  created-at: uint,
})
(define-map accumulated-fees principal uint)
(define-map whitelisted-tokens principal bool)
(define-map pubkey-wallet (buff 33) principal)

(define-read-only (get-domain-hash)
  (sha256 (unwrap-panic (to-consensus-buff? {
    chain-id: chain-id,
    contract: current-contract,
    name: "game-wager",
    version: "2.0.0",
  })))
)

(define-read-only (build-register-wallet-hash (details {
    auth-id: uint,
    wallet: principal,
  }))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        auth-id: (get auth-id details),
        topic: "register-wallet",
        wallet: (get wallet details),
      }))))))
)

(define-read-only (build-withdraw-hash (details {
    auth-id: uint,
    amount: uint,
    recipient: principal,
    token: principal,
  }))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        amount: (get amount details),
        auth-id: (get auth-id details),
        recipient: (get recipient details),
        token: (get token details),
        topic: "withdraw",
      }))))))
)

(define-read-only (build-wager-hash (details {
    auth-id: uint,
    opponent: (buff 33),
    token: principal,
    wager-amount: uint,
  }))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        auth-id: (get auth-id details),
        opponent: (get opponent details),
        token: (get token details),
        topic: "wager",
        wager-amount: (get wager-amount details),
      }))))))
)

(define-read-only (get-balance (pubkey (buff 33)) (token principal))
  (default-to u0 (map-get? balances { pubkey: pubkey, token: token }))
)

(define-read-only (get-game (game-id uint))
  (map-get? games game-id)
)

(define-read-only (is-signature-used (message-hash (buff 32)))
  (is-some (map-get? used-signatures message-hash))
)

(define-read-only (get-game-nonce)
  (var-get game-nonce)
)

(define-read-only (get-oracle)
  (var-get oracle)
)

(define-read-only (get-fee-rate)
  (var-get fee-rate)
)

(define-read-only (get-withdraw-fee-rate)
  (var-get withdraw-fee-rate)
)

(define-read-only (get-accumulated-fees (token principal))
  (default-to u0 (map-get? accumulated-fees token))
)

(define-read-only (is-token-whitelisted (token principal))
  (default-to false (map-get? whitelisted-tokens token))
)

(define-read-only (get-registered-wallet (pubkey (buff 33)))
  (map-get? pubkey-wallet pubkey)
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
          (contract-call?
            'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.clarity-webauthn
            get-rp-id-hash authenticator-data)
          err-invalid-signature)))
    (asserts! (or (is-eq auth-rp-id RP-ID-HASH-FAKFUN-COM)
                  (is-eq auth-rp-id RP-ID-HASH-FAK-FUN))
              err-invalid-signature)
    (asserts! (contract-call?
                'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.clarity-webauthn
                is-user-present authenticator-data)
              err-invalid-signature)
    (ok (asserts! (contract-call?
                    'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.clarity-webauthn
                    verify-webauthn-signature
                    pubkey message-hash authenticator-data
                    client-data-prefix client-data-suffix signature)
                  err-invalid-signature))
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
    (try! (verify-signature message-hash pubkey signature
            authenticator-data client-data-prefix client-data-suffix))
    (asserts! (is-none (map-get? used-signatures message-hash)) err-signature-replay)
    (map-set used-signatures message-hash pubkey)
    (ok true)
  )
)

(define-private (credit-balance (pubkey (buff 33)) (token principal) (amount uint))
  (map-set balances
    { pubkey: pubkey, token: token }
    (+ (get-balance pubkey token) amount)
  )
)

(define-private (debit-balance (pubkey (buff 33)) (token principal) (amount uint))
  (let ((current (get-balance pubkey token)))
    (asserts! (<= amount current) err-insufficient-balance)
    (map-set balances { pubkey: pubkey, token: token } (- current amount))
    (ok true)
  )
)

(define-public (deposit (token <sip-010-trait>) (amount uint) (pubkey (buff 33)))
  (begin
    (asserts! (> amount u0) err-invalid-amount)
    (asserts! (is-token-whitelisted (contract-of token)) err-token-not-whitelisted)
    (try! (contract-call? token transfer amount tx-sender current-contract none))
    (credit-balance pubkey (contract-of token) amount)
    (print {
      event: "deposit",
      pubkey: pubkey,
      token: (contract-of token),
      amount: amount,
      sender: tx-sender
    })
    (ok true)
  )
)

(define-public (register-wallet
    (wallet <pillar-wallet-trait>)
    (sig-auth {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
  (let (
    (pubkey (get pubkey sig-auth))
    (wallet-principal (contract-of wallet))
    (message-hash (build-register-wallet-hash {
      auth-id: (get auth-id sig-auth),
      wallet: wallet-principal,
    }))
  )
    (try! (consume-signature
      message-hash
      pubkey
      (get signature sig-auth)
      (get authenticator-data sig-auth)
      (get client-data-prefix sig-auth)
      (get client-data-suffix sig-auth)))
    (try! (contract-call? wallet is-admin-pubkey pubkey))
    (map-set pubkey-wallet pubkey wallet-principal)
    (print {
      event: "wallet-registered",
      pubkey: pubkey,
      wallet: wallet-principal
    })
    (ok true)
  )
)

(define-public (withdraw
    (token <sip-010-trait>)
    (token-name (string-ascii 128))
    (amount uint)
    (recipient principal)
    (sig-auth {
      auth-id: uint,
      pubkey: (buff 33),
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
  (let (
    (pubkey (get pubkey sig-auth))
    (tokn (contract-of token))
    (actual-recipient (default-to recipient (map-get? pubkey-wallet pubkey)))
    (message-hash (build-withdraw-hash {
      auth-id: (get auth-id sig-auth),
      amount: amount,
      recipient: actual-recipient,
      token: tokn,
    }))
    (fee (/ (* amount (var-get withdraw-fee-rate)) u10000))
    (payout (- amount fee))
  )
    (asserts! (> amount u0) err-invalid-amount)
    (try! (consume-signature
      message-hash
      pubkey
      (get signature sig-auth)
      (get authenticator-data sig-auth)
      (get client-data-prefix sig-auth)
      (get client-data-suffix sig-auth)))
    (try! (debit-balance pubkey tokn amount))
    (map-set accumulated-fees tokn
      (+ (get-accumulated-fees tokn) fee))
    (try! (as-contract? ((with-ft tokn token-name payout))
      (try! (contract-call? token transfer payout current-contract actual-recipient none))))
    (print {
      event: "withdraw",
      pubkey: pubkey,
      token: tokn,
      amount: amount,
      fee: fee,
      payout: payout,
      recipient: actual-recipient
    })
    (ok true)
  )
)

(define-public (create-game
    (player-a (buff 33))
    (player-b (buff 33))
    (token principal)
    (wager-amount uint)
    (sig-a {
      auth-id: uint,
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    })
    (sig-b {
      auth-id: uint,
      signature: (buff 64),
      authenticator-data: (buff 256),
      client-data-prefix: (buff 128),
      client-data-suffix: (buff 512),
    }))
  (let (
    (game-id (var-get game-nonce))
    (hash-a (build-wager-hash {
      auth-id: (get auth-id sig-a),
      opponent: player-b,
      token: token,
      wager-amount: wager-amount,
    }))
    (hash-b (build-wager-hash {
      auth-id: (get auth-id sig-b),
      opponent: player-a,
      token: token,
      wager-amount: wager-amount,
    }))
  )
    (asserts! (is-eq tx-sender (var-get oracle)) err-not-oracle)
    (asserts! (> wager-amount u0) err-invalid-amount)
    (asserts! (not (is-eq player-a player-b)) err-same-player)
    (asserts! (is-token-whitelisted token) err-token-not-whitelisted)
    (try! (consume-signature
      hash-a
      player-a
      (get signature sig-a)
      (get authenticator-data sig-a)
      (get client-data-prefix sig-a)
      (get client-data-suffix sig-a)))
    (try! (consume-signature
      hash-b
      player-b
      (get signature sig-b)
      (get authenticator-data sig-b)
      (get client-data-prefix sig-b)
      (get client-data-suffix sig-b)))
    (try! (debit-balance player-a token wager-amount))
    (try! (debit-balance player-b token wager-amount))
    (map-set games game-id {
      player-a: player-a,
      player-b: player-b,
      token: token,
      wager-amount: wager-amount,
      status: "active",
      winner: none,
      created-at: burn-block-height,
    })
    (var-set game-nonce (+ game-id u1))
    (print {
      event: "game-created",
      game-id: game-id,
      player-a: player-a,
      player-b: player-b,
      token: token,
      wager-amount: wager-amount,
      created-at: burn-block-height
    })
    (ok game-id)
  )
)

(define-public (resolve-game (game-id uint) (winner (buff 33)))
  (let (
    (game (unwrap! (map-get? games game-id) err-game-not-found))
    (pot (* (get wager-amount game) u2))
    (fee (/ (* pot (var-get fee-rate)) u10000))
    (payout (- pot fee))
    (token (get token game))
  )
    (asserts! (is-eq tx-sender (var-get oracle)) err-not-oracle)
    (asserts! (is-eq (get status game) "active") err-game-not-active)
    (asserts!
      (or (is-eq winner (get player-a game))
          (is-eq winner (get player-b game)))
      err-invalid-winner)
    (credit-balance winner token payout)
    (map-set accumulated-fees token
      (+ (get-accumulated-fees token) fee))
    (map-set games game-id
      (merge game { status: "resolved", winner: (some winner) }))
    (print {
      event: "game-resolved",
      game-id: game-id,
      winner: winner,
      payout: payout,
      fee: fee
    })
    (ok true)
  )
)

(define-public (cancel-game (game-id uint))
  (let (
    (game (unwrap! (map-get? games game-id) err-game-not-found))
    (tokn (get token game))
    (wager (get wager-amount game))
    (fee (/ (* wager (var-get withdraw-fee-rate)) u10000))
    (refund (- wager fee))
  )
    (asserts! (is-eq (get status game) "active") err-game-not-active)
    (asserts!
      (or (is-eq tx-sender (var-get oracle))
          (> burn-block-height (+ (get created-at game) GAME_TIMEOUT)))
      err-game-not-expired)
    (credit-balance (get player-a game) tokn refund)
    (credit-balance (get player-b game) tokn refund)
    (map-set accumulated-fees tokn
      (+ (get-accumulated-fees tokn) (* fee u2)))
    (map-set games game-id
      (merge game { status: "cancelled" }))
    (print {
      event: "game-cancelled",
      game-id: game-id,
      fee-per-player: fee,
      refund-per-player: refund
    })
    (ok true)
  )
)

(define-public (set-oracle (new-oracle principal))
  (begin
    (asserts! (is-eq tx-sender DEPLOYER) err-not-deployer)
    (var-set oracle new-oracle)
    (ok true)
  )
)

(define-public (set-fee-rate (new-fee-rate uint))
  (begin
    (asserts! (is-eq tx-sender DEPLOYER) err-not-deployer)
    (asserts! (<= new-fee-rate u2000) err-invalid-amount)
    (var-set fee-rate new-fee-rate)
    (ok true)
  )
)

(define-public (set-withdraw-fee-rate (new-fee-rate uint))
  (begin
    (asserts! (is-eq tx-sender DEPLOYER) err-not-deployer)
    (asserts! (<= new-fee-rate u1000) err-invalid-amount)
    (var-set withdraw-fee-rate new-fee-rate)
    (ok true)
  )
)

(define-public (set-treasury (new-treasury principal))
  (begin
    (asserts! (is-eq tx-sender DEPLOYER) err-not-deployer)
    (var-set treasury new-treasury)
    (ok true)
  )
)

(define-public (set-token-whitelist (token principal) (enabled bool))
  (begin
    (asserts! (is-eq tx-sender DEPLOYER) err-not-deployer)
    (map-set whitelisted-tokens token enabled)
    (print { event: "token-whitelist-updated", token: token, enabled: enabled })
    (ok true)
  )
)

(define-public (sweep-fees (token <sip-010-trait>) (token-name (string-ascii 128)))
  (let (
    (amount (get-accumulated-fees (contract-of token)))
    (tokn (contract-of token))
    (treas (var-get treasury))
  )
    (asserts! (is-eq tx-sender DEPLOYER) err-not-deployer)
    (asserts! (> amount u0) err-invalid-amount)
    (map-set accumulated-fees tokn u0)
    (try! (as-contract? ((with-ft tokn token-name amount))
      (try! (contract-call? token transfer amount current-contract treas none))))
    (print {
      event: "fees-swept",
      token: tokn,
      amount: amount,
      treasury: treas
    })
    (ok true)
  )
)