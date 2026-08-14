;; Test-only. Settles whether clarinet's simnet enforces the SIP-044 (with-staking N)
;; allowance, by staking a real amount while declaring a deliberately tiny one.
;;
;; If enforced: the under-declared call aborts (pox-5 stake moves more than declared).
;; If not:      it succeeds, and (with-staking N) is unverified in simnet.
(use-trait signer-mgr 'SP000000000000000000002Q6VF78.pox-5.signer-manager-trait)

(define-constant POX5 'SP000000000000000000002Q6VF78.pox-5)
(define-constant NUM-CYCLES u96)

;; declares the CORRECT amount -- control
(define-public (stake-declared (signer <signer-mgr>) (amount uint))
  (as-contract? ((with-staking amount))
    (try! (contract-call? POX5 stake signer amount NUM-CYCLES burn-block-height none))))

;; declares u1 while staking `amount` -- the discriminating case
(define-public (stake-underdeclared (signer <signer-mgr>) (amount uint))
  (as-contract? ((with-staking u1))
    (try! (contract-call? POX5 stake signer amount NUM-CYCLES burn-block-height none))))
