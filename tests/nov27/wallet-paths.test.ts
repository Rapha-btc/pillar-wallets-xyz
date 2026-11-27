import {it,expect} from 'vitest';
import {boot,Cl,u,ok} from './lab';
import {signedPubkey,sign} from './passkey';
it.each(['sbtc-stx','stx-sbtc','stx-usdcx','usdcx-stx','sbtc-usdcx','usdcx-sbtc'])('signed jing-swap %s succeeds once and rejects replay',async(action)=>{
 // Arrange
 const {call,cp}=await boot(signedPubkey);
 const amounts=Cl.tuple({zest:u(10),dlmm:u(0),xyk:u(0),velar:u(0)});
 const auth=sign(cp('juice-trading'),'jing-swap',{action:Cl.stringAscii(action),amount:u(10),'limit-price':u(10000000000),'min-out':u(1)});
 const args=[Cl.stringAscii(action),u(10),u(0),u(10000000000),Cl.none(),Cl.none(),amounts,amounts,u(1),Cl.tuple({ticks:Cl.list([]),price:u(0)}),Cl.some(auth),Cl.none()];
 // Act
 const first=call('juice-trading','jing-swap',args);
 const replay=call('juice-trading','jing-swap',args);
 // Assert
 ok(first);expect(replay.result).toEqual(Cl.error(u(4006)));
});
it('signed keeper selection changes who can restake',async()=>{
 // Arrange
 const {call,read,cp,stake,outsider}=await boot(signedPubkey);
 const auth=sign(cp('juice-savings'),'set-keeper',{keeper:Cl.principal(outsider)});
 stake(cp('juice-pool-sbtc-signer'));
 // Act
 const set=call('juice-savings','set-keeper',[Cl.principal(outsider),Cl.some(auth),Cl.none()]);
 const old=call('juice-savings','restake');
 const next=call('juice-savings','restake',[],outsider);
 // Assert
 ok(set);expect(read('juice-savings','get-keeper')).toEqual(Cl.principal(outsider));
 expect(old.result).toEqual(Cl.error(u(4001)));ok(next);
});
it.each(['juice-savings','juice-trading'])('%s transfer ownership rotates admin and rejects the old admin',async(wallet)=>{
 // Arrange
 const {call,read,cp,outsider}=await boot(signedPubkey);
 const auth=sign(cp(wallet),'confirm-transfer',{'new-admin':Cl.principal(outsider)});
 // Act
 const propose=call(wallet,'propose-transfer-wallet',[Cl.principal(outsider)]);
 const confirm=call(wallet,'confirm-transfer-wallet',[auth,Cl.none()]);
 // Assert
 ok(propose);ok(confirm);expect(read(wallet,'get-owner')).toEqual(Cl.ok(Cl.principal(outsider)));
 expect(call(wallet,'toggle-token-lock',[Cl.bool(true),Cl.none(),Cl.none()]).result).toEqual(Cl.error(u(4001)));
 ok(call(wallet,'toggle-token-lock',[Cl.bool(true),Cl.none(),Cl.none()],outsider));
});
it.each(['juice-pool-sbtc-signer','juice-pool-stx-signer','fastpool-max500-signer-manager'])('admin can stake, extend and unstake through %s',async(pool)=>{
 // Arrange
 const {call,cp}=await boot();
 const p=Cl.principal(cp(pool));
 // Act
 const stake=call('juice-savings','stake-stx-juice',[p,u(1000),Cl.none(),Cl.none(),Cl.none()]);
 const update=call('juice-savings','update-stake-stx-juice',[p,p,u(100),u(1),Cl.none(),Cl.none(),Cl.none()]);
 const unstake=call('juice-savings','unstake',[p,Cl.none(),Cl.none()]);
 // Assert
 ok(stake);ok(update);ok(unstake);
});
it.each(['juice-savings','juice-trading'])('%s sends native STX for the owner and denies an outsider',async(wallet)=>{
 // Arrange
 const {call,sim,cp,admin,outsider}=await boot();
 ok(sim.transferSTX(1000n,cp(wallet),admin));
 const args=[u(100),Cl.principal(outsider),Cl.none(),Cl.none(),Cl.none()];
 const before=sim.getAssetsMap().get('STX')!.get(outsider)!;
 // Act
 const denied=call(wallet,'stx-transfer',args,outsider);
 const sent=call(wallet,'stx-transfer',args);
 // Assert
 expect(denied.result).toEqual(Cl.error(u(4001)));ok(sent);
 expect(sim.getAssetsMap().get('STX')!.get(outsider)!-before).toBe(100n);
});
it.each(['faktory-execute','faktory-place-order','faktory-process','faktory-nft-execute','wager-deposit','smart-buy-stx'])('%s accepts a valid passkey while unlocked, then token lock blocks it',async(fn)=>{
 // Arrange
 const {call,cp}=await boot(signedPubkey);
 const p=(name:string)=>Cl.principal(cp(name)),name=Cl.stringAscii('mock-token');
 ok(call('game-wager-v2-4','set-wallet',[signedPubkey,p('juice-trading')]));
 const details:any={
  'faktory-execute':{pool:p('mock-pool'),amount:u(10),opcode:Cl.none()},
  'faktory-place-order':{dex:p('mock-dex'),amount:u(10),opcode:Cl.none()},
  'faktory-process':{pre:p('mock-pre'),'seat-count':u(10),opcode:Cl.none()},
  'faktory-nft-execute':{marketplace:p('mock-nftmarket'),'token-id':u(1),'ft-contract':p('mock-token'),price:u(10),opcode:Cl.none()},
  'wager-deposit':{token:p('mock-token'),amount:u(10),pubkey:signedPubkey},
  'smart-buy-stx':{op:Cl.bufferFromHex('01'),smart:p('mock-smart'),amount:u(10),'min-out':u(1),'fak-ratio':u(5000),flag:Cl.bool(false)},
 };
 const auth=Cl.some(sign(cp('juice-trading'),fn==='smart-buy-stx'?'smart-execute':fn,details[fn]));
 const args:any={
  'faktory-execute':[p('mock-pool'),u(10),Cl.none(),p('mock-token'),name,auth,Cl.none()],
  'faktory-place-order':[p('mock-dex'),p('mock-token'),name,u(10),Cl.none(),auth,Cl.none()],
  'faktory-process':[p('mock-pre'),u(10),Cl.none(),auth,Cl.none()],
  'faktory-nft-execute':[p('mock-nftmarket'),u(1),p('mock-nft'),Cl.stringAscii('mock-nft'),p('mock-token'),name,u(10),Cl.none(),auth,Cl.none()],
  'wager-deposit':[p('mock-token'),name,u(10),signedPubkey,auth,Cl.none()],
  'smart-buy-stx':[p('mock-smart'),u(10),u(1),u(5000),Cl.bool(false),auth,Cl.none()],
 };
 // Act
 const accepted=call('juice-trading',fn,args[fn]);
 ok(call('juice-trading','toggle-token-lock',[Cl.bool(true),Cl.none(),Cl.none()]));
 const locked=call('juice-trading',fn,args[fn]);
 // Assert
 ok(accepted);expect(locked.result).toEqual(Cl.error(u(4019)));
});
