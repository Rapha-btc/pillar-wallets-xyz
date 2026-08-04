# juice-safe-v4 / fakfun-wallet-v14 -- simulations, findings, and what is NOT covered

Both contracts are DEPLOYED on mainnet at **Clarity 6**, block 8697401, under
`SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22`. `juice-safe-v3` / `fakfun-wallet-v12`
at block 8697270 were the attempt that aborted on the C6 indeterminate-err-type
fault -- see the header of `simul-deploy-v4-v14.js`.

Everything below runs against the **deployed bytes**. Nothing is redeployed
except throwaway gas stations.

---

## Status at a glance

**These supersede `juice-safe-v2` and `fakfun-wallet-v11`.** The older
`README-pox5-staking-sims.md` still describes the v2/v11 generation; read it for
the pox-5 staking surface and the v0/v1/v9/v10 history, not for which contract to
deploy.

| contract | state |
|---|---|
| `juice-safe-v4` | deployed C6, **185 assertions pass**, use this |
| `fakfun-wallet-v14` | deployed C6, **86 assertions pass**, use this |
| `juice-safe-v3` / `fakfun-wallet-v12` | deploy aborted, `(err none)` |
| `juice-safe-v2` / `fakfun-wallet-v11` | superseded, gas fee unmetered |

**BLOCKER: neither is registered canonical.** `get-verified-contract-hash`
returns `none` for both, so `onboard` fails and no wallet can be created until
someone calls, from `SPV9K21T...`:

```
fakfun-wallet-core.set-verified-contract(<wallet principal>, none)
```

Pass `none` for the hash -- the core derives it via `(contract-hash? contract)`,
guaranteeing it matches the bytes on chain.

---

## Simulations

**272 assertions, 0 contract defects.**

