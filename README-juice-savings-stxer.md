# juice-savings + helpers-v3 staking builders: stxer mainnet-fork sim


## Rerun on the deployed bytes (2026-11-27)

**154/154 PASS**: https://stxer.xyz/simulations/mainnet/72c41605c95006bfcf1fa1c9990a64a2

Deploy bytes = the faktory-dao templates, checked equal to the live mainnet source (all five contracts deployed at block 9589964: helpers-v3, router sbtc-stx v6-1, router sbtc-usdcx v6, juice-savings, juice-trading). Audit 7k fixes covered: restake takes no args: refused on a Fastpool safe (u4023, payout config kept), works on juice-pool-sbtc-signer and locks all unlocked STX; juice-safe-v10 case removed (contract deleted).
Not proven: no live safe onboarded yet, core-v2 `set-verified-contract` still pending; no Zest leg filled (pool u4 absent, no u3 liquidity in these runs).

Run 2026-11-26 on the stxer mainnet fork (tip burn 977706, cycle 148, offset 856). Nothing broadcast.
Pre-deploy audit coverage for AIBTC bounty `mwvrpx3a633f201e8caa`, new code only.

**Result: 159/159 PASS** — https://stxer.xyz/simulations/mainnet/92145730db71e3a514df33be6e1034f8
(164 steps: 125 txs/deploys/advances asserted + 34 state checks; evals are captured, not counted)

Run: `STACKS_NODE_API=https://api.hiro.so node simul-juice-savings.js`
(the Juice box `77.42.3.101` was unreachable today; any node with `/v2` works).
Result JSON: `fixtures/simul-juice-savings-result.json`.

## Deployed bytes (pillar-wallets-xyz @ 321f103, unchanged files)

| Contract | Deployed as | Clarity | sha256 |
|---|---|---|---|
| `contracts/juice-savings.clar` (54,127 B) | `SPV9K21….juice-savings` (A), `SP28MP….bob-savings` (B), `SP28MP….carol-savings` (C) | 6 | `347874ec4ba900117b6d848024fa04f20dd4b66108410c0c3385336af74efbcf` |
| `contracts/juice-safe-auth-helpers-v3.clar` | `SPV9K21….juice-safe-auth-helpers-v3` | 4 | `7b93a86f5f336076f23d67099fc487d33ddceeca41ec675a3156fe2654565962` |

Fork-only: `evil-savings` (same source + one comment line), `rogue-pool` (byte copy of
`juice-pool-stx-signer` under the attacker), `hostile-dapp` (attacker contract). All three
vetted pools are LIVE and registered in pox-5; they are used as-is (no register-self).

## What is covered (new code vs juice-autostake-safe)

| New code | Steps |
|---|---|
| onboard: optional recovery (none -> SP000), registers against `juice-savings` in core-v2 | O1–O15, RC1–RC3 |
| stake takes the pool, `is-allowed-pool`, passkey signs the pool | K1–K13, BK1 |
| update: 0/0 only when switching, pool allow-list, signed pool | U1–U14 |
| unstake / restake take the signer, keeper cannot switch | R1–R7, X1–X4, C1–C4, BK2 |
| the 3 `execute-pending-*-now`: the key that did NOT start the op confirms | E1–E16, S1–S5, W1–W6, V1–V6 |
| renumbered errors u4007..u4023 asserted exactly | O6/O7 u4017/u4016, O15 u4007, K1 u4020, K2 u4023, E3 u4021, E5 u4019, E8 u4011, E15 u4010, V2 u4012, L1 u4014, X4 u4022 |
| helpers-v3 builders: JS mirror == contract hash; each signed field mutated once -> u4002 | H1–H4, K4–K8 (pool, amount, calldata, auth-id, domain), U6–U9 (pool, amount, cycles, calldata) |
| cooldown / veto / replay / cross-safe | L1–L3, V1–V6, K12, V6, K8, E12 |

