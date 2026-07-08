;; RV mock: accept-all webauthn verifier. Lets Rendezvous drive the wallet's
;; SIGNED paths (which real RV byte-fuzzing could never reach, since it cannot
;; forge a P-256 sig). Auth is deliberately stubbed OPEN here so RV fuzzes the
;; POST-auth pending-op STATE MACHINE. The real auth boundary is covered by the
;; deterministic stxer sim with real signatures, not by RV.
(define-read-only (get-rp-id-hash (authenticator-data (buff 256)))
  ;; return jingswap.com's rp-id hash so the wallet's rp-id allow-list passes
  (ok 0x9e56c212239ee7582cb385fb4432e9d2cae3c1aef98e4c1e508d40112147d4e5))

(define-read-only (is-user-verified (authenticator-data (buff 256)))
  true)

(define-read-only (verify-webauthn-signature
    (pubkey (buff 33)) (message-hash (buff 32)) (authenticator-data (buff 256))
    (client-data-prefix (buff 128)) (client-data-suffix (buff 512)) (signature (buff 64)))
  true)
