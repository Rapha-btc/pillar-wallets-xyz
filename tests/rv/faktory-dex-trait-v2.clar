(use-trait faktory-token .faktory-trait-v1.sip-010-trait)

(define-trait dex-trait
  (
    (buy (<faktory-token> uint) (response uint uint))
    (sell (<faktory-token> uint) (response uint uint))
    (get-open () (response bool uint))
    (get-bonded () (response bool uint))
    (get-in (uint) (response {
        total-stx: uint, total-stk: uint, ft-balance: uint, k: uint, fee: uint,
        stx-in: uint, new-stk: uint, new-ft: uint, tokens-out: uint, new-stx: uint, stx-to-grad: uint
    } uint))
    (get-out (uint) (response {
        total-stx: uint, total-stk: uint, ft-balance: uint, k: uint, new-ft: uint,
        new-stk: uint, stx-out: uint, fee: uint, stx-to-receiver: uint, amount-in: uint, new-stx: uint
    } uint))
  )
)
