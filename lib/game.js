import { randomUUID } from 'node:crypto';
import { wolfRoles } from './roles.js';

const shootingRoles = new Set(['獵人', '狼王']);
const wolfTeamViewers = new Set(['狼人', '狼王', '白狼王', '狼美人', '血月使徒']);

export const stages = [
  { label: '第 1 晚', type: 'night' },
  { label: '警長競選', type: 'election' },
  { label: '第 1 天', type: 'day' },
  ...Array.from({ length: 5 }, (_, i) => [
    { label: `第 ${i + 2} 晚`, type: 'night' },
    { label: `第 ${i + 2} 天`, type: 'day' },
  ]).flat(),
];
// The original 13 phases remain stable; later rounds continue the same day/night sequence.
export function stageAt(step) {
  return stages[step] ?? { label: `第 ${Math.floor((step + 1) / 2)} ${step % 2 ? '晚' : '天'}`, type: step % 2 ? 'night' : 'day' };
}
function previousNightStep(step) {
  if (step <= 2) return step === 0 ? -1 : 0;
  return step % 2 ? (step === 3 ? 0 : step - 2) : step - 1;
}
function nextNightStep(step) { return step <= 2 ? 3 : step + (step % 2 ? 2 : 1); }
export const gameActions = ['stage', 'sheriff', 'night', 'settle-night', 'status', 'start-vote', 'end-vote', 'eliminate-vote', 'vote', 'nominate', 'inspect', 'inspect-role', 'potion', 'select-night', 'reveal-idiot', 'guard', 'shoot', 'duel', 'explode', 'swap', 'dream', 'mechanical', 'fear', 'self-explode', 'hunt'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export function resetGame(room) {
  room.players.forEach(p => { p.alive = true; });
  room.game = { step: 0, revision: 0, nightId: randomUUID(), sheriff: null, nights: {}, voting: null, history: [], inspections: {}, gargoyleInspections: {}, exiles: {}, mechanical: {}, witches: {}, poisonDeaths: {}, revealedIdiots: [], guards: {}, deaths: {}, hunterShots: {}, duels: {}, explosions: {}, swaps: {}, nightActionsStarted: {}, dreams: {}, fears: {}, selfExplosions: {}, hunts: {} };
}
export function ensureGame(room) {
  if (room.phase !== 'dealt') return;
  if (!room.game) resetGame(room);
  room.game.nightId ??= `legacy:${room.round}:${room.game.step}`;
}
// Number cards redirect actions for this night only; player identity/seat never moves.
function nightSeat(g, seat, step = g.step) {
  if (seat == null || stageAt(step)?.type !== 'night') return seat;
  for (const records of Object.values(g.swaps || {})) {
    const pair = records[step]?.targets;
    if (pair?.includes(seat)) return pair.find(n => n !== seat);
  }
  return seat;
}
function swappedSeats(g) {
  return Object.values(g.swaps || {}).flatMap(records => Object.values(records).flatMap(r => r.targets));
}
function nightActionsStarted(g, includeLearning = true) {
  return Boolean(g.nightActionsStarted?.[g.step] ||
    Object.values(g.mechanical || {}).some(m => (includeLearning && m.learn?.step === g.step) || m.inspections?.[g.step] || m.guards?.[g.step] || m.poison?.step === g.step || m.knife?.step === g.step) || g.nights[g.step]?.target != null ||
    Object.values(g.inspections || {}).some(r => r[g.step]) ||
    Object.values(g.gargoyleInspections || {}).some(r => r[g.step]) ||
    Object.values(g.guards || {}).some(r => r[g.step]) ||
    Object.values(g.dreams || {}).some(r => r[g.step]) ||
    Object.values(g.hunts || {}).some(r => r[g.step]) ||
    Object.values(g.witches || {}).some(w => [w.heal, w.poison].some(a => a?.step === g.step)));
}
// Fear is resolved before number swaps and freezes the physical player, not a number card.
function fearRecords(g, step = g.step) {
  return Object.entries(g.fears || {}).flatMap(([caster, records]) => records[step] ? [{ caster: Number(caster), target: records[step].target }] : []);
}
function fearedGod(room, player, step = room.game.step) {
  return Boolean(player && stageAt(step)?.type === 'night' && player.role !== '村民' && !wolfRoles.has(player.role) && fearRecords(room.game, step).some(r => r.target === player.seat));
}
function missingFears(room) {
  return room.players.filter(p => p.alive && p.role === '夢魘' && !room.game.fears?.[p.seat]?.[room.game.step] && room.players.some(other => other.alive && other.seat !== p.seat)).map(p => p.seat);
}
function noKnives(room) {
  return fearRecords(room.game).some(r => wolfRoles.has(room.players.find(p => p.seat === r.target)?.role));
}
function requireFears(room) {
  if (missingFears(room).length) fail('請等待夢魘先完成恐懼，再進行夜間行動', 409);
}
function gunFeared(room, player) {
  const death = room.game.deaths?.[player?.seat];
  return fearedGod(room, player) || (death && ['knife','milk'].includes(death.cause) && fearedGod(room, player, death.step));
}
function hasGun(player, g) {
  return shootingRoles.has(player?.role) || (player?.role === '機械狼' && g.mechanical?.[player.seat]?.learn?.role === '獵人');
}
function mechanicalShields(g) {
  return new Set(Object.values(g.mechanical || {}).flatMap(m => m.guards?.[g.step] ? [nightSeat(g, m.guards[g.step].target)] : []));
}
function mechanicalView(room, player) {
  const g = room.game, m = g.mechanical?.[player.seat] || {}, learn = m.learn || null;
  const open = player.alive !== false && stageAt(g.step).type === 'night' && !g.nights[g.step]?.settled;
  const ready = open && learn && g.step > learn.step;
  return { learn, canLearn: open && !learn && !nightActionsStarted(g, false),
    canInspect: Boolean(ready && learn.role === '通靈師' && !m.inspections?.[g.step]),
    canPoison: Boolean(ready && learn.role === '女巫' && !m.poison),
    canGuard: Boolean(ready && learn.role === '守衛' && !m.guards?.[g.step]),
    canKnife: Boolean(ready && learn.role === '狼人' && !m.knife),
    poison: m.poison || null, knife: m.knife || null, guardTarget: m.guards?.[g.step]?.target ?? null,
    results: Object.values(m.inspections || {}).sort((a,b) => a.step-b.step) };
}
function dreamLinks(room) {
  const g = room.game;
  if (stageAt(g.step).type !== 'night') return [];
  return Object.entries(g.dreams || {}).flatMap(([caster, records]) => {
    const r = records[g.step];
    return r && !fearedGod(room, room.players.find(p => p.seat === Number(caster))) ? [{ caster: Number(caster), target: r.resolvedTarget ?? nightSeat(g, r.target) }] : [];
  });
}
function missingDreams(room) {
  return room.players.filter(p => p.alive && p.role === '攝夢人' && !fearedGod(room, p) && !room.game.dreams?.[p.seat]?.[room.game.step] && room.players.some(other => other.alive && other.seat !== p.seat)).map(p => p.seat);
}
function requireDreams(room) {
  if (missingDreams(room).length) fail('存活攝夢人尚未選擇夢遊者，請先完成攝夢', 409);
}
function extendDreamDeaths(room, deaths, consecutive = true) {
  const g = room.game, links = dreamLinks(room), shields = mechanicalShields(g);
  if (consecutive) {
    const previous = previousNightStep(g.step);
    for (const link of links) {
      const before = g.dreams?.[link.caster]?.[previous];
      if (!shields.has(link.target) && before && (before.resolvedTarget ?? nightSeat(g, before.target, previous)) === link.target) deaths.set(link.target, 'dream');
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const { caster, target } of links) {
      const deadTonight = deaths.has(caster) || (room.players.find(p => p.seat === caster)?.alive === false && g.deaths?.[caster]?.step === g.step);
      if (deadTonight && !shields.has(target) && !['dream', 'dream-link'].includes(deaths.get(target))) { deaths.set(target, 'dream-link'); changed = true; }
    }
  }
  return deaths;
}
function nightPlan(room) {
  const g = room.game, night = g.nights[g.step] || { target: null }, deaths = new Map();
  const dreams = new Set(dreamLinks(room).map(r => r.target)), shields = mechanicalShields(g);
  const knives = noKnives(room) ? [] : [night.target, ...Object.values(g.mechanical || {}).filter(m => m.knife?.step === g.step).map(m => m.knife.target)];
  for (const selected of knives) {
    const knife = nightSeat(g, selected);
    const saved = Object.entries(g.witches || {}).some(([seat,w]) => !fearedGod(room, room.players.find(p => p.seat === Number(seat))) && w.heal?.step === g.step && nightSeat(g, w.heal.target) === knife);
    const guarded = Object.entries(g.guards || {}).some(([seat,r]) => !fearedGod(room, room.players.find(p => p.seat === Number(seat))) && r[g.step] && nightSeat(g, r[g.step].target) === knife);
    if (knife != null && !dreams.has(knife) && !shields.has(knife) && ((!saved && !guarded) || (saved && guarded))) deaths.set(knife, saved && guarded ? 'milk' : 'knife');
  }
  for (const [caster,records] of Object.entries(g.hunts || {})) {
    const hunter = room.players.find(p => p.seat === Number(caster)), hunt = records[g.step];
    if (!hunt || fearedGod(room, hunter)) continue;
    const target = hunt.resolvedTarget ?? nightSeat(g, hunt.target);
    if (wolfRoles.has(room.players.find(p => p.seat === target)?.role)) {
      if (!dreams.has(target) && !shields.has(target)) deaths.set(target, 'hunt');
    } else deaths.set(Number(caster), 'hunt-backfire');
  }
  for (const [seat,w] of Object.entries(g.witches || {})) if (!fearedGod(room, room.players.find(p => p.seat === Number(seat))) && w.poison?.step === g.step) {
    const target = nightSeat(g, w.poison.target);
    if (room.players.find(p => p.seat === target)?.role !== '獵魔人' && !dreams.has(target) && !shields.has(target)) deaths.set(target, 'poison');
  }
  for (const m of Object.values(g.mechanical || {})) if (m.poison?.step === g.step) {
    const target = nightSeat(g, m.poison.target);
    if (!dreams.has(target)) deaths.set(target, 'poison');
  }
  return extendDreamDeaths(room, deaths);
}

function applyNightDeaths(room, deaths) {
  const g = room.game;
  for (const [seat, cause] of deaths) {
    const p = room.players.find(p => p.seat === seat);
    if (p.alive || (['dream', 'dream-link'].includes(cause) && (g.deaths?.[seat]?.cause !== cause || g.deaths?.[seat]?.step !== g.step))) {
      p.alive = false;
      (g.deaths ??= {})[seat] = { cause, step: g.step };
      if (cause === 'poison') (g.poisonDeaths ??= {})[seat] = { step: g.step };
      if (['dream', 'dream-link'].includes(cause) && g.poisonDeaths) delete g.poisonDeaths[seat];
      note(g, seat + ' 號' + ({ knife:'夜間', milk:'奶穿', poison:'被毒殺', hunt:'被狩獵', 'hunt-backfire':'狩獵好人反噬', dream:'連續攝夢', 'dream-link':'攝夢殉葬' }[cause] || '') + '出局，已公布');
    }
  }
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
// Public exile outcomes are tied to the preceding day, never to night number swaps.
function gravekeeperView(room, player) {
  const g = room.game;
  if (player.alive === false) return { status: 'out', results: [] };
  if (stageAt(g.step).type !== 'night') return { status: 'day', results: [] };
  if (g.step === 0) return { status: 'first-night', results: [] };
  const day = g.step - 1;
  // Legacy rooms can recover surviving exile records, without exposing exact roles.
  const results = g.exiles?.[day] ?? room.players.filter(p => g.deaths?.[p.seat]?.cause === 'exile' && g.deaths[p.seat].step === day)
    .map(p => ({ seat: p.seat, camp: wolfRoles.has(p.role) ? '狼人陣營' : '好人陣營' }));
  return { status: results.length ? 'result' : 'no-exile', results };
}
export function gameView(room, host = false, player = null) {
  if (!room.game || room.phase !== 'dealt') return null;
  const g = room.game, v = g.voting;
  const witch = player?.role === '女巫' ? g.witches?.[player.seat] || {} : null;
  const nightOpen = stageAt(g.step).type === 'night' && !g.nights[g.step]?.settled;
  const guardRecords = player?.role === '守衛' ? g.guards?.[player.seat] || {} : null;
  const previousNight = previousNightStep(g.step);
  const nextNight = nextNightStep(g.step);
  const usedTonight = witch && [witch.heal, witch.poison].some(action => action?.step === g.step);
  const voting = v ? {
    id: v.id, status: v.status, kind: v.kind || 'exile', candidates: v.candidates || [], winner: v.winner ?? null, stage: v.stage, eligible: v.eligible, excluded: v.excluded || [],
    submitted: Object.keys(v.votes).map(Number), eliminated: v.eliminated ?? null,
    ...(host || v.status === 'ended' ? { ...tally(v), weights: v.weights || {} } : {}),
    ...(player && Object.hasOwn(v.votes, player.seat) ? { ownVote: v.votes[player.seat], ownWeight: v.weights?.[player.seat] ?? 1 } : {}),
  } : null;
  const view = { step: g.step, revision: g.revision, nightId: g.nightId, stage: stageAt(g.step), sheriff: g.sheriff, voting, nextVoteExcluded: nextVoteExcluded(v),
    ...((wolfTeamViewers.has(player?.role) || (player?.role === '夢魘' && g.step > 0)) ? { wolfTeammates: room.players.filter(p => p.seat !== player.seat && p.role !== '機械狼' && !(g.step === 0 && p.role === '夢魘') && wolfRoles.has(p.role)).map(p => p.seat).sort((a, b) => a - b) } : {}),
    revealedWolves: Object.entries(g.selfExplosions || {}).map(([seat,r]) => ({seat:Number(seat),role:r.role})),
    ...(['狼人','血月使徒'].includes(player?.role) ? { selfExplosion: {
      canExplode: player.alive !== false && stageAt(g.step).type !== 'night' && !g.selfExplosions?.[player.seat],
      used: g.selfExplosions?.[player.seat] || null,
    } } : {}),
    revealedIdiots: (g.revealedIdiots || []).filter(seat => room.players.some(p => p.seat === seat && p.role === '白痴')),
    shotDeaths: room.players.filter(p => p.alive === false && g.deaths?.[p.seat]?.cause === 'shot').map(p => p.seat),
    ...(player?.role === '獵魔人' ? { demonHunter: {
      canHunt: player.alive !== false && nightOpen && g.step > 0 && !g.hunts?.[player.seat]?.[g.step],
      target: stageAt(g.step).type === 'night' ? g.hunts?.[player.seat]?.[g.step]?.target ?? null : null,
      results: Object.entries(g.hunts?.[player.seat] || {}).map(([step,r]) => ({step:Number(step),target:r.target})).sort((a,b)=>a.step-b.step),
    } } : {}),
    ...(player?.role === '攝夢人' ? { dreamer: {
      canDream: player.alive !== false && nightOpen && !g.dreams?.[player.seat]?.[g.step],
      target: g.dreams?.[player.seat]?.[g.step]?.target ?? null,
      previousTarget: g.dreams?.[player.seat]?.[previousNight]?.target ?? null,
      lethalTargets: room.players.filter(p => {
        const before = g.dreams?.[player.seat]?.[previousNight];
        return before && nightSeat(g, p.seat) === (before.resolvedTarget ?? nightSeat(g, before.target, previousNight));
      }).map(p => p.seat),
      results: Object.entries(g.dreams?.[player.seat] || {}).map(([step, r]) => ({ step: Number(step), target: r.target })).sort((a, b) => a.step - b.step),
    } } : {}),
    ...(player?.role === '魔術師' ? { magician: {
      canSwap: player.alive !== false && nightOpen && !g.swaps?.[player.seat]?.[g.step] && !nightActionsStarted(g),
      started: nightActionsStarted(g),
      usedSeats: swappedSeats(g),
      results: Object.entries(g.swaps?.[player.seat] || {}).map(([step, r]) => ({ step: Number(step), targets: r.targets })).sort((a, b) => a.step - b.step),
    } } : {}),
    ...(player?.role === '白狼王' ? { whiteWolfKing: {
      canExplode: player.alive !== false && stageAt(g.step).type !== 'night' && !g.explosions?.[player.seat],
      explosion: g.explosions?.[player.seat] || null,
    } } : {}),
    ...(player?.role === '騎士' ? { knight: {
      canDuel: player.alive !== false && stageAt(g.step).type !== 'night' && !g.duels?.[player.seat],
      duel: g.duels?.[player.seat] || null,
    } } : {}),
    ...(guardRecords ? { guard: {
      canGuard: player.alive !== false && nightOpen && !guardRecords[g.step],
      target: guardRecords[g.step]?.target ?? null,
      blockedTargets: [...new Set([guardRecords[previousNight]?.target, guardRecords[nextNight]?.target].filter(Number.isInteger))],
      results: Object.entries(guardRecords).map(([step, r]) => ({ step: Number(step), target: r.target })).sort((a, b) => a.step - b.step),
    } } : {}),
    ...(player?.role === '狼人' && player.alive !== false && stageAt(g.step).type === 'night' ? { wolfNight: {
      target: g.nights[g.step]?.target ?? null, settled: Boolean(g.nights[g.step]?.settled),
    } } : {}),
    ...(witch ? { witch: {
      healAvailable: !witch.heal, poisonAvailable: !witch.poison,
      canUse: player.alive !== false && nightOpen && !usedTonight,
      usedTonight: Boolean(usedTonight), heal: witch.heal || null, poison: witch.poison || null,
      ...(player.alive !== false && nightOpen && !witch.heal ? { knifeTarget: g.nights[g.step]?.target ?? null } : {}),
    } } : {}),
    ...(hasGun(player, g) ? { hunter: {
      canShoot: player.alive === false && ['knife', 'milk', 'exile'].includes(g.deaths?.[player.seat]?.cause) && !g.poisonDeaths?.[player.seat] && !g.hunterShots?.[player.seat],
      cause: g.poisonDeaths?.[player.seat] ? 'poison' : g.deaths?.[player.seat]?.cause ?? null,
      shot: g.hunterShots?.[player.seat] || null,
    } } : {}),
    ...(hasGun(player, g) && player.alive === false && g.poisonDeaths?.[player.seat] ? { hunterPoisoned: g.poisonDeaths[player.seat] } : {}),
    ...(player?.role === '預言家' ? { seer: {
      canInspect: player.alive !== false && stageAt(g.step).type === 'night' && !g.nights[g.step]?.settled && !g.inspections?.[player.seat]?.[g.step],
      results: Object.values(g.inspections?.[player.seat] || {}).sort((a, b) => a.step - b.step),
    } } : {}),
    ...(player?.role === '機械狼' ? { mechanical: mechanicalView(room, player) } : {}),
    ...(player?.role === '守墓人' ? { gravekeeper: gravekeeperView(room, player) } : {}),
    ...(player?.role === '石像鬼' ? { gargoyle: {
      canInspect: player.alive !== false && stageAt(g.step).type === 'night' && !g.nights[g.step]?.settled && !g.gargoyleInspections?.[player.seat]?.[g.step],
      results: Object.values(g.gargoyleInspections?.[player.seat] || {}).sort((a, b) => a.step - b.step),
    } } : {}),
    election: g.election ? { id: g.election.id, deadline: g.election.deadline, status: g.election.status, participants: g.election.participants, candidates: g.election.candidates,
      answered: Object.keys(g.election.answers).map(Number),
      ...(player && Object.hasOwn(g.election.answers, player.seat) ? { ownChoice: g.election.answers[player.seat] } : {}) } : null,
    ...(host ? { night: { ...(g.nights[g.step] || { target: null, settled: false }),
      resolvedTarget: nightSeat(g, g.nights[g.step]?.target ?? null),
      missingFears: nightOpen ? missingFears(room) : [], noKnives: stageAt(g.step).type === 'night' && noKnives(room),
      fears: stageAt(g.step).type === 'night' ? fearRecords(g) : [],
      missingDreams: nightOpen ? missingDreams(room) : [],
      dreamers: dreamLinks(room),
      hunts: Object.entries(g.hunts || {}).flatMap(([caster,r]) => r[g.step] ? [{caster:Number(caster),target:r[g.step].resolvedTarget ?? nightSeat(g,r[g.step].target)}] : []),
      outcome: stageAt(g.step).type === 'night' ? [...nightPlan(room)].map(([seat, cause]) => ({seat, cause})) : [],
      swaps: Object.values(g.swaps || {}).flatMap(r => r[g.step] ? [r[g.step].targets] : []),
      healed: Object.values(g.witches || {}).filter(w => w.heal?.step === g.step).map(w => nightSeat(g, w.heal.target)),
      poisoned: Object.values(g.witches || {}).filter(w => w.poison?.step === g.step).map(w => nightSeat(g, w.poison.target)),
      guarded: Object.values(g.guards || {}).flatMap(records => records[g.step] ? [nightSeat(g, records[g.step].target)] : []),
    }, history: g.history } : {}),
  };
  if (player?.role === '夢魘') view.nightmare = {
    canFear: player.alive !== false && room.players.some(other => other.alive && other.seat !== player.seat) && nightOpen && !g.fears?.[player.seat]?.[g.step] && !nightActionsStarted(g) && !Object.values(g.swaps || {}).some(r => r[g.step]),
    target: stageAt(g.step).type === 'night' ? g.fears?.[player.seat]?.[g.step]?.target ?? null : null,
    results: Object.entries(g.fears?.[player.seat] || {}).map(([step,r]) => ({step:Number(step),target:r.target})).sort((a,b)=>a.step-b.step),
  };
  if (player && stageAt(g.step).type === 'night') {
    const waiting = missingFears(room).length > 0, feared = fearedGod(room, player);
    view.nightRestriction = { waiting, feared };
    if (waiting || feared) for (const key of ['demonHunter','seer','gargoyle','witch','guard','dreamer','magician','mechanical','hunter']) {
      if (view[key]) for (const flag of Object.keys(view[key]).filter(k => k.startsWith('can'))) view[key][flag] = false;
    }
    if ((waiting || feared) && view.gravekeeper) view.gravekeeper = {status:'blocked',results:[]};
    if ((waiting || feared) && view.witch) delete view.witch.knifeTarget;
    else if (view.witch && noKnives(room) && Object.hasOwn(view.witch, 'knifeTarget')) view.witch.knifeTarget = null;
    if (view.wolfNight && (waiting || noKnives(room))) view.wolfNight.blocked = true;
    if (view.mechanical && noKnives(room)) view.mechanical.canKnife = false;
  }
  if (view.hunter && gunFeared(room, player)) view.hunter.canShoot = false;
  return view;
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
  g.history.unshift({ text, stage: stageAt(g.step).label, at: Date.now() });
  g.history = g.history.slice(0, 80);
}
function settle(room) {
  const g = room.game;
  const night = g.nights[g.step] || { target: null, settled: false };
  if (night.settled) return;
  requireFears(room);
  requireDreams(room);
  const deaths = nightPlan(room);
  applyNightDeaths(room, deaths);
  if (!deaths.size) note(g, '無夜間出局，已公布');
  night.settled = true;
  g.nights[g.step] = night;
}
export function updateGame(room, action, body, token) {
  if (room.phase !== 'dealt') fail('滿員派牌後才能進行遊戲');
  ensureGame(room);
  const g = room.game, stage = stageAt(g.step);
  const actor = room.players.find(p => p.token === token);
  if (action === 'fear') {
    if (actor?.role !== '夢魘' || !actor.alive) fail('只有存活夢魘可恐懼', 403);
    if (body.round !== room.round || body.revision !== g.revision || body.step !== g.step || body.nightId !== g.nightId || stage.type !== 'night' || g.nights[g.step]?.settled) fail('夜晚已結束或更新，請重新確認', 409);
    if (g.fears?.[actor.seat]?.[g.step]) fail('本晚已恐懼，不能更改', 409);
    if (nightActionsStarted(g) || Object.values(g.swaps || {}).some(r => r[g.step])) fail('夢魘必須在其他夜間技能前恐懼', 409);
    const target = room.players.find(p => p.seat === body.target);
    if (!Number.isInteger(body.target) || !target?.alive || target.seat === actor.seat) fail('請選擇一名其他存活玩家');
    ((g.fears ??= {})[actor.seat] ??= {})[g.step] = {target:target.seat};
    note(g, actor.seat + ' 號夢魘恐懼 ' + target.seat + ' 號（僅法官可見）');
    g.revision++;
    return;
  }
  if (stage.type === 'night' && ['hunt','mechanical','dream','swap','shoot','guard','potion','inspect','inspect-role','select-night','night'].includes(action)) {
    requireFears(room);
    if (fearedGod(room, actor)) fail('被夢魘恐懼，本晚技能失效', 403);
    if (noKnives(room) && (['select-night','night'].includes(action) || (action === 'mechanical' && body.kind === 'knife'))) fail('夢魘恐懼狼人陣營，本晚所有狼刀禁用', 403);
  }
  if (action === 'shoot' && gunFeared(room, actor)) fail('被夢魘恐懼的夜間死亡不能開槍', 403);
  if (action === 'hunt') {
    if (actor?.role !== '獵魔人' || !actor.alive) fail('只有存活獵魔人可狩獵', 403);
    if (body.round !== room.round || body.revision !== g.revision || body.step !== g.step || body.nightId !== g.nightId || stage.type !== 'night' || g.step === 0 || g.nights[g.step]?.settled) fail('狩獵僅從第二晚起可用，或夜晚已結束／更新', 409);
    if (g.hunts?.[actor.seat]?.[g.step]) fail('本晚已狩獵，不能更改', 409);
    const selected = room.players.find(p => p.seat === body.target), actual = room.players.find(p => p.seat === nightSeat(g,body.target));
    if (!Number.isInteger(body.target) || !selected?.alive || !actual?.alive || selected.seat === actor.seat || actual.seat === actor.seat) fail('請選擇一名其他存活玩家');
    ((g.hunts ??= {})[actor.seat] ??= {})[g.step] = {target:selected.seat,resolvedTarget:actual.seat};
    g.revision++;
    return;
  }
  if (action === 'mechanical') {
    const player = room.players.find(p => p.token === token);
    if (player?.role !== '機械狼' || !player.alive) fail('只有存活機械狼可使用學習技能', 403);
    if (body.round !== room.round || body.revision !== g.revision || body.step !== g.step || body.nightId !== g.nightId || stage.type !== 'night' || g.nights[g.step]?.settled) fail('夜晚已結束或更新，請重新確認', 409);
    const m = g.mechanical?.[player.seat] || {}, kind = body.kind;
    if (!['learn','inspect','poison','guard','knife'].includes(kind)) fail('無效機械狼技能');
    if (kind === 'learn') {
      if (m.learn) fail('本局已學習，不能再次學習', 409);
      if (nightActionsStarted(g, false)) fail('請在夜晚開始、其他行動前學習', 409);
    } else {
      const required = {inspect:'通靈師',poison:'女巫',guard:'守衛',knife:'狼人'}[kind];
      if (!m.learn || m.learn.role !== required) fail('尚未學到此技能', 403);
      if (g.step <= m.learn.step) fail('學到的技能從下一晚開始使用', 409);
      if ((kind === 'inspect' && m.inspections?.[g.step]) || (kind === 'guard' && m.guards?.[g.step]) || (['poison','knife'].includes(kind) && m[kind])) fail('此技能次數已使用，不能更改', 409);
    }
    const target = room.players.find(p => p.seat === body.target), actual = room.players.find(p => p.seat === nightSeat(g, body.target));
    if (!Number.isInteger(body.target) || !target?.alive || !actual?.alive || (kind !== 'guard' && (target.seat === player.seat || actual.seat === player.seat))) fail('請選擇有效存活玩家（守護可選自己）');
    if (kind === 'learn') m.learn = { step:g.step, target:target.seat, role:actual.role };
    else if (kind === 'inspect') (m.inspections ??= {})[g.step] = {step:g.step,target:target.seat,role:actual.role};
    else if (kind === 'guard') (m.guards ??= {})[g.step] = {step:g.step,target:target.seat};
    else m[kind] = {step:g.step,target:target.seat};
    (g.mechanical ??= {})[player.seat] = m;
    g.revision++;
    return;
  }
  if (action === 'dream') {
    const player = room.players.find(p => p.token === token);
    if (player?.role !== '攝夢人' || !player.alive) fail('只有存活攝夢人可攝夢', 403);
    if (body.round !== room.round || body.revision !== g.revision || body.step !== g.step || body.nightId !== g.nightId || stage.type !== 'night' || g.nights[g.step]?.settled) fail('夜晚已結束或狀態更新，請重新確認', 409);
    if (g.dreams?.[player.seat]?.[g.step]) fail('本晚已攝夢，不能更改', 409);
    const target = room.players.find(p => p.seat === body.target);
    const resolvedTarget = nightSeat(g, body.target);
    if (!Number.isInteger(body.target) || !target?.alive || target.seat === player.seat || resolvedTarget === player.seat || !room.players.some(p => p.seat === resolvedTarget && p.alive)) fail('請選擇一名其他存活玩家');
    ((g.dreams ??= {})[player.seat] ??= {})[g.step] = { target: target.seat, resolvedTarget };
    g.revision++;
    return;
  }
  if (action === 'swap') {
    const player = room.players.find(p => p.token === token);
    if (player?.role !== '魔術師' || !player.alive) fail('只有存活魔術師可換牌', 403);
    if (body.round !== room.round || body.revision !== g.revision || body.step !== g.step || body.nightId !== g.nightId || stage.type !== 'night' || g.nights[g.step]?.settled) fail('夜晚已結束或狀態更新，請重新確認', 409);
    if (g.swaps?.[player.seat]?.[g.step]) fail('本晚已換牌，不能更改', 409);
    if (nightActionsStarted(g)) fail('其他夜間行動已開始，魔術師須最先換牌', 409);
    const targets = body.targets;
    if (!Array.isArray(targets) || targets.length !== 2 || targets[0] === targets[1] || targets.some(n => !Number.isInteger(n) || !room.players.some(p => p.seat === n && p.alive))) fail('請選擇兩名不同的存活玩家');
    if (targets.some(n => swappedSeats(g).includes(n))) fail('本局已交換過的號碼不能再次交換', 409);
    ((g.swaps ??= {})[player.seat] ??= {})[g.step] = { targets: [...targets] };
    g.revision++;
    return;
  }
  if (action === 'self-explode') {
    if (!['狼人','血月使徒'].includes(actor?.role) || !actor.alive) fail('只有存活狼人或血月使徒可發動此自爆', 403);
    if (body.round !== room.round || body.revision !== g.revision || body.step !== g.step) fail('房間狀態已更新，請重新確認', 409);
    if (stage.type === 'night') fail('僅白天可發動自爆', 409);
    if (g.selfExplosions?.[actor.seat]) fail('本局已使用自爆', 409);
    const next = nextNightStep(g.step);
    ((g.selfExplosions ??= {}))[actor.seat] = {role:actor.role,step:g.step,nextStep:next};
    actor.alive = false;
    (g.deaths ??= {})[actor.seat] = {cause:'self-explosion',step:g.step};
    if (g.election && stage.type === 'election') g.election.status = 'cancelled';
    g.voting = null;
    note(g, actor.seat + ' 號公開身份為' + actor.role + '並自爆出局，跳過投票');
    g.step = next;
    g.nightId = randomUUID();
    note(g, '自爆結束白天，進入此階段');
    g.revision++;
    return;
  }
  if (action === 'explode') {
    const player = room.players.find(p => p.token === token);
    if (player?.role !== '白狼王' || !player.alive) fail('只有存活白狼王可自爆帶人', 403);
    if (body.round !== room.round || body.revision !== g.revision || body.step !== g.step) fail('房間狀態已更新，請重新確認', 409);
    if (stage.type === 'night') fail('僅白天可自爆帶人', 409);
    if (g.explosions?.[player.seat]) fail('本局已使用自爆帶人', 409);
    const target = room.players.find(p => p.seat === body.target);
    if (!Number.isInteger(body.target) || !target?.alive || target.seat === player.seat) fail('請選擇一名其他存活玩家');
    (g.explosions ??= {})[player.seat] = { target: target.seat, step: g.step };
    for (const p of [player, target]) {
      p.alive = false;
      (g.deaths ??= {})[p.seat] = { cause: 'explosion', step: g.step };
    }
    if (g.voting?.status === 'active') {
      g.voting.status = 'cancelled';
      if (g.voting.kind === 'sheriff') g.election.status = 'cancelled';
      note(g, '自爆帶人改變玩家狀態，本輪投票作廢，請重新發起');
    }
    note(g, `${player.seat} 號白狼王自爆，與 ${target.seat} 號一同出局`);
    g.revision++;
    return;
  }
  if (action === 'duel') {
    const player = room.players.find(p => p.token === token);
    if (player?.role !== '騎士' || !player.alive) fail('只有存活騎士可發動決鬥', 403);
    if (body.round !== room.round || body.revision !== g.revision || body.step !== g.step) fail('房間狀態已更新，請重新確認', 409);
    if (stage.type === 'night') fail('僅白天可發動決鬥', 409);
    if (g.duels?.[player.seat]) fail('本局已使用決鬥', 409);
    const target = room.players.find(p => p.seat === body.target);
    if (!Number.isInteger(body.target) || !target?.alive || target.seat === player.seat) fail('請選擇一名其他存活玩家');
    const eliminated = wolfRoles.has(target.role) ? target : player;
    (g.duels ??= {})[player.seat] = { target: target.seat, eliminated: eliminated.seat, step: g.step };
    (g.deaths ??= {})[eliminated.seat] = { cause: 'duel', step: g.step };
    eliminated.alive = false;
    if (g.voting?.status === 'active') {
      g.voting.status = 'cancelled';
      if (g.voting.kind === 'sheriff') g.election.status = 'cancelled';
      note(g, '決鬥改變玩家狀態，本輪投票作廢，請重新發起');
    }
    note(g, `${player.seat} 號騎士向 ${target.seat} 號決鬥，${eliminated.seat} 號出局`);
    g.revision++;
    return;
  }
  if (action === 'shoot') {
    const player = room.players.find(p => p.token === token);
    if (!hasGun(player, g)) fail('此身份未獲得槍殺技能', 403);
    if (body.round !== room.round || body.revision !== g.revision) fail('房間狀態已更新，請重新確認', 409);
    if (player.alive || !['knife', 'milk', 'exile'].includes(g.deaths?.[player.seat]?.cause) || g.poisonDeaths?.[player.seat] || g.hunterShots?.[player.seat]) fail('目前無法發動槍殺', 403);
    const selected = room.players.find(p => p.seat === body.target);
    if (!Number.isInteger(body.target) || !selected?.alive || selected.seat === player.seat) fail('請選擇一名其他存活玩家');
    const target = room.players.find(p => p.seat === nightSeat(g, body.target));
    if (!target?.alive || target.seat === player.seat) fail('此號碼目前無法作為槍殺目標');
    (g.hunterShots ??= {})[player.seat] = { target: target.seat, step: g.step };
    const immune = stage.type === 'night' && (dreamLinks(room).some(r => r.target === target.seat) || mechanicalShields(g).has(target.seat));
    if (stage.type === 'night') requireDreams(room);
    if (!immune) {
      (g.deaths ??= {})[target.seat] = { cause: 'shot', step: g.step };
      target.alive = false;
      if (stage.type === 'night') applyNightDeaths(room, extendDreamDeaths(room, new Map(), false));
    } else g.hunterShots[player.seat].blocked = true;
    if (g.voting?.status === 'active') {
      g.voting.status = 'cancelled';
      if (g.voting.kind === 'sheriff') g.election.status = 'cancelled';
      note(g, '槍殺改變玩家狀態，本輪投票作廢，請重新發起');
    }
    note(g, `${player.seat} 號${player.role}發動槍殺，${target.seat} 號${immune ? '獲夜間免疫' : '出局'}`);
    g.revision++;
    return;
  }
  if (action === 'guard') {
    const player = room.players.find(p => p.token === token);
    if (!player?.alive || player.role !== '守衛') fail('只有存活守衛可守護', 403);
    if (body.round !== room.round || body.step !== g.step || body.nightId !== g.nightId || body.revision !== g.revision || stage.type !== 'night' || g.nights[g.step]?.settled) fail('夜晚已結束或狀態更新，請重新查看', 409);
    const records = g.guards?.[player.seat] || {};
    if (records[g.step]) fail('本晚已守護，不能更改', 409);
    if (!Number.isInteger(body.target) || !room.players.some(p => p.seat === body.target && p.alive)) fail('請選擇一名存活玩家');
    const adjacent = [previousNightStep(g.step), nextNightStep(g.step)];
    if (adjacent.some(step => records[step]?.target === body.target)) fail('不能連續兩晚守護同一玩家');
    records[g.step] = { target: body.target };
    (g.guards ??= {})[player.seat] = records;
    g.revision++;
    return;
  }
  if (action === 'reveal-idiot') {
    const player = room.players.find(p => p.token === token);
    if (!player?.alive || player.role !== '白痴') fail('只有存活的白痴玩家可公開自身身分', 403);
    if (body.round !== room.round || body.revision !== g.revision) fail('房間狀態已更新，請重新查看', 409);
    if (g.revealedIdiots?.includes(player.seat)) fail('已公開白痴身分', 409);
    (g.revealedIdiots ??= []).push(player.seat);
    g.revision++;
    note(g, `${player.seat} 號主動公開白痴身分`);
    return;
  }
  if (action === 'select-night') {
    const host = token === room.host;
    const player = room.players.find(p => p.token === token);
    if (!host && (!player?.alive || player.role !== '狼人')) fail('只有法官與存活狼人可選擇刀人目標', 403);
    if (body.round !== room.round || body.step !== g.step || body.nightId !== g.nightId || stage.type !== 'night' || g.nights[g.step]?.settled) fail('夜晚已結束或更新，請重新查看', 409);
    if (!Number.isInteger(body.seat) || !room.players.some(p => p.seat === body.seat && p.alive)) fail('請選擇一名存活玩家');
    // One shared scalar; CAS retries apply the last accepted choice, not a vote tally.
    (g.nightActionsStarted ??= {})[g.step] = true;
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
    (records[p.seat] ??= {})[g.step] = { step: g.step, target: target.seat, camp: wolfRoles.has(room.players.find(other => other.seat === nightSeat(g, target.seat)).role) ? '狼人陣營' : '好人陣營' };
    return;
  }
  if (action === 'inspect-role') {
    const p = room.players.find(p => p.token === token);
    if (!p?.alive || p.role !== '石像鬼') fail('只有存活的石像鬼可查驗', 403);
    if (body.round !== room.round || body.step !== g.step || body.revision !== g.revision || body.nightId !== g.nightId || stage.type !== 'night' || g.nights[g.step]?.settled) fail('夜晚已結束或狀態更新，請重新查看', 409);
    if (g.gargoyleInspections?.[p.seat]?.[g.step]) fail('本晚已查驗，不能再次使用', 409);
    const target = room.players.find(other => other.seat === body.target && other.alive && other.seat !== p.seat);
    if (!Number.isInteger(body.target) || !target) fail('請選擇其他存活玩家');
    const records = (g.gargoyleInspections ??= {});
    (records[p.seat] ??= {})[g.step] = { step: g.step, target: target.seat, role: room.players.find(other => other.seat === nightSeat(g, target.seat)).role };
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
    if (next < 0 || !Number.isSafeInteger(next)) fail('已到達流程邊界');
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
    (g.nightActionsStarted ??= {})[g.step] = true;
    g.nights[g.step] = { target: body.seat, settled: false };
    note(g, body.seat === null ? '清空夜間目標，暫定平安夜' : `暫存夜間目標：${body.seat} 號`);
  } else if (action === 'settle-night') {
    if (stage.type !== 'night') fail('僅夜間可結算');
    if (g.nights[g.step]?.settled) fail('本晚已公布', 409);
    settle(room);
  } else if (action === 'status') {
    const p = getPlayer();
    if (typeof body.alive !== 'boolean') fail('無效存活狀態');
    if (p.alive && !body.alive) (g.deaths ??= {})[p.seat] = { cause: 'manual', step: g.step };
    p.alive = body.alive;
    if (p.alive && g.deaths) delete g.deaths[p.seat];
    if (p.alive && g.poisonDeaths) delete g.poisonDeaths[p.seat];
    if (g.voting?.status === 'active') {
      g.voting.status = 'cancelled';
      if (g.voting.kind === 'sheriff') g.election.status = 'cancelled';
      note(g, '玩家狀態變更，本輪投票作廢，請重新發起');
    }
    if (!p.alive && stage.type === 'night') applyNightDeaths(room, extendDreamDeaths(room, new Map(), false));
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
    (g.deaths ??= {})[p.seat] = { cause: 'exile', step: g.step };
    const exiles = (g.exiles ??= {});
    const records = (exiles[g.step] ??= []);
    if (!records.some(record => record.seat === p.seat)) records.push({ seat: p.seat, camp: wolfRoles.has(p.role) ? '狼人陣營' : '好人陣營' });
    v.eliminated = p.seat;
    note(g, `${p.seat} 號經投票確認出局`);
  } else fail('無效遊戲操作');
  g.revision++;
}
