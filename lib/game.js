import { randomUUID } from 'node:crypto';

export const stages = [
  { label: '第 1 晚', type: 'night' },
  { label: '警長競選', type: 'election' },
  { label: '第 1 天', type: 'day' },
  ...Array.from({ length: 5 }, (_, i) => [
    { label: `第 ${i + 2} 晚`, type: 'night' },
    { label: `第 ${i + 2} 天`, type: 'day' },
  ]).flat(),
];
export const gameActions = ['stage', 'sheriff', 'night', 'settle-night', 'status', 'start-vote', 'end-vote', 'eliminate-vote', 'vote'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export function resetGame(room) {
  room.players.forEach(p => { p.alive = true; });
  room.game = { step: 0, revision: 0, sheriff: null, nights: {}, voting: null, history: [] };
}
export function ensureGame(room) {
  if (room.phase !== 'dealt') return;
  if (!room.game) resetGame(room);
}
function tally(voting) {
  const counts = {};
  const sources = {}, abstainers = [];
  let abstentions = 0;
  for (const [voter, target] of Object.entries(voting.votes)) {
    if (target === null) { abstentions++; abstainers.push(Number(voter)); }
    else {
      counts[target] = (counts[target] || 0) + 1;
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
  const voting = v ? {
    id: v.id, status: v.status, stage: v.stage, eligible: v.eligible,
    submitted: Object.keys(v.votes).map(Number), eliminated: v.eliminated ?? null,
    ...(host || v.status === 'ended' ? tally(v) : {}),
    ...(player && Object.hasOwn(v.votes, player.seat) ? { ownVote: v.votes[player.seat] } : {}),
  } : null;
  return { step: g.step, revision: g.revision, stage: stages[g.step], sheriff: g.sheriff, voting,
    ...(host ? { night: g.nights[g.step] || { target: null, settled: false }, history: g.history } : {}),
  };
}
function note(g, text) {
  g.history.unshift({ text, stage: stages[g.step].label, at: Date.now() });
  g.history = g.history.slice(0, 80);
}
function settle(room) {
  const g = room.game;
  const night = g.nights[g.step] || { target: null, settled: false };
  if (night.settled) return;
  if (night.target !== null) {
    const player = room.players.find(p => p.seat === night.target);
    player.alive = false;
    note(g, `${player.seat} 號夜間出局，已公布`);
  } else note(g, '平安夜，已公布');
  night.settled = true;
  g.nights[g.step] = night;
}
export function updateGame(room, action, body, token) {
  if (room.phase !== 'dealt') fail('滿員派牌後才能進行遊戲');
  ensureGame(room);
  const g = room.game, stage = stages[g.step];
  if (action === 'vote') {
    const player = room.players.find(p => p.token === token);
    if (!player) fail('只有入座玩家可投票', 403);
    if (!player.alive) fail('已出局，僅可觀戰', 403);
    const v = g.voting;
    if (!v || v.status !== 'active' || v.id !== body.voteId || body.round !== room.round || stage.type !== 'day') fail('投票已結束或更新，請重新查看', 409);
    if (!v.eligible.includes(player.seat)) fail('本輪無投票資格', 403);
    if (Object.hasOwn(v.votes, player.seat)) fail('已提交投票，不能更改', 409);
    if (body.target !== null && (!Number.isInteger(body.target) || !room.players.some(p => p.seat === body.target && p.alive))) fail('請選擇存活玩家或棄權');
    v.votes[player.seat] = body.target;
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
    const next = g.step + body.direction;
    if (next < 0 || next >= stages.length) fail('已到達流程邊界');
    if (body.direction === 1 && stage.type === 'night') settle(room);
    g.step = next;
    g.voting = null;
    note(g, body.direction === 1 ? '進入此階段' : '回退至此階段（保留玩家狀態）');
  } else if (action === 'sheriff') {
    if (body.seat !== null && !getPlayer().alive) fail('請選擇存活玩家擔任警長');
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
    if (g.voting?.status === 'active') {
      g.voting.status = 'cancelled';
      note(g, '玩家狀態變更，本輪投票作廢，請重新發起');
    }
    note(g, `${p.seat} 號手動${p.alive ? '恢復存活' : '出局'}`);
  } else if (action === 'start-vote') {
    if (stage.type !== 'day') fail('僅白天放逐階段可發起投票');
    if (g.voting?.status === 'active') fail('已有投票進行中', 409);
    const eligible = room.players.filter(p => p.alive).map(p => p.seat);
    if (!eligible.length) fail('沒有存活玩家可投票');
    g.voting = { id: randomUUID(), stage: g.step, status: 'active', eligible, votes: {} };
    note(g, '發起全員放逐投票');
  } else if (action === 'end-vote') {
    if (g.voting?.status !== 'active') fail('沒有進行中的投票', 409);
    g.voting.status = 'ended';
    const result = tally(g.voting);
    note(g, result.leaders.length ? `投票結束，最高票：${result.leaders.join('、')} 號` : '投票結束，無有效得票');
  } else if (action === 'eliminate-vote') {
    const v = g.voting;
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
