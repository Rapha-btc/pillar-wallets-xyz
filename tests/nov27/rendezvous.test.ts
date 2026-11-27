import {it,expect} from 'vitest';
import fc from 'fast-check';
import {getContractFunction,strategyFor} from '@stacks/rendezvous';
import {boot,Cl,u,ok,sig} from './lab';
const seeds=[20261126,20261127],numRuns=Number(process.env.RV_RUNS??500);
it.each(seeds)('RV restake signer/expiry/keeper matrix seed %i',async(seed)=>{
 // Arrange
 const {sim,call,read,cp,admin,outsider}=await boot();
 ok(call('juice-savings','set-keeper',[Cl.principal(admin),Cl.none(),Cl.none()]));
 const signers=[cp('juice-pool-sbtc-signer'),cp('juice-pool-stx-signer'),cp('fastpool-max500-signer-manager')];
 const arb=strategyFor(sim,getContractFunction(sim,'pox-5','set-info'),signers);
 // Act + Assert
 fc.assert(fc.property(arb,fc.boolean(),([raw],keeper)=>{
  let expected=4022,extension=0;
  if(raw.type==='some'){
   const value=(raw as any).value.value,first=value['first-reward-cycle'].value%20n,cycles=value['num-cycles'].value%100n;
   const signer=value.signer.value;
   const unlock=first+cycles;extension=Number(unlock<107n?107n-unlock:0n);
   raw=Cl.some(Cl.tuple({signer:Cl.principal(signer),'first-reward-cycle':u(first),'num-cycles':u(cycles)}));
   expected=!keeper?4001:signer!==signers[0]?4023:unlock<=11n?4022:extension===0?4020:0;
  }
  ok(call('pox-5','set-info',[raw]));
  const before=read('pox-5','get-last-update');
  const result=call('juice-savings','restake',[],keeper?admin:outsider);
  if(expected){expect(result.result).toEqual(Cl.error(u(expected)));expect(read('pox-5','get-last-update')).toEqual(before);}
  else {expect(result.result).toEqual(Cl.ok(Cl.tuple({amount:u(0),'cycles-to-extend':u(extension)})));}
 }),{seed,numRuns});
});
it.each(seeds)('RV arbitrary Jing passkey requests stay locked seed %i',async(seed)=>{
 // Arrange
 const {sim,call,cp}=await boot();
 ok(call('juice-trading','toggle-token-lock',[Cl.bool(true),Cl.none(),Cl.none()]));
 const arb=strategyFor(sim,getContractFunction(sim,'juice-safe-auth-helpers-v3','build-jing-swap-hash'));
 const legs=Cl.tuple({zest:u(0),dlmm:u(0),xyk:u(0),velar:u(0)});
 // Act + Assert
 fc.assert(fc.property(arb,([raw])=>{
  const value=(raw as any).value;
  const result=call('juice-trading','jing-swap',[value.action,value.amount,u(0),value['limit-price'],Cl.none(),Cl.none(),legs,legs,value['min-out'],Cl.tuple({ticks:Cl.list([]),price:u(0)}),sig,Cl.none()]);
  expect(result.result).toEqual(Cl.error(u(4019)));
  expect(result.events).toEqual([]);
 }),{seed,numRuns});
});
