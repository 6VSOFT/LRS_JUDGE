import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
test('four-digit room, chosen seats, automatic blind deal, recovery and host controls',async()=>{
 const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'3101'},stdio:'pipe'});
 try{
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);});
  const post=async(action,data)=>{const r=await fetch('http://localhost:3101/api/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,...await r.json()};};
  const get=async(action,code,token='')=>{const r=await fetch('http://localhost:3101/api/'+action+'?code='+code,{headers:{Authorization:token}});return {status:r.status,...await r.json()};};
  for(const size of [6,9,12]){
   const host=await post('create',{size});assert.match(host.room.code,/^[1-9][0-9]{3}$/);const h={code:host.room.code,token:host.token};
   assert.equal((await post('redeal',h)).status,400);
   assert.equal((await post('join',{code:h.code,seat:size+1})).status,400);
   const races=await Promise.all([post('join',{code:h.code,seat:size}),post('join',{code:h.code,seat:size})]);
   assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
   const first=races.find(r=>r.status===200);assert.equal(first.room.self.seat,size);assert.equal(first.room.self.role,undefined);
   assert.equal((await post('join',{...h,seat:1})).status,409);
   assert.equal((await post('join',{code:h.code,token:first.token,seat:1})).status,409);
   const players=[first];for(let seat=1;seat<size;seat++)players.push(await post('join',{code:h.code,seat}));
   const last=players.at(-1);assert.equal(last.room.phase,'dealt');assert.equal(last.room.round,1);
   const roles=[];
   for(const p of players){const state=await get('state',h.code,p.token);roles.push(state.room.self.role);assert.ok(state.room.players.every(x=>!x.role&&!x.token));}
   assert.equal(roles.filter(r=>r==='狼人').length,size/3);assert.equal(roles.filter(r=>r==='村民').length,size/3);
   const judge=await get('state',h.code,h.token);assert.equal(judge.room.host,true);
   assert.equal(judge.room.players.length,size);assert.ok(judge.room.players.every(p=>p.role&&!p.token));
   for(const p of players){const own=await get('state',h.code,p.token);assert.equal(judge.room.players.find(s=>s.seat===own.room.self.seat).role,own.room.self.role);}
   const lookup=await get('lookup',h.code);assert.equal(lookup.room.self,undefined);assert.ok(lookup.room.players.every(p=>!p.role&&!p.token));
   const recovered=await post('join',{code:h.code,seat:size,token:first.token});assert.equal(recovered.room.round,1);assert.equal(recovered.room.self.role,roles[0]);
   assert.equal((await get('state',h.code,'wrong')).status,403);
   assert.equal((await post('redeal',{code:h.code,token:first.token})).status,403);
   assert.equal((await post('dissolve',{code:h.code,token:first.token})).status,403);
   assert.equal((await post('confirm',{code:h.code,token:first.token,round:1})).status,404);
   const redeal=await post('redeal',h);assert.equal(redeal.room.round,2);assert.equal(redeal.room.players.length,size);assert.ok(redeal.room.players.every(p=>!Object.hasOwn(p,'confirmed')));
   assert.equal((await post('confirm',{code:h.code,token:first.token,round:1})).status,404);
   assert.equal((await get('state',h.code,first.token)).room.round,2);
   const newSelf=await get('state',h.code,first.token);assert.equal(redeal.room.players.find(p=>p.seat===size).role,newSelf.room.self.role);
   assert.equal((await post('dissolve',h)).dissolved,true);assert.equal((await get('state',h.code,first.token)).status,404);
  }
 }finally{child.kill();}
});
