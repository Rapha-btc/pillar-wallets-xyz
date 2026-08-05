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
npx vitest run tests/juice-safe-v6.test.ts tests/juice-safe-v6-surface.test.ts \
  tests/juice-safe-v6-assets.test.ts tests/juice-safe-v6-staking.test.ts \
  -- --manifest tests/cl-v6/Clarinet.toml
```

### juice-safe-v6: 68 passing, 0 skipped, all 25 public functions

Against the real deployed bytes at the real mainnet address, with real mainnet
dependencies. Four suites:

| suite | what it covers |
|---|---|
| `juice-safe-v6.test.ts` | the v6 DELTA: onboard guards, the config pair, thresholds, recovery |
| `juice-safe-v6-surface.test.ts` | the rest of the surface: pending ops, veto, token lock, 2FA transfer, recovery rotation, max-gas confirm |
| `juice-safe-v6-assets.test.ts` | sBTC and NFT SUCCESS paths, and the gas channel on 12 sites |
| `juice-safe-v6-staking.test.ts` | pox-5 staking, the post-unlock state, and the full reward payout chain |

**Init.** `onboard` fails `u6001` until `set-verified-contract` registers the
contract; only `FAKFUN-DEPLOYER` may call it; it cannot run twice.

**Onboard guards.** Refuses the contract itself as recovery, refuses the owner,
enforces the `u144` floor and `u4032` ceiling, honours a caller-supplied cooldown.
**Accepts the burn sentinel** -- asserted as intended, not flagged.

**Config spans two factors.** signal admin-only and bounds-checked; values queue
publicly while the live config is untouched; a garbage signature from the admin key
alone fails `u4002` and the queued change survives; a signature bound to different
values fails `u4002`; correct-but-early fails `u4012`; then all three values apply
and the queue zeroes; nothing-queued fails `u4016`.

**Pending operations.** Over threshold queues; early release `u4017`; release after
the cooldown with the balance checked; double-execute `u4014`; unknown op-id `u4013`;
the passkey fast path skipping the cooldown. Veto by admin, by passkey, refused for
a random caller, and blocking release `u4015`.

**Token lock** blocks signed transfers `u4023` while leaving the admin path open --
worth knowing: **a token lock is not a freeze.**

**2FA transfer.** Factor one alone moves nothing; both factors complete it;
nothing-proposed `u4020`; the contract refused as new owner. **Recovery rotation:**
propose needs the passkey, confirm needs the admin, nothing-pending `u4010`.

**max-gas.** propose admin-only and ceilinged `u4018`; the live value does not move
on propose; a wrong-amount signature `u4002`; correct-but-early `u4012`; then the
value moves 1000 -> 5000.

### sBTC without a mock

Clarinet requirements copy contract CODE from mainnet, never chain STATE, so
sbtc-token exists in simnet with zero supply and a mainnet whale holds nothing here.
sBTC is therefore minted through the REAL protocol path:
`sbtc-deposit.complete-deposit-wrapper`, sent as the registry's own
`current-signer-principal` (`SM3VDXK3...` in simnet). Same call the sBTC signers
make. Genesis simnet accounts also hold 1e9 sBTC each.

Covered: `sip010-transfer` on admin and passkey paths; over-threshold queue then
both release paths; `sbtc-initiate-withdrawal` under and over threshold, both
releases, and a passkey-signed withdrawal; `sip009-transfer` moving a real NFT on
both paths.

Three things that look like bugs and are not:
- `sbtc-token.get-balance` sums unlocked **plus locked**, so a withdrawal shows no
  change there. `get-balance-available` is the one that moves.
- `execute-pending-sbtc-withdrawal` returns the withdrawal **request id**, not a
  bool -- and that id is what you need to reclaim a failed withdrawal.
- `spent-this-period` resets **lazily** inside `get-current-spent`, so after mining
  past the cooldown the raw data-var still holds the old value. Assert the absolute
  after a period roll, not a delta.

### Gas: 12 of 15 enforced sites driven with a live station

`tests/cl-v6/contracts/zz-gas-station.clar` charges 20 sats. Driven on
`stx-transfer`, `sip010-transfer`, `sip009-transfer`, `sbtc-initiate-withdrawal`,
`veto-operation`, `toggle-token-lock`, `propose-recovery`, `set-wallet-config`,
`confirm-max-gas-amount`, `update-stake-stx-juice` and both sBTC fast paths. Also
asserts the footgun: **a station passed on an UNSIGNED admin call is ignored and
charged nothing**, because gas is matched inside the `sig-auth` branch.

### pox-5 staking: it works, and the earlier explanation was wrong

An earlier pass skipped staking and blamed burn heights -- "pox-5 is anchored to
mainnet ~666k, simnet starts at 6". **That was wrong.** The error was
`ERR_SIGNER_NOT_FOUND u23`: simnet's pox-5 starts empty, so
`juice-pool-stx-signer` had never registered. No block mining is needed;
`mineEmptyBurnBlocks(666_000)` would not have helped.

Registration goes through the real chain:

```
juice-pool-stx-signer.register-self       admin-gated
  -> pox-5.grant-signer-key               verifies a secp256k1 signature over
                                          get-signer-grant-message-hash
  -> pox-5.register-signer                asserts contract-caller is the signer
