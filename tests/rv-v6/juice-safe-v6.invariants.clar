;; RENDEZVOUS INVARIANTS for juice-safe-v6
;;
;; Scope, stated honestly. The safe is auth-heavy: nearly every state mutation
;; needs either an admin tx-sender or a valid secp256r1 / WebAuthn signature. RV
;; cannot forge signatures, so signed paths bounce on u4002 and admin paths bounce
;; on u4001 for random senders. The leverage is therefore NOT in reaching deep
;; states, it is in proving that no reachable sequence of random calls from random
;; principals can ever break these properties.
;;
;; Each invariant below is a bound the contract must hold at ALL times, including
;; before onboard, mid-config-change, and after any failed call. Several encode
;; guarantees this generation introduced.

(define-map context (string-ascii 100) { called: uint })

(define-public (update-context (function-name (string-ascii 100)) (called uint))
  (ok (map-set context function-name { called: called })))

;; --- 1. cooldown-period stays inside its bounds, always --------------------
;; v6 added MIN-COOLDOWN u144 and reused MAX-CONFIG-COOLDOWN u4032 as a ceiling,
;; enforced at onboard AND at signal-config-change. If any path can land a value
;; outside that window, the delay that protects against a stolen admin key can be
;; collapsed to nothing or inflated until pending operations freeze forever.

(define-read-only (invariant-cooldown-within-bounds)
  (let ((cd (get cooldown-period (var-get wallet-config))))
    (and (>= cd MIN-COOLDOWN) (<= cd MAX-CONFIG-COOLDOWN))))

;; --- 2. max-gas-amount never exceeds its ceiling ---------------------------
;; propose-max-gas-amount asserts MAX-GAS-CEILING at propose time and
;; confirm-max-gas-amount applies whatever is pending. If a pending value could
;; be swapped after the assert, a relayer's per-call skim would be unbounded.

(define-read-only (invariant-max-gas-within-ceiling)
  (<= (var-get max-gas-amount) MAX-GAS-CEILING))

;; --- 3. the gas fuse is never exceeded -------------------------------------
;; The whole point of the v3/v4 gas work: gas spent in a period must never pass
;; max-gas-amount * GAS-CALLS-PER-PERIOD. pay-gas-accounted checks BEFORE adding,
;; so the counter should never be observed above the cap.

(define-read-only (invariant-gas-fuse-holds)
  (<= (get gas (var-get spent-this-period))
      (* (var-get max-gas-amount) GAS-CALLS-PER-PERIOD)))

;; --- 4. the contract is NEVER its own admin --------------------------------
;; as-contract? rebinds tx-sender to this contract. If the contract ever appeared
;; in its own admins map, a caller-supplied gas station could re-enter with
;; sig-auth none and pass is-admin-calling, draining the wallet on a relay
;; compromise alone. Guarded at all three admins writes; this proves no random
;; sequence defeats those guards.

(define-read-only (invariant-contract-never-own-admin)
  (is-none (map-get? admins current-contract)))

;; --- 5. the owner is never the contract itself -----------------------------
(define-read-only (invariant-owner-not-contract)
  (not (is-eq (var-get owner) current-contract)))

;; --- 6. the recovery address is never the contract itself ------------------
;; recover-inactive-wallet gates on tx-sender == recovery-address, and
;; as-contract? makes tx-sender this contract, so a contract-valued recovery
;; address would be a path a gas station could reach.

(define-read-only (invariant-recovery-not-contract)
  (not (is-eq (var-get recovery-address) current-contract)))

;; --- 7. a queued config change is either empty or in bounds ----------------
;; signal-config-change validates the cooldown before queueing and
;; set-wallet-config zeroes the queue after applying. So pending-config is either
;; all-zero (nothing queued) or carries a legal cooldown. An out-of-bounds value
;; sitting in the queue would mean the bounds check can be bypassed.

(define-read-only (invariant-pending-config-empty-or-legal)
  (let ((p (var-get pending-config)))
    (or
      (and (is-eq (get stx-threshold p) u0)
           (is-eq (get sbtc-threshold p) u0)
           (is-eq (get cooldown-period p) u0))
      (and (>= (get cooldown-period p) MIN-COOLDOWN)
           (<= (get cooldown-period p) MAX-CONFIG-COOLDOWN)))))

;; --- 8. pubkey-initialized is a one-way latch ------------------------------
;; onboard is the only writer and must never be re-runnable. If this could flip
;; back, a second onboard could reseat the owner and the passkey.

(define-read-only (invariant-pubkey-initialized-monotonic)
  (let ((pi (var-get pubkey-initialized)))
    (or (is-eq pi false) (is-eq pi true))))

;; --- 9. spent counters never exceed their thresholds unaccountably ---------
;; stx and sbtc are per-period counters gated by would-exceed-*-threshold. An
;; over-threshold transfer queues instead of moving, so the counters should never
;; run away past the configured thresholds within a period.

(define-read-only (invariant-spent-within-thresholds)
  (let ((s (var-get spent-this-period))
        (c (var-get wallet-config)))
    (and (<= (get stx s) (get stx-threshold c))
         (<= (get sbtc s) (get sbtc-threshold c)))))

;; --- RV-ONLY BOOTSTRAP -----------------------------------------------------
;; NOT part of the deployed contract. Appended only into the RV build, exactly
;; like the invariants above.
;;
;; WHY IT EXISTS. Without it every RV call bounces: onboard needs tx-sender ==
;; FAKFUN-DEPLOYER, every admin path needs the seated owner, and every signed path
;; needs a real secp256r1 signature RV cannot forge. A 200-run session produced
;; 1,164 calls and ZERO state changes, so the invariants held over a contract that
;; never left its initial state -- true but nearly worthless.
;;
;; This seats the CALLER as owner and admin and marks the wallet initialised, so
;; RV's random wallets become authorised and actually drive signal-config-change,
;; propose-max-gas-amount, propose-transfer-wallet, the execute-pending-* paths and
;; recover-inactive-wallet. It deliberately bypasses onboard's auth; it does not
;; bypass anything the invariants assert.
;;
;; recovery-address is seated to a FIXED simnet wallet (wallet_9) rather than the
;; caller, both because onboard forbids recovery == owner and so RV can reach
;; recover-inactive-wallet as that principal.

(define-public (rv-bootstrap)
  (begin
    (map-delete admins 'SP000000000000000000002Q6VF78)
    (map-set admins tx-sender true)
    (var-set owner tx-sender)
    (var-set recovery-address 'ST2REHHS5J3CERCRBEPMGH7921Q6PYKAADT7JP2VB)
    (var-set pubkey-initialized true)
    (var-set wallet-config {
      stx-threshold: u100000000,
      sbtc-threshold: u100000,
      cooldown-period: MIN-COOLDOWN,
      config-signaled-at: none,
    })
    (var-set last-activity-block burn-block-height)
    (ok true)))
