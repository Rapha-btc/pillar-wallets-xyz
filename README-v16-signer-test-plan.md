# Test plan: fakfun-wallet-v16 and juice-pool-stx-signer

> **STATUS: DONE.** Both contracts have Clarinet coverage and RV fuzzing.
>
> | contract | clarinet | line coverage | RV |
> |---|---|---|---|
> | `fakfun-wallet-v16` | **75 tests** | **91.0% of in-scope lines** (70.3% raw incl. faktory) | 800 runs, 13 invariants, 0 fail |
> | `juice-pool-stx-signer` | **31 tests** | **100% of reachable lines** (99.5% raw) | 1500 runs, 10 invariants, 0 fail |
>
> No contract defects found in either. Corrections to the plan as written, and the
> findings, are recorded in the "Outcome" section at the end.

Written after finishing juice-safe-v6 (108 vitest, 100% of reachable lines, 1500 RV
runs, 12 invariants). Everything below reuses that harness. The v6 work is documented
in `README-clarinet-rv.md`; this file is the plan for the next two contracts.

Scope decided with Rapha:

- **The 8 `faktory-*` functions in v16 are OUT of scope.** That code is unchanged from
  versions already tested in the past, so re-testing it buys nothing. They still have
  to COMPILE and DEPLOY, which is a separate problem handled in Phase 0.
- Everything else in v16 is in scope: 39 public functions minus 8 faktory = **31**.
- `juice-pool-stx-signer` is in scope in full: 14 public, 19 read-only, 12 error codes.

---

## Part 0: the traps already paid for

Do not rediscover these. Each one cost real time on v6.

