# November 26–27 contract regressions

From the repository root, with Clarinet **3.23.2** installed:

```sh
npm ci --prefix tests/nov27
npm --prefix tests/nov27 test
```

The isolated package pins Clarinet SDK **3.23.2** and Vitest **3.2.4**. Each test
creates a fresh simnet in its arrange section; there are no beforeAll/beforeEach
hooks or skipped tests. `run.sh` builds local fixtures, runs `clarinet check`,
and then runs only this directory's test files. Generated files stay under
`.build` (and wallet manifest settings/deployments are ignored).

The checked-in `Clarinet.toml` includes juice-savings, juice-trading and the
production juice-safe-auth-helpers-v3. Build copies the current production files
and records their SHA-256 hashes. Only dependency principals are rebound.
Auth hash builders and WebAuthn verifier are full local copies; external logging,
PoX, venues, tokens and registry use small local mocks. PoX state and stake-update
arguments are observable; this does not emulate the node's STX lock handler.
Wallet initialization, keeper selection and token lock use production public
entrypoints. Lock tests compare the same malformed passkey with lock off (u4002)
and on (u4019), using the real verifier. Router mocks record every forwarded
argument. No production authorization guards or function bodies are replaced.

These are deterministic unit/integration regressions with mocked external
services, not mainnet liquidity or oracle-signature integration tests. Production
source files, the root manifest and existing deployment plans are left untouched.

## Coverage and seeded fuzzing

See [RESULTS.md](RESULTS.md) for per-file pass counts, baseline/current production
line coverage, function coverage, source hashes and remaining gaps. Coverage
collection uses an afterEach reporting hook only; test setup remains explicit.

The `rendezvous*.test.ts` files use Rendezvous 1.0.3 ABI argument generation and
fast-check shrinking, with seeds 20261126 and 20261127. Default: 500 generated
cases per property. `RV_RUNS=2000 npm --prefix tests/nov27 test` increases the
campaign. They run inside the same pinned Clarinet SDK, independently of older
RV harnesses. `package-lock.json` pins the transitive toolchain as well.

The expanded wallet suite also uses real P-256/WebAuthn signatures generated with
Node crypto, tests replay rejection and owner rotation, and verifies every v3
hash builder against an independent SIP-018 calculation for two callers. The
private scalar in passkey.ts is a public test fixture, never a production key.

The root Vitest configuration excludes this isolated package; run it with the
explicit command above to avoid mixing SDK/Vitest versions and setup hooks.
