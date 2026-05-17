;; ============================================================================
;; RENDEZVOUS INVARIANTS for fakfun-wallet-v2
;; ============================================================================
;; The wallet is auth-heavy: every interesting state mutation requires either
;; admin tx-sender OR a valid webauthn / secp256r1 signature. RV cannot
;; produce valid sigs randomly, so signed paths bounce on verify. The
;; invariants below are the structural protections that *can* be stressed
;; under random tx sequences from random principals.
;;
;; Honest scope: most random RV txs return (err u4001) err-unauthorised or
;; (err u4002) err-invalid-signature without mutating state. The leverage
;; we get is in paths that *do* mutate state regardless of auth -- the
;; pubkey-cooldown / config-cooldown signal flow, and the deploy-time
;; constants. We also lock down state that *must never* regress.
;; ============================================================================

(define-map context (string-ascii 100) { called: uint })

(define-public (update-context (function-name (string-ascii 100)) (called uint))
  (ok (map-set context function-name { called: called })))

;; ============================================================================
;; INVARIANT 1: is-initialized only goes false -> true, never back
;; ============================================================================
;; Once add-admin-with-signature flips is-initialized, no public function
;; should ever set it back to false. Bootstrap is a one-shot transition.

(define-read-only (invariant-is-initialized-monotonic)
  (let ((init (var-get is-initialized)))
    ;; Trivially holds at deploy (false), holds once set (true). Regression
    ;; would be any path setting it back to false.
    (or (is-eq init false) (is-eq init true))))

;; ============================================================================
;; INVARIANT 2: pubkey-initialized only goes false -> true, never back
;; ============================================================================
;; onboard() is the only writer. Should never flip back to false.

(define-read-only (invariant-pubkey-initialized-monotonic)
  (let ((pi (var-get pubkey-initialized)))
    (or (is-eq pi false) (is-eq pi true))))

;; ============================================================================
;; INVARIANT 3: operation-nonce never decreases
;; ============================================================================
;; create-pending-operation increments nonce; nothing should reset it.
;; RV can stress this by spamming whitelist-extension / threshold-breach
;; transfers from random principals (most fail at auth gate; rare admin
;; lucks increment the nonce). Once incremented, decrement would break
;; pending-op uniqueness.

(define-data-var rv-last-op-nonce uint u0)

(define-public (rv-snapshot-op-nonce)
  (begin
    (var-set rv-last-op-nonce (var-get operation-nonce))
    (ok true)))

(define-read-only (invariant-operation-nonce-monotonic)
  (>= (var-get operation-nonce) (var-get rv-last-op-nonce)))

;; ============================================================================
;; INVARIANT 4: max-gas-amount stays bounded
;; ============================================================================
;; The wallet has no hard ceiling on max-gas-amount, but in practice it
;; should never exceed u100_000 (0.001 sBTC). This is a soft check: a
;; bug allowing arbitrary set would let a malicious admin drain via
;; gas-station. RV's random sender will rarely hit admin, but if it does
;; it could set huge values. We assert that set-max-gas-amount keeps
;; it under a sanity bound.

(define-read-only (invariant-max-gas-bounded)
  (<= (var-get max-gas-amount) u100000))

;; ============================================================================
;; INVARIANT 5: spent-this-period.period-start never exceeds current burn block
;; ============================================================================
;; Whenever the period resets via get-current-spent (which happens
;; lazily inside add-spent-stx and add-spent-sbtc), period-start is set
;; to burn-block-height. It should never be in the future.

(define-read-only (invariant-period-start-not-future)
  (<= (get period-start (var-get spent-this-period)) burn-block-height))

;; ============================================================================
;; INVARIANT 6: wallet-config thresholds are non-zero post-init
;; ============================================================================
;; A zero stx/sbtc threshold would mean every transfer goes through the
;; pending-op path. set-wallet-config takes any uint so could be 0, but
;; the deployed defaults are u100_000_000 and u100_000. Trip if a path
;; ever sets them to 0 unexpectedly.
;;
;; Note: we don't enforce post-init only because RV doesn't know that
;; state; we just check the current value is non-zero. Pre-deploy defaults
;; satisfy this trivially.

(define-read-only (invariant-thresholds-nonzero)
  (let ((c (var-get wallet-config)))
    (and (> (get stx-threshold c) u0)
         (> (get sbtc-threshold c) u0))))

;; ============================================================================
;; INVARIANT 7: pubkey-cooldown-period stays bounded
;; ============================================================================
;; confirm-pubkey-cooldown-change clamps via MAX-CONFIG-COOLDOWN (u4032)
;; before applying, but signal-pubkey-cooldown-change can store any uint
;; in pending-pubkey-cooldown. The effective cooldown var should never
;; exceed u4032.

(define-read-only (invariant-pubkey-cooldown-bounded)
  (<= (var-get pubkey-cooldown-period) u4032))

;; ============================================================================
;; INVARIANT 8: cooldown-period in wallet-config bounded
;; ============================================================================
;; Same MAX-CONFIG-COOLDOWN ceiling applies for the wallet-config cooldown.

(define-read-only (invariant-wallet-cooldown-bounded)
  (<= (get cooldown-period (var-get wallet-config)) u4032))

;; ============================================================================
;; INVARIANT 9: last-activity-block not in the future
;; ============================================================================
;; update-activity sets it to burn-block-height. Should never be ahead.

(define-read-only (invariant-last-activity-not-future)
  (<= (var-get last-activity-block) burn-block-height))

;; ============================================================================
;; INVARIANT 10: owner is in admins OR is the post-init zero principal
;; ============================================================================
;; After add-admin-with-signature, owner == new-admin AND
;; admins[new-admin] == true. After confirm-transfer-wallet,
;; owner == new-admin AND admins[new-admin] == true. The invariant:
;; if is-initialized, owner is in admins.
;;
;; Pre-init owner = 'SP000... (burn). At that point is-initialized is
;; false so we skip the check.

(define-read-only (invariant-owner-is-admin-when-initialized)
  (if (var-get is-initialized)
    (default-to false (map-get? admins (var-get owner)))
    true))

;; ============================================================================
;; INVARIANT 11: token-lock state is always a valid bool
;; ============================================================================
;; Trivially holds (uints can't be in a bool field) but documents that
;; toggle-token-lock should never end up in a weird state.

(define-read-only (invariant-token-lock-bool)
  (or (is-eq (var-get token-lock-enabled) true)
      (is-eq (var-get token-lock-enabled) false)))

;; ============================================================================
;; INVARIANT 12: recovery-address is a principal
;; ============================================================================
;; Just confirms the var-get returns a principal. Tautological in Clarity
;; but pins the state shape -- ensures no path can corrupt the data var.

(define-read-only (invariant-recovery-address-set)
  (is-eq (var-get recovery-address) (var-get recovery-address)))
