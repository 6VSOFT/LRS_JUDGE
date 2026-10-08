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
  await edit(r => { ['狼人','血月使徒','村民','女巫','獵人','守衛'].forEach((role,i)=>r.players[i].role=role); });
  const state = token => api('state', { code, token: token || host.token });
  return { api, host, code, players, edit, state };
}


async function act(f,action,seat=null,extra={}) {
 const {room}=await f.state();return f.api(action,{code:f.code,token:seat?f.players[seat-1].token:f.host.token,round:room.round,revision:room.game.revision,step:room.game.step,nightId:room.game.nightId,...extra});
}


const explode=(f,seat=1,extra={})=>act(f,'self-explode',seat,extra);
const view=async(f,seat)=>(await f.state(f.players[seat-1].token)).room.game;
for(const role of ['狼人','血月使徒'])test(role+' publicly self-explodes once, skips voting/election to next night and persists until redeal',async()=>{
 for(const step of [1,2,4,12,14]){
  const f=await fixture();await f.edit(r=>{r.players[0].role=role;r.game.step=step;if(step===1)r.game.election={status:'signup',id:'signup',deadline:Date.now()+15000,participants:[1,2,3,4,5,6],answers:{},candidates:[]};else r.game.voting={id:'old',status:'active',stage:step,eligible:[1,2,3,4,5,6],votes:{2:3}};});
  const old=await f.state();assert.equal((await view(f,1)).selfExplosion.canExplode,true);
  assert.equal((await explode(f)).status,200);
  const r=(await f.state()).room;assert.equal(r.game.step,step===1?3:step+1);assert.equal(r.game.stage.type,'night');assert.notEqual(r.game.nightId,old.room.game.nightId);assert.equal(r.game.voting,null);
  assert.equal(r.players.filter(p=>!p.alive).length,1);assert.equal(r.players[0].alive,false);
  assert.deepEqual(r.game.revealedWolves,[{seat:1,role}]);assert.deepEqual((await f.api('lookup',{code:f.code})).room.game.revealedWolves,[{seat:1,role}]);
  const other=await f.state(f.players[2].token);assert.deepEqual(other.room.game.revealedWolves,[{seat:1,role}]);assert.ok(other.room.players.every(p=>p.role===undefined));assert.equal(other.room.game.selfExplosion,undefined);
  if(step===1)assert.equal(r.game.election.status,'cancelled');
  assert.equal((await act(f,'vote',3,{voteId:'old',target:4})).status,409);
  assert.equal((await explode(f)).status,403);
  await act(f,'status',null,{seat:1,alive:true});await f.edit(r=>r.game.step=step);assert.equal((await view(f,1)).selfExplosion.canExplode,false);assert.equal((await explode(f)).status,409);
  await act(f,'redeal');await f.edit(r=>{r.players[0].role=role;r.game.step=2});assert.equal((await view(f,1)).selfExplosion.used,null);assert.deepEqual((await view(f,3)).revealedWolves,[]);assert.equal((await explode(f)).status,200);
 }
});
test('self-explosion validates role, living state, day, stale stamps and concurrent phase races',async()=>{
 const f=await fixture();assert.equal((await explode(f)).status,409);await f.edit(r=>r.game.step=2);
 for(const extra of [{round:0},{step:4},{revision:-1}])assert.equal((await explode(f,1,extra)).status,409);
 for(const seat of [null,3,4,5,6])assert.equal((await explode(f,seat)).status,403);
 await f.edit(r=>r.players[2].role='白狼王');assert.equal((await explode(f,3)).status,403);
 const res=await Promise.all([explode(f,1),explode(f,2)]);assert.deepEqual(res.map(r=>r.status).sort(),[200,409]);
 const r=(await f.state()).room;assert.equal(r.game.step,3);assert.equal(r.game.revealedWolves.length,1);assert.equal(r.players.filter(p=>!p.alive).length,1);
});
test('late rounds preserve guard adjacency, dream consecutive death, private checks and gravekeeper day snapshots',async()=>{
 const f=await fixture();await f.edit(r=>{r.game.step=13;r.players[2].role='攝夢人';r.game.guards={6:{11:{target:2}}};r.game.dreams={3:{11:{target:2,resolvedTarget:2}}};r.players[3].role='預言家';r.players[4].role='守墓人';r.game.exiles={12:[{seat:1,camp:'狼人陣營'}]};});
 assert.equal((await act(f,'guard',6,{target:2})).status,400);assert.equal((await act(f,'guard',6,{target:1})).status,200);
 assert.equal((await act(f,'inspect',4,{target:2})).room.game.seer.results[0].camp,'狼人陣營');
 assert.deepEqual((await view(f,5)).gravekeeper.results,[{seat:1,camp:'狼人陣營'}]);
 assert.equal((await act(f,'dream',3,{target:2})).status,200);assert.equal((await act(f,'stage',null,{direction:1})).status,200);
 const r=(await f.state()).room;assert.equal(r.game.stage.label,'第 7 天');assert.equal(r.players[1].alive,false);
 assert.equal((await act(f,'stage',null,{direction:1})).room.game.stage.label,'第 8 晚');
});
