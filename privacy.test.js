import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('hold card hides on release, cancellation, blur, visibility and render',()=>{
 const events={},timers=new Map();let nextTimer=0;
 const classes=new Set();
 const card={innerHTML:'',classList:{add:c=>classes.add(c),remove:c=>classes.delete(c)},getBoundingClientRect:()=>({left:0,right:100,top:0,bottom:100})};
 const confirm={disabled:true,textContent:''};
 const app={innerHTML:'',querySelector:s=>s==='.hold-card'?card:s==='.confirm'?confirm:null,querySelectorAll:()=>[],addEventListener:(n,fn)=>events['app:'+n]=fn};
 const document={hidden:false,querySelector:s=>s==='#app'?app:null,body:{classList:{toggle(){},remove(){},contains(){return false;}}},addEventListener:(n,fn)=>events['doc:'+n]=fn};
 const context=vm.createContext({document,window:{addEventListener:(n,fn)=>events['win:'+n]=fn},localStorage:{getItem:()=>null},setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer;},clearTimeout:id=>timers.delete(id),setInterval(){},navigator:{},console});
 vm.runInContext(readFileSync('public/app.js','utf8'),context);
 vm.runInContext("room={code:'1234',phase:'dealt',round:1,self:{seat:1,role:'預言家',confirmed:false}};page='room';",context);
 const advance=()=>{const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());};
 const press=()=>events['app:pointerdown']({target:{closest:()=>card},button:0,pointerId:1,preventDefault(){}});
 press();assert.equal(classes.has('revealed'),false);events['win:pointerup']();advance();assert.equal(classes.has('revealed'),false);
 for(const event of ['win:pointerup','win:pointercancel','win:blur','win:pagehide']){
  press();advance();assert.equal(classes.has('revealed'),true);assert.match(card.innerHTML,/預言家/);assert.equal(confirm.disabled,false);
  events[event]();assert.equal(classes.has('revealed'),false);assert.doesNotMatch(card.innerHTML,/預言家/);
 }
 press();advance();events['win:pointermove']({pointerId:1,clientX:120,clientY:50});assert.equal(classes.has('revealed'),false);
 press();advance();document.hidden=true;events['doc:visibilitychange']();assert.equal(classes.has('revealed'),false);
 document.hidden=false;press();advance();vm.runInContext('render()',context);assert.equal(classes.has('revealed'),false);
});
