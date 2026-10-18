const fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({document:{addEventListener(){}},console,setTimeout,clearTimeout});vm.runInContext(fs.readFileSync('game.js','utf8')+'\nthis.Game=CardGame;',c);
function setup(){const g=Object.create(c.Game.prototype);g.gameState={currentPlayer:2,turnNumber:7,gameOver:false};g.players={};for(const p of[1,2])g.players[p]={life:20,energy:0,maxEnergy:4,turnsTaken:4,hand:[],deck:[],battlefield:[null,null,null,null],firstTurnCompleted:true,canAttackThisTurn:true,fatigue:0,swappedColumns:new Set()};g.computerPlayers=new Set([2]);g.log=g.updateUI=()=>{};return g;}
const m=(name,attack)=>({name,attack,hp:attack,maxHp:attack,cost:attack,hasAttacked:false});
const a=setup();a.players[1].life=7;a.players[2].energy=1;a.players[2].battlefield=[m('ナイト',3),null,m('ドラゴン',4),null];let steps=0;while(!a.gameState.gameOver&&a.performComputerAction(2)&&steps++<16){};
const b=setup();b.players[1].life=7;b.players[2].energy=1;b.players[2].battlefield=[m('ナイト',3),null,m('ドラゴン',4),null];b.attackWithMonster(2,0,1);b.swapBackToFront(2,2);b.attackWithMonster(2,0,1);
console.log(JSON.stringify({ai:{enemyLife:a.players[1].life,winner:a.gameState.winner||null,energy:a.players[2].energy},winningSequence:{enemyLife:b.players[1].life,winner:b.gameState.winner}},null,2));
