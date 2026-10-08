export const flowGuide = `
<h3>一、标准游戏流程</h3>
<p><strong>12人局基础板型流程如下：</strong><br>（12人：3狼人+1白狼王+1预言家+1女巫+1猎人+1守卫+4村民）</p>
<h4>夜晚阶段：</h4>
<ol>
<li>上帝按顺序提醒玩家睁眼行动；</li>
<li>守卫守护一个玩家；</li>
<li>狼人确认同伴并选定一名玩家击杀；</li>
<li>预言家选择一名玩家查验身份；</li>
<li>女巫选择一名玩家使用毒药或灵药；</li>
<li>猎人确认开枪状态。</li>
</ol>
<h4>上警阶段：</h4>
<ol>
<li>第一个白天，上帝发起警长竞选，所有玩家均可报名参与竞选。</li>
<li>报名竞选的警上玩家按照上帝给定的发言顺序依次发言。</li>
<li>发言完毕后，未报名竞选的警下玩家对警上进行投票，获得投票最多的警上玩家担任警长。警上玩家在发言完毕后，可以选择退水，退水玩家不再拥有被选举权。</li>
<li>若有两位及以上的警上玩家平票，则进入平票发言阶段，平票的玩家逐个发言完毕后进行投票，若投票再次平票，则警徽流失，本局游戏没有警长。</li>
<li>单狼自爆吞警徽：警长竞选过程中，若狼人自爆吞警徽，则本轮无警徽，自动进入夜晚。</li>
<li>双狼自爆吞警徽：第二轮白天依旧进入警长竞选环节，若狼人想要吞警徽需要再安排一名狼人自爆。</li>
</ol>
<h4>白天阶段：</h4>
<ol>
<li>上帝宣布昨夜的死亡信息，死亡玩家并指定顺序发表遗言。若无玩家死亡，则上帝宣布“昨夜是平安夜”；</li>
<li>剩余玩家根据发言顺序轮流发言；</li>
<li>玩家发言结束后，通过投票方式选出一名玩家出局，得票最多的玩家即出局，出局者有遗言。若有两个及以上玩家得票数相同，则再发言一轮并进行投票。投票结束进入黑夜。</li>
<li>发言期间狼人可以自爆，则终止白天流程，立即进入黑夜；</li>
<li>重复夜晚流程和白天流程直到游戏结束。</li>
</ol>
<h3>二、其他板型流程调整</h3>
<h4>机械狼</h4><p><strong>夜晚：</strong></p>
<ol>
<li>守卫请选择要守护的玩家。</li>
<li>狼人选择要袭击的玩家。</li>
<li>女巫选择一名玩家使用毒药或灵药。</li>
<li>通灵师睁眼但不发动技能。</li>
<li>猎人确认开枪状态。</li>
<li>机械狼睁眼可以选择任意玩家获得其身份（如果是猎人告知开枪状态）。</li>
<li>通灵师睁眼使用技能查验具体身份。</li>
<li>学习后机械狼睁眼根据学习身份使用技能或获取开枪状态（平民不睁眼）</li>
</ol>
<h4>黑狼王与摄梦人</h4><p><strong>夜晚：</strong><br>摄梦人为第一行动位，指定一名玩家梦游；之后正常推进流程；</p>
<h4>石像鬼与守墓人</h4><p><strong>夜晚：</strong><br>守墓人为第一行动位；之后正常推进流程；石像鬼为最末行动位；</p>
<h4>混血儿</h4><p><strong>夜晚：</strong><br>混血儿首晚为第一行动位，选择一位玩家崇拜；之后正常推进流程；</p>
<h4>魔术师</h4><p>魔术师在<strong>每天夜间最先睁眼</strong>，选择并交换两名玩家的号码牌，其技能结算和行动顺序有严格的流程规范</p>
<h4>12人狼王魔术师：</h4>
<ul>
<li><strong>狼人阵营：4人</strong>（狼人×3 + 狼王×1）</li>
<li><strong>好人阵营：8人</strong>（平民×4 + 预言家×1 + 女巫×1 + 猎人×1 + 魔术师×1）</li>
</ul>
`;

export function showFlowGuide(onClose) {
  if (document.querySelector('dialog')) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'flow-guide';
  dialog.setAttribute('aria-labelledby', 'flow-guide-title');
  dialog.innerHTML = `<div class="flow-guide-heading"><h2 id="flow-guide-title">狼人杀游戏流程</h2></div><div class="flow-guide-content" tabindex="0">${flowGuide}</div><div class="flow-guide-footer"><button class="primary full" autofocus>返回主界面</button></div>`;
  document.body.append(dialog);
  dialog.querySelector('button').onclick = () => dialog.close();
  dialog.onclose = () => { dialog.remove(); onClose(); };
  dialog.showModal();
}
