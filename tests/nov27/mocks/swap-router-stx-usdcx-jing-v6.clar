(define-public (swap-stx-for-usdcx
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
    (min-usdcx-out uint)
    (zest-route {
      ticks: (list 32 int),
      price: uint,
    })
  ) (if true (ok true) (err u999)))
(define-public (swap-usdcx-for-stx
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
