(use-trait nft-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)
(use-trait ft-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)
(define-trait nftmarket-trait
  (
    (list-nft (uint <nft-trait> <ft-trait> uint) (response bool uint))
    (buy-nft (uint <nft-trait> <ft-trait>) (response bool uint))
    (unlist-nft (uint <nft-trait>) (response bool uint))
    (update-price (uint uint) (response bool uint))
    (update-listing-ft (uint <ft-trait> uint) (response bool uint))
  )
)
