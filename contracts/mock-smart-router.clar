;; mock-smart-router  a trait-conforming router that is NOT registered in
;; fakfun-smart-router-registry. Used only by the sim to prove the wallet
;; rejects an unapproved router (err-router-not-approved) even though it
;; structurally satisfies faktory-smart-trait-v1. Never deployed to mainnet.
(impl-trait 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.faktory-smart-trait-v1.smart-trait)

(define-public (buy-with-sbtc (sbtc-amount uint) (min-token-out uint) (fak-ratio uint) (flag bool))
  (ok { sbtc-amount: sbtc-amount, token-from-fak: u0, token-from-dex: u0, total-token-out: u0 }))
(define-public (buy-with-stx (stx-amount uint) (min-token-out uint) (fak-ratio uint) (flag bool))
  (ok { stx-amount: stx-amount, token-from-alex: u0, token-from-fak: u0, total-token-out: u0 }))
(define-public (sell-for-sbtc (token-amount uint) (min-sbtc-out uint) (fak-ratio uint) (flag bool))
  (ok { token-amount: token-amount, sbtc-from-fak: u0, sbtc-from-dex: u0, total-sbtc-out: u0 }))
(define-public (sell-for-stx (token-amount uint) (min-stx-out uint) (fak-ratio uint) (flag bool))
  (ok { token-amount: token-amount, stx-from-alex: u0, stx-from-dex: u0, total-stx-out: u0 }))
