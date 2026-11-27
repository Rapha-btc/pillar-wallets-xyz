(define-data-var last (optional {direction: bool, caller: principal, amount: uint, jing: uint, limit: uint, update: (optional (buff 8192)), fallback: (optional uint), amounts: {zest:uint,dlmm:uint,xyk:uint,velar:uint}, mins: {zest:uint,dlmm:uint,xyk:uint,velar:uint}, min-out:uint, route:{ticks:(list 32 int),price:uint}}) none)
(define-read-only (get-last) (var-get last))
(define-public (swap-sbtc-for-usdcx
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
  ) (begin (asserts! true (err u999)) (var-set last (some {direction: true, caller: tx-sender, amount: amount, jing: jing-amount, limit: limit-price, update: update, fallback: fallback, amounts: amm-amounts, mins: amm-mins, min-out: min-usdcx-out, route: zest-route})) (ok true)))
(define-public (swap-usdcx-for-sbtc
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
  ) (begin (asserts! true (err u999)) (var-set last (some {direction: false, caller: tx-sender, amount: amount, jing: jing-amount, limit: limit-price, update: update, fallback: fallback, amounts: amm-amounts, mins: amm-mins, min-out: min-sbtc-out, route: zest-route})) (ok true)))
