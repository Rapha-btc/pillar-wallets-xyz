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
