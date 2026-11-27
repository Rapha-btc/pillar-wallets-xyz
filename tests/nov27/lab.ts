import {track} from './coverage';
import {initSimnet} from '@stacks/clarinet-sdk';
import {Cl, type ClarityValue} from '@stacks/transactions';
import {expect} from 'vitest';
export {Cl};
export const u=Cl.uint;
export const pubkey=Cl.buffer(new Uint8Array(33).fill(2));
export const sig=Cl.some(Cl.tuple({'auth-id':u(1),pubkey,signature:Cl.buffer(new Uint8Array(64)),
 'authenticator-data':Cl.bufferFromHex(''),'client-data-prefix':Cl.bufferFromHex(''),'client-data-suffix':Cl.bufferFromHex('')}));
export const ok=(r:any)=>{expect(r.result.type,Cl.prettyPrint(r.result)).toBe('ok');return r.result.value;};
export async function boot(initialPubkey=pubkey){
 const sim=await initSimnet('tests/nov27/Clarinet.toml',true,{trackCoverage:true,trackCosts:false});
 track(sim);
 const admin=sim.getAccounts().get('deployer')!;
 const outsider=sim.getAccounts().get('wallet_1')!;
 const cp=(n:string)=>`${admin}.${n}`;
 const call=(n:string,f:string,a:ClarityValue[]=[],sender=admin)=>sim.callPublicFn(cp(n),f,a,sender);
 const read=(n:string,f:string,a:ClarityValue[]=[])=>sim.callReadOnlyFn(cp(n),f,a,admin).result;
 for(const wallet of ['juice-savings','juice-trading']) ok(call(wallet,'onboard',[initialPubkey,Cl.principal(admin),Cl.none(),u(100000000),u(100000),u(144)],'SP28MP1HQDJWQAFSQJN2HBAXBVP7H7THD1W2NYZVK'));
 const stake=(signer:string,first=10,cycles=10)=>ok(call('pox-5','set-info',[Cl.some(Cl.tuple({signer:Cl.principal(signer),'first-reward-cycle':u(first),'num-cycles':u(cycles)}))]));
 return {sim,admin,outsider,cp,call,read,stake};
}
