;; dataing-market-receipts
;; The thin, Dataing-owned audit-trail + direct-payment contract - the single core
;; contract an indexer watches to build the Stacks evidence table.
;;
;; One call does two things atomically: it pays the supplier DIRECTLY (non-custodial
;; - Dataing is never in the money path) and records the receipt of WHAT was bought.
;; That's the whole point: replace a bare STX transfer (money moves, chain has no
;; record of the purchase) with a transfer + verifiable receipt.
;;
;; Thin by design: no custody, no escrow, no admin, no eligibility logic. Dataing
;; keeps consent, SKU creation, pricing and privacy-safe packaging off-chain. This
;; contract only makes the money/receipt layer auditable.
;;
;; WHO CALLS IT:
;;   - A buyer's Pillar smart wallet, via the `dataing-pay-extension` wrapper
;;     (passkey for humans, the Pillar relay for agents) - there tx-sender is the
;;     wallet, so the payment comes from the buyer's SW.
;;   - Or any EOA / agent / backend directly (e.g. an x402 facilitator path).
;; Either way the receipt records buyer = tx-sender, and a receipt can only exist
;; if `amount` actually moved to `recipient` in the same transaction - so a receipt
;; cannot be forged without making the payment it claims. `recipient` is the
;; supplier's own wallet, so earnings flow straight to the user.
;;
;; DEDUPE: keyed on the marketplace `purchase-id` - one payment + one receipt per
;; purchase.

(define-constant SBTC-CONTRACT 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)

(define-constant err-already-recorded (err u8102))
(define-constant err-zero-amount (err u8103))
(define-constant err-bad-currency (err u8104))

(define-map receipts
  (string-ascii 64) ;; purchase-id
  {
    buyer: principal,
    dataset-id: (string-ascii 64),
    amount: uint,
    currency: (string-ascii 8),
    recipient: principal,
    agentic: bool,
    stacks-block: uint,
    burn-block: uint,
  }
)
(define-data-var total-receipts uint u0)

(define-read-only (get-receipt (purchase-id (string-ascii 64)))
  (map-get? receipts purchase-id)
)

(define-read-only (get-total-receipts)
  (var-get total-receipts)
)

;; Pay the supplier and record the receipt, atomically.
;;   purchase-id : marketplace purchase id (dedupe key)
;;   dataset-id  : the dataset / SKU bought
;;   amount      : microSTX, or sats for sBTC
;;   currency    : "STX" or "sBTC"
;;   recipient   : the supplier's wallet (paid directly)
;;   agentic     : true when the buyer is a CLI/agent rather than a human
;;   memo        : optional sBTC transfer memo
(define-public (record-purchase
    (purchase-id (string-ascii 64))
    (dataset-id (string-ascii 64))
    (amount uint)
    (currency (string-ascii 8))
    (recipient principal)
    (agentic bool)
    (memo (optional (buff 34)))
  )
  (let ((buyer tx-sender))
    (asserts! (> amount u0) err-zero-amount)
    (asserts! (is-none (map-get? receipts purchase-id)) err-already-recorded)

    (if (is-eq currency "STX")
      (try! (stx-transfer? amount buyer recipient))
      (if (is-eq currency "sBTC")
        (try! (contract-call? SBTC-CONTRACT transfer amount buyer recipient memo))
        (asserts! false err-bad-currency)
      )
    )

    (map-set receipts purchase-id {
      buyer: buyer,
      dataset-id: dataset-id,
      amount: amount,
      currency: currency,
      recipient: recipient,
      agentic: agentic,
      stacks-block: stacks-block-height,
      burn-block: burn-block-height,
    })
    (var-set total-receipts (+ (var-get total-receipts) u1))

    (print {
      event: "purchase-recorded",
      purchase-id: purchase-id,
      dataset-id: dataset-id,
      buyer: buyer,
      recipient: recipient,
      amount: amount,
      currency: currency,
      agentic: agentic,
      stacks-block: stacks-block-height,
      burn-block: burn-block-height,
    })
    (ok true)
  )
)
