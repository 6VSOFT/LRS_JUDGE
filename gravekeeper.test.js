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
  await edit(r => { r.players[0].role = '守墓人'; r.players[1].role = '狼人'; r.players[2].role = '女巫'; });
  const state = token => api('state', { code, token: token || host.token });
  return { api, host, code, players, edit, state };
}


async function act(f, action, extra = {}) {
 const {room} = await f.state();
 return f.api(action, {code:f.code,token:f.host.token,round:room.round,revision:room.game.revision,...extra});
}
async function exile(f, target) {
 assert.equal((await act(f,'start-vote')).status,200);
 const {room}=await f.state();
 assert.equal((await f.api('vote',{code:f.code,token:f.players[0].token,round:room.round,voteId:room.game.voting.id,target})).status,200);
 assert.equal((await act(f,'end-vote')).status,200);
 assert.equal((await act(f,'eliminate-vote')).status,200);
}
const own = async f => (await f.state(f.players[0].token)).room.game.gravekeeper;
test('gravekeeper receives only previous daytime confirmed exile camp from night two; recovers and resets',async()=>{
 const f=await fixture();
 assert.deepEqual(await own(f),{status:'first-night',results:[]});
 await f.edit(r=>r.game.step=2);
 assert.equal((await own(f)).status,'day');
 await exile(f,2);
 assert.equal((await own(f)).results.length,0);
 // Host restoration must not erase the fact of the public exile.
 assert.equal((await act(f,'status',{seat:2,alive:true})).status,200);
 assert.equal((await act(f,'stage',{direction:1})).status,200);
 const expected={status:'result',results:[{seat:2,camp:'狼人陣營'}]};
 assert.deepEqual(await own(f),expected);assert.deepEqual(await own(f),expected);
 // Number swapping cannot change last day's public outcome.
 await f.edit(r=>{r.game.swaps={6:{3:{targets:[2,3]}}};});
 assert.deepEqual(await own(f),expected);
 await act(f,'stage',{direction:-1});assert.equal((await own(f)).status,'day');
 await act(f,'stage',{direction:1});assert.deepEqual(await own(f),expected);
 await act(f,'stage',{direction:1});await exile(f,3);await act(f,'stage',{direction:1});
 assert.deepEqual(await own(f),{status:'result',results:[{seat:3,camp:'好人陣營'}]});
 await act(f,'stage',{direction:1});await act(f,'stage',{direction:1});
 assert.deepEqual(await own(f),{status:'no-exile',results:[]});
 await act(f,'redeal');await f.edit(r=>r.players[0].role='守墓人');
 assert.deepEqual(await own(f),{status:'first-night',results:[]});
});
test('gravekeeper excludes manual/night deaths, ties and unconfirmed votes, and hides all exact roles',async()=>{
 const f=await fixture();await f.edit(r=>r.game.step=2);
 await act(f,'status',{seat:2,alive:false});await act(f,'stage',{direction:1});
 assert.equal((await own(f)).status,'no-exile');
 await f.edit(r=>{r.game.step=2;r.players[1].alive=true;});
 await act(f,'start-vote');let {room}=await f.state();
 for(const [seat,target] of [[1,2],[2,3]])await f.api('vote',{code:f.code,token:f.players[seat-1].token,round:room.round,voteId:room.game.voting.id,target});
 await act(f,'end-vote');assert.equal((await act(f,'eliminate-vote')).status,400);
 await act(f,'stage',{direction:1});assert.equal((await own(f)).status,'no-exile');
 await f.edit(r=>{r.game.step=2;r.game.voting=null;});await exile(f,3);await act(f,'stage',{direction:1});
 for(const response of [await f.state(),await f.state(f.players[1].token),await f.api('lookup',{code:f.code})]){
  assert.equal(response.room.game.gravekeeper,undefined);assert.equal(JSON.stringify(response).includes('exiles'),false);
 }
 const info=await own(f);assert.deepEqual(Object.keys(info.results[0]).sort(),['camp','seat']);
 await act(f,'status',{seat:1,alive:false});assert.deepEqual(await own(f),{status:'out',results:[]});
});
test('gravekeeper supports all camps, role authorization and legacy exile records',async()=>{
 const f=await fixture();
 for(const role of roleNames){
  await f.edit(r=>{r.players[0].role='守墓人';r.players[1].role=role;r.players[1].alive=true;r.game.step=2;r.game.voting=null;r.game.exiles={};});
  await exile(f,2);await act(f,'stage',{direction:1});
  assert.equal((await own(f)).results[0].camp,wolfRoles.has(role)?'狼人陣營':'好人陣營');
 }
 await f.edit(r=>{delete r.game.exiles;});
 assert.equal((await own(f)).results.length,1);
 for(const role of roleNames.filter(r=>r!=='守墓人')){await f.edit(r=>r.players[0].role=role);assert.equal(await own(f),undefined);}
});
