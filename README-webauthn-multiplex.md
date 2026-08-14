# juice-safe-v6 WebAuthn challenge multiplex (H-01)

## TLDR

One real passkey tap authorizes many wallet operations. The deployed
`SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-safe-v6` verifies that the
expected operation hash appears *somewhere* inside the signed WebAuthn
`clientDataJSON`. It does not verify that the hash *is* the challenge field. So
one browser signature over a long challenge that holds three operation hashes
end to end passes three times, once per hash.

Proven end to end on the deployed bytes: one signature, three distinct
`stx-transfer` calls, 60 STX drained in one gesture.

- Sim: `simul-juice-safe-v6-webauthn-multiplex.js`
- Result: https://stxer.xyz/simulations/mainnet/66bdfc760dd9cdb55decadd6e22445ff
- 13/13 checks pass.

## The mechanism

A passkey signature covers `sha256(authenticatorData || sha256(clientDataJSON))`.
The browser fixes `clientDataJSON`. It looks like this:

```
{"type":"webauthn.get","challenge":"<base64url(challenge-bytes)>","origin":"https://juiceofbtc.com","crossOrigin":false}
```

The contract cannot store the whole JSON on chain, so it rebuilds it from three
caller-supplied parts. See `clarity-5-webauthn-v3.clar:87-93`:

```clarity
(define-read-only (compute-client-data-hash
    (challenge (buff 32))
    (client-data-prefix (buff 128))
    (client-data-suffix (buff 512)))
  (sha256 (concat client-data-prefix (concat (base64url-32 challenge) client-data-suffix))))
```

`challenge` is the 32-byte operation hash the wallet expects. `client-data-prefix`
and `client-data-suffix` are supplied by the CALLER. The function proves only
that `base64url-32(challenge)` sits between the two parts. It never proves that
this 43-char string is the challenge field of a well-formed `clientDataJSON`.

`juice-safe-v6.clar:1198-1204` forwards the caller parts straight into the
verifier. `juice-safe-v6.clar:1220-1223` keys the replay map on the operation
hash alone:

```clarity
(asserts! (is-none (map-get? used-pubkey-authorizations message-hash)) err-signature-replay)
(map-set used-pubkey-authorizations message-hash pubkey)
```

## The attack

Let `m1`, `m2`, `m3` be three real operation hashes. Let `hi = base64url(mi)`
(43 chars each). The attacker frontend asks the browser to sign a challenge whose
base64url form is:

```
h1 || "A" || h2 || "A" || h3            (131 chars, one "A" filler between hashes)
```

The browser signs one `clientDataJSON` once. For each `mi` the attacker picks a
different split so that `prefix_i || hi || suffix_i` equals the SAME signed
bytes:

| op | prefix len | suffix len | operation |
|----|-----------:|-----------:|-----------|
| m1 | 36 | 144 | stx-transfer 10 STX -> SINK1 |
| m2 | 80 | 100 | stx-transfer 20 STX -> SINK2 |
| m3 | 124 | 56 | stx-transfer 30 STX -> SINK3 |

All prefixes fit `(buff 128)`. All suffixes fit `(buff 512)`. Every split
reconstructs the identical signed bytes, so the one authenticator-data and the
one signature verify three times. The three hashes are different, so each lands
on its own fresh key in `used-pubkey-authorizations`. The user approved once.
Three operations executed.

## What the sim proves

Run:

```
node simul-juice-safe-v6-webauthn-multiplex.js
```

Steps on the stxer mainnet fork:

1. Exercise the already deployed `juice-safe-v6` (bytecode equals the repo copy).
2. Onboard it with a made-up P-256 passkey (the sim acts as the browser).
3. Build one assertion whose challenge holds all three operation hashes.
4. Fire three `stx-transfer` calls, one per split, from a relayer address.
5. Read-only cross-check: `verify-signature` returns `(ok true)` for all three
   splits against the same signature.
6. Control: replay op#1 unchanged. It returns `(err u4006)`.

Observed:

```
verify-signature op#1/2/3  -> (ok true)   (one signature, three splits)
DRAIN #1  10 STX -> SINK1   -> (ok true)
DRAIN #2  20 STX -> SINK2   -> (ok true)
DRAIN #3  30 STX -> SINK3   -> (ok true)
safe drained by exactly 60 STX
CONTROL replay op#1 verbatim -> (err u4006) signature-replay
```

The control matters. The per-hash guard DOES stop an exact repeat. It never fired
across the three DIFFERENT hashes. The map counts hashes, not gestures. That gap
is the bug.

