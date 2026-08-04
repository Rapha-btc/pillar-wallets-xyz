# juice-safe-v5 / fakfun-wallet-v15 -- what changed and why

Status: **written, not deployed, not committed.** Sim coverage for the generation
below these two is in `README-v4-v14-sims.md`.

Three new contracts:

| contract | role |
|---|---|
| `smart-wallet-standard-auth-helpers-v9` | two new challenge builders. **Deploys FIRST** |
| `juice-safe-v5` | `juice-safe-v4` plus the six changes below |
| `fakfun-wallet-v15` | `fakfun-wallet-v14` plus five of them |

Both wallets reference helpers-v9 by fully-qualified principal and fail analysis
without it.

---

## Why this version exists

The trigger was dead code: `enroll-dual-stacking`. The substance is the config
surface.

In v4, `signal-config-change` and `set-wallet-config` are both
`(is-authorized none)` -- admin key alone -- and `cooldown-period` has no floor.
So a stolen admin key signals a change, waits one current cooldown (itself clamped
to `MAX-CONFIG-COOLDOWN u4032`), sets `cooldown-period` to `u0`, and every delay in
the wallet collapses at once.

**The cooldown exists to protect against a stolen admin key, and the thing that
can switch off the cooldown is the admin key.** The passkey holder can veto
individual pending operations but cannot cancel a signalled config change and
cannot evict the thief alone, because `propose-transfer-wallet` is admin-gated. So
in v4 the protection is one cooldown's worth of warning, once, plus core events.

v5/v15 break that circle.

---

## The six changes

| # | change | v5 | v15 |
|---|---|---|---|
| 1 | `enroll-dual-stacking` and its trait import removed | yes | yes |
| 2 | `set-wallet-config` requires the passkey, all three values bound | yes | yes |
| 3 | `confirm-max-gas-amount` requires the passkey, pending amount bound | yes | yes |
| 4 | `cooldown-period` floored at `u144`, ceilinged at `u4032` | yes | yes |
| 5 | recovery address required at `onboard` | yes | n/a |
| 6 | cannot be seated as its own admin | yes | yes |

### 1. enroll-dual-stacking removed

Dual stacking as this template reached it was pox-4-era: built against
`SP2PABAF9....xbtc-sbtc-swap-v2.enroll-trait`, same generation as the
`stack-stx-fast-pool` and `delegate-stx` paths that came out in the pox-5 port.
pox-4's last reward cycle was 140.

Friedger, on the current state: *"For the current cycle 140, I expect it still to
run. However, new enrolment does not work because pox 4 is dead."* So the entry
point is surface area for an action no new wallet can complete.

Removed: the `define-public`, the `<dual-stacking-trait>` import, the
`build-enroll-dual-stacking-hash` challenge and the `log-enroll-dual-stacking`
core event.

The trait was a caller-supplied ARGUMENT, never a pinned constant, so nothing
downstream was ever bound to a specific enroll contract by these bytes.

### 2 and 3. The passkey on step two

`set-wallet-config` and `confirm-max-gas-amount` now take a **required**
`sig-auth`. `signal-config-change` and `propose-max-gas-amount` stay admin-only.

So each pair spans two DIFFERENT factors across two steps. A stolen admin key can
start a config change or propose a gas raise, and can never finish either.

**The hashes bind the values, not just consent.** `build-set-wallet-config-hash`
covers `{auth-id, stx-threshold, sbtc-threshold, cooldown-period}` and
`build-confirm-max-gas-amount-hash` covers `{auth-id, amount}`, where `amount` is
what is sitting in `pending-max-gas`. A bare consent signature would let a
compromised admin show the user one set of thresholds, collect a signature for
"a config change", then call the function with different numbers. The wallet
rebuilds the hash from its own arguments, so any substitution fails the check. On
max-gas it also stops a signature collected for a modest raise being replayed
against a larger proposal swapped in afterwards.

### 4. cooldown-period is bounded both ways

`MIN-COOLDOWN u144` floor, `MAX-CONFIG-COOLDOWN u4032` ceiling. v4 bounded
neither, and both directions were footguns:

- **No floor** let the delays be collapsed to `u0`, which is the attack in "Why
  this version exists".
- **No ceiling** let an absurd value freeze every pending operation instead. Same
  footgun mirrored. This matters more now, not less: config is passkey-gated after
  change 2, so a pathological cooldown set before a recovery can never be
  repaired.

The ceiling reuses `MAX-CONFIG-COOLDOWN` because the wait for a config change was
already clamped to it. Nothing is gained by a cooldown longer than the longest
wait the contract will ever enforce.

`err-cooldown-too-long u4019` was **declared in v4 and never used** -- the ceiling
was intended at some point and never wired up. It is wired up here.

