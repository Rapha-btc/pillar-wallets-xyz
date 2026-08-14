;; SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.clarity-5-webauthn-v3

(define-constant ERR_BAD_AUTH_DATA (err u200))
(define-constant ERR_BAD_RP_ID (err u201))
(define-constant ERR_USER_NOT_PRESENT (err u202))

;; H-01 fix: fixed-template challenge anchoring (WebAuthn L3 fixed-template form).
;; The signed clientDataJSON is reconstructed as
;;   client-data-prefix || base64url-32(challenge) || client-data-suffix
;; with prefix/suffix supplied by the caller. v3 proved only that the hash
;; appears SOMEWHERE in the signed bytes, so one signature over a long challenge
;; holding several 43-char hashes verified once per hash. We now require the
;; inserted hash to be the WHOLE `challenge` JSON field:
;;   - the prefix must be EXACTLY the canonical opener, through the opening quote
;;     of the challenge value. This also pins type = "webauthn.get".
;;   - the suffix must BEGIN with the closing quote  " .
;; base64url has no '"', so those quotes are hard walls and exactly one 32-byte
;; hash fits between them. Every real assertion emits this exact 36-byte prefix.
(define-constant CANONICAL-PREFIX 0x7b2274797065223a22776562617574686e2e676574222c226368616c6c656e6765223a22)
;;                                = {"type":"webauthn.get","challenge":"
(define-constant DQUOTE 0x22) ;; the closing  "

(define-constant B64_ALPHABET 0x4142434445464748494a4b4c4d4e4f505152535455565758595a6162636465666768696a6b6c6d6e6f707172737475767778797a303132333435363738392d5f)

(define-read-only (b64-char (sextet uint))
  (unwrap-panic (element-at? B64_ALPHABET sextet))
)

(define-read-only (byte-at
    (b (buff 32))
    (i uint)
  )
  (buff-to-uint-be (unwrap-panic (element-at? b i)))
)

(define-read-only (enc3
    (b0 uint)
    (b1 uint)
    (b2 uint)
  )
  (concat
    (concat (b64-char (bit-shift-right b0 u2))
      (b64-char (bit-or (bit-shift-left (bit-and b0 u3) u4) (bit-shift-right b1 u4)))
    )
    (concat
      (b64-char (bit-or (bit-shift-left (bit-and b1 u15) u2) (bit-shift-right b2 u6)))
      (b64-char (bit-and b2 u63))
    ))
)

(define-read-only (enc2
    (b0 uint)
    (b1 uint)
  )
  (concat
    (concat (b64-char (bit-shift-right b0 u2))
      (b64-char (bit-or (bit-shift-left (bit-and b0 u3) u4) (bit-shift-right b1 u4)))
    )
    (b64-char (bit-shift-left (bit-and b1 u15) u2))
  )
)

(define-read-only (base64url-32 (b (buff 32)))
  (concat (enc3 (byte-at b u0) (byte-at b u1) (byte-at b u2))
    (concat (enc3 (byte-at b u3) (byte-at b u4) (byte-at b u5))
      (concat (enc3 (byte-at b u6) (byte-at b u7) (byte-at b u8))
        (concat (enc3 (byte-at b u9) (byte-at b u10) (byte-at b u11))
          (concat (enc3 (byte-at b u12) (byte-at b u13) (byte-at b u14))
            (concat (enc3 (byte-at b u15) (byte-at b u16) (byte-at b u17))
              (concat (enc3 (byte-at b u18) (byte-at b u19) (byte-at b u20))
                (concat (enc3 (byte-at b u21) (byte-at b u22) (byte-at b u23))
                  (concat (enc3 (byte-at b u24) (byte-at b u25) (byte-at b u26))
                    (concat
                      (enc3 (byte-at b u27) (byte-at b u28) (byte-at b u29))
                      (enc2 (byte-at b u30) (byte-at b u31))
                    ))
                ))
            ))
        ))
    ))
)

(define-read-only (get-rp-id-hash (authenticator-data (buff 256)))
  (slice? authenticator-data u0 u32)
)

(define-read-only (get-flags-byte (authenticator-data (buff 256)))
  (element-at? authenticator-data u32)
)

(define-read-only (is-user-present (authenticator-data (buff 256)))
  (match (get-flags-byte authenticator-data)
    flags (is-eq (bit-and (buff-to-uint-be flags) u1) u1)
    false
  )
)

(define-read-only (is-user-verified (authenticator-data (buff 256)))
  (match (get-flags-byte authenticator-data)
    flags (is-eq (bit-and (buff-to-uint-be flags) u4) u4)
    false
  )
)

;; True only when the inserted hash is exactly the `challenge` field value:
;; the prefix is the exact canonical template (also pinning type = webauthn.get)
;; and the suffix starts with the closing  " . No arbitrary bytes can sit before
;; or after the hash inside the challenge string, so the challenge member equals
;; base64url-32(message-hash) in its entirety.
(define-read-only (challenge-is-anchored
    (client-data-prefix (buff 128))
    (client-data-suffix (buff 512))
  )
  (and
    (is-eq client-data-prefix CANONICAL-PREFIX)
    (is-eq (element-at? client-data-suffix u0) (some DQUOTE))
  )
)

(define-read-only (compute-client-data-hash
    (challenge (buff 32))
    (client-data-prefix (buff 128))
    (client-data-suffix (buff 512))
  )
  (sha256 (concat client-data-prefix (concat (base64url-32 challenge) client-data-suffix)))
)

(define-read-only (compute-signed-digest
    (challenge (buff 32))
    (authenticator-data (buff 256))
    (client-data-prefix (buff 128))
    (client-data-suffix (buff 512))
  )
  (sha256 (concat authenticator-data
    (compute-client-data-hash challenge client-data-prefix client-data-suffix)
  ))
)

(define-read-only (verify-webauthn-signature
    (public-key (buff 33))
    (challenge (buff 32))
    (authenticator-data (buff 256))
    (client-data-prefix (buff 128))
    (client-data-suffix (buff 512))
    (signature (buff 64))
  )
  (and
    ;; H-01: reject any split where the hash is not the whole challenge field.
    (challenge-is-anchored client-data-prefix client-data-suffix)
    (secp256r1-verify
      (compute-signed-digest challenge authenticator-data client-data-prefix
        client-data-suffix
      )
      signature public-key
    )
  )
)

(define-read-only (verify-assertion
    (public-key (buff 33))
    (challenge (buff 32))
    (rp-id-hash (buff 32))
    (authenticator-data (buff 256))
    (client-data-prefix (buff 128))
    (client-data-suffix (buff 512))
    (signature (buff 64))
  )
  (let (
      (auth-rp-id (unwrap! (get-rp-id-hash authenticator-data) ERR_BAD_AUTH_DATA))
      (flags (unwrap! (get-flags-byte authenticator-data) ERR_BAD_AUTH_DATA))
    )
    (asserts! (>= (len authenticator-data) u37) ERR_BAD_AUTH_DATA)
    (asserts! (is-eq auth-rp-id rp-id-hash) ERR_BAD_RP_ID)
    (asserts! (is-eq (bit-and (buff-to-uint-be flags) u1) u1)
      ERR_USER_NOT_PRESENT
    )
    (ok (verify-webauthn-signature public-key challenge authenticator-data
      client-data-prefix client-data-suffix signature
    ))
  )
)