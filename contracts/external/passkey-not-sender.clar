;; SP3FFRX7C911PZP5RHE148YDVDD9JWVS6FXH7PE67.passkey-not-sender

;; @description passkey-not-sender
;; @version 1.0.0

;; --- errors ---
;; u100-u112 are this contract's own. The WebAuthn (P-256) assertion check is
;; delegated to SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.clarity-5-webauthn-v3,
;; which surfaces its own errors: u200 malformed auth data, u201 rp.id
;; mismatch, u202 user-present flag not set. transfer-not propagates those.
(define-constant ERR_NOT_OWNER (err u100))
(define-constant ERR_PASSKEY_NOT_FOUND (err u101))
(define-constant ERR_PASSKEY_DISABLED (err u102))
(define-constant ERR_BAD_NONCE (err u103))
(define-constant ERR_BAD_SIGNATURE (err u104))
(define-constant ERR_USER_NOT_VERIFIED (err u105))
(define-constant ERR_ALREADY_REGISTERED (err u107))
(define-constant ERR_RP_ID_NOT_SET (err u108))
(define-constant ERR_AMOUNT_TOO_LARGE (err u110))
(define-constant ERR_NAME_ALREADY_RECEIVED (err u111))
(define-constant ERR_NAME_UNRESOLVED (err u112))
(define-constant ERR_RP_ID_HASH_FAILURE (err u113))

;; An unregistered passkey may send at most this many NOT, exactly once.
;; NOT has 0 decimals, so this is 10,000 NOT.
(define-constant FREE_LIMIT u10000)

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

;; BNS names that have already received NOT through this contract. A name may
;; receive only once - getting another costs a BNS registration / purchase.
(define-map received-names
  {
    name: (buff 48),
    namespace: (buff 20),
  }
  bool
)

;; -----------------------------------------------------------------------------
;; SIP-018 transfer message hash - the value the passkey signs as its challenge.
;; Message tuple: { topic: "not-transfer", amount, name, namespace, memo, nonce }
;; -----------------------------------------------------------------------------

(define-read-only (transfer-message-hash
    (amount uint)
    (name (buff 48))
    (namespace (buff 20))
    (memo (optional (buff 34)))
    (nonce uint)
  )
  (sha256 (concat SIP018_PREFIX
    (concat DOMAIN_HASH
      (sha256 (unwrap-panic (to-consensus-buff? {
        amount: amount,
        memo: memo,
        name: name,
        namespace: namespace,
        nonce: nonce,
        topic: "not-transfer",
      })))
    )))
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
    (name (buff 48))
    (namespace (buff 20))
    (memo (optional (buff 34)))
    (nonce uint)
  )
  (transfer-message-hash amount name namespace memo nonce)
)

;; The challenge as the base64url string the authenticator embeds in
;; clientDataJSON. base64url encoding is delegated to the clarity-5-webauthn-v3
;; library so this contract carries no crypto-encoding code of its own.
(define-read-only (get-challenge-base64
    (amount uint)
    (name (buff 48))
    (namespace (buff 20))
    (memo (optional (buff 34)))
    (nonce uint)
  )
  (contract-call? 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.clarity-5-webauthn-v3
    base64url-32 (transfer-message-hash amount name namespace memo nonce)
  )
)

(define-read-only (get-owner)
  (var-get contract-owner)
)

(define-read-only (get-rp-id-hash)
  (var-get rp-id-hash)
)

;; Whether a BNS name has already received NOT through this contract.
;; The UI should check this before building a transfer.
(define-read-only (name-has-received
    (name (buff 48))
    (namespace (buff 20))
  )
  (default-to false
    (map-get? received-names {
      name: name,
      namespace: namespace,
    })
  )
)

;; -----------------------------------------------------------------------------
;; owner administration
;; -----------------------------------------------------------------------------

(define-fungible-token anti-phishing)
(define-private (is-contract-owner)
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR_NOT_OWNER)
    (try! (ft-mint? anti-phishing u1 tx-sender))
    (try! (ft-burn? anti-phishing u1 tx-sender))
    (ok true)
  )
)

