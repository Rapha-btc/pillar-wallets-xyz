(define-public (swap-sbtc-for-stx
    (amount uint)
    (jing-amount uint)
    (limit-price uint)
    (update (optional (buff 8192)))
    (fallback (optional uint))
    (amm-amounts {
      zest: uint,
      dlmm: uint,
      xyk: uint,
      velar: uint,
    })
    (amm-mins {
      zest: uint,
      dlmm: uint,
      xyk: uint,
      velar: uint,
    })
    (min-stx-out uint)
    (zest-route {
      ticks: (list 32 int),
      price: uint,
    })
  ) (if true (ok true) (err u999)))
(define-public (swap-stx-for-sbtc
    (amount uint)
    (jing-amount uint)
    (limit-price uint)
    (update (optional (buff 8192)))
    (fallback (optional uint))
    (amm-amounts {
      zest: uint,
      dlmm: uint,
      xyk: uint,
      velar: uint,
    })
    (amm-mins {
      zest: uint,
      dlmm: uint,
      xyk: uint,
      velar: uint,
    })
    (min-sbtc-out uint)
    (zest-route {
      ticks: (list 32 int),
      price: uint,
    })
  ) (if true (ok true) (err u999)))
