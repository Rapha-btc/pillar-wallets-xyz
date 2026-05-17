import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha256";
import crypto from "node:crypto";

const hex = (h) => Buffer.from(h.startsWith("0x") ? h.slice(2) : h, "hex");
const toB64Url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const pubkey = hex("025e3d05b145ce68cd287acb6f35e79dfcc875b834046a16057dbc774e0bf3eacf");

function tryOp(name, challengeHex, signatureHex) {
  const challenge = hex(challengeHex);
  const signature = hex(signatureHex);
  const authData = hex("b877fea5df49f6d2fe544db0c7ced754f117ade85f60266bc217db3b239f22490500000000");
  const prefix = hex("7b2274797065223a22776562617574686e2e676574222c226368616c6c656e6765223a22");
  const suffix = hex("222c226f726967696e223a2268747470733a2f2f66616b2e66756e222c2263726f73734f726967696e223a66616c73657d");

  const challengeB64Url = toB64Url(challenge);
  const clientDataJSON = Buffer.concat([prefix, Buffer.from(challengeB64Url, "ascii"), suffix]);
  const clientDataHash = sha256(clientDataJSON);
  const digest = sha256(Buffer.concat([authData, Buffer.from(clientDataHash)]));

  const nobleLowS = p256.verify(signature, digest, pubkey, { format: "compact", prehash: false });
  const nobleHighS = p256.verify(signature, digest, pubkey, { format: "compact", prehash: false, lowS: false });
  const noble = `lowS=${nobleLowS} anyS=${nobleHighS}`;
  const sBig = BigInt("0x" + Buffer.from(signature.subarray(32, 64)).toString("hex"));
  const n = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
  const sBucket = sBig <= n / 2n ? "low-s" : "HIGH-S";

  // Use uncompressed pubkey for node's crypto.verify (it needs the explicit point)
  const point = p256.Point.fromBytes(pubkey).toBytes(false); // 65-byte uncompressed
  const uncompressedHex = Buffer.from(point).toString("hex");

  // Build DER signature from r||s for node
  const r = signature.subarray(0, 32);
  const s = signature.subarray(32, 64);
  const encInt = (b) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let trim = b.subarray(i);
    if (trim[0] & 0x80) trim = Buffer.concat([Buffer.from([0]), trim]);
    return Buffer.concat([Buffer.from([0x02, trim.length]), trim]);
  };
  const rDer = encInt(r);
  const sDer = encInt(s);
  const seq = Buffer.concat([rDer, sDer]);
  const sigDer = Buffer.concat([Buffer.from([0x30, seq.length]), seq]);

  // node crypto needs SPKI for createPublicKey
  // P-256 SPKI prefix
  const SPKI_HEADER = Buffer.from(
    "3059301306072a8648ce3d020106082a8648ce3d03010703420004",
    "hex"
  );
  const spki = Buffer.concat([SPKI_HEADER, Buffer.from(point.slice(1))]);
  const keyObj = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
  const nodeVerify = crypto.verify("SHA256", Buffer.from(digest), keyObj, sigDer);

  console.log(`${name}: ${sBucket} noble=${noble} node=${nodeVerify}`);
}

tryOp("auth-id 0 add-admin",
  "0x169c3ad1ed99f5fce1dbc568e325168be4a507e72f706124cb370c24844c71d8",
  "0x54ce1f20c3fb605eccb416db7ad176a442425803e1a427c5144908cfdbd9356e6ff944128bee5b41fb992d6be28cff4820a7fd32c0848eca6b4a0525f89d9ad0",
);
tryOp("auth-id 1 toggle-lock",
  "0x4e03fd50d8c1ad9bfe64f1efc001b72ec7c933f482f713cc5736f616f838e481",
  "0x2e064d60d035ff564f51ca7742cc99279ebeaf05bf02a393d93abf6d9bf4b15cccb8617e45521be96ddc64554f384fd82ff1361a12a29a01c01d33e84685b433",
);
tryOp("auth-id 2 sip010-tx",
  "0x675cee431f161842249b9ddb12be56c75ccfa6389cdd4f3c44b7245306956749",
  "0xad0f5eb1d5f4fd047bc26d43ae38580257c18e43cd39a3ad967e3a767d2b4f8c152256c17427cd631e71f8db32a403ccd43649f46e617b59ef189a0aa2283d17",
);
