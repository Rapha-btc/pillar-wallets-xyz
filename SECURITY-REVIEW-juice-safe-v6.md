# Security Review - `juice-safe-v6`

Static review of `contracts/juice-safe-v6.clar` (1,538 lines) against the deployed
`SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-safe-v6`. The repo copy and the
deployed bytecode are byte-identical (verified by diff), so either can be reviewed.

Companion to `README-clarinet-rv.md` (how to run the suites) and
`README-v6-v16-sims.md` (the stxer mainnet-fork suite).

## The auth model in brief

* **Admin path** - `tx-sender` must be in the `admins` map. This is the hot
  principal that queues operations and executes matured ones.
* **Passkey path** - a WebAuthn / secp256r1 `sig-auth` tuple consumed by
  `consume-signature` (`:1206`). The pubkey must be registered in
  `pubkey-to-admin` and that pubkey's mapped principal must itself be an admin
  (`is-admin-pubkey`, `:1105`). Replay is blocked by
  `used-pubkey-authorizations`, keyed on the message hash.
* `verify-signature` (`:1175`) pins the WebAuthn rp-id hash to
  **juiceofbtc.com** and requires the user-verified (UV) flag. A passkey from
  any other origin, or one that only proves user *presence*, is rejected
  on-chain.
* The two paths are **2-of-2 for anything consequential**, not
  interchangeable. See section 2.

---

## 1. clientDataJSON reconstruction is unvalidated

**Concern.** `clarity-5-webauthn-v3` does not parse the signed clientDataJSON.
It concatenates three caller-supplied buffers and hashes the result:

```clarity
(define-read-only (compute-client-data-hash
    (challenge (buff 32)) (client-data-prefix (buff 128)) (client-data-suffix (buff 512)))
  (sha256 (concat client-data-prefix (concat (base64url-32 challenge) client-data-suffix))))
```

There is no assertion that the prefix ends with `"challenge":"`, that the suffix
begins with `"`, or that the reconstruction is even valid JSON. The submitter of
the transaction therefore chooses *where in the signed blob the challenge is
claimed to live*.

The theoretical attack is a **split-point relocation**: take a signature made
over a real clientDataJSON `C` containing challenge `A`, and re-split it so the
contract reads a different 43-character window as the challenge, authorising
operation `B` with a signature the user made for `A`.

```
prefix: {"type":"webauthn.get","challenge":"Kj9x...","origin":"https://
        [contract now treats this as the challenge:]  juiceofbtc
suffix: .com"}
```