## Triage items

| # | Item | Sim result |
|---|---|---|
| 4 | passkey-created op confirmed via `is-admin-calling tx-sender` | **Reproduced.** P1: the owner calls `hostile-dapp.claim-airdrop`; it calls `execute-pending-stx-transfer-now u2`; op2 (passkey-created, 150 STX) executes before the cooldown. Recipient/amount stay the ones the passkey signed, so the impact is skipping the cooldown + veto window. P2 (context, base code, out of scope): the same contract moves 50 STX under the threshold straight to the attacker, because every admin path uses `tx-sender`. Fix: `contract-caller` for the admin check. |
| 5 | restake passes signer-calldata none, Fastpool deletes the payout config | **Reproduced** on both paths: A (update into fastpool with calldata, U14 config some -> R5 keeper restake -> R6 `none`) and C (stake with calldata, C2 some -> C3 restake -> C4 `none`). Rewards fall back to sBTC payouts to the safe; no funds lost. |
| 6 | old-signer unsigned in update / unstake | **Confirmed abort-only.** U4, U10 (passkey sig valid, submitter swaps old-signer), X1: pox-5 `(err u36)` ERR_INVALID_OLD_SIGNER_MANAGER, nothing changes. |
| 7 | helpers-v3 has no `build-set-pool-hash`, juice-safe-v10 calls it | **Reproduced.** D7: deploying juice-safe-v10 against these helpers fails analysis: `has no public function 'build-set-pool-hash'`. |

No other contract issue found. Notes:
- Recovery none: `recovery-address = SP000…`, so `recover-inactive-wallet` can never run until the
  owner sets one (O15; RC1–RC3 show passkey propose + admin confirm works from the none state).
- In the passkey-created branch of `-now` the gas param is ignored (E7: gas passed, 0 sats paid).
- Harness detail: stxer runs steps in one block until advanced; the harness advances 1 burn block
  every 15 txs (block cost budget). The SDK has no post-condition-mode option, so the deny-mode
  variant of P1 is not simulated.

## Steps

