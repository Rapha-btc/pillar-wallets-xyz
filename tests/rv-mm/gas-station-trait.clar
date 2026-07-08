(define-trait gas-station-trait
  (
    (pay-gas () (response bool uint))
    (pay-gas-with-pyth () (response bool uint))
    (get-gas-amount () (response uint uint))
  )
)
