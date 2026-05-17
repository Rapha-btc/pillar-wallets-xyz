;; SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-core-v2

(define-constant ERR_NOT_AUTHORIZED (err u1001))
(define-constant ERR_POOL_ALREADY_EXISTS (err u1002))
(define-constant ERR_POOL_NOT_FOUND (err u1003))
(define-constant ERR_INVALID_POOL_DATA (err u1004))
(define-constant ERROR_RESERVES (err u1005))
(define-constant ERR_INVALID_OPERATION (err u1006))
(define-constant ERR-PRICE-PER-SEAT (err u1007))
(define-constant ERR-TOKENS-PER-SEAT (err u1008))

(define-constant OP_SWAP_A_TO_B 0x00)
(define-constant OP_SWAP_B_TO_A 0x01)
(define-constant OP_ADD_LIQUIDITY 0x02)
(define-constant OP_REMOVE_LIQUIDITY 0x03)
(define-constant OP_LOOKUP_RESERVES 0x04)

(use-trait pool-trait 'SP2ZNGJ85ENDY6QRHQ5P2D4FXKGZWCKTB2T0Z55KS.dexterity-traits-v0.liquidity-pool-trait)
(use-trait dex-trait 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.faktory-dex-trait-v2.dex-trait) 
(use-trait pre-trait 'SP29D6YMDNAKN1P045T6Z817RTE1AC0JAA99WAX2B.prelaunch-faktory-trait.prelaunch-trait)
(use-trait token-trait 'SP3XXMS38VTAWTVPE5682XSBFXPTH7XCPEBTX8AN2.faktory-trait-v1.sip-010-trait)

(define-constant DEPLOYER tx-sender) ;; this as multi-sig would be safer -> core-v3  

(define-data-var gated bool false)

(define-data-var last-pool-id uint u0)

(define-map pools uint {
    pool-contract: principal,
    pool-name: (string-ascii 64),
    pool-symbol: (string-ascii 32),
    x-token: principal,
    y-token: principal,
    creation-height: uint,
    lp-fee: uint,
    pool-uri: (string-utf8 256),
})

(define-map pool-contracts principal uint)

(define-read-only (get-last-pool-id)
   (var-get last-pool-id)
)

(define-read-only (get-pool-by-id (pool-id uint))
    (map-get? pools pool-id)
)

(define-read-only (get-pool-by-contract (pool-contract principal))
    (match (map-get? pool-contracts pool-contract)
        pool-id (map-get? pools pool-id)
        none
    )
)

(define-public (register-pool 
    (pool-contract <pool-trait>)
    (name (string-ascii 64))
    (symbol (string-ascii 32))
    (x-token principal)
    (y-token principal)
    (creation-height uint)
    (lp-fee uint)
    (pool-uri (optional (string-utf8 256)))
)
    (let (
        (new-pool-id (+ (var-get last-pool-id) u1))
        (uri (default-to u"https://fak.fun/" pool-uri))
        (caller tx-sender)
        (reserves-data (unwrap! (contract-call? pool-contract quote u0 (some OP_LOOKUP_RESERVES)) ERROR_RESERVES))
    )
        (asserts! (is-eq caller DEPLOYER) ERR_NOT_AUTHORIZED)
        (asserts! (is-none (map-get? pool-contracts (contract-of pool-contract))) ERR_POOL_ALREADY_EXISTS)
        (asserts! (> (len name) u0) ERR_INVALID_POOL_DATA)
        (asserts! (> (len symbol) u0) ERR_INVALID_POOL_DATA)        
        (map-set pools new-pool-id {
            pool-contract: (contract-of pool-contract),
            pool-name: name,
            pool-symbol: symbol,
            x-token: x-token,
            y-token: y-token,
            creation-height: creation-height,
            lp-fee: lp-fee,
            pool-uri: uri
        })        
        (map-set pool-contracts (contract-of pool-contract) new-pool-id)        
        (var-set last-pool-id new-pool-id)        
        (print {
            action: "register-pool",
            caller: caller,
            pool-id: new-pool-id,
            pool-contract: (contract-of pool-contract),
            pool-name: name,
            pool-symbol: symbol,
            x-token: x-token,
            y-token: y-token,
            creation-height: creation-height,
            lp-fee: lp-fee,
            pool-uri: uri,
            x-amount: (get dx reserves-data),
            y-amount: (get dy reserves-data),    
            total-shares: (get dk reserves-data) })
        (ok new-pool-id)
    )
)

(define-public (auto-register-pool 
    (pool-contract principal)
    (name (string-ascii 64))
    (symbol (string-ascii 32))
    (x-token principal)
    (y-token principal)
    (creation-height uint)
    (lp-fee uint)
    (pool-uri (optional (string-utf8 256)))
    (dx uint)
    (dy uint)
    (dk uint)
) 
    (let (
        (new-pool-id (+ (var-get last-pool-id) u1))
        (uri (default-to u"https://fak.fun/" pool-uri))
        (caller tx-sender)
    )
        (asserts! (is-eq caller DEPLOYER) ERR_NOT_AUTHORIZED)
        (asserts! (is-none (map-get? pool-contracts pool-contract)) ERR_POOL_ALREADY_EXISTS)
        (asserts! (> (len name) u0) ERR_INVALID_POOL_DATA)
        (asserts! (> (len symbol) u0) ERR_INVALID_POOL_DATA)        
        (map-set pools new-pool-id {
            pool-contract: pool-contract,
            pool-name: name,
            pool-symbol: symbol,
            x-token: x-token,
            y-token: y-token,
            creation-height: creation-height,
            lp-fee: lp-fee,
            pool-uri: uri
        })        
        (map-set pool-contracts pool-contract new-pool-id)        
        (var-set last-pool-id new-pool-id)        
        (print {
            action: "register-pool",
            caller: caller,
            pool-id: new-pool-id,
            pool-contract: pool-contract,
            pool-name: name,
            pool-symbol: symbol,
            x-token: x-token,
            y-token: y-token,
            creation-height: creation-height,
            lp-fee: lp-fee,
            pool-uri: uri,
            x-amount: dx,
            y-amount: dy,    
            total-shares: dk })
        (ok new-pool-id)
    )
)

(define-public (edit-pool
    (pool-id uint)
    (pool-contract <pool-trait>)
    (name (string-ascii 64))
    (symbol (string-ascii 32))
    (x-token principal)
    (y-token principal)
    (creation-height uint)
    (lp-fee uint)
    (pool-uri (optional (string-utf8 256)))
)
    (let (
        (caller tx-sender)
        (existing-pool (unwrap! (map-get? pools pool-id) ERR_POOL_NOT_FOUND))
        (uri (default-to u"https://fak.fun/" pool-uri))
    )
        (asserts! (is-eq caller DEPLOYER) ERR_NOT_AUTHORIZED)
        (asserts! (> (len name) u0) ERR_INVALID_POOL_DATA)
        (asserts! (> (len symbol) u0) ERR_INVALID_POOL_DATA)
        (map-delete pool-contracts (get pool-contract existing-pool))
        (map-set pool-contracts (contract-of pool-contract) pool-id)
        (map-set pools pool-id {
            pool-contract: (contract-of pool-contract),
            pool-name: name,
            pool-symbol: symbol,
            x-token: x-token,
            y-token: y-token,
            creation-height: creation-height,
            lp-fee: lp-fee,
            pool-uri: uri
        })
        (print {
            action: "edit-pool",
            caller: caller,
            pool-id: pool-id,
            pool-contract: (contract-of pool-contract),
            pool-name: name,
            pool-symbol: symbol,
            x-token: x-token,
            y-token: y-token,
            creation-height: creation-height,
            lp-fee: lp-fee,
            pool-uri: uri
        }) 
        (ok pool-id)
    )
)

(define-public (get-pool (pool-contract <pool-trait>))
    (let (
            (pool-id (map-get? pool-contracts (contract-of pool-contract)))
            (pool-info (match pool-id
                                id (map-get? pools id)
                                none))
          )
        (if (and (is-some pool-id) (is-some pool-info))
            (let (
                (id (unwrap-panic pool-id))
                (info (unwrap-panic pool-info))
                (reserves-data (unwrap! (contract-call? pool-contract quote u0 (some OP_LOOKUP_RESERVES)) ERROR_RESERVES))
            )
                (ok (some {
                    pool-id: id,
                    pool-contract: (contract-of pool-contract),
                    pool-name: (get pool-name info),
                    pool-symbol: (get pool-symbol info),
                    x-token: (get x-token info),
                    y-token: (get y-token info),
                    creation-height: (get creation-height info),
                    lp-fee: (get lp-fee info),
                    pool-uri: (get pool-uri info),
                    x-amount: (get dx reserves-data),
                    y-amount: (get dy reserves-data),    
                    total-shares: (get dk reserves-data)  
                }))
            )
            (ok none)
        )
    )
)

(define-public (execute
    (pool-contract <pool-trait>)
    (amount uint)
    (opcode (optional (buff 16))))
    (let (
        (sender tx-sender)
        (operation (get-byte (default-to 0x00 opcode) u0))
        (pool-id (map-get? pool-contracts (contract-of pool-contract)))
        (pool-info (match pool-id
                        id (map-get? pools id)
                        none))
        (result (try! (contract-call? pool-contract execute amount opcode)))
        (reserves-after (unwrap! (contract-call? pool-contract quote u0 (some OP_LOOKUP_RESERVES)) ERROR_RESERVES))
    )
    (and (var-get gated) (asserts! (is-approved-caller) ERR_NOT_AUTHORIZED))
        (match pool-info
    info (begin
        (if (is-eq operation OP_SWAP_A_TO_B)
            (begin
                (print {
                    type: "buy",
                    sender: sender,
                    token-in: (get x-token info),
                    amount-in: amount,
                    token-out: (get y-token info),
                    amount-out: (get dy result),
                    pool-reserves: reserves-after,
                    pool-contract: (contract-of pool-contract),
                    min-y-out: u0
                })
                true
            )
            (if (is-eq operation OP_SWAP_B_TO_A)
                (begin
                    (print {
                        type: "sell",
                        sender: sender,
                        token-in: (get y-token info),
                        amount-in: amount,
                        token-out: (get x-token info),
                        amount-out: (get dy result),
                        pool-reserves: reserves-after,
                        pool-contract: (contract-of pool-contract),
                        min-y-out: u0
                    })
                    true
                )
                (if (is-eq operation OP_ADD_LIQUIDITY)
                    (begin
                        (print {
                            type: "add-liquidity",
                            sender: sender,
                            token-a: (get x-token info),
                            token-a-amount: (get dx result),
                            token-b: (get y-token info),
                            token-b-amount: (get dy result),
                            lp-tokens: (get dk result),
                            pool-reserves: reserves-after,
                            pool-contract: (contract-of pool-contract)
                        })
                        true
                    )
                    (if (is-eq operation OP_REMOVE_LIQUIDITY)
                        (begin
                            (print {
                                type: "remove-liquidity",
                                sender: sender,
                                token-a: (get x-token info),
                                token-a-amount: (get dx result),
                                token-b: (get y-token info),
                                token-b-amount: (get dy result),
                                lp-tokens: (get dk result),
                                pool-reserves: reserves-after,
                                pool-contract: (contract-of pool-contract)
                            })
                            true
                        )
                        (asserts! false ERR_INVALID_OPERATION)  
                    )
                )
            )
        )  
    )
    (asserts! false ERR_POOL_NOT_FOUND))
    (ok result)))

(define-private (get-byte
    (opcode (buff 16))
    (position uint))
    (default-to 0x00 (element-at? opcode position)))

(define-data-var last-dex-id uint u0)

(define-map dexes uint {
    dex-contract: principal,
    pre-contract: principal,
    bonus-contract: (optional principal),
    x-token: principal,
    y-token: principal,
    x-target: uint,
    y-supply: uint,
    price-per-seat: (optional uint),
    tokens-per-seat: (optional uint),
    creation-height: uint,
  }
)

(define-map dex-contracts principal uint)
(define-map pre-contracts principal uint)
(define-map bonus-contracts principal uint)

(define-read-only (get-last-dex-id)
   (var-get last-dex-id)
)

(define-read-only (get-dex-by-id (dex-id uint))
    (map-get? dexes dex-id)
)

(define-read-only (get-dex-by-contract (dex-contract principal))
    (match (map-get? dex-contracts dex-contract)
        dex-id (map-get? dexes dex-id)
        none
    )
)

(define-read-only (get-pre-by-contract (pre-contract principal))
    (match (map-get? pre-contracts pre-contract)
        dex-id (map-get? dexes dex-id)
        none
    )
)

(define-read-only (get-dex-by-bonus (bonus-contract principal))
    (match (map-get? bonus-contracts bonus-contract)
        dex-id (map-get? dexes dex-id)
        none
    )
)

(define-public (register-dex
    (dex-contract principal)
    (pre-contract principal)
    (bonus-contract (optional principal))
    (x-token principal)
    (y-token principal)
    (x-target uint)
    (y-supply uint)
    (price-per-seat (optional uint))
    (tokens-per-seat (optional uint))
    (creation-height uint)
)
    (let (
        (new-dex-id (+ (var-get last-dex-id) u1))
        (caller tx-sender)
    )
        (asserts! (is-eq caller DEPLOYER) ERR_NOT_AUTHORIZED)
        (asserts! (is-none (map-get? dex-contracts dex-contract)) ERR_POOL_ALREADY_EXISTS)
        (asserts! (is-none (map-get? pre-contracts pre-contract)) ERR_POOL_ALREADY_EXISTS)

        (map-set dexes new-dex-id {
            dex-contract: dex-contract,
            pre-contract: pre-contract,
            bonus-contract: bonus-contract,
            x-token: x-token,
            y-token: y-token,
            x-target: x-target,
            y-supply: y-supply,
            price-per-seat: price-per-seat,
            tokens-per-seat: tokens-per-seat,
            creation-height: creation-height
        })

        (map-set dex-contracts dex-contract new-dex-id)
        (map-set pre-contracts pre-contract new-dex-id)
        ;; Register bonus contract if provided
        (match bonus-contract
            bonus-principal (map-set bonus-contracts bonus-principal new-dex-id)
            true
        )
        (var-set last-dex-id new-dex-id)

        (print {
            action: "register-dex",
            caller: caller,
            dex-id: new-dex-id,
            dex-contract: dex-contract,
            pre-contract: pre-contract,
            bonus-contract: bonus-contract,
            x-token: x-token,
            y-token: y-token,
            x-target: x-target,
            y-supply: y-supply,
            price-per-seat: price-per-seat,
            tokens-per-seat: tokens-per-seat,
            creation-height: creation-height
        })
        (ok new-dex-id)
    )
)

(define-public (edit-dex
    (dex-id uint)
    (dex-contract principal)
    (pre-contract principal)
    (bonus-contract (optional principal))
    (x-token principal)
    (y-token principal)
    (x-target uint)
    (y-supply uint)
    (price-per-seat (optional uint))
    (tokens-per-seat (optional uint))
    (creation-height uint)
)
    (let (
        (caller tx-sender)
        (existing-dex (unwrap! (map-get? dexes dex-id) ERR_POOL_NOT_FOUND))
    )
        (asserts! (is-eq caller DEPLOYER) ERR_NOT_AUTHORIZED)
        (map-delete dex-contracts (get dex-contract existing-dex))
        (map-delete pre-contracts (get pre-contract existing-dex))
        (match (get bonus-contract existing-dex)
            old-bonus (map-delete bonus-contracts old-bonus)
            true)
        (map-set dex-contracts dex-contract dex-id)
        (map-set pre-contracts pre-contract dex-id)
        (match bonus-contract
            bonus-principal (map-set bonus-contracts bonus-principal dex-id)
            true)

        (map-set dexes dex-id {
            dex-contract: dex-contract,
            pre-contract: pre-contract,
            bonus-contract: bonus-contract,
            x-token: x-token,
            y-token: y-token,
            x-target: x-target,
            y-supply: y-supply,
            price-per-seat: price-per-seat,
            tokens-per-seat: tokens-per-seat,
            creation-height: creation-height
        })

        (print {
            action: "edit-dex",
            caller: caller,
            dex-id: dex-id,
            dex-contract: dex-contract,
            pre-contract: pre-contract,
            bonus-contract: bonus-contract,
            x-token: x-token,
            y-token: y-token,
            x-target: x-target,
            y-supply: y-supply,
            price-per-seat: price-per-seat,
            tokens-per-seat: tokens-per-seat,
            creation-height: creation-height
        })
        (ok dex-id)
    )
)

(define-public (place-order
    (dex <dex-trait>)
    (token <token-trait>)
    (amount uint)
    (opcode (optional (buff 16))))
  (let (
      (sender tx-sender)
      (operation (get-byte (default-to 0x00 opcode) u0)) 
      (dex-principal (contract-of dex))
      (dex-id (map-get? dex-contracts dex-principal))
      (dex-info (match dex-id
                    id (map-get? dexes id)
                    none))
    )
    (match dex-info
        info (begin
                (if (is-eq operation OP_SWAP_A_TO_B)
                    (let ((tokens-out (try! (contract-call? dex buy token amount))))
                         (print {
                            type: "buy",
                            sender: sender,
                            token-in: (get x-token info),
                            amount-in: amount,
                            token-out: (get y-token info),
                            amount-out: tokens-out,
                            x-target: (get x-target info),
                            y-supply: (get y-supply info),
                            creation-height: (get creation-height info),
                            dex-contract: dex-principal })
                         (ok tokens-out))
                    (if (is-eq operation OP_SWAP_B_TO_A)
                        (let ((ubtc-out (try! (contract-call? dex sell token amount))))
                        (print {
                            type: "sell",
                            sender: sender,
                            token-in: (get y-token info),
                            amount-in: amount,
                            token-out: (get x-token info),
                            amount-out: ubtc-out,
                            x-target: (get x-target info),
                            y-supply: (get y-supply info),
                            creation-height: (get creation-height info),
                            dex-contract: dex-principal })
                        (ok ubtc-out))
                        ERR_INVALID_OPERATION
                    )
                )
              )
        ERR_POOL_NOT_FOUND)))

(define-public (process
    (pre <pre-trait>)
    (seat-count uint)
    (owner (optional principal))
    (opcode (optional (buff 16))))
  (let (
      (tx-owner (default-to tx-sender owner))
      (operation (get-byte (default-to 0x02 opcode) u0)) 
      (pre-principal (contract-of pre))
      (pre-id (map-get? pre-contracts pre-principal))
      (pre-info (match pre-id
                    id (map-get? dexes id)
                    none))
    )
    (match pre-info
        info (begin
                (if (is-eq operation OP_ADD_LIQUIDITY)
                    (let ((actual-seats (try! (contract-call? pre buy-up-to seat-count (some tx-owner)))))
                        (print {
                            type: "buy-seats",
                            sender: tx-owner,
                            seats: actual-seats,
                            token-in: (get x-token info),
                            amount-in: (* actual-seats (unwrap! (get price-per-seat info) ERR-PRICE-PER-SEAT)),
                            token-out: (get y-token info),
                            amount-out: (* actual-seats (unwrap! (get tokens-per-seat info) ERR-TOKENS-PER-SEAT)),
                            x-target: (get x-target info),
                            y-supply: (get y-supply info),
                            creation-height: (get creation-height info),
                            pre-contract: pre-principal })
                        ;; Detect if distribution was just triggered (market was open before buy, now closed)
                        (match (contract-call? pre is-market-open)
                            open-val (if open-val
                                (begin (print {
                                    type: "distribution-initialized",
                                    pre-contract: pre-principal,
                                    token-contract: (get y-token info),
                                    distribution-height: burn-block-height,
                                    ft-supply: (get y-supply info)
                                }) true)
                                true)
                            err-val true)
                        (ok actual-seats))
                    (if (is-eq operation OP_REMOVE_LIQUIDITY)
                        (let ((user-seats (try! (contract-call? pre refund (some tx-owner)))))
                            (print {
                                type: "refund-seats",
                                sender: tx-owner,
                                seats-refunded: user-seats,
                                token-in: (get y-token info),
                                amount-in: (* user-seats (unwrap! (get tokens-per-seat info) ERR-TOKENS-PER-SEAT)),
                                token-out: (get x-token info),
                                amount-out: (* user-seats (unwrap! (get price-per-seat info) ERR-PRICE-PER-SEAT)),
                                x-target: (get x-target info),
                                y-supply: (get y-supply info),
                                creation-height: (get creation-height info),
                                pre-contract: pre-principal })
                            (ok user-seats))
                        ERR_INVALID_OPERATION)))
        ERR_POOL_NOT_FOUND)))

(define-map approved-callers principal bool)

(define-public (approve-caller (caller principal))
  (begin
    (asserts! (is-eq tx-sender DEPLOYER) ERR_NOT_AUTHORIZED)
    (ok (map-set approved-callers caller true))
  )
)

(define-public (revoke-caller (caller principal))
  (begin
    (asserts! (is-eq tx-sender DEPLOYER) ERR_NOT_AUTHORIZED)
    (ok (map-set approved-callers caller false))
  )
)

(define-private (is-approved-caller)
  (or
    (is-eq tx-sender contract-caller) 
    (default-to false (map-get? approved-callers contract-caller)) 
  )
)

(define-public (set-gated (enabled bool))
  (begin
    (asserts! (is-eq tx-sender DEPLOYER) ERR_NOT_AUTHORIZED)
    (ok (var-set gated enabled))
  )
)

(define-read-only (is-gated)
  (var-get gated)
)

(define-constant ERR_NOT_REGISTERED_BONUS (err u1009))

(define-private (is-registered-bonus (caller principal))
    (is-some (map-get? bonus-contracts caller))
)

(define-public (log-bonus-deposit
    (agent-amount uint)
    (originator-amount uint)
)
    (begin
        (asserts! (is-registered-bonus contract-caller) ERR_NOT_REGISTERED_BONUS)
        (print {
            action: "bonus-deposit",
            bonus-contract: contract-caller,
            agent-amount: agent-amount,
            originator-amount: originator-amount
        })
        (ok true)
    )
)

(define-public (log-bonus-claim-agent
    (claimer principal)
    (amount uint)
)
    (begin
        (asserts! (is-registered-bonus contract-caller) ERR_NOT_REGISTERED_BONUS)
        (print {
            action: "bonus-claim-agent",
            bonus-contract: contract-caller,
            claimer: claimer,
            amount: amount
        })
        (ok true)
    )
)

(define-public (log-bonus-claim-originator
    (claimer principal)
    (amount uint)
)
    (begin
        (asserts! (is-registered-bonus contract-caller) ERR_NOT_REGISTERED_BONUS)
        (print {
            action: "bonus-claim-originator",
            bonus-contract: contract-caller,
            claimer: claimer,
            amount: amount
        })
        (ok true)
    )
)

;; Pre-launch routing functions
;; Routes claim/fee-airdrop through core-v3 (like process does for buy/refund)
;; so a single chainhook on core-v3 catches all pre-launch events

(define-public (process-claim
    (pre <pre-trait>)
    (token <token-trait>)
    (owner (optional principal)))
  (let (
      (tx-owner (default-to tx-sender owner))
      (pre-principal (contract-of pre))
      (pre-id (map-get? pre-contracts pre-principal))
      (pre-info (match pre-id
                    id (map-get? dexes id)
                    none))
    )
    (match pre-info
        info (let ((claimed-amount (try! (contract-call? pre claim-on-behalf token tx-owner))))
                (print {
                    type: "claim",
                    sender: tx-owner,
                    amount-claimed: claimed-amount,
                    pre-contract: pre-principal
                })
                (ok claimed-amount))
        ERR_POOL_NOT_FOUND)))

(define-public (process-fee-airdrop
    (pre <pre-trait>))
  (let (
      (pre-principal (contract-of pre))
      (pre-id (map-get? pre-contracts pre-principal))
      (pre-info (match pre-id
                    id (map-get? dexes id)
                    none))
    )
    (match pre-info
        info (let ((total-distributed (try! (contract-call? pre trigger-fee-airdrop))))
                (print {
                    type: "fee-airdrop",
                    pre-contract: pre-principal,
                    total-distributed: total-distributed,
                    timestamp: burn-block-height
                })
                (ok total-distributed))
        ERR_POOL_NOT_FOUND)))