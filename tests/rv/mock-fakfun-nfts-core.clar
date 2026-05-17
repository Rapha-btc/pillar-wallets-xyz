;; Stub for fakfun-nfts-core: thin proxy that receives an <nftmarket-trait>
;; marketplace plus the NFT op args. We never invoke the marketplace, so
;; trivial ok is fine.

(use-trait nft-trait .nft-trait.nft-trait)
(use-trait ft-trait .sip-010-trait.sip-010-trait)
(use-trait nftmarket-trait .fakfun-nftmarket-trait.nftmarket-trait)

(define-public (list-nft (marketplace <nftmarket-trait>) (token-id uint) (nft-contract <nft-trait>) (ft-contract <ft-trait>) (price uint))
  (if true (ok true) (err u0)))

(define-public (buy-nft (marketplace <nftmarket-trait>) (token-id uint) (nft-contract <nft-trait>) (ft-contract <ft-trait>))
  (if true (ok true) (err u0)))

(define-public (unlist-nft (marketplace <nftmarket-trait>) (token-id uint) (nft-contract <nft-trait>))
  (if true (ok true) (err u0)))

(define-public (update-price (marketplace <nftmarket-trait>) (token-id uint) (price uint))
  (if true (ok true) (err u0)))

(define-public (update-listing-ft (marketplace <nftmarket-trait>) (token-id uint) (ft-contract <ft-trait>) (price uint))
  (if true (ok true) (err u0)))
