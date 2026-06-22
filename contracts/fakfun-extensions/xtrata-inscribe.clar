;; xtrata-inscribe
;; A fakfun-wallet extension that ANY fakfun-wallet-v2 can whitelist and drive
;; through its generic `extension-call`. Inscribes content (a tweet, a short
;; article -- anything that fits the 2 KB payload) on-chain via Xtrata's one-shot
;; `mint-single-tx`. Content-agnostic; the wallet, not this contract, owns auth.
;;
;; HOW THE WALLET DRIVES THIS (no changes to the wallet are needed):
;;   1. owner calls `whitelist-extension` then `execute-pending-whitelist`
;;      (passkey-signed) once, to approve this contract.
;;   2. owner calls `extension-call <this> <payload> <sig-auth> <gas>`.
;;      The wallet verifies the passkey signature over the payload
;;      (build-extension-call-hash), pays gas, then runs:
;;         (as-contract? ((with-all-assets-unsafe))
;;           (contract-call? <this> call payload))
;;
;; Because of that `as-contract?`, when we call Xtrata below tx-sender IS the
;; wallet: the STX inscribe fee is pulled from the wallet and the minted
;; article NFT is owned by the wallet. We therefore do NOT re-check auth or pay
;; gas -- the wallet already did. We only decode the payload and forward it.
;;
;; SECURITY: `call` is intentionally open. Invoked directly (not via a wallet's
;; as-contract), tx-sender is the direct caller, so THEY pay the fee and receive
;; the NFT -- no wallet funds are reachable. Wallet funds move only when a
;; wallet invokes us through its passkey-gated `extension-call`.
;;
;; PAYLOAD: the (buff 2048) the wallet forwards is a consensus-serialized tuple
;; of Xtrata `mint-single-tx` args. The 2048-byte cap is what bounds this to
;; tweet/short-post size -- it cannot carry Xtrata's full 512 KiB one-shot
;; payload (that needs a dedicated wallet method, not the generic extension door).

(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.extension-trait.extension-trait)

(define-constant err-bad-payload (err u8001))

;; Encode off-chain with to-consensus-buff? over exactly this shape.
(define-public (call (payload (buff 2048)))
  (let ((args (unwrap!
      (from-consensus-buff?
        {
          expected-hash: (buff 32),
          mime: (string-ascii 64),
          total-size: uint,
          chunks: (list 32 (buff 16384)),
          token-uri-string: (string-ascii 256),
        }
        payload
      )
      err-bad-payload
    )))
    (try! (contract-call? 'SP3JNSEXAZP4BDSHV0DN3M8R3P0MY0EEBQQZX743X.xtrata-v3-2-3
      mint-single-tx
      (get expected-hash args)
      (get mime args)
      (get total-size args)
      (get chunks args)
      (get token-uri-string args)
    ))
    (ok true)
  )
)
