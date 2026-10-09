import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, roleNames } from './lib/rooms.js';
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
  await edit(r => { r.players[0].role = '通靈師'; r.players[1].role = '狼人'; r.players[2].role = '女巫'; });
  const state = token => api('state', { code, token: token || host.token });
  const inspect = async (target, extra = {}) => { const { room } = await state(); return api('inspect-role', { code, token: players[0].token, round: room.round, revision: room.game.revision, step: room.game.step, nightId: room.game.nightId, target, ...extra }); };
  return { api, host, code, players, edit, state, inspect };
}

test('spirit checks once per night, keeps private results through recovery and rollback, resets on redeal', async () => {
  const f = await fixture();
  assert.equal((await f.inspect(1)).status, 400);
  assert.equal((await f.inspect(99)).status, 400);
  const race = await Promise.all([f.inspect(2), f.inspect(3)]);
  assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
  const own = (await f.state(f.players[0].token)).room.game.spirit;
  assert.equal(own.canInspect, false);
  assert.equal(own.results.length, 1);
  assert.ok(roleNames.includes(own.results[0].role));
  for (const response of [await f.state(), await f.state(f.players[1].token), await f.api('lookup', { code: f.code })]) {
    assert.equal(response.room.game.spirit, undefined);
    assert.equal(JSON.stringify(response).includes('inspections'), false);
    assert.equal(response.room.game.spirit, undefined);
  }
  await f.edit(r => { r.game.step = 2; });
  assert.equal((await f.inspect(2)).status, 409);
  await f.edit(r => { r.game.step = 0; });
  assert.equal((await f.inspect(2)).status, 409);
  await f.edit(r => { r.game.step = 3; });
  assert.equal((await f.inspect(3)).room.game.spirit.results.length, 2);
  await f.api('redeal', { code: f.code, token: f.host.token });
  await f.edit(r => { r.players[0].role = '通靈師'; });
  assert.deepEqual((await f.state(f.players[0].token)).room.game.spirit, { canInspect: true, results: [] });
  assert.equal((await f.inspect(2, { round: 1 })).status, 409);
});

test('spirit exact role covers all roles, validates permissions, settled nights and stale commands', async () => {
  const f = await fixture();
  for (const role of roleNames) {
    await f.edit(r => { r.players[1].role = role; r.game.fears = role === '夢魘' ? {2:{0:{target:3}}} : {}; delete r.game.spiritInspections; });
    const result = await f.inspect(2);
    assert.equal(result.status, 200);
    assert.equal(result.room.game.spirit.results[0].role, role);
  }
  await f.edit(r => { delete r.game.spiritInspections; r.players[0].alive = false; });
  assert.equal((await f.inspect(2)).status, 403);
  await f.edit(r => { r.players[0].alive = true; r.players[1].alive = false; });
  assert.equal((await f.inspect(2)).status, 400);
  assert.equal((await f.inspect(3, { token: f.host.token })).status, 403);
  assert.equal((await f.inspect(3, { token: f.players[2].token })).status, 403);
  assert.equal((await f.inspect(3, { revision: -1 })).status, 409);
  assert.equal((await f.inspect(3, { step: 3 })).status, 409);
  await f.edit(r => { r.game.nights[0] = { target: null, settled: true }; });
  assert.equal((await f.inspect(3)).status, 409);
});

test('spirit follows magic number mapping and prevents late swaps', async () => {
 const f = await fixture();
 await f.edit(r => { r.players[5].role = '魔術師'; });
 const act = async (action, extra={}) => { const {room}=await f.state();return f.api(action,{code:f.code,token:f.players[5].token,round:room.round,revision:room.game.revision,step:room.game.step,nightId:room.game.nightId,...extra}); };
 assert.equal((await act('swap',{targets:[2,3]})).status,200);
 assert.equal((await f.inspect(2)).room.game.spirit.results[0].role,'女巫');
 await f.edit(r=>{r.game.step=3;});
 assert.equal((await f.inspect(2,{nightId:'stale'})).status,409);
 assert.equal((await f.inspect(2)).status,200);
 assert.equal((await act('swap',{targets:[4,5]})).status,409);
 assert.equal((await f.state(f.players[0].token)).room.game.wolfTeammates,undefined);
});

test('spirit obeys nightmare priority, fear and later night recovery',async()=>{
 const f=await fixture();
 await f.edit(r=>{r.players[5].role='夢魘';});
 assert.equal((await f.inspect(2)).status,409);
 assert.equal((await f.state(f.players[0].token)).room.game.spirit.canInspect,false);
 const {room}=await f.state();
 assert.equal((await f.api('fear',{code:f.code,token:f.players[5].token,round:room.round,revision:room.game.revision,step:room.game.step,nightId:room.game.nightId,target:1})).status,200);
 assert.equal((await f.inspect(2)).status,403);
 assert.deepEqual((await f.state(f.players[0].token)).room.game.spirit,{canInspect:false,results:[]});
 await f.edit(r=>{r.game.step=13;r.players[5].alive=false;});
 assert.equal((await f.inspect(2)).status,200);
 assert.equal((await f.state(f.players[0].token)).room.game.spirit.results[0].role,'狼人');
});

