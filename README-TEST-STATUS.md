# Test status: juice-safe-v6, fakfun-wallet-v16, juice-pool-stx-signer

## TLDR

**All three green. 246 tests, 0 failures, 0 contract defects.**

| contract | tests | reachable lines | RV |
|---|---|---|---|
| `juice-safe-v6` | 108 | **100%** | 13 invariants, 0 fail |
| `fakfun-wallet-v16` | 106 | **99.7%** | 14 invariants, 0 fail |
| `juice-pool-stx-signer` | 32 | **100%** | 11 invariants, 0 fail |

**Full coverage: yes on v6 and the signer. v16 is 99.7%, not 100%** -- one real gap: the
actual BOB burn in `faktory-burn-bob`, because `built-on-bitcoin-stxcity` will not publish
in simnet so burn-bob runs against a stub. The wallet's dispatch, auth, passkey branch and
gas handling on that path ARE covered.

Everything else outstanding is unreachable-by-design and listed line by line below.

One standing caveat: **clarinet cannot see `(with-staking N)` violations**, so stxer stays
mandatory for any `as-contract?` change on a staking path.

One page, re-verified end to end. Details live in `README-clarinet-rv.md` (v6) and
`README-v16-signer-test-plan.md` (v16 + signer).

## Green, all three

| contract | vitest | reachable-line coverage | raw lcov | RV |
|---|---|---|---|---|
| `juice-safe-v6` | **108** | **100%** | 94.0% | 1500 runs, 13 invariants, 0 fail, 0 skipped fns |
| `fakfun-wallet-v16` | **106** | **99.7%** | 92.8% | 800 runs, 14 invariants, 0 fail |
| `juice-pool-stx-signer` | **32** | **100%** | 99.5% | 1500 runs, 11 invariants, 0 fail, 0 skipped fns |

**246 vitest tests. Zero failures. Zero functions never called on any of the three.**
Every suite runs the real deployed bytes at the real mainnet address against real
mainnet dependencies -- pox-5, sBTC, fakfun-wallet-core, the auth helpers -- with no
mocks on the contract under test.

**No contract defects found in any of the three.**

## "Full coverage" -- the honest version

v6 and the signer are at **100% of reachable lines**. v16 is at **99.7%**, and the
shortfall is real rather than cosmetic, so it is stated rather than rounded away:

| what | status |
|---|---|
| `faktory-burn-bob`'s actual BOB burn | **NOT covered.** The wallet's dispatch, auth, passkey branch and gas handling on that path are; the burn is not. `built-on-bitcoin-stxcity` does not publish in simnet, so `burn-bob-faktory` runs against a stub. See the burn-bob section of the v16 plan doc. |
| 2 `MAX-CONFIG-COOLDOWN` clamp arms (v16), same 2 in v6 | Unreachable by design -- cooldown is bounded at every entry point. Correct to keep. |
| 2 `(match gas ... true)` arms in v16 | The station-present counterpart is covered on both. |
| `u103 ERR_SETTLE_FAILED` (signer) | Unreachable in simnet, proven with four probes. |
| `u109 ERR_NO_NEW_REWARDS` (signer) | Shadowed -- pox-5 answers `u32` first. |
| RV skips 7 v16 faktory fns | They take traits RV has no eligible impl for. Covered by vitest instead. |