| # | trap | what to do |
|---|---|---|
| 1 | `epoch = "latest"` cannot parse Clarity 6 | `epoch = "4.0"`, `clarity_version = 6` |
| 2 | a contract listed under `[contracts.*]` deploys under the SIMNET deployer, losing its mainnet address | list it as a **requirement** for correctness runs |
| 3 | `--coverage` only instruments PROJECT contracts | a SECOND manifest, plus an env-var-overridable deployer in the suites (see v6's `V6_DEPLOYER`) |
| 4 | simnet chain-id is TESTNET `2147483648` | never `u1` in a SIP-018 domain, or every signature returns `u4002` |
| 5 | Clarity 6 renamed `as-contract` | use `current-contract` |
| 6 | a mock returning a bare `(ok ..)` leaves the err type indeterminate and aborts contract init at Clarity 6 (this killed the v3/v12 deploys) | always `(if true (ok ..) (err u0))` |
| 7 | `sbtc-token.get-balance` sums unlocked + locked | use `get-balance-available` for deltas |
| 8 | pox-5 rejects staking with `ERR_SIGNER_NOT_FOUND u23` until the signer registers | `register-self` with a precomputed grant signature, recovery byte **`01`** (`00` gives `err u14`) |
| 9 | pox-5 records nothing below `SIGNER_SET_MIN_USTX` (50k STX, PER SIGNER) | stake >= 51k when rewards matter |
| 10 | `fakfun-wallet-core.is-whitelisted` reads `whitelisted-wallets`, NOT `verified-contracts` | the setter is `whitelist-wallet`; `set-verified-contract` does nothing for it |
| 11 | RV silently SKIPS every function taking a trait it has no eligible impl for, and still reports green (16 of 25 on v6) | add `zz-gas-station`, `zz-nft`, `zz-ft` as PROJECT contracts, then confirm the skip list is empty |
| 12 | `tests/rv-*/contracts/<name>.clar` is a BUILD ARTIFACT (contract + invariants) that nothing regenerates | copy `tests/rv-v6/build.sh`, run it before every RV run |
| 13 | RV cannot forge WebAuthn signatures, so every passkey path returns `u4002` | passkey coverage belongs in vitest and stxer, not RV |
| 14 | RV invariants over unreachable state pass vacuously | prove reachability with a temporary CANARY invariant asserting the opposite, and require it to FAIL |
| 15 | clarinet's unused-binding warnings are blind to SIP-044 allowance clauses, and its `unwrap-panic`->`try!` advice reintroduces trap 6 | ignore both on these contracts |
| 16 | `(with-staking N)` is NOT enforced in simnet (filed as stx-labs/clarinet#2491) | any allowance change must be verified on stxer |
| 17 | raw lcov undercounts multi-line expressions (filed as stx-labs/clarinet#2490) | quote reachable-line coverage, and keep the classifier that FAILS on an unclassified miss |

Two measuring scripts to copy across, both in `README-clarinet-rv.md`: the **error-code
audit** (every reachable `err-*` vs every `toBeErr`) and the **coverage classifier**.

---

## Part A: fakfun-wallet-v16

`SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-v16`, 71,158 bytes, deployed at
block 8703828. 39 public functions, 31 declared error constants of which **28 are
reachable**.

### How v16 differs from v6 (this drives the whole plan)

Shared with v6: **22 functions.** Per Rapha's standing preference, these get a
**mirrored parity suite**, not a diff test: copy the v6 files wholesale and let the
mirror flush out any behavioural drift.

v16 has **no passkey fast path at all** -- `passkey-created` appears 0 times, and the
three `execute-pending-*-now` variants do not exist. So the entire `u4003` "the passkey
cannot fast-track an op it queued itself" story from v6 does not apply here. Confirm
that is deliberate rather than a gap before writing tests around it.

**9 genuinely new non-faktory functions**, and these are where the real work is:

| group | functions |
|---|---|
| extensions | `whitelist-extension`, `execute-pending-whitelist`, `remove-extension-whitelist`, `extension-call` |
| 3-step admin seating | `propose-admin-with-signature`, `accept-admin-proposal`, `confirm-admin-with-signature`, `veto-pending-init` |
| wager | `wager-deposit` |

### Phase 0: make it deploy (the known blocker)

v16 previously would not deploy as a simnet requirement even though its local build
checked clean. That is the gate on everything else.

v16 references **26 external contracts**, against v6's handful. All 11 of the heavy ones
are already in `.cache/requirements` (`game-wager-v2-4`, `burn-bob-faktory`,
`built-on-bitcoin-stxcity`, `dexterity-traits-v0`, `faktory-trait-v1`,
`faktory-dex-trait-v2`, `prelaunch-faktory-trait-v1`, `fakfun-nfts-core`,
`fakfun-nftmarket-trait`, `xtrata-inscribe`, `fakfun-core-v2`), so the fetch work is
done and the remaining failure is a resolution or epoch problem, not a missing file.

1. List all 26 as requirements and let clarinet fetch, never hand-write
   `.cache/requirements/*.json` -- clarinet records each contract's ACTUAL deploy
   epoch and a guessed one breaks the plan.
2. Get the exact error. If it is a trait that resolves on mainnet but not simnet, stub
   only that trait, as a project contract, honouring trap 6.
3. Only if the requirement route is truly dead, fall back to the local-manifest route
   with the self-reference repointed, and accept that correctness runs are then one
   literal away from deployed bytes. Prefer the requirement.

Deliverable: `tests/cl-v16/Clarinet.toml` deploying v16 at its real mainnet address,
plus the existing `tests/fakfun-wallet-v16.test.ts` (17 scenarios, written but never
green) actually running.

### Phase 1: parity suite for the 22 shared functions

Copy the six v6 suites, repoint at v16, and fix only what genuinely differs. Expect
drift in: the absent `-now` paths, the admin-seating flow, and any threshold or
cooldown constant. Every diff found here is either a real behavioural difference worth
documenting or a bug -- do not paper over one as the other.

### Phase 2: the extension system

Needs a test extension contract (`zz-extension.clar`) implementing
`SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.extension-trait`, plus a HOSTILE one that
tries to re-enter the wallet, move assets it was not granted, or call back into
`extension-call`.

Cover: whitelisting is two-step (`whitelist-extension` then
`execute-pending-whitelist`) with the cooldown enforced; `extension-call` refuses a
non-whitelisted extension; `remove-extension-whitelist` actually revokes and a
subsequent `extension-call` fails; a removed extension cannot re-enter through a
pending op queued while it was still whitelisted. **The re-entrancy question is the
important one here** -- v6 had no equivalent surface, so nothing carries over.

### Phase 3: the 3-step admin seating

`propose-admin-with-signature` (passkey) -> `accept-admin-proposal` (the proposed
admin, no signature) -> `confirm-admin-with-signature` (passkey), with
`veto-pending-init` as the escape hatch.

Note a known bug in the v4 backup-admin flow: **`confirmAdmin` omitting `newAdmin`.**
Check whether v16 carries the same shape. Specifically test: accept from the WRONG
principal; confirm without a prior accept; confirm bound to a DIFFERENT admin than was
proposed; veto at each of the three stages; and a re-propose replacing a pending
proposal (v6's implicit-veto pattern -- verify v16 does the same).

### Phase 4: wager-deposit

Needs `game-wager-v2-4` (already cached). Cover the success path, the token-lock
interaction, and the threshold/queue behaviour if it has one.

### Phase 5: close by measurement, not by feel

Run the error-code audit until all 28 reachable codes are asserted, then the coverage
harness, then the classifier. Fix every real branch it exposes. On v6 this step alone
found 7 branches that the function and error-code audits had scored as covered,
including a whole native (`stx-transfer-memo?`) that had never executed.

### Phase 6: RV

`tests/rv-v16/` mirroring `tests/rv-v6/`: build script, `rv-bootstrap`, `rv-fund`,
trait impls so the skip list is empty, and the deployment-plan `emulated-contract-call`
prerequisites (signer registration, `whitelist-wallet`).

Carry over all 12 v6 invariants, then add v16-specific ones:

- a non-whitelisted extension is never callable
- the whitelisted-extension set never contains the wallet itself
- `pending-admin` is empty or a legal principal, never the contract
- the admin-seating latch never goes backwards

Prove the extension invariants are not vacuous with a canary before believing them.

---

## Part B: juice-pool-stx-signer

`SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-pool-stx-signer`, 358 lines. Much
smaller than the wallets but the hardest to reason about, because it is where the money
is split. **14 public, 19 read-only, 12 reachable error codes, 13 state vars/maps.**

Constants worth pinning in tests: `MAX_BIPS u10000`, `MAX_FEE_BIPS u2000` (20% cap),
`FEE_COOLDOWN u144`.

### Phase 1: admin and fee surface (cheap, do first)

`set-admin`, `set-paused`, `set-og`, `propose-fee-bips`, `confirm-fee-bips`,
`cancel-fee-bips`, `withdraw-fees`, `withdraw-all-fees`.

Cover: every function's `ERR_UNAUTHORIZED u100` from a non-admin; `ERR_PAUSED u101` on
each path that checks it; the fee two-phase (`propose` -> 144 blocks ->
`confirm`), `ERR_COOLDOWN u114` when early, `ERR_NO_PENDING_FEE u113` with nothing
pending, `cancel` clearing the slot, `ERR_INVALID_FEE u110` at `MAX_FEE_BIPS + 1` and
success exactly AT the cap; `ERR_INSUFFICIENT_FEES u111` withdrawing more than earned;
`withdraw-all-fees` zeroing the balance; `is-og` / `get-effective-fee-bips` returning a
different rate for an OG staker.

Re-propose over a pending fee change: does it overwrite (v6's pattern) or reject?
Whichever it is, pin it.

### Phase 2: the pox-5 entry points

`validate-stake` and `pox-settle-stakers` assert `contract-caller` is pox-5
(`ERR_NOT_POX5 u102`), so they CANNOT be called directly by a test. Two-part approach:

- the negative is trivial: call directly, expect `u102`
- the positive requires a real stake routed through pox-5 with this contract as the
  signer -- exactly the chain already built in `tests/juice-safe-v6-staking.test.ts`.
  Reuse it: register the signer, stake >= 51k STX from a wallet, and `validate-stake`
  fires as a side effect.

`ERR_SETTLE_FAILED u103` needs a settle that pox-5 rejects -- likely a cycle-alignment
or already-settled condition. Find the precondition by reading pox-5 rather than
guessing.

### Phase 3: the reward and tranche chain (the core)

Already proven reachable on v6: sBTC to pox-5 -> `calculate-rewards` -> `pox-claim-rewards`
-> `pay-stx-stakers` -> replay pays nothing. Extend it to the parts v6 did not touch:

- `pox-claim-rewards` twice for the same cycle -> `ERR_NO_NEW_REWARDS u109`
- `pay-stx-stakers` across MULTIPLE tranches, checking `get-tranche-paid-shares` and
  `get-cycle-total-shares` after each
- `ERR_TRANCHE_TOO_SOON u112` and `ERR_TRANCHE_UNPAID u104` -- derive the exact
  preconditions from the code, then hit each
- `sweep-tranche-dust`: `ERR_NO_DUST u105` when there is none, and a real sweep that
  moves exactly the residue and leaves the tranche fully paid
- rounding: many stakers with awkward share counts, asserting the residue is exactly
  what `get-tranche-residue` claims and that no sat is created or destroyed

**The single most valuable test here is conservation:** sum of everything paid out plus
residue plus fees equals everything that came in. Assert it over a multi-staker,
multi-tranche cycle.

### Phase 4: RV -- this contract is the best RV target of the three

Pure accounting over 13 state vars, no WebAuthn anywhere, so RV can actually drive most
of the surface rather than bouncing off signatures. Invariants:

| invariant | forbids |
|---|---|
| `stx-paid <= stx-pot` | paying out more than came in |
| `tranche-paid-shares(c) <= cycle-total-shares(c)` | paying a share twice |
| `fee-bips <= MAX_FEE_BIPS` | a fee above the 20% cap |
| `pending-fee empty or <= MAX_FEE_BIPS` | an illegal fee sitting queued |
| `earned-fees <= stx-pot` | fees exceeding the pot |
| `is-tranche-fully-paid` monotonic | a settled tranche un-settling |
| `get-stx-owed <= stx-pot - stx-paid` | owing more than remains |
| `admin` is never the contract itself | the v6 lesson, applied here |
| `tranche-count` monotonic | tranche accounting going backwards |

`rv-bootstrap` seats the caller as admin. An `rv-fund` equivalent is needed to put STX
and sBTC in the pot. Registration goes in the deployment plan as on v6.

Then the canary: assert `tranche-count` is always `u0` and require RV to break it. If
it survives, the tranche invariants are vacuous and the whole phase is theatre.

### Phase 5: measure

Error-code audit to 12/12, then coverage, then the classifier. The signer is small
enough that reachable-line coverage should be attainable in full.

---

## Explicitly NOT in scope

The 8 `faktory-*` functions: `faktory-execute`, `faktory-execute-limit`,
`faktory-place-order`, `faktory-process`, `faktory-process-claim`,
`faktory-fee-airdrop`, `faktory-burn-bob`, `faktory-nft-execute`.

Unchanged from previously tested versions. They must still deploy, which Phase 0
handles. If any of them is ever edited, this exclusion expires.

## Suggested order

1. **Part B Phases 1-3** -- the signer is small, self-contained, and it is where the
   money is. Fastest path to real value.
2. **Part A Phase 0** -- unblock v16, since everything else depends on it.
3. **Part A Phases 1-5** -- parity, then the 9 new functions, then measure.
4. **RV for both** (A6, B4) once the vitest suites define what correct means.


---

# Outcome

## Corrections to this plan, found by doing it

1. **The v16 deploy blocker was none of the guesses in Phase 0.** Not missing deps (all
   11 heavy ones were already cached), not the source (the cached mainnet copy is
   byte-identical to the repo), not the epoch. **Clarinet publishes v16 BEFORE
   `juice-pool-stx-signer`, which v16 depends on** -- both in batch 7, v16 first. The
   publish aborts with a useless `Runtime error while interpreting ...fakfun-wallet-v16`
   and every later call says the contract does not exist, which sends you hunting in the
   wrong place. Hand-reordering the plan does NOT survive: clarinet rewrites it on the
   next run. Fix: drop v16 from requirements and publish it from the suites via
   `deployV16()` with sender `SPV9K21...`, which lands it at its real mainnet address
   after every dependency exists. A third clarinet issue worth filing.

2. **Only `validate-stake!` is pox-5-gated** (and the `!` matters -- a naive grep
   truncates the name). `pox-claim-rewards`, `pay-stx-stakers` and `pox-settle-stakers`
   are all PERMISSIONLESS, and `ERR_PAUSED u101` is reachable from `validate-stake!`
   alone -- so the pause is only observable through a real stake attempt, which is the
   point: it stops NEW delegation without disturbing existing positions.

3. **v16 has no passkey fast path at all**, confirmed: `passkey-created` appears 0
   times and the three `-now` variants do not exist, so v6's `u4003` self-approval rule
   has no equivalent.

## The finding that matters most

**`extension-call` invokes the extension under `(with-all-assets-unsafe)`**
(`fakfun-wallet-v16.clar:848`). A whitelisted extension can move ANYTHING the wallet
holds. The whitelist is not a convenience list, it is a grant of full custody, and the
two-step + passkey gate on whitelisting is the only real control. `onboard`
pre-whitelists `xtrata-inscribe`.

`tests/cl-v16/contracts/zz-extension.clar` is deliberately hostile and drains both STX
and sBTC once whitelisted, so this is demonstrated rather than asserted. Anything that
weakens the whitelist path is a custody change, not a convenience change.

## Other findings, none of them defects

- **`toggle-token-lock` is asymmetric** in both wallets: ON accepts a passkey, OFF
  requires the admin (`v16:386`). A stolen passkey can lock the wallet but must not be
  able to unlock it. My first test had this backwards.
- **`set-admin` on the signer has NO guard.** The contract itself or the burn address
  can be seated and nothing on chain can undo it. Pinned as a footgun; the RV invariant
  `admin-not-contract` is what would catch a sequence reaching it.
- **`confirm-fee-bips` unwraps `pending-fee` before `assert-admin`**, so a stranger can
  distinguish "no pending fee" (u113) from "not admin" (u100). Harmless, but it means an
  admin-only sweep has to seed a proposal first to reach the authorisation check.
- **u4005 orphaned passkey** behaves as in v6: `pubkey-to-admin` is never rewritten
  while the admins map rotates, so after a transfer the wallet is single-factor under the
  new admin.
- **u4016 sits behind the signature check** and the hash is built from the PENDING
  values, so reaching it means signing over the empty (all-zero) pending config.

## Two error codes that are genuinely unreachable

- **`u109 ERR_NO_NEW_REWARDS` is shadowed.** The signer's `(> claimed u0)` assert sits
  after `(try! POX5 claim-rewards)`, and pox-5 answers `u32 ERR_NO_CLAIMABLE_REWARDS`
  first. u109 can only fire if pox-5 returns ok with `total-rewards u0`.
- **`u103 ERR_SETTLE_FAILED` is unreachable in simnet.** pox-5's
  `claim-staker-rewards-for-signer` returns `(ok u0)` for a future cycle, a bogus
  bond-index, an unknown principal and an empty batch. All four probes are in the test,
  recorded rather than faked.

Both are defence in depth, correct to keep. Same category as v6's two
`MAX-CONFIG-COOLDOWN` clamp arms.

## The highest-value test written

Conservation over a two-staker cycle in `signer-rewards.test.ts`:

```
tranche-paid + residue        == pot          (to the sat)
net-to-stakers + fees         == tranche-paid (to the sat)
```

asserted both with and without a fee. **Two stakers rather than one, because a single
staker hides share splitting, the fee cut, and the rounding residue that
`sweep-tranche-dust` exists for.** Also covered: `get-stx-owed` predicting a payout
exactly, an OG and a normal staker in the SAME call (the OG keeps its full gross), the
`stx-paid` replay guard, and a zero-share staker skipped rather than paid.

## Traps added to the list

18. **rv requires the target to define `update-context` and a `context` map itself** --
    it is NOT injected. Without them the run dies with `Method 'update-context' does not
    exist`.
19. **Matching on `sbtc-token.get-balance` does not type-check** -- its err type is
    indeterminate, the same fault that aborted the v3/v12 deploys. Use `unwrap-panic`
    in any invariant that reads it.
20. **Clarinet ignores inter-requirement dependency order** (see correction 1).


---

# Measured line coverage, and a correction to the numbers above

The first pass reported "31/31 in-scope functions covered" for v16 and stopped there.
**That metric was too loose and the claim was wrong.** It grepped test files for each
function NAME, which counts a name appearing in a propose-only test, or in a comment.
Measuring lines with clarinet's own `--coverage` said otherwise:

- **`confirm-max-gas-amount` had NEVER been called.** The entire function, the second
  factor of the max-gas raise, untested while scoring as covered.
- `get-pending-max-gas` never read.
- **the memo arm of the STX paths never executed** -- the same miss as juice-safe-v6,
  repeated, because every test passed `none`.
- the gas channel never paid on 12 v16 sites, and the period fuse never tripped.
- `veto-operation`'s passkey branch never taken.
- `update-stake-stx-juice` and `unstake` passkey branches never taken at all.
- `recover-inactive-wallet`'s SUCCESS path never ran -- only the u4009 refusal, so the
  one mechanism that rescues an abandoned wallet was unexercised.

In-scope line coverage went **58.5% -> 75.6% -> 85.1% -> 87.3% -> 91.0%** as those were
closed, and every non-faktory function is now actually called.

## Where the numbers come from

| number | meaning |
|---|---|
| 70.3% raw | the whole file, including the 262 instrumented lines inside `faktory-*` |
| **91.0%** | excluding `faktory-*` and `get-byte` (a private helper only faktory uses) |
| 61 of the 80 remaining | continuation tokens lcov cannot credit (see stx-labs/clarinet#2490) |
| 19 | genuinely uncovered, listed below |

Still uncovered in-scope, and why:

- **2 lines**: the `MAX-CONFIG-COOLDOWN` clamp arms in `confirm-max-gas-amount` and
  `set-wallet-config`. Unreachable by design -- cooldown is bounded at every entry
  point, exactly as in v6.
- **4 lines**: `(match gas ... true)` else-arms on four paths where the with-station
  case is covered and the without-station case is not.
- **13 lines**: `wager-deposit`'s success path. It asserts
  `game-wager-v2-4.get-registered-wallet(pubkey) == this wallet`, so driving it needs
  the wallet registered in that external contract first. Only the non-admin rejection
  is covered. This is the one honest hole left.

## The signer reached 100% of reachable lines

199/200 raw. The single uncovered line is `settle-one`'s
`err-code (merge acc { failed: true })` arm -- the `u103` path already proven
unreachable in simnet with four probes. Measuring found two real gaps first:

- `get-stx-owed`'s OG branch, so the number a UI would show an OG staker had never been
  checked against what they actually receive. It is now asserted equal.
- `pay-one`'s `(if (> net u0) transfer true)` else-arm: a staker whose share of the pot
  floors to zero is still RECORDED (`stx-paid` set to 0, shares counted), which is what
  stops it being retried forever. Reached with wildly uneven stakes.

## Reproducing

Coverage instruments PROJECT contracts only -- not requirements, and **not contracts
published at runtime via `deployContract` either**, which is how the correctness suites
publish v16. So each contract has a second harness:

```
V16_DEPLOYER=ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM npx vitest run \
  tests/fakfun-wallet-v16*.test.ts -- --manifest tests/cl-v16-cov/Clarinet.toml --coverage

SIGNER_DEPLOYER=ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM npx vitest run \
  tests/signer-*.test.ts -- --manifest tests/cl-signer-cov/Clarinet.toml --coverage
```

The suites read the deployer from those variables, defaulting to the real mainnet
principals, so correctness runs against `tests/cl-v16` and `tests/cl-signer` are
untouched (75 and 31 passing respectively, verified after every change).

- `tests/cl-v16-cov` differs from the deployed v16 by exactly **two** self-reference
  literals, repointed at the simnet deployer.
- `tests/cl-signer-cov` is **byte-identical** to the deployed signer: it has no
  self-references at all.
- `deployV16()` is a no-op when `V16_DEPLOYER` is set, since the coverage plan publishes
  the wallet itself and a second publish would collide.

## One more correction

**The recovery window in v16 is deliberate, not a footgun.** `recover-inactive-wallet`
requires `tx-sender == recovery-address`, and v16 leaves that at the burn address
because fakfun wallets onboard a user with a passkey and nothing else -- there is no
recovery principal to record yet. juice-safe-v6 can demand it at onboard because a safe
is created by someone who already has an address; a consumer wallet is not.

So the obligation is OPERATIONAL: the user journey has to walk the user through
`propose-recovery` / `confirm-recovery` later, and until it does, an abandoned wallet
cannot be rescued. Both states are asserted -- unrecoverable before designation, and
recovering correctly after it -- so the window is measured rather than assumed away.

## And on the faktory exclusion

Excluded because those functions are unchanged and **already have Clarinet tests in
another repo**, not because they are untested. They still have to compile and deploy,
which Phase 0 handled. If any of them is edited, this exclusion expires and the tests
should be brought alongside these.
