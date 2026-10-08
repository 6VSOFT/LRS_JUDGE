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
  await edit(r => { ['攝夢人','女巫','狼人','獵人','守衛','魔術師'].forEach((role,i)=>r.players[i].role=role); });
  const state = token => api('state', { code, token: token || host.token });
  const potion = async (kind, target, extra = {}) => { const { room } = await state(); return api('potion', { code, token: players[0].token, round: room.round, revision: room.game.revision, step: room.game.step, kind, target, ...extra }); };
  const act = async (action, extra = {}) => { const { room } = await state(); return api(action, { code, token: host.token, round: room.round, revision: room.game.revision, ...extra }); };
  const guard = async (target, extra = {}) => { const { room } = await state(); return api('guard', { code, token: players[0].token, round: room.round, revision: room.game.revision, step: room.game.step, nightId: room.game.nightId, target, ...extra }); };
  return { api, host, code, players, edit, state, potion, act, guard };
}


async function skill(f, action, seat, extra={}) {
  const {room}=await f.state();
  return f.api(action,{code:f.code,token:f.players[seat-1].token,round:room.round,revision:room.game.revision,step:room.game.step,nightId:room.game.nightId,...extra});
}
const dream=(f,target,extra={})=>skill(f,'dream',1,{target,...extra});


test('dream is mandatory, once per night, private, validated and persisted',async()=>{
 const f=await fixture();assert.equal((await f.act('settle-night')).status,409);assert.equal((await f.act('stage',{direction:1})).status,409);
 assert.deepEqual((await f.state()).room.game.night.missingDreams,[1]);
 assert.equal((await skill(f,'dream',2,{target:3})).status,403);
 for(const target of [1,0,7,null,'2'])assert.equal((await dream(f,target)).status,400);
 assert.equal((await dream(f,2,{revision:-1})).status,409);assert.equal((await dream(f,2,{nightId:'old'})).status,409);
 await f.act('status',{seat:3,alive:false});assert.equal((await dream(f,3)).status,400);
 assert.equal((await dream(f,2)).status,200);assert.equal((await dream(f,3)).status,409);
 const own=(await f.state(f.players[0].token)).room.game.dreamer;assert.equal(own.target,2);assert.equal(own.canDream,false);
 for(const token of [f.host.token,f.players[1].token])assert.equal((await f.state(token)).room.game.dreamer,undefined);
 const pub=(await f.api('lookup',{code:f.code})).room.game;assert.equal(pub.dreamer,undefined);assert.equal(pub.night,undefined);
 await f.act('settle-night');assert.equal((await dream(f,2)).status,409);
 await f.edit(r=>{r.game.step=2});assert.equal((await dream(f,2)).status,409);
 await f.edit(r=>{r.game.step=0});assert.equal((await f.state(f.players[0].token)).room.game.dreamer.target,2);
 await f.act('redeal');await f.edit(r=>r.players[0].role='攝夢人');assert.deepEqual((await f.state(f.players[0].token)).room.game.dreamer.results,[]);
});

test('dreamwalker survives knife, poison, both, and milk; poison notification is not created',async()=>{
 for(const variant of ['knife','poison','both','milk']){
  const f=await fixture();await dream(f,4);
  if(variant!=='poison')await f.act('night',{seat:4});
  if(['poison','both'].includes(variant))await skill(f,'potion',2,{kind:'poison',target:4});
  if(variant==='milk'){await skill(f,'guard',5,{target:4});await skill(f,'potion',2,{kind:'heal',target:4});}
  assert.deepEqual((await f.state()).room.game.night.outcome,[]);await f.act('settle-night');
  const p=(await f.state(f.players[3].token)).room;assert.equal(p.self.alive,true);assert.equal(p.game.hunterPoisoned,undefined);
 }
});