| harness | target | result | simulation |
|---|---|---|---|
| `simul-juice-safe-v4-lifecycle.js` | v4 | **62/62** | [`af5d782f`](https://stxer.xyz/simulations/mainnet/af5d782fcbcd36715adbe1ca62b2ff73) |
| `simul-v14-full.js` | v14 | **54/54** | [`d922713e`](https://stxer.xyz/simulations/mainnet/d922713e211ae9157ca96795ccb4c7b3) |
| `simul-tranche-attack-v4.js` | v4 | **39/39** | [`944aa8b2`](https://stxer.xyz/simulations/mainnet/944aa8b2eda0df5dc41dfe539103be66) |
| `simul-gas-metering-v4.js` | v4 | **26/26** | [`3b696c2d`](https://stxer.xyz/simulations/mainnet/3b696c2df233113471807c6fae3b93bb) |
| `simul-max-gas-cooldown-v14.js` | v14 | **17/17** | [`6ff6b7ee`](https://stxer.xyz/simulations/mainnet/6ff6b7eea67f04c38c258043c7a9f3ba) |
| `simul-juice-safe-v4-recovery.js` | v4 | **16/16** | [`2f682f2e`](https://stxer.xyz/simulations/mainnet/2f682f2e3bab28228a6108da6ccf28bd) |
| `simul-reentrancy-v14.js` | v14 | **15/15** | [`2ea0effb`](https://stxer.xyz/simulations/mainnet/2ea0effbc0699f874ce4236416dd246c) |
| `simul-max-gas-cooldown-v4.js` | v4 | **14/14** | [`9e2b42bb`](https://stxer.xyz/simulations/mainnet/9e2b42bbdade18dea87a189cf6064cdb) |
| `simul-reentrancy-v4.js` | v4 | **11/15 as run** | [`26920916`](https://stxer.xyz/simulations/mainnet/269209165482e594bea782cd066b3b11) |
| `simul-juice-safe-v4.js` | v4 | **10/10** | [`e9ca634c`](https://stxer.xyz/simulations/mainnet/e9ca634ce29c0bff2b2617951cffd4c6) |
| `simul-v4-v14-staking.js` | v4 | **8/8** | [`cc15f2cd`](https://stxer.xyz/simulations/mainnet/cc15f2cd676614bf8fcf5237e93e8664) |
| `simul-deploy-v4-v14.js` | both | deploy gate | run pre-deploy |
| `simul-c6-bisect.js` | probes | diagnostic | isolates C6 faults |

The four red lines in the `simul-reentrancy-v4.js` artifact are a **harness**
defect, not contract behaviour: the premise was asserted on variant A's recorded
value, and variant A aborts its own transaction, so that value reads as the
initial burn-address default. Both re-entrancy harnesses now assert on variant B.
The file will read 15/15 on its next run; the linked artifact predates the fix.

Five of these are one-line repoints of the v2-era harnesses at v4/v14, with the
assertions untouched. The point of those is that the gas-metering rewrite and the
Clarity 6 allowance renames did not regress anything that already worked.

---

## The Clarity 6 allowance renames

`simul-v4-v14-staking.js` -- [`cc15f2cd`](https://stxer.xyz/simulations/mainnet/cc15f2cd676614bf8fcf5237e93e8664)

```
unstake        (with-all-assets-unsafe) -> (with-pox)      [SIP-044, C6 only]
stake          (with-stacking N)        -> (with-staking N)
stake-update   (with-stacking total)    -> (with-staking total)
```

```
stake 500 STX          <- (with-staking amount-ustx)        (ok true)
top-up +100 STX        <- (with-staking (+ locked increase)) (ok true)
extend at max cycles                                        (err u20)   correct
extend +1 after a cycle elapsed                             (ok true)   96 -> 97
no-op update (0 amount, 0 cycles)                           (err u4026)
UNSTAKE                <- (with-pox)                        (ok true)
  staker-info          num-cycles truncated 97 -> u1
  stx-account          locked u600000000, unlock pulled fwd
advance 1600 burn blocks
  stx-account          locked u0, unlocked u800000000        all STX back
  staker-info          none                                  position gone
```

A wrong or missing allowance is loud -- `(err u128)` = MAX_ALLOWANCES, "an asset
class moved with no allowance covering it", which is exactly how `juice-safe-v0`
failed. So `(ok true)` here is real evidence.

**And the lock is now genuinely enforced.** `stx-account` reports
`locked u500000000` after the stake rather than the `locked u0` the emulator used
to return, so `(with-staking N)` is actually checked rather than waved through.
That was fixed upstream in stxer/stxer-sdk#7. Green runs on this surface meant
much less before that fix.

---

## Gas metering and the fuse

`simul-gas-metering-v4.js` -- [`3b696c2d`](https://stxer.xyz/simulations/mainnet/3b696c2df233113471807c6fae3b93bb), 26/26

This is the surface v3/v4 added and nothing tested. `simul-max-gas-cooldown.js`
covers the two-step raise of `max-gas-amount`, which is v2 code. Six properties,
each with a station built to break exactly one.

**P1. The fee is a BALANCE DELTA, not the station's self-report.** A LIAR station
reports `get-gas-amount u9999` and takes `u10`.

```
gas counter          u0 -> u10        charged the delta
attacker received    u10 exactly
```

**P2. A credit station is charged u0 and does not refill the budget.** A station
that sends `u50` sBTC IN:

```
gas counter          u10 -> u10       no underflow, no refill
wallet sBTC          rose by u50
```

**P3. The fuse.** `max-gas-per-period` = `max-gas-amount u1000 *
GAS-CALLS-PER-PERIOD u25` = `u25000`. The check is `gas-so-far + fee > cap`
evaluated BEFORE the counter moves, so with `u10` already spent from P1 the 25th
full-price call is the one that crosses. Step 42 of that simulation:

```
call #23                     (ok true)
call #24                     (ok true)
call #25                     (err u4018)      err-threshold-exceeded
gas after the trip           u24010           = 10 + 24 x 1000
attacker's total take        u24010           matches the counter to the sat
```

`gas` stayed at `u24010` rather than `u25010`, so the blown call was charged
nothing rather than partially charged. That is the pre-check ordering working.

**25 calls is the arithmetic minimum, not laziness.** The cap is derived as
`max-gas-amount * 25`, and the `(with-ft sbtc-token max-gas-amount)` allowance
caps any single fee at `max-gas-amount`, so exactly 25 full-price calls is what
it takes to reach it. Raising `max-gas-amount` raises the cap in lockstep.

**P4. gas and sbtc are disjoint.** With the fuse fully blown, a `sip010-transfer`
of 1000 sats still executed immediately instead of queueing:

```
recipient sBTC       delta u1000      moved, did not queue
sbtc counter         u0 -> u1000
gas counter          u24010 unchanged
```

24 gas payments and the sBTC transfer budget was never touched. If this ever
queues instead, the rejected "count the fee in sbtc too" design has crept back
in -- see `README-GAS-METERING.md`.

**P5. A blown fuse is not a lockout.** Both escape routes work with the fuse
spent: a passkey-signed call with `gas: none`, and the admin EOA with no
`sig-auth`.

**P6. The period rolls.** After 150 burn blocks (past `cooldown-period u144`),
`gas` restarted at `u1000` from that call's fee alone and `period-start`
advanced 961050 -> 961200.

**P3b. Found the hard way: `gas` is IGNORED on an unsigned call.** The `gas`
match sits INSIDE the `sig-auth` Some-branch (`juice-safe-v4.clar:701`), so an
admin-path call with `sig-auth: none` that passes a station succeeds and the
station is never paid, silently, with no error. Not a vulnerability -- it is
precisely why a stolen admin key alone cannot drain through gas -- but **a
relayer that broadcasts an admin-path call expecting a fee gets nothing and no
signal**. Worth checking whether pillar-be's relayer ever takes that path. Now a
permanent assertion rather than a note.

An earlier revision of this harness drove the fuse loop on the admin path and
"passed" 25 calls having charged zero. The harness now fails if the fuse test
completes without the counter approaching the cap, so a no-charge run cannot
masquerade as a working fuse again.

---

## Re-entrancy from a hostile gas station

`simul-reentrancy-v4.js` -- [`26920916`](https://stxer.xyz/simulations/mainnet/269209165482e594bea782cd066b3b11)
`simul-reentrancy-v14.js` -- [`2ea0effb`](https://stxer.xyz/simulations/mainnet/2ea0effbc0699f874ce4236416dd246c), 15/15

**The attack.** The station is chosen by whoever relays and is NOT covered by the
signed hash -- `build-stx-transfer-hash` covers only
`{topic, auth-id, amount, recipient, memo}`. So a compromised relay can
substitute any contract as the station on an otherwise legitimate, correctly
signed user call. The wallet pays it inside:

```clarity
(as-contract? ((with-ft SBTC-CONTRACT "sbtc-token" (var-get max-gas-amount)))
  (try! (contract-call? g pay-gas)))
```

`as-contract?` rebinds `tx-sender` to the wallet's own principal, so for the
duration of `pay-gas` attacker-controlled code runs while `tx-sender` IS the
wallet. Instead of taking its fee, the station calls back in with
`sig-auth: none`, which routes to `(is-admin-calling tx-sender)`. If the wallet
trusted itself, a compromised relay alone would have authorised an arbitrary
transfer holding no key and forging no signature.

**Result on both wallets:**

```
tx-sender the wallet saw during pay-gas   <the wallet's own contract principal>
re-entrant sip010-transfer                (err u4001)   err-unauthorised
did it succeed?                           false
attacker sBTC                             unchanged
attacker STX                              unchanged
is-admin-calling(wallet's OWN principal)  (err u4001)
is-admin-calling(OWNER) control           (ok true)
```

**Why it fails.** Every write to `admins` takes a standard principal. On v4:
1761 at onboard, 1247 on 2FA transfer, 1401 on recovery; 1746 seeds the burn
address and 1760 deletes it. On v14: 1990, 1722, 2107, with 2507/1989 for the
placeholder. The wallet's own contract principal is never inserted.

**The probe amount matters.** Variant B re-enters `sip010-transfer` for 500 sats,
deliberately BELOW `max-gas-amount u1000`, so the gas frame's one allowance would
have permitted the movement. That isolates the admin gate as the barrier rather
than the allowance. The allowance is the backstop for over-taking, already
covered by the hostile station in `simul-max-gas-cooldown-v4.js`.

**What this adds over reading the source.** The source argument rests on one
premise: that `as-contract?` under Clarity 6 rebinds `tx-sender` as described. So
each station records the `tx-sender` it observed into its own data-var and the
harness asserts on that recorded value. Both runs confirm it. That premise is
exactly the class of thing the tooling gets wrong -- `simul-deploy-v4-v14.js`
records clarinet 3.19.0 and 3.23.1 both accepting an invented allowance form and
both accepting `no-such-method` on a constant target.

The stations swallow the inner response with `match` rather than `try!`. A
propagated error would abort everything and leave nothing to read, which is what
makes the inner `(err u4001)` observable at all.

v14 is the stronger of the two runs: 25 GAS-ENFORCED surfaces to v4's 13,
including `extension-call`, `wager-deposit` and nine `faktory-*` functions, so it
hands a caller-supplied station far more places to be invoked from, and the
barrier is the same single check at all of them.

---

## Findings

### 1. No standard-principal guard on the `admins` write paths -- OPEN

`grep` for `principal-destruct?`, `is-standard` and `principal-construct?`
returns nothing in either contract. Clarity's `principal` type accepts contract
principals, and `recover-inactive-wallet (new-admin principal)` takes it straight
from the caller:

```clarity
(asserts! (is-inactive) err-inactive-required)
(asserts! (is-eq tx-sender (var-get recovery-address)) err-unauthorised)
(map-delete admins (var-get owner))
(map-set admins new-admin true)      ;; new-admin could be the contract itself
```

If the wallet's own principal ever lands in `admins`, `is-admin-calling
tx-sender` succeeds inside EVERY `as-contract?` frame, and since gas stations are
caller-supplied, any relayer could then drain the wallet outright. The
re-entrancy result above depends entirely on that map never containing the
contract.

Precondition is real: the recovery key after ~1 year of inactivity, or the
admin-plus-passkey 2FA path. Anyone holding those can already move funds, so this
is a footgun rather than an unauthenticated exploit. What makes it worth fixing
is that it is permanent and silent, where key theft is rate-limited and logged.

Fix, on all three write paths:

```clarity
(asserts! (not (is-eq new-admin current-contract)) err-unauthorised)
```

**Untested.** The escalation is a source reading. A sim that calls
`recover-inactive-wallet` with the wallet's own principal and then attempts the
gas-station drain would confirm it before deciding whether this alone justifies a
v5/v15.

### 2. `gas` silently ignored on unsigned calls -- BY DESIGN, document it

See P3b above. Relayer-facing, not fund-threatening.

### 3. `cooldown-period` has no floor and config change is admin-only -- ACCEPTED

Inherited from `pillar-safe-v2`, so `jing-mm-safe`, `yguazu-stx-safe` and the
deployed fak.fun wallets carry it too. `set-wallet-config` is
`(try! (is-authorized none))` -- admin key alone, no passkey, and no floor on the
value. A stolen admin key signals a change, waits one current cooldown (itself
clamped to `MAX-CONFIG-COOLDOWN u4032`), sets `cooldown-period` to `u0`, and
every delay in the wallet collapses at once.

The circularity is worth stating plainly: the cooldown exists to protect against
a stolen admin key, and the thing that can switch off the cooldown is the admin
key. The passkey holder can veto individual pending operations but **cannot
cancel a signalled config change and cannot evict the thief alone**, because
`propose-transfer-wallet` is admin-gated. So the protection is one cooldown's
worth of warning, once, plus core events.

Accepted, not fixed. If v5/v15 is ever un-parked, the candidates are: let the
passkey veto a signalled config change (mirrors `veto-operation`, cheapest), put
a floor under the value, or make the gate asymmetric so that strengthening
protections stays admin-only while weakening them needs both factors.

### 4. Variant A aborts with `(err none)` -- OPEN, undiagnosed

Re-entering `stx-transfer` (rather than `sip010-transfer`) aborts the outer
transaction with `(err none)` on **both** wallets, rolling back the station's own
recording, which is why its captures read as the initial default. `(err none)` is
the same signature as the C6 indeterminate-err-type fault that killed v3/v12, and
a consistent reproduction across two different contracts makes it more
interesting, not less. It needs a probe bisect along the lines of
`simul-c6-bisect.js`.

It does not affect the re-entrancy conclusion -- variant B answers the question,
and A's balance assertions still pass: the attacker gained nothing either way.
Both harnesses carry A explicitly unasserted.

---

## NOT covered -- read this before trusting a green run

### 1. Per-site gas coverage is a sample, not a sweep

Of the GAS-ENFORCED `pay-gas-accounted` call sites, only **3 of 13 on v4** and
**2 of 25 on v14** were driven with an actual station: `stx-transfer`,
`stake-stx-juice`, `update-stake-stx-juice`.

What softens it: the gas logic is one shared private function, and a static pass
confirms all 42 sites (v4 + v14, including the exempt one) invoke it with the
byte-identical canonical form

```clarity
(match gas
  g (try! (pay-gas-accounted g GAS-ENFORCED))
  true
)
```

and that every site is signature-gated, either by nesting inside the `sig-auth`
Some-branch or by taking `sig-auth` as a REQUIRED parameter. The functions with
a required signature are `execute-pending-stx-transfer-now`,
`execute-pending-sbtc-transfer-now`, `execute-pending-sbtc-withdrawal-now`,
`confirm-transfer-wallet`, `propose-recovery` on v4, plus
`execute-pending-whitelist`, `faktory-execute-limit`,
`propose-admin-with-signature`, `confirm-admin-with-signature`,
`veto-pending-init` on v14.

What remains genuinely untested is per-site WIRING on the shapes never driven:
`extension-call`, the nine `faktory-*` functions, `sip009-transfer`,
`wager-deposit`, `sbtc-initiate-withdrawal`. Those call out to caller-supplied
traits, which is where an interaction with the gas allowance would plausibly
hide. Sample by shape, roughly six per wallet, rather than running 38 sims.

### 2. v14 has no fuse-trip test

`simul-v14-full.js` proves the happy path there -- fee charged exactly 20 sats,
`sbtc` counter unchanged, ceiling read correctly -- but nothing blows the fuse on
v14. `simul-gas-metering-v4.js` needs a v14 twin, and v14 has more gasless
surface to leak.

### 3. Live sBTC bonds are still untested

Every reward run passes an empty `bond-periods` list to `calculate-rewards` and
`pox-claim-rewards`, accepted only because no sBTC bonds are currently active, so
`assert-all-active-bonds-included` passes trivially. Once a bond exists both
calls must enumerate the active bond periods and the payout maths gains a bond
leg. Re-run the reward harness at that point.

### 4. `clarinet check` cannot parse `Clarinet.toml` at all

It rejects `clarity_version = 6` paired with `epoch = "latest"`. That has been
true since the C6 entries landed, so clarinet has not been checking these
contracts. stxer running the real VM is the only gate that currently works, which
is also the conclusion `simul-deploy-v4-v14.js` reaches for its own reasons.

---

## Running them

```
node simul-deploy-v4-v14.js        # pre-deploy gate, run this FIRST for any new version
node simul-juice-safe-v4-lifecycle.js
node simul-juice-safe-v4-recovery.js
node simul-max-gas-cooldown-v4.js
node simul-tranche-attack-v4.js
node simul-juice-safe-v4.js
node simul-gas-metering-v4.js
node simul-reentrancy-v4.js
node simul-v4-v14-staking.js
node simul-max-gas-cooldown-v14.js
node simul-reentrancy-v14.js
node simul-v14-full.js
```

Run them **sequentially**. stxer's submit endpoint returns HTTP 504 under
concurrent load and asks for a 120 second backoff; the whole suite hit it
repeatedly when run in parallel. All harnesses read chain state through the Juice
box at `http://77.42.3.101/stacks-api` rather than Hiro, to dodge 429s on
payloads this size.
