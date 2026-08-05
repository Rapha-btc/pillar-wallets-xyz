;; Test-only SIP-009 NFT so sip009-transfer can be driven for real.
(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)

(define-non-fungible-token zz-nft uint)
(define-data-var last-id uint u0)

(define-read-only (get-last-token-id) (ok (var-get last-id)))
(define-read-only (get-token-uri (id uint)) (ok none))
(define-read-only (get-owner (id uint)) (ok (nft-get-owner? zz-nft id)))

(define-public (transfer (id uint) (from principal) (to principal))
  (begin
    (asserts! (is-eq tx-sender from) (err u401))
    (nft-transfer? zz-nft id from to)))

(define-public (mint (to principal))
  (let ((id (+ u1 (var-get last-id))))
    (var-set last-id id)
    (try! (nft-mint? zz-nft id to))
    (ok id)))

;; test util: the burn header hash as a plain buff, so the harness can build a
;; valid sbtc-deposit call. (get-burn-block-info? ...) returns an optional, which
;; the JS pretty-printer cannot render.
(define-read-only (burn-hash (h uint))
  (unwrap-panic (get-burn-block-info? header-hash h)))
