# juice-safe-v6 / fakfun-wallet-v16 -- simulations

All three contracts are DEPLOYED on mainnet at Clarity 6 under
`SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22`, and the deployed bytes were fetched and
confirmed byte-identical to the sources in this repo:

| contract | block | bytes |
|---|---|---|
| `smart-wallet-standard-auth-helpers-v10` | 8703826 | 1,139 |
| `juice-safe-v6` | 8703827 | 48,483 |
| `fakfun-wallet-v16` | 8703828 | 71,158 |

**This is first coverage for this generation, not a rerun.** The earlier
272-assertion suite in `README-v4-v14-sims.md` ran against v4/v14. `juice-safe-v5`
and `auth-helpers-v9` deployed but were never simulated; `fakfun-wallet-v15` never
deployed at all, having exceeded the 100,000-byte source limit. So until this run,
the seven changes described in `README-v5-v15-design.md` had never executed
anywhere.

---

## Results -- 296 assertions, 11 of 12 harnesses fully green

| harness | target | result | simulation |
|---|---|---|---|
| `simul-juice-safe-v6-lifecycle.js` | v6 | **62/62** | [`6cb4bc46`](https://stxer.xyz/simulations/mainnet/6cb4bc46636485ef569f59c80cc44d46) |
| `simul-v16-full.js` | v16 | **54/54** | [`27501ce8`](https://stxer.xyz/simulations/mainnet/27501ce8a4890eff6ef70e54d0aaf59b) |
| `simul-tranche-attack-v6.js` | v6 | **39/39** | [`9e29df6b`](https://stxer.xyz/simulations/mainnet/9e29df6bbd1f2cbb78f8d1fb89c046f7) |
| `simul-gas-metering-v6.js` | v6 | **26/26** | [`a204b03c`](https://stxer.xyz/simulations/mainnet/a204b03cd7a12a21738c719a095cb3a0) |
| `simul-config-passkey-v6.js` **(new)** | v6 | **21/26** | [`bcf78832`](https://stxer.xyz/simulations/mainnet/bcf788320a92611df3f7aed9edc21583) |
| `simul-max-gas-cooldown-v16.js` | v16 | **18/18** | [`80c7dca4`](https://stxer.xyz/simulations/mainnet/80c7dca4320248d3476af7c816a2cdbf) |
| `simul-juice-safe-v6-recovery.js` | v6 | **16/16** | [`c90d197a`](https://stxer.xyz/simulations/mainnet/c90d197a5dae52c1f8fceac754002ebd) |
| `simul-reentrancy-v16.js` | v16 | **15/15** | [`7c4dd7ae`](https://stxer.xyz/simulations/mainnet/7c4dd7aefa103df5db7ed73bb3589d0b) |
| `simul-max-gas-cooldown-v6.js` | v6 | **15/15** | [`6f609146`](https://stxer.xyz/simulations/mainnet/6f609146bc9b3c8c119778531b1a5613) |
| `simul-reentrancy-v6.js` | v6 | **12/12** | [`b8cd6514`](https://stxer.xyz/simulations/mainnet/b8cd651420513cb3eea6786eeb075495) |
| `simul-juice-safe-v6.js` | v6 | **10/10** | [`2e06f2f5`](https://stxer.xyz/simulations/mainnet/2e06f2f56676637ea43d5ebb17e3c7f2) |
| `simul-v6-v14-staking.js` | v6 | **8/8** | [`123a58e7`](https://stxer.xyz/simulations/mainnet/123a58e73ff0755cad2b2e09262397df) |

Run them sequentially. stxer's submit endpoint 504s under concurrent load and asks
for a 120s backoff; `simul-gas-metering-v6.js` hit it once on this run and passed on
retry.

---

## FINDING: mandatory recovery is NOT enforced on chain

**`juice-safe-v6.onboard` accepts the burn sentinel as the recovery address.**
Step A1 of [`bcf78832`](https://stxer.xyz/simulations/mainnet/bcf788320a92611df3f7aed9edc21583)
onboarded successfully with `recovery = SP000000000000000000002Q6VF78` and
`recovery-address` reads back as that sentinel, i.e. unset. That is precisely the
permanent-loss vector change 5 was written to close.

Only two of the three intended asserts are in the deployed bytes:

```clarity
(asserts! (not (is-eq recovery current-contract)) err-unauthorised)   ;; present
(asserts! (not (is-eq recovery new-owner)) err-unauthorised)          ;; present
;; the (not (is-eq recovery 'SP000...2Q6VF78)) check is ABSENT
```

The comment above them claims recovery "cannot be none here, cannot be this
contract, and cannot be the owner" -- three checks for two asserts. The same gap is
in `juice-safe-v5.clar`, so it was never written, not dropped in transit.

**How it got past review.** The verification pass after each edit checked that
`recovery` was a bare `principal` and that the `!= new-owner` assert existed. It
never checked the sentinel assert. So the comment was verified and the behaviour
was not. A diff review confirms the same thing a comment does; only execution
disagrees with it.

**Reachability.** `onboard` asserts `tx-sender` is `FAKFUN-DEPLOYER`, so the only
caller is the backend. This is not attacker-reachable -- it is a footgun for our own
onboarding code, which lives in
`faktory-dao/backend/server/routes/api/smart-wallet/*` and
`api/bot/retry-wallet-init.get.ts`.

**Two ways to close it.** A backend-side guard refusing the sentinel is sufficient
in practice given the deployer gate, and costs nothing. Enforcing it on chain needs
a `juice-safe-v7`, since v6 is deployed and names cannot be reused. Not decided.

`fakfun-wallet-v16` is unaffected: its `onboard` takes only the pubkey and never
touches `recovery-address`.

### The other four failures in that harness are cascades

A1 succeeding consumed the single-use `onboard`, so A4, A5, A6 and the
recovery-address check all returned `err-unauthorised u4001` from
`(not (var-get pubkey-initialized))` rather than from the thing each was testing.
The harness ordering should assert the rejections in a way that cannot be
invalidated by an earlier unexpected success.

---

## What the new harness proved, all green

`simul-config-passkey-v6.js` covers the changes themselves rather than regressions.
Everything except the onboard block above passed.

**The circle is broken.** In v4 both halves of a config change were
`(is-authorized none)`, so the admin key the cooldown protects against could also
switch the cooldown off. Now:

```
E1  signal by a RANDOM principal                 (err u4001)
D1  signal by the ADMIN                          (ok true)
B6  confirm with a garbage signature, admin only (err u4002)
B7  wallet-config unchanged by that attempt      cooldown still u288
B8  the pending change survived, not lost        cooldown-period u144 still queued
B3  confirm with the correct passkey, relayed    (ok true)
```

The admin key alone can start a config change and cannot finish one.

**The hash binds the values.** A signature bound to different thresholds is
rejected, so the passkey approves specific numbers rather than consenting to "a
change" a compromised admin could fill in differently:

```
B1  sig over (999000000, 999000, 1000)   (err u4002)
C1  sig over NEW_STX + 1                 (err u4002)
B2  correct sig but before the cooldown  (err u4012)
```

**Values are committed at signal time.** `get-pending-config` shows what is coming
during the window, and is zeroed once it lands:

```
D2  during the window   (cooldown-period u288) (sbtc-threshold u300000) (stx-threshold u250000000)
D3  live config         UNCHANGED at u200 / u100000 / u100000000
B4  after the confirm   all three applied
D4  pending after       (cooldown-period u0) (sbtc-threshold u0) (stx-threshold u0)
```

**Bounds fire at signal.** `err-cooldown-too-short u4031` below the floor,
`err-cooldown-too-long u4019` above the ceiling. u4019 was declared in v4 and never
used until now.

**`update-activity` fires on the config path.** `last-activity-block` moved
u961077 -> u961297 across the change. Before the fix, an owner whose only
interactions across a year were config changes counted as abandoned and could lose
the wallet to the recovery address.

**cooldown-period is honoured at onboard.** The config read back `u200`, not the old
hardcoded `u144`.

---

## Harness changes the ABI forced

Repointing was not a one-line target flip this time.

**`onboard` went from 5 args to 6** in all eight safe harnesses: `recovery`
unwrapped from `someCV(standardPrincipalCV(...))` to a bare principal, and
`uintCV(144)` appended for the new `cooldown-period`.

**`confirm-max-gas-amount` was zero-arg and now requires a passkey**, so both
max-gas harnesses needed a `build-confirm-max-gas-amount-hash` challenge builder and
three signatures. One ordering subtlety: the auth check now runs BEFORE the
`err-not-signaled` assert, so the "nothing proposed" case needs a *valid* signature
over amount `u0` to reach the error it is testing.

Both max-gas harnesses also gained a case that did not exist before: confirming with
a signature bound to the WRONG amount must fail `u4002`. That is the replay
protection the value-binding buys, and it is why those tallies rose from 14 to 15
and 17 to 18.

---

## Still not covered

- **No v16 twin of `simul-config-passkey-v6.js`.** The config surface is identical
  on v16 and untested there. `simul-max-gas-cooldown-v16.js` covers the max-gas half.
- **No test that `propose-admin-pubkey` is gone from v16.** Its absence is the
  point of change 7, and absence is awkward to assert -- a call to a missing
  function fails at the VM rather than returning an error. A contract-interface read
  would do it.
- **Per-site gas coverage is still a sample.** 3 of 13 enforced `pay-gas-accounted`
  sites on the safe, 2 of 25 on the fak.fun wallet, driven with a real station. All
  sites were statically confirmed to use the identical canonical form and to be
  signature-gated. See `README-v4-v14-sims.md`.
- **Live sBTC bonds.** Every reward run still passes an empty `bond-periods` list,
  valid only while no bonds are active.
- **`clarinet check` cannot parse `Clarinet.toml`** -- it rejects
  `clarity_version = 6` with `epoch = "latest"`, so stxer remains the only working
  gate.
- **The `(err none)` diagnostic** from `simul-reentrancy-v*.js` variant A is still
  undiagnosed. It reproduces on v4, v14 and now v6/v16, aborts the outer call, and
  does not affect the re-entrancy conclusion, which variant B carries.

---

## Neither wallet is registered canonical

`get-verified-contract-hash` returns `none` for both, so `onboard` fails on chain
until someone calls, from `SPV9K21T...`:

```
fakfun-wallet-core.set-verified-contract(<wallet principal>, none)
```

Pass `none` -- the core derives the hash via `(contract-hash? contract)`. Note the
hash is over the DEPLOYED bytes, which are comment-free and byte-identical to the
`.clar` in this repo; see `build-be-templates.py`.
