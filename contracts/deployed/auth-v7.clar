;; SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK.auth-v7

(define-constant SIP018_MSG_PREFIX 0x534950303138)

(define-read-only (get-domain-hash)
  (sha256 (unwrap-panic (to-consensus-buff? {
    chain-id: chain-id,
    contract: 'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK.game-wager-v1,
    name: "game-wager",
    version: "1.0.0",
  })))
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

(define-read-only (build-wager-deposit-hash (details {
    auth-id: uint,
    amount: uint,
    pubkey: (buff 33),
    token: principal,
  }))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        amount: (get amount details),
        auth-id: (get auth-id details),
        pubkey: (get pubkey details),
        token: (get token details),
        topic: "wager-deposit",
      }))))))
)