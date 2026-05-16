;; by friedger here https://github.com/friedger/passkey-stx-send/blob/main/contracts/passkey-not-sender.clar
;; @description passkey-not-sender
;; @version 1.0.0

;; --- errors ---
(define-constant ERR_NOT_OWNER (err u100))
(define-constant ERR_PASSKEY_NOT_FOUND (err u101))
(define-constant ERR_PASSKEY_DISABLED (err u102))
(define-constant ERR_BAD_NONCE (err u103))
(define-constant ERR_BAD_SIGNATURE (err u104))
(define-constant ERR_USER_NOT_PRESENT (err u105))
(define-constant ERR_BAD_RP_ID (err u106))
(define-constant ERR_ALREADY_REGISTERED (err u107))
(define-constant ERR_RP_ID_NOT_SET (err u108))
(define-constant ERR_BAD_AUTH_DATA (err u109))

;; --- SIP-018 structured data ---
(define-constant SIP018_PREFIX 0x534950303138) ;; ascii "SIP018"
(define-constant ZERO_HASH 0x)

;; sha256 of the consensus serialization of the SIP-018 domain tuple:
;;   { name: "send-nothing", version: "1.0.0", chain-id: u1 }
(define-constant DOMAIN_HASH (sha256 (unwrap-panic (to-consensus-buff? {
  chain-id: u1,
  name: "send-nothing",
  version: "1.0.0",
}))))

;; base64url alphabet (RFC 4648 url-safe): A-Z a-z 0-9 - _
(define-constant B64_ALPHABET 0x4142434445464748494a4b4c4d4e4f505152535455565758595a6162636465666768696a6b6c6d6e6f707172737475767778797a303132333435363738392d5f)

;; --- state ---
(define-data-var contract-owner principal tx-sender)

;; sha256 of the WebAuthn rp.id (the app's domain). The owner must set this
;; via `set-rp-id-hash` before any transfer can succeed.
(define-data-var rp-id-hash (buff 32) ZERO_HASH)

;; Registered passkeys, keyed by the 33-byte compressed P-256 public key.
;; `nonce` is the next expected SIP-018 message nonce (replay protection).
(define-map passkeys
  (buff 33)
  {
    nonce: uint,
    enabled: bool,
  }
)

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

;; encode 3 bytes -> 4 base64url chars
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

;; encode the trailing 2 bytes -> 3 base64url chars
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
;; SIP-018 transfer message hash - the value the passkey signs as its challenge.
;; Message tuple: { topic: "not-transfer", amount, recipient, memo, nonce }
;; -----------------------------------------------------------------------------

(define-read-only (transfer-message-hash
    (amount uint)
    (recipient principal)
    (memo (optional (buff 34)))
    (nonce uint)
  )
  (sha256 (concat SIP018_PREFIX
    (concat DOMAIN_HASH
      (sha256 (unwrap-panic (to-consensus-buff? {
        amount: amount,
        memo: memo,
        nonce: nonce,
        recipient: recipient,
        topic: "not-transfer",
      })))
    )))
)

;; -----------------------------------------------------------------------------
;; WebAuthn assertion check (pure crypto - read-only so it can be tested off-chain)
;; -----------------------------------------------------------------------------

(define-read-only (verify-assertion
    (public-key (buff 33))
    (challenge (buff 32))
    (authenticator-data (buff 256))
    (client-data-prefix (buff 128))
    (client-data-suffix (buff 512))
    (signature (buff 64))
  )
  (let (
      ;; rebuild clientDataJSON with the contract-computed challenge in the middle
      (client-data-hash (sha256 (concat client-data-prefix
        (concat (base64url-32 challenge) client-data-suffix)
      )))
      ;; WebAuthn signs sha256( authenticatorData || sha256(clientDataJSON) )
      (signed-digest (sha256 (concat authenticator-data client-data-hash)))
    )
    (secp256r1-verify signed-digest signature public-key)
  )
)

;; --- read-only helpers ---

(define-read-only (get-passkey (public-key (buff 33)))
  (map-get? passkeys public-key)
)

(define-read-only (get-nonce (public-key (buff 33)))
  (default-to u0 (get nonce (map-get? passkeys public-key)))
)

(define-read-only (get-transfer-message-hash
    (amount uint)
    (recipient principal)
    (memo (optional (buff 34)))
    (nonce uint)
  )
  (transfer-message-hash amount recipient memo nonce)
)

(define-read-only (get-challenge-base64
    (amount uint)
    (recipient principal)
    (memo (optional (buff 34)))
    (nonce uint)
  )
  (base64url-32 (transfer-message-hash amount recipient memo nonce))
)

(define-read-only (get-owner)
  (var-get contract-owner)
)

(define-read-only (get-rp-id-hash)
  (var-get rp-id-hash)
)

;; -----------------------------------------------------------------------------
;; owner administration
;; -----------------------------------------------------------------------------

(define-public (register-passkey (public-key (buff 33)))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR_NOT_OWNER)
    (asserts! (is-none (map-get? passkeys public-key)) ERR_ALREADY_REGISTERED)
    (map-set passkeys public-key {
      nonce: u0,
      enabled: true,
    })
    (print {
      notification: "passkey-registered",
      payload: { publicKey: public-key },
    })
    (ok true)
  )
)

