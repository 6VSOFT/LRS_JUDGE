import { randomInt, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const configs = {
  6: ['狼人', '狼人', '預言家', '女巫', '村民', '村民'],
  9: ['狼人', '狼人', '狼人', '預言家', '女巫', '獵人', '村民', '村民', '村民'],
  12: ['狼人', '狼人', '狼人', '狼人', '預言家', '女巫', '獵人', '守衛', '村民', '村民', '村民', '村民'],
};
const lifetime = 24 * 60 * 60 * 1000;
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

export function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function isActive(room) {
  return room && !room.deleted && room.expiresAt > Date.now();
}
function deal(room) {
  const deck = [...configs[room.size]];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  room.players.forEach((p, i) => { p.role = deck[i]; p.confirmed = false; });
  room.phase = 'dealt';
  room.round++;
}
function publicView(room) {
  return {
    code: room.code, size: room.size, phase: room.phase, round: room.round,
    players: room.players.map(p => ({ seat: p.seat, confirmed: p.confirmed })),
  };
}
function privateView(room, token) {
  const host = token === room.host;
  const player = room.players.find(p => p.token === token);
  if (!host && !player) fail('此裝置沒有該座位的憑證，請使用原本的瀏覽器。', 403);
  return {
    ...publicView(room), host,
    self: player ? { seat: player.seat, role: player.role, confirmed: player.confirmed } : null,
  };
}
function updateRoom(room, action, body, suppliedToken, joinToken) {
  let token = suppliedToken;
  if (action === 'join') {
    const seat = Number(body.seat);
    if (!Number.isInteger(seat) || seat < 1 || seat > room.size) fail('請選擇有效座位');
    const occupant = room.players.find(p => p.seat === seat);
    const existing = room.players.find(p => p.token === token);
    if (occupant) {
      if (occupant.token !== token) fail('此座位已有人。恢復身分請使用原本的瀏覽器。', 409);
      return { token, changed: false };
    }
    if (existing || token === room.host) fail('你已在此房間，無法重複入座。', 409);
    if (room.phase !== 'lobby') fail('本局已派牌，無法加入。', 409);
    token = joinToken;
    room.players.push({ seat, token, confirmed: false });
    room.players.sort((a, b) => a.seat - b.seat);
    if (room.players.length === room.size) deal(room);
  } else if (action === 'confirm') {
    const player = room.players.find(p => p.token === token);
    if (!player) fail('座位憑證無效', 403);
    if (room.phase !== 'dealt' || body.round !== room.round) fail('身分已更新，請重新查看底牌。', 409);
    if (player.confirmed) return { token, changed: false };
    player.confirmed = true;
  } else {
    if (token !== room.host) fail('僅法官可操作', 403);
    if (action === 'dissolve') {
      room.deleted = true;
      // Keep a versioned tombstone so an in-flight join cannot resurrect the room.
      room.players = [];
    } else {
      if (room.players.length !== room.size) fail('請等待所有座位入座');
      deal(room);
    }
  }
  room.expiresAt = Date.now() + lifetime;
  return { token, changed: true };
}

// One room is one versioned document. Atomic conditional writes serialize all
// seat claims and deals, even when requests run in different function instances.
export async function handleRequest(request, store) {
  try {
    const url = new URL(request.url);
    const action = url.pathname.split('/').filter(Boolean).at(-1);
    const read = ['lookup', 'state'].includes(action);
    if (request.method !== (read ? 'GET' : 'POST')) fail('不支援此請求方式', 405);
    if (!['create', 'lookup', 'state', 'join', 'confirm', 'redeal', 'dissolve'].includes(action)) fail('無效操作', 404);
    let body = {};
    if (!read) {
      const raw = await request.text();
      if (Buffer.byteLength(raw) > 10000) fail('請求過大', 413);
      try { body = JSON.parse(raw || '{}'); } catch { fail('無效的 JSON'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail('無效請求');
    }
    const suppliedToken = body.token || request.headers.get('authorization');
    let result;
    if (action === 'create') {
      const size = Number(body.size);
      if (!configs[size]) fail('請選擇有效角色配置');
      const token = randomUUID();
      for (let attempt = 0; attempt < 100; attempt++) {
        const code = String(randomInt(1000, 10000));
        const current = await store.read(code);
        if (isActive(current?.data)) continue;
        const room = { code, size, host: token, phase: 'lobby', round: 0, players: [], expiresAt: Date.now() + lifetime };
        if (await store.write(code, room, current?.etag)) {
          result = { token, room: privateView(room, token) };
          break;
        }
      }
      if (!result) fail('房間已滿，請稍後再試', 503);
    } else {
      const code = String(body.code || url.searchParams.get('code') || '');
      if (!/^[1-9]\d{3}$/.test(code)) fail('請輸入 4 位數房間碼');
      const joinToken = randomUUID();
      for (let attempt = 0; attempt < 30; attempt++) {
        const current = await store.read(code);
        if (!isActive(current?.data)) fail('房間不存在、已解散或已過期，請確認房間碼。', 404);
        const room = current.data;
        if (read) {
          result = action === 'lookup' ? { room: publicView(room) } : { token: suppliedToken, room: privateView(room, suppliedToken) };
          break;
        }
        const { token, changed } = updateRoom(room, action, body, suppliedToken, joinToken);
        if (!changed || await store.write(code, room, current.etag)) {
          result = action === 'dissolve' ? { dissolved: true } : { token, room: privateView(room, token) };
          break;
        }
        await delay(randomInt(10, Math.min(120, 20 + attempt * 10)));
      }
      if (!result) fail('多人同時操作，請稍後再試。', 409);
    }
    return new Response(JSON.stringify(result), { status: 200, headers });
  } catch (error) {
    if (!error.status) console.error('Room API storage error:', error.name);
    return new Response(JSON.stringify({ error: error.status ? error.message : '房間服務暫時無法使用，請稍後重試。' }), {
      status: error.status || 503, headers,
    });
  }
}
