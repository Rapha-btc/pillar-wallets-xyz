# Migrating from clarity-5-webauthn-v3 to v4

- v3: `SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.clarity-5-webauthn-v3`
- v4: `SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.clarity-5-webauthn-v4`

## What changed

One check was added. v4 verifies exactly what v3 does, and also requires that
the signed operation hash **is** the `challenge` field of the clientDataJSON,
not just somewhere inside it:

- `client-data-prefix` must be exactly `{"type":"webauthn.get","challenge":"`
  (`0x7b2274797065223a22776562617574686e2e676574222c226368616c6c656e6765223a22`)
- `client-data-suffix` must start with the closing quote `"`

See `challenge-is-anchored` in `contracts/clarity-5-webauthn-v4.clar`.

Why: with v3, a caller could slide the prefix/suffix split across one long
challenge holding several operation hashes, so one passkey gesture could
authorize several operations ("challenge multiplexing", H-01). Full write-up
and mainnet-fork proof: [README-webauthn-multiplex.md](README-webauthn-multiplex.md).

## Do clients need to change?

No. Function names, arguments and the wire format are unchanged:
`challenge`, `authenticator-data`, `client-data-prefix`, `client-data-suffix`,
`signature`, `public-key`.

Browsers already produce clientDataJSON in the anchored shape
(`{"type":"webauthn.get","challenge":"<43 chars>","origin":...}`). A client
that splits the JSON at the challenge, which is the normal way, works with v4
as is. Only a client that put extra bytes around the challenge (the
multiplex pattern) is refused.

## What about wallets already deployed on v3?

Contracts are immutable, so a wallet deployed against v3 keeps calling v3.
It cannot be switched in place.

| Calls v3 (older templates) | Calls v4 (current templates) |
|---|---|
| fakfun-wallet-v2 to v16 | fakfun-wallet-v17 and later |
| juice-safe-v0 to v6 | juice-safe-v7 and later |
| jing-mm-safe, pillar-safe | juice-autostake-safe |

Users on a v3 wallet move to a v4 wallet: create a new safe on the current
template, then send the funds from the old wallet to it (one signed transfer
per asset, from the frontend the wallet was made with). We are moving the
remaining v3 users to v4 safes.

## For new integrations

Call v4. Use the same split you used for v3: prefix = everything before the
challenge value, challenge = the 32-byte operation hash, suffix = everything
from the closing quote onward. Keep binding the operation hash to your wallet
with SIP-018 domain data, and keep a replay map on the operation hash.
