# Mainnet deploys, verified

Each row: the on-chain source was compared by hand with the repo source and
matches. Deploy bytes have no comments and are `clarinet format` output, so
the comparison is code to code. Hash = sha512/256 of the on-chain source.

## 2026-10-15

Verified by Rapha: GREEN.

| Contract | Tx | Block | Hash | Source |
|---|---|---|---|---|
| `SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-safe-auth-helpers-v2` | `0xac39454510f44e18578d56294887b0ead4a8c4ee3bb0655861bf89ba29f8b1bf` | 9218447 | `40be7146cbc29ebf51cf5b7bcafc3727f7d71da5e2c7d6fe4ee94a2da00f1b7f` | `contracts/juice-safe-auth-helpers-v2.clar` at `b1ecb09` |
| `SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-safe-v8` | `0x7b734f8abd50dd4a1bf3e28596c27d882dde4f66ceac2b0d002b7882bf3723d5` | 9218449 | `b3d74b90efebba24a28e3c8d5101fd7c56208deb1699088f18206565f1c0ba15` | `contracts/juice-safe-v8.clar` at `b1ecb09` |

juice-safe-v8 registered as verified in `fakfun-wallet-core-v2`
(`set-verified-contract`, tx `0xb11b0e6297e08b9170eac9bd18d7d5b2623d8a5d353ec9972222cce5a40c015f`,
block 9218451).

## 2026-10-15 (later): v9 + autostake (bounty mv8wal fixes)

Verified by Rapha: GREEN.

| Contract | Tx | Block | Hash | Source |
|---|---|---|---|---|
| `SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-safe-v9` | `0x89b18069f659f2d1695f0d8a6df41292e52da9a32b1aec85411c3baba144e147` | 9219780 | `6962a7d89c2bc8d04e6bd89c9814f417ac9e281b00cbde5e9b5f41634e1fbec1` | `contracts/juice-safe-v9.clar` at `d4eda1c` |
| `SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-autostake-safe-auth-helpers-v1` | `0x99d6958017db47d77c72e8317bc53f4f8baf1e20cf7f3e33de55bd813f668d49` | 9219792 | `766bd83014e8b2476ff54d68a04860edee17548ead98d001277a8f9333492692` | `contracts/juice-autostake-safe-auth-helpers-v1.clar` |
| `SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.juice-autostake-safe` | `0xa6e9ab26104bf83c0bc7daf59e63a9ed10cdc9620b8dddf7211087f59890eb81` | 9219793 | `b575f372e3a75b9fd4bdf8732c1bf3ad4a8f1a7ae630faf6fdb3144b3232ac86` | `contracts/juice-autostake-safe.clar` at `d4eda1c` |

Registered as verified in `fakfun-wallet-core-v2` (`set-verified-contract`):
juice-safe-v9 tx `0xe15235fd193768ef554b0e67ff5fda1c5e61de1f7a589c2f2458fc5ef60fa402`
(block 9219781), juice-autostake-safe tx
`0xaa4814b57c7d984c968030a4a3724b5db2f2bc95f6171866a8d221b2f965ac32` (block 9219794).
stxer: memo binding 283/283, regressions green (harness 5076348).
