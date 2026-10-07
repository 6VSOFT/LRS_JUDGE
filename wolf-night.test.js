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
  await edit(r => { r.players[0].role = '狼人'; r.players[1].role = '狼人'; r.players[2].role = '女巫'; r.players[3].role = '村民'; });
  const state = token => api('state', { code, token: token || host.token });
  const select = async (token, seat, extra = {}) => { const { room } = await state(); return api('select-night', { code, token, round: room.round, step: room.game.step, nightId: room.game.nightId, seat, ...extra }); };
  const act = async (action, extra = {}) => { const { room } = await state(); return api(action, { code, token: host.token, round: room.round, revision: room.game.revision, ...extra }); };
  return { api, host, code, players, edit, state, select, act };
}

test('wolves and host share a single last-write-wins target and settle only one victim', async () => {
  const f = await fixture(), wolf1 = f.players[0].token, wolf2 = f.players[1].token;
  const before = (await f.state()).room.game;
  assert.equal((await f.select(wolf1, 4)).status, 200);
  assert.equal((await f.state(wolf2)).room.game.wolfNight.target, 4);
  // An old host revision does not reject a later valid target choice.
  assert.equal((await f.select(f.host.token, 5, { revision: before.revision })).status, 200);
  assert.equal((await f.state(wolf1)).room.game.wolfNight.target, 5);
  assert.equal((await f.select(wolf2, 6)).status, 200);
  assert.equal((await f.state()).room.game.night.target, 6);
  const witch = (await f.state(f.players[2].token)).room.game;
  assert.equal(witch.witch.knifeTarget, 6);
  assert.equal(witch.wolfNight, undefined);
  for (const r of [await f.state(f.players[3].token), await f.api('lookup', { code: f.code })]) {
    assert.equal(r.room.game.wolfNight, undefined); assert.equal(r.room.game.night, undefined);
  }
  const wolfView = (await f.state(wolf1)).room.game;
  assert.deepEqual(wolfView.wolfNight, { target: 6, settled: false });
  assert.equal(wolfView.history, undefined); assert.equal(wolfView.night, undefined);
  assert.equal((await f.act('settle-night')).status, 200);
  assert.deepEqual((await f.state()).room.players.filter(p => !p.alive).map(p => p.seat), [6]);
  assert.equal((await f.select(wolf1, 5)).status, 409);
});

test('concurrent wolves both select successfully, with one shared final target', async () => {
  const f = await fixture();
  const results = await Promise.all([f.select(f.players[0].token, 4), f.select(f.players[1].token, 5)]);
  assert.deepEqual(results.map(r => r.status), [200, 200]);
  const target = (await f.state()).room.game.night.target;
  assert.ok([4, 5].includes(target));
  assert.equal((await f.state(f.players[0].token)).room.game.wolfNight.target, target);
  assert.equal((await f.state(f.players[1].token)).room.game.wolfNight.target, target);
  await f.act('settle-night');
  assert.deepEqual((await f.state()).room.players.filter(p => !p.alive).map(p => p.seat), [target]);
});

test('wolves cannot clear or settle, dead/non-wolves cannot act, stale nights and rounds are rejected', async () => {
  const f = await fixture(), token = f.players[0].token;
  for (const seat of [null, '4', 0, 99]) assert.equal((await f.select(token, seat)).status, 400);
  for (const other of [f.players[2].token, f.players[3].token, 'invalid']) assert.equal((await f.select(other, 4)).status, 403);
  const old = (await f.state()).room.game;
  for (const action of ['night', 'settle-night']) assert.equal((await f.api(action, { code: f.code, token, round: 1, revision: old.revision, seat: null })).status, 403);
  await f.act('status', { seat: 1, alive: false });
  assert.equal((await f.select(token, 4)).status, 403);
  assert.equal((await f.state(token)).room.game.wolfNight, undefined);
  await f.act('status', { seat: 1, alive: true });
  await f.act('status', { seat: 4, alive: false });
  assert.equal((await f.select(token, 4)).status, 400);
  await f.act('stage', { direction: 1 });
  assert.equal((await f.select(token, 5)).status, 409);
  await f.act('stage', { direction: -1 });
  assert.equal((await f.select(token, 5, { nightId: old.nightId })).status, 409);
  await f.api('redeal', { code: f.code, token: f.host.token });
  await f.edit(r => { r.players[0].role = '狼人'; });
  assert.equal((await f.select(token, 5, { round: 1 })).status, 409);
});

