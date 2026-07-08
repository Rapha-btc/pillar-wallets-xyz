;; ============================================================================
;; RENDEZVOUS INVARIANTS for jing-mm-safe (pending-op STATE MACHINE)
;; ============================================================================
;; Auth is stubbed OPEN in the RV build (is-admin-calling / is-admin-pubkey
;; rewritten to (ok true), webauthn mock accepts) so Rendezvous can REACH the
;; post-auth logic. RV cannot forge a real P-256 signature, so without this the
;; signed paths bounce at verify and nothing mutates. The real auth boundary
;; (u4001/u4002/u4003/u4015/u4017/u4023) is proven by the deterministic stxer
;; sim with REAL signatures -- NOT by RV. RV's job here is to hammer the
;; pending-operations state machine across random create / execute /
;; execute-now / veto sequences and confirm these structural invariants hold.
;;
;; Note: the wallet is not onboarded under RV (onboard is deployer-gated), but
;; wallet-config carries default thresholds, so over-threshold transfers still
;; create pending ops -- which is the surface these invariants guard.
;; ============================================================================

(define-map context (string-ascii 100) { called: uint })

(define-public (update-context (function-name (string-ascii 100)) (called uint))
  (ok (map-set context function-name { called: called })))

;; ---------------------------------------------------------------------------
;; INVARIANT 1: no pending op is BOTH executed and vetoed.
;; execute-* asserts (not vetoed); veto asserts (not executed). The flags must
;; stay mutually exclusive for every op. Checks ids 0..7 (RV rarely exceeds a
;; handful of ops per run).
;; ---------------------------------------------------------------------------
(define-private (not-both (id uint))
  (match (map-get? pending-operations id)
    op (not (and (get executed op) (get vetoed op)))
    true))

(define-read-only (invariant-no-executed-and-vetoed)
  (and (not-both u0) (not-both u1) (not-both u2) (not-both u3)
       (not-both u4) (not-both u5) (not-both u6) (not-both u7)))

;; ---------------------------------------------------------------------------
;; INVARIANT 2: a passkey-created op is NEVER fast-tracked past its cooldown.
;; The 2FA property: the execute-*-now fast path requires an ADMIN-created op
;; (the passkey is the second factor). The -now guard reverts on
;; passkey-created ops, so the ONLY way one becomes executed is the cooldown
;; path -- which requires burn-block-height >= execute-after. Therefore every
;; executed passkey-created op must have a matured cooldown. If the -now guard
;; regressed, an executed passkey-created op could exist with execute-after
;; still in the future -- this invariant would catch it.
;; ---------------------------------------------------------------------------
(define-private (passkey-op-respected-cooldown (id uint))
  (match (map-get? pending-operations id)
    op (if (and (get executed op) (get passkey-created op))
         (>= burn-block-height (get execute-after op))
         true)
    true))

(define-read-only (invariant-passkey-op-never-fast-tracked)
  (and (passkey-op-respected-cooldown u0) (passkey-op-respected-cooldown u1)
       (passkey-op-respected-cooldown u2) (passkey-op-respected-cooldown u3)
       (passkey-op-respected-cooldown u4) (passkey-op-respected-cooldown u5)
       (passkey-op-respected-cooldown u6) (passkey-op-respected-cooldown u7)))

;; ---------------------------------------------------------------------------
;; INVARIANT 3: every existing pending op has a non-zero execute-after.
;; execute-after = burn-block-height + cooldown-period at create time, and no
;; path rewrites it. A value of u0 would mean "executable at genesis" = a
;; cooldown bypass. Guards against any future edit that forgets to stamp it.
;; ---------------------------------------------------------------------------
(define-private (execafter-sane (id uint))
  (match (map-get? pending-operations id)
    op (> (get execute-after op) u0)
    true))

(define-read-only (invariant-execute-after-nonzero)
  (and (execafter-sane u0) (execafter-sane u1) (execafter-sane u2)
       (execafter-sane u3) (execafter-sane u4) (execafter-sane u5)
       (execafter-sane u6) (execafter-sane u7)))

;; ---------------------------------------------------------------------------
;; INVARIANT 4: token-lock is a bool (never corrupted). Trivial structural
;; guard -- a random sequence must never leave the kill-switch in an
;; indeterminate state.
;; ---------------------------------------------------------------------------
(define-read-only (invariant-token-lock-is-bool)
  (let ((l (var-get token-lock-enabled)))
    (or (is-eq l true) (is-eq l false))))
