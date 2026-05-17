;; Stub auth-v7 (game-wager auth helpers). Returns a fixed buff32 from
;; build-wager-deposit-hash so the wallet's signed path can construct a
;; deterministic message-hash. RV won't be able to produce a valid sig
;; against this hash, so the signed path bounces on verify -- which is
;; what we want from an auth standpoint anyway.

(define-read-only (build-wager-deposit-hash (details {
  auth-id: uint, amount: uint, pubkey: (buff 33), token: principal,
}))
  0x0000000000000000000000000000000000000000000000000000000000000001)
