;; fakfun-smart-router-registry
;; Central allowlist of smart split-router contracts a v18 wallet may route a
;; trade through. Without it, smart-buy/sell take any trait-conforming
;; principal, so a phished passkey signature (or a malicious front end) could
;; name an attacker's "router" that pockets the input the wallet's allowance
;; releases. The wallet asks is-approved-router before every smart trade.
;;
;; CENTRAL, not per-wallet: a new legit router is blessed once here and every
;; wallet accepts it immediately -- the reason the wallet uses a trait param at
;; all. Trust here is the same trust already extended to whoever deploys the
;; routers. Mirrors how pools are gated in fakfun-core-v2.
;;
;; Governance:
;;  * approving a router is SLOW: propose -> wait COOLDOWN -> confirm, so a
;;    single compromised owner key cannot instantly bless a malicious router.
;;  * approvals are ONE-WAY: there is no un-approve. A compromised owner
;;    therefore cannot DoS every wallet by de-listing live routers. revoke
;;    only cancels a still-pending proposal (safe: nothing is live yet).
;;  * the owner itself transfers by 2-step propose/accept with the same
;;    COOLDOWN, so a stolen key cannot instantly hand ownership away.
;; The 9 routers live at deploy are seeded directly (trusted: same deployer).

(define-constant COOLDOWN u144) ;; ~1 day of Bitcoin blocks

(define-constant ERR-NOT-OWNER (err u7001))
(define-constant ERR-NOT-PENDING (err u7002))
(define-constant ERR-COOLDOWN (err u7003))
(define-constant ERR-ALREADY-APPROVED (err u7004))
(define-constant ERR-NO-PENDING-OWNER (err u7005))
(define-constant ERR-NOT-PENDING-OWNER (err u7006))

(define-data-var contract-owner principal tx-sender)
(define-data-var pending-owner (optional principal) none)
(define-data-var owner-proposed-at uint u0)

(define-map approved principal bool)
(define-map pending principal uint) ;; router -> burn height proposed

(define-read-only (is-approved-router (router principal))
  (default-to false (map-get? approved router)))

(define-read-only (get-owner) (var-get contract-owner))
(define-read-only (get-pending-owner) (var-get pending-owner))
(define-read-only (get-pending (router principal)) (map-get? pending router))

;; --- Router approvals ------------------------------------------------------

;; Propose a new router. Owner only. Starts the cooldown clock.
(define-public (propose-router (router principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-OWNER)
    (asserts! (not (is-approved-router router)) ERR-ALREADY-APPROVED)
    (map-set pending router burn-block-height)
    (print { action: "propose-router", router: router, at: burn-block-height })
    (ok true)))

;; Confirm a proposed router after the cooldown. Owner only. One-way: once
;; approved a router is never un-approved (see header).
(define-public (confirm-router (router principal))
  (let ((proposed-at (unwrap! (map-get? pending router) ERR-NOT-PENDING)))
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-OWNER)
    (asserts! (>= burn-block-height (+ proposed-at COOLDOWN)) ERR-COOLDOWN)
    (map-set approved router true)
    (map-delete pending router)
    (print { action: "confirm-router", router: router })
    (ok true)))

;; Cancel a still-PENDING proposal. Owner only. Cannot touch an approved
;; router -- approvals are one-way.
(define-public (revoke-pending (router principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-OWNER)
    (map-delete pending router)
    (print { action: "revoke-pending", router: router })
    (ok true)))

;; --- Owner transfer (2-step, cooldown) -------------------------------------

;; Owner proposes a successor. Starts the cooldown clock.
(define-public (propose-owner (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-OWNER)
    (var-set pending-owner (some new-owner))
    (var-set owner-proposed-at burn-block-height)
    (print { action: "propose-owner", new-owner: new-owner, at: burn-block-height })
    (ok true)))

;; The proposed owner accepts, after the cooldown. Only the pending owner may
;; call, so ownership never moves to a principal that did not opt in.
(define-public (accept-owner)
  (let ((next (unwrap! (var-get pending-owner) ERR-NO-PENDING-OWNER)))
    (asserts! (is-eq tx-sender next) ERR-NOT-PENDING-OWNER)
    (asserts! (>= burn-block-height (+ (var-get owner-proposed-at) COOLDOWN)) ERR-COOLDOWN)
    (var-set contract-owner next)
    (var-set pending-owner none)
    (print { action: "accept-owner", owner: next })
    (ok true)))

;; --- Seed the 9 routers live at deploy (2026-08-29). New ones use propose /
;; confirm above. Deployer is the same principal that deployed the routers. ---
(map-set approved 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.b-smart-faktory true)
(map-set approved 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.mia-smart-faktory true)
(map-set approved 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.pepe-smart-faktory true)
(map-set approved 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.flatearth-smart-faktory true)
(map-set approved 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-smart-faktory true)
(map-set approved 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.leo-smart-faktory true)
(map-set approved 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.lwb-smart-faktory true)
(map-set approved 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.welsh-smart-faktory true)
(map-set approved 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.rock-smart-faktory true)
