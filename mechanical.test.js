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
  await edit(r => { ['機械狼','通靈師','狼人','女巫','獵人','守衛'].forEach((role,i)=>r.players[i].role=role); });
  const state = token => api('state', { code, token: token || host.token });
  return { api, host, code, players, edit, state };
}


async function act(f,action,seat=null,extra={}) {
 const {room}=await f.state();return f.api(action,{code:f.code,token:seat?f.players[seat-1].token:f.host.token,round:room.round,revision:room.game.revision,step:room.game.step,nightId:room.game.nightId,...extra});
}
const skill=(f,kind,target,extra={})=>act(f,'mechanical',1,{kind,target,...extra});
const view=async f=>(await f.state(f.players[0].token)).room.game;
async function learned(role){const f=await fixture();await f.edit(r=>r.players[1].role=role);assert.equal((await skill(f,'learn',2)).status,200);return f;}
async function nextNight(f){await f.edit(r=>{r.game.step=3;});}
test('mechanical learning is private, once per game, early night only, concurrent safe, recoverable and reset',async()=>{
 const f=await fixture();
 for(const target of [1,99,null])assert.equal((await skill(f,'learn',target)).status,400);
 assert.equal((await act(f,'mechanical',3,{kind:'learn',target:2})).status,403);
 assert.equal((await skill(f,'learn',2,{nightId:'stale'})).status,409);
 const race=await Promise.all([skill(f,'learn',2),skill(f,'learn',4)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 assert.equal((await view(f)).mechanical.canLearn,false);assert.equal((await skill(f,'learn',3)).status,409);
 assert.equal((await view(f)).wolfTeammates,undefined);assert.equal((await view(f)).wolfNight,undefined);
 assert.deepEqual((await f.state(f.players[2].token)).room.game.wolfTeammates,[]);
 for(const res of [await f.state(),await f.state(f.players[1].token),await f.api('lookup',{code:f.code})])assert.equal(res.room.game.mechanical,undefined);
 const record=(await view(f)).mechanical.learn;assert.deepEqual((await view(f)).mechanical.learn,record);
 await act(f,'redeal');await f.edit(r=>r.players[0].role='機械狼');assert.equal((await view(f)).mechanical.learn,null);
 await act(f,'select-night',null,{seat:2});assert.equal((await skill(f,'learn',2)).status,409);
 await f.edit(r=>{r.game.step=2;r.game.nights={};});assert.equal((await skill(f,'learn',2)).status,409);
 await nextNight(f);assert.equal((await skill(f,'learn',2)).status,200);
});
test('mechanical psychic starts next night, checks exact role once/night, supports swaps and rollback',async()=>{
 const f=await learned('通靈師');assert.equal((await skill(f,'inspect',3)).status,409);
 await nextNight(f);await f.edit(r=>r.players[5].role='魔術師');
 assert.equal((await act(f,'swap',6,{targets:[3,4]})).status,200);
 assert.equal((await skill(f,'inspect',3)).room.game.mechanical.results[0].role,'女巫');
 assert.equal((await skill(f,'inspect',4)).status,409);
 await f.edit(r=>r.game.step=5);assert.equal((await skill(f,'inspect',3)).status,200);
 await f.edit(r=>r.game.step=3);assert.equal((await skill(f,'inspect',4)).status,409);
 assert.equal((await skill(f,'poison',4)).status,403);
 await f.edit(r=>r.players[0].alive=false);assert.equal((await skill(f,'inspect',4)).status,403);
});
test('mechanical poison is one bottle, deferred, pierces both guards, cannot bypass dream immunity and blocks hunter',async()=>{
 for(const shield of ['normal','mechanical','dream']){
  const f=await learned('女巫');assert.equal((await skill(f,'poison',5)).status,409);await nextNight(f);
  await f.edit(r=>{if(shield==='normal')r.game.guards={6:{3:{target:5}}};if(shield==='mechanical')r.game.mechanical[6]={learn:{step:0,role:'守衛'},guards:{3:{target:5}}};if(shield==='dream'){r.players[5].role='攝夢人';r.game.dreams={6:{3:{target:5,resolvedTarget:5}}};}});
  assert.equal((await skill(f,'poison',5)).status,200);assert.equal((await skill(f,'poison',3)).status,409);
  assert.equal((await f.state()).room.players[4].alive,true);await act(f,'settle-night');
  assert.equal((await f.state()).room.players[4].alive,shield==='dream');
  if(shield!=='dream')assert.equal((await act(f,'shoot',5,{target:3})).status,403);
  await f.edit(r=>r.game.step=5);assert.equal((await skill(f,'poison',3)).status,409);
 }
});
test('mechanical guard starts next night and stops knife, normal poison, milk, dream deaths and night gunfire',async()=>{
 for(const damage of ['knife','poison','milk','dream','shot']){
  const f=await learned('守衛');assert.equal((await skill(f,'guard',3)).status,409);await nextNight(f);
  assert.equal((await skill(f,'guard',3)).status,200);assert.equal((await skill(f,'guard',4)).status,409);
  await f.edit(r=>{
   if(['knife','milk'].includes(damage))r.game.nights[3]={target:3};
   if(damage==='poison')r.game.witches={4:{poison:{step:3,target:3}}};
   if(damage==='milk'){r.game.witches={4:{heal:{step:3,target:3}}};r.game.guards={6:{3:{target:3}}};}
   if(damage==='dream'){r.players[5].role='攝夢人';r.game.dreams={6:{0:{target:3,resolvedTarget:3},3:{target:3,resolvedTarget:3}}};}
   if(damage==='shot'){r.players[4].alive=false;r.game.deaths[5]={cause:'knife',step:3};}
  });
  if(damage==='shot'){assert.equal((await act(f,'shoot',5,{target:3})).status,200);assert.equal((await f.state(f.players[4].token)).room.game.hunter.shot.blocked,true);}
  await act(f,'settle-night');assert.equal((await f.state()).room.players[2].alive,true,damage);
  await f.edit(r=>r.game.step=5);assert.equal((await skill(f,'guard',3)).status,200);
 }
});
test('mechanical independent knife is next night, once/game, additive to wolf knife and subject to guard',async()=>{
 const f=await learned('狼人');assert.equal((await skill(f,'knife',4)).status,409);await nextNight(f);
 assert.equal((await act(f,'select-night',3,{seat:4})).status,200);
 assert.equal((await skill(f,'knife',5)).status,200);
 assert.equal((await f.state(f.players[2].token)).room.game.wolfNight.target,4);
 assert.equal((await view(f)).wolfNight,undefined);
 await act(f,'settle-night');const r=(await f.state()).room;
 assert.equal(r.players[3].alive,false);assert.equal(r.players[4].alive,false);
 assert.equal((await f.state(f.players[4].token)).room.game.hunter.canShoot,true);
 await f.edit(r=>r.game.step=5);assert.equal((await skill(f,'knife',2)).status,409);
 const blocked=await learned('狼人');await nextNight(blocked);await skill(blocked,'knife',5);await act(blocked,'guard',6,{target:5});await act(blocked,'settle-night');assert.equal((await blocked.state()).room.players[4].alive,true);
});
test('mechanical copied hunter follows hunter death eligibility and uniform anonymous gunfire',async()=>{
 for(const cause of ['knife','milk','exile','poison','dream','dream-link','manual','shot']){
  const f=await learned('獵人');await f.edit(r=>{r.game.step=3;r.players[0].alive=false;r.game.deaths[1]={cause,step:3};if(cause==='poison')r.game.poisonDeaths[1]={step:3};});
  const allowed=['knife','milk','exile'].includes(cause);assert.equal((await view(f)).hunter.canShoot,allowed,cause);
  const result=await act(f,'shoot',1,{target:3});assert.equal(result.status,allowed?200:403,cause);
  if(allowed){assert.equal((await f.state(f.players[1].token)).room.game.shotDeaths.includes(3),true);assert.equal((await act(f,'shoot',1,{target:4})).status,403);}
 }
});
test('mechanical learning uses mapped role, prevents late swap, and unsupported role grants no abilities',async()=>{
 const f=await fixture();await f.edit(r=>r.players[5].role='魔術師');await act(f,'swap',6,{targets:[2,4]});
 assert.equal((await skill(f,'learn',2)).room.game.mechanical.learn.role,'女巫');
 const after=await fixture();await after.edit(r=>r.players[5].role='魔術師');await skill(after,'learn',2);assert.equal((await act(after,'swap',6,{targets:[3,4]})).status,409);
 const no=await learned('村民');await nextNight(no);for(const kind of ['inspect','poison','guard','knife'])assert.equal((await skill(no,kind,3)).status,403);assert.equal((await skill(no,'learn',3)).status,409);
});
