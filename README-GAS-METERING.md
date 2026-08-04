# Gas metering and the gas fuse

Why `juice-safe-v3` and `fakfun-wallet-v12` exist, what changed, and - more
useful for whoever reads this next - which two obvious fixes were tried first
and why both were wrong.

Applies to:

- `contracts/juice-safe-v3.clar` (supersedes `juice-safe-v2`, 15 gas sites)
- `contracts/fakfun-wallet-v12.clar` (supersedes `fakfun-wallet-v11`, 27 gas sites)

Both carry the identical design. Everything else in each file is its
predecessor verbatim; only `register-wallet`'s argument changes, to name the new
contract.

## The gap

Every gasless call takes an optional gas station:

```clarity
(match gas
  g (try! (as-contract?
    ((with-ft SBTC-CONTRACT "sbtc-token" (var-get max-gas-amount)))
    (try! (contract-call? g pay-gas))))
  true)
```

That is sBTC leaving the wallet, and it was the **one outflow that touched no
counter at all**. Transfers were metered against `sbtc-threshold`; fees were
not metered against anything.

Two properties make that worse than it sounds:

1. **The station is caller-supplied and is not bound by the signed hash.**
   Whoever relays the call picks which contract gets paid. No phishing needed,
   no passkey compromise - only control of the relay.
2. **`max-gas-amount` is a per-call bound, not a total.** Nothing capped how
   many calls, so the skim was bounded only by how often the user acts.

`v2` and `v11` had already narrowed the blast radius - `MAX-GAS-CEILING`
u10000, `max-gas-amount` moved behind the wallet cooldown - but the fee itself
was still unmetered.

## What v3 / v12 do

**Meter it.** `pay-gas-accounted` measures the fee as the wallet's own sBTC
**balance delta** across the call:

```clarity
(let ((before (try! (contract-call? SBTC-CONTRACT get-balance current-contract))))
  (try! (as-contract? ((with-ft SBTC-CONTRACT "sbtc-token" (var-get max-gas-amount)))
    (try! (contract-call? g pay-gas))))
  (let ((after (try! (contract-call? SBTC-CONTRACT get-balance current-contract)))
        (fee  (if (> before after) (- before after) u0)))
    ...))
```

Not `<gas-trait>`'s `get-gas-amount`: the station is caller-supplied, so
anything it reports about itself is unverified. The delta is what actually
left. A station that somehow sends sBTC *in* is charged `u0` rather than
underflowing - credits do not refill the budget.

**Fuse it.** A third counter, `gas`, on `spent-this-period`, capped at:

```clarity
(define-constant GAS-CALLS-PER-PERIOD u25)
(define-private (max-gas-per-period)
  (* (var-get max-gas-amount) GAS-CALLS-PER-PERIOD))
```

Derived rather than a flat sat constant on purpose. The cap is really "25
gasless calls per period" whatever a single fee costs, and it tracks
`max-gas-amount` upward - a flat constant would silently tighten into a brick
wall every time `max-gas-amount` rose. That is safe because raising
`max-gas-amount` is itself two-step and cooldown-gated
(`propose-max-gas-amount` / `confirm-max-gas-amount`).

Over the fuse, the call reverts with `err-threshold-exceeded` (u4018).

## Two rejected designs

Recorded because both look like improvements and neither is.

### Rejected: gate the fee on `sbtc-threshold`

The first attempt. It makes `sbtc-threshold` mean "total sBTC out per period,
fees included", which sounds right.

It turns `sbtc-threshold` into a **global gasless kill-switch**. Only 4 of 15
enforced paths on the Juice safe move sBTC at all (fewer proportionally on
v12). The rest - `unstake`, `veto-operation`, `sip009-transfer`,
`stx-transfer`, `extension-call`, every `faktory-*` - spend no sBTC. One large
under-threshold transfer leaves a few sats of headroom, and the next unstake
reverts on a budget it had no part in spending.

### Rejected: merely *count* the fee in `sbtc`

Subtler, and the one most likely to get "fixed" back in. Keep the fuse, but
also add the fee to the `sbtc` ledger so the total stays honest.

It buys **no safety** - the fee is already capped by the fuse, so the second
count can only ever bite after the first one already would have - while
quietly spending the transfer budget. 25 calls at the u1000 default is a
quarter of the u100000 default threshold, so sBTC transfers start queuing as
pending ops early, for a reason the user cannot see.

So `gas` and `sbtc` are **disjoint**. Each counter has exactly one writer:

| Counter | Written by | Capped against |
|---|---|---|
| `stx` | `add-spent-stx` | `stx-threshold` (queue or execute) |
| `sbtc` | `add-spent-sbtc` | `sbtc-threshold` (queue or execute) |
| `gas` | `add-spent-gas` | `max-gas-per-period` (revert) |

