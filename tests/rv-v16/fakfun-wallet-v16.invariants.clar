
;; ===========================================================================
;; RV invariants for fakfun-wallet-v16. Appended to the contract by ./build.sh,
;; because rv reads invariants from the contract under test.
;;
;; Carried over from juice-safe-v6 where the property applies, plus four v16-only
;; ones covering the extension whitelist and the three-step admin seating.
;; ===========================================================================

;; rv tracks which SUT function it called through this pair. It is not injected for
;; us -- the target contract must define it, so it lives here alongside the invariants.
(define-map context (string-ascii 100) { called: uint })
(define-public (update-context (function-name (string-ascii 100)) (called uint))
  (ok (map-set context function-name { called: called })))

;; --- RV-ONLY: make the wallet reachable -----------------------------------
;; Without this every path bounces on authorisation and the invariants hold over a
;; contract that never left its initial state -- true and worthless. Seats the caller
;; as owner and admin and marks the wallet initialised. It does NOT bypass anything the
;; invariants assert.
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

;; a contract holds no STX at genesis, so staking would bounce on the balance
(define-public (rv-fund (amount uint))
  (stx-transfer? (+ u2000000000 (mod amount u2000000000)) tx-sender current-contract))

(define-public (rv-stake-anything (amount uint))
  (stake-stx-juice (+ u1000000 (mod amount u1000000000)) none none))

;; --- 1. the cooldown stays inside its documented bounds -------------------
(define-read-only (invariant-cooldown-within-bounds)
  (let ((cd (get cooldown-period (var-get wallet-config))))
    (and (>= cd MIN-COOLDOWN) (<= cd MAX-CONFIG-COOLDOWN))))

;; --- 2. max-gas never exceeds the ceiling --------------------------------
(define-read-only (invariant-max-gas-within-ceiling)
  (<= (var-get max-gas-amount) MAX-GAS-CEILING))

;; --- 3. the per-period gas fuse holds ------------------------------------
(define-read-only (invariant-gas-fuse-holds)
  (<= (get gas (var-get spent-this-period))
      (* (var-get max-gas-amount) GAS-CALLS-PER-PERIOD)))

;; --- 4. the wallet is never its own admin --------------------------------
;; The gas-station re-entrancy story depends on this: a hostile station cannot make
;; the wallet call itself as an admin if the wallet is not in the map.
(define-read-only (invariant-contract-never-own-admin)
  (is-none (map-get? admins current-contract)))

(define-read-only (invariant-owner-not-contract)
  (not (is-eq (var-get owner) current-contract)))

(define-read-only (invariant-recovery-not-contract)
  (not (is-eq (var-get recovery-address) current-contract)))

;; --- 5. a queued config change is empty or legal -------------------------
(define-read-only (invariant-pending-config-empty-or-legal)
  (let ((cd (get cooldown-period (var-get pending-config))))
    (or (is-eq cd u0) (and (>= cd MIN-COOLDOWN) (<= cd MAX-CONFIG-COOLDOWN)))))

;; --- 6. the onboard latch never goes backwards ---------------------------
(define-read-only (invariant-pubkey-initialized-monotonic)
  (var-get pubkey-initialized))

;; --- 7. period counters never exceed their thresholds -------------------
(define-read-only (invariant-spent-within-thresholds)
  (let ((s (var-get spent-this-period)) (c (var-get wallet-config)))
    (and (<= (get stx s) (get stx-threshold c))
         (<= (get sbtc s) (get sbtc-threshold c)))))

;; --- 8. V16-ONLY: the wallet can never whitelist ITSELF as an extension --
;; extension-call runs the extension under (with-all-assets-unsafe). If the wallet
;; could whitelist itself, that clause would be pointed back at its own surface.
(define-read-only (invariant-self-never-whitelisted-extension)
  (not (default-to false (map-get? whitelisted-extensions current-contract))))

;; --- 9. V16-ONLY: a pending init is empty or names a non-contract admin --
(define-read-only (invariant-pending-init-sane)
  (let ((p (var-get pending-init-admin)))
    (or (is-eq (get proposed-at p) u0)
        (not (is-eq (get new-admin p) current-contract)))))

;; --- 10. V16-ONLY: the staked position never exceeds what could fund it --
(define-read-only (invariant-staked-not-above-funded)
  (match (contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-staker-info current-contract)
    info (<= (get amount-ustx info) (+ (stx-get-balance current-contract)
                                       (get locked (stx-account current-contract))))
    true))

;; --- 11. V16-ONLY: a position always points at the Juice signer ---------
(define-read-only (invariant-signer-is-juice)
  (match (contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-staker-info current-contract)
    info (is-eq (get signer info)
                'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-pool-stx-signer)
    true))