test('consecutive nights kill hunter/wolf king specially, skip breaks streak, special death beats protection',async()=>{
 for(const role of ['獵人','狼王']){
  const f=await fixture();await f.edit(r=>r.players[3].role=role);await dream(f,4);await f.act('settle-night');
  await f.edit(r=>{r.game.step=3;r.game.nightId='n2'});assert.deepEqual((await f.state(f.players[0].token)).room.game.dreamer.lethalTargets,[4]);
  await dream(f,4);await f.act('night',{seat:4});await skill(f,'potion',2,{kind:'heal',target:4});await skill(f,'guard',5,{target:4});
  assert.deepEqual((await f.state()).room.game.night.outcome,[{seat:4,cause:'dream'}]);await f.act('settle-night');
  const p=(await f.state(f.players[3].token)).room;assert.equal(p.self.alive,false);assert.equal(p.game.hunter.canShoot,false);assert.equal(p.game.hunter.cause,'dream');
  assert.equal((await skill(f,'shoot',4,{target:3})).status,403);
 }
 const f=await fixture();await dream(f,4);await f.act('settle-night');await f.edit(r=>{r.game.step=3;r.game.nightId='n2'});await dream(f,3);await f.act('settle-night');
 await f.edit(r=>{r.game.step=5;r.game.nightId='n3'});await dream(f,4);await f.act('settle-night');assert.equal((await f.state()).room.players[3].alive,true);
});

test('night death of dreamer takes walker for knife, poison, manual and shots; daytime death does not',async()=>{
 for(const cause of ['knife','poison','manual','shot','day']){
  const f=await fixture();await dream(f,4);
  if(cause==='knife')await f.act('night',{seat:1});
  if(cause==='poison')await skill(f,'potion',2,{kind:'poison',target:1});
  if(cause==='manual')await f.act('status',{seat:1,alive:false});
  if(cause==='shot'){
   await f.edit(r=>{r.players[2].role='狼王';r.players[2].alive=false;r.game.deaths[3]={cause:'knife',step:0}});
   assert.equal((await skill(f,'shoot',3,{target:1})).status,200);
  }
  if(cause==='day'){await f.act('settle-night');await f.edit(r=>r.game.step=2);await f.act('status',{seat:1,alive:false});}
  else if(['knife','poison'].includes(cause))await f.act('settle-night');
  const p=(await f.state(f.players[3].token)).room;
  assert.equal(p.self.alive,cause==='day');
  if(cause!=='day'){assert.equal(p.game.hunter.cause,'dream-link');assert.equal(p.game.hunter.canShoot,false);}
 }
});

test('night gunfire is immune but consumed; daytime shot works; chained dream deaths terminate',async()=>{
 for(const day of [false,true]){
  const f=await fixture();await dream(f,3);await f.act('night',{seat:4});await f.act('settle-night');if(day)await f.edit(r=>r.game.step=2);
  assert.equal((await skill(f,'shoot',4,{target:3})).status,200);
  assert.equal((await f.state()).room.players[2].alive,!day);
  assert.equal((await f.state(f.players[3].token)).room.game.hunter.shot.blocked,!day?true:undefined);
 }
 const f=await fixture();await f.edit(r=>r.players[2].role='攝夢人');await dream(f,3);await skill(f,'dream',3,{target:4});
 await f.act('status',{seat:1,alive:false});assert.equal((await f.state()).room.players[3].alive,false);
 const cycle=await fixture();await cycle.edit(r=>r.players[2].role='攝夢人');await dream(cycle,3);await skill(cycle,'dream',3,{target:1});await cycle.act('status',{seat:1,alive:false});assert.equal((await cycle.state()).room.players[2].alive,false);
});

test('magician maps dreams once and consecutive checks actual player; concurrent dream uses only one target',async()=>{
 const f=await fixture();assert.equal((await skill(f,'swap',6,{targets:[3,4]})).status,200);await dream(f,3);
 assert.equal((await skill(f,'swap',6,{targets:[2,5]})).status,409);
 await f.act('night',{seat:3});await skill(f,'potion',2,{kind:'poison',target:3});await f.act('settle-night');assert.equal((await f.state()).room.players[3].alive,true);
 await f.edit(r=>{r.game.step=3;r.game.nightId='n2'});assert.deepEqual((await f.state(f.players[0].token)).room.game.dreamer.lethalTargets,[4]);
 await dream(f,4);await f.act('settle-night');assert.equal((await f.state()).room.players[3].alive,false);
 const c=await fixture();const {room}=await c.state();const stamp={code:c.code,token:c.players[0].token,round:room.round,revision:room.game.revision,step:0,nightId:room.game.nightId};
 const res=await Promise.all([2,3].map(target=>c.api('dream',{...stamp,target})));assert.deepEqual(res.map(r=>r.status).sort(),[200,409]);
 await c.act('status',{seat:1,alive:false});assert.equal((await dream(c,2)).status,403);
});