Also structural, and unchanged: **clarinet cannot see SIP-044 allowance violations**
(stx-labs/clarinet#2491, proven with an A/B). Any change touching `as-contract?` on a
staking path must be verified on stxer, where the lock actually applies.

## Reproducing

```
# correctness -- real deployed bytes at the real mainnet addresses
npx vitest run tests/juice-safe-v6*.test.ts     -- --manifest tests/cl-v6/Clarinet.toml
npx vitest run tests/fakfun-wallet-v16*.test.ts -- --manifest tests/cl-v16/Clarinet.toml
npx vitest run tests/signer-*.test.ts           -- --manifest tests/cl-signer/Clarinet.toml

# coverage -- separate harnesses, because --coverage instruments PROJECT contracts only
V6_DEPLOYER=ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM     npx vitest run tests/juice-safe-v6*.test.ts     -- --manifest tests/cl-v6-cov/Clarinet.toml --coverage
V16_DEPLOYER=ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM    npx vitest run tests/fakfun-wallet-v16*.test.ts -- --manifest tests/cl-v16-cov/Clarinet.toml --coverage
SIGNER_DEPLOYER=ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM npx vitest run tests/signer-*.test.ts           -- --manifest tests/cl-signer-cov/Clarinet.toml --coverage

# RV -- build.sh FIRST, the target is a contract+invariants artifact nothing regenerates
./tests/rv-v6/build.sh     && npx rv tests/rv-v6     juice-safe-v6         invariant --runs 1500
./tests/rv-v16/build.sh    && npx rv tests/rv-v16    fakfun-wallet-v16     invariant --runs 800
./tests/rv-signer/build.sh && npx rv tests/rv-signer juice-pool-stx-signer invariant --runs 1500
```

## Two habits this work earned

1. **Never trust a proxy metric.** "All public functions covered" was wrong twice: it
   counts a function name appearing in a comment or an unrelated test. Measuring lines
   found `confirm-max-gas-amount` had never been called at all, and that
   `stx-transfer-memo?` -- a different native from `stx-transfer?` -- had never run on
   three sites in either wallet. Both arms return `(ok true)`, so no error-code audit
   could ever have seen it.
2. **Check `.cache/requirements/` for stubs.** A hand-written file there is
   indistinguishable from a fetched one. `burn-bob-faktory` was a 60-byte fake standing
   in for 5,041 real bytes. One command catches the class:

```
for f in .cache/requirements/*.clar; do
  s=$(wc -c < "$f"); [ "$s" -lt 400 ] && printf "%6s  %s\n" "$s" "$(basename $f)"
done
```

## Filed upstream

- **stx-labs/clarinet#2490** -- coverage reports `DA:0` on continuation lines of
  multi-line expressions, so raw lcov cannot reach 100% and a real hole looks identical
  to a formatting artifact.
- **stx-labs/clarinet#2491** -- simnet does not apply PoX locks, so `stx-account` reads
  `locked u0` and `(with-staking N)` allowances are not enforced at all.

A third is worth filing: clarinet ignores inter-requirement dependency order. It
publishes `fakfun-wallet-v16` before `juice-pool-stx-signer`, which v16 depends on, and
hand-reordering the plan does not survive a rerun. Worked around by publishing v16 from
the suites via `deployV16()`.


---

# Why only ~13 RV invariants per contract

Fair question, and the count is not a coverage number -- it is a different unit.

**An invariant is not a test.** A test asserts one call does one thing. An invariant
asserts a property of STATE that must hold after **every possible sequence** of calls.
So 13 invariants over 1500 randomised runs is not 13 assertions -- each one was checked
120-175 times against a different state the fuzzer had wandered into. The three
contracts together ran ~38 invariants against several thousand random call sequences.

**The count is bounded by what state can say, not by effort.** `juice-safe-v6` has about
15 state vars and maps. The statements that are true after *any* sequence fall into four
families, and once you have written them you are done:

| family | v6 examples |
|---|---|
| bounds | cooldown inside `[144, 4032]`, max-gas under the ceiling, gas under the period fuse, period counters under their thresholds |
| identity | the contract is never its own admin, owner, or recovery address |
| latches | the onboard flag never flips back |
| consistency | a queued config is empty or legal, a staked position never exceeds what could fund it, a position always names the Juice signer, an op is never both executed and vetoed |

There is no fifth family hiding. Adding a fourteenth invariant to v6 would mean either
restating one of these or writing something that cannot fail.

**Most of a wallet's behaviour is not an invariant at all.** "The passkey cannot
fast-track an op it queued itself" is a rule about a CALL, not a property of state.
Same for "the memo arm uses `stx-transfer-memo?`", "an orphaned passkey is refused on
every entry point", "the fee is skimmed from the gross". Those are the 246 vitest tests.
The division is deliberate: **RV proves no sequence can corrupt state; vitest proves each
call does the right thing.** Neither substitutes for the other.

**Two hard limits shrink the set further.**

1. RV cannot forge WebAuthn signatures, so every passkey-gated path returns `u4002` and
   any state only reachable through a passkey is out of RV's reach entirely.
2. Read-only invariants take a stateless snapshot, so genuine monotonicity ("this counter
   never decreases") is not expressible unless the property is latch-like. That is why
   `pubkey-initialized-monotonic` works -- once true it stays true -- while
   "operation-nonce only grows" cannot be written at all.

**Quality beats quantity here, and a bad invariant is worse than none.** It either passes
vacuously or is too weak to ever fail, and in both cases it makes a green run look
stronger than it is. That failure mode is real: v6's three staking invariants and the
signer's five tranche invariants were both vacuous at first, passing over state the fuzzer
could never reach. Each was proven live with a temporary CANARY asserting the opposite and
required to FAIL. A canary that survives is the bad outcome.

The three added most recently are the honest answer to "can you have more": an op is never
both executed and vetoed (v6, v16), and a recorded claim always has a tranche behind it
(signer). All three are real properties that could break; there was no larger pool of
equally strong ones waiting to be written.


---

# Every invariant, in plain English

38 invariant definitions across the three contracts, 9 of them doing the same job in both
wallets. Each row says what the invariant FORBIDS -- if it ever fails, that is what went
wrong.

## The 9 shared by both wallets

| invariant | forbids | why it matters |
|---|---|---|
| `cooldown-within-bounds` | cooldown outside `[144, 4032]` | the delay is the only thing protecting against a stolen admin key |
| `max-gas-within-ceiling` | `max-gas-amount` above `MAX-GAS-CEILING` | caps what a hostile gas station can extract per call |
| `gas-fuse-holds` | period gas above `max-gas-amount * 25` | caps what it can extract per period |
| `spent-within-thresholds` | period counters past their thresholds | the queue-vs-move decision is derived from these |
| `contract-never-own-admin` | the wallet in its own `admins` map | this is what makes gas-station re-entrancy fail |
| `owner-not-contract` | the wallet as its own owner | same class: a self-owning wallet could authorise itself |
| `recovery-not-contract` | the wallet as its own recovery address | recovery would be unusable and funds stranded |
| `pending-config-empty-or-legal` | an out-of-bounds cooldown sitting queued | otherwise the confirm step applies it unchecked |
| `pubkey-initialized-monotonic` | the onboard latch flipping back | re-onboarding would let someone seat a new passkey |

## juice-safe-v6 only

| invariant | forbids |
|---|---|
| `staked-not-above-funded` | a pox-5 position larger than the wallet could fund. Catches the top-up allowance being treated as a delta when it is a resulting TOTAL -- the easiest thing here to get backwards |
| `num-cycles-within-max` | `num-cycles` past pox-5's own cap |
| `signer-is-juice` | a position pointing at a different signer, which would send rewards elsewhere |

## fakfun-wallet-v16 only

| invariant | forbids |
|---|---|
| `self-never-whitelisted-extension` | the wallet whitelisting ITSELF as an extension. `extension-call` runs extensions under `(with-all-assets-unsafe)`, so that clause would be pointed at the wallet's own surface |
| `pending-init-sane` | a pending admin proposal naming the contract |
| `staked-not-above-funded`, `signer-is-juice` | the same two properties as v6 |

## Both wallets, added last

| invariant | forbids |
|---|---|
| `no-op-executed-and-vetoed` | an operation being BOTH executed and vetoed. If a sequence could set both flags, "vetoed" stops meaning "this can never pay out" |

## juice-pool-stx-signer -- all about conservation

| invariant | forbids |
|---|---|
| `tranche-paid-within-pot` | paying out more than came in. THE property |
| `paid-shares-within-total` | paid shares exceeding the cycle total, which is what a double payment looks like |
| `fees-not-above-balance` | `earned-fees` exceeding the real sBTC balance |
| `fee-within-cap` | a fee above `MAX_FEE_BIPS` (20%) |
| `pending-fee-legal` | an illegal fee parked in the pending slot, which `confirm-fee-bips` would apply unchecked |
| `residue-computable` | a negative residue. It is uint subtraction, so an underflow aborts rather than reports -- calling it at all IS the assertion |
| `fully-paid-implies-shares` | a settled tranche un-settling, which would let `sweep-tranche-dust` run twice |
| `tranche-count-sane` | tranche accounting running away |
| `claim-implies-tranche` | a recorded claim with no tranche behind it. The too-soon guard would arm for a cycle that has no pot, silently blocking every future claim for it |
| `admin-not-contract` | the signer seated as its own admin |
| `og-pays-nothing` | an OG staker being charged a fee |

## The shape of it

The two contract families are asking different questions. **The wallets are about
authority and bounds** -- who may act, how much, how fast. **The signer is about
arithmetic** -- nothing created, nothing destroyed.

Two are worth singling out:

- **`contract-never-own-admin`** (both wallets). An entire class of gas-station
  re-entrancy attack fails *only* because this holds. If a hostile station could get the
  wallet into its own `admins` map, it could re-enter and move assets as an admin.
- **`admin-not-contract`** (signer). `set-admin` has **no guard at all** -- it will
  happily seat the contract itself or the burn address, and nothing on chain can undo it.
  This invariant is the only thing standing between a bad call sequence and a permanently
  bricked contract.

## And the ones that were vacuous first

Worth repeating because it is the failure mode that makes a green RV run lie. v6's three
staking invariants and the signer's five tranche invariants all PASSED initially over
state the fuzzer could never reach -- correct assertions guarding nothing. Each was proven
live with a temporary CANARY asserting the opposite and required to FAIL:

```clarity
;; v6: does a pox-5 position ever exist?
(define-read-only (invariant-canary-never-staked)
  (is-none (contract-call? 'SP000000000000000000002Q6VF78.pox-5 get-staker-info
    current-contract)))

;; signer: does a tranche pot ever exist?
(define-read-only (invariant-canary-no-pot) (is-eq (get-stx-pot u1 u0) u0))
```

**A canary that survives is the bad outcome.** Both failed once the harness was right,
which is the proof the real invariants are checked against real state. The canaries were
then deleted, with the reasoning left in the invariant files.
