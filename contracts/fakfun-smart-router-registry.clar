(define-constant COOLDOWN u144)

(define-constant ERR-NOT-OWNER (err u7001))
(define-constant ERR-NOT-PENDING (err u7002))
(define-constant ERR-COOLDOWN (err u7003))
(define-constant ERR-ALREADY-APPROVED (err u7004))
(define-constant ERR-NO-PENDING-OWNER (err u7005))
(define-constant ERR-NOT-PENDING-OWNER (err u7006))

(define-data-var contract-owner principal tx-sender)
(define-data-var pending-owner (optional principal) none)
(define-data-var owner-proposed-at uint u0)

(define-map approved
  principal
  bool
)
(define-map pending
  principal
  uint
)

(define-read-only (is-approved-router (router principal))
  (default-to false (map-get? approved router))
)

(define-read-only (get-owner)
  (var-get contract-owner)
)
(define-read-only (get-pending-owner)
  (var-get pending-owner)
)
(define-read-only (get-pending (router principal))
  (map-get? pending router)
)

(define-public (propose-router (router principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-OWNER)
    (asserts! (not (is-approved-router router)) ERR-ALREADY-APPROVED)
    (map-set pending router burn-block-height)
    (print {
      action: "propose-router",
      router: router,
      at: burn-block-height,
    })
    (ok true)
  )
)

(define-public (confirm-router (router principal))
  (let ((proposed-at (unwrap! (map-get? pending router) ERR-NOT-PENDING)))
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-OWNER)
    (asserts! (>= burn-block-height (+ proposed-at COOLDOWN)) ERR-COOLDOWN)
    (map-set approved router true)
    (map-delete pending router)
    (print {
      action: "confirm-router",
      router: router,
    })
    (ok true)
  )
)

(define-public (revoke-pending (router principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-OWNER)
    (map-delete pending router)
    (print {
      action: "revoke-pending",
      router: router,
    })
    (ok true)
  )
)

(define-public (propose-owner (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-OWNER)
    (var-set pending-owner (some new-owner))
    (var-set owner-proposed-at burn-block-height)
    (print {
      action: "propose-owner",
      new-owner: new-owner,
      at: burn-block-height,
    })
    (ok true)
  )
)

(define-public (accept-owner)
  (let ((next (unwrap! (var-get pending-owner) ERR-NO-PENDING-OWNER)))
    (asserts! (is-eq tx-sender next) ERR-NOT-PENDING-OWNER)
    (asserts! (>= burn-block-height (+ (var-get owner-proposed-at) COOLDOWN))
      ERR-COOLDOWN
    )
    (var-set contract-owner next)
    (var-set pending-owner none)
    (print {
      action: "accept-owner",
      owner: next,
    })
    (ok true)
  )
)

(map-set approved 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.b-smart-faktory true)
(map-set approved 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.mia-smart-faktory
  true
)
(map-set approved 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.pepe-smart-faktory
  true
)
(map-set approved
  'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.flatearth-smart-faktory true
)
(map-set approved 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-smart-faktory
  true
)
(map-set approved 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.leo-smart-faktory
  true
)
(map-set approved 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.lwb-smart-faktory
  true
)
(map-set approved 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.welsh-smart-faktory
  true
)
(map-set approved 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.rock-smart-faktory
  true
)
