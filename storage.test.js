import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, createDeck } from './lib/rooms.js';
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
  assert.ok(state.room.players.every(p => p.role && !p.token));
  const privateStates = await Promise.all(players.map(p => client(store)('state', { code }, p.token)));
  assert.equal(privateStates.filter(p => p.room.self.role === '狼人').length, 4);
  assert.equal(privateStates.filter(p => p.room.self.role === '村民').length, 4);
  assert.ok(privateStates.every(p => p.room.players.every(seat => !seat.token && !seat.role)));
  for (const player of privateStates) {
    assert.equal(state.room.players.find(p => p.seat === player.room.self.seat).role, player.room.self.role);
  }
  const publicState = await api('lookup', { code }, host.token);
  assert.ok(publicState.room.players.every(p => !p.role && !p.token));
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

test('every size 6 through 12 supports defaults and custom counts across deals', async () => {
  const api = client(new MemoryStore());
  for (let size = 6; size <= 12; size++) {
    const preset = await api('create', { size });
    assert.equal(preset.status, 200);
    assert.equal(Object.values(preset.room.roleCounts).reduce((a, b) => a + b, 0), size);
    const roles = { 狼人: 2, 村民: size - 5, 預言家: 2, 女巫: 1, 獵人: 0, 守衛: 0 };
    const host = await api('create', { size, roles });
    assert.equal(host.status, 200);
    assert.deepEqual(host.room.roleCounts, roles);
    const code = host.room.code;
    const players = await Promise.all(Array.from({ length: size }, (_, i) => api('join', { code, seat: i + 1 })));
    assert.ok(players.every(p => p.status === 200));
    for (let round = 1; round <= 2; round++) {
      const state = round === 1 ? await api('state', { code }, host.token) : await api('redeal', { code, token: host.token });
      assert.equal(state.room.round, round);
      assert.deepEqual(state.room.roleCounts, roles);
      for (const [role, count] of Object.entries(roles)) {
        assert.equal(state.room.players.filter(p => p.role === role).length, count);
      }
      const player = await api('state', { code }, players[0].token);
      assert.ok(player.room.players.every(p => !p.role));
      assert.equal(player.room.self.role, state.room.players.find(p => p.seat === 1).role);
    }
  }
});

test('rejects invalid sizes, totals, roles and counts before allocating a room', async () => {
  const store = new MemoryStore();
  const api = client(store);
  for (const size of [5, 13, 6.5, null, 'no']) assert.equal((await api('create', { size })).status, 400);
  const invalid = [
    null, [], { 狼人: 2, 村民: 3 }, { 狼人: 2, 村民: 5 },
    { 狼人: 0, 村民: 6 }, { 狼人: 6 }, { 狼人: -1, 村民: 7 },
    { 狼人: 1.5, 村民: 4.5 }, { 狼人: '2', 村民: 4 },
    { 狼人: 2, 村民: 4, 守衛: null }, { 狼人: 2, 村民: 3, 未知角色: 1 },
  ];
  for (const roles of invalid) assert.equal((await api('create', { size: 6, roles })).status, 400);
  assert.equal(store.entries.size, 0);
});

test('existing rooms without a saved deck remain usable after deployment', async () => {
  const store = new MemoryStore();
  const api = client(store);
  const host = await api('create', { size: 6 });
  const current = await store.read(host.room.code);
  delete current.data.deck;
  await store.write(host.room.code, current.data, current.etag);
  for (let seat = 1; seat <= 6; seat++) await api('join', { code: host.room.code, seat });
  const redeal = await api('redeal', { code: host.room.code, token: host.token });
  assert.equal(redeal.room.phase, 'dealt');
  assert.deepEqual(redeal.room.players.map(p => p.role).sort(), createDeck(6).sort());
});
