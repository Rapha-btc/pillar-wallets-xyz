;; RV trait copy: wormhole core (shape the wallet's use-trait needs).
(define-trait core-trait
  ((verify-vaa ((buff 8192)) (response
    { version: uint, guardian-set-id: uint, signatures-len: uint,
      signatures: (list 19 { guardian-id: uint, signature: (buff 65) }),
      vaa: { version: uint, guardian-set-id: uint, timestamp: uint, nonce: uint,
             emitter-chain: uint, emitter-address: (buff 32), sequence: uint,
             consistency-level: uint, payload: (buff 8192) },
      vaa-bytes: (buff 8192) } uint))))
