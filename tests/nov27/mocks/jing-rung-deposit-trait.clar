(define-trait rung-trait
  (
    (deposit (uint) (response {
      amount: uint, shares: uint, epoch: uint,
      stx-paid: uint, sbtc-paid: uint,
    } uint))
    (withdraw (uint (optional (buff 8192))) (response { stx: uint, sbtc: uint } uint))
    (claim () (response { stx: uint, sbtc: uint } uint))
  )
)
