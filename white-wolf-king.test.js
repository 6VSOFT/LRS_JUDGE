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
  await edit(r => { r.players[0].role = '白狼王'; r.players[1].role = '女巫'; r.players[2].role = '狼人'; });
  const state = token => api('state', { code, token: token || host.token });
  const potion = async (kind, target, extra = {}) => { const { room } = await state(); return api('potion', { code, token: players[0].token, round: room.round, revision: room.game.revision, step: room.game.step, kind, target, ...extra }); };
  const act = async (action, extra = {}) => { const { room } = await state(); return api(action, { code, token: host.token, round: room.round, revision: room.game.revision, ...extra }); };
  const guard = async (target, extra = {}) => { const { room } = await state(); return api('guard', { code, token: players[0].token, round: room.round, revision: room.game.revision, step: room.game.step, nightId: room.game.nightId, target, ...extra }); };
  return { api, host, code, players, edit, state, potion, act, guard };
}


const explode=async(f,target,extra={})=>{const {room:r}=await f.state();return f.api('explode',{code:f.code,token:f.players[0].token,round:r.round,revision:r.game.revision,step:r.game.step,target,...extra});};
test('white wolf king eliminates both atomically during day/election, keeps single use and privacy',async()=>{
 for(const step of [1,2]){
  const f=await fixture();await f.edit(r=>{r.game.step=step;});
  assert.equal((await explode(f,4)).status,200);
  const {room:r}=await f.state();assert.equal(r.players[0].alive,false);assert.equal(r.players[3].alive,false);assert.equal(r.players.filter(p=>!p.alive).length,2);assert.equal(r.game.step,step);
  assert.equal((await f.state(f.players[0].token)).room.game.whiteWolfKing.explosion.target,4);
  for(const token of [f.host.token,f.players[3].token,f.players[4].token])assert.equal((await f.state(token)).room.game.whiteWolfKing,undefined);
  assert.equal((await f.api('lookup',{code:f.code})).room.game.whiteWolfKing,undefined);
  await f.act('status',{seat:1,alive:true});assert.equal((await explode(f,5)).status,409);
  await f.edit(r=>{r.game.step=0;});assert.ok((await f.state(f.players[0].token)).room.game.whiteWolfKing.explosion);
  await f.api('redeal',{code:f.code,token:f.host.token});await f.edit(r=>{r.players[0].role='白狼王';r.game.step=2;});
  assert.equal((await f.state(f.players[0].token)).room.game.whiteWolfKing.explosion,null);assert.equal((await explode(f,5)).status,200);
 }
});
test('explode validates role, alive, night, other target and stale stamps',async()=>{
 const f=await fixture();assert.equal((await explode(f,4)).status,409);await f.edit(r=>{r.game.step=2;});
 for(const target of [1,null,'4',99])assert.equal((await explode(f,target)).status,400);
 for(const extra of [{round:0},{revision:-1},{step:0}])assert.equal((await explode(f,4,extra)).status,409);
 for(const token of [f.host.token,f.players[1].token,f.players[2].token])assert.equal((await explode(f,4,{token})).status,403);
 await f.act('status',{seat:4,alive:false});assert.equal((await explode(f,4)).status,400);
 await f.act('status',{seat:1,alive:false});assert.equal((await explode(f,5)).status,403);
});
test('concurrent explosions cannot kill extra player; vote cancelled; hunter/wolf king cannot shoot from explosion',async()=>{
 for(const sheriff of [false,true]){
  const f=await fixture();await f.edit(r=>{r.game.step=sheriff?1:2;r.players[3].role='獵人';r.players[4].role='狼王';r.game.voting={status:'active',kind:sheriff?'sheriff':'exile',eligible:[1,2,3,4,5,6],votes:{}};if(sheriff)r.game.election={status:'voting',answers:{},participants:[1,2,3,4,5,6],candidates:[1]};});
  const results=await Promise.all([explode(f,4),explode(f,5)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,403]);
  const {room:r}=await f.state();assert.equal(r.game.voting.status,'cancelled');assert.equal(r.players.filter(p=>!p.alive).length,2);assert.deepEqual(r.game.shotDeaths,[]);
  const victim=r.players.find(p=>p.seat!==1&&!p.alive);assert.equal((await f.state(f.players[victim.seat-1].token)).room.game.hunter.canShoot,false);
 }
});
