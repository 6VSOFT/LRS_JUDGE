import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoomStore} from './lib/blob-store.js';
import {MemoryStore} from './lib/memory-store.js';
import {handleRequest} from './lib/rooms.js';

test('blob adapter rejects SDK phantom successes and preserves conditional write/read options',async()=>{
 const calls=[];let response={modified:true,etag:''};
 const blobs={setJSON:async(...args)=>{calls.push(args);return response;},getWithMetadata:async(...args)=>{calls.push(args);return {data:{test:true},etag:'read-version'};}};
 const store=createRoomStore(blobs);
 assert.equal(await store.write('room',{},'old'),false);assert.deepEqual(calls.pop()[2],{onlyIfMatch:'old'});
 response={modified:false};assert.equal(await store.write('room',{},'old'),false);
 response={modified:true,etag:'new'};assert.equal(await store.write('room',{}),true);assert.deepEqual(calls.pop()[2],{onlyIfNew:true});
 assert.equal((await store.read('room')).etag,'read-version');assert.deepEqual(calls.pop()[1],{type:'json',consistency:'strong'});
});
test('room retries phantom failures and recovers its own committed but unacknowledged join without allowing impersonation',async()=>{
 for(const applied of [false,true]){
  const memory=new MemoryStore();let phantom=false;
  const store=createRoomStore({getWithMetadata:key=>memory.read(key),setJSON:async(key,data,options)=>{
   if(phantom){phantom=false;if(applied)await memory.write(key,data,options.onlyIfMatch);return {modified:true,etag:''};}
   const modified=await memory.write(key,data,options.onlyIfMatch);return modified?{modified:true,etag:'confirmed'}:{modified:false};
  }});
  const api=async(action,body)=>{const r=await handleRequest(new Request('http://test/api/'+action,{method:'POST',body:JSON.stringify(body)}),store);return {status:r.status,...await r.json()};};
  const host=await api('create',{size:6});assert.equal(host.status,200);
  phantom=true;const joined=await api('join',{code:host.room.code,seat:1,name:'測試'});assert.equal(joined.status,200);assert.equal(joined.room.self.seat,1);
  assert.equal((await memory.read(host.room.code)).data.players.length,1);
  assert.equal((await api('join',{code:host.room.code,seat:1,name:'冒領'})).status,409);
 }
});