## Impact

The passkey is the wallet's second factor. This breaks the one-tap / one-operation
binding. A malicious or compromised frontend, or any qualifying origin allowed to
drive the credential, can pre-stage several operations behind one user gesture.
Every path that routes through `consume-signature` is in scope: transfers, config
changes, ownership transfer, recovery, veto, immediate-execute, stacking. No key
theft and no signature forgery are needed.

## Related: M-02, unvalidated client-data context

`verify-signature` checks the rp-id hash and the UV flag only. Neither the wallet
nor `clarity-5-webauthn-v3` validates `type`, `origin`, `crossOrigin`, or
`topOrigin`. Those bytes are opaque caller input. A credential scoped to rp-id
`juiceofbtc.com` can be driven from a qualifying subdomain, and the contract still
accepts the assertion. This is independent of H-01 and also widens it.

---

# How to fix it completely

The real fix is one thing: exact challenge-boundary verification. Force
`base64url-32(message-hash)` to be the WHOLE challenge field, not a substring of
the signed bytes. Do that and one signature decodes to exactly one operation, the
one the frontend committed to and the app showed. The multiplex is then
impossible, not just capped, and one tap / one intended operation is restored.
This is Layer 1 below.

The other two ideas are hardening, not the fix. The assertion replay-key (Layer
2) only caps three unintended operations at one unintended operation, attacker's
choice. The origin/type checks (Layer 3) close a separate weakness (M-02). Ship
them on top of Layer 1, never in place of it. Do not ship Layer 2 or a character
cap and call it fixed.

## Layer 1 (root cause): anchor the challenge to its JSON field

The verifier must prove that `base64url-32(challenge)` is the challenge field,
not just a substring. The base64url alphabet is `A-Z a-z 0-9 - _`. It can never
contain a double quote. So the quote characters are reliable field delimiters.

Require both boundaries:

- `client-data-prefix` ENDS WITH the exact bytes `"challenge":"`
  (`0x226368616c6c656e6765223a22`, 13 bytes).
- `client-data-suffix` STARTS WITH `"` (`0x22`), the closing quote.

Where it goes: in the SAFE, not the library. The check only inspects the
caller-supplied prefix and suffix buffers. It never touches the crypto, so it
does not belong in the signature library. And it cannot go there anyway,
because `clarity-5-webauthn-v3` is deployed and immutable. It ships as three
asserts inside the safe's own `verify-signature`, in the next wallet version.

Diff against `juice-safe-v7.clar` verify-signature:

```diff
     (asserts!
       (contract-call? 'SPV9K21...clarity-5-webauthn-v3
         is-user-verified authenticator-data)
       err-invalid-signature)
+    ;; H-01 fix: the reconstructed hash must BE the challenge field, not just a
+    ;; substring of the signed clientDataJSON. base64url contains no '"', so the
+    ;; two quotes pin the challenge to EXACTLY one 32-byte value:
+    ;;   prefix must end at   ..."challenge":"   and suffix must begin at   "...
+    ;; A 131-char h1||A||h2||A||h3 challenge then fails: the byte after the hash
+    ;; is 'A', not '"'. One signature now decodes to exactly one operation.
+    (asserts! (>= (len client-data-prefix) u13) err-invalid-signature)
+    (asserts! (is-eq
+      (slice? client-data-prefix (- (len client-data-prefix) u13) (len client-data-prefix))
+      (some 0x226368616c6c656e6765223a22))          ;; "challenge":"
+      err-invalid-signature)
+    (asserts! (is-eq (element-at? client-data-suffix u0) (some 0x22))  ;; closing "
+      err-invalid-signature)
     (ok (asserts!
       (contract-call? 'SPV9K21...clarity-5-webauthn-v3
         verify-webauthn-signature pubkey message-hash authenticator-data
         client-data-prefix client-data-suffix signature)
       err-invalid-signature))
```

The three asserts:

1. `len prefix >= 13` guards the subtraction so it cannot underflow and panic.
2. prefix ends with `"challenge":"` (`0x226368616c6c656e6765223a22`, 13 bytes).
3. suffix first byte is `"` (`0x22`).

Together they force the signed bytes to read `..."challenge":"<43-char hash>"...`,
so the challenge field is exactly one 32-byte hash. Every multiplex split fails:
op#1's suffix starts with `A`, op#2 and op#3's prefix ends with `...hA`, not
`"challenge":"`. The one split whose hash IS the challenge is the only one that
passes.

