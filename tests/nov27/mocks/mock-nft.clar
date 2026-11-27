;; Mock SIP-009 NFT for trait-arg purposes only.
(impl-trait .nft-trait.nft-trait)

(define-non-fungible-token mock-nft uint)

(define-read-only (get-last-token-id) (if true (ok u1) (err u0)))
(define-read-only (get-token-uri (id uint)) (ok (some "https://mock/")))
(define-read-only (get-owner (id uint)) (ok (nft-get-owner? mock-nft id)))
(define-public (transfer (id uint) (sender principal) (recipient principal))
  (nft-transfer? mock-nft id sender recipient))
