# Smart router registry - design decision

`fakfun-smart-router-registry` is the central allowlist a v18 wallet checks
before routing any `smart-buy-*` / `smart-sell-*` trade. This note records
why it exists and why approvals are one-way.

## The threat it closes

v18's smart trades take the router as a trait parameter
(`(smart <smart-trait>)`). Without a gate, ANY trait-conforming contract can
be passed. Inside the wallet the call runs under
`(as-contract? ((with-ft SBTC "sbtc-token" amount)) (contract-call? smart ...))`,
so a malicious "router" that satisfies the trait can simply take the `amount`
the allowance releases and return nothing.

Only an admin or a valid passkey signature can reach `authorize-smart`, so
this is not a random-drainer vector. The real risk is a **phished signature
or a malicious front end** getting a legitimate user to authorize a trade
through an attacker's contract. The passkey challenge binds the router
principal, but users do not read principals.

`authorize-smart` therefore asserts `is-approved-router` first, on BOTH the
passkey and admin arms. Unknown router -> `err-router-not-approved (u4033)`.

## Why central, not per-wallet

The whole reason the wallet uses a trait parameter is that a new router works
everywhere with zero per-wallet change. A per-wallet whitelist would throw
that away. So the allowlist is one shared contract: a new router is blessed
once and every wallet accepts it. The trust placed here is the same trust
already extended to whoever deploys the routers, and it mirrors how pools are
gated in `fakfun-core-v2`.

## Governance

| Action | Rule |
|--------|------|
| Approve a router | `propose-router` -> wait `COOLDOWN` (u144, ~1 day) -> `confirm-router`. Slow, so a compromised owner key cannot instantly bless a malicious router. |
| Approved set | **One-way. There is no un-approve.** |
| `revoke-pending` | Cancels a still-pending proposal only (nothing live yet). |
| Owner transfer | 2-step: `propose-owner` -> wait `COOLDOWN` -> `accept-owner` (only the proposed principal may accept). Owner is a `data-var` initialized at `tx-sender`. |
| Deploy seed | The 9 live routers (2026-08-29) are hard-coded as `map-set approved` in the contract body, so the registry ships pre-approved. |

## The decision: approvals are one-way (no un-approve)

**Chosen: append-only.** Once `confirm-router` runs, a router can never be
de-listed.

Rationale:

- The routers are immutable Clarity with no upgrade path and are individually
  sim-verified before going live, so a good router cannot "turn malicious
  later" - the classic reason to keep a revoke does not apply here.
- Removing un-approve closes a griefing vector: a compromised owner key cannot
  brick smart trading for every wallet at once by de-listing live routers.
- The per-call `with-ft` allowance is the hard backstop regardless: a bad
  router can pocket at most one input `amount` per call, never drain the
  wallet.

The one honest cost of append-only: the registry address is hard-coded in
v18, so if a **latent bug** were ever found in an already-approved router, it
could not be excluded on-chain, and every deployed wallet would keep routing
through it.

Why that cost is acceptable:

- The front end stops offering a bad router, so it leaves every honest flow -
  no normal user routes through it any more.
- The `with-ft` allowance still caps any single call to one input `amount`.
- The only residual path is a user phished into signing for that exact bad
  router directly - which needs both a malicious front end AND the specific
  bad contract, and even then loses one clip, not the wallet.

Conditions this decision depends on (keep both true):

1. The registry owner is a cold / multisig key. A compromised owner can still
   ADD a malicious router - only after the `COOLDOWN`, and visibly - so owner
   security is the main remaining trust assumption.
2. Every router is heavily reviewed and sim-verified before `confirm-router`,
   because approval is final.

If future routers are ever less than fully vetted, revisit this and add a
`revoke-router` kill switch for approved routers (a 3-line change), accepting
the griefing risk in exchange for a latent-bug escape hatch.

## Verification

Exercised in `simul-v18-smart-swap.js` on a mainnet fork: the registry seeds
the 9 at deploy (`pepe-smart-faktory` approved, `mock-smart-router` not), all
9 approved routers trade, and an unapproved trait-conforming
`mock-smart-router` is rejected with `(err u4033)` from the admin path.
