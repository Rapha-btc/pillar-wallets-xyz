import {it,expect} from 'vitest';
import fc from 'fast-check';
import crypto from 'node:crypto';
import {getContractFunction,strategyFor} from '@stacks/rendezvous';
import {boot,Cl,u} from './lab';
const topics=['stake-stx-juice-pool','update-stake-stx-juice-pool','jing-swap','place-ladder','withdraw-ladder','claim-ladder'];
const cases=topics.flatMap(topic=>[20261126,20261127].map(seed=>({topic,seed})));
const numRuns=Number(process.env.RV_RUNS??500);
const sha=(bytes:Uint8Array)=>crypto.createHash('sha256').update(bytes).digest();
const hash=(cv:any)=>sha(Buffer.from(Cl.serialize(cv),'hex'));
it.each(cases)('RV auth helper $topic seed $seed matches SIP-018 and binds the caller',async({topic,seed})=>{
 // Arrange
 const {sim,cp,admin,outsider}=await boot();
 const name='juice-safe-auth-helpers-v3',fn=`build-${topic}-hash`;
 const arb=strategyFor(sim,getContractFunction(sim,name,fn));
 const domain=(who:string)=>hash(Cl.tuple({name:Cl.stringAscii('smart-wallet-standard'),version:Cl.stringAscii('1.0.0'),'chain-id':u(2147483648),wallet:Cl.principal(who)}));
 // Act + Assert
 fc.assert(fc.property(arb,([details])=>{
  const struct=hash(Cl.tuple({topic:Cl.stringAscii(topic),...(details as any).value}));
  for(const caller of [admin,outsider]){
   const expected=sha(Buffer.concat([Buffer.from('534950303138','hex'),domain(caller),struct]));
   const actual=sim.callReadOnlyFn(cp(name),fn,[details],caller).result;
   expect(actual).toEqual(Cl.buffer(expected));
  }
 }),{seed,numRuns});
});
