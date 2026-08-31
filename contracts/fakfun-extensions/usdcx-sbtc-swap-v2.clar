;; usdcx-sbtc-swap-v2: same DLMM swap as v1, but pays the sponsor a broadcast
;; fee on the sBTC leg. to-usdcx takes the fee from the sBTC input (swaps
;; amount - fee); to-sbtc takes it from the sBTC output (after the swap).
;; Fee defaults to 20 sats, capped at MAX-GAS (5,000 sats), changeable by the
;; sponsor only through a 144 burn-block propose/confirm cooldown.

(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.extension-trait.extension-trait)

(define-constant DLMM-ROUTER 'SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-swap-router-v-1-1)
(define-constant POOL 'SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-sbtc-usdcx-v-1-bps-10)
(define-constant SBTC 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)
(define-constant USDCX 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx)

(define-constant ERR-BAD-PAYLOAD (err u300))
(define-constant ERR-BAD-ACTION (err u301))
(define-constant ERR-ZERO-AMOUNT (err u302))
(define-constant ERR-ZERO-MIN-OUT (err u303))
(define-constant ERR-AMOUNT-BELOW-FEE (err u304))
(define-constant ERR-UNAUTHORIZED (err u305))
(define-constant ERR-NO-PENDING (err u306))
(define-constant ERR-COOLDOWN-NOT-PASSED (err u307))
(define-constant ERR-FEE-TOO-HIGH (err u308))

(define-constant MAX-GAS u5000)
(define-constant COOLDOWN-BLOCKS u144)

(define-data-var sponsor principal tx-sender)
(define-data-var fee uint u20)

(define-data-var pending-fee (optional uint) none)
(define-data-var pending-fee-block uint u0)
(define-data-var pending-sponsor (optional principal) none)
(define-data-var pending-sponsor-block uint u0)

(define-read-only (get-fee)
  (var-get fee)
)

(define-read-only (get-sponsor)
  (var-get sponsor)
)

(define-read-only (get-pending-fee)
  {
    pending: (var-get pending-fee),
    block: (var-get pending-fee-block),
  }
)

(define-read-only (get-pending-sponsor)
  {
    pending: (var-get pending-sponsor),
    block: (var-get pending-sponsor-block),
  }
)

(define-read-only (encode-to-sbtc
    (usdcx-amount uint)
    (min-sbtc-out uint)
    (max-steps uint)
  )
  (to-consensus-buff? {
    action: "to-sbtc",
    amount: usdcx-amount,
    min-out: min-sbtc-out,
    max-steps: max-steps,
  })
)

(define-read-only (encode-to-usdcx
    (sbtc-amount uint)
    (min-usdcx-out uint)
    (max-steps uint)
  )
  (to-consensus-buff? {
    action: "to-usdcx",
    amount: sbtc-amount,
    min-out: min-usdcx-out,
    max-steps: max-steps,
  })
)

(define-private (pay-sponsor (amount uint))
  (let ((spon (var-get sponsor)))
    (print {
      a: "pay-sponsor",
      from: tx-sender,
      to: spon,
      amount: amount,
    })
    (contract-call? SBTC transfer amount tx-sender spon none)
  )
)

(define-public (call (payload (buff 2048)))
  (let (
      (cmd (unwrap!
        (from-consensus-buff? {
          action: (string-ascii 12),
          amount: uint,
          min-out: uint,
          max-steps: uint,
        }
          payload
        )
        ERR-BAD-PAYLOAD
      ))
      (amt (get amount cmd))
      (min (get min-out cmd))
      (action (get action cmd))
      (gas (var-get fee))
    )
    (asserts! (> amt u0) ERR-ZERO-AMOUNT)
    (asserts! (> min u0) ERR-ZERO-MIN-OUT)
    (if (is-eq action "to-sbtc")
      ;; sBTC is the output: swap first, then take the fee from the output
      (begin
        (asserts! (> min gas) ERR-AMOUNT-BELOW-FEE)
        (try! (contract-call? DLMM-ROUTER swap-y-for-x-simple-range-multi POOL SBTC
          USDCX amt min (get max-steps cmd)
        ))
        (try! (pay-sponsor gas))
        (ok true)
      )
      (if (is-eq action "to-usdcx")
        ;; sBTC is the input: take the fee off the input, swap the rest
        (begin
          (asserts! (> amt gas) ERR-AMOUNT-BELOW-FEE)
          (try! (pay-sponsor gas))
          (try! (contract-call? DLMM-ROUTER swap-x-for-y-simple-range-multi POOL SBTC
            USDCX (- amt gas) min (get max-steps cmd)
          ))
          (ok true)
        )
        ERR-BAD-ACTION
      )
    )
  )
)

(define-public (propose-fee (new-fee uint))
  (begin
    (asserts! (is-eq tx-sender (var-get sponsor)) ERR-UNAUTHORIZED)
    (asserts! (<= new-fee MAX-GAS) ERR-FEE-TOO-HIGH)
    (var-set pending-fee (some new-fee))
    (var-set pending-fee-block burn-block-height)
    (print {
      a: "propose-fee",
      new-fee: new-fee,
      block: burn-block-height,
    })
    (ok true)
  )
)

(define-public (confirm-fee)
  (let ((new-fee (unwrap! (var-get pending-fee) ERR-NO-PENDING)))
    (asserts! (is-eq tx-sender (var-get sponsor)) ERR-UNAUTHORIZED)
    (asserts!
      (>= burn-block-height (+ (var-get pending-fee-block) COOLDOWN-BLOCKS))
      ERR-COOLDOWN-NOT-PASSED
    )
    (var-set fee new-fee)
    (var-set pending-fee none)
    (var-set pending-fee-block u0)
    (print {
      a: "confirm-fee",
      new-fee: new-fee,
    })
    (ok true)
  )
)

(define-public (cancel-fee-change)
  (begin
    (asserts! (is-eq tx-sender (var-get sponsor)) ERR-UNAUTHORIZED)
    (var-set pending-fee none)
    (var-set pending-fee-block u0)
    (print { a: "cancel-fee-change" })
    (ok true)
  )
)

(define-public (propose-sponsor (new-sponsor principal))
  (begin
    (asserts! (is-eq tx-sender (var-get sponsor)) ERR-UNAUTHORIZED)
    (var-set pending-sponsor (some new-sponsor))
    (var-set pending-sponsor-block burn-block-height)
    (print {
      a: "propose-sponsor",
      new-sponsor: new-sponsor,
      block: burn-block-height,
    })
    (ok true)
  )
)

(define-public (confirm-sponsor)
  (let ((new-sponsor (unwrap! (var-get pending-sponsor) ERR-NO-PENDING)))
    (asserts! (is-eq tx-sender (var-get sponsor)) ERR-UNAUTHORIZED)
    (asserts!
      (>= burn-block-height (+ (var-get pending-sponsor-block) COOLDOWN-BLOCKS))
      ERR-COOLDOWN-NOT-PASSED
    )
    (var-set sponsor new-sponsor)
    (var-set pending-sponsor none)
    (var-set pending-sponsor-block u0)
    (print {
      a: "confirm-sponsor",
      new-sponsor: new-sponsor,
    })
    (ok true)
  )
)

(define-public (cancel-sponsor-change)
  (begin
    (asserts! (is-eq tx-sender (var-get sponsor)) ERR-UNAUTHORIZED)
    (var-set pending-sponsor none)
    (var-set pending-sponsor-block u0)
    (print { a: "cancel-sponsor-change" })
    (ok true)
  )
)
