const app=document.querySelector('#app');
function roleIcon(role){return role==='狼人'?'<svg class="wolf-icon role-line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.8 15.2c1.1-1.8 2.1-3 4.2-3s3.1 1.2 4.2 3c.6 1 2.2 1.8 2.2 3.2 0 1.5-1.2 2.5-2.6 2.4-1.4-.1-2.4-.8-3.8-.8s-2.4.7-3.8.8c-1.4.1-2.6-.9-2.6-2.4 0-1.4 1.6-2.2 2.2-3.2Z"/><ellipse cx="8.4" cy="7.4" rx="1.8" ry="3" transform="rotate(-15 8.4 7.4)"/><ellipse cx="15.6" cy="7.4" rx="1.8" ry="3" transform="rotate(15 15.6 7.4)"/><ellipse cx="3.8" cy="12" rx="1.5" ry="2.6" transform="rotate(-30 3.8 12)"/><ellipse cx="20.2" cy="12" rx="1.5" ry="2.6" transform="rotate(30 20.2 12)"/><path d="m7.8 4.4-.3-2m9 0-.3 2M2.5 9.8l-.8-1.3m19.8 1.3.8-1.3"/></svg>':role==='村民'?'<svg class="hoe-icon role-line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21 15.5 4M4 20.4l2 1.2M15.5 4 21 7.5l-2.7 4.3-5.5-3.5Z"/></svg>':descriptions[role][0];}
const descriptions={狼人:['♞','每晚與狼隊友選擇一名襲擊目標'],村民:['♧','聆聽發言，投票找出隱藏的狼人'],預言家:['✧','每晚可查驗一名玩家的陣營'],女巫:['⚗','擁有一瓶解藥與一瓶毒藥'],獵人:['⌖','符合桌規的出局情況下，可開槍帶走一人'],守衛:['♜','每晚可守護一名玩家']};
const defaults={6:{狼人:2,村民:2,預言家:1,女巫:1,獵人:0,守衛:0},7:{狼人:2,村民:3,預言家:1,女巫:1,獵人:0,守衛:0},8:{狼人:2,村民:3,預言家:1,女巫:1,獵人:1,守衛:0},9:{狼人:3,村民:3,預言家:1,女巫:1,獵人:1,守衛:0},10:{狼人:3,村民:4,預言家:1,女巫:1,獵人:1,守衛:0},11:{狼人:3,村民:4,預言家:1,女巫:1,獵人:1,守衛:1},12:{狼人:4,村民:4,預言家:1,女巫:1,獵人:1,守衛:1}};
const roleNames=['狼人','村民','預言家','女巫','獵人','守衛','白痴','騎士','狼王','白狼王','魔術師','攝夢人','石像鬼','守墓人','機械狼','狼美人','夢魘','血月使徒','獵魔人','通靈師'];
const wolfRoles=new Set(['狼人','狼王','白狼王','石像鬼','機械狼','狼美人','夢魘','血月使徒']);
for(const preset of Object.values(defaults))for(const role of roleNames)preset[role]??=0;
Object.assign(descriptions,{白痴:['☉','神職角色，放逐時的特殊效果依本局桌規執行'],騎士:['⚔','可發動決鬥，時機與結果由法官依桌規裁定'],狼王:['♛','狼人陣營，出局技能依本局桌規執行'],白狼王:['♕','狼人陣營，自爆帶人效果依本局桌規執行'],魔術師:['✦','神職角色，夜間交換效果由法官依桌規結算'],攝夢人:['☽','神職角色，夜間攝夢效果由法官依桌規結算'],石像鬼:['♟','狼人陣營，查驗及行動規則依本局桌規執行'],守墓人:['⚰','神職角色，獲取放逐資訊的規則依本局桌規執行'],機械狼:['⚙','狼人陣營，學習技能與行動規則依本局桌規執行']});
Object.assign(descriptions,{狼美人:['❦','狼人陣營，魅惑效果依本局桌規由法官結算'],夢魘:['☾','狼人陣營，夜間技能依本局桌規由法官結算'],血月使徒:['◐','狼人陣營，特殊技能依本局桌規由法官結算'],獵魔人:['⚔','神職角色，狩獵效果依本局桌規由法官結算'],通靈師:['✧','神職角色，查驗資訊依本局桌規由法官提供']});
let roleConfig={...defaults[9]};
function summarize(counts){const wolf=roleNames.filter(role=>wolfRoles.has(role)).reduce((sum,role)=>sum+(counts[role]||0),0),civilian=counts.村民||0,god=roleNames.filter(role=>role!=='村民'&&!wolfRoles.has(role)).reduce((sum,role)=>sum+(counts[role]||0),0);return `${wolf} 狼 · ${god} 神 · ${civilian} 民`;}
function totalRoles(){return roleNames.reduce((sum,role)=>sum+roleConfig[role],0);}
function setupError(){const total=totalRoles();if(total!==size)return total<size?`還需配置 ${size-total} 人`:`角色超出 ${total-size} 人`;const wolves=roleNames.filter(role=>wolfRoles.has(role)).reduce((sum,role)=>sum+roleConfig[role],0);if(wolves===0)return '至少需要 1 名狼人';if(wolves===size)return '至少需要 1 名好人';return '';}
let page='home',code='',size=9,selectedSeat=null,room=null,session=null;
let serverOffset=0,electionRefreshId=null;
let playerName='', playerPanel='board', voteSelection=undefined, selectedVoteId=null, sheriffPrivilege=true;
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function validName(){const name=playerName.trim();return name.length>0&&[...name].length<=20&&!/[\p{Cc}\p{Cf}]/u.test(name);}
let busy=false,polling=false,generation=0,holdTimer=null,holdId=null;
const storageKey='senye-seats-v2';
function saved(){try{return JSON.parse(localStorage.getItem(storageKey)||'{}');}catch{return {};}}
function remember(value){const all=saved();all[value.code]=value;try{localStorage.setItem(storageKey,JSON.stringify(all));localStorage.setItem('senye-active-v2',value.code);}catch{toast('瀏覽器無法保存憑證，請保持此分頁開啟。');}}
function forget(roomCode){const all=saved();delete all[roomCode];try{localStorage.setItem(storageKey,JSON.stringify(all));if(localStorage.getItem('senye-active-v2')===roomCode)localStorage.removeItem('senye-active-v2');}catch{}}
function toast(message){const target=document.querySelector('#toast');target.textContent=message;target.classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>target.classList.remove('visible'),4000);}
async function request(action,data,credential=session){
 const response=await fetch('/api/'+action+(data===undefined?'?code='+(credential?.code||code):''),{method:data===undefined?'GET':'POST',headers:data===undefined?{Authorization:credential?.token||''}:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify({...credential,...data})}),signal:AbortSignal.timeout(10000)});
 const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error),{status:response.status});return result;
}
function accept(result){if(result.serverTime)serverOffset=result.serverTime-Date.now();const oldRound=room?.round,oldVote=room?.game?.voting?.id;room=result.room;if(room.self&&(room.game?.election?.status==='signup'||room.self.alive===false||(room.game?.voting?.status==='active'&&oldVote!==room.game.voting.id)))playerPanel='board';code=room.code;if(result.token){session={code,token:result.token,seat:room.self?.seat,host:room.host};remember(session);}if(oldRound!==room.round){hideCard();if(room.self?.role)navigator.vibrate?.(100);}}
function topbar(){return '<header><a class="brand" href="/" aria-label="森夜首頁"><span>☾</span> 森夜 <small>一起入夜</small></a><span class="header-note">面對面，才好玩。</span></header>';}
function home(){return `<section class="join-page"><span class="eyebrow">TAKE YOUR SEAT</span><h1>今晚的故事，<br>就差你了。</h1><p>輸入房間碼，找到你的座位。</p><form id="code-form"><label for="room-code">4 位數房間碼</label><input id="room-code" aria-label="4 位數房間碼" inputmode="numeric" autocomplete="off" maxlength="4" pattern="[0-9]{4}" placeholder="– – – –" value="${code}" required><div class="keypad">${['1','2','3','4','5','6','7','8','9','clear','0','back'].map(k=>`<button type="button" data-action="digit" data-value="${k}" aria-label="${k==='clear'?'清除':k==='back'?'刪除一位':k}">${k==='clear'?'清除':k==='back'?'⌫':k}</button>`).join('')}</div><button class="primary full" id="enter" ${code.length!==4?'disabled':''}>選擇我的座位 <span>→</span></button></form><button class="text-button" data-action="create">我是法官，創建房間 ↗</button><div class="quiet-note">不必註冊。輸入名字，入座就入戲。</div></section>`;}
function create(){const error=setupError();return `<section class="setup"><button class="text-button back" data-action="home">← 返回</button><span class="eyebrow">HOST THE NIGHT</span><h1>人齊，就開局。</h1><p>設定人數與角色配置，把房間碼分享給朋友。<br>最後一人入座，系統自動盲發底牌。</p><div class="setup-heading"><h2>遊戲人數</h2><span>法官不佔座位</span></div><div class="size-options">${[6,7,8,9,10,11,12].map(n=>`<button class="size-option ${size===n?'selected':''}" data-action="board" data-size="${n}" aria-pressed="${size===n}" aria-label="${n} 人">${n}<small>人</small></button>`).join('')}</div><div class="setup-heading"><h2>角色配置</h2><button class="text-button" data-action="reset-config">恢復推薦配置 ↺</button></div><div class="config-summary">${summarize(roleConfig)}</div><div class="role-editor">${roleNames.map(role=>`<div class="role-row"><div class="role-info"><span class="role-symbol">${roleIcon(role)}</span><div><strong>${role}</strong><small>${wolfRoles.has(role)?'狼人陣營':role==='村民'?'平民':'神職'}</small></div></div><div class="role-counter"><button type="button" data-action="role-count" data-role="${role}" data-delta="-1" aria-label="減少${role}" ${roleConfig[role]===0?'disabled':''}>−</button><output aria-label="${role}人數">${roleConfig[role]}</output><button type="button" data-action="role-count" data-role="${role}" data-delta="1" aria-label="增加${role}" ${roleConfig[role]===size?'disabled':''}>＋</button></div></div>`).join('')}</div><div class="config-total ${error?'invalid':'valid'}" role="status"><strong>已配置 ${totalRoles()} / ${size} 人</strong><span>${error||'✓ 配置完成，可以建房'}</span></div><p class="setup-note">切換人數會載入推薦配置，各角色可自由調整。<br>支援階段推進、投票、預言家查驗與女巫藥水；其餘技能與勝負由法官裁定。</p><button class="primary full" data-action="make" ${error?'disabled':''}>創建房間 <span>＋</span></button></section>`;}
function seats(){return Array.from({length:room.size},(_,i)=>{const seat=i+1,player=room.players.find(p=>p.seat===seat),mine=session?.code===room.code&&session?.seat===seat,role=page==='room'&&room.host?player?.role:null;return `<button class="seat ${player?'occupied':''} ${mine?'mine':''} ${selectedSeat===seat?'selected':''}" data-action="seat" data-seat="${seat}" ${page!=='seats'||(player&&!mine)?'disabled':''} aria-label="${seat} 號${mine?'，我的座位':player?'，已入座':'，空位'}" aria-pressed="${selectedSeat===seat}"><span class="seat-number">${seat.toString().padStart(2,'0')}</span><span>${mine?'我的座位':player?'已入座':'空位'}</span>${player?.name?`<span class="seat-name">${escapeHtml(player.name)}</span>`:''}${role?`<span class="seat-role">${role}</span>`:''}</button>`;}).join('');}
function lobby(){const host=page==='room'&&room.host;return `<section class="lobby"><div class="lobby-head"><span class="eyebrow">${host?'JUDGE’S ROOM':'FIND YOUR SEAT'}</span>${page==='seats'?'<button class="text-button" data-action="home">返回</button>':''}</div><p class="code-label">房間碼</p><div class="room-code">${room.code}</div><div class="room-meta">${summarize(room.roleCounts||defaults[room.size])} <span>·</span> ${room.players.length} / ${room.size} 人入座</div><div class="divider"></div><h2>${host?(room.phase==='dealt'?'底牌已送達，交給你主持。':'朋友們正在入座。'):page==='seats'?'你坐在哪個位置？':`${room.self.seat} 號，已為你留好位。`}</h2><p>${host?(room.phase==='dealt'?'全知視角 · 請勿向玩家展示螢幕。':'玩家可在自己的手機私密查看底牌。'):page==='seats'?'選擇與實體座位相同的號碼。':'所有人到齊後，底牌將自動送達。'}</p><div class="seat-grid">${seats()}</div><div class="legend"><span><i class="green"></i>已入座</span><span><i></i>等待加入</span></div>${page==='seats'?`<div class="name-field"><label for="player-name">玩家名字 <span>必填 · 最多 20 字</span></label><input id="player-name" type="text" autocomplete="nickname" placeholder="輸入你的名字" value="${escapeHtml(playerName)}" required aria-required="true" aria-describedby="name-help"><p id="name-help">讓主持人與朋友認得你的座位。</p></div><button class="primary full" data-action="join" ${selectedSeat===null||!validName()?'disabled':''}>${selectedSeat?`確認 ${selectedSeat} 號座位`:'請先選擇座位'} <span>→</span></button>`:host?`<div class="host-status">${room.phase==='dealt'?`第 ${room.round} 局 · 已自動派牌`:'滿員後自動派牌，無需操作。'}</div><button class="secondary full" data-action="manage">重新發牌 / 解散房間</button>`:'<div class="waiting"><span></span> 等待朋友入座，請保持此頁開啟</div>'}</section>`;}
function identity(){return `<section class="identity"><div class="identity-top"><span>${room.self.seat.toString().padStart(2,'0')} 號座位${room.self.name?' · '+escapeHtml(room.self.name):''}</span><span>${room.code} · 第 ${room.round} 局</span></div><div class="card-wrap"><span class="eyebrow">ONLY YOU SHOULD KNOW</span><button type="button" class="hold-card" aria-label="長按我的底牌，鬆開立即隱藏"><span class="card-icon">☾</span><h1>我的底牌</h1><p>長按查看，鬆開隱藏</p><span class="hold-indicator">◎</span></button><p class="privacy-note">請遮好螢幕，再揭開你的秘密。</p></div><div class="identity-bottom">${room.game?'<button class="secondary" data-action="g-board">返回玩家看板</button>':'放下手機，回到這場相聚。'}</div></section>`;}
function render(){hideCard();const playing=page==='room'&&room?.phase==='dealt'&&room.game;const dark=page==='room'&&room?.self&&room.phase==='dealt'&&(!room.game||playerPanel==='card');document.body.classList.toggle('dark',Boolean(dark));app.innerHTML=dark?identity():topbar()+`<main>${playing?gameScreen():page==='home'?home():page==='create'?create():lobby()}</main><footer>森夜狼人殺 · 為真實的相聚而設計</footer>`;if(busy)app.querySelectorAll('button').forEach(b=>b.disabled=true);syncElectionDialog();}
async function run(task){if(busy)return;generation++;busy=true;hideCard();app.querySelectorAll('button').forEach(b=>b.disabled=true);try{await task();}catch(error){toast(error.message);}finally{busy=false;render();}}
async function enterRoom(){if(!/^\d{4}$/.test(code))return toast('請輸入 4 位數房間碼');generation++;selectedSeat=null;playerName='';session=saved()[code]||null;if(session){try{accept(await request('state'));page='room';return;}catch(error){if(![403,404].includes(error.status))throw error;forget(code);session=null;}}room=(await request('lookup')).room;page='seats';}
function updateCode(value){code=value.replace(/\D/g,'').slice(0,4);document.querySelector('#room-code').value=code;document.querySelector('#enter').disabled=code.length!==4;}
app.addEventListener('input',e=>{if(e.target.id==='room-code')updateCode(e.target.value);if(e.target.id==='player-name'){playerName=e.target.value;const join=app.querySelector('[data-action="join"]');if(join)join.disabled=busy||selectedSeat===null||!validName();}});
app.addEventListener('submit',e=>{if(e.target.id==='code-form'){e.preventDefault();run(enterRoom);}});
app.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b||busy)return;const a=b.dataset.action;if(a.startsWith('g-'))return gameAction(b);if(a==='digit')return updateCode(b.dataset.value==='clear'?'':b.dataset.value==='back'?code.slice(0,-1):code+b.dataset.value);if(a==='home'||a==='create'){generation++;page=a;render();}else if(a==='board'){size=Number(b.dataset.size);roleConfig={...defaults[size]};render();}else if(a==='reset-config'){roleConfig={...defaults[size]};render();}else if(a==='role-count'){const role=b.dataset.role;roleConfig[role]=Math.max(0,Math.min(size,roleConfig[role]+Number(b.dataset.delta)));render();}else if(a==='make')run(async()=>{generation++;if(setupError())throw Error(setupError());accept(await request('create',{size,roles:roleConfig},null));page='room';});else if(a==='seat'){selectedSeat=Number(b.dataset.seat);render();}else if(a==='join')run(async()=>{generation++;if(!validName())throw Error('請輸入 1～20 字的玩家名字');accept(await request('join',{code,seat:selectedSeat,name:playerName.trim()},saved()[code]));page='room';});else if(a==='manage')manage();});
function manage(){const d=document.createElement('dialog');d.innerHTML=`<h2>準備下一場故事</h2><p>重新發牌會覆蓋底牌、重設階段、警徽、投票與存活狀態，保留名字和座位；解散後所有人會離開房間。</p><button class="primary full" id="redeal" ${room.phase!=='dealt'?'disabled':''}>重新發牌</button><button class="danger full" id="dissolve">解散房間</button><button class="text-button full" id="cancel">繼續本局</button>`;document.body.append(d);d.showModal();d.querySelector('#cancel').onclick=()=>d.close();d.querySelector('#redeal').onclick=()=>{d.close();run(async()=>accept(await request('redeal',{})));};d.querySelector('#dissolve').onclick=()=>{d.close();run(async()=>{await request('dissolve',{});generation++;forget(code);session=null;room=null;code='';page='home';});};d.onclose=()=>d.remove();}
function hideCard(){clearTimeout(holdTimer);holdTimer=null;holdId=null;const card=app.querySelector('.hold-card');if(card){card.classList.remove('revealed');card.innerHTML='<span class="card-icon">☾</span><h1>我的底牌</h1><p>長按查看，鬆開隱藏</p><span class="hold-indicator">◎</span>';}}
function startHold(id){if(holdId!==null||busy||room?.self?.alive===false)return;holdId=id;holdTimer=setTimeout(()=>{const card=app.querySelector('.hold-card'),role=room?.self?.role;if(!card||!role||document.hidden)return hideCard();const[,description]=descriptions[role];card.classList.add('revealed');card.innerHTML=`<span class="card-icon">${roleIcon(role)}</span><h1>${role}</h1><p>${description}</p><span class="hold-indicator">鬆開立即隱藏</span>`;},350);}
app.addEventListener('pointerdown',e=>{if(e.target.closest('.hold-card')&&e.button===0){e.preventDefault();startHold(e.pointerId);}});
window.addEventListener('pointerup',hideCard);window.addEventListener('pointercancel',hideCard);
window.addEventListener('pointermove',e=>{if(holdId!==e.pointerId)return;const card=app.querySelector('.hold-card');if(!card)return hideCard();const b=card.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)hideCard();});
app.addEventListener('contextmenu',e=>{if(e.target.closest('.hold-card'))e.preventDefault();});
app.addEventListener('keydown',e=>{if(e.target.closest('.hold-card')&&[' ','Enter'].includes(e.key)){e.preventDefault();if(!e.repeat)startHold('keyboard');}});
window.addEventListener('keyup',e=>{if([' ','Enter'].includes(e.key))hideCard();});app.addEventListener('focusout',e=>{if(e.target.closest('.hold-card'))hideCard();});window.addEventListener('blur',hideCard);window.addEventListener('pagehide',hideCard);
async function refresh(){if(busy||polling||document.hidden||!['room','seats'].includes(page))return;polling=true;const version=generation;try{const result=await request(page==='seats'?'lookup':'state');if(version!==generation||busy)return;if(JSON.stringify(room)!==JSON.stringify(result.room)){accept(result);if(!document.querySelector('dialog')&&document.activeElement?.id!=='player-name')render();}syncElectionDialog();document.body.classList.remove('offline');}catch(error){if(version!==generation||busy)return;if([403,404].includes(error.status)){document.querySelector('dialog')?.close();forget(code);session=null;room=null;page='home';render();toast(error.message);}else if(!document.body.classList.contains('offline')){document.body.classList.add('offline');toast('暫時離線，已收到的底牌仍可查看；連線後會自動同步。');}}finally{polling=false;}}
 document.addEventListener('visibilitychange',()=>{hideCard();if(!document.hidden)refresh();});window.addEventListener('online',refresh);render();try{const active=localStorage.getItem('senye-active-v2');if(active&&saved()[active]){code=active;run(enterRoom);}}catch{}setInterval(refresh,2000);

