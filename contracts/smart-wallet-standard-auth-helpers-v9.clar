;; smart-wallet-standard-auth-helpers-v9
;;
;; Adds the two challenge builders juice-safe-v5 and fakfun-wallet-v15 need to
;; move the SECOND step of a config change and of a max-gas raise off the admin
;; key and onto the passkey. Neither helpers-v7 nor helpers-v8 has any config or
;; max-gas builder, so this contract must deploy BEFORE either wallet -- both
;; reference it by fully-qualified principal and fail analysis without it.
;;
;; WHY THIS EXISTS. In v4 the whole config surface is admin-key-only:
;; signal-config-change and set-wallet-config are both (is-authorized none), and
;; cooldown-period has no floor. So a stolen admin key signals a change, waits
;; one current cooldown, sets cooldown-period to u0, and every delay in the
;; wallet collapses at once. The cooldown exists to protect against a stolen
;; admin key and the thing that can switch it off is the admin key. Requiring the
;; passkey on the second step breaks that circle: the key alone can start a
;; change and never finish one.
;;
;; THE SIGNATURE COVERS THE VALUES, NOT JUST CONSENT. Both builders bind the
;; actual numbers being set, not only an auth-id. A bare consent signature would
;; let a compromised admin show the user one set of thresholds, collect a
;; signature for "a config change", then call set-wallet-config with different
;; numbers. Binding stx-threshold, sbtc-threshold and cooldown-period means the
;; passkey approves exactly those three values and the wallet rebuilds the hash
;; from its own arguments, so any substitution fails the signature check.
;;
;; The domain tuple is byte-identical to helpers-v7 and helpers-v8, including
;; wallet: contract-caller -- the wallet is what calls the helper, so
;; contract-caller is the wallet. Do not "fix" that to tx-sender: these calls run
;; inside the wallet's own as-contract? frames, where tx-sender is the wallet too
;; in some paths and the relayer in others, and the domain must be stable.

(define-constant SIP018_MSG_PREFIX 0x534950303138)

(define-read-only (get-domain-hash)
  (sha256 (unwrap-panic (to-consensus-buff? {
    name: "smart-wallet-standard",
    version: "1.0.0",
    chain-id: chain-id,
    wallet: contract-caller,
  })))
)

;; Second step of a config change. Binds all three values so the passkey approves
;; specific thresholds and a specific cooldown, never "some change".
(define-read-only (build-set-wallet-config-hash (details {
  auth-id: uint,
  stx-threshold: uint,
  sbtc-threshold: uint,
  cooldown-period: uint,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "set-wallet-config",
        auth-id: (get auth-id details),
        stx-threshold: (get stx-threshold details),
        sbtc-threshold: (get sbtc-threshold details),
        cooldown-period: (get cooldown-period details),
      })))
    )))
)

;; Second step of a max-gas raise. Binds the amount, so a signature collected for
;; a modest raise cannot be replayed against a larger pending value. The wallet
;; passes the amount it is about to commit, i.e. the one sitting in
;; pending-max-gas, so a swapped proposal fails here rather than confirming
;; silently.
(define-read-only (build-confirm-max-gas-amount-hash (details {
  auth-id: uint,
  amount: uint,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "confirm-max-gas-amount",
        auth-id: (get auth-id details),
        amount: (get amount details),
      })))
    )))
)
