# juice-trading: stxer mainnet-fork sim (bounty mwvrpx3a633f201e8caa)


## Rerun on the deployed bytes (2026-11-27)

**194/194 PASS**: https://stxer.xyz/simulations/mainnet/3de98dc2697be56ce9b25caecd262e04

Deploy bytes = the faktory-dao templates, checked equal to the live mainnet source (all five contracts deployed at block 9589964: helpers-v3, router sbtc-stx v6-1, router sbtc-usdcx v6, juice-savings, juice-trading). Audit 7k fixes covered: deploys (contract-of let fix); token lock ON blocks every passkey drain path (faktory-execute, -nft-execute, -place-order, -process, wager-deposit, smart-buy-sbtc: u4019, safe keeps its sBTC); sbtc-usdcx swaps through router v6 both ways (zest u0). #3 and #4 still reproduce (accepted / skipped).
Not proven: no live safe onboarded yet, core-v2 `set-verified-contract` still pending; no Zest leg filled (pool u4 absent, no u3 liquidity in these runs).

Harness: `simul-juice-trading.js`. Run 2026-11-26 on a mainnet fork at Stacks
block 9586397. Nothing was broadcast.

**Result: 186/186 checks green**:
https://stxer.xyz/simulations/mainnet/fd35f788717606860585b68e5f9cb0bc
(log: `fixtures/simul-juice-trading-run.log`).

The harness opens one stxer session and runs one step at a time, so each
check reads the real fork state. The "FINDING repro" checks pass when the bug
happens. They confirm triage #1 to #4.

Re-run (the juice box was down on 2026-11-26, so Hiro was used):

    STACKS_NODE=https://api.hiro.so node simul-juice-trading.js

## Bytes

| contract | source | sha256 | Clarity |
|---|---|---|---|
| juice-trading (fixed, deployed as `SPV9K21….juice-trading`) | `contracts/juice-trading.clar`, working tree = 321f103 + fix below | `f274c6ac5c217485fb848026ffe53602f75e7a4cb0f7638a7a66e6ad5daddbfb` | 6 |
| juice-trading @321f103 (deployed as `juice-trading-321f103`, fails) | `git show 321f103:contracts/juice-trading.clar` | `4dc3b559c8df03960022b9df253f77f31c63ea071e88b5c76eee9f5f38ec78c6` | 6 |
| juice-safe-auth-helpers-v3 | `contracts/juice-safe-auth-helpers-v3.clar` @321f103 | `7b93a86f5f336076f23d67099fc487d33ddceeca41ec675a3156fe2654565962` | 4 |
| swap-router-sbtc-stx-jing-v6-1 | jing-contracts-v3 `git show d2f6cad:contracts/sbtc-stx/swap-router-sbtc-stx-jing-v6-1.clar` | `1836e36e65a88ab686b4f649de56c00c945def2fc0c66765980b705f6b9d1368` | 5 |
| mock-smart-router-jt | `contracts/mock-smart-router.clar` (sim only) | n/a | 4 |

Everything else is live mainnet code: the sbtc-usdcx v5-6 and stx-usdcx v6
routers, the 3 `jing-ladder-dispatch*` contracts and their rungs,
fakfun-core-v2, fakfun-nfts-core, leo-nft-market-faktory, the auth helpers
(v7, smart-execute, mm-safe), the gas station and wallet-core-v2.

## Step 0: deploy fix (uncommitted)

At 321f103, juice-trading does not deploy. Both `clarinet check` (3.23.2) and
the real VM in the fork (check 3) fail with `trait reference expected` at
`rung-entry` (line 2235). The fix binds the trait with `let` and changes
nothing else:

```diff
@@ -2231,10 +2231,12 @@
   rung: <rung-trait>,
   amount: uint,
 }))
-  {
-    rung: (contract-of (get rung a)),
-    amount: (get amount a),
-  }
+  (let ((r (get rung a)))
+    {
+      rung: (contract-of r),
+      amount: (get amount a),
+    }
+  )
 )
```

There were no other deploy errors. `clarinet check` was run on a scratch
project holding helpers-v3, router v6-1, the fixed copy and the original copy.
Only warnings remain on the fixed copy. The original copy gives the one error
above.

## Coverage

- **helpers-v3**: for all 6 new builders (jing-swap, place/withdraw/claim-ladder,
  stake/update pool), the JS hash equals the on-chain hash, and the domain binds
  the safe. Each signed jing-swap field (action, amount, limit-price, min-out,
  auth-id) fails with u4002 when changed. The same holds for place-ladder
  (allocation order, buy, pair, total), withdraw-ladder (request amount, buy) and
  claim-ladder (rung list). An unregistered passkey fails with u4004, and a
  replay fails with u4006.
