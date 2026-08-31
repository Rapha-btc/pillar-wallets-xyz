;; Central registry of vetted pillar-wallet extensions.
;; The whitelisting cooldown lives HERE (propose -> 144 burn blocks -> confirm),
;; done once by the registry owner. Wallets can then whitelist a registry-approved
;; extension instantly (passkey 2FA only, no per-wallet cooldown) via
;; whitelist-extension-fast. Non-registry extensions keep the per-wallet
;; pending-operation cooldown path.

(define-constant COOLDOWN u144)

(define-constant ERR-NOT-OWNER (err u7101))
(define-constant ERR-NOT-PENDING (err u7102))
(define-constant ERR-COOLDOWN (err u7103))
(define-constant ERR-ALREADY-APPROVED (err u7104))
(define-constant ERR-NO-PENDING-OWNER (err u7105))
(define-constant ERR-NOT-PENDING-OWNER (err u7106))

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

(define-read-only (is-approved-extension (extension principal))
  (default-to false (map-get? approved extension))
)

(define-read-only (get-owner)
  (var-get contract-owner)
)
(define-read-only (get-pending-owner)
  (var-get pending-owner)
)
(define-read-only (get-pending (extension principal))
  (map-get? pending extension)
)

(define-public (propose-extension (extension principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-OWNER)
    (asserts! (not (is-approved-extension extension)) ERR-ALREADY-APPROVED)
    (map-set pending extension burn-block-height)
    (print {
      action: "propose-extension",
      extension: extension,
      at: burn-block-height,
    })
    (ok true)
  )
)

(define-public (confirm-extension (extension principal))
  (let ((proposed-at (unwrap! (map-get? pending extension) ERR-NOT-PENDING)))
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-OWNER)
    (asserts! (>= burn-block-height (+ proposed-at COOLDOWN)) ERR-COOLDOWN)
    (map-set approved extension true)
    (map-delete pending extension)
    (print {
      action: "confirm-extension",
      extension: extension,
    })
    (ok true)
  )
)

(define-public (revoke-pending (extension principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-OWNER)
    (map-delete pending extension)
    (print {
      action: "revoke-pending",
      extension: extension,
    })
    (ok true)
  )
)

;; revocation is immediate: pulling a bad extension must not wait out a cooldown
(define-public (revoke-extension (extension principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-OWNER)
    (map-delete approved extension)
    (print {
      action: "revoke-extension",
      extension: extension,
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

(map-set approved 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.xtrata-inscribe true)
(map-set approved 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.usdcx-sbtc-swap true)
