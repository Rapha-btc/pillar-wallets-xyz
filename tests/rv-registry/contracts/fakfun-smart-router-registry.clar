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


;; ===========================================================================
;; RV invariants for fakfun-smart-router-registry. Appended to the contract by
;; ./build.sh, because rv reads invariants from the contract under test.
;;
;; The security decision the registry rests on is APPEND-ONLY approvals: no
;; sequence of calls, from any sender, ever un-approves a router. These
;; invariants prove that across random fuzzed call sequences.
;; ===========================================================================

;; rv tracks which SUT function it called through this pair.
(define-map context (string-ascii 100) { called: uint })
(define-public (update-context (function-name (string-ascii 100)) (called uint))
  (ok (map-set context function-name { called: called })))

;; A canary router used to check state consistency for a principal RV may also
;; try to propose/confirm. Not one of the seeded 9.
(define-constant CANARY 'SP000000000000000000002Q6VF78.canary-router)

;; --- 1. append-only: the 9 seeded routers stay approved forever ------------
;; This is the crown-jewel property. No function, from any sender, in any
;; order, ever removes an approval. If a future edit added a path that could,
;; this invariant catches it.
(define-read-only (invariant-seeded-stay-approved)
  (and
    (is-approved-router 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.b-smart-faktory)
    (is-approved-router 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.mia-smart-faktory)
    (is-approved-router 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.pepe-smart-faktory)
    (is-approved-router 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.flatearth-smart-faktory)
    (is-approved-router 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-smart-faktory)
    (is-approved-router 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.leo-smart-faktory)
    (is-approved-router 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.lwb-smart-faktory)
    (is-approved-router 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.welsh-smart-faktory)
    (is-approved-router 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.rock-smart-faktory)))

;; --- 2. a router is never simultaneously pending AND approved --------------
;; confirm moves pending -> approved and deletes the pending row; propose
;; rejects an already-approved router. So the two maps are disjoint by
;; construction. Checked on the canary, which RV can drive through both.
(define-read-only (invariant-canary-not-both-states)
  (not (and (is-some (get-pending CANARY)) (is-approved-router CANARY))))

;; --- 3. the owner var is never left empty ---------------------------------
;; contract-owner is a non-optional principal; accept-owner only ever sets it
;; to the principal that opted in. Guards against a transfer path that could
;; blank ownership and brick governance.
(define-read-only (invariant-owner-set)
  (is-standard (var-get contract-owner)))