- **jing-swap**: all 6 directions ran through the live routers (v6-1 deployed
  in the fork), on the admin path and the passkey path. Gas was paid on 2 of
  them. On each run the safe spent exactly `amount - unsold`, received exactly
  the router's `out`, and the router was left holding nothing. Refusals: a
  stranger gets u4001, a bad action u4024, a split mismatch u3004, a min-out
  above the fill u3002, and an amount above the balance an err. With the token
  lock on, the passkey path fails with u4019 and the admin path still runs.
- **Ladders**: all 3 pairs, buy and sell, went through place, withdraw (full)
  and claim. 2 of the 6 sides used the passkey with gas. Only `total` leaves
  the safe on place, and the member is the safe. On withdraw (under
  `with-all-assets-unsafe`) the safe keeps every unit the rungs pay. The
  dispatcher refuses a wrong total (u7102) and a wrong-side rung (u7104). A bad
  pair gives u4024 and a stranger u4001. Claim passes auth, and the rung
  answers u7006 (nothing to claim). With the token lock on, a passkey claim
  fails with u4019.
- **v19 wiring**: smart-buy-sbtc ran through pepe-smart on the admin path, on
  the passkey path with gas, and with a changed amount (u4002). smart-buy-stx
  ran on the admin path. An unregistered router gets u4023, and strangers get
  u4001 on smart-*, faktory-execute and faktory-nft-execute. wager-deposit with
  an unregistered pubkey gets u4001. The admin path ignores the gas param.

## Findings (checks in the run above)

| triage | check(s) | what happened in the fork |
|---|---|---|
| #1 deploy blocker | 3 | 321f103 bytes are rejected on deploy with `trait reference expected`. The fixed bytes deploy (check 4). |
| #2 HIGH: copied v19 functions have no lock, threshold or pending-op check | 158-167 | The owner turns the token lock on. A passkey `sip010-transfer` is refused with u4019 (control, 159). The same passkey alone then (a) spends 500,000 sats (5x the threshold) in `faktory-execute` on sBTC-MIA, with no pending op and `spent-this-period.sbtc` unchanged (161-162), and (b) buys the attacker's own leo-cat, listed at 600,000 sats, through `faktory-nft-execute`. The attacker nets 570,000 sats and the safe loses 600,000 (163-165). The admin key alone also spends 2x the threshold at once (166-167). Control: core-v2 rejects an unregistered pool with u1003 (160), so the theft needs a registered pool or marketplace, and the NFT path is one. |
| #3 HIGH/MED: jing-swap uses one key, min-out 0, and an unsigned route | 30-33, 169-179 | The relayer rerouted a signed DLMM intent to XYK and it was accepted (30-31). Sandwich: the passkey signs a 0.02 BTC sbtc-stx swap with min-out 0. The attacker sells Velar's whole sBTC side, the relayer routes the victim all to Velar, and the attacker buys back. The victim gets 1,150.9 STX against a fair 4,539.0 STX, a 74.6% loss, and the attacker nets +1,228,761 sats (171-174). With min-out signed at 95% of fair, the same sandwich reverts with u3002 (175-177). The admin key alone swaps 2x the threshold at min-out 0, with no pending op (178-179). |
| #4 MED/LOW: execute-pending-*-now confirms via `tx-sender` | 180-186 | The passkey queues 500 STX to the attacker, and the op is marked passkey-created. A stranger gets u4001 and an early execute gets u4014. The admin then calls an attacker contract, `free-airdrop.claim-airdrop`, which calls `execute-pending-stx-transfer-now`. The 500 STX go out at once and the cooldown is skipped (184-186). |

Observations that are not juice-trading bugs:

- **Rung rounding.** A full withdraw came back 1 unit short on 2 of the 6
  sides: sbtc-stx buy returned 599 of 600 sats, and stx-usdcx buy returned
  599,999 of 600,000 USDCx. This is share rounding in the live rung contracts.
  The safe kept every unit the rungs paid.
- **Sandwich sizing.** A sandwich only pays when the victim is large compared
  with Velar's 0.3% fee on the front-run (about 0.3% of the pool's sBTC, or
  ~240k sats today). Against a 200k-sat victim and a 3x-pool front-run, the
  victim lost 93.7% but the attacker lost money on fees (run 2). The run above
  uses a profitable size.
- **Code read only, not run.** `authorize-smart` (the smart-* functions) and
  `wager-deposit` also skip the token-lock check. This is the same class as #2.

## Step table


**A deploy + onboard**

