import crypto from 'node:crypto';
import {Cl, type ClarityValue} from '@stacks/transactions';
const secret=Buffer.alloc(32);secret[31]=1;
const ecdh=crypto.createECDH('prime256v1');ecdh.setPrivateKey(secret);
const raw=ecdh.getPublicKey(undefined,'uncompressed');
const key=crypto.createPrivateKey({key:{kty:'EC',crv:'P-256',d:secret.toString('base64url'),x:raw.subarray(1,33).toString('base64url'),y:raw.subarray(33).toString('base64url')},format:'jwk'});
export const signedPubkey=Cl.buffer(ecdh.getPublicKey(undefined,'compressed'));
const sha=(bytes:Uint8Array)=>crypto.createHash('sha256').update(bytes).digest();
const hashCV=(cv:ClarityValue)=>sha(Buffer.from(Cl.serialize(cv),'hex'));
export function sign(wallet:string,topic:string,details:Record<string,ClarityValue>,id=1){
 const domain=hashCV(Cl.tuple({name:Cl.stringAscii('smart-wallet-standard'),version:Cl.stringAscii('1.0.0'),'chain-id':Cl.uint(2147483648),wallet:Cl.principal(wallet)}));
 const challenge=sha(Buffer.concat([Buffer.from('534950303138','hex'),domain,hashCV(Cl.tuple({topic:Cl.stringAscii(topic),'auth-id':Cl.uint(id),...details}))]));
 const authenticator=Buffer.concat([sha(Buffer.from('juiceofbtc.com')),Buffer.from([5,0,0,0,1])]);
 const prefix=Buffer.from('{"type":"webauthn.get","challenge":"');
 const suffix=Buffer.from('","origin":"https://juiceofbtc.com","crossOrigin":false}');
 const client=Buffer.concat([prefix,Buffer.from(challenge.toString('base64url')),suffix]);
 const signature=crypto.sign('sha256',Buffer.concat([authenticator,sha(client)]),{key,dsaEncoding:'ieee-p1363'});
 const order=BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
 const scalar=BigInt('0x'+signature.subarray(32).toString('hex'));
 if(scalar>order/2n)Buffer.from((order-scalar).toString(16).padStart(64,'0'),'hex').copy(signature,32);
 return Cl.tuple({'auth-id':Cl.uint(id),pubkey:signedPubkey,signature:Cl.buffer(signature),'authenticator-data':Cl.buffer(authenticator),'client-data-prefix':Cl.buffer(prefix),'client-data-suffix':Cl.buffer(suffix)});
}
