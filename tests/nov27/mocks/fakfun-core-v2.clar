(use-trait pool-trait 'SP2ZNGJ85ENDY6QRHQ5P2D4FXKGZWCKTB2T0Z55KS.dexterity-traits-v0.liquidity-pool-trait)
(use-trait dex-trait 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.faktory-dex-trait-v2.dex-trait)
(use-trait pre-trait 'SP29D6YMDNAKN1P045T6Z817RTE1AC0JAA99WAX2B.prelaunch-faktory-trait.prelaunch-trait)
(use-trait token-trait 'SP3XXMS38VTAWTVPE5682XSBFXPTH7XCPEBTX8AN2.faktory-trait-v1.sip-010-trait)
(define-public (execute
    (pool-contract <pool-trait>)
    (amount uint)
    (opcode (optional (buff 16)))) (if true (ok {dx: u0, dy: u0}) (err u999)))
(define-public (place-order
    (dex <dex-trait>)
    (token <token-trait>)
    (amount uint)
    (opcode (optional (buff 16)))) (if true (ok {dx: u0, dy: u0}) (err u999)))
(define-public (process
    (pre <pre-trait>)
    (seat-count uint)
    (owner (optional principal))
    (opcode (optional (buff 16)))) (if true (ok {dx: u0, dy: u0}) (err u999)))
(define-public (process-claim
    (pre <pre-trait>)
    (token <token-trait>)
    (owner (optional principal))) (if true (ok {dx: u0, dy: u0}) (err u999)))
(define-public (process-fee-airdrop
    (pre <pre-trait>)) (if true (ok {dx: u0, dy: u0}) (err u999)))
