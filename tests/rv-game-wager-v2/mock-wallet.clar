;; mock-wallet -- minimal pillar-wallet-trait impl for RV.
;; is-admin-pubkey returns (ok true) for any pubkey, so register-wallet's
;; trait call passes -- the webauthn sig check is what actually proves the
;; pubkey's authority.
(impl-trait .pillar-wallet-trait.pillar-wallet-trait)

(define-read-only (is-admin-pubkey (pubkey (buff 33)))
  (ok true))
