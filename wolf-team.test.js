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



test('only five specified wolf roles receive all other wolf camp seats without concrete roles',async()=>{
 const f=await fixture();const allowed=new Set(['狼人','狼王','白狼王','狼美人','血月使徒']);
 for(const role of roleNames){
  await f.edit(r=>{r.players[0].role=role;r.players[1].role='石像鬼';r.players[2].role='機械狼';r.players[3].role='夢魘';r.players[4].role='村民';r.players[5].role='狼人'});
  const r=(await f.state(f.players[0].token)).room;
  assert.deepEqual(r.game.wolfTeammates,allowed.has(role)?[2,3,4,6]:undefined,role);
  assert.ok(r.players.every(p=>p.role===undefined));
  assert.equal((await f.state()).room.game.wolfTeammates,undefined);
  const pub=await f.api('lookup',{code:f.code,token:f.players[0].token});assert.equal(pub.room.game.wolfTeammates,undefined);
 }
});

test('teammate seats persist across day/death/number swaps and refresh; redeal recomputes from new roles',async()=>{
 const f=await fixture();await f.edit(r=>{r.players[0].role='狼人';r.players[1].role='狼王';r.players[2].role='白狼王';r.players[3].role='狼美人';r.players[4].role='血月使徒';r.players[5].role='村民';r.game.swaps={6:{0:{targets:[2,6]}}}});
 for(const step of [0,1,2,3]){
  await f.edit(r=>{r.game.step=step;r.players[1].alive=false});
  assert.deepEqual((await f.state(f.players[0].token)).room.game.wolfTeammates,[2,3,4,5]);
 }
 await f.edit(r=>r.players[0].alive=false);assert.deepEqual((await f.state(f.players[0].token)).room.game.wolfTeammates,[2,3,4,5]);
 await f.act('redeal');const host=(await f.state()).room;
 for(let i=0;i<6;i++){
  const r=(await f.state(f.players[i].token)).room;
  const expected=host.players.filter(p=>p.seat!==i+1&&wolfRoles.has(p.role)).map(p=>p.seat);
  assert.deepEqual(r.game.wolfTeammates,['狼人','狼王','白狼王','狼美人','血月使徒'].includes(r.self.role)?expected:undefined);
 }
 await f.edit(r=>r.players.forEach((p,i)=>p.role=i?'村民':'狼人'));
 assert.deepEqual((await f.state(f.players[0].token)).room.game.wolfTeammates,[]);
});
