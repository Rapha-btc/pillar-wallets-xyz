;; title: smart-wallet-standard-auth-helpers-v8
;; version: 8.0.0
;; summary: Additive SIP-018 hash builder for the sBTC withdrawal (peg-out) op.
;; description:
;;   v7 is already deployed and immutable, so we do NOT re-deploy its hash
;;   builders. This v8 contract is ADDITIVE: it carries only the new
;;   build-sbtc-withdrawal-hash, plus the two internals it needs
;;   (SIP018_MSG_PREFIX + get-domain-hash) copied VERBATIM from v7 so the
;;   SIP-018 domain is byte-identical to what the frontend signs and to v7.
;;   The new wallet template references v7 for every existing op and v8 only
;;   for the withdrawal op. Pure read-only.
;;
;;   Each hash uses the SIP-018 structured data envelope:
;;     sha256( SIP018_MSG_PREFIX || domain-hash || sha256(message-tuple) )
;;
;;   The domain binds the signature to the calling wallet via contract-caller,
;;   preventing cross-wallet replay.

;; ---- copied verbatim from v7 (do not diverge) ----
(define-constant SIP018_MSG_PREFIX 0x534950303138)

(define-read-only (get-domain-hash)
  (sha256 (unwrap-panic (to-consensus-buff? {
    name: "smart-wallet-standard",
    version: "1.0.0",
    chain-id: chain-id,
    wallet: contract-caller,
  })))
)

;; -----------------------------------------------------------------------------
;; sBTC peg-out / withdrawal -- new in v8
;; -----------------------------------------------------------------------------

;; Binds a signed sBTC->BTC withdrawal intent. `recipient` is the BTC payout
;; address as the {version, hashbytes} tuple the sbtc-withdrawal contract
;; expects; to-consensus-buff? serializes the nested tuple deterministically so
;; the signature commits to the exact destination. `max-fee` is the sat ceiling
;; the signers may pay BTC miners; it is signed so it can't be inflated by a
;; relayer. The wallet locks (amount + max-fee) of sBTC, but only amount and
;; max-fee are signed separately (the sum is derivable, no need to commit it).
(define-read-only (build-sbtc-withdrawal-hash (details {
  auth-id: uint,
  amount: uint,
  recipient: { version: (buff 1), hashbytes: (buff 32) },
  max-fee: uint,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "sbtc-withdrawal",
        auth-id: (get auth-id details),
        amount: (get amount details),
        recipient: (get recipient details),
        max-fee: (get max-fee details),
      })))
    )))
)