const stageLabels=['第 1 晚','警長競選','第 1 天','第 2 晚','第 2 天','第 3 晚','第 3 天','第 4 晚','第 4 天','第 5 晚','第 5 天','第 6 晚','第 6 天'];
function seatLabel(seat){const p=room.players.find(p=>p.seat===seat);return `${String(seat).padStart(2,'0')} 號${p?.name?' · '+p.name:''}`;}
function voteAllowed(){const v=room.game?.voting;return room.self?.alive!==false&&v?.status==='active'&&v.eligible.includes(room.self?.seat)&&!Object.hasOwn(v,'ownVote');}
function voteSources(v){
 if(!v?.sources)return '';
 const names=seats=>seats.length?seats.map(seat=>escapeHtml(seatLabel(seat))).join('、'):'無';
 return `<section class="vote-sources"><h3>${v.kind==='sheriff'?'警長':'放逐'}投票來源</h3>${room.players.map(p=>`<div class="vote-source-row"><strong>${escapeHtml(seatLabel(p.seat))} <span>${v.counts?.[p.seat]||0} 票</span></strong><p>投票者：${(v.sources[p.seat]||[]).map(seat=>escapeHtml(seatLabel(seat))+'（'+(v.weights?.[seat]??1)+' 票）').join('、')||'無'}</p></div>`).join('')}<div class="vote-source-row"><strong>棄權</strong><p>${names(v.abstainers||[])}</p></div><div class="vote-source-row"><strong>未投票</strong><p>${names(v.unvoted||[])}</p></div>${v.excluded?.length?`<div class="vote-source-row"><strong>平票禁投（不計入未投票）</strong><p>${names(v.excluded)}</p></div>`:''}</section>`;
}
function voteResult(v){
 if(v?.status==='cancelled')return '<div class="notice">玩家狀態或警徽已變更，本輪投票作廢。請等待法官重新發起。</div>';
 if(v?.status!=='ended')return '';
 if(v.kind==='sheriff')return `<div class="vote-result"><strong>${v.winner?escapeHtml(seatLabel(v.winner))+' 當選警長，已自動授予警徽':(v.leaders?.length>1?'警長票平票：'+v.leaders.join('、')+' 號，請法官安排重投':'無有效警長票，未授予警徽')}</strong><p>已投 ${v.submitted.length} / ${v.eligible.length} 人 · 棄權 ${v.abstentions} 票</p>${voteSources(v)}</div>`;
 const leaders=v.leaders||[],lead=leaders.length===0?'無有效得票，本輪無人出局':leaders.length>1?`平票：${leaders.map(n=>n+' 號').join('、')}，上述玩家下次重投暫停投票權`:`最高票：${escapeHtml(seatLabel(leaders[0]))}`;
 return `<div class="vote-result"><strong>${lead}</strong><p>已投 ${v.submitted.length} / ${v.eligible.length} 人 · 棄權 ${v.abstentions} 票</p><div class="tally-list">${room.players.map(p=>`<span>${p.seat} 號 <b>${v.counts?.[p.seat]||0}</b> 票</span>`).join('')}</div>${voteSources(v)}${v.eliminated?`<p>已確認 ${v.eliminated} 號出局</p>`:room.host&&leaders.length===1&&room.players.find(p=>p.seat===leaders[0])?.alive?'<button class="danger full" data-action="g-eliminate-vote">確認淘汰最高票玩家</button>':''}</div>`;
}
function gameScreen(){
 const g=room.game,v=g.voting,host=room.host,alive=room.players.filter(p=>p.alive).length;
 if(selectedVoteId!==v?.id){selectedVoteId=v?.id;voteSelection=undefined;sheriffPrivilege=true;}
 if(voteSelection!=null&&!room.players.some(p=>p.seat===voteSelection&&p.alive))voteSelection=undefined;
 if(!host&&room.self.alive===false)playerPanel='board';
 return `<section class="game-shell ${!host&&room.self.alive===false?'spectator':''}"><div class="game-meta"><span>${host?'法官全知視角':'玩家看板'} · 房間 ${room.code} · 第 ${room.round} 局</span><span>存活 ${alive} / ${room.size}</span></div><div class="phase-banner ${g.stage.type==='night'?'night-banner':''}"><div><span class="eyebrow">${host?'PHASE '+(g.step+1)+' / 13':'CURRENT PHASE'}</span><h1>${g.stage.label}</h1><p>${host?'全場底牌僅法官可見，請勿展示螢幕。':escapeHtml(seatLabel(room.self.seat))+(room.self.alive?' · 存活':' · 已出局，僅可觀戰')}</p></div><span class="phase-icon">${g.stage.type==='night'?'☾':g.stage.type==='election'?'♔':'☀'}</span></div>${host?hostControls():playerControls()}<div class="board-heading"><h2>${host?'全場玩家':'玩家列表'}</h2><span>♔ ${g.sheriff?escapeHtml(seatLabel(g.sheriff)):'尚未指定警長'}</span></div><div class="game-grid">${room.players.map(p=>gamePlayer(p,host)).join('')}</div>${!host?seerPanel()+witchPanel()+playerVoteBar():''}${voteResult(v)}${host&&v?.status==='active'?voteSources(v):''}${host?`<details class="game-history"><summary>主持紀錄（${g.history.length}）</summary>${g.history.map(item=>`<p><small>${item.stage}</small> ${escapeHtml(item.text)}</p>`).join('')||'<p>尚無操作紀錄</p>'}</details><button class="secondary full" data-action="manage">重新發牌 / 解散房間</button>`:''}</section>`;
}
function exclusionNotice(){const v=room.game.voting,seats=v?.status==='active'?v.excluded:room.game.nextVoteExcluded;return seats?.length?`<p class="notice">平票禁投：${seats.map(n=>escapeHtml(seatLabel(n))).join('、')}。${v?.status==='active'?'本次':'下次'}重投不可投票，仍可被投。</p>`:'';}
function hostControls(){
 const g=room.game,v=g.voting,night=g.night;
 return `<div class="phase-actions"><button class="secondary" data-action="g-prev" ${g.step===0||v?.status==='active'?'disabled':''}>← 回退上一階段</button><button class="primary" data-action="g-next" ${g.step===12||v?.status==='active'?'disabled':''}>${g.step===12?'已到第 6 天':`進入下個階段：${stageLabels[g.step+1]} →`}</button></div>${v?.status==='active'?'<p class="hint">投票進行中，請先結束投票再推進流程。</p>':''}<section class="control-panel">${g.stage.type==='night'?`<h2>☾ 狼人刀人 · 暫存區</h2><p>${night.settled?'本晚已公布。若需修正，請操作玩家的出局／恢復按鈕。':'目標也會顯示給仍有解藥的存活女巫；解藥、毒藥於公布或推進階段時統一結算。'}</p><div class="target-options">${room.players.filter(p=>p.alive).map(p=>`<button class="target-chip ${night.target===p.seat?'selected':''}" data-action="g-night" data-seat="${p.seat}" aria-pressed="${night.target===p.seat}" ${night.settled?'disabled':''}>${p.seat} 號 ${escapeHtml(p.name||'')}</button>`).join('')}</div><p role="status">結算預覽：${escapeHtml(nightOutcome())}</p><div class="panel-footer"><strong>${night.settled?'已公布':`暫存：${night.target?escapeHtml(seatLabel(night.target)):'平安夜'}`}</strong><button class="text-button" data-action="g-clear-night" ${night.settled?'disabled':''}>清空目標</button><button class="primary" data-action="g-settle-night" ${night.settled?'disabled':''}>公布夜間結算</button></div>`:g.stage.type==='election'?electionPanel(true):`<h2>☀ 全員放逐投票</h2><p>具投票資格的存活玩家一票；警長可選擇 1.5 票。可投自己或棄權。提交後無法更改。</p>${exclusionNotice()}${v?.status==='active'?`<div class="panel-footer"><strong>已投 ${v.submitted.length} / ${v.eligible.length} 人</strong><button class="primary" data-action="g-end-vote">結束投票</button></div>`:'<button class="primary full" data-action="g-start-vote">發起投票</button>'}`}</section>${g.sheriff?'<button class="text-button" data-action="g-clear-sheriff">收回警徽</button>':''}`;
}
function playerControls(){
 const v=room.game.voting;
 if(room.game.stage.type==='election')return electionPanel(false);
 const text=room.self.alive===false?'你已出局，僅可觀戰。':v?.status==='active'&&!v.eligible.includes(room.self.seat)?'你是上一輪最高票平票玩家，本次重投暫停投票權，仍可被投。':v?.status==='active'?Object.hasOwn(v,'ownVote')?`您已${v.ownVote===null?'棄權':'投給 '+v.ownVote+' 號玩家'}，請等待法官結算。`:'請選擇你投出的玩家。可投自己，或選擇棄權。':'等待法官發起投票，當前點擊卡片不會投票。';
 return `<div class="player-toolbar"><p role="status">${text}</p><button class="secondary" data-action="g-card" ${room.self.alive===false?'disabled':''}>查看我的底牌</button></div>`;
}
function gamePlayer(p,host){
 const g=room.game,v=g.voting,selected=voteSelection===p.seat,canVote=voteAllowed(),status=v?.status==='active'?(v.eligible.includes(p.seat)?v.submitted.includes(p.seat)?'已投':'未投':v.excluded?.includes(p.seat)?'平票禁投':v.kind==='sheriff'?'本輪候選 · 無警長票':'不參與'):(p.alive?'存活':'☠ 已出局');
 const candidate=g.stage.type==='election'&&(v?.kind==='sheriff'?v.candidates:g.election?.candidates)?.includes(p.seat);
 const content=`${candidate?'<span class="badge">上警</span>':''}<span class="player-seat">${String(p.seat).padStart(2,'0')} ${g.sheriff===p.seat?'<span class="badge" aria-label="警長">♔</span>':''}</span><strong class="player-name">${escapeHtml(p.name||'玩家 '+p.seat)}</strong>${host?`<span class="player-role">${p.role}</span>`:''}<span class="player-state">${p.alive?status:'☠ 已出局'}</span>${host&&v?.status==='active'?`<span class="player-tally">${v.counts?.[p.seat]||0} 票</span>`:''}`;
 if(!host)return `<button class="player-tile ${p.alive?'alive':'dead'} ${selected&&canVote?'selected':''}" data-action="g-select-vote" data-seat="${p.seat}" aria-label="${escapeHtml(seatLabel(p.seat))}，${p.alive?'存活':'已出局'}" aria-pressed="${selected&&canVote}" ${!p.alive||!canVote||(v?.kind==='sheriff'&&!v.candidates.includes(p.seat))?'disabled':''}>${content}${selected&&canVote?'<span class="selected-check">✓ 已選中</span>':''}</button>`;
 return `<article class="player-tile ${p.alive?'alive':'dead'}">${content}<div class="player-admin"><button class="${p.alive?'danger':'secondary'}" data-action="g-status" data-seat="${p.seat}" data-alive="${!p.alive}">${p.alive?'令其出局':'恢復存活'}</button><button class="text-button" data-action="g-sheriff" data-seat="${p.seat}" ${!p.alive||g.sheriff===p.seat||(g.stage.type==='election'&&['signup','voting'].includes(g.election?.status))?'disabled':''}>${g.sheriff===p.seat?'♔ 持有警徽':'授予警徽'}</button></div></article>`;
}
function seerPanel(){
 const seer=room.game.seer;
 if(!seer)return '';
 return `<section class="control-panel seer-panel"><h2>✧ 預言家查驗</h2><p>每晚可查驗一名其他存活玩家，確認後不可更改。結果僅你可見。</p>${seer.canInspect?`<div class="target-options">${room.players.filter(p=>p.alive&&p.seat!==room.self.seat).map(p=>`<button class="target-chip" data-action="g-inspect" data-seat="${p.seat}">查驗 ${escapeHtml(seatLabel(p.seat))}</button>`).join('')}</div>`:`<p class="hint">${room.self.alive===false?'已出局，無法查驗。':room.game.stage.type!=='night'?'請等待下一個夜晚。':seer.results.some(r=>r.step===room.game.step)?'本晚已使用查驗。':'本晚已結算，無法查驗。'}</p>`}<div role="status">${seer.results.map(r=>`<p><strong>${stageLabels[r.step]} · ${escapeHtml(seatLabel(r.target))}：${escapeHtml(r.camp)}</strong></p>`).join('')||'<p class="hint">尚無查驗紀錄</p>'}</div></section>`;
}
function witchPanel(){
 const w=room.game.witch,notice=room.game.hunterPoisoned;
 if(notice)return `<section class="control-panel" role="status"><h2>☠ 毒殺通知</h2><p>你在${stageLabels[notice.step]}被女巫毒殺，已淘汰出局。</p></section>`;
 if(!w)return '';
 return `<section class="control-panel witch-panel"><h2>⚗ 女巫藥水</h2><p>解藥、毒藥每局各一次。同一晚只能用一種，確認後不可撤銷；公布夜間結算時生效。</p><h3>解藥特權 · ${w.healAvailable?'剩餘 1 次':'已使用'}</h3>${Object.hasOwn(w,'knifeTarget')?`<p>今晚刀人目標：${w.knifeTarget?escapeHtml(seatLabel(w.knifeTarget)):'尚無目標'}</p>${w.knifeTarget?`<button class="primary" data-action="g-heal" data-seat="${w.knifeTarget}" ${!w.canUse?'disabled':''}>使用解藥</button>`:''}`:'<p class="hint">'+(w.healAvailable?'僅存活且未結算的夜晚可查看刀人目標。':'解藥已使用，不再顯示刀人號碼。')+'</p>'}<h3>毒藥特權 · ${w.poisonAvailable?'剩餘 1 次':'已使用'}</h3>${w.canUse&&w.poisonAvailable?`<div class="target-options">${room.players.filter(p=>p.alive).map(p=>`<button class="target-chip" data-action="g-poison" data-seat="${p.seat}">毒殺 ${escapeHtml(seatLabel(p.seat))}</button>`).join('')}</div>`:'<p class="hint">'+(w.usedTonight?'本晚已使用藥水，不能再用另一種。':room.self.alive===false?'已出局，無法使用。':w.poisonAvailable?'請等待未結算的夜晚。':'毒藥已使用。')+'</p>'}</section>`;
}
function nightOutcome(){const n=room.game.night;return [n.target&&!n.healed?.includes(n.target)?n.target+' 號被刀出局':n.target?n.target+' 號已用解藥豁免刀人':'無刀人出局',...(n.poisoned||[]).map(seat=>seat+' 號被毒殺出局')].join('；');}
function playerVoteBar(){
 const v=room.game.voting;
 if(v?.status!=='active')return '';
 if(!voteAllowed())return `<div class="vote-submit locked">${room.self.alive===false?'已出局 · 僅可觀戰':!v.eligible.includes(room.self.seat)?(v.kind==='sheriff'?'本輪候選人無警長票 · 等待投票結束':'平票禁投 · 等待本次重投結束'):`已投票（等待其他人）${v.ownVote===null?' · 已棄權':' · 本票計 '+(v.ownWeight??1)+' 票'}`}</div>`;
 const privilege=v.kind!=='sheriff'&&room.game.sheriff===room.self.seat;
 return `${privilege?`<section class="control-panel"><h2>♔ 警徽特權</h2><p>本次放逐票：${sheriffPrivilege?'1.5':'1'} 票。提交前可切換，提交後鎖定。</p><div class="target-options"><button class="target-chip ${sheriffPrivilege?'selected':''}" data-action="g-privilege" data-value="yes" aria-pressed="${sheriffPrivilege}">是 · 1.5 票</button><button class="target-chip ${!sheriffPrivilege?'selected':''}" data-action="g-privilege" data-value="no" aria-pressed="${!sheriffPrivilege}">否 · 1 票</button></div></section>`:''}<div class="vote-submit"><strong>${voteSelection===undefined?'請選擇玩家或棄權':voteSelection===null?'已選擇棄權':`選中 ${voteSelection} 號玩家`}</strong><div><button class="secondary ${voteSelection===null?'selected':''}" data-action="g-abstain" aria-pressed="${voteSelection===null}">棄權</button><button class="primary" data-action="g-submit-vote" ${voteSelection===undefined?'disabled':''}>確認投票</button></div></div>`;
}
function gameConfirm(title,message,submit){
 if(document.querySelector('dialog'))return;
 const dialog=document.createElement('dialog');
 dialog.innerHTML=`<h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p><button class="primary full" data-confirm>確認</button><button class="text-button full" data-cancel>取消</button>`;
 document.body.append(dialog);
 dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
 dialog.querySelector('[data-confirm]').onclick=()=>{dialog.close();run(submit);};
 dialog.onclose=()=>{dialog.remove();render();};
 dialog.showModal();dialog.querySelector('[data-cancel]').focus();
}
async function sendGame(action,payload){
 try{accept(await request(action,payload));}catch(error){if(error.status===409){try{accept(await request('state'));}catch{}}throw error;}
}
function gameAction(button){
 const action=button.dataset.action,g=room.game;
 if(action==='g-privilege'){if(voteAllowed()&&g.voting.kind!=='sheriff'&&g.sheriff===room.self.seat){sheriffPrivilege=button.dataset.value==='yes';render();}return;}
 if(action==='g-board'){playerPanel='board';render();return;}
 if(action==='g-card'){if(room.self.alive===false)return;playerPanel='card';render();return;}
 if(action==='g-select-vote'||action==='g-abstain'){if(!voteAllowed())return;voteSelection=action==='g-abstain'?null:Number(button.dataset.seat);render();return;}
 const stamp={round:room.round,revision:g.revision};
 const confirm=(title,message,api,extra={})=>gameConfirm(title,message,()=>sendGame(api,{...stamp,...extra}));
 if(action==='g-submit-vote'){
  if(!voteAllowed()||voteSelection===undefined)return;
  const target=voteSelection,voteId=g.voting.id;
  const privilege=g.voting.kind!=='sheriff'&&g.sheriff===room.self.seat;
  confirm('確認投票',`${target===null?'確定棄權嗎？':`確定將${g.voting.kind==='sheriff'?'警長票':'票'}投給 ${target} 號玩家嗎？本票計 ${privilege&&sheriffPrivilege?1.5:1} 票。`}提交後不可更改。`,'vote',{target,voteId,...(privilege?{sheriffPrivilege}:{})});return;
 }
 if(action==='g-inspect'){if(!g.seer?.canInspect)return;const target=Number(button.dataset.seat);confirm('確認查驗',`確定查驗 ${seatLabel(target)} 的陣營？每晚僅一次，確認後不可更改。`,'inspect',{target,step:g.step});return;}
 if(action==='g-heal'||action==='g-poison'){const w=g.witch,kind=action==='g-heal'?'heal':'poison',target=Number(button.dataset.seat);if(!w?.canUse||!(kind==='heal'?w.healAvailable:w.poisonAvailable))return;confirm(kind==='heal'?'使用解藥':'使用毒藥',`確定對 ${seatLabel(target)} 使用${kind==='heal'?'解藥，豁免本晚刀人':'毒藥，夜間結算時淘汰'}？每局僅一次，本晚不能再用另一種藥水。`,'potion',{kind,target,step:g.step});return;}
 if(!room.host)return;
 const seat=Number(button.dataset.seat);
 if(action==='g-next'||action==='g-prev'){
  const direction=action==='g-next'?1:-1,next=g.step+direction;
  if(next<0||next>12)return;
  const nightMessage=g.stage.type==='night'&&!g.night.settled&&direction===1?`同時公布${nightOutcome()}。`:'';
  confirm('切換階段',`確定進入「${stageLabels[next]}」？${nightMessage}${direction===-1?'回退不會撤銷已公布的出局或警徽；如需修正，請手動恢復。':''}`,'stage',{direction});
 }else if(action==='g-night'||action==='g-clear-night')run(()=>sendGame('night',{...stamp,seat:action==='g-clear-night'?null:seat}));
 else if(action==='g-settle-night')confirm('公布夜間結算',`確定公布${nightOutcome()}？公布後所有玩家會看到存活狀態。`,'settle-night');
 else if(action==='g-status'){const alive=button.dataset.alive==='true';confirm(alive?'恢復存活':'手動出局',`確定將 ${seatLabel(seat)} 設為${alive?'存活':'出局'}嗎？${g.voting?.status==='active'?'這會將當前投票作廢，需重新發起。':''}`,'status',{seat,alive});}
 else if(action==='g-sheriff'||action==='g-clear-sheriff')confirm('警徽標記',action==='g-clear-sheriff'?'確定收回警徽？投票進行中會作廢本輪，需重新發起。':`確定授予 ${seatLabel(seat)} 警徽？投票進行中會作廢本輪，需重新發起。`,'sheriff',{seat:action==='g-clear-sheriff'?null:seat});
 else if(action==='g-start-vote')confirm('發起投票',g.stage.type==='election'?'重新開放警長投票。平票時僅並列最高票者為候選人、不可投票；其餘存活玩家各有一票，僅可投本輪候選人。':`向具資格的存活玩家開放投票。${g.nextVoteExcluded?.length?'平票玩家 '+g.nextVoteExcluded.join('、')+' 號本次禁投，仍可被投。':''}新投票將取代上一輪結果。`,'start-vote');
 else if(action==='g-end-vote')confirm('結束投票',`目前 ${g.voting.submitted.length} / ${g.voting.eligible.length} 人已投。確定結束並公布結果？未投玩家不計票。`,'end-vote');
 else if(action==='g-eliminate-vote')confirm('確認投票出局',`確定淘汰 ${seatLabel(g.voting.leaders[0])}？`,'eliminate-vote');
}