(define-public (set-passkey-enabled
    (public-key (buff 33))
    (enabled bool)
  )
  (let ((passkey (unwrap! (map-get? passkeys public-key) ERR_PASSKEY_NOT_FOUND)))
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR_NOT_OWNER)
    (map-set passkeys public-key (merge passkey { enabled: enabled }))
    (print {
      notification: "passkey-enabled",
      payload: {
        publicKey: public-key,
        enabled: enabled,
      },
    })
    (ok true)
  )
)

(define-public (set-rp-id-hash (hash (buff 32)))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR_NOT_OWNER)
    (var-set rp-id-hash hash)
    (ok true)
  )
)

(define-public (set-owner (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR_NOT_OWNER)
    (var-set contract-owner new-owner)
    (ok true)
  )
)

;; Recover NOT held by the contract.
(define-public (withdraw-not
    (amount uint)
    (recipient principal)
  )
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR_NOT_OWNER)
    (as-contract?
      ((with-ft 'SP32AEEF6WW5Y0NMJ1S8SBSZDAY8R5J32NBZFPKKZ.nope "NOT" amount))
      (try! (contract-call? 'SP32AEEF6WW5Y0NMJ1S8SBSZDAY8R5J32NBZFPKKZ.nope transfer
        amount tx-sender recipient none
      ))
    )
  )
)

;; -----------------------------------------------------------------------------
;; transfer-not - verify the passkey assertion, then send NOT from the contract
;; -----------------------------------------------------------------------------

(define-public (transfer-not
    (public-key (buff 33))
    (amount uint)
    (recipient principal)
    (memo (optional (buff 34)))
    (nonce uint)
    (authenticator-data (buff 256))
    (client-data-prefix (buff 128))
    (client-data-suffix (buff 512))
    (signature (buff 64))
  )
  (let (
      (passkey (unwrap! (map-get? passkeys public-key) ERR_PASSKEY_NOT_FOUND))
      (challenge (transfer-message-hash amount recipient memo nonce))
    )
    ;; passkey must be registered, enabled, and at the expected nonce
    (asserts! (get enabled passkey) ERR_PASSKEY_DISABLED)
    (asserts! (is-eq nonce (get nonce passkey)) ERR_BAD_NONCE)
    ;; rp.id must be configured by the owner
    (asserts! (not (is-eq (var-get rp-id-hash) ZERO_HASH)) ERR_RP_ID_NOT_SET)
    ;; authenticator data: minimum length, user-present flag, matching rp.id
    (asserts! (>= (len authenticator-data) u37) ERR_BAD_AUTH_DATA)
    (asserts!
      (is-eq
        (bit-and
          (buff-to-uint-be (unwrap! (element-at? authenticator-data u32) ERR_BAD_AUTH_DATA))
          u1
        )
        u1
      )
      ERR_USER_NOT_PRESENT
    )
    (asserts!
      (is-eq (unwrap! (slice? authenticator-data u0 u32) ERR_BAD_AUTH_DATA)
        (var-get rp-id-hash)
      )
      ERR_BAD_RP_ID
    )
    ;; the passkey signature must verify against the reconstructed challenge
    (asserts!
      (verify-assertion public-key challenge authenticator-data
        client-data-prefix client-data-suffix signature
      )
      ERR_BAD_SIGNATURE
    )
    ;; consume the nonce before moving funds
    (map-set passkeys public-key (merge passkey { nonce: (+ nonce u1) }))
    ;; send NOT from this contract's own balance - Clarity 5 requires
    ;; as-contract? with an explicit allowance for exactly `amount` NOT
    (try! (as-contract?
      ((with-ft 'SP32AEEF6WW5Y0NMJ1S8SBSZDAY8R5J32NBZFPKKZ.nope "NOT" amount))
      (try! (contract-call? 'SP32AEEF6WW5Y0NMJ1S8SBSZDAY8R5J32NBZFPKKZ.nope transfer
        amount tx-sender recipient memo
      ))
    ))
    (print {
      notification: "not-sent",
      payload: {
        publicKey: public-key,
        recipient: recipient,
        amount: amount,
        memo: memo,
        nonce: nonce,
      },
    })
    (ok true)
  )
)