**Why it is not exploitable.** For the substitution to verify, the attacker needs
`prefix || base64url(B) || suffix` to equal `C` byte for byte. The attacker does
control `B` (they choose the operation's `auth-id`, amount, recipient), so they
can grind it - but they must land `base64url(B)` on one specific 43-character
window of `C`. That is a sha256 preimage search. Hashes cannot be aimed at a
target output.

**Final assessment**: **not exploitable, but safe by preimage resistance rather
than by construction.** Nothing structurally prevents the challenge from being
read out of the wrong position; the only barrier is the infeasibility of the
search. The distinction matters for future changes: if the clientDataJSON format
ever comes to contain attacker-influenced text of the right shape (authenticator
extension data, a longer or attacker-chosen origin, a different serialisation),
the guarantee weakens and **nothing in the contract would notice**. Treat the
verifier's input format as a security-relevant interface, not an implementation
detail.

**Not currently covered by tests.** Every existing test feeds either a
well-formed prefix/suffix pair from `lib-webauthn-test-signer.mjs` or obvious
garbage (`7b7d` / `7b7d` with a zero signature, `juice-safe-v6.test.ts:238`).
No test crafts a valid-looking pair to relocate the challenge. Worth pinning -
see "Suggested additional tests" below.

---

## 2. Defence in depth: a forged passkey signature is not sufficient

Even granting the hypothetical in section 1, a forged passkey signature does not
move funds. Three independent layers stand behind it.

**Layer 1 - it queues rather than executes** (`:627`):

```clarity
(if (would-exceed-stx-threshold amount)
  (create-pending-operation "stx-transfer" amount recipient none none none (is-some sig-auth))
  ...)
```

The final argument records **which factor queued the operation**, stored as
`passkey-created` on the pending op.

**Layer 2 - the queuing factor cannot fast-track its own op** (`:693`):

```clarity
(asserts! (not (get passkey-created op)) err-forbidden)
```

`execute-pending-*-now` refuses any operation a passkey created. It must sit out
the full cooldown, with the veto window open the whole time.

**Layer 3 - maturity does not help either.** `execute-pending-stx-transfer`
(`:662`) calls `(is-authorized none)`, whose `none` branch falls through to
`is-admin-calling tx-sender`. Executing a matured operation requires the **admin
principal**, not a signature.

Net effect: a passkey forgery yields a queued transaction the forger cannot
execute. They would additionally need the admin key - at which point the forgery
bought them nothing, since the admin key alone already queues operations.

The same 2-of-2 shape guards ownership: `propose-transfer-wallet` needs the
admin, `confirm-transfer-wallet` needs the passkey.

**What this does not cover**: transfers *below* the configured threshold execute
immediately. Those are bounded by the per-period counter, which
`invariant-spent-within-thresholds` exercises under fuzzing.

---

## 3. Accepted consequences (decisions, not defects)

**3a. Single-factor after admin rotation.** `pubkey-to-admin` is written only in
`onboard` (`:1495`), while the `admins` map is rotated by
`confirm-transfer-wallet` (`:1163-1164`) and by recovery (`:1301-1304`). The
passkey therefore keeps pointing at the *old* owner, who is no longer an admin,
and `is-admin-pubkey` answers `u4005`. Because there is no admin-only way to
designate a new passkey, **the safe is single-factor under the new admin until
re-onboarded**. Pinned at `juice-safe-v6-auth.test.ts:271` so this stays a
decision rather than a surprise.

**3b. Caller-supplied `x-name` aborts rather than erroring.** A wrong token name
reaching `with-ft` (`:786`) raises `BadTokenName` at runtime instead of returning
a typed error. Observed repeatedly as ignored calls during RV fuzzing. Gas waste
only; fails closed.

**3c. Zero-fee gas stations are accounted as zero.** `pay-gas-accounted` (`:153`)
meters by sBTC balance delta, so a station that moves nothing lands on the
`(fee u0)` arm rather than underflowing. Deliberate, tested at
`juice-safe-v6-gaps.test.ts:305` against `zz-gas-station-free.clar`, and bounded
by `invariant-gas-fuse-holds`.

---

## Verification status

Run `2026-08-06`, against real mainnet contracts as Clarinet requirements
(including the actual deployed `clarity-5-webauthn-v3`, not a mock).

| Suite | Tests |
| --- | ---: |
| `juice-safe-v6.test.ts` | 24 |
| `juice-safe-v6-surface.test.ts` | 18 |
| `juice-safe-v6-assets.test.ts` | 17 |
| `juice-safe-v6-gaps.test.ts` | 14 |
| `juice-safe-v6-auth.test.ts` | 13 |
| `juice-safe-v6-limits.test.ts` | 11 |
| `juice-safe-v6-staking.test.ts` | 9 |
| `juice-safe-v6-allowance.test.ts` | 2 |
| **Total** | **108 passed** |

Each suite needs its manifest argument - the bare `npx vitest run` loads the root
`Clarinet.toml` and the worker dies during environment init:

```
npx vitest run tests/juice-safe-v6-auth.test.ts -- --manifest tests/cl-v6/Clarinet.toml
```

Rendezvous: **13/13 invariants held over 300 runs, 0 failures** (exit 0). See
`README-clarinet-rv.md` for the `update-context` visibility requirement.

Gas: `pay-gas-accounted` has 16 call sites (15 `GAS-ENFORCED`, 1 `GAS-EXEMPT` at
`:1156`), and all 16 are driven with a live station. See `README-clarinet-rv.md`.

stxer mainnet-fork simulations, full table in `README-v6-v16-sims.md`:

| Simulation | Asserts | Link |
| --- | ---: | --- |
| `simul-juice-safe-v6-lifecycle.js` | 62/62 | [`6cb4bc46`](https://stxer.xyz/simulations/mainnet/6cb4bc46636485ef569f59c80cc44d46) |
| `simul-tranche-attack-v6.js` | 39/39 | [`9e29df6b`](https://stxer.xyz/simulations/mainnet/9e29df6bbd1f2cbb78f8d1fb89c046f7) |
| `simul-gas-metering-v6.js` | 26/26 | [`a204b03c`](https://stxer.xyz/simulations/mainnet/a204b03cd7a12a21738c719a095cb3a0) |
| `simul-juice-safe-v6-recovery.js` | 16/16 | [`c90d197a`](https://stxer.xyz/simulations/mainnet/c90d197a5dae52c1f8fceac754002ebd) |
| `simul-max-gas-cooldown-v6.js` | 15/15 | [`6f609146`](https://stxer.xyz/simulations/mainnet/6f609146bc9b3c8c119778531b1a5613) |
| `simul-reentrancy-v6.js` | 12/12 | [`b8cd6514`](https://stxer.xyz/simulations/mainnet/b8cd651420513cb3eea6786eeb075495) |
| `simul-juice-safe-v6.js` | 10/10 | [`2e06f2f5`](https://stxer.xyz/simulations/mainnet/2e06f2f56676637ea43d5ebb17e3c7f2) |
| `simul-v6-v14-staking.js` | 8/8 | [`123a58e7`](https://stxer.xyz/simulations/mainnet/123a58e73ff0755cad2b2e09262397df) |

Note `simul-config-passkey-v6.js` runs 21/26 and is the source of the
`onboard`-accepts-burn-sentinel-as-recovery finding recorded in
`README-v6-v16-sims.md`. That is a separate open item from anything in this
review.

## What verification does not establish

The suites above close the obvious classes. They do not establish that the
contract cannot be broken. Specifically out of reach:

* **The webauthn verifier itself.** It is a dependency here, not a subject.
  Section 1 lives inside it.
* **Dependencies generally** - pox-5, `sbtc-token`, `juice-pool-stx-signer`,
  `smart-wallet-standard-auth-helpers-v7`.
* **Relayer and front-end compromise**, which is where 3a actually bites.

## Suggested additional tests

1. **Split-point relocation** - take a valid signature, re-split the same
   clientDataJSON at a different offset so the contract reads different bytes as
   the challenge. Assert `u4002`.
2. **Malformed-but-consistent reconstruction** - a prefix that does not end with
   `"challenge":"`, demonstrating that acceptance depends purely on the hash and
   not on structure. Documents the design rather than finding a bug.
3. **Buffer boundaries** - prefix at exactly 128 bytes, suffix at exactly 512.

All three will pass. Their value is pinning the section 1 assumption so a future
change to the verifier cannot silently weaken it.
