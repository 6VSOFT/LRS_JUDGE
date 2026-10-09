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
  await edit(r => { ['獵魔人','狼人','女巫','魔術師','村民','守衛'].forEach((role,i)=>r.players[i].role=role); });
  const state = token => api('state', { code, token: token || host.token });
  return { api, host, code, players, edit, state };
}


async function act(f,action,seat=null,extra={}) {
 const {room}=await f.state();return f.api(action,{code:f.code,token:seat?f.players[seat-1].token:f.host.token,round:room.round,revision:room.game.revision,step:room.game.step,nightId:room.game.nightId,...extra});
}



const messages=async(f,token)=>(await f.state(token)).room.game.eliminationAnnouncements;
test('elimination announcements classify every configured role, include mixed blood as civilian, and reach every view',async()=>{
 for(const role of roleNames){
  const f=await fixture();await f.edit(r=>{r.players.forEach((p,i)=>{p.role=i===0?role:'村民';p.alive=i!==0;});});
  const expected=wolfRoles.has(role)?'所有狼人已被淘汰':['村民','混血兒'].includes(role)?null:'所有神职已被淘汰';
  for(const token of [f.host.token,f.players[0].token,f.players[1].token])assert.deepEqual(await messages(f,token),expected?[expected]:[],role);
  assert.deepEqual((await f.api('lookup',{code:f.code})).room.game.eliminationAnnouncements,expected?[expected]:[]);
 }
 const f=await fixture();await f.edit(r=>{r.players[4].role='混血兒';r.players.forEach(p=>p.alive=false);});
 assert.deepEqual(await messages(f),['所有神职已被淘汰','所有平民已被淘汰','所有狼人已被淘汰']);
});
test('announcements update with manual death/restoration, survive recovery, reset on redeal, and do not end gameplay',async()=>{
 const f=await fixture();assert.deepEqual(await messages(f),[]);
 await act(f,'status',null,{seat:2,alive:false});assert.deepEqual(await messages(f),['所有狼人已被淘汰']);
 assert.deepEqual(await messages(f,f.players[1].token),['所有狼人已被淘汰']);
 await act(f,'status',null,{seat:2,alive:true});assert.deepEqual(await messages(f),[]);
 await act(f,'status',null,{seat:5,alive:false});assert.deepEqual(await messages(f),['所有平民已被淘汰']);
 for(const seat of [1,3,4,6])await act(f,'status',null,{seat,alive:false});assert.deepEqual(await messages(f),['所有神职已被淘汰','所有平民已被淘汰']);
 assert.equal((await act(f,'stage',null,{direction:1})).status,200);
 await act(f,'redeal');assert.deepEqual(await messages(f),[]);
});
test('unconfigured groups never announce, pending night targets do not announce before settlement',async()=>{
 const f=await fixture();await f.edit(r=>{r.players.forEach((p,i)=>p.role=i===0?'狼人':'村民');});assert.deepEqual(await messages(f),[]);
 await act(f,'night',null,{seat:1});assert.deepEqual(await messages(f),[]);
 await act(f,'settle-night');assert.deepEqual(await messages(f),['所有狼人已被淘汰']);
 const pub=(await f.api('lookup',{code:f.code})).room;assert.equal(pub.players[0].role,undefined);assert.equal(pub.game.deaths,undefined);
 await f.edit(r=>r.players.forEach(p=>p.role='狼人'));assert.deepEqual(await messages(f),[]);
});
