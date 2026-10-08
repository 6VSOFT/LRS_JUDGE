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
  await edit(r => { r.players[0].role = '騎士'; r.players[1].role = '女巫'; r.players[2].role = '狼人'; });
  const state = token => api('state', { code, token: token || host.token });
  const potion = async (kind, target, extra = {}) => { const { room } = await state(); return api('potion', { code, token: players[0].token, round: room.round, revision: room.game.revision, step: room.game.step, kind, target, ...extra }); };
  const act = async (action, extra = {}) => { const { room } = await state(); return api(action, { code, token: host.token, round: room.round, revision: room.game.revision, ...extra }); };
  const guard = async (target, extra = {}) => { const { room } = await state(); return api('guard', { code, token: players[0].token, round: room.round, revision: room.game.revision, step: room.game.step, nightId: room.game.nightId, target, ...extra }); };
  return { api, host, code, players, edit, state, potion, act, guard };
}


const duel=async(f,target,extra={})=>{const {room:r}=await f.state();return f.api('duel',{code:f.code,token:f.players[0].token,round:r.round,revision:r.game.revision,step:r.game.step,target,...extra});};
test('knight duels all 20 roles by camp, only loser dies, private result and once per game',async()=>{
 for(const role of roleNames){
  const f=await fixture();await f.edit(r=>{r.players[3].role=role;r.game.step=2;});
  assert.equal((await duel(f,4)).status,200);
  const {room:r}=await f.state(),wolf=wolfRoles.has(role);
  assert.equal(r.players[0].alive,wolf);assert.equal(r.players[3].alive,!wolf);
  assert.equal((await f.state(f.players[0].token)).room.game.knight.duel.eliminated,wolf?4:1);
  assert.equal(r.game.knight,undefined);
  assert.equal((await f.state(f.players[1].token)).room.game.knight,undefined);
  assert.equal((await f.api('lookup',{code:f.code})).room.game.knight,undefined);
  assert.notEqual((await duel(f,5)).status,200);
  await f.act('status',{seat:1,alive:true});assert.equal((await duel(f,5)).status,409);
  await f.edit(r=>{r.game.step=0;});assert.ok((await f.state(f.players[0].token)).room.game.knight.duel);
  await f.api('redeal',{code:f.code,token:f.host.token});await f.edit(r=>{r.players[0].role='騎士';r.game.step=2;});
  assert.equal((await f.state(f.players[0].token)).room.game.knight.duel,null);
  assert.equal((await duel(f,5)).status,200);
 }
});
test('knight validates night, credentials, stale state, alive and other target; election is daytime',async()=>{
 const f=await fixture();assert.equal((await duel(f,4)).status,409);
 await f.edit(r=>{r.game.step=2;});
 for(const target of [1,null,'4',99])assert.equal((await duel(f,target)).status,400);
 for(const extra of [{round:0},{revision:-1},{step:0}])assert.equal((await duel(f,4,extra)).status,409);
 assert.equal((await duel(f,4,{token:f.host.token})).status,403);
 assert.equal((await duel(f,4,{token:f.players[1].token})).status,403);
 await f.act('status',{seat:4,alive:false});assert.equal((await duel(f,4)).status,400);
 await f.act('status',{seat:1,alive:false});assert.equal((await duel(f,5)).status,403);
 await f.act('status',{seat:1,alive:true});await f.edit(r=>{r.game.step=1;});assert.equal((await duel(f,3)).status,200);
});
test('concurrent duels cannot consume twice; active voting cancelled without granting hunter shot',async()=>{
 const f=await fixture();await f.edit(r=>{r.game.step=2;r.players[3].role='狼人';r.players[4].role='狼人';r.game.voting={status:'active',eligible:[1,2,3,4,5,6],votes:{}};});
 const results=await Promise.all([duel(f,4),duel(f,5)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 let {room:r}=await f.state();assert.equal(r.game.voting.status,'cancelled');assert.equal(r.players.filter(p=>!p.alive).length,1);
 await f.edit(r=>{r.players[0].role='獵人';r.players[0].alive=false;r.game.deaths[1]={cause:'duel',step:2};});
 assert.equal((await f.state(f.players[0].token)).room.game.hunter.canShoot,false);
});
