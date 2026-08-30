(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.extension-trait.extension-trait)

(define-constant DLMM-ROUTER 'SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-swap-router-v-1-1)
(define-constant POOL 'SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-sbtc-usdcx-v-1-bps-10)
(define-constant SBTC 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)
(define-constant USDCX 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx)

(define-constant ERR-BAD-PAYLOAD (err u300))
(define-constant ERR-BAD-ACTION (err u301))
(define-constant ERR-ZERO-AMOUNT (err u302))
(define-constant ERR-ZERO-MIN-OUT (err u303))

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
    )
    (asserts! (> amt u0) ERR-ZERO-AMOUNT)
    (asserts! (> min u0) ERR-ZERO-MIN-OUT)
    (if (is-eq action "to-sbtc")
      (begin
        (try! (contract-call? DLMM-ROUTER swap-y-for-x-simple-range-multi POOL SBTC
          USDCX amt min (get max-steps cmd)
        ))
        (ok true)
      )
      (if (is-eq action "to-usdcx")
        (begin
          (try! (contract-call? DLMM-ROUTER swap-x-for-y-simple-range-multi POOL SBTC
            USDCX amt min (get max-steps cmd)
          ))
          (ok true)
        )
        ERR-BAD-ACTION
      )
    )
  )
)
