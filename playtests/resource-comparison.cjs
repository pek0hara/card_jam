// 過去のルール専用の比較。古いデータの上書きや誤集計を防ぐ。
if (!require('node:fs').readFileSync('game.js','utf8').includes('カードジャム v1.4')) throw new Error('この比較はv1.4時点専用です。現在の計測は node playtests/current-game.cjs を実行してください。');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
let randomSeed=1;
const math=Object.create(Math);
math.random=()=>{randomSeed=(Math.imul(randomSeed,1664525)+1013904223)>>>0;return randomSeed/4294967296;};
const original=fs.readFileSync('game.js','utf8');
function load(unified){
    // 戦闘処理を共有し、統合案だけ被害によるジェム獲得を除く。
    const source=unified?original.replace(/this\.players\[(attackerPlayer|targetPlayer)\]\.gems \+= 1;/g,''):original;
    const c=vm.createContext({Math:math,console:{log(){}},document:{addEventListener(){}},setTimeout:()=>0,clearTimeout(){}});
    vm.runInContext(source+'\nthis.Game=CardGame;',c);return c.Game;
}
const variants=[{id:'current',label:'現行：行動力＋蓄積ジェム',unified:false,movement:false},{id:'split-move',label:'分離＋移動・有料交代',unified:false,movement:true},{id:'split-refresh',label:'分離：ジェム回復2→3→4＋行動力2',unified:false,movement:true,refresh:true},{id:'unified',label:'統合：毎ターン2→3→4',unified:true,movement:true}];
function game(v){
    const Game=load(v.unified||v.refresh),g=Object.create(Game.prototype);g.variant=v;
    g.gameState={currentPlayer:1,turnNumber:1,gameOver:false};g.players={};
    for(const p of [1,2])g.players[p]={life:20,gems:0,actionPoints:0,hand:[],deck:[],battlefield:[null,null,null,null],firstTurnCompleted:false,canAttackThisTurn:false,fatigue:0,swappedColumns:new Set(),turnsTaken:0};
    g.computerPlayers=new Set();g.log=g.updateUI=g.scheduleComputerTurn=()=>{};
    const start=Game.prototype.startTurn,summon=Game.prototype.summonMonster,swap=Game.prototype.swapBackToFront;
    g.startTurn=function(p,opts={}){const d=this.players[p];d.turnsTaken++;start.call(this,p,opts);if((v.unified||v.refresh)&&!this.gameState.gameOver){d.gems=Math.min(4,d.turnsTaken+1);d.actionPoints=v.unified?d.gems:2;}};
    g.summonMonster=function(...args){const ok=summon.apply(this,args);if(v.unified&&ok)this.players[args[0]].actionPoints=this.players[args[0]].gems;return ok;};
    g.swapBackToFront=function(...args){const ok=swap.apply(this,args);if(ok&&v.movement){const d=this.players[args[0]];if(v.unified){d.gems--;d.actionPoints=d.gems;}else d.actionPoints--;}return ok;};
    g.moveSideways=function(p,pos){const d=this.players[p],m=d.battlefield[pos],to=pos^1;if(!v.movement||this.gameState.gameOver||this.gameState.currentPlayer!==p||d.actionPoints<1||!m||d.battlefield[to]||m.movedTurn===this.gameState.turnNumber)return false;
        d.battlefield[to]=m;d.battlefield[pos]=null;m.movedTurn=this.gameState.turnNumber;
        if(v.unified){d.gems--;d.actionPoints=d.gems;}else d.actionPoints--;
        this.moveBackRowToFront(p,false);return true;
    };
    return g;
}
function clone(g){const h=Object.create(Object.getPrototypeOf(g));Object.assign(h,g);h.gameState=structuredClone(g.gameState);h.players=structuredClone(g.players);return h;}
function actions(g){
    if(g.gameState.gameOver)return[];const p=g.gameState.currentPlayer,d=g.players[p],list=[];
    if(d.actionPoints>0){const seen=new Set();d.hand.forEach((c,card)=>{if(c.cost>d.gems)return;d.battlefield.forEach((m,pos)=>{if(m)return;const finalPos=pos>1&&!d.battlefield[pos-2]?pos-2:pos;const key=c.name+':'+finalPos;if(seen.has(key))return;seen.add(key);list.push({type:'summon',card,pos});});});
        for(const pos of [2,3])if(d.battlefield[pos]&&!d.swappedColumns.has(pos%2))list.push({type:'swap',pos});
        if(g.variant.movement)for(let pos=0;pos<4;pos++)if(d.battlefield[pos]&&!d.battlefield[pos^1]&&d.battlefield[pos].movedTurn!==g.gameState.turnNumber)list.push({type:'move',pos});
    }
    for(const pos of [0,1])if(g.canMonsterAttack(p,pos))list.push({type:'attack',pos});
    return list;
}
function apply(g,a){const p=g.gameState.currentPlayer;
    if(a.type==='summon')return g.summonMonster(p,a.card,a.pos);
    if(a.type==='attack')return g.attackWithMonster(p,a.pos,3-p,g.players[3-p].battlefield[a.pos]?a.pos:null);
    if(a.type==='swap')return g.swapBackToFront(p,a.pos);
    if(a.type==='move')return g.moveSideways(p,a.pos);
}
function choose(g,conserve){
    const p=g.gameState.currentPlayer,d=g.players[p],e=g.players[3-p];
    const options=actions(g).map(a=>{
        let score=-Infinity;
        if(a.type==='attack'){const m=d.battlefield[a.pos],target=e.battlefield[a.pos];score=!target?100+m.attack+(m.attack>=e.life?10000:0):m.attack>=target.hp?120+target.attack*2:30+m.attack-(target.attack>=m.hp?25:0);}
        if(a.type==='summon'){
            if(conserve&&d.battlefield.slice(0,2).some(Boolean))return {a,score};
            const m=d.hand[a.card],front=a.pos>1&&!d.battlefield[a.pos-2]?a.pos-2:a.pos,target=e.battlefield[front];
            score=50+m.attack*3+m.hp*2-m.cost+(front<2?5:0)+(front<2&&target&&m.attack>=target.hp?15:0);
        }
        if(a.type==='move'||a.type==='swap'){
            const h=clone(g);assert.ok(apply(h,a));
            const before=d.battlefield.slice(0,2).reduce((s,m,i)=>s+(m&&!m.hasAttacked&&!e.battlefield[i]&&m.summonedTurn!==g.gameState.turnNumber?m.attack:0),0);
            const after=h.players[p].battlefield.slice(0,2).reduce((s,m,i)=>s+(m&&!m.hasAttacked&&!e.battlefield[i]&&m.summonedTurn!==g.gameState.turnNumber?m.attack:0),0);
            if(after>before)score=90+after-before;
            if(a.type==='swap'){const front=d.battlefield[a.pos-2],back=d.battlefield[a.pos];if(back&&!back.hasAttacked&&(!front||front.hasAttacked))score=Math.max(score,60+back.attack);}
        }
        return {a,score};
    }).filter(x=>Number.isFinite(x.score)).sort((a,b)=>b.score-a.score);
    return options[0]?.a;
}
// 予算・持ち越し・補償・AP0攻撃を既知の盤面で確認する。
for(const v of variants){
    const g=game(v);g.startTurn(1,{skipDraw:true});assert.equal(g.players[1].gems,2);g.players[1].gems=0;g.gameState.turnNumber=3;g.players[1].firstTurnCompleted=true;g.startTurn(1,{skipDraw:true});assert.equal(g.players[1].gems,(v.unified||v.refresh)?3:1);
    g.players[1].battlefield[0]={name:'試験',hp:3,attack:2,hasAttacked:false,summonedTurn:0};g.players[1].actionPoints=0;g.players[2].gems=0;assert.equal(g.attackWithMonster(1,0,2),true);assert.equal(g.players[2].gems,(v.unified||v.refresh)?0:1);
    g.players[1].gems=1;g.players[1].actionPoints=1;g.players[1].battlefield[0].hasAttacked=true;assert.equal(g.moveSideways(1,0),v.movement);if(v.movement)assert.equal(g.players[1].actionPoints,0);
}
const results=[];
for(const v of variants){for(const mode of ['mirror','conserve']){
    const r={variant:v.id,label:v.label,mode,matches:200,turns:0,fatigueFinishes:0,firstWins:0,player1Wins:0,turnStarts:0,choicesStart:0,choicesAfterFirst:0,firstActions:0,paidChoicesBoth:0,summons:0,attacks:0,moves:0,swaps:0,unusedAP:0,unusedBudget:0};
    for(let n=0;n<r.matches;n++){
        randomSeed=9000+Math.floor(n/2);const g=game(v),first=n%2+1;g.gameState.currentPlayer=first;g.createDecks();g.drawInitialHands();let fatigueFinish=false;
        const draw=g.drawCard;g.drawCard=function(p){draw.call(this,p);if(this.gameState.gameOver)fatigueFinish=true;};g.startTurn(first,{skipDraw:true});
        while(!g.gameState.gameOver&&g.gameState.turnNumber<150){const p=g.gameState.currentPlayer,initial=actions(g);r.turnStarts++;r.choicesStart+=initial.length+1;
            if(initial.some(a=>a.type==='summon')&&initial.some(a=>a.type==='move'||a.type==='swap'))r.paidChoicesBoth++;
            for(let step=0;step<24&&!g.gameState.gameOver;step++){
                const a=choose(g,mode==='conserve'&&p===1);if(!a)break;assert.ok(apply(g,a));r[{summon:'summons',attack:'attacks',move:'moves',swap:'swaps'}[a.type]]++;
                if(step===0&&!g.gameState.gameOver){r.choicesAfterFirst+=actions(g).length+1;r.firstActions++;}
                assert.ok(step<23,'行動ループ');
            }
            r.unusedAP+=g.players[p].actionPoints;r.unusedBudget+=g.players[p].gems;
            if(!g.gameState.gameOver)g.endTurn();
        }
        assert.ok(g.gameState.gameOver);r.turns+=g.gameState.turnNumber;r.fatigueFinishes+=fatigueFinish;r.firstWins+=g.gameState.winner===first;r.player1Wins+=g.gameState.winner===1;
    }
    results.push({...r,meanTurns:+(r.turns/r.matches).toFixed(2),fatiguePct:+(100*r.fatigueFinishes/r.matches).toFixed(1),firstWinPct:+(100*r.firstWins/r.matches).toFixed(1),p1WinPct:+(100*r.player1Wins/r.matches).toFixed(1),meanChoicesStart:+(r.choicesStart/r.turnStarts).toFixed(2),meanChoicesAfterFirst:+(r.choicesAfterFirst/r.firstActions).toFixed(2),movementTradeoffPct:+(100*r.paidChoicesBoth/r.turnStarts).toFixed(1),meanUnusedAP:+(r.unusedAP/r.turnStarts).toFixed(2),meanMoves:+(r.moves/r.matches).toFixed(2),meanSwaps:+(r.swaps/r.matches).toFixed(2)});
}}
fs.writeFileSync('playtests/resource-comparison.json',JSON.stringify({version:'v1.4',seedStart:9000,results},null,2));console.log(JSON.stringify(results.map(r=>({variant:r.variant,mode:r.mode,meanTurns:r.meanTurns,fatigue:r.fatiguePct,firstWin:r.firstWinPct,p1Win:r.p1WinPct,choices:r.meanChoicesStart,afterFirst:r.meanChoicesAfterFirst,movementTradeoff:r.movementTradeoffPct,unusedAP:r.meanUnusedAP,moves:r.meanMoves,swaps:r.meanSwaps})),null,2));