### 5. Recovery is mandatory at onboard -- the safe only

In v4, `onboard` took `(recovery (optional principal))`. Passing `none` meant a
lost admin key lost the funds outright, permanently. That was the only genuinely
unrecoverable vector in the contract, and it was chosen silently at onboard time
by whoever called it.

`juice-safe-v5` takes a bare `principal` and was intended to reject three values:
the burn sentinel `SP000000000000000000002Q6VF78`, this contract, and the owner.

> **CORRECTION, found by simulation.** Only two of those three asserts exist in
> the code. The burn-sentinel check was never written, so `onboard` accepts the
> sentinel and mandatory recovery is NOT enforced on chain. Proven at step A1 of
> [`bcf78832`](https://stxer.xyz/simulations/mainnet/bcf788320a92611df3f7aed9edc21583).
> `onboard` is `FAKFUN-DEPLOYER`-gated so this is a footgun for our own backend,
> not attacker-reachable. See README-v6-v16-sims.md.

The other two checks are present and verified: recovery cannot be this contract, and
cannot be the owner, since a recovery address equal to the owner recovers nothing
from a lost owner key.

**Not applied to `fakfun-wallet-v15`, deliberately.** Its `onboard` takes only the
pubkey, and `recovery-address` is written solely by the propose/confirm flow. It
also isn't a safe. A v15 wallet whose owner never proposes a recovery address has
no recovery path, which is the same permanent-loss shape -- accepted for that
product, not for the safe.

### 6. Cannot be seated as its own admin

Guarded at all three `admins` write paths (`onboard`, `confirm-transfer-wallet`,
`recover-inactive-wallet`) plus `propose-recovery`, using the existing
`err-unauthorised u4001`.

`as-contract?` rebinds `tx-sender` to the wallet's own principal. If the wallet
appeared in its own `admins` map, a caller-supplied gas station could re-enter
with `sig-auth: none`, pass `is-admin-calling tx-sender`, and drain the wallet on
a relay compromise alone.

That attack is **verified failing** on both v4 and v14 --
[`26920916`](https://stxer.xyz/simulations/mainnet/269209165482e594bea782cd066b3b11)
and [`2ea0effb`](https://stxer.xyz/simulations/mainnet/2ea0effbc0699f874ce4236416dd246c),
where the station recorded `tx-sender` as the wallet's own contract principal and
still got `(err u4001)`. But nothing **enforced** the precondition that result
depends on. Clarity's `principal` type does not distinguish a standard principal
from a contract one.

---

## Decisions taken, and what was rejected

### Flat passkey on step two, not an asymmetric gate

**Rejected alternative:** gate only changes that *weaken* protections (lowering
the cooldown, raising thresholds) behind the passkey, leave *strengthening* ones
(raising the cooldown, lowering thresholds) admin-only.

The argument for it was that config is now frozen for a recovered owner, since the
registered passkey belongs to the previous owner and **there is no post-onboard
passkey-add path at all** -- all three pubkey writes live in `onboard` and nowhere
else, which is deliberate: any admin-reachable passkey-add would let one
compromised key satisfy both factors.

**Why flat won:** a recovered owner can still get the value out. Under-threshold
transfers need no signature, and `execute-pending-stx-transfer` is
`(is-authorized none)` -- admin key alone after the cooldown. So the recovered
admin drains to a fresh wallet: small amounts immediately, large amounts after 144
blocks. Frozen config costs the ability to keep *using* that wallet, not the money
in it.

**Accepted consequence, worth writing into support docs:** the recovery playbook is
*migrate out*, not *carry on*. A recovered wallet's thresholds and cooldown are
whatever they were, forever.

### The self-check, not a reject-all-contracts check

**Rejected alternative:** `principal-destruct?` to refuse ANY contract principal
as admin, since `name` is `none` for a standard principal and `(some ...)` for a
contract.

**Why the narrow check won:** the re-entrancy hole is *specifically* about self.
Inside `as-contract?` the wallet's `tx-sender` becomes the wallet's own principal,
never some other contract's, so rejecting all contracts adds nothing against that
attack. Meanwhile it would permanently foreclose contract-owned wallets -- a DAO,
a multisig, or a pillar-SDK builder contract as admin -- which the SDK direction
may want. It is also cheaper to audit: one `is-eq` versus `principal-destruct?`
matched on both branches plus a new error code.

**What the narrow check does not catch:** seating some *other* contract that
exposes a public function anyone can call which forwards into the wallet. That is a
property of whichever contract was deliberately chosen, and it takes the recovery
key or the 2FA path to set.

### No burn-address guard on propose-recovery

Initially added, then removed as dead weight. `confirm-recovery` already asserts
`(not (is-eq pending 'SP000000000000000000002Q6VF78))` before writing, so proposing
the sentinel can never take effect.

It **is** load-bearing at `onboard`, which writes `recovery-address` directly with
no confirm step -- so passing the sentinel there would leave recovery unset and
defeat "mandatory" on the spot. Same value, two different situations.

### The self-check on propose-recovery stays

Not symmetric with the above, and not redundant. `recover-inactive-wallet` gates on
`tx-sender == recovery-address`, and `as-contract?` makes `tx-sender` this
contract, so a contract-valued recovery address is a path a gas station could
reach. `update-activity` running first makes it unreachable today; the guard keeps
it unreachable if that ordering ever changes.

---

## New and reused error codes

| code | name | status |
|---|---|---|
| `u4019` | `err-cooldown-too-long` | declared in v4, **never used**, wired up here for the ceiling |
| `u4031` | `err-cooldown-too-short` | new, free in both wallets (v14 used up to `u4030`) |
| `u4001` | `err-unauthorised` | reused for the self-admin and recovery guards, no new code |

---

## Breaking changes for callers

| function | change |
|---|---|
| `set-wallet-config` | gains a required `sig-auth`, ABI change |
| `confirm-max-gas-amount` | was zero-arg, gains a required `sig-auth`, ABI change |
| `onboard` (v5 only) | `recovery` is a bare `principal`, not an `(optional principal)` |
| `enroll-dual-stacking` | gone from both |

No FE or BE currently calls the first two, so 1 and 2 cost nothing today.

`pillar-be`'s `/api/bot/enroll-dual-stacking` cron is being deleted along with
dual stacking -- file is
`pillar/backend/pillar-be/server/routes/api/bot/enroll-dual-stacking.get.ts`, and
there is a chainhook handler referencing it at `pillar-core.post.ts:97`.

---

## Deploy order

```
1. smart-wallet-standard-auth-helpers-v9      <- both wallets need it to analyse
2. juice-safe-v5 / fakfun-wallet-v15          <- Clarity 6
3. fakfun-wallet-core.set-verified-contract(<wallet>, none)
4. onboard
```

Pass `none` for the hash in step 3 -- the core derives it via
`(contract-hash? contract)`, guaranteeing it matches the bytes on chain. Skipping
step 3 is why `onboard` fails `err-not-authorized`; v4 and v14 are still sitting
unregistered for exactly that reason.

**Run `simul-deploy-v5-v15.js` before spending a deploy.** v3 and v12 aborted at
contract init with `(err none)` because of a `try!` over a contract-call whose err
type is indeterminate at Clarity 6, and `clarinet check` cannot catch it -- 3.19.0
and 3.23.1 both accept an invented allowance form and both accept `no-such-method`
on a constant target. Worse, `clarinet check` currently cannot parse
`Clarinet.toml` at all, because it rejects `clarity_version = 6` paired with
`epoch = "latest"`. stxer running the real VM is the only gate that works.

The new code adds no `try!`-over-contract-call, so the specific v3/v12 fault should
not recur. Run the gate anyway.

---

## Still to do

- `Clarinet.toml` entry for `smart-wallet-standard-auth-helpers-v9`
- BE templates and `deploy-contract.post.ts` entries for all three, Clarity 6
- `simul-deploy-v5-v15.js`, the pre-deploy gate
- **Harness arity.** The v4 suite calls `set-wallet-config` and
  `confirm-max-gas-amount` with the old signatures, so `simul-max-gas-cooldown-v4.js`
  repointed at v5 fails on arity until the passkey argument is threaded through,
  with a new challenge built against helpers-v9. The v5 suite is not the pure
  one-line repoint the v4 suite was.
- New coverage these changes deserve: config change rejected with the admin key
  alone, cooldown floor and ceiling rejections, a passkey signature bound to one
  set of thresholds rejected against another, and the self-admin guard firing.

## Open, carried over from v4

- **`(err none)` on one exotic shape.** A gas station re-entering `stx-transfer`
  from inside the gas frame aborts the outer transaction with `(err none)` on both
  v4 and v14. Undiagnosed. It is a runtime quirk on a shape no real caller hits,
  not the init-time fault that killed v3/v12, and it does not block a deploy.
  Needs a probe bisect like `simul-c6-bisect.js` if anyone wants it closed.
- **Per-site gas coverage is a sample.** 3 of 13 enforced sites on v4 and 2 of 25
  on v14 were driven with a real station. All 42 sites were statically confirmed
  to use the identical canonical form and to be signature-gated. See
  `README-v4-v14-sims.md`.
- **v14/v15 has no fuse-trip test.** `simul-gas-metering-v4.js` needs a twin.