| # | Step | Result |
|---|---|---|
| 0 | D1 deploy juice-safe-auth-helpers-v3 (Clarity 4) | PASS `(ok true)` |
| 1 | D2 deploy juice-savings canonical A (Clarity 6) | PASS `(ok true)` |
| 2 | D3 relay deploys bob-savings B (same bytes) | PASS `(ok true)` |
| 3 | D4 relay deploys carol-savings C (same bytes) | PASS `(ok true)` |
| 4 | D5 relay deploys evil-savings (same source + 1 comment line) | PASS `(ok true)` |
| 5 | D6 attacker deploys rogue-pool (juice-pool-stx-signer bytes, not allow-listed) | PASS `(ok true)` |
| 6 | D7 (triage #7) juice-safe-v10 deploy: helpers-v3 has no build-set-pool-hash -> must fail | PASS `VM-ERR: :0:0: contract 'SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-safe-auth-helpers-v3' has no public fun` |
| 7 | D8 attacker deploys hostile-dapp (calls B as whoever calls it) | PASS `(ok true)` |
| 8 | O1 onboard B before core-v2 knows juice-savings -> core u6001 | PASS `(err u6001)` |
| 9 | O2 core-v2 set-verified-contract(juice-savings) (hash computed) | PASS `(ok true)` |
| 10 | O3 RANDOM onboard A -> u4001 | PASS `(err u4001)` |
| 11 | O4 onboard A with recovery = owner -> u4001 | PASS `(err u4001)` |
| 12 | O5 onboard A with recovery = the safe itself -> u4001 | PASS `(err u4001)` |
| 13 | O6 onboard A cooldown 143 -> u4017 (renumbered err-cooldown-too-short) | PASS `(err u4017)` |
| 14 | advance 1 burn block (fresh block budget) | PASS `advanced` |
| 15 | O7 onboard A cooldown 4033 -> u4016 (renumbered err-cooldown-too-long) | PASS `(err u4016)` |
| 16 | O8 onboard A, recovery some | PASS `(ok true)` |
| 17 | O9 onboard A twice -> u4001 | PASS `(err u4001)` |
| 18 | O10 onboard B (relay copy), recovery none | PASS `(ok true)` |
| 19 | O11 onboard C (relay copy), recovery some | PASS `(ok true)` |
| 20 | O12 onboard evil-savings (other bytes) -> core u6002 | PASS `(err u6002)` |
| 23 | O15 B (recovery none): RECOVERY recover-inactive-wallet -> u4007 (renumbered err-inactive-required) | PASS `(err u4007)` |
| 24 | fund juice-savings 1000 STX | PASS `(ok true)` |
| 25 | fund bob-savings 1000 STX | PASS `(ok true)` |
| 26 | fund carol-savings 1000 STX | PASS `(ok true)` |
| 27 | fund B 600000 sats | PASS `(ok true)` |
| 28 | fund juice-savings 5000 sats (gas) | PASS `(ok true)` |
| 29 | fund carol-savings 5000 sats (gas) | PASS `(ok true)` |
| 34 | K1 owner stake 0 -> u4020 (renumbered err-zero-amount) | PASS `(err u4020)` |
| 35 | K2 owner stake into rogue-pool -> u4023 err-invalid-pool | PASS `(err u4023)` |
| 36 | K3 RANDOM stake (admin path) -> u4001 | PASS `(err u4001)` |
| 37 | K4 passkey sig for pool stx-signer, sent with sbtc-signer -> u4002 | PASS `(err u4002)` |
| 38 | K5 passkey sig for amount+1 -> u4002 | PASS `(err u4002)` |
| 39 | advance 1 burn block (fresh block budget) | PASS `advanced` |
| 40 | K6 passkey sig for calldata some 0x78, sent none -> u4002 | PASS `(err u4002)` |
| 41 | K7 passkey sig auth-id 4 submitted as auth-id 5 -> u4002 | PASS `(err u4002)` |
| 42 | K8 passkey sig made for safe B, sent to A -> u4002 (domain) | PASS `(err u4002)` |
| 43 | K9 unregistered passkey -> u4004 | PASS `(err u4004)` |
| 44 | K10 passkey sig into rogue-pool (signed rogue) -> u4023 | PASS `(err u4023)` |
| 46 | K11 passkey stake 500 STX into juice-pool-sbtc-signer, gas | PASS `(ok true)` |
| 48 | K12 K11 signature replayed -> u4006 | PASS `(err u4006)` |
| 49 | K13 owner stake again (other pool) -> pox-5 ERR_ALREADY_STAKED u19 | PASS `(err u19)` |
| 50 | U1 owner update 0/0, same pool -> u4020 | PASS `(err u4020)` |
| 51 | U2 owner update +10 STX into rogue-pool -> u4023 | PASS `(err u4023)` |
| 52 | U3 owner update 0/0 switch to rogue-pool -> u4023 (0/0 passes, pool check refuses) | PASS `(err u4023)` |
| 53 | U4 (triage #6) owner switch with wrong old-signer (fastpool) -> pox-5 u36, abort only | PASS `(err u36)` |
| 54 | U5 owner update extend 1 cycle (97 > 96) -> pox-5 u20 | PASS `(err u20)` |
| 55 | U6 passkey switch sig for pool fastpool, sent stx-signer -> u4002 | PASS `(err u4002)` |
| 56 | U7 passkey sig for amount-increase 1, sent 0 -> u4002 | PASS `(err u4002)` |
| 57 | advance 1 burn block (fresh block budget) | PASS `advanced` |
| 58 | U8 passkey sig for cycles 1, sent 0 -> u4002 | PASS `(err u4002)` |
| 59 | U9 passkey sig for calldata some 0x78, sent none -> u4002 | PASS `(err u4002)` |
| 60 | U10 (triage #6) passkey switch signed correctly, submitter swaps old-signer -> pox-5 u36 (unsigned field, abort only) | PASS `(err u36)` |
| 61 | U11 passkey switch 0/0 sbtc-signer -> stx-signer, gas | PASS `(ok true)` |
| 63 | U12 owner update +100 STX, same pool stx-signer | PASS `(ok true)` |
| 65 | U13 owner switch 0/0 stx-signer -> fastpool, calldata = payout config | PASS `(ok true)` |
| 68 | R1 RANDOM restake -> u4001 | PASS `(err u4001)` |
| 69 | R2 owner (not keeper) restake -> u4001 | PASS `(err u4001)` |
| 70 | R3 keeper restake naming stx-signer (switch attempt) -> u4023 | PASS `(err u4023)` |
| 71 | R4 keeper restake naming rogue-pool -> u4023 | PASS `(err u4023)` |
| 72 | R5 (triage #5) keeper restake fastpool (adds all unlocked STX) | PASS `(ok (tuple (amount u400000000) (cycles-to-extend u0)))` |
| 75 | R7 keeper restake again, nothing unlocked, no cycles -> u4020 | PASS `(err u4020)` |
| 76 | X1 (triage #6) owner unstake with old-signer stx-signer (not current) -> pox-5 u36 | PASS `(err u36)` |
| 77 | X2 RANDOM unstake -> u4001 | PASS `(err u4001)` |
| 78 | X3 passkey unstake (fastpool), gas | PASS `(ok true)` |
| 80 | advance 1 burn block (fresh block budget) | PASS `advanced` |
| 81 | X4 keeper restake after unstake -> u4022 (renumbered err-not-staking) | PASS `(err u4022)` |
| 82 | C1 owner stake C 500 STX into fastpool, calldata = payout config | PASS `(ok true)` |
| 85 | C3 (triage #5) keeper restake C (fastpool) | PASS `(ok (tuple (amount u500000000) (cycles-to-extend u0)))` |
| 89 | Q0 owner stx 150 (over) -> op0 admin-created | PASS `(ok true)` |
| 90 | Q1 passkey stx 150 -> op1 passkey-created | PASS `(ok true)` |
| 91 | Q2 passkey stx 150 -> op2 passkey-created | PASS `(ok true)` |
| 92 | Q3 owner sBTC 150000 -> op3 admin-created | PASS `(ok true)` |
| 93 | Q4 passkey sBTC 150000 -> op4 passkey-created | PASS `(ok true)` |
| 94 | Q5 owner withdrawal 120000+1000 -> op5 admin-created | PASS `(ok true)` |
| 95 | Q6 passkey withdrawal 120000+1000 -> op6 passkey-created | PASS `(ok true)` |
| 96 | Q7 passkey stx 150 -> op7 passkey-created | PASS `(ok true)` |
| 97 | Q8 owner stx 150 -> op8 admin-created | PASS `(ok true)` |
| 98 | Q9 owner stx 150 -> op9 admin-created | PASS `(ok true)` |
| 103 | E1 op1 (passkey-created): relayer + passkey sig -> u4001 (the passkey cannot confirm its own op) | PASS `(err u4001)` |
| 104 | E2 op1: RANDOM, no sig -> u4001 | PASS `(err u4001)` |
| 105 | advance 1 burn block (fresh block budget) | PASS `advanced` |
| 106 | E3 op1: owner with memo some -> u4021 (renumbered err-memo-mismatch) | PASS `(err u4021)` |
| 107 | E4 owner turns the token lock on | PASS `(ok true)` |
| 108 | E5 op1: owner while locked -> u4019 (renumbered err-token-locked) | PASS `(err u4019)` |
| 109 | E6 owner turns the lock off | PASS `(ok true)` |
| 111 | E7 op1: owner confirms (no sig, gas passed but unused) -> 150 STX moves before the cooldown | PASS `(ok true)` |
| 113 | E8 op1 again -> u4011 (renumbered err-already-executed) | PASS `(err u4011)` |
| 114 | E9 op1 plain execute (executed) -> u4011 | PASS `(err u4011)` |
| 115 | E10 op0 (admin-created): owner, no sig -> u4001 (admin cannot confirm its own op) | PASS `(err u4001)` |
| 116 | E11 op0: passkey sig for op9 -> u4002 | PASS `(err u4002)` |
| 117 | E12 op0: passkey sig made for safe A -> u4002 | PASS `(err u4002)` |
| 118 | E13 op0: passkey confirms, gas -> 150 STX moves, gas paid | PASS `(ok true)` |
| 120 | E14 op0 again (fresh sig) -> u4011 | PASS `(err u4011)` |
| 121 | E15 stx-now on an sBTC op (op3) -> u4010 (renumbered err-invalid-operation) | PASS `(err u4010)` |
| 122 | E16 stx-now unknown op 99 -> u4010 | PASS `(err u4010)` |
| 123 | S1 op4 (passkey-created): relayer + passkey sig -> u4001 | PASS `(err u4001)` |
| 124 | advance 1 burn block (fresh block budget) | PASS `advanced` |
| 125 | S2 op4: owner confirms -> 150000 sats move | PASS `(ok true)` |
| 127 | S3 op3 (admin-created): owner, no sig -> u4001 | PASS `(err u4001)` |
| 128 | S4 op3: passkey confirms, no gas -> 150000 sats move | PASS `(ok true)` |
| 130 | S5 sbtc-now on an STX op (op8) -> u4010 | PASS `(err u4010)` |
| 131 | W1 op6 (passkey-created): relayer + passkey sig -> u4001 | PASS `(err u4001)` |
| 132 | W2 op6: owner confirms -> 121000 sats locked in sbtc-withdrawal | PASS `(ok u5626)` |
| 134 | W3 op5 (admin-created): owner, no sig -> u4001 | PASS `(err u4001)` |
| 135 | W4 op5: passkey confirms, gas | PASS `(ok u5627)` |
| 137 | W5 op5 again -> u4011 | PASS `(err u4011)` |
| 138 | W6 withdrawal-now on an STX op (op8) -> u4010 | PASS `(err u4010)` |
| 139 | V1 owner vetoes op7 (passkey-created) | PASS `(ok true)` |
| 140 | V2 op7: owner -now -> u4012 (renumbered err-vetoed) | PASS `(err u4012)` |
| 141 | V3 passkey vetoes op8 (admin-created) | PASS `(ok true)` |
| 142 | V4 op8: passkey -now -> u4012 | PASS `(err u4012)` |
| 143 | V5 RANDOM veto op9 -> u4001 | PASS `(err u4001)` |
| 144 | advance 1 burn block (fresh block budget) | PASS `advanced` |
| 145 | V6 replay V3 veto signature on op8 -> u4006 | PASS `(err u4006)` |
| 147 | P1 (triage #4) owner calls hostile-dapp.claim-airdrop -> op2 (passkey-created) executes before the cooldown | PASS `(ok true)` |
| 150 | P2 (base, pre-existing) owner calls hostile-dapp.free-mint -> 50 STX under threshold to the attacker | PASS `(ok true)` |
| 152 | L1 op9 plain execute before the cooldown -> u4014 (renumbered err-cooldown-not-passed) | PASS `(err u4014)` |
| 153 | advance 145 burn blocks (cooldown) | PASS `advanced` |
| 154 | L2 op9 plain execute after the cooldown | PASS `(ok true)` |
| 155 | L3 op7 (vetoed) plain execute -> u4012 | PASS `(err u4012)` |
| 157 | RC1 passkey propose-recovery RECOVERY on B | PASS `(ok true)` |
| 158 | RC2 owner confirm-recovery | PASS `(ok true)` |
| 160 | BK1 owner stake B 300 STX into juice-pool-stx-signer | PASS `(ok true)` |
| 162 | BK2 passkey unstake B (stx-signer), no gas | PASS `(ok true)` |
| - | H1 build-stake-stx-juice-pool-hash (cd none): contract hash == JS mirror | PASS `0x98977493187d1f5c91122b9f455d35ae2aa6b279a4854a4d00103add756c9864 vs 0x98977493187d1f5c91122b9f455d35ae2aa6b2` |
| - | H2 build-stake-stx-juice-pool-hash (cd some): contract hash == JS mirror | PASS `0x24173c7ec906041a2849f5b3b84a0ad580589b4397715cf4e114f2fdae235e7c vs 0x24173c7ec906041a2849f5b3b84a0ad580589b` |
| - | H3 build-update-stake-stx-juice-pool-hash: contract hash == JS mirror | PASS `0x0ff200852da457c2c58ab4d87b8d4423f8af46742d5bfc8f149412d5dc69e244 vs 0x0ff200852da457c2c58ab4d87b8d4423f8af46` |
| - | H4 build-stake-stx-juice-pool-hash from B (domain binds B): contract hash == JS mirror | PASS `0xcc7ec317a9ff3e0e043098fa6e49e47153f4d673c96a809c128b287bb9892ff1 vs 0xcc7ec317a9ff3e0e043098fa6e49e47153f4d6` |
| - | H4 != H1 (same tuple, other safe -> other hash) | PASS `` |
| - | O13 A, B, C whitelisted; evil-savings not; A recovery = RECOVERY | PASS `(tuple (a true) (b true) (c true) (e false) (ra SP3HXJJMJQ06GNAZ8XWDN1QM48JEDC6PP6W3YZPZJ))` |
| - | O14 B onboarded with recovery none -> recovery-address SP000... | PASS `(tuple (o SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2) (r SP000000000000000000002Q6VF78))` |
| - | K11 A locked 500000000 with juice-pool-sbtc-signer, 96 cycles, gas 20 paid | PASS `(tuple (acct (tuple (locked u500000000) (unlock-height u1180550) (unlocked u500000000))) (cyc u148) (info (som` |
| - | K11 safe print carries pool = juice-pool-sbtc-signer | PASS `[{"cid":"SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.gas-station","v":"(tuple (a \"pay-gas\") (amount u20) (from ` |
| - | U11 0/0 switch: signer stx-signer, locked still 500000000, same unlock cycle, gas 20 | PASS `(tuple (acct (tuple (locked u500000000) (unlock-height u1180550) (unlocked u500000000))) (cyc u148) (info (som` |
| - | U11 pox-5 stake-update print: old-signer sbtc-signer -> signer stx-signer | PASS `[{"cid":"SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.gas-station","v":"(tuple (a \"pay-gas\") (amount u20) (from ` |
| - | U12 locked 600000000 | PASS `(tuple (acct (tuple (locked u600000000) (unlock-height u1180550) (unlocked u400000000))) (cyc u148) (info (som` |
| - | U13 switched to fastpool, locked unchanged | PASS `(tuple (acct (tuple (locked u600000000) (unlock-height u1180550) (unlocked u400000000))) (cyc u148) (info (som` |
| - | U14 fastpool stored A's payout config from calldata | PASS `(some (tuple (max-fee u1000) (min-claim u5000) (pox-addr (tuple (hashbytes 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` |
| - | R5 keeper restake locked all unlocked STX (400000000), pool unchanged | PASS `(tuple (acct (tuple (locked u1000000000) (unlock-height u1180550) (unlocked u0))) (cyc u148) (info (some (tupl` |
| - | R6 (triage #5 REPRODUCED if PASS) keeper restake passes calldata none -> fastpool deleted A's payout config | PASS `none` |
| - | X3 unstake: lock ends next cycle | PASS `(tuple (acct (tuple (locked u1000000000) (unlock-height u978950) (unlocked u0))) (cyc u148) (info (some (tuple` |
| - | C1 C staked 500 STX with fastpool | PASS `(tuple (acct (tuple (locked u500000000) (unlock-height u1180550) (unlocked u500000000))) (cyc u148) (info (som` |
| - | C2 fastpool stored C's payout config | PASS `(some (tuple (max-fee u1000) (min-claim u5000) (pox-addr (tuple (hashbytes 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` |
| - | C3/C4 (triage #5 REPRODUCED if PASS) keeper restake deleted C's payout config | PASS `none \| (tuple (acct (tuple (locked u1000000000) (unlock-height u1180550) (unlocked u0))) (cyc u148) (info (so` |
| - | op0 admin-created, op1/op6 passkey-created | PASS `(some (tuple (amount u150000000) (execute-after u977854) (executed false) (extension none) (op-type "stx-trans` |
| - | Q0..Q9 queued, nothing moved | PASS `(tuple (acct (tuple (locked u0) (unlock-height u0) (unlocked u1000000000))) (cyc u148) (info none) (lock false` |
| - | E7 owner confirm of op1: safe -150 STX, recipient +150 STX, no gas | PASS `(tuple (acct (tuple (locked u0) (unlock-height u0) (unlocked u850000000))) (cyc u148) (info none) (lock false)` |
| - | E13 passkey confirm of op0: -150 STX, gas 20 | PASS `(tuple (acct (tuple (locked u0) (unlock-height u0) (unlocked u700000000))) (cyc u148) (info none) (lock false)` |
| - | S2 owner confirm of op4: -150000 sats to recipient | PASS `(tuple (acct (tuple (locked u0) (unlock-height u0) (unlocked u700000000))) (cyc u148) (info none) (lock false)` |
| - | S4 passkey confirm of op3: -150000 sats, no gas | PASS `(tuple (acct (tuple (locked u0) (unlock-height u0) (unlocked u700000000))) (cyc u148) (info none) (lock false)` |
| - | W2 owner confirm of op6: 121000 sats leave the safe (locked in the withdrawal request) | PASS `(tuple (acct (tuple (locked u0) (unlock-height u0) (unlocked u700000000))) (cyc u148) (info none) (lock false)` |
| - | W4 passkey confirm of op5: 121000 sats + gas 20 | PASS `(tuple (acct (tuple (locked u0) (unlock-height u0) (unlocked u700000000))) (cyc u148) (info none) (lock false)` |
| - | P1 (triage #4 REPRODUCED if PASS) hostile contract confirmed op2: 150 STX to the op recipient before the cooldown | PASS `(tuple (acct (tuple (locked u0) (unlock-height u0) (unlocked u550000000))) (cyc u148) (info none) (lock false)` |
| - | P2 (base) hostile contract moved 50 STX to the attacker | PASS `(tuple (acct (tuple (locked u0) (unlock-height u0) (unlocked u500000000))) (cyc u148) (info none) (lock false)` |
| - | L2 op9 after cooldown: -150 STX | PASS `(tuple (acct (tuple (locked u0) (unlock-height u0) (unlocked u350000000))) (cyc u148) (info none) (lock false)` |
| - | RC3 B recovery-address set to RECOVERY after starting from none | PASS `SP3HXJJMJQ06GNAZ8XWDN1QM48JEDC6PP6W3YZPZJ` |
| - | BK1 B locked 300000000 with juice-pool-stx-signer | PASS `(tuple (acct (tuple (locked u300000000) (unlock-height u1180550) (unlocked u50000000))) (cyc u148) (info (some` |
| - | BK2 B unstake: lock ends next cycle | PASS `(tuple (acct (tuple (locked u300000000) (unlock-height u978950) (unlocked u50000000))) (cyc u148) (info (some ` |
