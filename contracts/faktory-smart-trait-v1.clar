(define-trait smart-trait (
  (buy-with-sbtc
    (uint uint uint bool)
    (
      response       {
      sbtc-amount: uint,
      token-from-fak: uint,
      token-from-dex: uint,
      total-token-out: uint,
    }
      uint
    )
  )
  (buy-with-stx
    (uint uint uint bool)
    (
      response       {
      stx-amount: uint,
      token-from-alex: uint,
      token-from-fak: uint,
      total-token-out: uint,
    }
      uint
    )
  )
  (sell-for-sbtc
    (uint uint uint bool)
    (
      response       {
      token-amount: uint,
      sbtc-from-fak: uint,
      sbtc-from-dex: uint,
      total-sbtc-out: uint,
    }
      uint
    )
  )
  (sell-for-stx
    (uint uint uint bool)
    (
      response       {
      token-amount: uint,
      stx-from-alex: uint,
      stx-from-dex: uint,
      total-stx-out: uint,
    }
      uint
    )
  )
))
