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
  await edit(r => { ['魔術師','女巫','狼人','預言家','獵人','守衛'].forEach((role,i)=>r.players[i].role=role); });
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
const swap=(f,targets,extra={})=>skill(f,'swap',1,{targets,...extra});

test('magician redirects seer results without exposing swap or changing identity',async()=>{
 const f=await fixture();
 assert.equal((await swap(f,[3,6])).status,200);
 assert.equal((await skill(f,'inspect',4,{target:6})).status,200);
 const seer=(await f.state(f.players[3].token)).room;
 assert.equal(seer.game.seer.results[0].camp,'狼人陣營');
 assert.equal(seer.game.seer.results[0].target,6);
 assert.equal(seer.game.magician,undefined);
 assert.equal(seer.game.night,undefined);
 assert.deepEqual((await f.state()).room.game.night.swaps,[[3,6]]);
 assert.deepEqual((await f.state(f.players[0].token)).room.game.magician.results,[{step:0,targets:[3,6]}]);
 const pub=(await f.api('lookup',{code:f.code})).room;
 assert.equal(pub.game.magician,undefined);assert.equal(pub.game.night,undefined);
 assert.equal((await f.state(f.players[2].token)).room.self.role,'狼人');
});

test('knife, antidote, guard, milk and poison resolve on swapped number exactly once',async()=>{
 for(const [heal,guard,alive] of [[false,false,false],[true,false,true],[false,true,true],[true,true,false]]){
  const f=await fixture(); await swap(f,[3,5]);await f.act('night',{seat:3});
  assert.equal((await f.state(f.players[1].token)).room.game.witch.knifeTarget,3); // Original numbered knife, mapped once at settlement.
  if(heal)assert.equal((await skill(f,'potion',2,{kind:'heal',target:3})).status,200);
  if(guard)assert.equal((await skill(f,'guard',6,{target:3})).status,200);
  const preview=(await f.state()).room.game.night;assert.equal(preview.resolvedTarget,5);
  if(heal)assert.deepEqual(preview.healed,[5]);if(guard)assert.deepEqual(preview.guarded,[5]);
  await f.act('settle-night');const r=(await f.state()).room;
  assert.equal(r.players[2].alive,true);assert.equal(r.players[4].alive,alive);
  if(!alive)assert.equal((await f.state(f.players[4].token)).room.game.hunter.canShoot,true);
  assert.equal((await f.act('settle-night')).status,409);
 }
 const f=await fixture();await swap(f,[3,5]);await skill(f,'potion',2,{kind:'poison',target:3});await f.act('settle-night');
 const h=(await f.state(f.players[4].token)).room;assert.equal(h.self.alive,false);assert.equal(h.game.hunter.cause,'poison');assert.equal(h.game.hunter.canShoot,false);
 assert.equal((await f.state()).room.players[2].alive,true);
});

test('hunter and wolf king shots redirect only during the current night',async()=>{
 for(const role of ['獵人','狼王'])for(const daytime of [false,true])for(const target of [2,3]){
  const f=await fixture();await f.edit(r=>r.players[4].role=role);await swap(f,[2,3]);await f.act('night',{seat:5});await f.act('settle-night');
  if(daytime)await f.edit(r=>r.game.step=2);
  assert.equal((await skill(f,'shoot',5,{target})).status,200);
  const actual=daytime?target:target===2?3:2,r=(await f.state()).room;
  assert.equal(r.players[actual-1].alive,false);assert.equal(r.players[(actual===2?3:2)-1].alive,true);
  assert.deepEqual(r.game.shotDeaths,[actual]);
 }
});

test('swap requires permission, night, two alive distinct numbers and unused numbers across nights',async()=>{
 const f=await fixture();
 assert.equal((await skill(f,'swap',2,{targets:[2,3]})).status,403);
 for(const targets of [null,[],[2],[2,2],[0,2],[2,7],['2',3],[1,2,3]])assert.equal((await swap(f,targets)).status,400);
 assert.equal((await swap(f,[1,2],{round:0})).status,409);
 assert.equal((await swap(f,[1,2],{nightId:'old'})).status,409);
 await f.act('status',{seat:2,alive:false});assert.equal((await swap(f,[1,2])).status,400);await f.act('status',{seat:2,alive:true});
 await f.edit(r=>r.game.step=2);assert.equal((await swap(f,[1,2])).status,409);
 await f.edit(r=>r.game.step=0);assert.equal((await swap(f,[1,2])).status,200);
 assert.equal((await swap(f,[3,4])).status,409);
 await f.edit(r=>{r.game.step=3;r.game.nightId='n2'});
 assert.equal((await swap(f,[2,3])).status,409);assert.equal((await swap(f,[3,4])).status,200);
 await f.edit(r=>r.game.step=0);assert.equal((await swap(f,[5,6])).status,409);
 await f.act('redeal');await f.edit(r=>r.players[0].role='魔術師');assert.deepEqual((await f.state(f.players[0].token)).room.game.magician.usedSeats,[]);
 assert.equal((await swap(f,[1,2])).status,200);
});

test('swap cannot rewrite earlier actions; concurrent submissions and later-night knife remain correct',async()=>{
 for(const action of ['inspect','guard','potion','night']){
  const f=await fixture();
  if(action==='inspect')await skill(f,action,4,{target:3});
  if(action==='guard')await skill(f,action,6,{target:3});
  if(action==='potion')await skill(f,action,2,{kind:'poison',target:3});
  if(action==='night'){await f.act('night',{seat:3});await f.act('night',{seat:null});}
  assert.equal((await swap(f,[2,3])).status,409);
 }
 const f=await fixture();const {room}=await f.state();const stamp={code:f.code,token:f.players[0].token,round:room.round,revision:room.game.revision,step:0,nightId:room.game.nightId};
 const res=await Promise.all([[2,3],[4,5]].map(targets=>f.api('swap',{...stamp,targets})));
 assert.deepEqual(res.map(r=>r.status).sort(),[200,409]);
 await f.edit(r=>{r.game.step=3;r.game.nightId='n2'});await f.act('night',{seat:2});await f.act('settle-night');
 assert.equal((await f.state()).room.players[1].alive,false);
 const dead=await fixture();await dead.act('status',{seat:1,alive:false});assert.equal((await swap(dead,[2,3])).status,403);
 const settled=await fixture();await settled.act('settle-night');assert.equal((await swap(settled,[2,3])).status,409);
});