(define-public (register-passkey (public-key (buff 33)))
  (begin
    (try! (is-contract-owner))
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
    (try! (is-contract-owner))
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

(define-public (set-rp-id-hash (rp-id (string-ascii 250)))
  (let ((rpidhash (unwrap-panic (to-consensus-buff? rp-id))))
    (try! (is-contract-owner))
    (var-set rp-id-hash
      (sha256 (unwrap! (slice? rpidhash u5 (len rpidhash)) ERR_RP_ID_HASH_FAILURE))
    )
    (ok (var-get rp-id-hash))
  )
)

(define-public (set-owner (new-owner principal))
  (begin
    (try! (is-contract-owner))
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
    (try! (is-contract-owner))
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
    (name (buff 48))
    (namespace (buff 20))
    (memo (optional (buff 34)))
    (nonce uint)
    (authenticator-data (buff 256))
    (client-data-prefix (buff 128))
    (client-data-suffix (buff 512))
    (signature (buff 64))
  )
  (let (
      (entry (map-get? passkeys public-key))
      ;; "registered" = an entry the owner added and left enabled; such a
      ;; passkey may transfer repeatedly with no amount cap.
      (registered (default-to false (get enabled entry)))
      (expected-nonce (default-to u0 (get nonce entry)))
      ;; the BNS name key, built once - used for the check and the record
      (name-key {
        name: name,
        namespace: namespace,
      })
    )
    ;; An unregistered passkey gets ONE free transfer: with no entry yet it
    ;; is allowed; afterwards it has an entry that is not enabled, which is
    ;; blocked here (this also blocks owner-disabled passkeys).
    (asserts! (or registered (is-none entry)) ERR_PASSKEY_DISABLED)
    ;; Unregistered passkeys may send at most FREE_LIMIT NOT.
    (asserts! (or registered (<= amount FREE_LIMIT)) ERR_AMOUNT_TOO_LARGE)
    (asserts! (is-eq nonce expected-nonce) ERR_BAD_NONCE)
    ;; Each BNS name may receive NOT through this contract only once.
    (asserts! (is-none (map-get? received-names name-key))
      ERR_NAME_ALREADY_RECEIVED
    )
    ;; rp.id must be configured by the owner
    (asserts! (not (is-eq (var-get rp-id-hash) ZERO_HASH)) ERR_RP_ID_NOT_SET)
    ;; Verify the passkey assertion via the deployed clarity-5-webauthn-v3
    ;; library. It checks the authenticator data length, the rp.id hash, the
    ;; user-present flag, and the P-256 signature over
    ;; sha256(authData || sha256(clientDataJSON)). It returns (ok true) for a
    ;; valid signature, (ok false) for a bad one, and (err u200/u201/u202) for
    ;; malformed auth data / rp.id / user-present. The SIP-018 challenge is
    ;; computed here, after the cheap checks above, so a failed transfer does
    ;; not pay to hash it.
    (asserts!
      (try! (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.clarity-5-webauthn-v3
        verify-assertion public-key
        (transfer-message-hash amount name namespace memo nonce)
        (var-get rp-id-hash) authenticator-data client-data-prefix
        client-data-suffix signature
      ))
      ERR_BAD_SIGNATURE
    )
    ;; clarity-5-webauthn-v3.verify-assertion enforces only User Present (UP).
    ;; This app signs with userVerification:"required", so also require the
    ;; signed User Verified (UV) flag on-chain, where it cannot be forged. v3
    ;; exposes is-user-verified for exactly this - it returns false when the UV
    ;; flag is clear or the authenticator data carries no flags byte.
    (asserts!
      (contract-call?
        'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.clarity-5-webauthn-v3
        is-user-verified authenticator-data
      )
      ERR_USER_NOT_VERIFIED
    )
    ;; Resolve the BNS name to its current owner. Done only after the
    ;; signature verifies, so failed transfers don't pay for the lookup.
    (let ((recipient (unwrap!
        (unwrap!
          (contract-call? 'SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF.BNS-V2
            get-owner-name name namespace
          )
          ERR_NAME_UNRESOLVED
        )
        ERR_NAME_UNRESOLVED
      )))
      ;; Record state before moving funds: consume the nonce (a registered
      ;; passkey keeps its enabled entry; an unregistered one gets a disabled
      ;; entry, so its single free transfer cannot be repeated), and mark the
      ;; BNS name as having received.
      (map-set passkeys public-key {
        nonce: (+ nonce u1),
        enabled: registered,
      })
      (map-set received-names name-key true)
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
          name: name,
          namespace: namespace,
          recipient: recipient,
          amount: amount,
          memo: memo,
          nonce: nonce,
        },
      })
      (ok true)
    )
  )
)