| # | check | result |
|---|---|---|
| 1 | PASS deploy juice-safe-auth-helpers-v3 (Clarity 4) | `deployed` |
| 2 | PASS deploy swap-router-sbtc-stx-jing-v6-1 (Clarity 5, d2f6cad) | `deployed` |
| 3 | PASS FINDING #1 repro: 321f103 juice-trading does NOT deploy | `vm_error: trait reference expected` |
| 4 | PASS deploy juice-trading (Clarity 6, let-fix) | `deployed` |
| 5 | PASS deploy mock-smart-router-jt (unregistered smart router) | `deployed` |
| 6 | PASS core-v2 set-verified-contract(juice-trading) | `{"ok":true}` |
| 7 | PASS onboard by a stranger -> u4001 | `{"err":"u4001"}` |
| 8 | PASS onboard (fakfun deployer) | `passkey, OWNER admin, RECOVERY, 100 STX / 100k sats / 144: {"ok":true}` |
| 9 | PASS onboard twice -> u4001 | `{"err":"u4001"}` |
| 10 | PASS get-owner = OWNER | |
| 11 | PASS passkey registered (is-admin-pubkey ok) | |
| 12 | PASS fund juice-trading 3000000000 uSTX | |
| 13 | PASS fund juice-trading 8000000 sats | `{"ok":true}` |
| 14 | PASS fund SPXW53BDJBCGEFXNWEPZ90BSBTQM8TYEXN20S0F1 50000000 uSTX | |
| 15 | PASS fund SP361P1W3HRW7VTPD1S935RF8PJFMRAF4GJWVT4W9 50000000 uSTX | |
| 16 | PASS fund SP3GZNRSJ9RMA9VTYW0FH9Q9KFB3CGQ8XJ2ED2JE1 50000000 uSTX | |

**B helpers-v3 hashes + signed-field binding**

| # | check | result |
|---|---|---|
| 17 | PASS build-jing-swap-hash | `JS == on-chain (a7a9a0673d3ee5d7…): chain a7a9a0673d3ee5d719db625cf437b2db35b848abdfe0b144a16cb0bbb4f249b3 js …` |
| 18 | PASS build-place-ladder-hash | `JS == on-chain (3012fdb791e112f3…): chain 3012fdb791e112f357fc3833f7c2a682843cdb77082b3712437b20578b4cb9f1 js …` |
| 19 | PASS build-withdraw-ladder-hash | `JS == on-chain (58b8aa88486e102d…): chain 58b8aa88486e102daffb394777b1f3bc42d01e0bf3698dd94687649f2959f00e js …` |
| 20 | PASS build-claim-ladder-hash | `JS == on-chain (428b3baf8219b768…): chain 428b3baf8219b768a97f941367845b03aafa902e20bd5876922d3a644d7199d6 js …` |
| 21 | PASS build-stake-stx-juice-pool-hash | `JS == on-chain (0141c0c9a49ebc62…): chain 0141c0c9a49ebc6217a9a994c373ed8073f9738a71b266c9f33ac6b5cf18d47c js …` |
| 22 | PASS build-update-stake-stx-juice-pool-hash | `JS == on-chain (772349fe512ddab1…): chain 772349fe512ddab12db3c1a8c25a99eb546b592e75e8a9461fda1a6de9984aa3 js …` |
| 23 | PASS domain hash binds the safe (contract-caller) | `3210f973302cdfaba515f57d3fd65673921595a8303957b3380d506368d95e93` |
| 24 | PASS jing-swap signed field mutated (action stx-sbtc) -> u4002 | `{"err":"u4002"}` |
| 25 | PASS jing-swap signed field mutated (amount +1) -> u4002 | `{"err":"u4002"}` |
| 26 | PASS jing-swap signed field mutated (limit-price +1) -> u4002 | `{"err":"u4002"}` |
| 27 | PASS jing-swap signed field mutated (min-out 0) -> u4002 | `{"err":"u4002"}` |
| 28 | PASS jing-swap signed field mutated (auth-id +1) -> u4002 | `{"err":"u4002"}` |
| 29 | PASS jing-swap signed by an unregistered passkey -> u4004/u4002 | `{"err":"u4004"}` |
| 30 | PASS jing-swap UNSIGNED split changed by the relayer (signed DLMM intent sent as XYK) -> accepted | `{"ok":true}` |
| 31 | PASS router print | `all 20,000 sats went to XYK (the venue the signer did not pick): {"amount":"u20000","dlmm-in":"u0","dlmm-out":…` |
| 32 | PASS safe paid exactly 20,000 sats | `{"before":{"stx":"u3000000000","sbtc":"u8000000","usdcx":"u0"},"after":{"stx":"u3046557577","sbtc":"u7980000",…` |
| 33 | PASS jing-swap replayed (same signature) -> u4006 | `{"err":"u4006"}` |

**C jing-swap 6 directions (DLMM legs, keyless)**

