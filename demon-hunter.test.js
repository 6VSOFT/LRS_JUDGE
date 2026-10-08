import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, roleNames, wolfRoles } from './lib/rooms.js';
import { MemoryStore } from './lib/memory-store.js';

async function fixture() {
  const store = new MemoryStore();
  const api = async (action, body = {}) => {
    const read = ['state', 'lookup'].includes(action);
    const response = await handleRequest(new Request(`http://test/api/${action}${read ? '?code=' + body.code : ''}`, {
      method: read ? 'GET' : 'POST', headers: { Authorization: body.token || '' },
      ...(read ? {} : { body: JSON.stringify(body) }),
    }), store);
    return { status: response.status, ...await response.json() };
  };
  const host = await api('create', { size: 6 }), code = host.room.code, players = [];
  for (let seat = 1; seat <= 6; seat++) players.push(await api('join', { code, seat, name: `測試 ${seat}` }));
  const edit = async fn => { const current = await store.read(code); fn(current.data); await store.write(code, current.data, current.etag); };
  await edit(r => { ['獵魔人','狼人','女巫','魔術師','村民','守衛'].forEach((role,i)=>r.players[i].role=role); });
  const state = token => api('state', { code, token: token || host.token });
  return { api, host, code, players, edit, state };
}


async function act(f,action,seat=null,extra={}) {
 const {room}=await f.state();return f.api(action,{code:f.code,token:seat?f.players[seat-1].token:f.host.token,round:room.round,revision:room.game.revision,step:room.game.step,nightId:room.game.nightId,...extra});
}


const hunt=(f,target,extra={})=>act(f,'hunt',1,{target,...extra});
const view=async f=>(await f.state(f.players[0].token)).room.game;
test('hunt starts second night, once/night, private, recoverable, validated and resets on redeal',async()=>{
 const f=await fixture();assert.equal((await hunt(f,2)).status,409);assert.equal((await view(f)).demonHunter.canHunt,false);
 await f.edit(r=>r.game.step=3);
 for(const target of [1,99,null,'2'])assert.equal((await hunt(f,target)).status,400);
 for(const extra of [{round:0},{revision:-1},{step:0},{nightId:'old'}])assert.equal((await hunt(f,2,extra)).status,409);
 assert.equal((await act(f,'hunt',2,{target:3})).status,403);assert.equal((await act(f,'hunt',null,{target:3})).status,403);
 const race=await Promise.all([hunt(f,2),hunt(f,3)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 assert.equal((await view(f)).demonHunter.canHunt,false);assert.equal((await hunt(f,2)).status,409);
 const results=(await view(f)).demonHunter.results;assert.equal(results.length,1);assert.deepEqual(Object.keys(results[0]).sort(),['step','target']);
 for(const res of [await f.api('lookup',{code:f.code}),await f.state(),await f.state(f.players[1].token)]){assert.equal(res.room.game.demonHunter,undefined);assert.equal(res.room.game.hunts,undefined);}
 assert.deepEqual((await view(f)).demonHunter.results,results);
 await f.edit(r=>r.game.step=5);assert.equal((await hunt(f,2)).status,200);await f.edit(r=>r.game.step=3);assert.equal((await hunt(f,2)).status,409);
 await f.edit(r=>r.players[0].alive=false);assert.equal((await hunt(f,2)).status,403);
 await act(f,'redeal');await f.edit(r=>r.players[0].role='獵魔人');assert.deepEqual((await view(f)).demonHunter.results,[]);
 await f.edit(r=>r.game.step=2);assert.equal((await hunt(f,2)).status,409);
 await f.edit(r=>{r.game.step=13;r.game.nights[13]={settled:true}});assert.equal((await hunt(f,2)).status,409);
});
test('all role camps resolve simultaneously: wolves die, good targets kill hunter; only host sees preview',async()=>{
 for(const role of roleNames){
  const f=await fixture();await f.edit(r=>{r.game.step=3;r.players[1].role=role;if(role==='夢魘')r.game.fears={2:{3:{target:5}}};if(role==='攝夢人')r.game.dreams={2:{3:{target:5,resolvedTarget:5}}};});
  assert.equal((await hunt(f,2)).status,200,role);assert.ok((await f.state()).room.players.every(p=>p.alive));
  const preview=(await f.state()).room.game.night.outcome;assert.deepEqual(preview,[{seat:wolfRoles.has(role)?2:1,cause:wolfRoles.has(role)?'hunt':'hunt-backfire'}]);
  assert.equal((await act(f,'settle-night')).status,200);const r=(await f.state()).room;
  assert.equal(r.players[0].alive,wolfRoles.has(role),role);assert.equal(r.players[1].alive,!wolfRoles.has(role),role);
  if(role==='狼王')assert.equal((await f.state(f.players[1].token)).room.game.hunter.canShoot,false);
 }
});
test('witch poison immunity is passive even first night and under fear, but not knife or mechanical poison',async()=>{
 for(const kind of ['poison','fear-poison','knife','mechanical']){
  const f=await fixture();await f.edit(r=>{if(kind==='fear-poison'){r.players[4].role='夢魘';r.game.fears={5:{0:{target:1}}};}if(kind==='mechanical')r.game.mechanical={5:{poison:{step:0,target:1}}};});
  if(kind!=='mechanical')assert.equal((await act(f,'potion',3,{kind:'poison',target:1})).status,200);
  if(kind==='knife')assert.equal((await act(f,'select-night',2,{seat:1})).status,200);
  assert.equal((await act(f,'settle-night')).status,200);assert.equal((await f.state()).room.players[0].alive,['poison','fear-poison'].includes(kind),kind);
 }
});
test('fear locks active hunts; magician maps hunt and poison to actual identities and cannot swap late',async()=>{
 const f=await fixture();await f.edit(r=>{r.game.step=3;r.players[4].role='夢魘'});
 assert.equal((await hunt(f,2)).status,409);await act(f,'fear',5,{target:1});assert.equal((await hunt(f,2)).status,403);assert.equal((await view(f)).demonHunter.canHunt,false);
 await f.edit(r=>r.game.step=5);await act(f,'fear',5,{target:3});await act(f,'swap',4,{targets:[2,6]});
 assert.equal((await hunt(f,6)).status,200);assert.equal((await act(f,'swap',4,{targets:[1,5]})).status,409);await act(f,'settle-night');assert.equal((await f.state()).room.players[1].alive,false);
 const poison=await fixture();await act(poison,'swap',4,{targets:[1,2]});await act(poison,'potion',3,{kind:'poison',target:2});await act(poison,'settle-night');assert.equal((await poison.state()).room.players[0].alive,true);
});
test('hunt damage obeys dream/mechanical immunity, ignores ordinary guard, and good-target backfire is unavoidable',async()=>{
 for(const shield of ['dream','mechanical','normal','backfire']){
  const f=await fixture();await f.edit(r=>{r.game.step=13;if(shield==='dream'){r.players[4].role='攝夢人';r.game.dreams={5:{13:{target:2,resolvedTarget:2}}};}if(shield==='mechanical')r.game.mechanical={5:{guards:{13:{target:2}}}};if(shield==='normal')r.game.guards={6:{13:{target:2}}};if(shield==='backfire'){r.game.mechanical={5:{guards:{13:{target:1}}}};r.players[4].role='攝夢人';r.game.dreams={5:{13:{target:1,resolvedTarget:1}}};}});
  await hunt(f,shield==='backfire'?3:2);await act(f,'settle-night');const r=(await f.state()).room;
  assert.equal(r.players[1].alive,shield!=='normal');assert.equal(r.players[0].alive,shield!=='backfire');
 }
});
