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
  await edit(r => { r.players[0].role = '女巫'; r.players[1].role = '獵人'; r.players[2].role = '狼人'; });
  const state = token => api('state', { code, token: token || host.token });
  const potion = async (kind, target, extra = {}) => { const { room } = await state(); return api('potion', { code, token: players[0].token, round: room.round, revision: room.game.revision, step: room.game.step, kind, target, ...extra }); };
  const act = async (action, extra = {}) => { const { room } = await state(); return api(action, { code, token: host.token, round: room.round, revision: room.game.revision, ...extra }); };
  return { api, host, code, players, edit, state, potion, act };
}

test('antidote saves once, hides future knife targets, prevents same-night poison and survives recovery', async () => {
  const f = await fixture();
  await f.act('night', { seat: 2 });
  assert.equal((await f.state(f.players[0].token)).room.game.witch.knifeTarget, 2);
  assert.equal((await f.potion('heal', 3)).status, 409);
  const heal = await f.potion('heal', 2);
  assert.equal(heal.status, 200);
  assert.equal(heal.room.game.witch.healAvailable, false);
  assert.equal(Object.hasOwn(heal.room.game.witch, 'knifeTarget'), false);
  assert.equal((await f.potion('poison', 3)).status, 409);
  await f.act('settle-night');
  assert.equal((await f.state()).room.players[1].alive, true);
  await f.edit(r => { r.game.step = 3; });
  await f.act('night', { seat: 3 });
  const restored = await f.state(f.players[0].token);
  assert.equal(restored.room.game.witch.canUse, true);
  assert.equal(Object.hasOwn(restored.room.game.witch, 'knifeTarget'), false);
  assert.equal((await f.potion('heal', 3)).status, 409);
  await f.act('settle-night');
  assert.equal((await f.state()).room.players[2].alive, false);
});

test('poison settles with night, informs only poisoned hunter, resets and is not repeatable on rollback', async () => {
  const f = await fixture();
  await f.act('night', { seat: 3 });
  const result = await f.potion('poison', 2);
  assert.equal(result.status, 200);
  assert.equal(result.room.players[1].alive, true);
  assert.equal((await f.state(f.players[1].token)).room.game.hunterPoisoned, undefined);
  assert.equal((await f.potion('heal', 3)).status, 409);
  for (const response of [await f.api('lookup', { code: f.code }), await f.state(f.players[2].token)]) {
    assert.equal(response.room.game.witch, undefined);
    assert.equal(response.room.game.night, undefined);
    assert.equal(response.room.game.poisonDeaths, undefined);
  }
  assert.deepEqual((await f.state()).room.game.night.poisoned, [2]);
  await f.act('stage', { direction: 1 });
  assert.equal((await f.state()).room.players[1].alive, false);
  assert.equal((await f.state()).room.players[2].alive, false);
  assert.deepEqual((await f.state(f.players[1].token)).room.game.hunterPoisoned, { step: 0 });
  assert.equal((await f.state(f.players[2].token)).room.game.hunterPoisoned, undefined);
  await f.act('status', { seat: 2, alive: true });
  assert.equal((await f.state(f.players[1].token)).room.game.hunterPoisoned, undefined);
  await f.act('stage', { direction: -1 });
  await f.act('stage', { direction: 1 });
  assert.equal((await f.state()).room.players[1].alive, true);
  await f.edit(r => { r.game.step = 3; });
  assert.equal((await f.potion('poison', 2)).status, 409);
  await f.api('redeal', { code: f.code, token: f.host.token });
  await f.edit(r => { r.players[0].role = '女巫'; });
  const reset = (await f.state(f.players[0].token)).room.game.witch;
  assert.equal(reset.healAvailable, true); assert.equal(reset.poisonAvailable, true);
  assert.equal((await f.potion('poison', 2, { round: 1 })).status, 409);
});

test('potion permissions, malformed targets, stale commands and settled/day phases are enforced', async () => {
  const f = await fixture();
  for (const target of [null, 0, 99, '2']) assert.equal((await f.potion('poison', target)).status, 400);
  assert.equal((await f.potion('heal', 2)).status, 409); // No knife target.
  assert.equal((await f.potion('invalid', 2)).status, 400);
  assert.equal((await f.potion('poison', 2, { token: f.host.token })).status, 403);
  assert.equal((await f.potion('poison', 2, { token: f.players[2].token })).status, 403);
  await f.edit(r => { r.players[1].alive = false; });
  assert.equal((await f.potion('poison', 2)).status, 400);
  await f.edit(r => { r.players[0].alive = false; });
  assert.equal((await f.potion('poison', 3)).status, 403);
  await f.edit(r => { r.players[0].alive = true; });
  assert.equal((await f.potion('poison', 3, { revision: -1 })).status, 409);
  assert.equal((await f.potion('poison', 3, { step: 3 })).status, 409);
  await f.act('settle-night');
  assert.equal((await f.potion('poison', 3)).status, 409);
  await f.edit(r => { r.game.step = 2; });
  assert.equal((await f.potion('poison', 3)).status, 409);
});

test('concurrent heal and poison consume exactly one, reject stale host settlement and preserve saved target', async () => {
  const f = await fixture();
  await f.act('night', { seat: 2 });
  const { room } = await f.state();
  const results = await Promise.all([f.potion('heal', 2), f.potion('poison', 3)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal((await f.api('settle-night', { code: f.code, token: f.host.token, round: room.round, revision: room.game.revision })).status, 409);
  const w = (await f.state(f.players[0].token)).room.game.witch;
  if (w.heal) {
    await f.act('night', { seat: 3 });
    await f.act('settle-night');
    assert.equal((await f.state()).room.players[2].alive, false); // Rescue is tied to original target.
  }
  assert.equal(Boolean(w.heal) !== Boolean(w.poison), true);
});

test('antidote exempts only knife damage, cannot protect against another witch poison', async () => {
  const f = await fixture();
  await f.edit(r => { r.players[3].role = '女巫'; });
  await f.act('night', { seat: 2 });
  await f.potion('heal', 2);
  assert.equal((await f.potion('poison', 2, { token: f.players[3].token })).status, 200);
  await f.act('settle-night');
  assert.equal((await f.state()).room.players[1].alive, false);
  assert.deepEqual((await f.state(f.players[1].token)).room.game.hunterPoisoned, { step: 0 });
});