| # | check | result |
|---|---|---|
| 34 | PASS stx-usdcx admin | `30000000 stx: {"ok":true}` |
| 35 | PASS stx-usdcx | `safe spent amount - unsold (30000000 - 0), got usdcx = router out: {"spent":"u30000000","unsold":"u0","out":"u…` |
| 36 | PASS router swap-router-stx-usdcx-jing-v6 holds nothing | `{"stx":"u0","sbtc":"u0","usdcx":"u0"}` |
| 37 | PASS stx-usdcx passkey | `30000000 stx: {"ok":true}` |
| 38 | PASS stx-usdcx | `safe spent amount - unsold (30000000 - 0), got usdcx = router out: {"spent":"u30000000","unsold":"u0","out":"u…` |
| 39 | PASS router swap-router-stx-usdcx-jing-v6 holds nothing | `{"stx":"u0","sbtc":"u0","usdcx":"u0"}` |
| 40 | PASS usdcx-stx admin | `1000000 usdcx: {"ok":true}` |
| 41 | PASS usdcx-stx | `safe spent amount - unsold (1000000 - 0), got stx = router out: {"spent":"u1000000","unsold":"u0","out":"u3843…` |
| 42 | PASS router swap-router-stx-usdcx-jing-v6 holds nothing | `{"stx":"u0","sbtc":"u0","usdcx":"u0"}` |
| 43 | PASS usdcx-stx passkey + gas | `1000000 usdcx: {"ok":true}` |
| 44 | PASS usdcx-stx | `safe spent amount - unsold (1000000 - 0), got stx = router out: {"spent":"u1000000","unsold":"u0","out":"u3843…` |
| 45 | PASS gas | `safe paid 20 sats to the station` |
| 46 | PASS router swap-router-stx-usdcx-jing-v6 holds nothing | `{"stx":"u0","sbtc":"u0","usdcx":"u0"}` |
| 47 | PASS sbtc-stx admin | `20000 sbtc: {"ok":true}` |
| 48 | PASS sbtc-stx | `safe spent amount - unsold (20000 - 0), got stx = router out: {"spent":"u20000","unsold":"u0","out":"u46763012…` |
| 49 | PASS router swap-router-sbtc-stx-jing-v6-1 holds nothing | `{"stx":"u0","sbtc":"u0","usdcx":"u0"}` |
| 50 | PASS sbtc-stx passkey + gas | `20000 sbtc: {"ok":true}` |
| 51 | PASS sbtc-stx | `safe spent amount - unsold (20000 - 0), got stx = router out: {"spent":"u20000","unsold":"u0","out":"u46755663…` |
| 52 | PASS gas | `safe paid 20 sats to the station` |
| 53 | PASS router swap-router-sbtc-stx-jing-v6-1 holds nothing | `{"stx":"u0","sbtc":"u0","usdcx":"u0"}` |
| 54 | PASS stx-sbtc admin | `20000000 stx: {"ok":true}` |
| 55 | PASS stx-sbtc | `safe spent amount - unsold (20000000 - 0), got sbtc = router out: {"spent":"u20000000","unsold":"u0","out":"u8…` |
| 56 | PASS router swap-router-sbtc-stx-jing-v6-1 holds nothing | `{"stx":"u0","sbtc":"u0","usdcx":"u0"}` |
| 57 | PASS stx-sbtc passkey | `20000000 stx: {"ok":true}` |
| 58 | PASS stx-sbtc | `safe spent amount - unsold (20000000 - 0), got sbtc = router out: {"spent":"u20000000","unsold":"u0","out":"u8…` |
| 59 | PASS router swap-router-sbtc-stx-jing-v6-1 holds nothing | `{"stx":"u0","sbtc":"u0","usdcx":"u0"}` |
| 60 | PASS sbtc-usdcx admin | `20000 sbtc: {"ok":true}` |
| 61 | PASS sbtc-usdcx | `safe spent amount - unsold (20000 - 0), got usdcx = router out: {"spent":"u20000","unsold":"u0","out":"u120154…` |
| 62 | PASS router swap-router-sbtc-usdcx-jing-v5-6 holds nothing | `{"stx":"u0","sbtc":"u0","usdcx":"u0"}` |
| 63 | PASS sbtc-usdcx passkey | `20000 sbtc: {"ok":true}` |
| 64 | PASS sbtc-usdcx | `safe spent amount - unsold (20000 - 0), got usdcx = router out: {"spent":"u20000","unsold":"u0","out":"u120154…` |
| 65 | PASS router swap-router-sbtc-usdcx-jing-v5-6 holds nothing | `{"stx":"u0","sbtc":"u0","usdcx":"u0"}` |
| 66 | PASS usdcx-sbtc admin | `1000000 usdcx: {"ok":true}` |
| 67 | PASS usdcx-sbtc | `safe spent amount - unsold (1000000 - 0), got sbtc = router out: {"spent":"u1000000","unsold":"u0","out":"u164…` |
| 68 | PASS router swap-router-sbtc-usdcx-jing-v5-6 holds nothing | `{"stx":"u0","sbtc":"u0","usdcx":"u0"}` |
| 69 | PASS usdcx-sbtc passkey | `1000000 usdcx: {"ok":true}` |
| 70 | PASS usdcx-sbtc | `safe spent amount - unsold (1000000 - 0), got sbtc = router out: {"spent":"u1000000","unsold":"u0","out":"u164…` |
| 71 | PASS router swap-router-sbtc-usdcx-jing-v5-6 holds nothing | `{"stx":"u0","sbtc":"u0","usdcx":"u0"}` |
| 72 | PASS jing-swap stranger (no sig) -> u4001 | `{"err":"u4001"}` |
| 73 | PASS jing-swap bad action -> u4024 | `{"err":"u4024"}` |
| 74 | PASS jing-swap split mismatch (dlmm = amount + 1) -> router u3004 | `{"err":"u3004"}` |
| 75 | PASS jing-swap min-out above fill -> router u3002 | `{"err":"u3002"}` |
| 76 | PASS jing-swap amount > safe sBTC balance -> refused (err) | `{"err":"u2001"}` |
| 77 | PASS admin toggle-token-lock true | `{"ok":true}` |
| 78 | PASS token lock on | `passkey jing-swap -> u4019: {"err":"u4019"}` |
| 79 | PASS token lock on | `admin jing-swap still runs: {"ok":true}` |
| 80 | PASS admin toggle-token-lock false | `{"ok":true}` |

