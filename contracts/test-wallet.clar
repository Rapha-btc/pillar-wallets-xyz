;; test-wallet -- minimal pillar-wallet-trait impl for stxer sims.
;; is-admin-pubkey returns (ok true) for any pubkey -- the wager contract's
;; signature check (game-wager-v2.consume-signature) is what actually proves
;; the pubkey's authority. This wallet only needs to satisfy the trait.

(impl-trait 'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK.pillar-wallet-trait.pillar-wallet-trait)

(define-read-only (is-admin-pubkey (pubkey (buff 33)))
  (ok true)
)
