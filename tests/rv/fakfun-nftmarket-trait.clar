(use-trait nft-trait .nft-trait.nft-trait)
(use-trait ft-trait .sip-010-trait.sip-010-trait)

(define-trait nftmarket-trait
  (
    (list-nft (uint <nft-trait> <ft-trait> uint) (response bool uint))
    (buy-nft (uint <nft-trait> <ft-trait>) (response bool uint))
    (unlist-nft (uint <nft-trait>) (response bool uint))
    (update-price (uint uint) (response bool uint))
    (update-listing-ft (uint <ft-trait> uint) (response bool uint))
  )
)