Consequence for any UI: **neither counter alone is "sBTC out this period."**
That total is `(+ sbtc gas)`, and it reads better as two numbers - what you
sent, versus what you paid to relay.

## A blown fuse is not a lockout

This is the part worth internalising before tuning anything.

`gas` is `(optional <gas-trait>)` on **every** entry point (15 on v3, 27 on
v12) and required on **none**. Blowing the fuse blocks exactly one thing: calls
where somebody else broadcasts and takes an sBTC fee. Two ways through without
waiting:

1. **Self-broadcast with `gas: none`.** The passkey signature still authorises
   it - `sig-auth` and `gas` are independent parameters. `pay-gas-accounted` is
   never called, so the assert is unreachable. You pay the STX tx fee instead.
2. **Admin EOA with no `sig-auth`.** Takes the `(is-authorized none)` branch,
   pays no gas, never reaches the assert.

You only genuinely wait if you have zero STX anywhere *and* need a relayed
call. Then it clears when the period rolls: `cooldown-period` blocks, u144
(~1 day) by default.

A related property worth knowing: the functions with **no** `sig-auth`
parameter take **no gas parameter either**. Not one. So gas is reachable only
through a signed call, which means a compromised admin key *alone* cannot drain
via fees - it needs the passkey too.

## `GAS-ENFORCED` vs `GAS-EXEMPT`

The qualifying test for an exemption is **"cannot loop"**, not "is important".

Every gasless surface can otherwise loop: a compromised passkey mints a fresh
`auth-id`, gets a fresh `message-hash`, and sails past the
`used-pubkey-authorizations` replay check. `veto-operation` is the sharpest
case - it only asserts the op is unexecuted, so one stale pending op can be
re-vetoed indefinitely, each iteration skimming to a station the attacker
picks.

`confirm-transfer-wallet` is the sole exemption, on both contracts. It still
**counts** its fee; it just never reverts on it.

**The exemption is airtight on v3 and weaker on v12.** On `juice-safe-v3`,
passkeys are fixed at onboard, so after a transfer the old pubkey maps to a
non-admin, `is-admin-pubkey` fails, and no further gasless call of any kind is
possible - genuinely single-shot. `fakfun-wallet-v12` keeps
`propose-admin-pubkey` / `confirm-admin-pubkey`, so a new owner can register a
passkey and reopen the surface. The loop is not impossible there, only
expensive: a full admin-pubkey propose/confirm cooldown plus a
`propose-transfer-wallet` per iteration. If that is judged too loose, it is a
one-word flip at that call site.

## Known rough edges

Neither is a regression - both are inherited - but both interact with the fuse.

**u25 may be tight for v12.** It is a trading wallet: `faktory-execute`,
`faktory-place-order`, `faktory-process`, `faktory-nft-execute`. 25 relayed
calls in a day is plausible for an active user hitting the fuse *legitimately*.
On the Juice safe (staking, rare actions) u25 is generous. Consider raising
`GAS-CALLS-PER-PERIOD` on v12 before it sees heavy trading use.

**`cooldown-period` now does triple duty** - pending-op delay, spend window,
*and* gas-fuse window. Raising it for stronger veto protection silently starves
the fuse: set it to u1008 for a week-long veto window and you get 25 relayed
calls **per week**. This is the same shape of coupling the rejected designs
above were rejected for, and it was pre-existing for the spend window. Worth
deciding whether the fuse should get its own window constant instead of
borrowing that one.

## Deploying

`register-wallet` is a hash check, not a name check
(`fakfun-wallet-core.clar`):

```clarity
(define-public (register-wallet (contract principal))
  (let ((caller-hash   (unwrap-panic (contract-hash? contract-caller)))
        (verified-hash (map-get? verified-contracts contract)))
    (asserts! (is-some verified-hash) err-not-authorized)
    (asserts! (is-eq (some caller-hash) verified-hash) err-invalid-contract-hash)
    ...))
```

A user's wallet proves it is an unmodified copy by having the same contract
hash as the canonical it names. So a new version needs **two** steps, in order:

1. Deploy the canonical (`juice-safe-v3` / `fakfun-wallet-v12`).
2. `set-verified-contract` on it, by the core DEPLOYER, which records its hash.

Skip step 2 and every `onboard` fails with `err-not-authorized`. Name the wrong
contract in `register-wallet` and it fails with `err-invalid-contract-hash`
(u6002) - that is exactly how `fakfun-wallet-v9` bricked itself by naming
`.fakfun-wallet-v8`, and why v10 exists. Both new files were bumped to name
themselves; that is the only functional difference from their predecessors.

Deployed source is the **comment-stripped** copy generated into
`faktory-dao/backend/server/utils/*-template.ts`. The `.clar` files here are
the commented source of truth and will not hash-match the chain - that is fine,
because per-user deploys and the canonical both come from the same TS constant.
Editing a template without redeploying and re-verifying breaks onboard for
every new wallet of that version.
