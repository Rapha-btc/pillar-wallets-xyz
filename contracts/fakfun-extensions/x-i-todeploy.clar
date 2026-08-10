(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.extension-trait.extension-trait)

(define-constant err-bad-payload (err u8001))

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