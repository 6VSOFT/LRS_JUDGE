import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from './lib/rooms.js';
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
  await edit(r => { ['夢魘','預言家','狼人','女巫','獵人','守衛'].forEach((role,i)=>r.players[i].role=role); });
  const state = token => api('state', { code, token: token || host.token });
  return { api, host, code, players, edit, state };
}


async function act(f,action,seat=null,extra={}) {
 const {room}=await f.state();return f.api(action,{code:f.code,token:seat?f.players[seat-1].token:f.host.token,round:room.round,revision:room.game.revision,step:room.game.step,nightId:room.game.nightId,...extra});
}

const fear=(f,target,extra={})=>act(f,'fear',1,{target,...extra});
const playerView=async(f,seat)=>(await f.state(f.players[seat-1].token)).room.game;
test('fear is mandatory before night actions, private, once/night, stamped, concurrent and resettable',async()=>{
 const f=await fixture();
 for(const [action,seat,extra] of [['inspect',2,{target:3}],['potion',4,{kind:'poison',target:3}],['guard',6,{target:2}],['select-night',3,{seat:2}],['settle-night',null,{}],['stage',null,{direction:1}]])assert.equal((await act(f,action,seat,extra)).status,409,action);
 assert.equal((await playerView(f,2)).seer.canInspect,false);
 for(const target of [1,99,null])assert.equal((await fear(f,target)).status,400);
 assert.equal((await fear(f,2,{nightId:'stale'})).status,409);
 assert.equal((await act(f,'fear',2,{target:3})).status,403);
 const race=await Promise.all([fear(f,2),fear(f,4)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 const record=(await playerView(f,1)).nightmare.results;assert.equal(record.length,1);
 assert.equal((await fear(f,3)).status,409);assert.deepEqual((await playerView(f,1)).nightmare.results,record);
 for(const res of [await f.api('lookup',{code:f.code}),await f.state(f.players[2].token)]){assert.equal(res.room.game.nightmare,undefined);assert.equal(res.room.game.fears,undefined);assert.equal(res.room.game.night,undefined);}
 assert.equal((await f.state()).room.game.night.fears.length,1);
 await f.edit(r=>r.game.step=2);assert.equal((await fear(f,3)).status,409);
 await f.edit(r=>r.game.step=3);assert.equal((await fear(f,3)).status,200);
 await act(f,'redeal');await f.edit(r=>r.players[0].role='夢魘');assert.deepEqual((await playerView(f,1)).nightmare.results,[]);
});
test('fear blocks god skills without consuming usage and expires next night; villagers do not stop knives',async()=>{
 for(const [role,action,extra,field,flag] of [['預言家','inspect',{target:3},'seer','canInspect'],['女巫','potion',{kind:'poison',target:3},'witch','canUse'],['守衛','guard',{target:3},'guard','canGuard'],['攝夢人','dream',{target:3},'dreamer','canDream'],['魔術師','swap',{targets:[3,4]},'magician','canSwap']]){
  const f=await fixture();await f.edit(r=>{r.players[1].role=role;r.players[3].role='村民'});
  assert.equal((await fear(f,2)).status,200);assert.equal((await playerView(f,2))[field][flag],false);
  assert.equal((await act(f,action,2,extra)).status,403,role);
  assert.equal((await act(f,'select-night',3,{seat:2})).status,200);assert.equal((await act(f,'settle-night')).status,200,role);
  await f.edit(r=>{r.game.step=3;r.players[1].alive=true;});assert.equal((await fear(f,4)).status,200);assert.equal((await act(f,action,2,extra)).status,200,role);
 }
});
test('fear of every wolf camp role bans host/shared/mechanical knives; settlement ignores stale knives but allows poison',async()=>{
 for(const role of ['狼人','狼王','白狼王','夢魘','石像鬼','狼美人','血月使徒','機械狼']){
  const f=await fixture();await f.edit(r=>{r.players[1].role=role;r.players[5].role='機械狼';r.game.step=3;r.game.mechanical={6:{learn:{step:0,role:'狼人'}}};});
  assert.equal((await fear(f,2)).status,200);
  if(role==='夢魘')assert.equal((await act(f,'fear',2,{target:5})).status,200);
  assert.equal((await act(f,'select-night',3,{seat:5})).status,403);
  assert.equal((await act(f,'select-night',null,{seat:5})).status,403);
  assert.equal((await act(f,'night',null,{seat:5})).status,403);
  assert.equal((await act(f,'mechanical',6,{kind:'knife',target:5})).status,403);
  assert.equal((await playerView(f,6)).mechanical.canKnife,false);
  await f.edit(r=>{r.game.nights[3]={target:5};r.game.mechanical[6].knife={step:3,target:5};});
  assert.equal((await act(f,'potion',4,{kind:'poison',target:3})).status,200);
  assert.equal((await act(f,'settle-night')).status,200);
  const room=(await f.state()).room;assert.equal(room.players[4].alive,true);assert.equal(room.players[2].alive,false);
 }
});
test('fear precedes magic and learning; target remains physical; dead nightmare and no-target cases do not block',async()=>{
 const f=await fixture();await f.edit(r=>{r.players[5].role='魔術師';r.players[3].role='機械狼'});
 assert.equal((await act(f,'swap',6,{targets:[2,3]})).status,409);assert.equal((await act(f,'mechanical',4,{kind:'learn',target:3})).status,409);
 await fear(f,2);assert.equal((await act(f,'swap',6,{targets:[2,3]})).status,200);assert.equal((await playerView(f,2)).nightRestriction.feared,true);
 assert.equal((await act(f,'mechanical',4,{kind:'learn',target:5})).status,200);
 await f.edit(r=>{r.game.step=3;r.players[0].alive=false;});assert.equal((await fear(f,3)).status,403);assert.equal((await act(f,'select-night',3,{seat:2})).status,200);
 const lone=await fixture();await lone.edit(r=>r.players.forEach((p,i)=>p.alive=i===0));assert.equal((await playerView(lone,1)).nightmare.canFear,false);assert.equal((await act(lone,'settle-night')).status,200);
});
test('fear suppresses gravekeeper information and night hunter death gun, but preserves unrelated wolf skills',async()=>{
 const f=await fixture();await f.edit(r=>{r.game.step=3;r.players[1].role='守墓人';r.game.exiles={2:[{seat:5,camp:'好人陣營'}]}});
 assert.deepEqual((await playerView(f,2)).gravekeeper.results,[]);await fear(f,2);assert.equal((await playerView(f,2)).gravekeeper.status,'blocked');
 await f.edit(r=>{r.game.step=5;r.players[1].role='獵人'});await fear(f,2);await act(f,'select-night',3,{seat:2});await act(f,'settle-night');
 assert.equal((await playerView(f,2)).hunter.canShoot,false);assert.equal((await act(f,'shoot',2,{target:3})).status,403);
 await f.edit(r=>r.game.step=6);assert.equal((await act(f,'shoot',2,{target:3})).status,403);
 await f.edit(r=>{r.game.step=7;r.players[1].role='石像鬼';r.players[1].alive=true});await fear(f,2);
 assert.equal((await act(f,'inspect-role',2,{target:3})).status,200);
});
test('nightmare does not meet wolves first night, meets later, and never meets mechanical wolf',async()=>{
 const f=await fixture();await f.edit(r=>r.players[5].role='機械狼');
 assert.equal((await playerView(f,1)).wolfTeammates,undefined);assert.deepEqual((await playerView(f,3)).wolfTeammates,[]);
 await fear(f,2);assert.deepEqual((await playerView(f,3)).wolfTeammates,[]);
 await f.edit(r=>r.game.step=3);assert.deepEqual((await playerView(f,1)).wolfTeammates,[3]);assert.deepEqual((await playerView(f,3)).wolfTeammates,[1]);assert.equal((await playerView(f,6)).wolfTeammates,undefined);
});
