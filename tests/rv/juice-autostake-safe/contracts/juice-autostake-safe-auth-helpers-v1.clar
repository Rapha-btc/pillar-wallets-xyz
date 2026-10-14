;; juice-autostake-safe-auth-helpers-v1
;;
;; SIP-018 hash builder for juice-autostake-safe's set-keeper. Same scheme and
;; domain tuple as juice-safe-auth-helpers-v1 (wallet = contract-caller), so a
;; signature binds to one wallet. The frontend calls the same read-only to
;; build the challenge.
;;
;; Deploy from account 0 (SPV9K21T...) BEFORE juice-autostake-safe.

(define-constant SIP018_MSG_PREFIX 0x534950303138)

(define-read-only (get-domain-hash)
  (sha256 (unwrap-panic (to-consensus-buff? {
    name: "smart-wallet-standard",
    version: "1.0.0",
    chain-id: chain-id,
    wallet: contract-caller,
  })))
)

;; set-keeper: the new keeper is the only caller-supplied argument.
(define-read-only (build-set-keeper-hash (details {
  auth-id: uint,
  keeper: principal,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "set-keeper",
        auth-id: (get auth-id details),
        keeper: (get keeper details),
      })))
    )))
)
