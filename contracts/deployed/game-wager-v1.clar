;; SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK.game-wager-v1

(use-trait sip-010-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

(define-constant DEPLOYER tx-sender)
(define-constant GAME_TIMEOUT u144)

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

(define-private (verify-signature
    (message-hash (buff 32)) (signature (buff 65)) (expected-pubkey (buff 33)))
  (match (secp256k1-recover? message-hash signature)
    recovered-pubkey (begin
      (asserts! (is-eq recovered-pubkey expected-pubkey) err-invalid-signature)
      (ok true)
    )
    e err-invalid-signature
  )
)

(define-private (consume-signature
    (message-hash (buff 32)) (signature (buff 65)) (pubkey (buff 33)))
  (begin
    (try! (verify-signature message-hash signature pubkey))
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
    (pubkey (buff 33))
    (wallet principal)
    (auth-id uint)
    (signature (buff 65)))
  (let (
    (message-hash (contract-call? 'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK.auth-v7 build-register-wallet-hash {
      auth-id: auth-id,
      wallet: wallet,
    }))
  )
    (try! (consume-signature message-hash signature pubkey))
    (map-set pubkey-wallet pubkey wallet)
    (print {
      event: "wallet-registered",
      pubkey: pubkey,
      wallet: wallet
    })
    (ok true)
  )
)

(define-public (withdraw
    (token <sip-010-trait>)
    (token-name (string-ascii 128))
    (amount uint)
    (recipient principal)
    (pubkey (buff 33))
    (auth-id uint)
    (signature (buff 65)))
  (let (
    (tokn (contract-of token))
    (actual-recipient (default-to recipient (map-get? pubkey-wallet pubkey)))
    (message-hash (contract-call? 'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK.auth-v7 build-withdraw-hash {
      auth-id: auth-id,
      amount: amount,
      recipient: actual-recipient,
      token: tokn,
    }))
    (fee (/ (* amount (var-get withdraw-fee-rate)) u10000))
    (payout (- amount fee))
  )
    (asserts! (> amount u0) err-invalid-amount)
    (try! (consume-signature message-hash signature pubkey))
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
    (sig-a { auth-id: uint, signature: (buff 65) })
    (sig-b { auth-id: uint, signature: (buff 65) }))
  (let (
    (game-id (var-get game-nonce))
    (hash-a (contract-call? 'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK.auth-v7 build-wager-hash {
      auth-id: (get auth-id sig-a),
      opponent: player-b,
      token: token,
      wager-amount: wager-amount,
    }))
    (hash-b (contract-call? 'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK.auth-v7 build-wager-hash {
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
    (try! (consume-signature hash-a (get signature sig-a) player-a))
    (try! (consume-signature hash-b (get signature sig-b) player-b))
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