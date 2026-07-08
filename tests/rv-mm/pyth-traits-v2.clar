;; RV trait copies: pyth storage + decoder (shapes the wallet's use-trait needs).
(define-trait storage-trait
  ((read-price-feed ((buff 32)) (response
    { price: int, conf: uint, expo: int, ema-price: int, ema-conf: uint,
      publish-time: uint, prev-publish-time: uint } uint))))

(define-trait decoder-trait
  ((decode-and-verify ((buff 8192) principal) (response (list 64
    { price-identifier: (buff 32), price: int, conf: uint, expo: int,
      ema-price: int, ema-conf: uint, publish-time: uint, prev-publish-time: uint }) uint))))
