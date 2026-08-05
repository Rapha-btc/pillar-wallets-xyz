;; Test staker b. Two separate contracts because pox-5 keys a staker off tx-sender,
;; so distinct staker principals need distinct contracts. Used to drive
;; pay-stx-stakers with MORE THAN ONE staker, which is what exercises share
;; splitting, the fee cut, and the rounding residue.
(use-trait signer-mgr 'SP000000000000000000002Q6VF78.pox-5.signer-manager-trait)
(define-constant POX5 'SP000000000000000000002Q6VF78.pox-5)
(define-constant NUM-CYCLES u96)

(define-public (stake (signer <signer-mgr>) (amount uint))
  (as-contract? ((with-staking amount))
    (try! (contract-call? POX5 stake signer amount NUM-CYCLES burn-block-height none))))
