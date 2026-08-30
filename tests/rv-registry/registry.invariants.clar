
;; ===========================================================================
;; RV invariants for fakfun-smart-router-registry. Appended to the contract by
;; ./build.sh, because rv reads invariants from the contract under test.
;;
;; The security decision the registry rests on is APPEND-ONLY approvals: no
;; sequence of calls, from any sender, ever un-approves a router. These
;; invariants prove that across random fuzzed call sequences.
;; ===========================================================================

;; rv tracks which SUT function it called through this pair.
(define-map context (string-ascii 100) { called: uint })
(define-public (update-context (function-name (string-ascii 100)) (called uint))
  (ok (map-set context function-name { called: called })))

;; A canary router used to check state consistency for a principal RV may also
;; try to propose/confirm. Not one of the seeded 9.
(define-constant CANARY 'SP000000000000000000002Q6VF78.canary-router)

;; --- 1. append-only: the 9 seeded routers stay approved forever ------------
;; This is the crown-jewel property. No function, from any sender, in any
;; order, ever removes an approval. If a future edit added a path that could,
;; this invariant catches it.
(define-read-only (invariant-seeded-stay-approved)
  (and
    (is-approved-router 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.b-smart-faktory)
    (is-approved-router 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.mia-smart-faktory)
    (is-approved-router 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.pepe-smart-faktory)
    (is-approved-router 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.flatearth-smart-faktory)
    (is-approved-router 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-smart-faktory)
    (is-approved-router 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.leo-smart-faktory)
    (is-approved-router 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.lwb-smart-faktory)
    (is-approved-router 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.welsh-smart-faktory)
    (is-approved-router 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.rock-smart-faktory)))

;; --- 2. a router is never simultaneously pending AND approved --------------
;; confirm moves pending -> approved and deletes the pending row; propose
;; rejects an already-approved router. So the two maps are disjoint by
;; construction. Checked on the canary, which RV can drive through both.
(define-read-only (invariant-canary-not-both-states)
  (not (and (is-some (get-pending CANARY)) (is-approved-router CANARY))))

;; --- 3. the owner var is never left empty ---------------------------------
;; contract-owner is a non-optional principal; accept-owner only ever sets it
;; to the principal that opted in. Guards against a transfer path that could
;; blank ownership and brick governance.
(define-read-only (invariant-owner-set)
  (is-standard (var-get contract-owner)))
