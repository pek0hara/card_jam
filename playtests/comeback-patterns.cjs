const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('game.js','utf8');
const definitionName=process.argv[2]||'simple';
const holdout=process.argv[3]==='holdout';
const checkpointSeedBase=holdout?36000:16000, naturalSeedBase=holdout?39000:19000;
assert.ok(['simple','two-behind','board-and-life','severe'].includes(definitionName));
assert.ok(source.includes('カードジャム v1.5'),'v1.5の比較専用');
let randomSeed=1;const math=Object.create(Math);math.random=()=>{randomSeed=(Math.imul(randomSeed,1664525)+1013904223)>>>0;return randomSeed/4294967296;};
const variants=[
 {id:'baseline',name:'現行'},
 {id:'simultaneous',name:'倒された敵も同時に反撃'},
 {id:'discount',name:'劣勢時、最初の召喚を1軽減'},
 {id:'reserve',name:'劣勢の手番だけ共通コスト＋1'},
 {id:'lane-cap',name:'直接攻撃は各列毎ターン1回'},
 {id:'tactic',name:'コスト1で敵前列に1ダメージ（毎ターン1回）'}
];
const count=d=>d.battlefield.filter(Boolean).length;
const strength=d=>d.battlefield.reduce((sum,m)=>sum+(m?m.hp+m.attack:0),0);
function isModerate(g){
 const p=g.gameState.currentPlayer,d=g.players[p],e=g.players[3-p];
 if(g.gameState.gameOver||d.turnsTaken<3)return false;
 if(definitionName==='severe')return d.life<=8&&e.life>=15&&count(d)<count(e);
 if(d.life<10||e.life<10)return false;
 if(definitionName==='two-behind')return count(d)<=1&&count(e)-count(d)===2;
 if(definitionName==='board-and-life')return count(d)===1&&count(e)===2&&d.life+5<=e.life;
 return count(d)===1&&count(e)===2;
}
function setup(v){
 let s=source;
 if(v.id==='simultaneous')s=s.replace('targetRow === ROW.FRONT && target.hp > 0','targetRow === ROW.FRONT');
 if(v.id==='discount'){
  s=s.replace('if (!card) return false;','if (!card) return false;\n        const summonCost = this.getSummonCost(player, card);');
  s=s.replace('this.players[player].energy < card.cost','this.players[player].energy < summonCost').replace('this.players[player].energy -= card.cost','this.players[player].energy -= summonCost');
  s=s.replace('item.card.cost <= playerData.energy','this.getSummonCost(player, item.card) <= playerData.energy');
 }
 const c=vm.createContext({Math:math,console:{log(){}},document:{addEventListener(){}},setTimeout:()=>0,clearTimeout(){}});vm.runInContext(s+'\nthis.Game=CardGame;',c);
 return c.Game;
}
for(const v of variants)v.Game=setup(v);
function turnHooks(g,p){
 const d=g.players[p];d.discountUsed=false;d.tacticUsed=false;d.directColumns=new Set();
 if(g.variant.id==='reserve'&&d.turnsTaken>=3&&count(d)<count(g.players[3-p]))d.energy+=1;
}
function construct(v){
 const g=Object.create(v.Game.prototype);g.variant=v;g.gameState={currentPlayer:1,turnNumber:1,gameOver:false};g.players={};
 for(const p of[1,2])g.players[p]={life:20,energy:0,maxEnergy:0,turnsTaken:0,hand:[],deck:[],battlefield:[null,null,null,null],firstTurnCompleted:false,canAttackThisTurn:false,fatigue:0,swappedColumns:new Set(),directColumns:new Set(),discountUsed:false,tacticUsed:false};
 g.computerPlayers=new Set();g.log=g.updateUI=g.scheduleComputerTurn=()=>{};
 g.metrics={fatigueFinish:false,tacticUses:0,discountUses:0,reserveTurns:0};
 const proto=v.Game.prototype;
 g.startTurn=function(p,opts){proto.startTurn.call(this,p,opts);if(!this.gameState.gameOver){turnHooks(this,p);if(v.id==='reserve'&&this.players[p].energy>this.players[p].maxEnergy)this.metrics.reserveTurns++;}};
 g.getSummonCost=function(p,card){const d=this.players[p];return Math.max(1,card.cost-(v.id==='discount'&&d.turnsTaken>=3&&!d.discountUsed&&count(d)<count(this.players[3-p])?1:0));};
 g.summonMonster=function(p,i,pos){const card=this.players[p].hand[i];const discounted=card&&this.getSummonCost(p,card)<card.cost;const ok=proto.summonMonster.call(this,p,i,pos);if(ok&&discounted){this.players[p].discountUsed=true;this.metrics.discountUses++;}return ok;};
 g.canMonsterAttack=function(p,pos){if(!proto.canMonsterAttack.call(this,p,pos))return false;return !(v.id==='lane-cap'&&!this.players[3-p].battlefield[pos]&&this.players[p].directColumns.has(pos));};
 g.attackWithMonster=function(p,pos,o,target=null){
  if(v.id==='lane-cap'&&target===null&&this.players[p].directColumns.has(pos))return false;
  const ok=proto.attackWithMonster.call(this,p,pos,o,target);if(ok&&target===null)this.players[p].directColumns.add(pos);return ok;
 };
 g.drawCard=function(p){proto.drawCard.call(this,p);if(this.gameState.gameOver)this.metrics.fatigueFinish=true;};
 g.useTactic=function(p,pos){const d=this.players[p],o=3-p,m=this.players[o].battlefield[pos];if(v.id!=='tactic'||this.gameState.gameOver||p!==this.gameState.currentPlayer||d.tacticUsed||d.energy<1||!m||pos>1)return false;d.energy--;d.tacticUsed=true;m.hp--;if(m.hp<=0){this.players[o].battlefield[pos]=null;this.moveBackRowToFront(o,false);}this.metrics.tacticUses++;return true;};
 g.computerTactic=function(p){if(v.id!=='tactic')return false;const d=this.players[p],e=this.players[3-p];for(const pos of[0,1]){const target=e.battlefield[pos],attacker=d.battlefield[pos];if(!target)continue;
  const finishes=target.hp===1;
  const enables=attacker&&this.canMonsterAttack(p,pos)&&attacker.attack<target.hp&&attacker.attack+1>=target.hp;
  if((finishes||enables)&&this.useTactic(p,pos))return true;
 }return false;};
 g.performComputerAction=function(p){return this.computerAttack(p,3-p,true)||this.computerTactic(p)||this.computerMove(p)||this.computerSwap(p)||this.computerSummon(p)||this.computerAttack(p,3-p);};
 return g;
}
function restored(v,snapshot){const g=construct(v);g.gameState=structuredClone(snapshot.gameState);g.players=structuredClone(snapshot.players);for(const p of[1,2]){g.players[p].directColumns=new Set();g.players[p].discountUsed=false;g.players[p].tacticUsed=false;}turnHooks(g,g.gameState.currentPlayer);return g;}
function play(g,onStart=()=>{}){
 while(!g.gameState.gameOver&&g.gameState.turnNumber<160){onStart(g);const p=g.gameState.currentPlayer;for(let step=0;step<32&&!g.gameState.gameOver;step++){const ok=g.performComputerAction(p);if(!ok)break;assert.ok(step<31,'無限行動');}if(!g.gameState.gameOver)g.endTurn();}
 assert.ok(g.gameState.gameOver,'未決着');return g;
}
function fresh(v,n,seedBase){randomSeed=seedBase+Math.floor(n/2);const g=construct(v);g.gameState.currentPlayer=n%2+1;g.createDecks();g.drawInitialHands();g.startTurn(g.gameState.currentPlayer,{skipDraw:true});return g;}
function testVariants(){
 for(const v of variants){const g=construct(v);g.gameState.turnNumber=7;g.players[1].turnsTaken=3;g.players[1].canAttackThisTurn=true;g.players[1].energy=4;g.players[1].maxEnergy=4;const m=(id,hp=3)=>({id,name:'試験',hp,maxHp:hp,attack:3,cost:3});g.players[1].battlefield=[m('a'),null,null,null];g.players[2].battlefield=[m('b',2),m('c'),null,null];turnHooks(g,1);
  if(v.id==='reserve')assert.equal(g.players[1].energy,5);
  if(v.id==='discount'){g.players[1].hand=[m('h'),m('h2')];assert.equal(g.getSummonCost(1,g.players[1].hand[0]),2);assert.equal(g.summonMonster(1,0,2),true);assert.equal(g.players[1].energy,2);assert.equal(g.getSummonCost(1,g.players[1].hand[0]),3);}
  if(v.id==='simultaneous'){assert.equal(g.attackWithMonster(1,0,2,0),true);assert.equal(g.players[1].battlefield[0],null);assert.equal(g.players[2].battlefield[0],null);}
  if(v.id==='lane-cap'){g.players[2].battlefield[0]=null;assert.equal(g.attackWithMonster(1,0,2),true);g.players[1].battlefield[0]=m('other');assert.equal(g.canMonsterAttack(1,0),false);assert.equal(g.attackWithMonster(1,0,2),false);}
  if(v.id==='tactic'){g.players[2].battlefield[0].hp=1;assert.equal(g.useTactic(1,0),true);assert.equal(g.players[2].battlefield[0],null);assert.equal(g.players[1].energy,3);assert.equal(g.useTactic(1,1),false);}
 }
}
testVariants();
const N=2000,checkpoints=[];
// 現行ルールの同じ劣勢盤面から、各案を分岐させる。
for(let n=0;n<N;n++){
 let captured=false;play(fresh(variants[0],n,checkpointSeedBase),g=>{if(!captured&&isModerate(g)){const p=g.gameState.currentPlayer;checkpoints.push({seedPair:Math.floor(n/2),player:p,strongDeficit:strength(g.players[3-p])>=1.5*strength(g.players[p]),gameState:structuredClone(g.gameState),players:structuredClone(g.players)});captured=true;}});
}
const results=[];
for(const v of variants){
 const paired={n:checkpoints.length,wins:0,strongN:0,strongWins:0,remainingTurns:0,winsByCheckpoint:[]};
 for(const point of checkpoints){const g=restored(v,point),start=g.gameState.turnNumber;play(g);const win=g.gameState.winner===point.player;paired.wins+=win;paired.winsByCheckpoint.push(Number(win));paired.remainingTurns+=g.gameState.turnNumber-start+1;if(point.strongDeficit){paired.strongN++;paired.strongWins+=win;}}
 const natural={matches:N,comebackN:0,comebackWins:0,turns:0,firstWins:0,fatigueFinishes:0,mechanicUses:0};
 for(let n=0;n<N;n++){const g=fresh(v,n,naturalSeedBase);let trailing=null;play(g,state=>{if(trailing===null&&isModerate(state))trailing=state.gameState.currentPlayer;});natural.turns+=g.gameState.turnNumber;natural.firstWins+=g.gameState.winner===n%2+1;natural.fatigueFinishes+=g.metrics.fatigueFinish;natural.mechanicUses+=g.metrics.tacticUses+g.metrics.reserveTurns+g.metrics.discountUses;if(trailing!==null){natural.comebackN++;natural.comebackWins+=g.gameState.winner===trailing;}}
 const round=x=>+x.toFixed(2);
 results.push({id:v.id,name:v.name,paired:{...paired,rate:round(100*paired.wins/paired.n),strongRate:round(100*paired.strongWins/paired.strongN),meanRemainingTurns:round(paired.remainingTurns/paired.n)},natural:{...natural,rate:round(100*natural.comebackWins/natural.comebackN),meanTurns:round(natural.turns/N),firstWinPct:round(100*natural.firstWins/N),fatiguePct:round(100*natural.fatigueFinishes/N)}});
 console.log(JSON.stringify({id:v.id,paired:results.at(-1).paired.rate,pairedN:paired.n,strong:results.at(-1).paired.strongRate,strongN:paired.strongN,natural:results.at(-1).natural.rate,naturalN:natural.comebackN,turns:results.at(-1).natural.meanTurns,first:results.at(-1).natural.firstWinPct,fatigue:results.at(-1).natural.fatiguePct}));
}
const output={version:'v1.5',matchesPerVariant:N,checkpointSeedBase,naturalSeedBase,definitionName,definition:'全基準で自分の3回目以降の手番開始、対戦ごとに最初の該当場面のみ。simple=自分1体相手2体、双方ライフ10以上。two-behind=自分0〜1体で相手が2体多い、双方ライフ10以上。board-and-life=simpleに加えてライフも5以上負け。severe=自分ライフ8以下・相手15以上、場の枚数も負け。',results};fs.writeFileSync('playtests/comeback-patterns'+(definitionName==='simple'?'':'-'+definitionName)+(holdout?'-holdout':'')+'.json',JSON.stringify(output,null,2));
