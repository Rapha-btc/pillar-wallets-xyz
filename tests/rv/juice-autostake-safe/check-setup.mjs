// check-setup.mjs -- asserts the rv-setup batch really ran in the simnet rv
// will use (plan kept, pool registered, safe onboarded and funded).
// Usage (from tests/rv/juice-autostake-safe): node check-setup.mjs
import { initSimnet } from "@stacks/clarinet-sdk";
import { Cl } from "@stacks/transactions";
import { WALLET, POOL } from "./keys.mjs";

const s = await initSimnet("./Clarinet.toml");
const ro = (c, f, a = []) => Cl.prettyPrint(s.callReadOnlyFn(c, f, a, s.deployer).result);
const out = {
  owner: ro(WALLET, "get-owner"),
  keeper: ro(WALLET, "get-keeper"),
  signer: ro("SP000000000000000000002Q6VF78.pox-5", "get-signer-info", [Cl.principal(POOL)]).slice(0, 60),
  stx: s.getAssetsMap().get("STX")?.get(WALLET),
  sbtc: ro("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token", "get-balance", [Cl.principal(WALLET)]),
  ft: ro(`${WALLET.split(".")[0]}.zz-ft`, "get-balance", [Cl.principal(WALLET)]),
  burn: s.burnBlockHeight,
};
console.log(out);
if (!out.owner.includes("ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5")) throw new Error("onboard did not run");
if (out.signer === "none") throw new Error("pool not registered");
if (!out.stx) throw new Error("safe not funded");
console.log("rv-setup OK");
