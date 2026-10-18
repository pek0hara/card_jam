const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let seed=1;const math=Object.create(Math);math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const c=vm.createContext({Math:math,console:{log(){}},document:{addEventListener(){}},setTimeout:()=>0,clearTimeout(){}});vm.runInContext(fs.readFileSync('game.js','utf8')+'\nthis.Game=CardGame;',c);
function options(g){const p=g.gameState.currentPlayer,d=g.players[p],summons=new Set();d.hand.forEach(card=>{if(card.cost<=d.energy)d.battlefield.forEach((m,i)=>{if(!m)summons.add(card.name+':'+(i>1&&!d.battlefield[i-2]?i-2:i));});});return 1+summons.size+[0,1].filter(i=>g.canMonsterAttack(p,i)).length+[0,1,2,3].filter(i=>g.canMoveSideways(p,i)).length+[2,3].filter(i=>d.energy>0&&d.battlefield[i]&&!d.swappedColumns.has(i%2)).length;}
const r={version:'v1.7',matches:200,turns:0,firstWins:0,fatigueFinishes:0,attacks:0,summons:0,moves:0,swaps:0,starts:0,choicesStart:0,firstActions:0,choicesAfterFirst:0};
for(let n=0;n<200;n++){
 seed=11000+Math.floor(n/2);const g=Object.create(c.Game.prototype);g.gameState={currentPlayer:n%2+1,firstPlayer:n%2+1,turnNumber:1,gameOver:false};g.players={};
 for(const p of [1,2])g.players[p]={life:20,energy:0,maxEnergy:0,turnsTaken:0,hand:[],deck:[],battlefield:[null,null,null,null],firstTurnCompleted:false,canAttackThisTurn:false,fatigue:0,swappedColumns:new Set()};
 g.computerPlayers=new Set();g.log=g.updateUI=g.scheduleComputerTurn=()=>{};
 for(const [method,key]of [['attackWithMonster','attacks'],['summonMonster','summons'],['moveSideways','moves'],['swapBackToFront','swaps']]){const original=g[method];g[method]=function(...args){const success=original.apply(this,args);if(success)r[key]++;return success;};}
 let fatigue=false;const draw=g.drawCard;g.drawCard=function(p){draw.call(this,p);if(this.gameState.gameOver)fatigue=true;};g.createDecks();g.drawInitialHands();g.startTurn(g.gameState.currentPlayer);
 while(!g.gameState.gameOver&&g.gameState.turnNumber<150){const p=g.gameState.currentPlayer;r.starts++;r.choicesStart+=options(g);for(let step=0;step<24&&!g.gameState.gameOver;step++){if(!g.performComputerAction(p))break;if(step===0&&!g.gameState.gameOver){r.firstActions++;r.choicesAfterFirst+=options(g);}assert.ok(step<23);}if(!g.gameState.gameOver)g.endTurn();}
 assert.ok(g.gameState.gameOver);r.turns+=g.gameState.turnNumber;r.firstWins+=g.gameState.winner===n%2+1;r.fatigueFinishes+=fatigue;
}
const result={...r,meanTurns:r.turns/200,firstWinPct:r.firstWins/2,fatiguePct:r.fatigueFinishes/2,meanChoicesStart:r.choicesStart/r.starts,meanChoicesAfterFirst:r.choicesAfterFirst/r.firstActions};fs.writeFileSync('playtests/current-v1.7.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
