;; zero-authority-bounties
;; A fakfun-wallet extension that ANY fakfun-wallet (v8+) can drive through its
;; generic `extension-call` to operate on Zero Authority DAO's bounties contract
;; SP2GW18TVQR75W1VT53HYGBRGKFRV5BFYNAF5SS5J.ZADAO-V2-token-bounties.
;;
;; HOW THE WALLET DRIVES THIS (no changes to the wallet are needed once whitelisted):
;;   1. owner whitelists this contract once -- or it ships PRE-whitelisted in the
;;      v8 template's `onboard` (no 2-step whitelist, no 24h cooldown).
;;   2. owner calls `extension-call <this> <payload> <sig-auth> <gas>`.
;;      The wallet verifies the passkey signature over the payload
;;      (build-extension-call-hash), pays gas, then runs:
;;         (as-contract? ((with-all-assets-unsafe))
;;           (contract-call? <this> call payload))
;;
;; Because of that `as-contract?`, when we call ZADAO below tx-sender IS the
;; wallet: the bounty stake is pulled from the wallet, the payout/refund flows
;; from the wallet's bounty, and the wallet is recorded as creator/submitter.
;; We therefore do NOT re-check auth or pay gas -- the wallet already did. We
;; only decode the payload and forward it.
;;
;; SECURITY: `call` is intentionally open (extension-trait requires it). Invoked
;; directly (not via a wallet's as-contract), tx-sender is the direct caller, so
;; THEY stake/receive -- no wallet funds are reachable. Wallet funds move only
;; when a wallet invokes us through its passkey-gated `extension-call`.
;;
;; THE TOKEN-TRAIT CONSTRAINT: ZADAO's create-bounty / accept-submission /
;; redeem-fund all take a SIP-010 `<token>` TRAIT argument. The generic
;; extension door is `call (payload (buff 2048))` -- a buff cannot carry a trait
;; reference, and a principal decoded from a buff cannot be used as a
;; contract-call target. So we hard-code the ZADAO-whitelisted FUNGIBLE tokens
;; as literals and dispatch on a `token-id` field in the payload. The 9
;; non-fungible entries in ZADAO-token-whitelist-v1 cannot satisfy <token> and
;; are intentionally excluded. New ZADAO tokens => a new version of this
;; extension (mirrors ZADAO keeping its whitelist in a separate contract).
;;
;; PAYLOAD: the (buff 2048) the wallet forwards is `to-consensus-buff?` of the
;; tuple below. `op` selects the action; unused fields are ignored per op:
;;   op "create" -> create-bounty amount title bounty-id <token-id>
;;   op "submit" -> submit-entry bounty-id
;;   op "accept" -> accept-submission bounty-id submitter <token-id>
;;   op "toggle" -> open-close-bounty bounty-id
;;   op "redeem" -> redeem-fund bounty-id <token-id>

(use-trait ft 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.extension-trait.extension-trait)

(define-constant err-bad-payload (err u8001))
(define-constant err-unknown-op (err u8002))
(define-constant err-unsupported-token (err u8003))

;; Encode off-chain with to-consensus-buff? over exactly this shape.
(define-public (call (payload (buff 2048)))
  (let ((a (unwrap!
      (from-consensus-buff?
        {
          op: (string-ascii 8),
          bounty-id: (string-ascii 36),
          amount: uint,
          title: (string-ascii 200),
          token-id: principal,
          submitter: principal,
        }
        payload
      )
      err-bad-payload
    )))
    (let ((op (get op a)))
      (if (is-eq op "submit")
        (begin
          (try! (contract-call? 'SP2GW18TVQR75W1VT53HYGBRGKFRV5BFYNAF5SS5J.ZADAO-V2-token-bounties
            submit-entry (get bounty-id a)
          ))
          (ok true)
        )
        (if (is-eq op "toggle")
          (begin
            (try! (contract-call? 'SP2GW18TVQR75W1VT53HYGBRGKFRV5BFYNAF5SS5J.ZADAO-V2-token-bounties
              open-close-bounty (get bounty-id a)
            ))
            (ok true)
          )
          ;; create / accept / redeem -- all need the <token> trait
          (dispatch-token op (get token-id a) (get bounty-id a) (get amount a)
            (get title a) (get submitter a)
          )
        )
      )
    )
  )
)

;; Resolve the payload's token-id principal to a hard-coded SIP-010 literal
;; (the only way to obtain a <token> trait reference inside a buff-only door),
;; then hand the resolved trait to `route`. Covers every FUNGIBLE token enabled
;; in ZADAO-token-whitelist-v1 at deploy time.
(define-private (dispatch-token
    (op (string-ascii 8))
    (token-id principal)
    (bounty-id (string-ascii 36))
    (amount uint)
    (title (string-ascii 200))
    (submitter principal)
  )
  (if (is-eq token-id 'SP32AEEF6WW5Y0NMJ1S8SBSZDAY8R5J32NBZFPKKZ.wstx)
    (route op 'SP32AEEF6WW5Y0NMJ1S8SBSZDAY8R5J32NBZFPKKZ.wstx bounty-id amount title submitter)
  (if (is-eq token-id 'SP3NE50GEXFG9SZGTT51P40X2CKYSZ5CC4ZTZ7A2G.welshcorgicoin-token)
    (route op 'SP3NE50GEXFG9SZGTT51P40X2CKYSZ5CC4ZTZ7A2G.welshcorgicoin-token bounty-id amount title submitter)
  (if (is-eq token-id 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-token)
    (route op 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-token bounty-id amount title submitter)
  (if (is-eq token-id 'SP1JFFSYTSH7VBM54K29ZFS9H4SVB67EA8VT2MYJ9.gus-token)
    (route op 'SP1JFFSYTSH7VBM54K29ZFS9H4SVB67EA8VT2MYJ9.gus-token bounty-id amount title submitter)
  (if (is-eq token-id 'SP1AY6K3PQV5MRT6R4S671NWW2FRVPKM0BR162CT6.leo-token)
    (route op 'SP1AY6K3PQV5MRT6R4S671NWW2FRVPKM0BR162CT6.leo-token bounty-id amount title submitter)
  (if (is-eq token-id 'SP3D6PV2ACBPEKYJTCMH7HEN02KP87QSP8KTEH335.mega)
    (route op 'SP3D6PV2ACBPEKYJTCMH7HEN02KP87QSP8KTEH335.mega bounty-id amount title submitter)
  (if (is-eq token-id 'SP32AEEF6WW5Y0NMJ1S8SBSZDAY8R5J32NBZFPKKZ.nope)
    (route op 'SP32AEEF6WW5Y0NMJ1S8SBSZDAY8R5J32NBZFPKKZ.nope bounty-id amount title submitter)
  (if (is-eq token-id 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-abtc)
    (route op 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-abtc bounty-id amount title submitter)
  (if (is-eq token-id 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.usda-token)
    (route op 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.usda-token bounty-id amount title submitter)
  (if (is-eq token-id 'SP2C1WREHGM75C7TGFAEJPFKTFTEGZKF6DFT6E2GE.kangaroo)
    (route op 'SP2C1WREHGM75C7TGFAEJPFKTFTEGZKF6DFT6E2GE.kangaroo bounty-id amount title submitter)
  (if (is-eq token-id 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token)
    (route op 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token bounty-id amount title submitter)
  (if (is-eq token-id 'SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc)
    (route op 'SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc bounty-id amount title submitter)
  (if (is-eq token-id 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.auto-alex-v2)
    (route op 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.auto-alex-v2 bounty-id amount title submitter)
  (if (is-eq token-id 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.age000-governance-token)
    (route op 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.age000-governance-token bounty-id amount title submitter)
  (if (is-eq token-id 'SPN5AKG35QZSK2M8GAMR4AFX45659RJHDW353HSG.usdh-token-v1)
    (route op 'SPN5AKG35QZSK2M8GAMR4AFX45659RJHDW353HSG.usdh-token-v1 bounty-id amount title submitter)
    err-unsupported-token
  )))))))))))))))
)

;; Given a resolved <token> trait, forward to the correct ZADAO function.
;; All branches normalise to (response bool uint).
(define-private (route
    (op (string-ascii 8))
    (tok <ft>)
    (bounty-id (string-ascii 36))
    (amount uint)
    (title (string-ascii 200))
    (submitter principal)
  )
  (if (is-eq op "create")
    (begin
      (try! (contract-call? 'SP2GW18TVQR75W1VT53HYGBRGKFRV5BFYNAF5SS5J.ZADAO-V2-token-bounties
        create-bounty amount title bounty-id tok
      ))
      (ok true)
    )
    (if (is-eq op "accept")
      (contract-call? 'SP2GW18TVQR75W1VT53HYGBRGKFRV5BFYNAF5SS5J.ZADAO-V2-token-bounties
        accept-submission bounty-id submitter tok
      )
      (if (is-eq op "redeem")
        (contract-call? 'SP2GW18TVQR75W1VT53HYGBRGKFRV5BFYNAF5SS5J.ZADAO-V2-token-bounties
          redeem-fund bounty-id tok
        )
        err-unknown-op
      )
    )
  )
)
