# RV fuzz: fakfun-smart-router-registry

Rendezvous property fuzzing of the router allowlist. The registry is the one
v18 contract where fuzzing genuinely applies — it holds governance state with
no external dependencies. Run:

```
./build.sh
npx rv tests/rv-registry fakfun-smart-router-registry invariant --runs 200
```

`build.sh` produces the target: the cleaned registry with the invariants from
`registry.invariants.clar` appended (rv reads invariants from the contract
under test). No mainnet requirements — the registry only references router
principals as map keys, which need not exist.

## Result (200 runs, 0 failures)

Fuzzed `propose-router` / `confirm-router` / `revoke-pending` / `propose-owner`
/ `accept-owner` from random senders and args. Most calls bounced on ownership
or cooldown (correctly). All invariants held:

| Invariant | What it proves |
|-----------|----------------|
| `invariant-seeded-stay-approved` | **Append-only.** No call sequence, from any sender, ever un-approves a router. This is the security decision the registry rests on (see `../../README-smart-router-registry.md`). |
| `invariant-canary-not-both-states` | A router is never simultaneously pending and approved. |
| `invariant-owner-set` | Ownership is never blanked (governance can't be bricked). |

## Scope note: why only the registry

RV invariant fuzzing suits stateful contracts. The other two v18 pieces are
deterministic, single-outcome checks, better proven elsewhere:

- **v18 `authorize-smart` router gate** ("an unapproved router is always
  rejected, on either auth arm") — proven in the stxer mainnet-fork sim
  (`simul-v18-smart-swap.js`): an unapproved trait-conforming `mock-smart-router`
  returns `(err u4033)` from the admin path, and all 9 approved routers pass.
- **`usdcx-sbtc-swap` guards** ("zero-amount / zero-min-out always rejected;
  no action but to-sbtc / to-usdcx does anything") — the extension is stateless
  and its live path calls the mainnet Bitflow DLMM router, so simnet RV adds
  nothing; the guards are `asserts!` proven by inspection and the swap itself
  is validated both directions in the same stxer sim.
