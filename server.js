import http from 'node:http';
import { randomInt, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const rooms = new Map();
const configs = {6:['狼人','狼人','預言家','女巫','村民','村民'],9:['狼人','狼人','狼人','預言家','女巫','獵人','村民','村民','村民'],12:['狼人','狼人','狼人','狼人','預言家','女巫','獵人','守衛','村民','村民','村民','村民']};
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function deal(room){
 const deck=[...configs[room.size]];
 for(let i=deck.length-1;i>0;i--){const j=randomInt(i+1);[deck[i],deck[j]]=[deck[j],deck[i]];}
 room.players.forEach((p,i)=>{p.role=deck[i];p.confirmed=false;});room.phase='dealt';room.round++;
}
function publicView(r){return {code:r.code,size:r.size,phase:r.phase,round:r.round,players:r.players.map(p=>({seat:p.seat,confirmed:p.confirmed}))};}
function privateView(r,token){const host=token===r.host,player=r.players.find(p=>p.token===token);if(!host&&!player)fail('此裝置沒有該座位的憑證，請使用原本的瀏覽器。',403);return {...publicView(r),host,self:player?{seat:player.seat,role:player.role,confirmed:player.confirmed}:null};}
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
   const action=url.pathname.slice(5);let body={};
   if(req.method==='POST'){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>10000)fail('請求過大');}body=JSON.parse(raw||'{}');}
   let token=body.token||req.headers.authorization,room,result;
   if(action==='create'&&req.method==='POST'){
    const size=Number(body.size);if(!configs[size])fail('請選擇有效角色配置');if(rooms.size>=9000)fail('房間已滿，請稍後再試',503);
    let code;do{code=String(randomInt(1000,10000));}while(rooms.has(code));token=randomUUID();room={code,size,host:token,phase:'lobby',round:0,players:[]};rooms.set(code,room);
   }else{
    room=rooms.get(String(body.code||url.searchParams.get('code')||''));if(!room)fail('房間不存在或已解散，請確認 4 位數房間碼。',404);
    if(action==='lookup'&&req.method==='GET')result={room:publicView(room)};
    else if(action==='state'&&req.method==='GET'){}
    else if(action==='join'&&req.method==='POST'){
     const seat=Number(body.seat);if(!Number.isInteger(seat)||seat<1||seat>room.size)fail('請選擇有效座位');
     const occupant=room.players.find(p=>p.seat===seat),existing=room.players.find(p=>p.token===token);
     if(occupant){if(occupant.token!==token)fail('此座位已有人。恢復身分請使用原本的瀏覽器。',409);}
     else{if(existing||token===room.host)fail('你已在此房間，無法重複入座。',409);if(room.phase!=='lobby')fail('本局已派牌，無法加入。',409);token=randomUUID();room.players.push({seat,token,confirmed:false});room.players.sort((a,b)=>a.seat-b.seat);if(room.players.length===room.size)deal(room);}
    }else if(action==='confirm'&&req.method==='POST'){
     const p=room.players.find(p=>p.token===token);if(!p)fail('座位憑證無效',403);if(room.phase!=='dealt'||body.round!==room.round)fail('身分已更新，請重新查看底牌。',409);p.confirmed=true;
    }else if(['redeal','dissolve'].includes(action)&&req.method==='POST'){
     if(token!==room.host)fail('僅法官可操作',403);
     if(action==='dissolve'){rooms.delete(room.code);result={dissolved:true};}else{if(room.players.length!==room.size)fail('請等待所有座位入座');deal(room);}
    }else fail('無效操作',404);
   }
   result??={token,room:privateView(room,token)};res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));return;
  }
  const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};const file=files[url.pathname];if(!file)fail('Not found',404);
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');res.setHeader('Cache-Control','no-cache');res.end(await readFile(new URL('./public/'+file,import.meta.url)));
 }catch(error){res.writeHead(error.status||400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
});
server.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('森夜狼人殺 · http://localhost:'+(process.env.PORT||3000)));
