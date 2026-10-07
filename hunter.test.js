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
  await edit(r => { r.players[0].role = '獵人'; r.players[1].role = '女巫'; r.players[2].role = '狼人'; });
  const state = token => api('state', { code, token: token || host.token });
  const potion = async (kind, target, extra = {}) => { const { room } = await state(); return api('potion', { code, token: players[0].token, round: room.round, revision: room.game.revision, step: room.game.step, kind, target, ...extra }); };
  const act = async (action, extra = {}) => { const { room } = await state(); return api(action, { code, token: host.token, round: room.round, revision: room.game.revision, ...extra }); };
  const guard = async (target, extra = {}) => { const { room } = await state(); return api('guard', { code, token: players[0].token, round: room.round, revision: room.game.revision, step: room.game.step, nightId: room.game.nightId, target, ...extra }); };
  return { api, host, code, players, edit, state, potion, act, guard };
}


const shoot = async (f, target, extra = {}) => { const {room:r}=await f.state(); return f.api('shoot',{code:f.code,token:f.players[0].token,round:r.round,revision:r.game.revision,target,...extra}); };
test('hunter can shoot once after knife, milk or exile, persists and resets',async()=>{
 for(const cause of ['knife','milk','exile']){
  const f=await fixture();
  if(cause==='exile'){
   await f.edit(r=>{r.game.step=2;r.game.voting={status:'ended',votes:{2:1},eligible:[2]};});
   await f.act('eliminate-vote');
  } else {
   await f.act('night',{seat:1});
   if(cause==='milk')await f.edit(r=>{r.game.guards={4:{0:{target:1}}};r.game.witches={2:{heal:{step:0,target:1}}};});
   await f.act('settle-night');
  }
  assert.equal((await f.state(f.players[0].token)).room.game.hunter.canShoot,true);
  assert.equal((await f.state()).room.game.hunter,undefined);
  assert.equal((await f.api('lookup',{code:f.code})).room.game.hunter,undefined);
  assert.equal((await shoot(f,1)).status,400);
  for(const target of [null,'4',99])assert.equal((await shoot(f,target)).status,400);
  assert.equal((await shoot(f,4)).status,200);
  assert.equal((await f.state()).room.players[3].alive,false);
  assert.equal((await f.state(f.players[0].token)).room.game.hunter.shot.target,4);
  assert.equal((await shoot(f,5)).status,403);
  await f.act('status',{seat:1,alive:true});
  await f.act('status',{seat:1,alive:false});
  assert.equal((await shoot(f,5)).status,403);
  await f.api('redeal',{code:f.code,token:f.host.token});
  await f.edit(r=>{r.players[0].role='獵人';});
  assert.equal((await f.state(f.players[0].token)).room.game.hunter.shot,null);
 }
});
test('poison overrides knife and milk; manual death and living hunter cannot shoot',async()=>{
 for(const milk of [false,true]){
  const f=await fixture();await f.act('night',{seat:1});
  await f.edit(r=>{r.game.witches={2:{poison:{step:0,target:1},...(milk?{heal:{step:0,target:1}}:{})}};if(milk)r.game.guards={4:{0:{target:1}}};});
  await f.act('settle-night');
  const h=(await f.state(f.players[0].token)).room.game;
  assert.equal(h.hunter.canShoot,false);assert.equal(h.hunter.cause,'poison');assert.ok(h.hunterPoisoned);
  assert.equal((await shoot(f,4)).status,403);
 }
 const f=await fixture();assert.equal((await shoot(f,4)).status,403);
 await f.act('status',{seat:1,alive:false});assert.equal((await shoot(f,4)).status,403);
 assert.equal((await shoot(f,4,{token:f.players[1].token})).status,403);
});
test('shoot rejects stale requests and concurrent duplicates; cancels active vote',async()=>{
 const f=await fixture();await f.act('night',{seat:1});await f.act('settle-night');
 for(const extra of [{round:0},{revision:-1}])assert.equal((await shoot(f,4,extra)).status,409);
 await f.edit(r=>{r.game.step=2;r.game.voting={status:'active',eligible:[2,3,4,5,6],votes:{}};});
 const results=await Promise.all([shoot(f,4),shoot(f,5)]);
 assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
 const {room:r}=await f.state();assert.equal(r.game.voting.status,'cancelled');
 assert.equal(r.players.filter(p=>p.alive===false).length,2);
});
