;; Mock nftmarket-trait impl. The wallet's faktory-nft-execute pushes a
;; <nftmarket-trait> arg through to fakfun-core-v2; RV never actually
;; reaches the dispatch (sig bounce), so trivial ok is fine.
(impl-trait .fakfun-nftmarket-trait.nftmarket-trait)

(use-trait nft-trait .nft-trait.nft-trait)
(use-trait ft-trait .sip-010-trait.sip-010-trait)

(define-public (list-nft (id uint) (nft <nft-trait>) (ft <ft-trait>) (price uint)) (if true (ok true) (err u0)))
(define-public (buy-nft (id uint) (nft <nft-trait>) (ft <ft-trait>)) (if true (ok true) (err u0)))
(define-public (unlist-nft (id uint) (nft <nft-trait>)) (if true (ok true) (err u0)))
(define-public (update-price (id uint) (new-price uint)) (if true (ok true) (err u0)))
(define-public (update-listing-ft (id uint) (ft <ft-trait>) (new-price uint)) (if true (ok true) (err u0)))
