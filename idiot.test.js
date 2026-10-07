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
  await edit(r => { r.players[0].role = '白痴'; r.players[1].role = '村民'; r.players[2].role = '狼人'; });
  const state = token => api('state', { code, token: token || host.token });
  const reveal = async (extra = {}) => { const { room } = await state(); return api('reveal-idiot', { code, token: players[0].token, round: room.round, revision: room.game.revision, ...extra }); };
  const act = async (action, extra = {}) => { const { room } = await state(); return api(action, { code, token: host.token, round: room.round, revision: room.game.revision, ...extra }); };
  return { api, host, code, players, edit, state, reveal, act };
}

test('idiot voluntarily reveals to everyone, persists through recovery and death, resets on redeal', async () => {
  const f = await fixture();
  assert.deepEqual((await f.api('lookup', { code: f.code })).room.game.revealedIdiots, []);
  const results = await Promise.all([f.reveal(), f.reveal()]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  for (const r of [await f.state(), await f.state(f.players[1].token), await f.api('lookup', { code: f.code })]) {
    assert.deepEqual(r.room.game.revealedIdiots, [1]);
    if (!r.room.host) assert.equal(r.room.players[0].role, undefined);
    assert.equal(r.room.players[1].token, undefined);
  }
  await f.act('stage', { direction: 1 });
  await f.act('status', { seat: 1, alive: false });
  assert.deepEqual((await f.state(f.players[0].token)).room.game.revealedIdiots, [1]);
  await f.api('redeal', { code: f.code, token: f.host.token });
  assert.deepEqual((await f.state()).room.game.revealedIdiots, []);
  await f.edit(r => { r.players[0].role = '白痴'; });
  assert.equal((await f.reveal({ round: 1 })).status, 409);
});

test('only living idiots reveal themselves, rejects forged targets and stale requests, supports legacy rooms', async () => {
  const f = await fixture();
  assert.equal((await f.reveal({ token: f.host.token })).status, 403);
  assert.equal((await f.reveal({ token: f.players[1].token, role: '白痴', seat: 1 })).status, 403);
  assert.equal((await f.reveal({ token: 'invalid' })).status, 403);
  assert.equal((await f.reveal({ revision: -1 })).status, 409);
  await f.act('status', { seat: 1, alive: false });
  assert.equal((await f.reveal()).status, 403);
  await f.act('status', { seat: 1, alive: true });
  await f.edit(r => { delete r.game.revealedIdiots; r.game.step = 2; });
  assert.equal((await f.reveal({ seat: 2 })).status, 200);
  assert.deepEqual((await f.state()).room.game.revealedIdiots, [1]);
  assert.equal((await f.reveal()).status, 409);
});

