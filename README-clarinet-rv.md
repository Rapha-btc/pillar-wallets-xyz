# Clarinet + RV testing: juice-safe-v6 and fakfun-wallet-v16

Companion to `README-v6-v16-sims.md`, which covers the stxer mainnet-fork suite.

**Nothing in this repo had ever run under Clarinet.** Four separate tooling
problems had to be fixed first, documented below so nobody rediscovers them.

---

## The four tooling fixes

### 1. Clarity 6 needs `epoch = "4.0"`, not `"latest"`

`clarinet check` on the old manifest failed outright:

```
error: syntax errors in Clarinet.toml
Clarity 6 can not be used with latest
```

Every Clarity 6 entry needs `epoch = "4.0"` explicitly. Until this was fixed the
manifest was unparseable, which is why neither `npm test` nor `rv` had ever loaded
this project.

### 2. Clarinet 3.19.0 is unusably slow here -- use 3.23.1

3.19.0 took over ten minutes and still timed out analysing the project, even
scoped to a single contract. 3.23.1 completes in roughly two minutes.

The vendored binary is at `/usr/local/bin/clarinet` (3.19.0). Get 3.23.1 from
`hirosystems/clarinet` releases, `clarinet-linux-x64-glibc.tar.gz`.

### 3. Requirements were incomplete

Two dependencies were missing from the manifest, and the earlier dependency scan
missed them because it only matched `SP`-prefixed principals:

- `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal`
- `SP000000000000000000002Q6VF78.pox-5`

`pox-5` is both a mainnet contract and a clarinet boot contract, so either route
works. It is 136KB of Clarity and dominates analysis time.

**Do not hand-write `.cache/requirements/*.json`.** Clarinet records each
contract's ACTUAL deploy epoch, which varies per contract and is not derivable
from its Clarity version:

| clarity | epochs actually seen |
|---|---|
| Clarity1 | Epoch20 |
| Clarity3 | Epoch30 |
| Clarity4 | Epoch33, Epoch34 |
| Clarity5 | Epoch32, Epoch34 |
| Clarity6 | Epoch40 |

Guessing produces `error: use of unresolved contract` with no explanation. Delete
the cache and let clarinet fetch.

### 4. The contract under test must be a REQUIREMENT, not a `[contracts.*]` entry

This is the one that matters most.

A contract listed under `[contracts.*]` deploys under the **simnet deployer**
address. `juice-safe-v6` hardcodes its own mainnet principal for
`register-wallet`, and `fakfun-wallet-core.set-verified-contract` is gated on the
Faktory deployer, so a locally-deployed copy fails with:

```
Contract 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-safe-v6' does not exist
```

Listing it as a requirement instead pulls the REAL deployed bytes and seats them
at the REAL mainnet address, so every self-reference resolves and the tests
exercise what is actually on chain. `tests/cl-v6/Clarinet.toml` has **16
requirements and zero local contracts**.

### 5. Vitest

`vitest-environment-clarinet` failed to start a worker under vitest 4.1.6 with
`@stacks/clarinet-sdk` 3.17.0 -- a pre-existing breakage, the older
`fakfun-wallet-v2.test.ts` failed the same way. Upgrading the SDK to 3.23.1 fixed
it.

**Simnet runs with the TESTNET chain-id, `0x80000000` = 2147483648.**
`helpers-v10` builds the SIP-018 domain hash from the runtime chain-id, so a test
signing with mainnet `u1` gets `err-invalid-signature u4002` on every passkey call.
`tests/juice-safe-v6.test.ts` sets `CHAIN_ID` accordingly.

---

## clarinet check

Run from the scoped project:

```
cd tests/cl-v6 && clarinet check      # 3.23.1
```

### juice-safe-v6: 0 errors, 18 warnings

**No defects.** Of the 18 warnings, 10 are wrong or unactionable and **four would
break the contract if acted on**:

| count | warning | verdict |
|---|---|---|
| 6 | `unwrap-panic will abort the transaction` | **DO NOT ACT.** Clarinet suggests `try!`. That is what killed the v3/v12 deploys: `try!` must read the err value to propagate it, the err type is indeterminate at Clarity 6, and contract INIT aborts with `(err none)`. Two of the six are inside `pay-gas-accounted`, exactly where that was traced. |
| 2 | `let binding lock-total is never used` | **FALSE POSITIVE.** Used at `(with-ft SBTC-CONTRACT "sbtc-token" lock-total)`. |
| 2 | `function parameter token-name is never used` | **FALSE POSITIVE.** Used at `(with-ft (contract-of sip010) token-name amount)` and the `with-nft` equivalent. |
| 2 | `single-field tuple is unnecessary` | Cosmetic. The hash builder's parameter type IS a tuple, and that helper is deployed and immutable. |
| 5 | unused error constants | Real dead code. Removed in v7. |
| 1 | `initial-pubkey never read` | Real. Written at `onboard`, never read; lookups go through `pubkey-to-admin`. Removed in v7. |

