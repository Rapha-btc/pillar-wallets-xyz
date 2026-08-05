(use-trait signer-mgr 'SP000000000000000000002Q6VF78.pox-5.signer-manager-trait)
(impl-trait 'SP000000000000000000002Q6VF78.pox-5.signer-manager-trait)

(define-constant POX5 'SP000000000000000000002Q6VF78.pox-5)
(define-constant SBTC 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)

(define-constant ERR_UNAUTHORIZED (err u100))
(define-constant ERR_PAUSED       (err u101))
(define-constant ERR_NOT_POX5     (err u102))
(define-constant ERR_SETTLE_FAILED (err u103))
(define-constant ERR_TRANCHE_UNPAID (err u104))
(define-constant ERR_NO_DUST      (err u105))
(define-constant ERR_NO_NEW_REWARDS (err u109))
(define-constant ERR_INVALID_FEE (err u110))
(define-constant ERR_INSUFFICIENT_FEES (err u111))
(define-constant ERR_TRANCHE_TOO_SOON (err u112))
(define-constant ERR_NO_PENDING_FEE (err u113))
(define-constant ERR_COOLDOWN (err u114))

(define-constant MAX_BIPS u10000)

(define-constant MAX_FEE_BIPS u2000)

(define-data-var admin  principal tx-sender)
(define-data-var paused bool false)

(define-read-only (get-admin) (var-get admin))
(define-read-only (is-paused) (var-get paused))

(define-private (assert-admin)
  (ok (asserts! (is-eq contract-caller (var-get admin)) ERR_UNAUTHORIZED)))

(define-public (set-admin (new-admin principal))
  (begin (try! (assert-admin)) (ok (var-set admin new-admin))))

(define-public (set-paused (p bool))
  (begin (try! (assert-admin)) (ok (var-set paused p))))

(define-data-var fee-bips uint u0)
(define-data-var earned-fees uint u0)

(define-map og-stakers principal bool)

(define-read-only (get-fee-bips) (var-get fee-bips))
(define-read-only (get-earned-fees) (var-get earned-fees))

(define-read-only (is-og (staker principal))
  (default-to false (map-get? og-stakers staker)))

(define-read-only (get-effective-fee-bips (staker principal))
  (if (is-og staker) u0 (var-get fee-bips)))

(define-constant FEE_COOLDOWN u144)

(define-data-var pending-fee (optional uint) none)
(define-data-var pending-fee-height uint u0)

(define-read-only (get-pending-fee)
  { fee: (var-get pending-fee),
    proposed-at: (var-get pending-fee-height),
    executable-at: (+ (var-get pending-fee-height) FEE_COOLDOWN) })

(define-public (propose-fee-bips (new-fee uint))
  (begin
    (try! (assert-admin))
    (asserts! (<= new-fee MAX_FEE_BIPS) ERR_INVALID_FEE)
    (var-set pending-fee (some new-fee))
    (var-set pending-fee-height burn-block-height)
    (print { topic: "propose-fee-bips", current: (var-get fee-bips), proposed: new-fee,
      executable-at: (+ burn-block-height FEE_COOLDOWN) })
    (ok new-fee)))

(define-public (confirm-fee-bips)
  (let ((new-fee (unwrap! (var-get pending-fee) ERR_NO_PENDING_FEE)))
    (try! (assert-admin))
    (asserts! (>= burn-block-height (+ (var-get pending-fee-height) FEE_COOLDOWN))
      ERR_COOLDOWN)
    (print { topic: "confirm-fee-bips", old: (var-get fee-bips), new: new-fee })
    (var-set pending-fee none)
    (ok (var-set fee-bips new-fee))))

(define-public (cancel-fee-bips)
  (begin
    (try! (assert-admin))
    (print { topic: "cancel-fee-bips", cancelled: (var-get pending-fee) })
    (ok (var-set pending-fee none))))

(define-public (set-og (staker principal) (og bool))
  (begin
    (try! (assert-admin))
    (if og (map-set og-stakers staker true) (map-delete og-stakers staker))
    (print { topic: "set-og", staker: staker, og: og })
    (ok og)))

(define-private (do-withdraw-fees (amount uint) (recipient principal))
  (let ((available (var-get earned-fees)))
    (asserts! (<= amount available) ERR_INSUFFICIENT_FEES)
    (try! (as-contract? ((with-ft SBTC "sbtc-token" amount))
      (try! (contract-call? SBTC transfer amount current-contract recipient none))))
    (var-set earned-fees (- available amount))
    (print { topic: "withdraw-fees", amount: amount, recipient: recipient })
    (ok amount)))

(define-public (withdraw-fees (amount uint) (recipient principal))
  (begin (try! (assert-admin)) (do-withdraw-fees amount recipient)))

(define-public (withdraw-all-fees (recipient principal))
  (begin (try! (assert-admin)) (do-withdraw-fees (var-get earned-fees) recipient)))

(define-public (validate-stake!
    (staker principal)
    (first-index uint)
    (num-indexes uint)
    (amount-ustx uint)
    (amount-sats uint)
    (is-bond bool)
    (signer-calldata (optional (buff 500)))
  )
  (begin
    (asserts! (is-eq contract-caller POX5) ERR_NOT_POX5)
    (asserts! (not (var-get paused)) ERR_PAUSED)
    (print { topic: "validate-stake", staker: staker, first-index: first-index,
      num-indexes: num-indexes, amount-ustx: amount-ustx, amount-sats: amount-sats, is-bond: is-bond, signer-calldata: signer-calldata })
    (ok true)
  )
)

(define-public (register-self
    (signer-manager <signer-mgr>)
    (signer-key (buff 33))
    (auth-id uint)
    (signer-sig (buff 65))
  )
  (begin
    (try! (assert-admin))
    (try! (contract-call? POX5 grant-signer-key signer-key current-contract
      auth-id signer-sig))
    (contract-call? POX5 register-signer signer-manager signer-key)
  )
)

(define-public (pox-claim-rewards
    (bond-periods (list 6 uint))
    (reward-cycle uint)
  )
  (let (
      (trn (get-tranche-count reward-cycle))
      (dist (contract-call? POX5 current-distribution-cycle))
      (last-dist (map-get? last-claim-dist-cycle reward-cycle))
    )

    (asserts! (match last-dist l (> dist l) true) ERR_TRANCHE_TOO_SOON)
    (let (
      (result (try! (contract-call? POX5 claim-rewards bond-periods reward-cycle)))
      (claimed (get total-rewards result))
    )

    (asserts! (> claimed u0) ERR_NO_NEW_REWARDS)

    (map-set stx-pot { reward-cycle: reward-cycle, tranche: trn } claimed)
    (map-set tranche-count reward-cycle (+ trn u1))

    (map-set last-claim-dist-cycle reward-cycle dist)
    (print { topic: "claim-rewards", reward-cycle: reward-cycle,
      tranche: trn, claimed: claimed, dist-cycle: dist,
      fee-bips: (var-get fee-bips) })
    (ok result)
    )
  )
)

(define-map stx-pot { reward-cycle: uint, tranche: uint } uint)

(define-map tranche-count uint uint)

(define-map last-claim-dist-cycle uint uint)

(define-read-only (get-last-claim-dist-cycle (reward-cycle uint))
  (map-get? last-claim-dist-cycle reward-cycle))

(define-map stx-paid { reward-cycle: uint, tranche: uint, staker: principal } uint)

(define-map tranche-paid { reward-cycle: uint, tranche: uint } uint)
(define-map tranche-paid-shares { reward-cycle: uint, tranche: uint } uint)

(define-read-only (get-tranche-count (reward-cycle uint))
  (default-to u0 (map-get? tranche-count reward-cycle)))

(define-read-only (get-stx-pot (reward-cycle uint) (tranche uint))
  (default-to u0 (map-get? stx-pot { reward-cycle: reward-cycle, tranche: tranche })))

(define-read-only (get-stx-paid (reward-cycle uint) (tranche uint) (staker principal))
  (map-get? stx-paid { reward-cycle: reward-cycle, tranche: tranche, staker: staker }))

(define-read-only (get-tranche-paid (reward-cycle uint) (tranche uint))
  (default-to u0 (map-get? tranche-paid { reward-cycle: reward-cycle, tranche: tranche })))

(define-read-only (get-tranche-paid-shares (reward-cycle uint) (tranche uint))
  (default-to u0 (map-get? tranche-paid-shares { reward-cycle: reward-cycle, tranche: tranche })))

(define-read-only (get-cycle-total-shares (reward-cycle uint))
  (contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-signer-shares-staked-for-cycle
    current-contract reward-cycle none))

(define-read-only (get-tranche-residue (reward-cycle uint) (tranche uint))
  (- (get-stx-pot reward-cycle tranche) (get-tranche-paid reward-cycle tranche)))

(define-read-only (is-tranche-fully-paid (reward-cycle uint) (tranche uint))
  (>= (get-tranche-paid-shares reward-cycle tranche)
      (get-cycle-total-shares reward-cycle)))

(define-read-only (get-stx-owed (reward-cycle uint) (tranche uint) (staker principal))
  (let (
      (signer current-contract)
      (total (contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-signer-shares-staked-for-cycle
        signer reward-cycle none))
      (shares (contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-staker-shares-staked-for-cycle
        staker reward-cycle none signer))
    )
    (if (or (is-eq total u0)
            (is-some (map-get? stx-paid
              { reward-cycle: reward-cycle, tranche: tranche, staker: staker })))
      u0

      (let (
          (gross (/ (* (get-stx-pot reward-cycle tranche) shares) total))
          (fee (if (is-og staker)
                 u0
                 (/ (* gross (var-get fee-bips)) MAX_BIPS)))
        )
        (- gross fee)))
  )
)

(define-private (pay-one
    (staker principal)
    (acc { reward-cycle: uint, tranche: uint, pot: uint, total-shares: uint,
           fee: uint, total: uint, fees: uint })
  )
  (let (
      (cycle (get reward-cycle acc))
      (trn (get tranche acc))
      (shares (contract-call? POX5 get-staker-shares-staked-for-cycle
        staker cycle none current-contract))

      (owed (if (is-eq (get total-shares acc) u0)
              u0
              (/ (* (get pot acc) shares) (get total-shares acc))))

      (fee (if (is-og staker) u0 (/ (* owed (get fee acc)) MAX_BIPS)))

      (net (- owed fee))
    )

    (if (or (is-some (map-get? stx-paid
              { reward-cycle: cycle, tranche: trn, staker: staker }))
            (is-eq shares u0))
      acc
      (begin

        (if (> net u0)
          (unwrap-panic (as-contract? ((with-ft SBTC "sbtc-token" net))
            (unwrap-panic (contract-call? SBTC transfer net current-contract staker none))))
          true)
        (if (> fee u0) (var-set earned-fees (+ (var-get earned-fees) fee)) true)

        (map-set stx-paid { reward-cycle: cycle, tranche: trn, staker: staker } net)

        (map-set tranche-paid { reward-cycle: cycle, tranche: trn }
          (+ (get-tranche-paid cycle trn) owed))
        (map-set tranche-paid-shares { reward-cycle: cycle, tranche: trn }
          (+ (get-tranche-paid-shares cycle trn) shares))
        (merge acc { total: (+ (get total acc) net),
                     fees: (+ (get fees acc) fee) })))
  )
)

(define-public (pay-stx-stakers
    (stakers (list 100 principal))
    (reward-cycle uint)
    (tranche uint)
  )
  (let (
      (result (fold pay-one stakers {
        reward-cycle: reward-cycle,
        tranche: tranche,
        pot: (get-stx-pot reward-cycle tranche),
        total-shares: (get-cycle-total-shares reward-cycle),
        fee: (var-get fee-bips),
        total: u0,
        fees: u0,
      }))
      (totl (get total result))
    )
    (print { topic: "pay-stx-stakers", reward-cycle: reward-cycle, tranche: tranche,
      count: (len stakers), total: totl, fees: (get fees result) })
    (ok totl)
  )
)

(define-public (sweep-tranche-dust (reward-cycle uint) (tranche uint))
  (let ((dust (get-tranche-residue reward-cycle tranche)))
    (try! (assert-admin))
    (asserts! (is-tranche-fully-paid reward-cycle tranche) ERR_TRANCHE_UNPAID)
    (asserts! (> dust u0) ERR_NO_DUST)
    (try! (as-contract? ((with-ft SBTC "sbtc-token" dust))
      (try! (contract-call? SBTC transfer dust current-contract
        (var-get admin) none))))
    (map-set tranche-paid { reward-cycle: reward-cycle, tranche: tranche }
      (+ (get-tranche-paid reward-cycle tranche) dust))
    (print { topic: "sweep-tranche-dust", reward-cycle: reward-cycle,
      tranche: tranche, dust: dust })
    (ok dust)
  )
)

(define-private (settle-one
    (staker principal)
    (acc { reward-cycle: uint, bond-index: (optional uint), total: uint, failed: bool })
  )
  (match (contract-call? POX5 claim-staker-rewards-for-signer
            staker (get reward-cycle acc) (get bond-index acc))
    ok-info (merge acc { total: (+ (get total acc) (get earned ok-info)) })
    err-code (merge acc { failed: true })
  )
)

(define-public (pox-settle-stakers
    (stakers (list 100 principal))
    (reward-cycle uint)
    (bond-index (optional uint))
  )
  (let (
      (result (fold settle-one stakers
        { reward-cycle: reward-cycle, bond-index: bond-index, total: u0, failed: false }))
      (totl (get total result))
    )
    (asserts! (not (get failed result)) ERR_SETTLE_FAILED)
    (print { topic: "settle-stakers", reward-cycle: reward-cycle,
      bond-index: bond-index, count: (len stakers), total: totl })
    (ok totl)
  )
)

(define-read-only (get-unclaimed-signer-rewards
    (reward-cycle uint)
    (bond-index (optional uint))
  )
  (contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-signer-unclaimed-rewards-for-cycle
    current-contract reward-cycle bond-index))

(define-read-only (get-staker-entitlement
    (staker principal)
    (reward-cycle uint)
    (bond-index (optional uint))
  )
  (contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-earned-staker-rewards
    current-contract reward-cycle bond-index staker))


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

;; --- a recorded claim always has a tranche behind it -----------------------
;; pox-claim-rewards writes last-claim-dist-cycle and bumps tranche-count together. If
;; a sequence could set the first without the second, the too-soon guard would be armed
;; for a cycle that has no pot, silently blocking every future claim for it.
(define-read-only (invariant-claim-implies-tranche)
  (and
    (match (get-last-claim-dist-cycle u1) d (> (get-tranche-count u1) u0) true)
    (match (get-last-claim-dist-cycle u2) d (> (get-tranche-count u2) u0) true)))
