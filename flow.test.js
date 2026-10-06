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
  const expireElection = async () => {
    const current = await store.read(code);
    current.data.game.election.deadline = Date.now() - 1;
    await store.write(code, current.data, current.etag);
    return state();
  };
  const day = async () => { await act('stage', { direction: 1 }); await expireElection(); await act('stage', { direction: 1 }); };
  const nominate = async (seat, choice, electionId) => {
    const s = await state();
    return api('nominate', { code, token: players[seat - 1].token, round: s.room.round, electionId: electionId ?? s.room.game.election.id, choice });
  };
  const vote = async (seat, target, id) => {
    const s = await state();
    return api('vote', { code, token: players[seat - 1].token, round: s.room.round, voteId: id ?? s.room.game.voting.id, target });
  };
  return { api, code, host, players, state, act, day, vote, expireElection, nominate };
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
  assert.equal((await f.act('start-vote')).status, 409);
  await f.expireElection();
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
  await f.expireElection();
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

test('highest tied players lose only the next revote ballot, remain targets, and survive recovery/cancellation', async () => {
  const f = await fixture();
  await f.day(); await f.act('start-vote');
  await f.vote(3, 1); await f.vote(4, 2);
  const ended = await f.act('end-vote');
  assert.deepEqual(ended.room.game.nextVoteExcluded, [1, 2]);
  const next = await f.act('start-vote');
  assert.deepEqual(next.room.game.voting.eligible, [3, 4, 5, 6]);
  assert.deepEqual(next.room.game.voting.excluded, [1, 2]);
  assert.equal((await f.vote(1, 3)).status, 403);
  assert.equal((await f.vote(2, null)).status, 403);
  assert.deepEqual((await f.state(f.players[0].token)).room.game.voting.excluded, [1, 2]);
  assert.equal((await f.vote(3, 1)).status, 200);
  await f.act('status', { seat: 6, alive: false });
  const restarted = await f.act('start-vote');
  assert.deepEqual(restarted.room.game.voting.eligible, [3, 4, 5]);
  await f.vote(3, 1); await f.act('end-vote');
  assert.deepEqual((await f.act('start-vote')).room.game.voting.eligible, [1, 2, 3, 4, 5]);
  await f.vote(3, 1); await f.vote(4, 2); await f.act('end-vote');
  await f.act('stage', { direction: 1 }); await f.act('stage', { direction: 1 });
  assert.deepEqual((await f.act('start-vote')).room.game.voting.eligible, [1, 2, 3, 4, 5]);
});

test('repeated ties replace excluded seats and all-tied or zero-vote rounds are handled', async () => {
  const f = await fixture();
  await f.day(); await f.act('start-vote');
  await f.vote(1, 1); await f.vote(2, 2); await f.act('end-vote');
  await f.act('start-vote');
  await f.vote(3, 3); await f.vote(4, 4); await f.act('end-vote');
  assert.deepEqual((await f.act('start-vote')).room.game.voting.eligible, [1, 2, 5, 6]);
  await f.act('end-vote');
  assert.deepEqual((await f.act('start-vote')).room.game.voting.eligible, [1, 2, 3, 4, 5, 6]);
  for (let seat = 1; seat <= 6; seat++) await f.vote(seat, seat);
  await f.act('end-vote');
  assert.equal((await f.act('start-vote')).status, 400);
});