function electionPanel(host){
 const e=room.game.election,v=room.game.voting;
 if(!e)return '<h2>♔ 警長競選</h2><p>此舊房間可手動授予警徽；重新進入此階段會開始自動競選。</p>';
 const seconds=Math.max(0,Math.ceil((e.deadline-Date.now()-serverOffset)/1000));
 if(e.status==='signup')return `<div class="election-panel"><h2>♔ 是否上警</h2><p>剩餘 <strong data-election-countdown>${seconds}</strong> 秒 · 超時預設「否」</p><p>已回覆 ${e.answered.length} / ${e.participants.length} 人</p><p>${!host&&Object.hasOwn(e,'ownChoice')?(e.ownChoice?'你已選擇上警，沒有警長票。':'你已選擇不上警，稍後可投警長票。'):'上警玩家成為候選人，其餘存活玩家每人一票。'}</p></div>`;
 const own= v&&Object.hasOwn(v,'ownVote');
 const info=host?`已投 ${v?.submitted.length||0} / ${v?.eligible.length||0} 人`:room.self.alive===false?'已出局，僅可觀戰':v?.status==='active'?!v.eligible.includes(room.self.seat)?'你是本輪候選人，本次沒有警長票。':own?`你已${v.ownVote===null?'棄權':'投給 '+v.ownVote+' 號'}，等待結算。`:'請選擇一位上警候選人，投出你的警長票。':'警長投票已結束。';
 return `<div class="election-panel"><h2>♔ 警長投票</h2><p>候選人：${(v?.candidates||e.candidates).map(n=>escapeHtml(seatLabel(n))).join('、')||'無人上警'}</p><p>${info}</p><p>票收齊後自動結算，唯一最高票者自動獲得警徽。</p>${host?(v?.status==='active'?'<button class="primary full" data-action="g-end-vote">結束警長投票</button>':e.candidates.length&&v?.eligible.length?'<button class="primary full" data-action="g-start-vote">重新發起警長投票</button>':'<p>無候選人或無投票者，可繼續下一階段或手動處理警徽。</p>'):''}</div>`;
}
function syncElectionDialog(){
 const e=room?.game?.election,remaining=e?e.deadline-Date.now()-serverOffset:0;
 let d=document.querySelector('#election-dialog');
 const should=page==='room'&&room?.self?.alive&&room.game.step===1&&e?.status==='signup'&&e.participants.includes(room.self.seat)&&!Object.hasOwn(e,'ownChoice')&&remaining>0;
 if(!should){d?.close();return;}
 if(busy)return;
 if(d?.dataset.election===e.id)return;
 d?.close();document.querySelector('dialog')?.close();
 d=document.createElement('dialog');d.id='election-dialog';d.dataset.election=e.id;
 d.innerHTML=`<h2>是否上警？</h2><p>剩餘 <strong data-election-countdown>${Math.ceil(remaining/1000)}</strong> 秒，超時預設「否」。</p><p>選「是」成為候選人，沒有警長票。</p><button class="primary full" data-choice="yes">是</button><button class="secondary full" data-choice="no">否</button>`;
 const electionId=e.id,round=room.round;
 for(const button of d.querySelectorAll('[data-choice]'))button.onclick=()=>{if(busy)return;d.close();run(()=>sendGame('nominate',{electionId,round,choice:button.dataset.choice==='yes'}));};
 d.oncancel=event=>event.preventDefault();d.onclose=()=>d.remove();document.body.append(d);d.showModal();
}
setInterval(()=>{
 const e=room?.game?.election;
 if(page!=='room'||room?.game?.step!==1||e?.status!=='signup')return;
 const seconds=Math.max(0,Math.ceil((e.deadline-Date.now()-serverOffset)/1000));
 document.querySelectorAll('[data-election-countdown]').forEach(el=>el.textContent=seconds);
 syncElectionDialog();
 if(seconds===0&&electionRefreshId!==e.id){electionRefreshId=e.id;refresh();}
},250);
