import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from './lib/rooms.js';
import { MemoryStore } from './lib/memory-store.js';
import { stages } from './lib/game.js';

async function fixture() {
  const store = new MemoryStore();
  const api = async (action, body = {}, token = '') => {
    const read = ['state', 'lookup'].includes(action);
    const r = await handleRequest(new Request(`http://test/api/${action}${read ? '?code=' + body.code : ''}`, {
      method: read ? 'GET' : 'POST', headers: { Authorization: token },
      ...(read ? {} : { body: JSON.stringify(body) }),
    }), store);
    return { status: r.status, ...await r.json() };
  };
  const host = await api('create', { size: 6 });
  const code = host.room.code;
  const players = [];
  for (let seat = 1; seat <= 6; seat++) players.push(await api('join', { code, seat, name: `玩家 ${seat}` }));
  const state = token => api('state', { code }, token || host.token);
  const act = async (action, extra = {}) => {
    const s = await state();
    return api(action, { code, token: host.token, round: s.room.round, revision: s.room.game.revision, ...extra });
  };
  const day = async () => { await act('stage', { direction: 1 }); await act('stage', { direction: 1 }); };
  const vote = async (seat, target, id) => {
    const s = await state();
    return api('vote', { code, token: players[seat - 1].token, round: s.room.round, voteId: id ?? s.room.game.voting.id, target });
  };
  return { api, code, host, players, state, act, day, vote };
}

test('13-stage flow, election, bounds and stale host commands are enforced', async () => {
  const f = await fixture();
  assert.equal((await f.act('stage', { direction: -1 })).status, 400);
  assert.equal((await f.act('start-vote')).status, 400);
  let s = await f.state();
  const command = { code: f.code, token: f.host.token, round: 1, revision: s.room.game.revision, direction: 1 };
  const race = await Promise.all([f.api('stage', command), f.api('stage', command)]);
  assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
  assert.equal((await f.state()).room.game.stage.type, 'election');
  assert.equal((await f.act('start-vote')).status, 400);
  assert.equal((await f.act('sheriff', { seat: 3 })).room.game.sheriff, 3);
  for (let step = 2; step < 13; step++) {
    s = await f.act('stage', { direction: 1 });
    assert.equal(s.room.game.step, step);
    assert.deepEqual(s.room.game.stage, stages[step]);
  }
  assert.equal((await f.act('stage', { direction: 1 })).status, 400);
  assert.equal((await f.act('stage', { direction: -1 })).room.game.step, 11);
  const denied = await f.api('status', { code: f.code, token: f.players[0].token, round: 1, revision: 0, seat: 2, alive: false });
  assert.equal(denied.status, 403);
});

test('night targets stay private, clearing saves players, settling is applied once', async () => {
  const f = await fixture();
  let h = await f.act('night', { seat: 4 });
  assert.equal(h.room.game.night.target, 4);
  for (const response of [await f.state(f.players[0].token), await f.api('lookup', { code: f.code })]) {
    assert.ok(!Object.hasOwn(response.room.game, 'night'));
    assert.ok(!Object.hasOwn(response.room.game, 'history'));
    assert.equal(response.room.players[3].alive, true);
    assert.ok(response.room.players.every(p => !p.role));
  }
  await f.act('night', { seat: null });
  await f.act('stage', { direction: 1 });
  assert.equal((await f.state()).room.players[3].alive, true);
  await f.act('stage', { direction: -1 });
  assert.equal((await f.act('night', { seat: 4 })).status, 400);
  await f.act('stage', { direction: 1 });
  await f.act('stage', { direction: 1 });
  await f.act('stage', { direction: 1 });
  await f.act('night', { seat: 4 });
  h = await f.act('settle-night');
  assert.equal(h.room.players[3].alive, false);
  assert.equal((await f.act('settle-night')).status, 409);
  await f.act('status', { seat: 4, alive: true });
  h = await f.act('stage', { direction: 1 });
  assert.equal(h.room.players[3].alive, true);
});

test('votes are immutable, private until ended, counted with abstentions and confirmed separately', async () => {
  const f = await fixture();
  await f.day();
  await f.act('start-vote');
  assert.equal((await f.act('stage', { direction: 1 })).status, 400);
  assert.equal((await f.vote(1, 1)).status, 200); // Self voting is allowed.
  assert.equal((await f.vote(1, 2)).status, 409);
  const votes = await Promise.all([f.vote(2, 1), f.vote(3, 1), f.vote(4, null), f.vote(5, 2), f.vote(6, null)]);
  assert.ok(votes.every(v => v.status === 200));
  const player = await f.state(f.players[0].token);
  assert.equal(player.room.game.voting.ownVote, 1);
  assert.equal(player.room.game.voting.counts, undefined);
  assert.equal(player.room.game.voting.sources, undefined);
  assert.equal((await f.api('lookup', { code: f.code })).room.game.voting.sources, undefined);
  let host = await f.state();
  assert.equal(host.room.game.voting.counts[1], 3);
  assert.deepEqual(host.room.game.voting.sources, { 1: [1, 2, 3], 2: [5] });
  assert.deepEqual(host.room.game.voting.abstainers, [4, 6]);
  assert.equal(host.room.game.voting.submitted.length, 6);
  const result = await f.act('end-vote');
  assert.deepEqual(result.room.game.voting.leaders, [1]);
  assert.equal(result.room.game.voting.abstentions, 2);
  assert.deepEqual((await f.state(f.players[0].token)).room.game.voting.sources, { 1: [1, 2, 3], 2: [5] });
  assert.equal(result.room.players[0].alive, true);
  assert.equal((await f.act('eliminate-vote')).room.players[0].alive, false);
  assert.equal((await f.act('eliminate-vote')).status, 409);
  await f.act('start-vote');
  assert.equal((await f.vote(1, 2)).status, 403);
  assert.equal((await f.vote(2, 1)).status, 400);
});

test('tie, no-vote, stale ballots, overrides, recovery and redeal are safe', async () => {
  const f = await fixture();
  await f.day();
  await f.act('start-vote');
  const oldId = (await f.state()).room.game.voting.id;
  await f.vote(1, 2); await f.vote(2, 1);
  assert.deepEqual((await f.state()).room.game.voting.unvoted, [3, 4, 5, 6]);
  assert.deepEqual((await f.act('end-vote')).room.game.voting.leaders, [1, 2]);
  assert.equal((await f.act('eliminate-vote')).status, 400);
  await f.act('start-vote');
  assert.equal((await f.vote(3, 1, oldId)).status, 409);
  await f.act('end-vote');
  assert.equal((await f.act('eliminate-vote')).status, 400);
  await f.act('start-vote');
  assert.equal((await f.act('status', { seat: 3, alive: false })).room.game.voting.status, 'cancelled');
  assert.equal((await f.vote(2, 1)).status, 409);
  await f.act('status', { seat: 3, alive: true });
  await f.act('sheriff', { seat: 3 });
  await f.act('start-vote');
  await f.vote(3, null);
  assert.equal((await f.state(f.players[2].token)).room.game.voting.ownVote, null);
  const old = (await f.state()).room;
  const redeal = await f.api('redeal', { code: f.code, token: f.host.token });
  assert.equal(redeal.room.game.step, 0);
  assert.equal(redeal.room.game.sheriff, null);
  assert.equal(redeal.room.game.voting, null);
  assert.ok(redeal.room.players.every(p => p.alive && p.name));
  assert.equal((await f.api('stage', { code: f.code, token: f.host.token, round: old.round, revision: old.game.revision, direction: 1 })).status, 409);
});
