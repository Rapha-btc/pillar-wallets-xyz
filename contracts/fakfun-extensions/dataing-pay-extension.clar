;; dataing-pay-extension
;; The fakfun-wallet extension that wraps Dataing's thin audit-trail contract
;; (`dataing-market-receipts`). ANY fakfun-wallet can whitelist this once and then
;; drive a marketplace purchase - pay the supplier + record the receipt - from its
;; own smart wallet, gated entirely by the wallet's passkey auth.
;;
;; HOW THE WALLET DRIVES THIS (no changes to the wallet are needed):
;;   1. owner whitelists this contract once: `whitelist-extension` +
;;      `execute-pending-whitelist` (passkey-signed).
;;   2. buyer (human via passkey, or an AGENT via the Pillar relay) calls
;;      `extension-call <this> <payload> <sig-auth> <gas>`. The wallet verifies the
;;      passkey signature over the payload, pays gas, then runs:
;;         (as-contract? ((with-all-assets-unsafe))
;;           (contract-call? <this> call payload))
;;
;; Because of that `as-contract?`, tx-sender is the buyer's smart wallet the whole
;; way through to `record-purchase`, so the STX/sBTC payment is pulled from the
;; wallet and the receipt records the wallet as buyer. The wallet already
;; authenticated (passkey) and paid gas; we only decode the payload and forward.
;;
;; This is the step that replaces x402's "sign a bare transfer, facilitator
;; broadcasts": the Pillar relay broadcasts the passkey-signed extension-call
;; (gasless), and the returned txid is the x402 payment proof handed back to
;; Dataing's API.
;;
;; SECURITY: `call` is intentionally open. Invoked directly (not via a wallet's
;; as-contract), tx-sender is the direct caller, so THEY pay from their own balance
;; - no other wallet's funds are reachable. The buyer's signature covers the entire
;; payload (amount, recipient, dataset, purchase id), authorizing exactly this pay.
;;
;; PAYLOAD: `to-consensus-buff?` of the tuple decoded below.

(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.extension-trait.extension-trait)

(define-constant err-bad-payload (err u8201))

(define-public (call (payload (buff 2048)))
  (let ((args (unwrap!
      (from-consensus-buff?
        {
          purchase-id: (string-ascii 64),
          dataset-id: (string-ascii 64),
          amount: uint,
          currency: (string-ascii 8),  ;; "STX" or "sBTC"
          recipient: principal,        ;; supplier's wallet (paid directly)
          agentic: bool,               ;; true when the buyer is a CLI/agent
          memo: (optional (buff 34)),
        }
        payload
      )
      err-bad-payload
    )))
    (contract-call? .dataing-market-receipts record-purchase
      (get purchase-id args)
      (get dataset-id args)
      (get amount args)
      (get currency args)
      (get recipient args)
      (get agentic args)
      (get memo args)
    )
  )
)
