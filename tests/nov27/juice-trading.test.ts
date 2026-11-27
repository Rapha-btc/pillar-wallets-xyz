import {it,expect} from 'vitest';
import {boot,Cl,u,ok,pubkey,sig} from './lab';

const branches=['faktory-execute','faktory-place-order','faktory-process','faktory-nft-execute','wager-deposit','smart-buy-stx'];
it.each(branches)('%s passkey branch refuses token-lock before signature verification',async(fn)=>{
 // Arrange
 const {sim,call,read,cp}=await boot();
 const p=(n:string)=>Cl.principal(cp(n)),name=Cl.stringAscii('mock-token');
 const args:any={
  'faktory-execute':[p('mock-pool'),u(10),Cl.none(),p('mock-token'),name,sig,Cl.none()],
  'faktory-place-order':[p('mock-dex'),p('mock-token'),name,u(10),Cl.none(),sig,Cl.none()],
  'faktory-process':[p('mock-pre'),u(10),Cl.none(),sig,Cl.none()],
  'faktory-nft-execute':[p('mock-nftmarket'),u(1),p('mock-nft'),Cl.stringAscii('mock-nft'),p('mock-token'),name,u(10),Cl.none(),sig,Cl.none()],
  'wager-deposit':[p('mock-token'),name,u(10),pubkey,sig,Cl.none()],
  'smart-buy-stx':[p('mock-smart'),u(10),u(1),u(5000),Cl.bool(false),sig,Cl.none()],
 };
 // Control: with token-lock off the same arguments reach the real verifier.
 expect(call('juice-trading',fn,args[fn]).result).toEqual(Cl.error(u(4002)));
 ok(call('juice-trading','toggle-token-lock',[Cl.bool(true),Cl.none(),Cl.none()]));
 const activity=sim.getDataVar(cp('juice-trading'),'last-activity-block');
 // Act
 const result=call('juice-trading',fn,args[fn]);
 // Assert
 expect(result.result).toEqual(Cl.error(u(4019)));
 expect(read('juice-trading','get-token-lock-enabled')).toEqual(Cl.bool(true));
 expect(sim.getDataVar(cp('juice-trading'),'last-activity-block')).toEqual(activity);
 expect(result.events).toEqual([]);
});
it.each(['sbtc-usdcx','usdcx-sbtc'])('jing-swap %s forwards every argument including Zest to router v6',async(action)=>{
 // Arrange
 const {call,read,cp}=await boot();
 const amounts=Cl.tuple({zest:u(11),dlmm:u(22),xyk:u(33),velar:u(44)});
 const mins=Cl.tuple({zest:u(101),dlmm:u(102),xyk:u(103),velar:u(104)});
 const route=Cl.tuple({ticks:Cl.list([Cl.int(-2),Cl.int(3)]),price:u(123456)});
 const update=Cl.some(Cl.bufferFromHex('1234')),fallback=Cl.some(u(1));
 // Act
 const result=call('juice-trading','jing-swap',[Cl.stringAscii(action),u(150),u(40),u(10000000000),update,fallback,amounts,mins,u(99),route,Cl.none(),Cl.none()]);
 // Assert
 expect(result.result).toEqual(Cl.ok(Cl.bool(true)));
 expect(read('swap-router-sbtc-usdcx-jing-v6','get-last')).toEqual(Cl.some(Cl.tuple({direction:Cl.bool(action==='sbtc-usdcx'),caller:Cl.principal(cp('juice-trading')),
  amount:u(150),jing:u(40),limit:u(10000000000),update,fallback,amounts,mins,'min-out':u(99),route})));
});
it('deploys juice-trading with the rung-entry let binding and real auth-helpers-v3',async()=>{
 // Arrange
 const {sim,cp,admin}=await boot();
 // Act
 const interfaces=sim.getContractsInterfaces();
 const hash=sim.callReadOnlyFn(cp('juice-safe-auth-helpers-v3'),'build-jing-swap-hash',[Cl.tuple({'auth-id':u(1),action:Cl.stringAscii('sbtc-usdcx'),amount:u(1),'limit-price':u(1),'min-out':u(1)})],admin);
 // Assert
 expect(interfaces.has(cp('juice-trading'))).toBe(true);
 expect(interfaces.has(cp('juice-savings'))).toBe(true);
 expect(hash.result.type).toBe('buffer');
});