**Clarinet 3.23.1's unused-binding analysis does not see identifiers used inside
SIP-044 allowance clauses.** Anyone "cleaning up" those four warnings would delete
a binding that bounds how much sBTC or which NFT can move. This is the single most
useful thing the check surfaced.

### juice-safe-v7 (reference only, NOT deployed)

v6 with the six genuine dead-code items removed: `err-no-auth-id`,
`err-no-message-hash`, `err-limit-expired`, `err-limit-not-hit`,
`err-fatal-owner-not-admin`, plus the `initial-pubkey` data-var, its write in
`onboard`, and the now-orphaned `PUBK` constant.

48,483 -> 48,060 bytes. **0 errors, 12 warnings** -- only the false positives and
the must-not-touch `unwrap-panic` set remain. Checkable at `tests/cl-v7/`.

---

## Vitest scenarios

```
npx vitest run tests/juice-safe-v6.test.ts -- --manifest tests/cl-v6/Clarinet.toml
```

### juice-safe-v6: 24 / 24 passing

Against the real deployed bytes at the real mainnet address, 16 real mainnet
dependencies, no mocks.

**Init.** `onboard` fails `u6001` until `set-verified-contract` registers the
contract; only `FAKFUN-DEPLOYER` may call it; it cannot run twice.

**Onboard guards.** Refuses the contract itself as recovery, refuses the owner,
enforces the `u144` floor and `u4032` ceiling, honours a caller-supplied cooldown
(verified with `u500`). **Accepts the burn sentinel** -- asserted as intended
behaviour, not flagged.

**Config change spans two different factors.** signal is admin-only and
bounds-checked; values queue publicly while the live config is untouched; a
garbage signature from the admin key alone fails `u4002` and the queued change
survives; a signature bound to different values fails `u4002`; the correct
signature before the cooldown fails `u4012`; after it, all three values apply and
the queue zeroes; a confirm with nothing queued fails `u4016`.

**Max-gas.** propose is admin-only, ceilinged `u4018`, and does not move the live
value.

**Thresholds.** Under-threshold STX moves immediately and increments only the
`stx` counter; over-threshold queues and moves nothing; a non-admin is refused.

**Never its own admin.** `is-admin-calling` rejects the contract's own principal
and accepts the owner; `recover-inactive-wallet` refuses to seat the contract.

**Inactivity recovery.** Refused while active `u4009`; `is-inactive` flips after
52,560 burn blocks; only the recovery principal may act; ownership transfers; and
a config change resets the clock.

---

## RV fuzzing

```
npx rv tests/rv-v6 juice-safe-v6 invariant --runs=300
```

`tests/rv-v6/` keeps the 15 dependency requirements real and deploys the wallet
LOCALLY, since RV must append to the source. Only the mainnet self-reference is
rewritten to `.juice-safe-v6`; nothing else is mocked.

### juice-safe-v6: 300 runs, 9 invariants, 0 failures

| invariant | what it forbids |
|---|---|
| `cooldown-within-bounds` | `cooldown-period` outside `[u144, u4032]` |
| `max-gas-within-ceiling` | `max-gas-amount` above `MAX-GAS-CEILING` |
| `gas-fuse-holds` | `gas` spent above `max-gas-amount * 25` |
| `contract-never-own-admin` | the contract appearing in its own `admins` map |
| `owner-not-contract` | the contract as owner |
| `recovery-not-contract` | the contract as recovery address |
| `pending-config-empty-or-legal` | an out-of-bounds cooldown sitting queued |
| `pubkey-initialized-monotonic` | the onboard latch flipping back |
| `spent-within-thresholds` | period counters running past their thresholds |

### The bootstrap, and why a first attempt was worthless

A first 200-run session reported 0 failures over **1,164 calls and ZERO successful
state changes**. Every path bounced: `onboard` needs `FAKFUN-DEPLOYER`, admin paths
need the seated owner, signed paths need a real secp256r1 signature RV cannot
forge. The invariants held over a contract that never left its initial state.

`tests/rv-v6/juice-safe-v6.invariants.clar` therefore also appends an **RV-only
`rv-bootstrap`** which seats the caller as owner and admin, marks the wallet
initialised, and points `recovery-address` at a fixed simnet wallet. It is not part
of the deployed contract, exactly like the invariants. With it, 300 runs produced
201 successful bootstraps and 38 successful `propose-max-gas-amount` calls.

### What RV still cannot reach, honestly

- **`signal-config-change`: 206 attempts, 0 successes.** RV generates random `u128`
  arguments, which essentially never land inside `[u144, u4032]`. Those 206
  rejections are the bounds check working under random input, but the path past it
  is unexercised. Constraining the argument needs RV's `--dial` hook.
- **`execute-pending-*`: 0 successes.** They need a real `op-id`; random ones miss.
- **`recover-inactive-wallet`** reached `(err u4009)`, so it passed the
  recovery-principal check and failed only on the inactivity clock.
