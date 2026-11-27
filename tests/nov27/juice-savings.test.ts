import {it,expect} from 'vitest';
import {boot,Cl,u,ok} from './lab';

it('restake takes no arguments and reuses JUICE-SIGNER on both sides of stake-update',async()=>{
 // Arrange
 const {sim,cp,call,read,stake,admin}=await boot();
 ok(call('juice-savings','set-keeper',[Cl.principal(admin),Cl.none(),Cl.none()]));
 stake(cp('juice-pool-sbtc-signer'));
 ok(sim.transferSTX(1234n,cp('juice-savings'),admin));
 // Act
 const result=call('juice-savings','restake');
 // Assert
 expect(result.result).toEqual(Cl.ok(Cl.tuple({amount:u(1234),'cycles-to-extend':u(87)})));
 expect(read('pox-5','get-last-update')).toEqual(Cl.some(Cl.tuple({signer:Cl.principal(cp('juice-pool-sbtc-signer')),old:Cl.principal(cp('juice-pool-sbtc-signer')),cycles:u(87),amount:u(1234),calldata:Cl.none()})));
 expect(()=>call('juice-savings','restake',[Cl.principal(cp('juice-pool-sbtc-signer'))])).toThrow();
});
it.each(['juice-pool-stx-signer','fastpool-max500-signer-manager'])('restake refuses %s with err-invalid-pool',async(pool)=>{
 // Arrange
 const {cp,call,read,stake,admin}=await boot();
 ok(call('juice-savings','set-keeper',[Cl.principal(admin),Cl.none(),Cl.none()]));
 stake(cp(pool));
 // Act
 const result=call('juice-savings','restake');
 // Assert
 expect(result.result).toEqual(Cl.error(u(4023)));
 expect(read('pox-5','get-last-update')).toEqual(Cl.none());
});
it('restake refuses a non-keeper even in JUICE-SIGNER',async()=>{
 // Arrange
 const {cp,call,read,stake,admin,outsider}=await boot();
 ok(call('juice-savings','set-keeper',[Cl.principal(admin),Cl.none(),Cl.none()]));
 stake(cp('juice-pool-sbtc-signer'));
 // Act
 const result=call('juice-savings','restake',[],outsider);
 // Assert
 expect(result.result).toEqual(Cl.error(u(4001)));
 expect(read('pox-5','get-last-update')).toEqual(Cl.none());
});
it('restake requires existing stake',async()=>{
 // Arrange
 const {call,admin}=await boot();
 ok(call('juice-savings','set-keeper',[Cl.principal(admin),Cl.none(),Cl.none()]));
 // Act
 const result=call('juice-savings','restake');
 // Assert
 expect(result.result).toEqual(Cl.error(u(4022)));
});
it('restake rejects stake expiring next cycle',async()=>{
 // Arrange
 const {cp,call,stake,admin}=await boot();
 ok(call('juice-savings','set-keeper',[Cl.principal(admin),Cl.none(),Cl.none()]));
 stake(cp('juice-pool-sbtc-signer'),10,1);
 // Act
 const result=call('juice-savings','restake');
 // Assert
 expect(result.result).toEqual(Cl.error(u(4022)));
});
it('restake rejects no unlocked STX and no cycles to extend',async()=>{
 // Arrange
 const {cp,call,stake,admin}=await boot();
 ok(call('juice-savings','set-keeper',[Cl.principal(admin),Cl.none(),Cl.none()]));
 stake(cp('juice-pool-sbtc-signer'),10,97);
 // Act
 const result=call('juice-savings','restake');
 // Assert
 expect(result.result).toEqual(Cl.error(u(4020)));
});
