;; juice-safe-auth-helpers-v2
;;
;; v1's two pox-5 stake builders with signer-calldata added to the signed tuple.
;; v1 is deployed and immutable; its tuples omit signer-calldata, so a relayer
;; holding a passkey signature could resubmit a stake with any calldata and burn
;; the owner's auth-id. Binding it here pins the whole caller-supplied surface.
;;
;; Same SIP-018 scheme and domain as v1 (wallet = contract-caller). unstake has
;; no calldata and stays on v1's build-unstake-stx-juice-hash.
;;
;; Deploy from account 0 (SPV9K21T...) BEFORE juice-safe-v8 or
;; juice-autostake-safe.

(define-constant SIP018_MSG_PREFIX 0x534950303138)

(define-read-only (get-domain-hash)
  (sha256 (unwrap-panic (to-consensus-buff? {
    name: "smart-wallet-standard",
    version: "1.0.0",
    chain-id: chain-id,
    wallet: contract-caller,
  })))
)

;; stake-stx-juice: pox-5 `stake`. amount-ustx and signer-calldata are the
;; caller-supplied arguments; signer, num-cycles and start-burn-ht are constant
;; in the wallet.
(define-read-only (build-stake-stx-juice-pox5-hash (details {
  auth-id: uint,
  amount-ustx: uint,
  signer-calldata: (optional (buff 500)),
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "stake-stx-juice-pox5",
        auth-id: (get auth-id details),
        amount-ustx: (get amount-ustx details),
        signer-calldata: (get signer-calldata details),
      })))
    )))
)

;; update-stake-stx-juice: pox-5 `stake-update`. Both signers are constant in
;; the wallet, so the two amounts plus signer-calldata pin the call.
(define-read-only (build-update-stake-stx-juice-hash (details {
  auth-id: uint,
  amount-increase: uint,
  cycles-to-extend: uint,
  signer-calldata: (optional (buff 500)),
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "update-stake-stx-juice",
        auth-id: (get auth-id details),
        amount-increase: (get amount-increase details),
        cycles-to-extend: (get cycles-to-extend details),
        signer-calldata: (get signer-calldata details),
      })))
    )))
)
