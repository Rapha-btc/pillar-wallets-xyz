;; juice-safe-auth-helpers-v3
;;
;; SIP-018 hash builder for juice-safe-v10's set-pool. Same scheme and domain
;; tuple as juice-safe-auth-helpers-v1/v2 (wallet = contract-caller), so a
;; signature binds to one wallet. All other juice-safe-v10 builders stay on
;; v1 (unstake), v2 (stake, update-stake) and
;; juice-autostake-safe-auth-helpers-v1 (set-keeper).
;;
;; Deploy from account 0 (SPV9K21T...) BEFORE juice-safe-v10.

(define-constant SIP018_MSG_PREFIX 0x534950303138)

(define-read-only (get-domain-hash)
  (sha256 (unwrap-panic (to-consensus-buff? {
    name: "smart-wallet-standard",
    version: "1.0.0",
    chain-id: chain-id,
    wallet: contract-caller,
  })))
)

;; juice-wallet stake-stx-juice: like helpers-v2's stake hash, plus the pool
;; the user picked, so a submitter cannot swap it.
(define-read-only (build-stake-stx-juice-pool-hash (details {
  auth-id: uint,
  amount-ustx: uint,
  pool: principal,
  signer-calldata: (optional (buff 500)),
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "stake-stx-juice-pool",
        auth-id: (get auth-id details),
        amount-ustx: (get amount-ustx details),
        pool: (get pool details),
        signer-calldata: (get signer-calldata details),
      })))
    )))
)

;; juice-wallet update-stake-stx-juice: like helpers-v2's update hash, plus the
;; pool the stake moves to (or stays in).
(define-read-only (build-update-stake-stx-juice-pool-hash (details {
  auth-id: uint,
  amount-increase: uint,
  cycles-to-extend: uint,
  pool: principal,
  signer-calldata: (optional (buff 500)),
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "update-stake-stx-juice-pool",
        auth-id: (get auth-id details),
        amount-increase: (get amount-increase details),
        cycles-to-extend: (get cycles-to-extend details),
        pool: (get pool details),
        signer-calldata: (get signer-calldata details),
      })))
    )))
)

;; juice-trading jing-swap: what the user signs is what they sell and the worst
;; they accept (min-out, Jing limit-price). The route split and the Pyth update
;; are filled in at send time; min-out still protects the user.
(define-read-only (build-jing-swap-hash (details {
  auth-id: uint,
  action: (string-ascii 10),
  amount: uint,
  limit-price: uint,
  min-out: uint,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "jing-swap",
        auth-id: (get auth-id details),
        action: (get action details),
        amount: (get amount details),
        limit-price: (get limit-price details),
        min-out: (get min-out details),
      })))
    )))
)

;; juice-trading place-ladder: the pair, side, total and each rung + amount.
(define-read-only (build-place-ladder-hash (details {
  auth-id: uint,
  pair: (string-ascii 10),
  buy: bool,
  total: uint,
  allocations: (list 10 {
    rung: principal,
    amount: uint,
  }),
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "place-ladder",
        auth-id: (get auth-id details),
        pair: (get pair details),
        buy: (get buy details),
        total: (get total details),
        allocations: (get allocations details),
      })))
    )))
)

;; juice-trading withdraw-ladder: the pair, side and each rung + amount
;; (the Pyth update is filled in at send time).
(define-read-only (build-withdraw-ladder-hash (details {
  auth-id: uint,
  pair: (string-ascii 10),
  buy: bool,
  requests: (list 10 {
    rung: principal,
    amount: uint,
  }),
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "withdraw-ladder",
        auth-id: (get auth-id details),
        pair: (get pair details),
        buy: (get buy details),
        requests: (get requests details),
      })))
    )))
)

;; juice-trading claim-ladder: the pair, side and the rungs claimed from.
(define-read-only (build-claim-ladder-hash (details {
  auth-id: uint,
  pair: (string-ascii 10),
  buy: bool,
  rungs: (list 10 principal),
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "claim-ladder",
        auth-id: (get auth-id details),
        pair: (get pair details),
        buy: (get buy details),
        rungs: (get rungs details),
      })))
    )))
)
