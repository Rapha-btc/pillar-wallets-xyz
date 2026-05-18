;; title: clarity-webauthn
;; version: 1.0.0
;; summary: WebAuthn passkey assertion verification for Clarity 5.
;; description:
;;   Verifies WebAuthn (FIDO2 / passkey) assertions on-chain using secp256r1
;;   (P-256). Reconstructs the signed digest from caller-supplied
;;   authenticatorData and clientDataJSON parts, then runs secp256r1-verify.
;;
;;   WebAuthn signs: sha256( authenticatorData || sha256(clientDataJSON) )
;;
;;   clientDataJSON contains a base64url-encoded challenge in the middle. The
;;   caller supplies the JSON split into a prefix (before the challenge) and a
;;   suffix (after). The contract base64url-encodes the challenge it expects,
;;   splices it in, and hashes the result. If the caller lies about the
;;   challenge, the rebuilt JSON differs from what the authenticator signed and
;;   verification fails.
;;
;;   Two verification entry points:
;;     - verify-assertion        : full check, single rp.id (most common case)
;;     - verify-webauthn-signature: signature-only, no rp.id binding
;;                                  (for callers that whitelist multiple rp.ids)

(define-constant ERR_BAD_AUTH_DATA (err u200))
(define-constant ERR_BAD_RP_ID (err u201))
(define-constant ERR_USER_NOT_PRESENT (err u202))

;; base64url alphabet (RFC 4648, url-safe): A-Z a-z 0-9 - _
(define-constant B64_ALPHABET 0x4142434445464748494a4b4c4d4e4f505152535455565758595a6162636465666768696a6b6c6d6e6f707172737475767778797a303132333435363738392d5f)

;; -----------------------------------------------------------------------------
;; base64url encoding of a 32-byte buffer -> 43 ascii chars (no padding)
;; -----------------------------------------------------------------------------

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

;; -----------------------------------------------------------------------------
;; authenticatorData inspection
;;
;; Layout:
;;   bytes 0..32   : rp.id hash (sha256 of the relying party domain)
;;   byte  32      : flags (bit 0 = user present, bit 2 = user verified, ...)
;;   bytes 33..37  : signCount (u32 big-endian)
;;   bytes 37+     : optional attestedCredentialData / extensions
;; -----------------------------------------------------------------------------

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

;; User Verification (UV, flags bit 2) is a stronger signal than User Presence:
;; it means the authenticator actually verified the user (biometric or PIN),
;; not merely that someone interacted with it. Check this when a passkey touch
;; alone is not enough to authorize an action.
(define-read-only (is-user-verified (authenticator-data (buff 256)))
  (match (get-flags-byte authenticator-data)
    flags (is-eq (bit-and (buff-to-uint-be flags) u4) u4)
    false
  )
)

;; -----------------------------------------------------------------------------
;; WebAuthn signature reconstruction + verification
;; -----------------------------------------------------------------------------

;; Reconstruct clientDataJSON from caller-supplied prefix/suffix with the
;; contract-computed challenge spliced in, then return sha256 of the result.
(define-read-only (compute-client-data-hash
    (challenge (buff 32))
    (client-data-prefix (buff 128))
    (client-data-suffix (buff 512))
  )
  (sha256 (concat client-data-prefix
    (concat (base64url-32 challenge) client-data-suffix)
  ))
)

;; sha256( authenticatorData || sha256(clientDataJSON) ) - what WebAuthn signs.
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

;; Signature-only check. The caller is responsible for verifying rp.id and
;; user-presence (use get-rp-id-hash / is-user-present, or call
;; verify-assertion below for the full single-rp.id flow).
(define-read-only (verify-webauthn-signature
    (public-key (buff 33))
    (challenge (buff 32))
    (authenticator-data (buff 256))
    (client-data-prefix (buff 128))
    (client-data-suffix (buff 512))
    (signature (buff 64))
  )
  (secp256r1-verify
    (compute-signed-digest challenge authenticator-data
      client-data-prefix client-data-suffix)
    signature public-key)
)

;; Full single-rp.id assertion check:
;;   - authenticatorData is at least 37 bytes (rpIdHash + flags + signCount)
;;   - authenticatorData[0..32] equals the expected rp.id hash
;;   - user-presence flag is set
;;   - the passkey signed the reconstructed digest
;;
;; Returns (response bool uint). Use this when your application has exactly
;; one rp.id. For multi-rp.id callers, use verify-webauthn-signature plus your
;; own rp.id whitelist and is-user-present check.
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
    ;; authenticatorData is rpIdHash[32] + flags[1] + signCount[4], so a real
    ;; assertion is at least 37 bytes. A shorter buffer is malformed - fail
    ;; fast here rather than letting it through to secp256r1-verify.
    (asserts! (>= (len authenticator-data) u37) ERR_BAD_AUTH_DATA)
    (asserts! (is-eq auth-rp-id rp-id-hash) ERR_BAD_RP_ID)
    (asserts! (is-eq (bit-and (buff-to-uint-be flags) u1) u1) ERR_USER_NOT_PRESENT)
    (ok (verify-webauthn-signature public-key challenge authenticator-data
          client-data-prefix client-data-suffix signature))
  )
)
