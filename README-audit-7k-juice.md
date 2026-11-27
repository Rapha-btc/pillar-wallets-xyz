# Audit 7k: Juice safes, triage and decisions

AIBTC bounty `mwvrpx3a633f201e8caa` (7k sats, 25 submissions). **Winner: Frosty Narwhal** (submission `mwvsp79a4ebaad668411`, first on #4 and #5, early on #3), paid 7,000 sats on 2026-11-27, tx `2a0af1aab0f413209a5e8dc49e620d76faf0d672f982809760e0fbe061f4935d`. Code pinned at
`321f103`. Scope: `juice-savings`, `juice-trading`, `juice-safe-auth-helpers-v3`,
and Jing router v6-1.

Each finding below was checked against the code and, where possible, run on a
stxer mainnet fork:

- juice-savings + helpers-v3: 159/159
  <https://stxer.xyz/simulations/mainnet/92145730db71e3a514df33be6e1034f8>
- juice-trading: 186/186
  <https://stxer.xyz/simulations/mainnet/fd35f788717606860585b68e5f9cb0bc>
- router v6-1: 395/395
  <https://stxer.xyz/simulations/mainnet/f14835d54c8481211e14c202d07bc36c>

"First" names the earliest valid submission for that finding.

## Valid findings

| # | Severity | Finding | First | Decision |
|---|----------|---------|-------|----------|
| 1 | Blocker | `juice-trading` fails to deploy: `rung-entry` does `(contract-of (get rung a))`, and `contract-of` only accepts a trait reference (a parameter or a `let` binding), so clarinet reports "trait reference expected". | Void Kael (then Rare Jett) | **Fixed** in `3446fb6`: bind the rung with `let`, then call `contract-of`. |
| 2 | High | Functions copied from v19 into `juice-trading` (`faktory-execute`, `faktory-place-order`, `faktory-process`, `faktory-nft-execute`, `wager-deposit`, `authorize-smart`) skip the token-lock check on their passkey branch. A single passkey can move funds while the owner has locked the safe. | Furious Taro (then Rare Jett H-01) | **Fixed** in `2b471f6`: `(asserts! (not (var-get token-lock-enabled)) err-token-locked)` is now the first line of each passkey branch. `process-claim` and `fee-airdrop` were left as they are: they move nothing out (empty `as-contract? ()`). |
| 3 | High/Med | `jing-swap` has no threshold. One key signs the amount and a min-out that can be 0, and the route split isn't signed, so a sandwich on thin Velar liquidity can take most of the swap (-74.6% on the fork). | Halcyon Cyrus (PoC); earlier as Info by Frosty Narwhal / Daring Dex; admin variant by Gusty Gecko | **Accepted risk.** Swapped funds stay in the safe and never leave the owner's control, so no threshold or oracle floor is added. Trading carries risk, and min-out is the owner's choice. |
| 4 | Med/Low | `execute-pending-*-now`: an op created with the passkey can be confirmed through `(is-admin-calling tx-sender)`, so a hostile contract that the admin calls can confirm it. | Frosty Narwhal L-2 (then Galactic Vulture, Diamond Lance) | **Not fixed** (skipped). |
| 25 | Medium | Variant of #4 on `stake-stx-juice` / `update-stake-stx-juice`: with no passkey signature, a hostile contract the admin calls passes as the admin (`tx-sender`), stakes the safe into Fastpool and sets the attacker's BTC address as the payout calldata, so staking rewards go to the attacker (fork repro: 29,526 sats). The staked STX can't be moved. | SP3BNE4Y… (submission `mwy7zd2e97ae58fef64a`, after the winner was picked) | **Accepted risk.** The admin must sign a call to an unknown contract, and the Juice wallet and frontend show which contract is called. A blanket `contract-caller` rule would block intermediary contracts and contract admins. |
| 5 | Low | `restake` passed `signer-calldata none` to pox-5. Fastpool's `validate-stake!` reads `none` as "delete the payout config", so a keeper restake on a Fastpool safe would wipe the owner's BTC payout setting (rewards fall back to sBTC paid to the safe; nothing is lost). | Frosty Narwhal L-1 | **Fixed** in `fd861e0`. In practice the keeper only restakes `juice-pool-sbtc-signer` safes (the pool that pays STX, which ignores calldata). `restake` now takes no `signer` argument: it asserts the safe is staked in `JUICE-SIGNER` and calls `stake-update JUICE-SIGNER JUICE-SIGNER`. Keeper bots must call `restake` with no arguments. |

## Rejected

| # | Finding | First | Why rejected |
|---|---------|-------|--------------|
| 7 | `juice-safe-v10` calls `juice-safe-auth-helpers-v3.build-set-pool-hash`, which helpers-v3 doesn't define. | Patient Reed | Out of scope: v10 was an old draft, not part of the audit, and is replaced by `juice-savings`. `contracts/juice-safe-v10.clar` is deleted, and the helpers-v3 header now names its real callers. |
| 24 | Same as #6 (`old-signer` unsigned). Its scenario assumes a safe staked in two pools at once. | SPHAP4AZ… | Duplicate of #6. pox-5 gives a safe one position only. |
| 6 | `old-signer` in `update-stake-stx-juice` and `unstake` isn't covered by the passkey signature. | Daring Dex (many duplicates) | No impact. pox-5 checks that `old-signer` is the safe's current pool, so a wrong value just aborts the transaction (the gas payment is undone with it). Signing it would add nothing. |
| - | "Critical": one key can both create and confirm a pending op. | Huge Key | False. When the op isn't passkey-created, `sig-auth` is unwrapped, so one key can't do both steps. |
| - | Gas Low. | Violet Jaguar | By design: the admin pays their own fee. |
| - | Router v6-1 notes (price-0 split, 1-sat haircut, tick +1, sbtc-usdcx Zest revert). | various | Info only. Live pool u3 (x = sBTC) confirmed on the fork; no bug found. |
