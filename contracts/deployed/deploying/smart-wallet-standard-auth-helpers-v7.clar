
(define-constant SIP018_MSG_PREFIX 0x534950303138)

(define-read-only (get-domain-hash)
  (sha256 (unwrap-panic (to-consensus-buff? {
    name: "smart-wallet-standard",
    version: "1.0.0",
    chain-id: chain-id,
    wallet: contract-caller,
  })))
)

(define-read-only (build-stx-transfer-hash (details {
  auth-id: uint,
  amount: uint,
  recipient: principal,
  memo: (optional (buff 34)),
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "stx-transfer",
        auth-id: (get auth-id details),
        amount: (get amount details),
        recipient: (get recipient details),
        memo: (get memo details),
      })))
    )))
)

(define-read-only (build-sip010-transfer-hash (details {
  auth-id: uint,
  amount: uint,
  recipient: principal,
  memo: (optional (buff 34)),
  sip010: principal,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "sip010-transfer",
        auth-id: (get auth-id details),
        amount: (get amount details),
        recipient: (get recipient details),
        memo: (get memo details),
        sip010: (get sip010 details),
      })))
    )))
)

(define-read-only (build-sip009-transfer-hash (details {
  auth-id: uint,
  nft-id: uint,
  recipient: principal,
  sip009: principal,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "sip009-transfer",
        auth-id: (get auth-id details),
        nft-id: (get nft-id details),
        recipient: (get recipient details),
        sip009: (get sip009 details),
      })))
    )))
)

(define-read-only (build-extension-call-hash (details {
  auth-id: uint,
  extension: principal,
  payload: (buff 2048),
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "extension-call",
        auth-id: (get auth-id details),
        extension: (get extension details),
        payload: (get payload details),
      })))
    )))
)

(define-read-only (build-whitelist-extension-hash (details {
  auth-id: uint,
  op-id: uint,
  extension: principal,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "whitelist-extension",
        auth-id: (get auth-id details),
        op-id: (get op-id details),
        extension: (get extension details),
      })))
    )))
)

(define-read-only (build-remove-extension-whitelist-hash (details {
  auth-id: uint,
  extension: principal,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "remove-extension-whitelist",
        auth-id: (get auth-id details),
        extension: (get extension details),
      })))
    )))
)

(define-read-only (build-veto-operation-hash (details {
  auth-id: uint,
  op-id: uint,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "veto-operation",
        auth-id: (get auth-id details),
        op-id: (get op-id details),
      })))
    )))
)

(define-read-only (build-add-admin-hash (details {
  auth-id: uint,
  new-admin: principal,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "add-admin",
        auth-id: (get auth-id details),
        new-admin: (get new-admin details),
      })))
    )))
)

(define-read-only (build-confirm-admin-hash (details {
  auth-id: uint,
  new-admin: principal,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "confirm-admin",
        auth-id: (get auth-id details),
        new-admin: (get new-admin details),
      })))
    )))
)

(define-read-only (build-veto-init-hash (details {
  auth-id: uint,
  new-admin: principal,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "veto-init",
        auth-id: (get auth-id details),
        new-admin: (get new-admin details),
      })))
    )))
)

(define-read-only (build-confirm-transfer-hash (details {
  auth-id: uint,
  new-admin: principal,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "confirm-transfer",
        auth-id: (get auth-id details),
        new-admin: (get new-admin details),
      })))
    )))
)

(define-read-only (build-propose-recovery-hash (details {
  auth-id: uint,
  new-recovery: principal,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "propose-recovery",
        auth-id: (get auth-id details),
        new-recovery: (get new-recovery details),
      })))
    )))
)

(define-read-only (build-enroll-dual-stacking-hash (details {
  auth-id: uint,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "enroll-dual-stacking",
        auth-id: (get auth-id details),
      })))
    )))
)

(define-read-only (build-stack-stx-fast-pool-hash (details {
  auth-id: uint,
  amount-ustx: uint,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "stack-stx-fast-pool",
        auth-id: (get auth-id details),
        amount-ustx: (get amount-ustx details),
      })))
    )))
)

(define-read-only (build-revoke-stacking-hash (details {
  auth-id: uint,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "revoke-stacking",
        auth-id: (get auth-id details),
      })))
    )))
)

(define-read-only (build-stack-stx-juice-hash (details {
  auth-id: uint,
  amount-ustx: uint,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "stack-stx-juice",
        auth-id: (get auth-id details),
        amount-ustx: (get amount-ustx details),
      })))
    )))
)

(define-read-only (build-faktory-execute-hash (details {
  auth-id: uint,
  pool: principal,
  amount: uint,
  opcode: (optional (buff 16)),
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "faktory-execute",
        auth-id: (get auth-id details),
        pool: (get pool details),
        amount: (get amount details),
        opcode: (get opcode details),
      })))
    )))
)

(define-read-only (build-faktory-execute-limit-hash (details {
  auth-id: uint,
  pool: principal,
  amount: uint,
  opcode: (optional (buff 16)),
  limit-out: uint,
  expiry-burn-block: uint,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "faktory-execute-limit",
        auth-id: (get auth-id details),
        pool: (get pool details),
        amount: (get amount details),
        opcode: (get opcode details),
        limit-out: (get limit-out details),
        expiry-burn-block: (get expiry-burn-block details),
      })))
    )))
)

(define-read-only (build-faktory-place-order-hash (details {
  auth-id: uint,
  dex: principal,
  amount: uint,
  opcode: (optional (buff 16)),
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "faktory-place-order",
        auth-id: (get auth-id details),
        dex: (get dex details),
        amount: (get amount details),
        opcode: (get opcode details),
      })))
    )))
)

(define-read-only (build-faktory-process-hash (details {
  auth-id: uint,
  pre: principal,
  seat-count: uint,
  opcode: (optional (buff 16)),
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "faktory-process",
        auth-id: (get auth-id details),
        pre: (get pre details),
        seat-count: (get seat-count details),
        opcode: (get opcode details),
      })))
    )))
)

(define-read-only (build-faktory-process-claim-hash (details {
  auth-id: uint,
  pre: principal,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "faktory-process-claim",
        auth-id: (get auth-id details),
        pre: (get pre details),
      })))
    )))
)

(define-read-only (build-faktory-fee-airdrop-hash (details {
  auth-id: uint,
  pre: principal,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "faktory-fee-airdrop",
        auth-id: (get auth-id details),
        pre: (get pre details),
      })))
    )))
)

(define-read-only (build-faktory-burn-bob-hash (details {
  auth-id: uint,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "faktory-burn-bob",
        auth-id: (get auth-id details),
      })))
    )))
)

(define-read-only (build-faktory-nft-execute-hash (details {
  auth-id: uint,
  marketplace: principal,
  token-id: uint,
  ft-contract: principal,
  price: uint,
  opcode: (optional (buff 16)),
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "faktory-nft-execute",
        auth-id: (get auth-id details),
        marketplace: (get marketplace details),
        token-id: (get token-id details),
        ft-contract: (get ft-contract details),
        price: (get price details),
        opcode: (get opcode details),
      })))
    )))
)

(define-read-only (build-toggle-token-lock-hash (details {
  auth-id: uint,
  enabled: bool,
}))
  (sha256 (concat SIP018_MSG_PREFIX
    (concat (get-domain-hash)
      (sha256 (unwrap-panic (to-consensus-buff? {
        topic: "toggle-token-lock",
        auth-id: (get auth-id details),
        enabled: (get enabled details),
      })))
    )))
)
