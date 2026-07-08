;; RV mock: rfq-sbtc-stx-jing. Only needs to satisfy jing-mm-safe's compile +
;; the two proxy calls (fix-price, fulfill) and the get-rfq read used by
;; fulfill-rfq. Not the fuzz target (the RFQ desk does not touch the wallet's
;; pending-operations state machine) -- present so the wallet deploys and the
;; desk proxies return ok.
(use-trait ft-trait .sip-010-trait.sip-010-trait)
(use-trait storage-trait .pyth-traits-v2.storage-trait)
(use-trait decoder-trait .pyth-traits-v2.decoder-trait)
(use-trait core-trait .wormhole-traits-v2.core-trait)

(define-read-only (get-rfq (id uint))
  (some {
    client: 'SP000000000000000000002Q6VF78,
    fixed-stx-out: (some u1000),
    open: true,
  }))

(define-read-only (get-next-rfq-id)
  u0)

(define-public (fix-price
    (id uint) (committed-out uint) (max-premium-bps uint) (auth-expiry uint)
    (sig (buff 65)) (vaa-x (buff 8192)) (vaa-y (buff 8192))
    (pyth-storage <storage-trait>) (pyth-decoder <decoder-trait>) (wormhole-core <core-trait>))
  (begin (asserts! (>= id u0) (err u1)) (ok id)))

(define-public (fulfill (id uint) (x <ft-trait>) (x-name (string-ascii 128)))
  (begin (asserts! (>= id u0) (err u1)) (ok u1000)))
