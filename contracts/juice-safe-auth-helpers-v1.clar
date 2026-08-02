;; juice-safe-auth-helpers-v1
;;
;; Standalone SIP-018 hash builders for juice-safe-v0's pox-5 staking actions.
;; Split out of the wallet for the same reason as
;; smart-wallet-standard-auth-helpers-v7 and mm-safe-auth-helpers-v1: the
;; frontend calls the SAME read-only to build the challenge it asks the passkey
;; to sign, so wallet and client can never drift.
;;
;; Byte-compatible with the helpers-v7 scheme:
;;   sha256( SIP018_MSG_PREFIX || domain-hash || sha256(message-tuple) )
;; The domain tuple is IDENTICAL to helpers-v7's (name/version/chain-id and
;; wallet = contract-caller), so when juice-safe-v0 calls this the signature
;; binds to that specific wallet -- no cross-wallet replay. auth-id gives
;; uniqueness; the wallet's consume-signature replay map blocks reuse.
;;
;; WHY THIS EXISTS AT ALL. helpers-v7 already ships build-stack-stx-juice-hash,
;; but it covers { auth-id, amount-ustx } only -- it was written for pox-4
;; `delegate-stx`, which took an amount and nothing else. pox-5 `stake-update`
;; takes cycles-to-extend as well, and pox-5's lock window is ROLLING
;; (num-cycles is recomputed as unlock-cycle - current-cycle - 1), so
;; cycles-to-extend is a parameter a user genuinely needs rather than something
;; that can be pinned to u0. Reusing the v7 builder while passing a
;; caller-supplied cycles-to-extend would leave the lock DURATION unbound by the
;; signature: a relayer holding a gasless signature could extend the safe's lock
;; to pox-5's 96-cycle maximum. Not a theft vector, but a denial-of-access one,
;; and exactly the kind of unbound argument the safe's design refuses elsewhere.
;;
;; Deploy from account 0 (SPV9K21T...) BEFORE any juice-safe-v0 references it.

(define-constant SIP018_MSG_PREFIX 0x534950303138)

(define-read-only (get-domain-hash)
  (sha256 (unwrap-panic (to-consensus-buff? {
    name: "smart-wallet-standard",
    version: "1.0.0",
    chain-id: chain-id,
    wallet: contract-caller,
  })))
)

;; stake-stx-juice: pox-5 `stake` (fresh) or `stake-update` (top up / extend).
;; Binds BOTH caller-supplied arguments. The rest of what reaches pox-5 is
;; constant in the wallet -- signer, and num-cycles / start-burn-ht on the
;; fresh-stake path -- so this tuple pins the whole call.
;;
;; The topic differs from helpers-v7's "stack-stx-juice" deliberately. The two
;; tuples already hash differently (different fields), but a distinct topic
;; makes a pox-4 challenge and a pox-5 challenge impossible to confuse when
;; reading a signing prompt or a log.
(define-read-only (build-stake-stx-juice-pox5-hash (details {
  auth-id: uint,
  amount-ustx: uint,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "stake-stx-juice-pox5",
        auth-id: (get auth-id details),
        amount-ustx: (get amount-ustx details),
      })))
    )))
)

;; update-stake-stx-juice: pox-5 `stake-update` on an existing Juice position.
;; Both signers are the JUICE-SIGNER constant in the wallet, so the two amounts
;; are the whole caller-supplied surface and this tuple pins the call.
(define-read-only (build-update-stake-stx-juice-hash (details {
  auth-id: uint,
  amount-increase: uint,
  cycles-to-extend: uint,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "update-stake-stx-juice",
        auth-id: (get auth-id details),
        amount-increase: (get amount-increase details),
        cycles-to-extend: (get cycles-to-extend details),
      })))
    )))
)

;; unstake: pox-5 `unstake`, which takes only the old signer-manager -- and the
;; wallet supplies that as the JUICE-SIGNER constant. So there is no
;; caller-supplied argument at all and auth-id alone pins the whole call.
;;
;; It gets a builder here rather than reusing helpers-v7's
;; build-revoke-stacking-hash (which is also auth-id-only, and would have worked)
;; so that every pox-5 action on this wallet is challenged from ONE contract with
;; one naming scheme. Reusing the v7 builder would have meant a signing prompt
;; reading "revoke-stacking" for what pox-5 and this wallet both call unstake.
(define-read-only (build-unstake-stx-juice-hash (details { auth-id: uint }))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "unstake-stx-juice",
        auth-id: (get auth-id details),
      })))
    )))
)
