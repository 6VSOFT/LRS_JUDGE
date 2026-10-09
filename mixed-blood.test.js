import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, roleNames, wolfRoles } from './lib/rooms.js';
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
  await edit(r => { ['混血兒','狼人','女巫','魔術師','村民','守衛'].forEach((role,i)=>r.players[i].role=role); });
  const state = token => api('state', { code, token: token || host.token });
  return { api, host, code, players, edit, state };
}


async function act(f,action,seat=null,extra={}) {
 const {room}=await f.state();return f.api(action,{code:f.code,token:seat?f.players[seat-1].token:f.host.token,round:room.round,revision:room.game.revision,step:room.game.step,nightId:room.game.nightId,...extra});
}



const worship=(f,target,extra={})=>act(f,'worship',1,{target,...extra});
const view=async f=>(await f.state(f.players[0].token)).room.game.mixedBlood;
test('mixed blood first-night worship is once/game, private, concurrent and recoverable',async()=>{
 const f=await fixture();assert.equal((await view(f)).canWorship,true);
 for(const target of [1,99,null,'2'])assert.equal((await worship(f,target)).status,400);
 for(const extra of [{round:0},{revision:-1},{step:3},{nightId:'stale'}])assert.equal((await worship(f,2,extra)).status,409);
 assert.equal((await act(f,'worship',2,{target:3})).status,403);assert.equal((await act(f,'worship',null,{target:3})).status,403);
 const race=await Promise.all([worship(f,2),worship(f,3)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 const own=await view(f);assert.equal(own.canWorship,false);assert.deepEqual(Object.keys(own.worship),['target']);
 for(const res of [await f.state(),await f.state(f.players[1].token),await f.api('lookup',{code:f.code})]){assert.equal(res.room.game.mixedBlood,undefined);assert.equal(res.room.game.worships,undefined);}
 assert.deepEqual(await view(f),own);assert.equal((await worship(f,2)).status,409);
 await f.edit(r=>r.game.step=3);assert.equal((await worship(f,2)).status,409);
 await f.edit(r=>r.game.step=0);assert.equal((await worship(f,2)).status,409);
 assert.equal((await act(f,'swap',4,{targets:[4,5]})).status,409);
 await act(f,'redeal');await f.edit(r=>r.players[0].role='混血兒');assert.deepEqual(await view(f),{canWorship:true,worship:null});
});
test('mixed blood requires living other target and cannot worship after first night or settlement',async()=>{
 const f=await fixture();await f.edit(r=>r.players[1].alive=false);assert.equal((await worship(f,2)).status,400);
 await f.edit(r=>r.players[0].alive=false);assert.equal((await worship(f,3)).status,403);
 await f.edit(r=>{r.players[0].alive=true;r.game.nights[0]={settled:true};});assert.equal((await worship(f,3)).status,409);assert.equal((await view(f)).canWorship,false);
 await f.edit(r=>{r.game.nights={};r.game.step=2;});assert.equal((await worship(f,3)).status,409);
 await f.edit(r=>r.game.step=13);assert.equal((await worship(f,3)).status,409);
});
test('mixed blood is civilian: nightmare fear does not block worship; no role or camp is disclosed',async()=>{
 const f=await fixture();await f.edit(r=>r.players[5].role='夢魘');assert.equal((await worship(f,2)).status,409);assert.equal((await view(f)).canWorship,false);
 await act(f,'fear',6,{target:1});assert.equal((await view(f)).canWorship,true);
 assert.equal((await f.state(f.players[0].token)).room.game.nightRestriction.feared,false);
 assert.equal((await worship(f,2)).status,200);assert.deepEqual((await view(f)).worship,{target:2});
 assert.equal((await f.state(f.players[0].token)).room.self.role,'混血兒');
});
test('mixed blood custom counts deal and redeal, validate as good camp, and occupy requested role order',async()=>{
 const f=await fixture();const created=await f.api('create',{size:6,roles:{狼人:1,混血兒:5}});assert.equal(created.status,200);
 for(let seat=1;seat<=6;seat++)assert.equal((await f.api('join',{code:created.room.code,seat,name:'配置測試'+seat})).status,200);
 let r=(await f.api('state',{code:created.room.code,token:created.token})).room;
 assert.equal(r.players.filter(p=>p.role==='混血兒').length,5);assert.equal(r.roleCounts.混血兒,5);
 await f.api('redeal',{code:r.code,token:created.token});r=(await f.api('state',{code:r.code,token:created.token})).room;assert.equal(r.players.filter(p=>p.role==='混血兒').length,5);
 assert.equal(wolfRoles.has('混血兒'),false);assert.equal(roleNames[roleNames.indexOf('白痴')+1],'混血兒');
});
