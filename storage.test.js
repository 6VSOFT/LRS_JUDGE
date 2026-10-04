import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from './lib/rooms.js';
import { MemoryStore } from './lib/memory-store.js';

function client(store) {
  return async (action, body, token = '') => {
    const read = ['lookup', 'state'].includes(action);
    const response = await handleRequest(new Request('https://example.test/api/' + action + (read ? '?code=' + body.code : ''), {
      method: read ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      ...(read ? {} : { body: JSON.stringify(body) }),
    }), store);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return { status: response.status, ...await response.json() };
  };
}

test('independent function instances preserve simultaneous seat claims and deal once', async () => {
  const store = new MemoryStore();
  const api = client(store);
  const host = await api('create', { size: 12 });
  const code = host.room.code;
  const players = await Promise.all(Array.from({ length: 12 }, (_, i) => client(store)('join', { code, seat: i + 1 })));
  assert.ok(players.every(p => p.status === 200));
  const state = await api('state', { code }, host.token);
  assert.equal(state.room.round, 1);
  assert.equal(state.room.phase, 'dealt');
  assert.equal(state.room.players.length, 12);
  const privateStates = await Promise.all(players.map(p => client(store)('state', { code }, p.token)));
  assert.equal(privateStates.filter(p => p.room.self.role === '狼人').length, 4);
  assert.equal(privateStates.filter(p => p.room.self.role === '村民').length, 4);
  assert.ok(privateStates.every(p => p.room.players.every(seat => !seat.token && !seat.role)));
  assert.ok(privateStates.every(p => !Object.hasOwn(p.room.self, 'confirmed')));
  assert.ok(state.room.players.every(p => !Object.hasOwn(p, 'confirmed')));
  assert.equal((await api('confirm', { code, token: players[0].token, round: 1 })).status, 404);
});

test('simultaneous claims cannot both own a seat; dissolved room cannot be resurrected', async () => {
  const store = new MemoryStore();
  const api = client(store);
  const host = await api('create', { size: 6 });
  const code = host.room.code;
  const race = await Promise.all([api('join', { code, seat: 1 }), api('join', { code, seat: 1 })]);
  assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
  const original = await store.read(code);
  assert.equal((await api('dissolve', { code, token: host.token })).status, 200);
  assert.equal(await store.write(code, original.data, original.etag), false);
  assert.equal((await api('lookup', { code })).status, 404);
});

test('expired rooms are unavailable and storage failures never expose internals', async () => {
  const store = new MemoryStore();
  const api = client(store);
  const host = await api('create', { size: 6 });
  const current = await store.read(host.room.code);
  current.data.expiresAt = Date.now() - 1;
  await store.write(host.room.code, current.data, current.etag);
  assert.equal((await api('state', { code: host.room.code }, host.token)).status, 404);
  const broken = client({ read: async () => { throw Error('private credential'); } });
  const result = await broken('lookup', { code: '1234' });
  assert.equal(result.status, 503);
  assert.doesNotMatch(result.error, /credential/);
});