- **Every signature-gated path is unreachable.** RV cannot produce valid WebAuthn
  signatures, so the passkey half of the two-factor design is covered by the stxer
  suite and the vitest scenarios, not here.

---

## fakfun-wallet-v16

### clarinet check: 0 errors, 27 warnings

Same verdict as the safe -- **no defects.** Most warnings are the allowance blind
spot, now confirmed on both contracts. Every one of these is used inside a
`with-ft` or `with-nft` clause and would remove an asset bound if deleted:

| binding | the allowance that uses it |
|---|---|
| `BOB-BURN-AMOUNT` | `(with-ft BOB-CONTRACT "BOB" BOB-BURN-AMOUNT)` |
| `seat-price` | `(with-ft SBTC-CONTRACT "sbtc-token" (* seat-count seat-price))` |
| `liq-quote` | `(with-ft SBTC-CONTRACT "sbtc-token" (get dx liq-quote))` |
| `token-name` x4 | `(with-ft (contract-of sip010) token-name amount)` and the `with-nft` twin |
| `lock-total`, `sip010-name` x2, `nft-name`, `ft-name` | same pattern |

Two v16-specific warnings are real and both are EXPECTED:

- **`pubkey-cooldown-period` never modified.** This is the signature of change 7
  landing correctly: the signal/confirm pair that used to write it is gone, so it
  is now effectively a constant read only by `confirm-admin-with-signature` during
  the one-time seating.
- **Three unused error constants and `initial-pubkey`.** Genuine dead code,
  removed in v17.

### Two harness stubs were needed, and one taught us something

`fakfun-wallet-v16` could not deploy as a requirement until two contracts were
stubbed in the cache. Both are recorded here because they narrow what the clarinet
layer proves about v16:

1. **`burn-bob-faktory`** -- clarinet could not order the real one even with its
   own dependency resolved; the BOB / faktory / xtrata graph runs deep. v16 calls
   exactly one function on it (`daily-burn`), and `tests/rv/` already ships a
   `mock-burn-bob-faktory` for the same reason. The real contract is exercised by
   the stxer suite, where mainnet state is real.
2. **`ST1NXBK3K5YYMD6FD41MVNP3JS1GABZ8TRVX023PT.nft-trait`** -- a TESTNET address
   the xtrata contracts reference. Not fetchable from a mainnet node; the stub is
   the verbatim SIP-009 trait, so it is semantically identical.

**THE LESSON.** The first `burn-bob-faktory` stub was written
`(define-public (daily-burn) (ok true))` and the whole check failed with:

```
error: attempted to obtain 'err' value from response, but 'err' type is indeterminate
```

That is the IDENTICAL fault that aborted the juice-safe-v3 and fakfun-wallet-v12
deploys at contract init. A bare `(ok true)` leaves the err type unconstrained, so
a caller's `try!` over it cannot resolve. This is exactly why every mock in
`tests/rv/` is written `(if true (ok true) (err u0))` -- that form pins the err
type. Reproducing the v3/v12 fault by accident, in a two-line stub, is the
clearest demonstration of it available.

### fakfun-wallet-v17 (reference only, NOT deployed)

v16 with the genuine dead code removed and one function retired:

- `err-no-auth-id`, `err-no-message-hash`, `err-fatal-owner-not-admin`
- the `initial-pubkey` data-var, its write in `onboard`, and the orphaned `PUBK`
- **`faktory-burn-bob` removed entirely**, along with `BOB-CONTRACT` and
  `BOB-BURN-AMOUNT`

71,158 -> 69,374 bytes. **0 errors, 21 warnings**, all of them the allowance false
positives, the must-not-touch `unwrap-panic` set, the single-field tuples, and the
expected `pubkey-cooldown-period`.

Dropping `faktory-burn-bob` removed the entire BOB dependency chain, so v17 needs
**neither stub** and clarinet resolves it from real mainnet requirements alone --
three fewer requirements than v16. Checkable at `tests/cl-v17/`.

---

## Reference contracts, neither deployed

| contract | bytes | errors | warnings | derived from |
|---|---|---|---|---|
| `juice-safe-v7` | 48,060 | 0 | 12 | v6 minus 5 error constants, `initial-pubkey`, `PUBK` |
| `fakfun-wallet-v17` | 69,374 | 0 | 21 | v16 minus 3 error constants, `initial-pubkey`, `PUBK`, `faktory-burn-bob` |

---

## Still to do

- **vitest scenarios for fakfun-wallet-v16.** Written at
  `tests/fakfun-wallet-v16.test.ts` (17 scenarios covering the three-step admin
  seating, the absence of the pubkey-registration surface, the config surface,
  max-gas, thresholds and the never-its-own-admin invariant) but NOT yet passing --
  the requirement could not deploy until the two stubs above landed, and the run
  has not been repeated since.
- **RV fuzzing for fakfun-wallet-v16.**

