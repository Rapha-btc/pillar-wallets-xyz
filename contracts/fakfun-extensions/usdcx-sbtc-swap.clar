;; title: usdcx-sbtc-swap-ext
;; summary: Lets a fak.fun smart wallet swap USDCx <-> sBTC on the Bitflow
;;   DLMM without redeploying the wallet.
;; description:
;;   The ETH onramp mints USDCx straight into a passkey wallet (CCTP burn on
;;   Ethereum -> attested mint on Stacks). The wallet template has no route
;;   from USDCx to anything, and a template change means v19 plus a
;;   re-register for every deployed wallet. The wallet's `extension-call` is
;;   the way through: a whitelisted contract implementing extension-trait,
;;   invoked under
;;   `(as-contract? ((with-all-assets-unsafe)) (contract-call? extension call payload))`.
;;   as-contract sets tx-sender to the WALLET, and the DLMM router pulls the
;;   input token from tx-sender and pays the output back to it, so both legs
;;   stay inside the wallet. Nothing custodies anything.
;;
;;   VENUE IS HARDCODED. `call` receives a (buff 2048) and nothing else, so
;;   no trait reference can reach it; every contract this touches is a named
;;   principal. The venue is the Bitflow DLMM sBTC/USDCx 10bps pool - the
;;   deepest direct pair on Stacks ($187k liq, ~$1.7M weekly volume,
;;   2026-08-29). Verified from the pool's own get-pool: x-token =
;;   sbtc-token, y-token = usdcx, so USDCx -> sBTC is y-for-x. A better
;;   venue later (the Jing RFQ desk, say) is a new extension and one more
;;   whitelist, not a wallet change.
;;
;;   NO as-contract IN HERE. That would rebind tx-sender to this contract
;;   and swap ITS balance instead of the caller's. tx-sender must pass
;;   through untouched, which is the whole mechanism.
;;
;;   ANYONE MAY CALL THIS. There is no caller gate and none is wanted: every
;;   function acts on tx-sender's own balance, so an EOA calling directly
;;   just swaps its own USDCx. It holds no funds and has no admin. The trust
;;   a wallet owner extends by whitelisting it is bounded by the fact that
;;   the only contract it ever calls is the Bitflow router, with a caller
;;   supplied min-out enforced by that router.

(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.extension-trait.extension-trait)

(define-constant DLMM-ROUTER
  'SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-swap-router-v-1-1)
(define-constant POOL
  'SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-pool-sbtc-usdcx-v-1-bps-10)
(define-constant SBTC 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)
(define-constant USDCX 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx)

(define-constant ERR-BAD-PAYLOAD (err u300))
(define-constant ERR-BAD-ACTION (err u301))
(define-constant ERR-ZERO-AMOUNT (err u302))
(define-constant ERR-ZERO-MIN-OUT (err u303))

;; Encode a payload off-chain-equivalently, so the front end can be checked
;; against the contract rather than against a comment. min-out is REQUIRED
;; non-zero: a zero min-out would let a sandwicher take the whole clip.
;; max-steps bounds how many DLMM bins the swap may cross (the router aborts
;; past it); the live 10bps pool clears retail-size clips in a handful.
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
  }))

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
  }))

(define-public (call (payload (buff 2048)))
  (let ((cmd (unwrap!
        (from-consensus-buff? {
          action: (string-ascii 12),
          amount: uint,
          min-out: uint,
          max-steps: uint,
        } payload)
        ERR-BAD-PAYLOAD))
      (action (get action cmd)))
    (asserts! (> (get amount cmd) u0) ERR-ZERO-AMOUNT)
    (asserts! (> (get min-out cmd) u0) ERR-ZERO-MIN-OUT)
    (if (is-eq action "to-sbtc")
      ;; USDCx is the pool's y side, sBTC its x side: y-for-x.
      (begin
        (try! (contract-call? DLMM-ROUTER swap-y-for-x-simple-range-multi
          POOL SBTC USDCX
          (get amount cmd) (get min-out cmd) (get max-steps cmd)
        ))
        (ok true))
      (if (is-eq action "to-usdcx")
        (begin
          (try! (contract-call? DLMM-ROUTER swap-x-for-y-simple-range-multi
            POOL SBTC USDCX
            (get amount cmd) (get min-out cmd) (get max-steps cmd)
          ))
          (ok true))
        ERR-BAD-ACTION))))
