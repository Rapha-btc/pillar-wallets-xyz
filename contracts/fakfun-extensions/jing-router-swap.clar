;; title: jing-router-swap
;; summary: Lets a fak.fun smart wallet (v19+) swap STX, sBTC and USDCx through
;;   the live Jing routers (Jing market + Bitflow DLMM/XYK + Velar, and Zest
;;   CLMM on STX/USDCx), the same best-route swap the Juice Wallet extension
;;   does from a hot wallet.
;; description:
;;   The wallet invokes this through `extension-call`, under
;;   `(as-contract? ((with-all-assets-unsafe)) (contract-call? extension call payload))`.
;;   as-contract sets tx-sender to the WALLET, and every Jing router keys off
;;   tx-sender ("tx-sender stays the user through every leg"), so the wallet's
;;   own funds are swapped and the output lands back in the wallet. Nothing is
;;   custodied here.
;;
;;   NO as-contract IN HERE. That would rebind tx-sender to this contract and
;;   swap ITS balance. tx-sender must pass through untouched.
;;
;;   ANYONE MAY CALL THIS. There is no caller gate: every action swaps
;;   tx-sender's own funds, so an EOA calling directly just swaps its own.
;;
;;   PAYLOAD. `call` gets one (buff 2048): a consensus-encoded tuple, built
;;   with the encode-* read-onlies below (or the same tuple off-chain). The
;;   Pyth Lazer update is capped at 1024 bytes so the whole payload fits;
;;   the routers accept up to 8192, but a 2-feed Lazer update is far smaller.
;;   Every router argument passes through unchanged; the routers already
;;   enforce the split (amount = sum of legs), min-out and the Jing limit.
;;
;;   PAIRS. sbtc-stx and sbtc-usdcx routers (v5-6) have no Zest leg: the zest
;;   amount must be 0 and zest-route is ignored. stx-usdcx (v6) uses all four.
;;
;;   No sponsor fee: the wallet's admin key pays its own gas. A gas-sponsored
;;   variant can follow usdcx-sbtc-swap-v2 later.

(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.extension-trait.extension-trait)

(define-constant ROUTER-SBTC-STX 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.swap-router-sbtc-stx-jing-v5-6)
(define-constant ROUTER-SBTC-USDCX 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.swap-router-sbtc-usdcx-jing-v5-6)
(define-constant ROUTER-STX-USDCX 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.swap-router-stx-usdcx-jing-v6)

(define-constant ERR-BAD-PAYLOAD (err u310))
(define-constant ERR-BAD-ACTION (err u311))
(define-constant ERR-ZEST-NOT-ON-PAIR (err u312))

;; One shape for all six directions.
;; action: "sbtc-stx" "stx-sbtc" "sbtc-usdcx" "usdcx-sbtc" "stx-usdcx" "usdcx-stx"
;;         (first asset is what the wallet sells)
(define-private (decode (payload (buff 2048)))
  (from-consensus-buff? {
    action: (string-ascii 10),
    amount: uint,
    jing-amount: uint,
    limit-price: uint,
    update: (optional (buff 1024)),
    fallback: (optional uint),
    amounts: {
      zest: uint,
      dlmm: uint,
      xyk: uint,
      velar: uint,
    },
    mins: {
      zest: uint,
      dlmm: uint,
      xyk: uint,
      velar: uint,
    },
    min-out: uint,
    zest-route: {
      ticks: (list 32 int),
      price: uint,
    },
  }
    payload
  )
)

(define-read-only (encode
    (action (string-ascii 10))
    (amount uint)
    (jing-amount uint)
    (limit-price uint)
    (update (optional (buff 1024)))
    (fallback (optional uint))
    (amounts {
      zest: uint,
      dlmm: uint,
      xyk: uint,
      velar: uint,
    })
    (mins {
      zest: uint,
      dlmm: uint,
      xyk: uint,
      velar: uint,
    })
    (min-out uint)
    (zest-route {
      ticks: (list 32 int),
      price: uint,
    })
  )
  (to-consensus-buff? {
    action: action,
    amount: amount,
    jing-amount: jing-amount,
    limit-price: limit-price,
    update: update,
    fallback: fallback,
    amounts: amounts,
    mins: mins,
    min-out: min-out,
    zest-route: zest-route,
  })
)

(define-private (no-zest (a {
  zest: uint,
  dlmm: uint,
  xyk: uint,
  velar: uint,
}))
  {
    dlmm: (get dlmm a),
    xyk: (get xyk a),
    velar: (get velar a),
  }
)

(define-public (call (payload (buff 2048)))
  (let (
      (c (unwrap! (decode payload) ERR-BAD-PAYLOAD))
      (action (get action c))
      (zest-free (and (is-eq (get zest (get amounts c)) u0)
        (is-eq (get zest (get mins c)) u0)
      ))
    )
    (print {
      a: "jing-router-swap",
      wallet: tx-sender,
      action: action,
      amount: (get amount c),
      min-out: (get min-out c),
    })
    (if (is-eq action "stx-usdcx")
      (begin
        (try! (contract-call? ROUTER-STX-USDCX swap-stx-for-usdcx (get amount c)
          (get jing-amount c) (get limit-price c) (get update c)
          (get fallback c) (get amounts c) (get mins c) (get min-out c)
          (get zest-route c)
        ))
        (ok true)
      )
      (if (is-eq action "usdcx-stx")
        (begin
          (try! (contract-call? ROUTER-STX-USDCX swap-usdcx-for-stx (get amount c)
            (get jing-amount c) (get limit-price c) (get update c)
            (get fallback c) (get amounts c) (get mins c) (get min-out c)
            (get zest-route c)
          ))
          (ok true)
        )
        (begin
          ;; v5-6 routers have no Zest leg
          (asserts! zest-free ERR-ZEST-NOT-ON-PAIR)
          (if (is-eq action "sbtc-stx")
            (begin
              (try! (contract-call? ROUTER-SBTC-STX swap-sbtc-for-stx (get amount c)
                (get jing-amount c) (get limit-price c) (get update c)
                (get fallback c) (no-zest (get amounts c))
                (no-zest (get mins c)) (get min-out c)
              ))
              (ok true)
            )
            (if (is-eq action "stx-sbtc")
              (begin
                (try! (contract-call? ROUTER-SBTC-STX swap-stx-for-sbtc (get amount c)
                  (get jing-amount c) (get limit-price c) (get update c)
                  (get fallback c) (no-zest (get amounts c))
                  (no-zest (get mins c)) (get min-out c)
                ))
                (ok true)
              )
              (if (is-eq action "sbtc-usdcx")
                (begin
                  (try! (contract-call? ROUTER-SBTC-USDCX swap-sbtc-for-usdcx
                    (get amount c) (get jing-amount c) (get limit-price c)
                    (get update c) (get fallback c) (no-zest (get amounts c))
                    (no-zest (get mins c)) (get min-out c)
                  ))
                  (ok true)
                )
                (if (is-eq action "usdcx-sbtc")
                  (begin
                    (try! (contract-call? ROUTER-SBTC-USDCX swap-usdcx-for-sbtc
                      (get amount c) (get jing-amount c) (get limit-price c)
                      (get update c) (get fallback c) (no-zest (get amounts c))
                      (no-zest (get mins c)) (get min-out c)
                    ))
                    (ok true)
                  )
                  ERR-BAD-ACTION
                )
              )
            )
          )
        )
      )
    )
  )
)