```

The harness generates a secp256k1 keypair, rebuilds the SIP-018 grant hash (domain
`{name "pox-5-signer", version "1.0.0", chain-id}`, struct
`{topic "grant-authorization", signer-manager, auth-id}`) and signs it. This
`@noble/curves` build returns a bare 64-byte compact signature with no recovery bit,
so the id is found by trying 0 then 1 -- a rejected grant rolls back, so the miss
costs nothing.

Covered: the full stake -> top-up -> extend-rejected-at-max `u20` -> unstake
lifecycle; non-admin `u4001` and zero-amount `u4026`; the no-op update; a
passkey-signed stake; a passkey unstake via relayer; a passkey top-up paid by a gas
station; and the post-unlock state -- after unstake plus 6,300 burn blocks,
`get-staker-info` goes to `none`, with the two-part exit pinned (unstake truncates
the window, only the cycle rolling clears the position).

**One real simnet limit, asserted rather than hidden.** After a successful stake,
`stx-account` reports `locked u0` while `get-staker-info` is correct. The lock, the
`STXLockEvent` and the stacking asset-map entry all come from the NODE's PoX
handler, which clarinet does not emulate. So **`(with-staking N)` is NOT genuinely
enforced in simnet** -- that evidence comes from stxer, where the lock applies for
real after stxer/stxer-sdk#7 and an under-declared allowance aborts.

### The reward payout chain, and the 50k trap

Full chain in clarinet: sBTC deposited to pox-5 -> `calculate-rewards`
(permissionless, from a relayer) -> `signer.pox-claim-rewards` into the Juice pot ->
`signer.pay-stx-stakers` with the safe's balance actually rising -> a replay of the
same tranche paying nothing, proving the `stx-paid` guard.

Getting there took three wrong diagnoses from me -- burn heights, then cycle
alignment, then "a fresh pox-5 needs share registration I cannot reproduce". The
actual cause was the **stake amount**.

**`SIGNER_SET_MIN_USTX = u50000000000` (50k STX) is a PER-SIGNER delegation
threshold.** `pox-5.clar:1705`:

```clarity
(if (>= new-delegated SIGNER_SET_MIN_USTX)
    ;; record signer-shares, total-shares, add to the signer set
    ;; not over the min yet -> record NOTHING
```

pox-5's own comment says signers below the delegation threshold do not receive
rewards. So a 1,000 STX stake made `calculate-rewards` report
`cycle-staked-ustx: u0`, fold every sat into the reserve, and `pox-claim-rewards`
answer `ERR_NO_CLAIMABLE_REWARDS u32`.

**THE TRAP, now a locked-in test.** A stake of `49_999_999_999` uSTX -- one microSTX
short -- succeeds, appears healthy in `get-staker-info`, and earns NOTHING, silently
and forever. Not a contract bug; pox-5 is behaving as documented. But anything that
lets a user stake into the Juice signer should enforce the floor or say plainly that
below it they earn zero. It also means the signer's AGGREGATE matters: a position
over the floor stops earning if other stakers leave and the signer drops back under
it mid-cycle.

### Behaviours still untested, measured not guessed

| behaviour | clarinet | stxer |
|---|---|---|
| gas fuse tripping at `u4018` | no | yes, 26/26 |
| re-proposing max-gas to cancel a pending raise | **no** | **no** |
| token lock gating the STAKING paths | **no** | **no** |
| re-signalling a config change over a queued one | **no** | **no** |
| `execute-pending-stx-transfer-now` with a gas station | no | no |
| hostile gas-station re-entrancy | no | yes |
| multi-tranche / hostile settle | no | yes, 39/39 |
| `(with-staking N)` allowance enforcement | impossible | yes |

Three are untested ANYWHERE: the max-gas implicit veto (re-propose lower to kill a
pending raise -- the documented cancel mechanism, since there is no
`veto-max-gas-amount`), token lock over the staking paths, and re-signalling config.

## RV fuzzing

```
npx rv tests/rv-v6 juice-safe-v6 invariant --runs=300
```

`tests/rv-v6/` keeps the 15 dependency requirements real and deploys the wallet
LOCALLY, since RV must append to the source. Only the mainnet self-reference is
rewritten to `.juice-safe-v6`; nothing else is mocked.

### juice-safe-v6: 400 runs, 12 invariants, 0 failures

| invariant | what it forbids |
|---|---|
| `cooldown-within-bounds` | `cooldown-period` outside `[u144, u4032]` |
| `max-gas-within-ceiling` | `max-gas-amount` above `MAX-GAS-CEILING` |
| `gas-fuse-holds` | `gas` spent above `max-gas-amount * 25` |
| `contract-never-own-admin` | the contract in its own `admins` map |
| `owner-not-contract` | the contract as owner |
| `recovery-not-contract` | the contract as recovery address |
| `pending-config-empty-or-legal` | an out-of-bounds cooldown sitting queued |
| `pubkey-initialized-monotonic` | the onboard latch flipping back |
| `spent-within-thresholds` | period counters past their thresholds |
| `staked-not-above-funded` | a position larger than the wallet could fund |
| `num-cycles-within-max` | `num-cycles` past the pox-5 maximum |
| `signer-is-juice` | a position pointing at a different signer |

### The bootstrap, and why a first attempt was worthless

A first 200-run session reported 0 failures over **1,164 calls and ZERO successful
state changes**. Every path bounced: `onboard` needs `FAKFUN-DEPLOYER`, admin paths
need the seated owner, signed paths need a real secp256r1 signature RV cannot forge.
The invariants held over a contract that never left its initial state.

So the invariants file also appends an **RV-only `rv-bootstrap`** which seats the
caller as owner and admin, marks the wallet initialised, and points
`recovery-address` at a fixed simnet wallet. Not part of the deployed contract. With
it, 400 runs produced 200 successful bootstraps and 37 successful
`propose-max-gas-amount` calls.

### THE LAST THREE INVARIANTS ARE CURRENTLY VACUOUS

`rv-stake-anything` got 217 attempts and **0 successes**, so
`staked-not-above-funded`, `num-cycles-within-max` and `signer-is-juice` all pass
through their `true` fallback -- correct assertions guarding nothing yet.

Staking cannot be reached under RV, and not for a fixable reason: registering the
Juice signer needs `juice-pool-stx-signer.register-self`, gated on **that contract's
admin**, and pox-5's `grant-signer-key` / `register-signer` both assert
`contract-caller` is the signer. RV only calls the contract under test, from random
wallets, so no path exists from inside `juice-safe-v6`.

**Dialers cannot bridge it either.** `rv` passes `simnet` as a PARAMETER to
`checkInvariants` rather than exposing a global, so a dialer -- which receives only
`{clarityValueArguments, functionCall, selectedFunction}` -- has no handle on the live
session. Calling `initSimnet` itself would create a different one.

The deployment plan is the remaining option: clarinet supports
`emulated-contract-call` steps with an arbitrary `emulated-sender`, so the signer
could be registered there before RV starts. A precomputed grant signature for a fixed
key and `auth-id u1` works for this, since the domain and struct are deterministic.
Not yet wired up.

### What RV still cannot reach

- **`signal-config-change`: 214 attempts, 0 successes.** RV generates random `u128`
  arguments, which essentially never land inside `[u144, u4032]`. Those rejections
  are the bounds check working under random input, but the path past it is
  unexercised. Constraining the argument needs the `--dial` hook.
- **`execute-pending-*`: 0 successes.** They need a real `op-id`; random ones miss.
- **Every signature-gated path is unreachable.** RV cannot produce valid WebAuthn
  signatures, so the passkey half of the two-factor design is covered by stxer and
  vitest, not here.

---

## Still to do

- **vitest scenarios for fakfun-wallet-v16.** Written at
  `tests/fakfun-wallet-v16.test.ts` (17 scenarios covering the three-step admin
  seating, the absence of the pubkey-registration surface, the config surface,
  max-gas, thresholds and the never-its-own-admin invariant) but NOT yet passing --
  the requirement could not deploy until the two stubs above landed, and the run
  has not been repeated since.
- **RV fuzzing for fakfun-wallet-v16.**