Note on scope: anchoring keeps the suffix flexible after the closing quote, so
origin length and optional fields still vary per browser. It only removes the
freedom to slide the challenge boundary. That flexibility is why the split design
existed. Keep it.

If you prefer every wallet to inherit the fix, put the same asserts in a new
`clarity-5-webauthn-v4` and point future wallets at it. Not required. The safe-side
diff above is the complete fix on its own.

## Layer 2 (impact cap): key replay on the assertion, not just the hash

Record a digest of the assertion so one gesture is cashable exactly once, even if
a future boundary bug reappears. This is what the repo's `juice-safe-v7`
(NOT deployed, HTTP 404 on mainnet) already adds:

```clarity
(define-map used-assertions (buff 32) bool)
;; in consume-signature:
(let ((assertion-id (sha256 (concat authenticator-data signature))))
  ...
  (asserts! (is-none (map-get? used-assertions assertion-id)) err-signature-replay)
  (map-set used-assertions assertion-id true))
```

Read this honestly, because the cap is weaker than it looks. `used-assertions`
lowers the count from three operations to one. It does NOT restore intent.

The user taps once. The app showed them ONE operation, say a 10 STX transfer, so
they believe they approved `m1`. The compromised frontend put `m1`, `m2`, `m3`
in the challenge. The authenticator prompt does not show the challenge contents,
so the user cannot see the other two. With Layer 2 the attacker still gets to
pick WHICH of the three cashes. The attacker cashes `m3`, an ownership transfer,
or a recovery, and drops the `m1` the user actually wanted. The one gesture the
user made for a small transfer becomes one operation of the attacker's choosing
that the user never saw.

So Layer 2 does NOT remove the gain. It caps three unintended operations at one
unintended operation. It also does not repair the substring match and does not
address M-02. v7's own header comment says as much. Layer 2 is a mitigation, not
the fix. Only Layer 1 restores one tap / one intended operation, because it
forces the single signed challenge to equal exactly the one hash the frontend
committed to and the app displayed. Ship Layer 2 with Layer 1, never instead of
it.

## Layer 3 (M-02): validate type / origin / crossOrigin

Fold these into the same exact verification:

- `client-data-prefix` STARTS WITH `{"type":"webauthn.get","challenge":"`. This
  validates `type` and, combined with Layer 1, pins the whole opener.
- `client-data-suffix` CONTAINS the exact `","origin":"https://juiceofbtc.com"`
  and the expected `crossOrigin` value.

For a single-RP wallet the two facts above collapse into one strict check: pin
`client-data-prefix` to the exact 36-byte constant
`{"type":"webauthn.get","challenge":"`. That validates the type and anchors the
challenge start in one assert. Pair it with an origin allowlist check on the
suffix.

## On "just limit the character amounts"

This does not fix it. The current bounds are already `(buff 128)` and
`(buff 512)`, and the whole attack fits inside them (max prefix 124, max suffix
144). Tightening the caps only forces the attacker to use fewer hashes per
signature. It does not stop two.

You also cannot bound the challenge string length to block it, because the
contract never sees the whole challenge. It only reconstructs a 43-char slice of
it. The full challenge length is off chain.

The one length idea that DOES work is not a cap, it is a PIN: fix
`client-data-prefix` to exactly 36 bytes AND to the exact canonical constant.
That is really Layer 1 plus Layer 3 expressed as a fixed template. It is complete
but stricter. It only accepts a canonical, `type`-first `clientDataJSON`, which
every major browser emits, but some non-browser authenticators may not.

## Recommended fix

Ship all three layers in the next wallet version:

1. Anchor the challenge boundaries (Layer 1). Root cause.
2. Key replay on the assertion digest (Layer 2). Impact cap and defense in depth.
3. Validate type and origin (Layer 3). Closes M-02.

Regression tests to add:

- A valid single 32-byte challenge passes.
- A 131-char challenge holding three 43-char hashes fails on every split except
  the true one.
- Shifted prefix/suffix splits fail.
- One assertion reused on two different operation hashes fails.
- An assertion with a non-allowlisted origin fails.

## Status

- `juice-safe-v6`: deployed, vulnerable, exercised by the sim above.
- `juice-safe-v7`: repo only, not deployed. Adds Layer 2 (`used-assertions`).
  Does not add Layer 1 or Layer 3.
- `clarity-5-webauthn-v3`: deployed, immutable. Holds the substring match. A
  `v4` with Layer 1 does not exist yet.
