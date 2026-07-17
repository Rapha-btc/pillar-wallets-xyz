# Wallet trust models: browser passkey wallets, TEEs, and on-chain smart wallets

Partners regularly ask us some version of the same question: "what happens to
user wallets if your infrastructure disappears?" The answer depends entirely
on which trust model the wallet uses. This doc lays out the three models we
get asked about, what each one actually guarantees, and when to use which.

## The three models

| | A. Browser passkey hot wallet | B. TEE / split-seed custody | C. On-chain smart wallet (this repo) |
|---|---|---|---|
| Where key material lives | User's browser/device only | Split between user device and provider enclave | User's passkey (secure enclave); wallet logic on-chain |
| Server ever sees a key? | Never | Holds a share (claims it can't read it) | Never |
| If the provider dies | Wallet unaffected | Recovery depends on provider's DR design | Wallet unaffected (contract is on-chain) |
| Recovery / rotation | None (passkey sync only) | Provider-dependent | On-chain admin/recovery paths |
| Cost to operate | ~zero (static JS) | Very high (see below) | Contract deploy + relay |
| Good for | Games, onboarding, low-stakes balances | Wallet-as-a-service products at scale | Balances worth protecting, guards, DCA, team wallets |

## Model A: passkey-derived hot wallet (browser-only)

A standard Stacks account whose key is derived from / unlocked by the user's
passkey, with all decryption happening in the user's browser. Reference
implementation: [DeOrganized/stacks-passkey-wallet](https://github.com/DeOrganized/stacks-passkey-wallet).

- No key material ever touches a server - ours, yours, anyone's. At most a
  ciphertext blob is stored somewhere, and ciphertext without the passkey is
  noise. There is nothing custodial to fail.
- The entire trust surface is a static JS bundle anyone can read.
- Gasless UX works with plain Stacks sponsored transactions (e.g.
  [tx2.app](https://tx2.app/)) - no smart wallet needed.
- The trade-off: no recovery and no rotation. Lose the passkey, lose the
  wallet. In practice this is mitigated by iCloud / Google passkey sync, but
  it is a real property of the model, and WebAuthn platform quirks (PRF
  extension support varies by browser/authenticator) come with it.

This is the right default for game onboarding and any app where wallets hold
awards, points, or small balances. It is deliberately boring.

## Model B: TEE + split-seed custody (the Privy/Turnkey model)

The provider holds a share of the seed inside a trusted execution
environment, the user's device holds another share. People assume the cost
here is the hardware. It is not - an AWS Nitro Enclave costs barely more
than a normal server. The cost is everything required to make the security
claim actually true:

1. **Enclave development is niche work.** Code inside a TEE runs in a
   stripped-down environment - no normal OS services, narrow marshalled
   interfaces. The pool of engineers who have shipped production enclave
   code is small, and mistakes at that layer are exactly the mistakes the
   TEE was supposed to prevent.
2. **Attestation is a whole subsystem.** The TEE's value is proving "this
   exact, audited code runs in a genuine enclave." That means reproducible
   builds, a code-signing ceremony, an attestation verification service,
   and clients that actually check it. Skip any link and the TEE is theater.
3. **Key lifecycle is brutal.** Keys sealed to an enclave die with it, so
   you need backup and disaster recovery that does not quietly become "we
   have a copy of the seed after all." Seed splitting (Shamir shares across
   device and enclave) means distributed key management, migration
   ceremonies whenever enclave code changes (new code = new measurement =
   sealed data will not unseal), and multi-region redundancy.
4. **The assurance bar is custody-grade.** Once you hold a key share you
   are a target and a bug is irreversible loss of user funds: external
   audits, pen tests, 24/7 ops, tracking the steady drip of TEE side-channel
   CVEs (patch, rebuild, re-attest, migrate), plus legal analysis of whether
   you have become a custodian in a regulatory sense. None of this is
   one-time.

That bundle is why Privy and Turnkey exist as products: they amortize those
fixed costs across hundreds of customers. It is also why we do not host
passkey hot-wallet flows ourselves - doing it honestly means building all of
the above, and for most integrations Model A makes it unnecessary.

## Model C: on-chain smart wallet (pillar-wallets)

The wallet is a Clarity contract; the user's passkey signs WebAuthn
challenges verified on-chain (see [clarity-webauthn](contracts/clarity-webauthn.clar)).
Key material still never leaves the user's secure enclave - the difference
from Model A is that the wallet itself is programmable:

- recovery and admin paths that survive a lost device
- spending guards, cooldowns, allowlists
- automation (DCA, auto-compound, boost) executed by relays that can
  never steal, only perform pre-authorized actions
- team/multi-operator setups

The relay trust model matches Model A's spirit: the relay sponsors and
broadcasts transactions but cannot forge a passkey signature, so if the
relay dies, funds sit safely in the contract and any node can broadcast a
user-signed exit.

## Choosing, and the upgrade path

Start with Model A when the wallet holds low-stakes assets and onboarding
friction is the enemy. Move to Model C when balances grow and users start
wanting recovery, guards, or automation - the same passkey that unlocked the
hot wallet can control a Pillar smart wallet, so the migration is a
contract deploy plus a transfer, not a re-onboarding.

Model B is what you build when you are a wallet-as-a-service company. If
you are not, buy it or avoid needing it.