**D ladders (3 pairs x buy/sell): place -> withdraw -> claim**

| # | check | result |
|---|---|---|
| 81 | PASS sbtc-stx buy | `jing-buy-stx-1-v2 registered as buy-band: {"price":"u1","side":"buy-band"}` |
| 82 | PASS place-ladder total != sum -> dispatcher u7102 | `{"err":"u7102"}` |
| 83 | PASS place-ladder wrong-side rung -> dispatcher u7104 | `{"err":"u7104"}` |
| 84 | PASS place-ladder bad pair -> u4024 | `{"err":"u4024"}` |
| 85 | PASS place-ladder stranger -> u4001 | `{"err":"u4001"}` |
| 86 | PASS place-ladder signed allocations reordered -> u4002 | `{"err":"u4002"}` |
| 87 | PASS place-ladder signed buy flipped -> u4002 | `{"err":"u4002"}` |
| 88 | PASS place-ladder signed pair changed -> u4002 | `{"err":"u4002"}` |
| 89 | PASS place-ladder signed total changed -> u4002 | `{"err":"u4002"}` |
| 90 | PASS place-ladder sbtc-stx buy passkey + gas | `600 sbtc over 2 rungs: {"ok":true}` |
| 91 | PASS only 600 sbtc left the safe (+ 20 sats gas) | `{"before":{"stx":"u3071144868","sbtc":"u7910194","usdcx":"u35485714"},"mid":{"stx":"u3071144868","sbtc":"u7909…` |
| 92 | PASS ladder-dispatched print | `member = safe: [null,"place-ladder","rung-epoch-closed","rung-deposit","pending-deposit-x","rung-deposit","lad…` |
| 93 | PASS withdraw-ladder signed request amount changed -> u4002 | `{"err":"u4002"}` |
| 94 | PASS withdraw-ladder signed buy flipped -> u4002 | `{"err":"u4002"}` |
| 95 | PASS withdraw-ladder stranger -> u4001 | `{"err":"u4001"}` |
| 96 | PASS withdraw-ladder sbtc-stx buy passkey + gas (with-all-assets-unsafe) | `{"ok":true}` |
| 97 | PASS safe kept every unit the rungs paid back (599 sbtc), gas aside | `{"mid":{"stx":"u3071144868","sbtc":"u7909574","usdcx":"u35485714"},"end":{"stx":"u3071144868","sbtc":"u7910153…` |
| 98 | PASS rungs paid back 599 of 600 sbtc (shortfall 1 | `live rung share rounding, <= 1 unit per rung): {"paid":"u599","total":"u600"}` |
| 99 | PASS claim-ladder signed rung list changed -> u4002 | `{"err":"u4002"}` |
| 100 | PASS claim-ladder sbtc-stx buy passkey | `auth passes, nothing moves out (as-contract? with no allowance): {"err":"u7006"}` |
| 101 | PASS sbtc-stx sell | `jing-sell-stx-1-v2 registered as sel-band: {"price":"u1","side":"sel-band"}` |
| 102 | PASS place-ladder sbtc-stx sell passkey + gas | `600000 stx over 2 rungs: {"ok":true}` |
| 103 | PASS only 600000 stx left the safe (+ 20 sats gas) | `{"before":{"stx":"u3071144868","sbtc":"u7910153","usdcx":"u35485714"},"mid":{"stx":"u3070544868","sbtc":"u7910…` |
| 104 | PASS ladder-dispatched print | `member = safe: [null,"place-ladder","rung-epoch-closed","rung-deposit","rung-deposit","ladder-dispatched"]` |
| 105 | PASS withdraw-ladder sbtc-stx sell passkey + gas (with-all-assets-unsafe) | `{"ok":true}` |
| 106 | PASS safe kept every unit the rungs paid back (600000 stx), gas aside | `{"mid":{"stx":"u3070544868","sbtc":"u7910133","usdcx":"u35485714"},"end":{"stx":"u3071144868","sbtc":"u7910113…` |
| 107 | PASS rungs paid back 600000 of 600000 stx (shortfall 0 | `live rung share rounding, <= 1 unit per rung): {"paid":"u600000","total":"u600000"}` |
| 108 | PASS claim-ladder sbtc-stx sell passkey | `auth passes, nothing moves out (as-contract? with no allowance): {"err":"u7006"}` |
| 109 | PASS sbtc-usdcx buy | `jing-buy-sbtc-1-v2 registered as buy-band: {"price":"u1","side":"buy-band"}` |
| 110 | PASS place-ladder sbtc-usdcx buy admin | `600000 usdcx over 2 rungs: {"ok":true}` |
| 111 | PASS only 600000 usdcx left the safe | `{"before":{"stx":"u3071144868","sbtc":"u7910113","usdcx":"u35485714"},"mid":{"stx":"u3071144868","sbtc":"u7910…` |
| 112 | PASS ladder-dispatched print | `member = safe: ["place-ladder","rung-epoch-closed","rung-deposit","rung-epoch-closed","rung-deposit","ladder-d…` |
| 113 | PASS withdraw-ladder sbtc-usdcx buy admin (with-all-assets-unsafe) | `{"ok":true}` |
| 114 | PASS safe kept every unit the rungs paid back (600000 usdcx), gas aside | `{"mid":{"stx":"u3071144868","sbtc":"u7910113","usdcx":"u34885714"},"end":{"stx":"u3071144868","sbtc":"u7910113…` |
| 115 | PASS rungs paid back 600000 of 600000 usdcx (shortfall 0 | `live rung share rounding, <= 1 unit per rung): {"paid":"u600000","total":"u600000"}` |
| 116 | PASS claim-ladder sbtc-usdcx buy admin | `auth passes, nothing moves out (as-contract? with no allowance): {"err":"u7006"}` |
| 117 | PASS sbtc-usdcx sell | `jing-sell-sbtc-1-v2 registered as sel-band: {"price":"u1","side":"sel-band"}` |
| 118 | PASS place-ladder sbtc-usdcx sell admin | `600 sbtc over 2 rungs: {"ok":true}` |
| 119 | PASS only 600 sbtc left the safe | `{"before":{"stx":"u3071144868","sbtc":"u7910113","usdcx":"u35485714"},"mid":{"stx":"u3071144868","sbtc":"u7909…` |
| 120 | PASS ladder-dispatched print | `member = safe: ["place-ladder","rung-epoch-closed","rung-deposit","rung-deposit","ladder-dispatched"]` |
| 121 | PASS withdraw-ladder sbtc-usdcx sell admin (with-all-assets-unsafe) | `{"ok":true}` |
| 122 | PASS safe kept every unit the rungs paid back (600 sbtc), gas aside | `{"mid":{"stx":"u3071144868","sbtc":"u7909513","usdcx":"u35485714"},"end":{"stx":"u3071144868","sbtc":"u7910113…` |
| 123 | PASS rungs paid back 600 of 600 sbtc (shortfall 0 | `live rung share rounding, <= 1 unit per rung): {"paid":"u600","total":"u600"}` |
| 124 | PASS claim-ladder sbtc-usdcx sell admin | `auth passes, nothing moves out (as-contract? with no allowance): {"err":"u7006"}` |
| 125 | PASS stx-usdcx buy | `jing-buy-stx-usdc-1 registered as buy-band: {"price":"u1","side":"buy-band"}` |
| 126 | PASS place-ladder stx-usdcx buy admin | `600000 usdcx over 2 rungs: {"ok":true}` |
| 127 | PASS only 600000 usdcx left the safe | `{"before":{"stx":"u3071144868","sbtc":"u7910113","usdcx":"u35485714"},"mid":{"stx":"u3071144868","sbtc":"u7910…` |
| 128 | PASS ladder-dispatched print | `member = safe: ["place-ladder","deposit-y","rung-deposit","deposit-y","rung-deposit","ladder-dispatched"]` |
| 129 | PASS withdraw-ladder stx-usdcx buy admin (with-all-assets-unsafe) | `{"ok":true}` |
| 130 | PASS safe kept every unit the rungs paid back (599999 usdcx), gas aside | `{"mid":{"stx":"u3071144868","sbtc":"u7910113","usdcx":"u34885714"},"end":{"stx":"u3071144868","sbtc":"u7910113…` |
| 131 | PASS rungs paid back 599999 of 600000 usdcx (shortfall 1 | `live rung share rounding, <= 1 unit per rung): {"paid":"u599999","total":"u600000"}` |
| 132 | PASS claim-ladder stx-usdcx buy admin | `auth passes, nothing moves out (as-contract? with no allowance): {"err":"u7006"}` |
| 133 | PASS stx-usdcx sell | `jing-sell-stx-usdc-1 registered as sel-band: {"price":"u1","side":"sel-band"}` |
| 134 | PASS place-ladder stx-usdcx sell passkey + gas | `600000 stx over 2 rungs: {"ok":true}` |
| 135 | PASS only 600000 stx left the safe (+ 20 sats gas) | `{"before":{"stx":"u3071144868","sbtc":"u7910113","usdcx":"u35485713"},"mid":{"stx":"u3070544868","sbtc":"u7910…` |
| 136 | PASS ladder-dispatched print | `member = safe: [null,"place-ladder","rung-deposit","rung-deposit","ladder-dispatched"]` |
| 137 | PASS withdraw-ladder stx-usdcx sell passkey + gas (with-all-assets-unsafe) | `{"ok":true}` |
| 138 | PASS safe kept every unit the rungs paid back (600000 stx), gas aside | `{"mid":{"stx":"u3070544868","sbtc":"u7910093","usdcx":"u35485713"},"end":{"stx":"u3071144868","sbtc":"u7910073…` |
| 139 | PASS rungs paid back 600000 of 600000 stx (shortfall 0 | `live rung share rounding, <= 1 unit per rung): {"paid":"u600000","total":"u600000"}` |
| 140 | PASS claim-ladder stx-usdcx sell passkey | `auth passes, nothing moves out (as-contract? with no allowance): {"err":"u7006"}` |
| 141 | PASS admin toggle-token-lock true | `{"ok":true}` |
| 142 | PASS token lock on | `passkey claim-ladder -> u4019: {"err":"u4019"}` |
| 143 | PASS admin toggle-token-lock false | `{"ok":true}` |

**E v19 functions wired into the safe**

| # | check | result |
|---|---|---|
| 144 | PASS registry | `pepe-smart-faktory approved` |
| 145 | PASS smart-buy-sbtc admin (pepe-smart, 2,000 sats, fak-ratio 100) | `{"ok":{"sbtc-amount":"u2000","token-from-dex":"u0","token-from-fak":"u372752609","total-token-out":"u372752609…` |
| 146 | PASS smart-buy-sbtc passkey + gas | `{"ok":{"sbtc-amount":"u2000","token-from-dex":"u0","token-from-fak":"u372459306","total-token-out":"u372459306…` |
| 147 | PASS safe paid 2,000 sats + gas | |
| 148 | PASS smart-buy-sbtc passkey, amount changed after signing -> u4002 | `{"err":"u4002"}` |
| 149 | PASS smart-buy-stx admin (pepe-smart, 2 STX) | `{"ok":{"stx-amount":"u2000000","token-from-alex":"u161235727","token-from-fak":"u0","total-token-out":"u161235…` |
| 150 | PASS smart-buy-sbtc unregistered router -> u4023 | `{"err":"u4023"}` |
| 151 | PASS smart-buy-sbtc stranger -> u4001 | `{"err":"u4001"}` |
| 152 | PASS faktory-execute stranger -> u4001 | `{"err":"u4001"}` |
| 153 | PASS faktory-nft-execute stranger -> u4001 | `{"err":"u4001"}` |
| 154 | PASS wager-deposit admin, pubkey not registered to this safe -> u4001 | `{"err":"u4001"}` |
| 155 | PASS smart-buy-sbtc admin with gas param | `gas ignored: {"ok":{"sbtc-amount":"u1000","token-from-dex":"u0","token-from-fak":"u186119718","total-token-out…` |
| 156 | PASS safe paid exactly 1,000 sats (no gas on the admin path) | |

**F FINDING repros (expected result = the bug)**

| # | check | result |
|---|---|---|
| 157 | PASS attacker deploys evil-pool (dexterity pool trait shape, execute = send sBTC to attacker) | `deployed` |
| 158 | PASS owner turns the token lock ON (passkey should be frozen) | `{"ok":true}` |
| 159 | PASS control | `passkey sip010-transfer while locked -> u4019: {"err":"u4019"}` |
| 160 | PASS control | `passkey faktory-execute through an UNREGISTERED pool -> core-v2 u1003 (pool not found): {"err":"u1003"}` |
| 161 | PASS FINDING #2 repro (a) | `passkey ALONE, lock ON, faktory-execute buy 500,000 sats (5x threshold) on sBTC-MIA -> ok: {"ok":{"dk":"u0","d…` |
| 162 | PASS safe -500,000 sats at once | `no pending op, spent-this-period.sbtc unchanged, lock ignored: {"nonce0":"u0","nonce1":"u0","spent0":{"gas":"u…` |
| 163 | PASS attacker (a real leo-cats holder) lists own cat #5 on leo-nft-market-faktory for 600,000 sats sBTC | `#2:{"err":"u106"} #3:{"err":"u106"} #5:{"ok":true}` |
| 164 | PASS FINDING #2 repro (b) | `passkey ALONE, lock ON, faktory-nft-execute BUY at 600,000 sats -> ok: {"ok":true}` |
| 165 | PASS safe -600,000 sats, attacker +570,000 (95% after royalty + platform fee), no pending op | `{"got":"u570000"}` |
| 166 | PASS FINDING #2 (admin key alone) | `faktory-execute buy 200,000 sats (2x threshold) on sBTC-MIA -> runs at once: {"ok":{"dk":"u0","dx":"u199200","…` |
| 167 | PASS no pending op, safe -200,000 | |
| 168 | PASS owner turns the token lock OFF | `{"ok":true}` |
| 169 | PASS velar sBTC/STX pool | `sBTC reserve 79655628, STX reserve 185862822275; fair (cp quote, fee 9970/10000) for 2000000 sats = 4539034367…` |
| 170 | PASS fund SP3GZNRSJ9RMA9VTYW0FH9Q9KFB3CGQ8XJ2ED2JE1 79655628 sats | `{"ok":true}` |
| 171 | PASS sandwich front-run | `attacker sells 79655628 sats on Velar (router v6-1, velar leg): {"ok":{"dlmm-in":"u0","dlmm-out":"u0","jing-in…` |
| 172 | PASS FINDING #3 repro | `relayer sends the passkey's swap (min-out 0) all to Velar after the front-run -> ok: {"ok":true}` |
| 173 | PASS sandwich back-run | `attacker sells the STX it got back into sBTC on Velar: {"ok":{"dlmm-in":"u0","dlmm-out":"u0","jing-in":"u0","j…` |
| 174 | PASS victim got 1150938116 uSTX vs fair 4539034367 (loss 74.64%), no pending op for 20x threshold; attacker net 1228761 sats, 0 uSTX | `{"got":"u1150938116","fair":"u4539034367","lossBp":"u7464","profit":"u1228761"}` |
| 175 | PASS control | `front-run again: {"ok":{"dlmm-in":"u0","dlmm-out":"u0","jing-in":"u0","jing-ok":false,"jing-out":"u0","out":"u…` |
| 176 | PASS control | `signed min-out = 95% of fair, routed to Velar after the front-run -> u3002: {"err":"u3002"}` |
| 177 | PASS control | `attacker unwinds: {"ok":{"dlmm-in":"u0","dlmm-out":"u0","jing-in":"u0","jing-ok":false,"jing-out":"u0","out":"…` |
| 178 | PASS FINDING #3 (admin key alone) | `jing-swap 200,000 sats (2x threshold), min-out 0 -> runs at once: {"ok":true}` |
| 179 | PASS no pending op | |
| 180 | PASS passkey stx-transfer 500 STX to attacker -> queued (over threshold) | `{"ok":true}` |
| 181 | PASS pending op u0 | `passkey-created, not executed: {"amount":"u500000000","execute-after":"u977851","executed":false,"extension":n…` |
| 182 | PASS execute-pending-stx-transfer before the cooldown -> u4014 | `{"err":"u4014"}` |
| 183 | PASS stranger execute-pending-stx-transfer-now -> u4001 | `{"err":"u4001"}` |
| 184 | PASS attacker deploys free-airdrop (claim-airdrop calls the safe's execute-pending-stx-transfer-now) | `deployed` |
| 185 | PASS FINDING #4 repro | `admin calls free-airdrop.claim-airdrop -> the passkey op executes (tx-sender = admin): {"ok":true}` |
| 186 | PASS attacker +500 STX, op executed, no cooldown | `{"got":"u500000000"}` |