test('sheriff signup has one server deadline, defaults no, and awards a unique winner automatically', async () => {
  const f = await fixture();
  const started = await f.act('stage', { direction: 1 });
  const e = started.room.game.election;
  assert.ok(e.deadline - started.serverTime > 9900 && e.deadline - started.serverTime <= 10000);
  assert.equal((await f.act('stage', { direction: 1 })).status, 400);
  assert.equal((await f.act('sheriff', { seat: 1 })).status, 400);
  assert.equal((await f.nominate(1, true)).status, 200);
  assert.equal((await f.nominate(1, false)).status, 409);
  assert.equal((await f.nominate(2, true)).status, 200);
  assert.equal((await f.nominate(3, false)).status, 200);
  assert.equal((await f.nominate(4, 'yes')).status, 400);
  const recovered = (await f.state(f.players[0].token)).room.game.election;
  assert.equal(recovered.deadline, e.deadline);
  assert.equal(recovered.ownChoice, true);
  assert.equal(recovered.answers, undefined);
  const expired = await f.expireElection();
  assert.deepEqual(expired.room.game.voting.eligible, [3, 4, 5, 6]);
  assert.deepEqual(expired.room.game.voting.candidates, [1, 2]);
  assert.equal((await f.state(f.players[5].token)).room.game.election.ownChoice, false);
  assert.equal((await f.nominate(6, true)).status, 409);
  const reads = await Promise.all(Array.from({ length: 8 }, () => f.state()));
  assert.ok(reads.every(r => r.room.game.voting.id === expired.room.game.voting.id));
  assert.equal((await f.vote(1, 2)).status, 403);
  assert.equal((await f.vote(3, 4)).status, 400);
  assert.equal((await f.vote(3, 1)).status, 200);
  assert.equal((await f.vote(3, 2)).status, 409);
  assert.equal((await f.state(f.players[3].token)).room.game.voting.sources, undefined);
  await Promise.all([f.vote(4, 1), f.vote(5, 2), f.vote(6, null)]);
  const result = (await f.state()).room;
  assert.equal(result.game.voting.status, 'ended');
  assert.equal(result.game.sheriff, 1);
  assert.equal(result.game.voting.winner, 1);
  assert.deepEqual(result.game.voting.sources, { 1: [3, 4], 2: [5] });
  assert.ok(result.players.every(p => p.alive));
  assert.equal((await f.act('eliminate-vote')).status, 400);
  assert.equal((await f.state(f.players[5].token)).room.game.sheriff, 1);
  assert.equal((await f.act('stage', { direction: 1 })).room.game.step, 2);
});

test('sheriff ties, no candidates, all candidates and all abstentions never assign an arbitrary badge', async () => {
  for (const count of [0, 6]) {
    const f = await fixture();
    await f.act('stage', { direction: 1 });
    for (let seat = 1; seat <= count; seat++) await f.nominate(seat, true);
    const r = await f.expireElection();
    assert.equal(r.room.game.sheriff, null);
    assert.equal(r.room.game.voting.status, 'ended');
    assert.equal((await f.act('stage', { direction: 1 })).status, 200);
  }
  const f = await fixture();
  await f.act('stage', { direction: 1 });
  for (const seat of [1, 2, 3]) await f.nominate(seat, true);
  await f.expireElection();
  await f.vote(4, 1); await f.vote(5, 2); await f.vote(6, null);
  assert.equal((await f.state()).room.game.election.status, 'tie');
  const retry = await f.act('start-vote');
  assert.equal(retry.room.game.sheriff, null);
  assert.deepEqual(retry.room.game.voting.candidates, [1, 2]);
  assert.deepEqual(retry.room.game.voting.eligible, [4, 5, 6]);
  assert.equal((await f.vote(3, 1)).status, 403);
  assert.equal((await f.vote(4, 3)).status, 400);
  await f.vote(4, null); await f.vote(5, null); await f.vote(6, null);
  assert.equal((await f.state()).room.game.sheriff, null);
  await f.act('start-vote'); await f.vote(4, 2);
  assert.equal((await f.act('end-vote')).room.game.sheriff, 2);
});

test('sheriff election handles dead players, cancellation, reentry and stale nominations', async () => {
  const f = await fixture();
  await f.act('status', { seat: 6, alive: false });
  await f.act('stage', { direction: 1 });
  const oldId = (await f.state()).room.game.election.id;
  assert.equal((await f.nominate(6, true)).status, 403);
  await f.nominate(1, true); await f.nominate(2, true);
  await f.expireElection();
  await f.vote(3, 1); await f.vote(4, 2);
  await f.act('status', { seat: 2, alive: false });
  assert.equal((await f.state()).room.game.election.status, 'cancelled');
  const restarted = await f.act('start-vote');
  assert.deepEqual(restarted.room.game.voting.candidates, [1]);
  assert.deepEqual(restarted.room.game.voting.eligible, [3, 4, 5]);
  await f.act('end-vote');
  await f.act('stage', { direction: -1 }); await f.act('stage', { direction: 1 });
  assert.notEqual((await f.state()).room.game.election.id, oldId);
  assert.equal((await f.nominate(3, true, oldId)).status, 409);
  const redeal = await f.api('redeal', { code: f.code, token: f.host.token });
  assert.equal(redeal.room.game.election, null);
});
