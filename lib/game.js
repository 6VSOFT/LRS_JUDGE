import { randomUUID } from 'node:crypto';
import { wolfRoles } from './roles.js';

export const stages = [
  { label: '第 1 晚', type: 'night' },
  { label: '警長競選', type: 'election' },
  { label: '第 1 天', type: 'day' },
  ...Array.from({ length: 5 }, (_, i) => [
    { label: `第 ${i + 2} 晚`, type: 'night' },
    { label: `第 ${i + 2} 天`, type: 'day' },
  ]).flat(),
];
export const gameActions = ['stage', 'sheriff', 'night', 'settle-night', 'status', 'start-vote', 'end-vote', 'eliminate-vote', 'vote', 'nominate', 'inspect', 'potion', 'select-night'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export function resetGame(room) {
  room.players.forEach(p => { p.alive = true; });
  room.game = { step: 0, revision: 0, nightId: randomUUID(), sheriff: null, nights: {}, voting: null, history: [], inspections: {}, witches: {}, poisonDeaths: {} };
}
export function ensureGame(room) {
  if (room.phase !== 'dealt') return;
  if (!room.game) resetGame(room);
  room.game.nightId ??= `legacy:${room.round}:${room.game.step}`;
}
function tally(voting) {
  const counts = {};
  const sources = {}, abstainers = [];
  let abstentions = 0;
  for (const [voter, target] of Object.entries(voting.votes)) {
    if (target === null) { abstentions++; abstainers.push(Number(voter)); }
    else {
      counts[target] = (counts[target] || 0) + (voting.weights?.[voter] ?? 1);
      (sources[target] ??= []).push(Number(voter));
    }
  }
  const max = Math.max(0, ...Object.values(counts));
  return { counts, abstentions, sources, abstainers,
    unvoted: voting.eligible.filter(seat => !Object.hasOwn(voting.votes, seat)),
    leaders: Object.keys(counts).filter(seat => counts[seat] === max).map(Number) };
}
export function gameView(room, host = false, player = null) {
  if (!room.game || room.phase !== 'dealt') return null;
  const g = room.game, v = g.voting;
  const witch = player?.role === '女巫' ? g.witches?.[player.seat] || {} : null;
  const nightOpen = stages[g.step].type === 'night' && !g.nights[g.step]?.settled;
  const usedTonight = witch && [witch.heal, witch.poison].some(action => action?.step === g.step);
  const voting = v ? {
    id: v.id, status: v.status, kind: v.kind || 'exile', candidates: v.candidates || [], winner: v.winner ?? null, stage: v.stage, eligible: v.eligible, excluded: v.excluded || [],
    submitted: Object.keys(v.votes).map(Number), eliminated: v.eliminated ?? null,
    ...(host || v.status === 'ended' ? { ...tally(v), weights: v.weights || {} } : {}),
    ...(player && Object.hasOwn(v.votes, player.seat) ? { ownVote: v.votes[player.seat], ownWeight: v.weights?.[player.seat] ?? 1 } : {}),
  } : null;
  return { step: g.step, revision: g.revision, nightId: g.nightId, stage: stages[g.step], sheriff: g.sheriff, voting, nextVoteExcluded: nextVoteExcluded(v),
    ...(player?.role === '狼人' && player.alive !== false && stages[g.step].type === 'night' ? { wolfNight: {
      target: g.nights[g.step]?.target ?? null, settled: Boolean(g.nights[g.step]?.settled),
    } } : {}),
    ...(witch ? { witch: {
      healAvailable: !witch.heal, poisonAvailable: !witch.poison,
      canUse: player.alive !== false && nightOpen && !usedTonight,
      usedTonight: Boolean(usedTonight), heal: witch.heal || null, poison: witch.poison || null,
      ...(player.alive !== false && nightOpen && !witch.heal ? { knifeTarget: g.nights[g.step]?.target ?? null } : {}),
    } } : {}),
    ...(player?.role === '獵人' && player.alive === false && g.poisonDeaths?.[player.seat] ? { hunterPoisoned: g.poisonDeaths[player.seat] } : {}),
    ...(player?.role === '預言家' ? { seer: {
      canInspect: player.alive !== false && stages[g.step].type === 'night' && !g.nights[g.step]?.settled && !g.inspections?.[player.seat]?.[g.step],
      results: Object.values(g.inspections?.[player.seat] || {}).sort((a, b) => a.step - b.step),
    } } : {}),
    election: g.election ? { id: g.election.id, deadline: g.election.deadline, status: g.election.status, participants: g.election.participants, candidates: g.election.candidates,
      answered: Object.keys(g.election.answers).map(Number),
      ...(player && Object.hasOwn(g.election.answers, player.seat) ? { ownChoice: g.election.answers[player.seat] } : {}) } : null,
    ...(host ? { night: { ...(g.nights[g.step] || { target: null, settled: false }),
      healed: Object.values(g.witches || {}).filter(w => w.heal?.step === g.step).map(w => w.heal.target),
      poisoned: Object.values(g.witches || {}).filter(w => w.poison?.step === g.step).map(w => w.poison.target),
    }, history: g.history } : {}),
  };
}
function nextVoteExcluded(v) {
  if (v?.kind === 'sheriff') return [];
  if (v?.status === 'cancelled') return v.excluded || [];
  if (v?.status !== 'ended') return [];
  const { leaders } = tally(v);
  return leaders.length > 1 ? leaders : [];
}
function beginElection(room) {
  const g = room.game;
  g.sheriff = null;
  g.election = { id: randomUUID(), deadline: Date.now() + 15000, status: 'signup', participants: room.players.filter(p => p.alive).map(p => p.seat), answers: {}, candidates: [] };
}
function startSheriffVote(room, candidates) {
  const g = room.game, e = g.election;
  g.sheriff = null;
  const alive = room.players.filter(p => p.alive).map(p => p.seat);
  candidates = candidates.filter(seat => alive.includes(seat));
  const eligible = alive.filter(seat => !candidates.includes(seat));
  g.voting = { id: randomUUID(), kind: 'sheriff', stage: g.step, status: 'active', eligible, candidates, votes: {} };
  e.status = 'voting';
  if (!candidates.length || !eligible.length) finishSheriffVote(room);
}
function finishSheriffVote(room) {
  const g = room.game, v = g.voting;
  v.status = 'ended';
  const { leaders } = tally(v);
  if (leaders.length === 1) {
    v.winner = leaders[0]; g.sheriff = v.winner; g.election.status = 'ended';
    note(g, `${v.winner} 號自動當選警長，獲得警徽`);
  } else {
    g.election.status = leaders.length > 1 ? 'tie' : 'ended';
    note(g, leaders.length > 1 ? '警長投票平票，請安排重投' : '警長投票無有效結果，未授予警徽');
  }
}
// Deadlines are server-authoritative and persisted atomically on the next request.
export function advanceTimedGame(room) {
  const g = room.game, e = g?.election;
  if (!e || g.step !== 1 || e.status !== 'signup' || Date.now() < e.deadline) return false;
  for (const seat of e.participants) if (!Object.hasOwn(e.answers, seat)) e.answers[seat] = false;
  e.candidates = e.participants.filter(seat => e.answers[seat] && room.players.some(p => p.seat === seat && p.alive));
  startSheriffVote(room, e.candidates);
  g.revision++;
  note(g, '上警選擇結束，未回覆者預設不上警');
  return true;
}
function note(g, text) {
  g.history.unshift({ text, stage: stages[g.step].label, at: Date.now() });
  g.history = g.history.slice(0, 80);
}
function settle(room) {
  const g = room.game;
  const night = g.nights[g.step] || { target: null, settled: false };
  if (night.settled) return;
  const witches = Object.values(g.witches || {});
  const saved = witches.some(w => w.heal?.step === g.step && w.heal.target === night.target);
  if (night.target !== null && !saved) {
    const player = room.players.find(p => p.seat === night.target);
    player.alive = false;
    note(g, `${player.seat} 號夜間出局，已公布`);
  } else note(g, saved ? `${night.target} 號獲解藥豁免刀人` : '無刀人出局，已公布');
  for (const target of new Set(witches.filter(w => w.poison?.step === g.step).map(w => w.poison.target))) {
    const player = room.players.find(p => p.seat === target);
    player.alive = false;
    (g.poisonDeaths ??= {})[target] = { step: g.step };
    note(g, `${target} 號被毒殺出局，已公布`);
  }
  night.settled = true;
  g.nights[g.step] = night;
}
export function updateGame(room, action, body, token) {
  if (room.phase !== 'dealt') fail('滿員派牌後才能進行遊戲');
  ensureGame(room);
  const g = room.game, stage = stages[g.step];
  if (action === 'select-night') {
    const host = token === room.host;
    const player = room.players.find(p => p.token === token);
    if (!host && (!player?.alive || player.role !== '狼人')) fail('只有法官與存活狼人可選擇刀人目標', 403);
    if (body.round !== room.round || body.step !== g.step || body.nightId !== g.nightId || stage.type !== 'night' || g.nights[g.step]?.settled) fail('夜晚已結束或更新，請重新查看', 409);
    if (!Number.isInteger(body.seat) || !room.players.some(p => p.seat === body.seat && p.alive)) fail('請選擇一名存活玩家');
    // One shared scalar; CAS retries apply the last accepted choice, not a vote tally.
    g.nights[g.step] = { target: body.seat, settled: false };
    g.revision++;
    note(g, `${host ? '法官' : '狼人'}暫存夜間目標：${body.seat} 號`);
    return;
  }
  if (action === 'potion') {
    const p = room.players.find(p => p.token === token);
    if (!p?.alive || p.role !== '女巫') fail('只有存活的女巫可使用藥水', 403);
    if (body.round !== room.round || body.step !== g.step || body.revision !== g.revision || stage.type !== 'night' || g.nights[g.step]?.settled) fail('夜晚已結束或狀態更新，請重新查看', 409);
    if (!['heal', 'poison'].includes(body.kind)) fail('請選擇解藥或毒藥');
    const w = g.witches?.[p.seat] || {};
    if (w[body.kind]) fail('本局已使用此藥水', 409);
    if ([w.heal, w.poison].some(a => a?.step === g.step)) fail('同一晚只能使用一種藥水', 409);
    if (!Number.isInteger(body.target) || !room.players.some(other => other.seat === body.target && other.alive)) fail('請選擇存活玩家');
    if (body.kind === 'heal' && g.nights[g.step]?.target !== body.target) fail('刀人目標已變更，請重新查看', 409);
    w[body.kind] = { step: g.step, target: body.target };
    (g.witches ??= {})[p.seat] = w;
    // Invalidate in-flight host confirmations before night settlement.
    g.revision++;
    return;
  }
  if (action === 'inspect') {
    const p = room.players.find(p => p.token === token);
    if (!p?.alive || p.role !== '預言家') fail('只有存活的預言家可查驗', 403);
    if (body.round !== room.round || body.step !== g.step || body.revision !== g.revision || stage.type !== 'night' || g.nights[g.step]?.settled) fail('夜晚已結束或狀態更新，請重新查看', 409);
    if (g.inspections?.[p.seat]?.[g.step]) fail('本晚已查驗，不能再次使用', 409);
    const target = room.players.find(other => other.seat === body.target && other.alive && other.seat !== p.seat);
    if (!Number.isInteger(body.target) || !target) fail('請選擇其他存活玩家');
    const records = (g.inspections ??= {});
    (records[p.seat] ??= {})[g.step] = { step: g.step, target: target.seat, camp: wolfRoles.has(target.role) ? '狼人陣營' : '好人陣營' };
    return;
  }
  if (action === 'nominate') {
    const p = room.players.find(p => p.token === token), e = g.election;
    if (!p?.alive) fail('只有存活玩家可上警', 403);
    if (stage.type !== 'election' || !e || e.status !== 'signup' || Date.now() >= e.deadline || body.electionId !== e.id || body.round !== room.round) fail('上警選擇已結束或更新', 409);
    if (!e.participants.includes(p.seat)) fail('本次無上警資格', 403);
    if (typeof body.choice !== 'boolean') fail('請選擇是或否');
    if (Object.hasOwn(e.answers, p.seat)) fail('已提交上警選擇', 409);
    e.answers[p.seat] = body.choice;
    e.candidates = e.participants.filter(seat => e.answers[seat]);
    return;
  }
  if (action === 'vote') {
    const player = room.players.find(p => p.token === token);
    if (!player) fail('只有入座玩家可投票', 403);
    if (!player.alive) fail('已出局，僅可觀戰', 403);
    const v = g.voting;
    if (!v || v.status !== 'active' || v.id !== body.voteId || body.round !== room.round || (stage.type !== 'day' && !(stage.type === 'election' && v.kind === 'sheriff'))) fail('投票已結束或更新，請重新查看', 409);
    if (!v.eligible.includes(player.seat)) fail('本輪無投票資格', 403);
    if (Object.hasOwn(v.votes, player.seat)) fail('已提交投票，不能更改', 409);
    if (body.target !== null && (!Number.isInteger(body.target) || !room.players.some(p => p.seat === body.target && p.alive))) fail('請選擇存活玩家或棄權');
    if (v.kind === 'sheriff' && body.target !== null && !v.candidates.includes(body.target)) fail('只能投給上警候選人');
    if (body.sheriffPrivilege !== undefined && typeof body.sheriffPrivilege !== 'boolean') fail('無效警徽特權選擇');
    const privilege = v.kind !== 'sheriff' && g.sheriff === player.seat;
    if (body.sheriffPrivilege === true && !privilege) fail('本次沒有警徽特權', 403);
    (v.weights ??= {})[player.seat] = privilege && body.sheriffPrivilege !== false ? 1.5 : 1;
    v.votes[player.seat] = body.target;
    if (v.kind === 'sheriff' && Object.keys(v.votes).length === v.eligible.length) { finishSheriffVote(room); g.revision++; }
    return;
  }
  if (token !== room.host) fail('僅法官可操作', 403);
  if (body.round !== room.round || body.revision !== g.revision) fail('房間狀態已更新，請確認後重試', 409);
  const getPlayer = () => {
    const p = room.players.find(p => p.seat === body.seat);
    if (!p) fail('請選擇有效玩家');
    return p;
  };
  if (action === 'stage') {
    if (![1, -1].includes(body.direction)) fail('無效階段方向');
    if (g.voting?.status === 'active') fail('請先結束投票，再切換階段');
    if (g.election?.status === 'signup' && stage.type === 'election' && body.direction === 1) fail('請等待 15 秒上警選擇結束');
    const next = g.step + body.direction;
    if (next < 0 || next >= stages.length) fail('已到達流程邊界');
    if (body.direction === 1 && stage.type === 'night') settle(room);
    g.step = next;
    g.nightId = randomUUID();
    g.voting = null;
    if (next === 1) beginElection(room);
    note(g, body.direction === 1 ? '進入此階段' : '回退至此階段（保留玩家狀態）');
  } else if (action === 'sheriff') {
    if (stage.type === 'election' && ['signup', 'voting'].includes(g.election?.status)) fail('請先完成警長競選');
    if (body.seat !== null && !getPlayer().alive) fail('請選擇存活玩家擔任警長');
    if (g.sheriff !== body.seat && g.voting?.status === 'active') {
      g.voting.status = 'cancelled';
      note(g, '警徽變更，本輪投票作廢，請重新發起');
    }
    g.sheriff = body.seat;
    note(g, body.seat === null ? '收回警徽' : `${body.seat} 號獲得警徽`);
  } else if (action === 'night') {
    if (stage.type !== 'night') fail('僅夜間可設定刀人目標');
    if (g.nights[g.step]?.settled) fail('本晚已公布，請使用手動出局或恢復修正');
    if (body.seat !== null && !getPlayer().alive) fail('請選擇存活玩家');
    g.nights[g.step] = { target: body.seat, settled: false };
    note(g, body.seat === null ? '清空夜間目標，暫定平安夜' : `暫存夜間目標：${body.seat} 號`);
  } else if (action === 'settle-night') {
    if (stage.type !== 'night') fail('僅夜間可結算');
    if (g.nights[g.step]?.settled) fail('本晚已公布', 409);
    settle(room);
  } else if (action === 'status') {
    const p = getPlayer();
    if (typeof body.alive !== 'boolean') fail('無效存活狀態');
    p.alive = body.alive;
    if (p.alive && g.poisonDeaths) delete g.poisonDeaths[p.seat];
    if (g.voting?.status === 'active') {
      g.voting.status = 'cancelled';
      if (g.voting.kind === 'sheriff') g.election.status = 'cancelled';
      note(g, '玩家狀態變更，本輪投票作廢，請重新發起');
    }
    note(g, `${p.seat} 號手動${p.alive ? '恢復存活' : '出局'}`);
  } else if (action === 'start-vote') {
    if (stage.type === 'election' && g.election) {
      if (['signup', 'voting'].includes(g.election.status)) fail('警長競選正在進行', 409);
      const previous = g.voting?.kind === 'sheriff' ? g.voting : null;
      const leaders = previous?.status === 'ended' ? tally(previous).leaders : [];
      startSheriffVote(room, leaders.length > 1 ? leaders : previous?.candidates || g.election.candidates);
      g.revision++; return;
    }
    if (stage.type !== 'day') fail('僅白天放逐階段可發起投票');
    if (g.voting?.status === 'active') fail('已有投票進行中', 409);
    const excluded = nextVoteExcluded(g.voting);
    const eligible = room.players.filter(p => p.alive && !excluded.includes(p.seat)).map(p => p.seat);
    if (!eligible.length) fail('沒有具投票資格的存活玩家，請由法官手動處理或進入下一階段');
    g.voting = { id: randomUUID(), stage: g.step, status: 'active', eligible, excluded, votes: {} };
    note(g, '發起全員放逐投票');
  } else if (action === 'end-vote') {
    if (g.voting?.status !== 'active') fail('沒有進行中的投票', 409);
    if (g.voting.kind === 'sheriff') { finishSheriffVote(room); g.revision++; return; }
    g.voting.status = 'ended';
    const result = tally(g.voting);
    note(g, result.leaders.length ? `投票結束，最高票：${result.leaders.join('、')} 號` : '投票結束，無有效得票');
  } else if (action === 'eliminate-vote') {
    const v = g.voting;
    if (v?.kind === 'sheriff') fail('警長投票不淘汰玩家');
    if (v?.status !== 'ended' || v.eliminated != null) fail('沒有可執行的投票結果', 409);
    const { leaders } = tally(v);
    if (leaders.length !== 1) fail('平票或無有效票，請重新投票或由法官手動處理');
    const p = room.players.find(p => p.seat === leaders[0]);
    if (!p.alive) fail('該玩家已出局');
    p.alive = false;
    v.eliminated = p.seat;
    note(g, `${p.seat} 號經投票確認出局`);
  } else fail('無效遊戲操作');
  g.revision++;
}
