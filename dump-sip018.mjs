import {
  tupleCV,
  uintCV,
  stringAsciiCV,
  principalCV,
  serializeCV,
} from "@stacks/transactions";
import crypto from "node:crypto";

const WALLET = "SPV9K21TBFAK4KNRJXF5DFP8N7W46G4V9RCJDC22.fakfun-wallet-v2";
const USER = "SP2C7BCAP2NH3EYWCCVHJ6K0DMZBXDFKQ56KR7QN2";

const SIP018_PREFIX = Buffer.from("534950303138", "hex");

const domain = tupleCV({
  name: stringAsciiCV("smart-wallet-standard"),
  version: stringAsciiCV("1.0.0"),
  "chain-id": uintCV(1),
  wallet: principalCV(WALLET),
});
const domainBytes = Buffer.from(serializeCV(domain), "hex");
console.log("Domain consensus buff (hex):");
console.log(Buffer.from(domainBytes).toString("hex"));
console.log("Domain hash:", crypto.createHash("sha256").update(domainBytes).digest().toString("hex"));
console.log();

const msg = tupleCV({
  topic: stringAsciiCV("add-admin"),
  "auth-id": uintCV(0),
  "new-admin": principalCV(USER),
});
const msgBytes = Buffer.from(serializeCV(msg), "hex");
console.log("Message consensus buff (hex):");
console.log(Buffer.from(msgBytes).toString("hex"));
const msgHash = crypto.createHash("sha256").update(msgBytes).digest();
console.log("Message hash:", msgHash.toString("hex"));
console.log();

const domainHash = crypto.createHash("sha256").update(domainBytes).digest();
const challenge = crypto.createHash("sha256")
  .update(Buffer.concat([SIP018_PREFIX, domainHash, msgHash]))
  .digest();
console.log("Final challenge:", challenge.toString("hex"));

// Compare to on-chain step 8 (message tuple) which showed:
//  0200000052 0c 00000003 07 617574682d6964 01 00...00 09 6e65772d61646d696e 05 16 9875b156... 05 746f706963 0d 00000009 6164642d61646d696e
console.log("\nOn-chain step 8 (message tuple) for comparison:");
console.log("02000000520c0000000307617574682d69640100000000000000000000000000000000096e65772d61646d696e05169875b1561562377b8c66e3234c0da7d7d6be772905746f7069630d000000096164642d61646d696e");
