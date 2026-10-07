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
  await edit(r => { r.players[0].role = '守衛'; r.players[1].role = '女巫'; r.players[2].role = '狼人'; });
  const state = token => api('state', { code, token: token || host.token });
  const potion = async (kind, target, extra = {}) => { const { room } = await state(); return api('potion', { code, token: players[0].token, round: room.round, revision: room.game.revision, step: room.game.step, kind, target, ...extra }); };
  const act = async (action, extra = {}) => { const { room } = await state(); return api(action, { code, token: host.token, round: room.round, revision: room.game.revision, ...extra }); };
  const guard = async (target, extra = {}) => { const { room } = await state(); return api('guard', { code, token: players[0].token, round: room.round, revision: room.game.revision, step: room.game.step, nightId: room.game.nightId, target, ...extra }); };
  return { api, host, code, players, edit, state, potion, act, guard };
}

test('night settlement handles knife, guard, antidote, milk piercing and poison distinctly', async () => {
  for (const [guarded, healed, knife, expectedAlive] of [
    [false, false, true, false], [true, false, true, true],
    [false, true, true, true], [true, true, true, false], [true, false, false, true],
  ]) {
    const f = await fixture();
    if (knife) await f.act('night', { seat: 4 });
    if (guarded) assert.equal((await f.guard(4)).status, 200);
    if (healed) assert.equal((await f.potion('heal', 4, { token: f.players[1].token })).status, 200);
    const host = await f.state();
    assert.deepEqual(host.room.game.night.guarded, guarded ? [4] : []);
    await f.act('settle-night');
    assert.equal((await f.state()).room.players[3].alive, expectedAlive);
    if (guarded && healed) assert.ok((await f.state()).room.game.history.some(r => r.text.includes('奶穿')));
  }
  const f = await fixture();
  await f.guard(4);
  await f.potion('poison', 4, { token: f.players[1].token });
  await f.act('stage', { direction: 1 });
  assert.equal((await f.state()).room.players[3].alive, false);
});

test('guard cannot repeat adjacent nights, persists across refresh/rollback, skipped night breaks consecutive restriction', async () => {
  const f = await fixture();
  assert.equal((await f.guard(1)).status, 200); // Self guard allowed.
  assert.equal((await f.guard(4)).status, 409);
  assert.equal((await f.state(f.players[0].token)).room.game.guard.target, 1);
  for (const token of [f.host.token, f.players[1].token, f.players[2].token]) assert.equal((await f.state(token)).room.game.guard, undefined);
  assert.equal((await f.api('lookup', { code: f.code })).room.game.guard, undefined);
  await f.edit(r => { r.game.step = 3; r.game.nightId = 'night2'; });
  assert.deepEqual((await f.state(f.players[0].token)).room.game.guard.blockedTargets, [1]);
  assert.equal((await f.guard(1)).status, 400);
  assert.equal((await f.guard(4)).status, 200);
  await f.edit(r => { r.game.step = 5; r.game.nightId = 'night3'; });
  assert.equal((await f.guard(4)).status, 400);
  assert.equal((await f.guard(1)).status, 200);
  await f.edit(r => { r.game.step = 7; r.game.nightId = 'night4'; }); // No guard on night 4.
  await f.edit(r => { r.game.step = 9; r.game.nightId = 'night5'; });
  assert.equal((await f.guard(1)).status, 200);
  await f.api('redeal', { code: f.code, token: f.host.token });
  await f.edit(r => { r.players[0].role = '守衛'; });
  assert.deepEqual((await f.state(f.players[0].token)).room.game.guard.results, []);
  assert.equal((await f.guard(1, { round: 1 })).status, 409);
});

test('guard validates permission, night, alive target and stale stamps; concurrent requests cannot select twice', async () => {
  const f = await fixture();
  for (const target of [null, '4', 99]) assert.equal((await f.guard(target)).status, 400);
  assert.equal((await f.guard(4, { token: f.host.token })).status, 403);
  assert.equal((await f.guard(4, { token: f.players[1].token })).status, 403);
  for (const extra of [{ revision: -1 }, { nightId: 'old' }, { step: 3 }]) assert.equal((await f.guard(4, extra)).status, 409);
  await f.act('status', { seat: 4, alive: false });
  assert.equal((await f.guard(4)).status, 400);
  await f.act('status', { seat: 1, alive: false });
  assert.equal((await f.guard(5)).status, 403);
  await f.act('status', { seat: 1, alive: true });
  await f.edit(r => { r.game.step = 2; });
  assert.equal((await f.guard(5)).status, 409);
  await f.edit(r => { r.game.step = 0; });
  const concurrent = await Promise.all([f.guard(5), f.guard(6)]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
  await f.act('settle-night');
  assert.equal((await f.guard(5)).status, 409);
});

