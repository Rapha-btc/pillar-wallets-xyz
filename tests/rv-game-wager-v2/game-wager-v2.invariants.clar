;; ============================================================================
;; RENDEZVOUS INVARIANTS for game-wager-v2
;; ============================================================================
;; game-wager-v2 is mostly auth-gated:
;;   * deposit         - no sig, anyone can deposit on behalf of a pubkey
;;   * register-wallet - webauthn sig required (consume-signature)
;;   * withdraw        - webauthn sig required
;;   * create-game     - tx-sender must equal oracle + 2 webauthn sigs
;;   * resolve-game    - tx-sender must equal oracle (no sig)
;;   * cancel-game     - oracle anytime, or anyone after GAME_TIMEOUT
;;   * set-*           - tx-sender must equal DEPLOYER
;;   * sweep-fees      - tx-sender must equal DEPLOYER
;;
;; RV can't forge webauthn sigs, so signed paths bounce on err-invalid-
;; signature (u7003). What we can stress:
;;   - deposit (no sig)
;;   - set-* / sweep-fees from random principals (mostly bounce on u7002)
;;   - cancel-game from random principals (bounces on u7007 unless block
;;     advancement has happened or RV happens to be DEPLOYER -- it won't)
;;
;; The invariants below assert structural protections that must hold
;; under arbitrary RV call sequences:
;; ============================================================================

(define-map context (string-ascii 100) { called: uint })

(define-public (update-context (function-name (string-ascii 100)) (called uint))
  (ok (map-set context function-name { called: called })))

;; ============================================================================
;; INVARIANT 1: game-nonce never decreases
;; ============================================================================
;; create-game increments game-nonce. No other path touches it. Once
;; incremented, a decrement would break game-id uniqueness.

(define-data-var rv-last-game-nonce uint u0)

(define-public (rv-snapshot-game-nonce)
  (begin
    (var-set rv-last-game-nonce (var-get game-nonce))
    (ok true)))

(define-read-only (invariant-game-nonce-monotonic)
  (>= (var-get game-nonce) (var-get rv-last-game-nonce)))

;; ============================================================================
;; INVARIANT 2: fee-rate stays within set-fee-rate's cap (u2000 / 20%)
;; ============================================================================
;; set-fee-rate asserts (<= new-fee-rate u2000). Default is u500.
;; A bug accepting > u2000 would let the deployer set fees above 20%.

(define-read-only (invariant-fee-rate-bounded)
  (<= (var-get fee-rate) u2000))

;; ============================================================================
;; INVARIANT 3: withdraw-fee-rate stays within set-withdraw-fee-rate's cap
;; ============================================================================
;; set-withdraw-fee-rate asserts (<= new-fee-rate u1000). Default is u100.

(define-read-only (invariant-withdraw-fee-rate-bounded)
  (<= (var-get withdraw-fee-rate) u1000))

;; ============================================================================
;; INVARIANT 4: game status is in {active, resolved, cancelled}
;; ============================================================================
;; Status is set on creation (active), resolution (resolved), and
;; cancellation (cancelled). No other writer. Any other value implies
;; map-set with corrupted data.
;;
;; We probe game-id u0 specifically since RV is unlikely to create games
;; (create-game requires oracle + sigs), so u0 may not exist; if absent,
;; the invariant holds vacuously.

(define-read-only (invariant-game-0-status-valid)
  (match (map-get? games u0)
    g (let ((s (get status g)))
        (or (is-eq s "active")
            (is-eq s "resolved")
            (is-eq s "cancelled")))
    true))

(define-read-only (invariant-game-1-status-valid)
  (match (map-get? games u1)
    g (let ((s (get status g)))
        (or (is-eq s "active")
            (is-eq s "resolved")
            (is-eq s "cancelled")))
    true))

;; ============================================================================
;; INVARIANT 5: a resolved game's winner is one of its two players
;; ============================================================================
;; resolve-game asserts (or (is-eq winner player-a) (is-eq winner player-b)).
;; A regression accepting an arbitrary pubkey would be a critical bug.

(define-read-only (invariant-game-0-winner-is-player)
  (match (map-get? games u0)
    g (if (is-eq (get status g) "resolved")
        (match (get winner g)
          w (or (is-eq w (get player-a g)) (is-eq w (get player-b g)))
          ;; resolved but no winner set -- contract bug
          false)
        ;; active or cancelled -- doesn't matter
        true)
    true))

;; ============================================================================
;; INVARIANT 6: an active game has wager-amount > 0
;; ============================================================================
;; create-game asserts (> wager-amount u0) before storing the game. A
;; zero-wager game would let players "wage" and get refunded with positive
;; fees deducted -- arithmetically impossible to credit.

(define-read-only (invariant-game-0-wager-positive)
  (match (map-get? games u0)
    g (> (get wager-amount g) u0)
    true))

;; ============================================================================
;; INVARIANT 7: a game's players differ (no self-wager)
;; ============================================================================
;; create-game asserts (not (is-eq player-a player-b)). If a game stored
;; with A == B exists, the assertion was bypassed.

(define-read-only (invariant-game-0-distinct-players)
  (match (map-get? games u0)
    g (not (is-eq (get player-a g) (get player-b g)))
    true))

;; ============================================================================
;; INVARIANT 8: oracle is a non-burn principal
;; ============================================================================
;; set-oracle takes any principal; a bug setting it to the burn address
;; would brick create-game / resolve-game.

(define-read-only (invariant-oracle-nonburn)
  (not (is-eq (var-get oracle) 'SP000000000000000000002Q6VF78)))

;; ============================================================================
;; INVARIANT 9: treasury is a non-burn principal
;; ============================================================================
;; set-treasury takes any principal; a sweep to the burn address would
;; permanently lock fees.

(define-read-only (invariant-treasury-nonburn)
  (not (is-eq (var-get treasury) 'SP000000000000000000002Q6VF78)))

;; ============================================================================
;; INVARIANT 10: GAME_TIMEOUT constant unchanged (u144)
;; ============================================================================
;; The constant should be immutable; a recompile that changes it would
;; alter the timeout window meaningfully.

(define-read-only (invariant-game-timeout-constant)
  (is-eq GAME_TIMEOUT u144))
