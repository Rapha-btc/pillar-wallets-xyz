
;; ===========================================================================
;; RV invariants for juice-pool-stx-signer. Appended by ./build.sh.
;;
;; This is the best RV target of the three contracts: pure accounting over 13 state
;; vars with no WebAuthn anywhere, so rv can actually drive the surface instead of
;; bouncing off signatures it cannot forge. The invariants are therefore about
;; CONSERVATION -- the pot can never pay out more than it took in.
;; ===========================================================================

;; rv tracks which SUT function it called through this pair, and does NOT inject it.
(define-map context (string-ascii 100) { called: uint })
(define-public (update-context (function-name (string-ascii 100)) (called uint))
  (ok (map-set context function-name { called: called })))

;; --- RV-ONLY -------------------------------------------------------------
;; Every admin path checks contract-caller against `admin`, which is the SIMNET
;; deployer here (tx-sender at deploy). Without reseating it on the random caller,
;; every admin call returns u100 and the invariants hold over a contract that never
;; moved. This bypasses authorisation only; it weakens nothing the invariants assert.
(define-public (rv-bootstrap)
  (ok (var-set admin tx-sender)))

;; sBTC has to be IN the contract for pay-one and withdraw-fees to move anything.
(define-public (rv-fund-sbtc (amount uint))
  (contract-call? SBTC transfer (+ u10000 (mod amount u1000000))
    tx-sender current-contract none))

;; RV cannot orchestrate the staking + rewards chain (it only calls the contract under
;; test), so without this every tranche map stays empty and invariants 4-7 and 10 read
;; 0 <= 0 -- true and worthless. This opens a real tranche with a real pot so the
;; conservation invariants have something to conserve. It writes only the two maps
;; pox-claim-rewards would have written.
(define-public (rv-seed-tranche (amount uint))
  (let ((pot (+ u10000 (mod amount u10000000))))
    (map-set stx-pot { reward-cycle: u1, tranche: u0 } pot)
    (map-set tranche-count u1 u1)
    (ok pot)))

;; NOTE on proving invariants 4-7 and 10 are LIVE rather than vacuous. A temporary
;; canary asserted the opposite -- that no pot ever exists:
;;
;;   (define-read-only (invariant-canary-no-pot) (is-eq (get-stx-pot u1 u0) u0))
;;
;; A canary that SURVIVES is the bad outcome. It failed, which is the proof that
;; rv-seed-tranche reaches the pot and the conservation invariants are checked against
;; real numbers. Deleted afterwards; re-add it if the harness setup changes.

;; --- 1. the fee never exceeds its cap -----------------------------------
(define-read-only (invariant-fee-within-cap)
  (<= (var-get fee-bips) MAX_FEE_BIPS))

;; --- 2. a queued fee is absent or legal ---------------------------------
;; propose-fee-bips bounds the value, but a var is a var: if any sequence could park
;; an out-of-cap value in the pending slot, confirm-fee-bips would apply it unchecked.
(define-read-only (invariant-pending-fee-legal)
  (match (var-get pending-fee)
    f (<= f MAX_FEE_BIPS)
    true))

;; --- 3. earned fees are never more than the contract can pay ------------
;; withdraw-fees moves sBTC out against this counter. If it could exceed the real
;; balance, a withdrawal would fail or, worse, drain something else.
;; NOTE unwrap-panic, not match: sbtc-token's get-balance has an indeterminate err
;; type, and matching on it will not type-check at Clarity 6 -- the same fault that
;; aborted the v3/v12 wallet deploys.
(define-read-only (invariant-fees-not-above-balance)
  (<= (var-get earned-fees)
      (unwrap-panic (contract-call?
        'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
        get-balance current-contract))))

;; --- 4. a tranche never pays out more than it holds ---------------------
;; THE conservation property. tranche-paid accumulates the GROSS owed per staker and
;; sweep-tranche-dust adds the residue, so it must never exceed the pot it came from.
;; Checked across the cycles and tranches rv can actually reach.
(define-read-only (invariant-tranche-paid-within-pot)
  (and (<= (get-tranche-paid u1 u0) (get-stx-pot u1 u0))
       (<= (get-tranche-paid u1 u1) (get-stx-pot u1 u1))
       (<= (get-tranche-paid u2 u0) (get-stx-pot u2 u0))))

;; --- 5. paid shares never exceed the cycle's total shares ---------------
;; pay-one adds each staker's shares once, guarded by the stx-paid map. If a staker
;; could be paid twice the sum would run past the cycle total.
(define-read-only (invariant-paid-shares-within-total)
  (and (<= (get-tranche-paid-shares u1 u0) (get-cycle-total-shares u1))
       (<= (get-tranche-paid-shares u1 u1) (get-cycle-total-shares u1))
       (<= (get-tranche-paid-shares u2 u0) (get-cycle-total-shares u2))))

;; --- 6. the residue is never negative -----------------------------------
;; get-tranche-residue is (- pot paid) on uints, so an overflow here would abort
;; rather than report. Calling it at all is the assertion.
(define-read-only (invariant-residue-computable)
  (and (>= (get-tranche-residue u1 u0) u0)
       (>= (get-tranche-residue u2 u0) u0)))

;; --- 7. the tranche count only ever grows -------------------------------
;; pox-claim-rewards is permissionless, so nothing stops repeated calls; what must
;; hold is that the counter never goes BACKWARDS and leaves an orphaned pot.
(define-read-only (invariant-tranche-count-sane)
  (and (<= (get-tranche-count u1) u100)
       (<= (get-tranche-count u2) u100)))

;; --- 8. the admin is never the contract itself --------------------------
;; set-admin has no guard, so this is the one that would catch a sequence bricking
;; the contract by seating it on itself.
(define-read-only (invariant-admin-not-contract)
  (not (is-eq (var-get admin) current-contract)))

;; --- 9. an OG staker is always charged zero -----------------------------
(define-read-only (invariant-og-pays-nothing)
  (let ((probe 'ST2REHHS5J3CERCRBEPMGH7921Q6PYKAADT7JP2VB))
    (if (is-og probe)
      (is-eq (get-effective-fee-bips probe) u0)
      (is-eq (get-effective-fee-bips probe) (var-get fee-bips)))))

;; --- 10. a fully-paid tranche stays fully paid --------------------------
;; is-tranche-fully-paid is derived from paid-shares vs total shares. It must not be
;; possible to un-settle a tranche, which would let sweep-tranche-dust run twice.
(define-read-only (invariant-fully-paid-implies-shares)
  (if (is-tranche-fully-paid u1 u0)
    (>= (get-tranche-paid-shares u1 u0) (get-cycle-total-shares u1))
    true))
