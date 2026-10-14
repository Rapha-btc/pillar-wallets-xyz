;; ===========================================================================
;; RV harness for juice-autostake-safe. ./build.sh appends this file to the
;; patched production source, because rv reads invariants and property tests
;; from the contract under test. Nothing here is deployed anywhere but simnet.
;;
;; Setup (deployments/default.simnet-plan.yaml, batch "rv-setup"): the pool is
;; registered in pox-5 through the real grant path, core-v2 verifies the safe,
;; and the safe is onboarded by the real FAKFUN-DEPLOYER with the passkey from
;; keys.mjs, owner wallet_1, recovery wallet_2, thresholds 1000 STX / 0.01 BTC,
;; cooldown 144. Then the plan funds the safe (rv-fund / rv-fund-sbtc / ...).
;;
;; Error codes u91xx..u99xx are HARNESS assertion codes (a failed property).
;; ===========================================================================

;; --- rv bookkeeping ---------------------------------------------------------
(define-map context (string-ascii 100) { called: uint })
(define-public (update-context (function-name (string-ascii 100)) (called uint))
  (ok (map-set context function-name { called: called })))
(define-read-only (rv-called (name (string-ascii 100)))
  (default-to u0 (get called (map-get? context name))))

;; --- constants --------------------------------------------------------------
(define-constant RV-PUBKEY 0x03becee7a253dc4a2744f69dafa13338d3456b6da7c292caf6cf84395deea2f7ee)
(define-constant RV-PLACEHOLDER 'SP000000000000000000002Q6VF78)
(define-constant RV-BTC-RECIPIENT { version: 0x00, hashbytes: 0x0000000000000000000000000000000000000001 })
;; every principal that can plausibly end up in `admins`: all simnet accounts,
;; the default keeper, the placeholder and the fakfun deployer
(define-constant RV-PROBES (list
  'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM 'STNHKEPYEPJ8ET55ZZ0M5A34J0R3N5FM2CMMMAZ6
  'ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG
  'ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC 'ST2NEB84ASENDXKYGJPQW86YXQCEFEX2ZQPG87ND
  'ST2REHHS5J3CERCRBEPMGH7921Q6PYKAADT7JP2VB 'ST3AM1A56AK2C1XAFJ4115ZSV26EB49BVQ10MGCS0
  'ST3PF13W7Z0RRM42A8VZRVFQ75SV1K26RXEP8YGKJ 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP
  'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22 'SP000000000000000000002Q6VF78
  'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK))
(define-constant RV-OP-PROBES (list u0 u1 u2 u3 u4 u5 u6 u7 u8 u9 u10 u11 u12 u13 u14 u15
  u16 u17 u18 u19 u20 u21 u22 u23 u24 u25 u26 u27 u28 u29 u30 u31))

;; --- PoX lock emulation (patch C in build.sh) ---------------------------------
;; The node locks a pox-5 staker's amount-ustx until the unlock height; pox-5's
;; get-staker-info returns none from exactly that cycle on. Simnet never locks,
;; so the safe's account reads and outgoing STX transfers go through these.
(define-read-only (rv-staked-active)
  (match (contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-staker-info current-contract)
    info (get amount-ustx info)
    u0))
(define-read-only (rv-stx-account)
  (let ((bal (stx-get-balance current-contract)) (lk (rv-staked-active)))
    { locked: (if (> lk bal) bal lk), unlocked: (if (> lk bal) u0 (- bal lk)), unlock-height: u0 }))
(define-private (rv-stx-transfer? (amount uint) (sender principal) (recipient principal))
  (if (> amount (get unlocked (rv-stx-account)))
    (err u1)
    (stx-transfer? amount sender recipient)))
(define-private (rv-stx-transfer-memo? (amount uint) (sender principal) (recipient principal) (memo (buff 34)))
  (if (> amount (get unlocked (rv-stx-account)))
    (err u1)
    (stx-transfer-memo? amount sender recipient memo)))

;; --- RV-ONLY fuzz aids (public, so rv calls them in invariant mode) ---------
;; Anyone can send assets to the safe on mainnet too; these just give rv a way.
(define-data-var rv-stx-funded uint u0)
(define-public (rv-fund (amount uint))
  (let ((a (+ u1000000 (mod amount u3000000000))))
    (try! (stx-transfer? a tx-sender current-contract))
    (var-set rv-stx-funded (+ (var-get rv-stx-funded) a))
    (ok a)))
(define-public (rv-fund-sbtc (amount uint))
  (let ((a (+ u1000 (mod amount u2000000))))
    (try! (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token transfer
      a tx-sender current-contract none))
    (ok a)))
(define-public (rv-fund-ft (amount uint))
  (contract-call? .zz-ft mint (+ u1 (mod amount u1000000000)) current-contract))
(define-public (rv-fund-nft)
  (contract-call? .zz-nft mint current-contract))
;; The production contract has no way to register a passkey after onboard, so
;; after the first owner change every passkey path would be dead for the rest of
;; the (single, shared) rv session. This re-points the test passkey at the
;; current owner -- the onboard-time state shape. HARNESS-ONLY: any finding that
;; needs it must be re-checked without it (see ../README.md).
(define-public (rv-rebind-passkey)
  (ok (map-set pubkey-to-admin RV-PUBKEY (var-get owner))))

;; --- helpers -----------------------------------------------------------------
(define-read-only (rv-is-admin (p principal)) (is-some (map-get? admins p)))
;; AVAILABLE sBTC: sbtc-token get-balance also counts sbtc-token-locked, which a
;; withdrawal request mints in place of the burned sBTC
(define-read-only (rv-sbtc-of (p principal))
  (unwrap-panic (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token get-balance-available p)))
(define-read-only (rv-unlock-cycle)
  (match (contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-staker-info current-contract)
    info (+ (get first-reward-cycle info) (get num-cycles info))
    u0))
(define-read-only (rv-cycle)
  (contract-call? 'SP000000000000000000002Q6VF78.pox-5 current-pox-reward-cycle))

;; Property tests call the SUT's public functions directly, and an inner public
;; call that returns err does NOT roll back like a top-level tx. Every property
;; therefore snapshots what the SUT can write before its first failing assert
;; and restores it on err, so a failed inner call leaves the state it would
;; leave on chain.
(define-read-only (rv-snap)
  { act: (var-get last-activity-block), spent: (var-get spent-this-period) })
(define-private (rv-restore (s { act: uint, spent: { stx: uint, sbtc: uint, gas: uint, period-start: uint } }))
  (begin
    (var-set last-activity-block (get act s))
    (var-set spent-this-period (get spent s))
    true))

;; ===========================================================================
;; INVARIANTS (invariant mode: checked after every random call sequence)
;; ===========================================================================

;; I1. exactly one admin, and it is the owner. Every owner change
;; (onboard / confirm-transfer-wallet / recover-inactive-wallet) must move the
;; single admin seat; an empty or doubled seat means a bricked or co-owned safe.
(define-read-only (invariant-single-admin-is-owner)
  (let ((o (var-get owner)))
    (and (rv-is-admin o)
         (not (rv-is-admin current-contract))
         (is-eq (len (filter rv-is-admin RV-PROBES))
                (if (is-some (index-of? RV-PROBES o)) u1 u0)))))

;; I2. the safe never names itself as owner or recovery
(define-read-only (invariant-no-self-reference)
  (and (not (is-eq (var-get owner) current-contract))
       (not (is-eq (var-get recovery-address) current-contract))
       (not (is-eq (var-get pending-recovery) current-contract))))

;; I3. max-gas and a queued max-gas never exceed the hard ceiling
(define-read-only (invariant-gas-within-ceiling)
  (and (<= (var-get max-gas-amount) MAX-GAS-CEILING)
       (<= (get amount (var-get pending-max-gas)) MAX-GAS-CEILING)))

;; I4. the gas fuse. Enforced payments check (spent + fee) <= max-gas * 25;
;; only confirm-transfer-wallet is GAS-EXEMPT, and each exempt fee is capped by
;; the (with-ft sbtc max-gas-amount) allowance. So spent gas is bounded by the
;; cap at payment time plus one max-gas per exempt payment.
(define-read-only (invariant-gas-fuse)
  (let ((g (get gas (var-get spent-this-period)))
        (exempt (rv-called "confirm-transfer-wallet")))
    (if (is-eq (rv-called "confirm-max-gas-amount") u0)
      (<= g (* (var-get max-gas-amount) (+ GAS-CALLS-PER-PERIOD exempt)))
      (<= g (* MAX-GAS-CEILING (+ GAS-CALLS-PER-PERIOD exempt))))))

;; I5. cooldown inside its bounds; a queued config is empty or legal
(define-read-only (invariant-config-bounds)
  (let ((cd (get cooldown-period (var-get wallet-config)))
        (pcd (get cooldown-period (var-get pending-config))))
    (and (>= cd MIN-COOLDOWN) (<= cd MAX-CONFIG-COOLDOWN)
         (or (is-eq pcd u0) (and (>= pcd MIN-COOLDOWN) (<= pcd MAX-CONFIG-COOLDOWN))))))

;; I6. per-period spend never passes the thresholds without a pending op.
;; set-wallet-config may LOWER a threshold below what the period already spent,
;; so the check holds strictly until the first successful set-wallet-config.
(define-read-only (invariant-spend-within-thresholds)
  (let ((s (var-get spent-this-period)) (c (var-get wallet-config)))
    (or (> (rv-called "set-wallet-config") u0)
        (and (<= (get stx s) (get stx-threshold c))
             (<= (get sbtc s) (get sbtc-threshold c))))))

;; I7. accounting: the active pox-5 position is fully backed by STX the safe
;; holds (staked + liquid == balance, liquid >= 0). Fails if STX can leave while
;; locked or if a stake/update/restake can lock more than the safe has.
(define-read-only (invariant-stake-backed-by-balance)
  (<= (rv-staked-active) (stx-get-balance current-contract)))

;; I8. the only stake target is the Juice signer pool
(define-read-only (invariant-position-signer-is-juice)
  (match (contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-staker-info current-contract)
    info (is-eq (get signer info) JUICE-SIGNER)
    true))

;; I9. no lock ever runs past next cycle + NUM-CYCLES (96)
(define-read-only (invariant-lock-at-most-96)
  (match (contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-staker-info current-contract)
    info (<= (+ (get first-reward-cycle info) (get num-cycles info)) (+ (rv-cycle) u1 NUM-CYCLES))
    true))

;; I10. pending ops: ids below the nonce exist, the nonce slot is free, and no
;; op is ever both executed and vetoed (so a veto always means "never pays").
(define-private (rv-op-ok (id uint) (acc bool))
  (and acc
    (match (map-get? pending-operations id)
      op (and (< id (var-get operation-nonce)) (not (and (get executed op) (get vetoed op))))
      (>= id (var-get operation-nonce)))))
(define-read-only (invariant-pending-ops-consistent)
  (let ((n (var-get operation-nonce)))
    (and (fold rv-op-ok RV-OP-PROBES true)
         (is-none (map-get? pending-operations n))
         (or (is-eq n u0) (is-some (map-get? pending-operations (- n u1)))))))

;; I11. activity is never stamped in the future
(define-read-only (invariant-activity-not-future)
  (<= (var-get last-activity-block) burn-block-height))

;; I12. the keeper is never the safe itself unless the owner put it there
;; (set-keeper accepts any principal); and never the placeholder
(define-read-only (invariant-keeper-not-placeholder)
  (not (is-eq (var-get keeper) RV-PLACEHOLDER)))

;; ===========================================================================
;; PROPERTIES (property mode: one public test-* call per run, random caller and args,
;; admin paths only -- rv cannot sign passkeys here and property mode runs no
;; dialers). (err u9xxx) = FAIL. (ok true) = the inner call SUCCEEDED and every
;; effect was checked, so rv's PASSED count is the number of successful
;; state-changing calls. A refused inner call is restored and DISCARDED
;; (ok false); "only X may call" is enforced in the success branch (a success
;; by anyone else fails the property), so a discard never hides it.
;; ===========================================================================

;; funding aid inside property mode (the rv-* helpers are not called in this mode)
(define-public (test-zz-fund (amount uint))
  (let ((b0 (stx-get-balance current-contract)) (s0 (rv-sbtc-of current-contract))
        (a (try! (rv-fund amount))) (sa (try! (rv-fund-sbtc amount))))
    (try! (rv-fund-nft))
    (asserts! (is-eq (stx-get-balance current-contract) (+ b0 a)) (err u9001))
    (asserts! (is-eq (rv-sbtc-of current-contract) (+ s0 sa)) (err u9002))
    (ok true)))

;; P1. stx-transfer: only an admin moves STX; an immediate send moves exactly
;; `amount` from unlocked STX to `recipient`; over the threshold it queues an
;; admin-created op and moves nothing.
(define-public (test-stx-transfer (amount uint) (recipient principal))
  (let ((s (rv-snap)) (admin (rv-is-admin tx-sender))
        (bal0 (stx-get-balance current-contract)) (rbal0 (stx-get-balance recipient))
        (n0 (var-get operation-nonce)) (queue (would-exceed-stx-threshold amount))
        (unl (get unlocked (rv-stx-account))))
    (match (stx-transfer amount recipient none none none)
      okv (begin
        (asserts! admin (err u9100))
        (if queue
          (let ((op (unwrap! (map-get? pending-operations n0) (err u9101))))
            (asserts! (is-eq (var-get operation-nonce) (+ n0 u1)) (err u9102))
            (asserts! (is-eq (stx-get-balance current-contract) bal0) (err u9103))
            (asserts! (and (is-eq (get op-type op) "stx-transfer") (is-eq (get amount op) amount)
                           (is-eq (get recipient op) recipient) (not (get executed op))
                           (not (get vetoed op)) (not (get passkey-created op))) (err u9104))
            (ok true))
          (begin
            (asserts! (<= amount unl) (err u9105))
            (asserts! (is-eq (stx-get-balance current-contract) (- bal0 amount)) (err u9106))
            (asserts! (is-eq (stx-get-balance recipient) (+ rbal0 amount)) (err u9107))
            (asserts! (is-eq (var-get operation-nonce) n0) (err u9108))
            (ok true))))
      e (begin
        (rv-restore s)
        (asserts! (is-eq (stx-get-balance current-contract) bal0) (err u9109))
        (ok false)))))

;; P2. sBTC through sip010-transfer: same rules with the sBTC threshold
(define-public (test-sbtc-transfer (amount uint) (recipient principal))
  (let ((s (rv-snap)) (admin (rv-is-admin tx-sender))
        (bal0 (rv-sbtc-of current-contract)) (rbal0 (rv-sbtc-of recipient))
        (n0 (var-get operation-nonce)) (queue (would-exceed-sbtc-threshold amount)))
    (match (sip010-transfer amount recipient none
             'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token "sbtc-token" none none)
      okv (begin
        (asserts! admin (err u9200))
        (if queue
          (let ((op (unwrap! (map-get? pending-operations n0) (err u9201))))
            (asserts! (is-eq (var-get operation-nonce) (+ n0 u1)) (err u9202))
            (asserts! (is-eq (rv-sbtc-of current-contract) bal0) (err u9203))
            (asserts! (and (is-eq (get op-type op) "sbtc-transfer") (is-eq (get amount op) amount)
                           (is-eq (get recipient op) recipient)
                           (is-eq (get token op) (some SBTC-CONTRACT))
                           (not (get passkey-created op))) (err u9204))
            (ok true))
          (begin
            (asserts! (is-eq (rv-sbtc-of current-contract) (- bal0 amount)) (err u9205))
            (asserts! (is-eq (rv-sbtc-of recipient) (+ rbal0 amount)) (err u9206))
            (asserts! (is-eq (var-get operation-nonce) n0) (err u9207))
            (ok true))))
      e (begin
        (rv-restore s)
        (asserts! (is-eq (rv-sbtc-of current-contract) bal0) (err u9208))
        (ok false)))))

;; P3. a non-sBTC SIP-010 never queues and moves exactly `amount`
(define-public (test-ft-transfer (amount uint) (recipient principal) (t <sip-010-trait>))
  (let ((s (rv-snap)) (admin (rv-is-admin tx-sender))
        (bal0 (unwrap-panic (contract-call? .zz-ft get-balance current-contract)))
        (n0 (var-get operation-nonce)))
    (match (sip010-transfer amount recipient none t "zz-ft" none none)
      okv (begin
        (asserts! admin (err u9300))
        (asserts! (is-eq (contract-of t) .zz-ft) (err u9301))
        (asserts! (is-eq (var-get operation-nonce) n0) (err u9302))
        (asserts! (is-eq (unwrap-panic (contract-call? .zz-ft get-balance current-contract))
                         (- bal0 amount)) (err u9303))
        (ok true))
      e (begin (rv-restore s) (ok false)))))

;; P4. sBTC withdrawal: only an admin; moves (locks) exactly amount + max-fee,
;; or queues an sbtc-withdraw op that moves nothing
(define-public (test-sbtc-withdrawal (amount uint) (max-fee uint))
  (let ((s (rv-snap)) (admin (rv-is-admin tx-sender))
        (a (+ u547 (mod amount u200000))) (f (mod max-fee u5000))
        (bal0 (rv-sbtc-of current-contract))
        (n0 (var-get operation-nonce)) (queue (would-exceed-sbtc-threshold (+ a f))))
    (match (sbtc-initiate-withdrawal a RV-BTC-RECIPIENT f none none)
      okv (begin
        (asserts! admin (err u9400))
        (if queue
          (let ((op (unwrap! (map-get? pending-operations n0) (err u9401))))
            (asserts! (is-eq (rv-sbtc-of current-contract) bal0) (err u9402))
            (asserts! (and (is-eq (get op-type op) "sbtc-withdraw") (is-eq (get amount op) a)
                           (is-eq (get recipient op) current-contract)) (err u9403))
            (ok true))
          (begin
            (asserts! (is-eq (rv-sbtc-of current-contract) (- bal0 (+ a f))) (err u9404))
            (asserts! (is-eq (var-get operation-nonce) n0) (err u9405))
            (ok true))))
      e (begin (rv-restore s) (ok false)))))

;; P5. a pending op pays out at most once, never after a veto, never before its
;; cooldown, only for an admin, and exactly its recorded amount.
(define-private (rv-exec (id uint) (op-type (string-ascii 20)))
  (if (is-eq op-type "stx-transfer")
    (execute-pending-stx-transfer id none)
    (if (is-eq op-type "sbtc-transfer")
      (execute-pending-sbtc-transfer id none)
      (match (execute-pending-sbtc-withdrawal id) v (ok true) e (err e)))))
(define-public (test-execute-pending-once (seed uint))
  (let ((n (var-get operation-nonce)))
    (if (is-eq n u0)
      (ok false)
      (let ((id (mod seed n))
            (op (unwrap-panic (map-get? pending-operations id)))
            (t (get op-type op))
            (s (rv-snap)) (admin (rv-is-admin tx-sender))
            (stx0 (stx-get-balance current-contract)) (sb0 (rv-sbtc-of current-contract))
            (due (>= burn-block-height (get execute-after op))))
        (match (rv-exec id t)
          okv (begin
            (asserts! admin (err u9500))
            (asserts! (not (get executed op)) (err u9501))
            (asserts! (not (get vetoed op)) (err u9502))
            (asserts! due (err u9503))
            (asserts! (get executed (unwrap-panic (map-get? pending-operations id))) (err u9504))
            (asserts! (if (is-eq t "stx-transfer")
                        (and (is-eq (stx-get-balance current-contract) (- stx0 (get amount op)))
                             (is-eq (rv-sbtc-of current-contract) sb0))
                        (and (is-eq (stx-get-balance current-contract) stx0)
                             (<= (rv-sbtc-of current-contract) (- sb0 (get amount op)))))
              (err u9505))
            ;; the same op again must be refused with err-already-executed
            (asserts! (is-eq (match (rv-exec id t) v u0 e2 e2) u4014) (err u9506))
            (ok true))
          e (begin
            (rv-restore s)
            (map-set pending-operations id op)
            (asserts! (is-eq (stx-get-balance current-contract) stx0) (err u9507))
            (ok false)))))))

;; P6. veto: only an admin, never after execution; a vetoed op never pays
(define-public (test-veto-blocks-execution (seed uint))
  (let ((n (var-get operation-nonce)))
    (if (is-eq n u0)
      (ok false)
      (let ((id (mod seed n))
            (op (unwrap-panic (map-get? pending-operations id)))
            (s (rv-snap)) (admin (rv-is-admin tx-sender))
            (stx0 (stx-get-balance current-contract)) (sb0 (rv-sbtc-of current-contract)))
        (match (veto-operation id none none)
          okv (begin
            (asserts! admin (err u9600))
            (asserts! (not (get executed op)) (err u9601))
            (asserts! (get vetoed (unwrap-panic (map-get? pending-operations id))) (err u9602))
            (asserts! (is-err (rv-exec id (get op-type op))) (err u9603))
            (asserts! (and (is-eq (stx-get-balance current-contract) stx0)
                           (is-eq (rv-sbtc-of current-contract) sb0)) (err u9604))
            (ok true))
          e (begin
            (rv-restore s)
            (ok false)))))))

;; P7. stake: only an admin; the position is exactly {amount, Juice signer,
;; next cycle, 96 cycles}; no STX leaves the safe
(define-public (test-stake (amount uint))
  (let ((s (rv-snap)) (admin (rv-is-admin tx-sender))
        (info0 (contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-staker-info current-contract))
        (bal0 (stx-get-balance current-contract)) (cyc (rv-cycle)))
    (match (stake-stx-juice amount none none none)
      okv (let ((info (unwrap! (contract-call? 'SP000000000000000000002Q6VF78.pox-5
                          get-staker-info current-contract) (err u9701))))
        (asserts! admin (err u9700))
        (asserts! (is-none info0) (err u9702))
        (asserts! (and (is-eq (get amount-ustx info) amount) (is-eq (get signer info) JUICE-SIGNER)
                       (is-eq (get num-cycles info) NUM-CYCLES)
                       (is-eq (get first-reward-cycle info) (+ cyc u1))) (err u9703))
        (asserts! (<= amount bal0) (err u9704))
        (asserts! (is-eq (stx-get-balance current-contract) bal0) (err u9705))
        (ok true))
      e (begin (rv-restore s) (ok false)))))

;; P8. update-stake: only an admin; amount grows by exactly the increase, which
;; must come from unlocked STX; the lock grows by exactly cycles-to-extend
(define-public (test-update-stake (amount-increase uint) (cycles uint))
  (let ((s (rv-snap)) (admin (rv-is-admin tx-sender)) (c (mod cycles u4))
        (info0 (contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-staker-info current-contract))
        (unl0 (get unlocked (rv-stx-account))) (unl-c0 (rv-unlock-cycle))
        (bal0 (stx-get-balance current-contract)))
    (match (update-stake-stx-juice amount-increase c none none none)
      okv (let ((i0 (unwrap! info0 (err u9801)))
                (info (unwrap! (contract-call? 'SP000000000000000000002Q6VF78.pox-5
                          get-staker-info current-contract) (err u9802))))
        (asserts! admin (err u9800))
        (asserts! (<= amount-increase unl0) (err u9803))
        (asserts! (is-eq (get amount-ustx info) (+ (get amount-ustx i0) amount-increase)) (err u9804))
        (asserts! (is-eq (rv-unlock-cycle) (+ unl-c0 c)) (err u9805))
        (asserts! (is-eq (get signer info) JUICE-SIGNER) (err u9806))
        (asserts! (is-eq (stx-get-balance current-contract) bal0) (err u9807))
        (ok true))
      e (begin (rv-restore s) (ok false)))))

;; P9. unstake: only an admin; the position ends after the NEXT cycle with the
;; same amount still locked until then; after it the keeper cannot re-lock
(define-public (test-unstake)
  (let ((s (rv-snap)) (admin (rv-is-admin tx-sender))
        (info0 (contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-staker-info current-contract))
        (bal0 (stx-get-balance current-contract)) (cyc (rv-cycle)))
    (match (unstake none none)
      okv (let ((i0 (unwrap! info0 (err u9901)))
                (info (unwrap! (contract-call? 'SP000000000000000000002Q6VF78.pox-5
                          get-staker-info current-contract) (err u9902))))
        (asserts! admin (err u9900))
        (asserts! (is-eq (rv-unlock-cycle) (+ cyc u1)) (err u9903))
        (asserts! (is-eq (get amount-ustx info) (get amount-ustx i0)) (err u9904))
        (asserts! (is-eq (stx-get-balance current-contract) bal0) (err u9905))
        (asserts! (is-err (restake)) (err u9906))
        (ok true))
      e (begin (rv-restore s) (ok false)))))

;; P10. restake: only the keeper (contract-caller); moves no STX; adds exactly
;; the unlocked STX; rolls the lock to next cycle + 96 and never shortens it;
;; keeps the Juice signer; does NOT refresh owner activity
(define-public (test-restake)
  (let ((is-keeper (is-eq tx-sender (var-get keeper)))
        (act0 (var-get last-activity-block))
        (info0 (contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-staker-info current-contract))
        (unl0 (get unlocked (rv-stx-account))) (unl-c0 (rv-unlock-cycle))
        (bal0 (stx-get-balance current-contract)) (cyc (rv-cycle)))
    (match (restake)
      res (let ((i0 (unwrap! info0 (err u9951)))
                (info (unwrap! (contract-call? 'SP000000000000000000002Q6VF78.pox-5
                          get-staker-info current-contract) (err u9952)))
                (target (+ cyc u1 NUM-CYCLES)))
        (asserts! is-keeper (err u9950))
        (asserts! (> unl-c0 (+ cyc u1)) (err u9953))
        (asserts! (is-eq (get amount res) unl0) (err u9954))
        (asserts! (is-eq (get amount-ustx info) (+ (get amount-ustx i0) unl0)) (err u9955))
        (asserts! (is-eq (rv-unlock-cycle) (if (> target unl-c0) target unl-c0)) (err u9956))
        (asserts! (is-eq (get signer info) JUICE-SIGNER) (err u9957))
        (asserts! (is-eq (stx-get-balance current-contract) bal0) (err u9958))
        (asserts! (is-eq (var-get last-activity-block) act0) (err u9959))
        (ok true))
      e (begin
        ;; a non-keeper is refused (u4001, or u4040 first when nothing is staked)
        (asserts! (or is-keeper (is-eq e u4001) (is-eq e u4040)) (err u9960))
        (ok false)))))

;; P11. set-keeper: only an admin
(define-public (test-set-keeper (k principal))
  (let ((s (rv-snap)) (admin (rv-is-admin tx-sender)) (k0 (var-get keeper)) (o0 (var-get owner)))
    (match (set-keeper k none none)
      okv (begin
        (asserts! admin (err u9970))
        (asserts! (is-eq (var-get keeper) k) (err u9971))
        (asserts! (is-eq (var-get owner) o0) (err u9972))
        (ok true))
      e (begin
        (rv-restore s)
        (asserts! (is-eq (var-get keeper) k0) (err u9973))
        (ok false)))))

;; P12. recover-inactive-wallet: only the recovery address, only when inactive;
;; the new admin is the only admin, the owner, and the keeper (auto-restake off)
(define-public (test-recover-inactive (new-admin principal))
  (let ((s (rv-snap)) (o0 (var-get owner)) (o0-admin (rv-is-admin (var-get owner)))
        (k0 (var-get keeper))
        (allowed (and (is-inactive) (is-eq tx-sender (var-get recovery-address)))))
    (match (recover-inactive-wallet new-admin)
      okv (begin
        (asserts! allowed (err u9980))
        (asserts! (is-eq (var-get owner) new-admin) (err u9981))
        (asserts! (rv-is-admin new-admin) (err u9982))
        (asserts! (or (is-eq o0 new-admin) (not (rv-is-admin o0))) (err u9983))
        (asserts! (is-eq (var-get keeper) new-admin) (err u9984))
        (asserts! (is-eq (var-get last-activity-block) burn-block-height) (err u9985))
        (ok true))
      e (begin
        (rv-restore s)
        (if o0-admin (map-set admins o0 true) true)
        (asserts! (and (is-eq (var-get owner) o0) (is-eq (var-get keeper) k0)) (err u9986))
        (ok false)))))

;; P13. owner-only configuration entry points refuse everyone else
(define-public (test-admin-only-config (amount uint) (who principal) (enabled bool) (cd uint))
  (let ((s (rv-snap)) (admin (rv-is-admin tx-sender))
        (gas0 (var-get pending-max-gas)) (cfg0 (var-get wallet-config))
        (pt0 (var-get pending-transfer)) (lock0 (var-get token-lock-enabled))
        (r1 (propose-max-gas-amount amount))
        (r2 (propose-transfer-wallet who))
        (r3 (toggle-token-lock enabled none none))
        (r4 (signal-config-change amount amount (+ u100 (mod cd u4100)))))
    (if admin
      (begin
        ;; an admin's proposals stay inside their bounds
        (asserts! (is-eq (is-ok r1) (<= amount MAX-GAS-CEILING)) (err u9990))
        (asserts! (<= (get amount (var-get pending-max-gas)) MAX-GAS-CEILING) (err u9991))
        (asserts! (is-eq (is-ok r2) (not (is-eq who tx-sender))) (err u9992))
        (asserts! (is-ok r3) (err u9993))
        (asserts! (is-eq (var-get token-lock-enabled) enabled) (err u9994))
        ;; signalling never applies the new thresholds by itself
        (asserts! (and (is-eq (get stx-threshold (var-get wallet-config)) (get stx-threshold cfg0))
                       (is-eq (get sbtc-threshold (var-get wallet-config)) (get sbtc-threshold cfg0))
                       (is-eq (get cooldown-period (var-get wallet-config)) (get cooldown-period cfg0)))
          (err u9995))
        (ok true))
      (begin
        (asserts! (and (is-err r1) (is-err r2) (is-err r3) (is-err r4)) (err u9996))
        (rv-restore s)
        (asserts! (and (is-eq (var-get pending-max-gas) gas0) (is-eq (var-get wallet-config) cfg0)
                       (is-eq (var-get pending-transfer) pt0)
                       (is-eq (var-get token-lock-enabled) lock0)) (err u9997))
        (ok true)))))
