// 過去のルール専用の比較。古いデータの上書きや誤集計を防ぐ。
if (!require('node:fs').readFileSync('game.js','utf8').includes('カードジャム v1.4')) throw new Error('この比較はv1.4時点専用です。現在の計測は node playtests/current-game.cjs を実行してください。');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
let seed = 1;
const math = Object.create(Math);
math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const context = vm.createContext({ Math: math, console: { log() {} }, document: { addEventListener() {} }, setTimeout: () => 0, clearTimeout() {} });
vm.runInContext(fs.readFileSync('game.js', 'utf8') + '\nthis.Game = CardGame;', context);
function blank() {
    const g = Object.create(context.Game.prototype);
    g.gameState = { currentPlayer: 1, turnNumber: 1, gameOver: false };
    g.players = {};
    for (const p of [1, 2]) g.players[p] = { life: 20, gems: 0, actionPoints: 0, hand: [], deck: [], battlefield: [null,null,null,null], firstTurnCompleted: false, canAttackThisTurn: false, fatigue: 0, swappedColumns: new Set() };
    g.computerPlayers = new Set();
    g.log = g.updateUI = g.scheduleComputerTurn = () => {};
    for (const method of ['summonMonster','attackWithMonster','swapBackToFront']) {
        const original = context.Game.prototype[method];
        g[method] = function(...args) {
            const p=args[0], pos=method==='summonMonster'?args[2]:args[1];
            const label=method==='summonMonster'?`${this.players[p].hand[args[1]]?.name}を${places[pos]}に召喚`
                : method==='attackWithMonster'?`${places[pos]}の${this.players[p].battlefield[pos]?.name}で攻撃`
                : `${places[pos]}の${this.players[p].battlefield[pos]?.name}を交代`;
            const ok=original.apply(this,args);if(ok)this.lastAction=label;return ok;
        };
    }
    return g;
}
function copy(g) { const h = blank(); h.gameState = structuredClone(g.gameState); h.players = structuredClone(g.players); return h; }
const places = ['前列左', '前列右', '後列左', '後列右'];
function cardSignature(c, g, field) { return c ? [c.name, c.hp, c.maxHp, c.attack, c.cost, ...(field ? [!!c.hasAttacked, c.summonedTurn === g.gameState.turnNumber] : [])] : null; }
function signature(g) {
    return JSON.stringify([g.gameState, ...[1, 2].map(p => { const d = g.players[p]; return [d.life,d.gems,d.actionPoints,d.firstTurnCompleted,d.canAttackThisTurn,d.fatigue,[...d.swappedColumns].sort(),d.battlefield.map(c=>cardSignature(c,g,true)),d.hand.map(c=>JSON.stringify(cardSignature(c,g,false))).sort(),d.deck.map(c=>cardSignature(c,g,false))]; })]);
}
function perform(g, a) {
    const p = g.gameState.currentPlayer;
    if (a.type === 'summon') return g.summonMonster(p,a.card,a.pos);
    if (a.type === 'attack') return g.attackWithMonster(p,a.pos,3-p,g.players[3-p].battlefield[a.pos] ? a.pos : null);
    if (a.type === 'swap') return g.swapBackToFront(p,a.pos);
    return false;
}
function choices(g) {
    if (g.gameState.gameOver) return { raw: 0, unique: 0, counts: { summon:0,attack:0,swap:0,end:0 }, actions:[] };
    const p=g.gameState.currentPlayer, d=g.players[p], candidates=[];
    if (d.actionPoints>0) d.hand.forEach((c,i)=>{ if(c.cost<=d.gems) d.battlefield.forEach((m,pos)=>{if(!m)candidates.push({type:'summon',card:i,pos,label:`${c.name} → ${places[pos]}`});}); });
    for (const pos of [0,1]) if(g.canMonsterAttack(p,pos)) candidates.push({type:'attack',pos,label:`${places[pos]}の${d.battlefield[pos].name}で${g.players[3-p].battlefield[pos]?.name || '相手プレイヤー'}を攻撃`});
    if (d.actionPoints>0) for (const pos of [2,3]) if(d.battlefield[pos]&&!d.swappedColumns.has(pos%2)) candidates.push({type:'swap',pos,label:`${places[pos]}の${d.battlefield[pos].name}を前列へ交代`});
    const outcomes=new Map(), counts={summon:0,attack:0,swap:0,end:1};
    for(const a of candidates) { const h=copy(g); assert.ok(perform(h,a),`非法行動: ${a.label}`); const key=signature(h); if(outcomes.has(key))outcomes.get(key).equivalents++; else {outcomes.set(key,{...a,equivalents:1});counts[a.type]++;} }
    const actions=[...outcomes.values(),{type:'end',label:'ターン終了',equivalents:1}];
    return {raw:candidates.length+1,unique:actions.length,counts,actions};
}
function snapshot(g, step) {
    const c=choices(g), p=g.gameState.currentPlayer, d=g.players[p];
    const monster=m=>m?{name:m.name,hp:m.hp,attack:m.attack,used:!!m.hasAttacked,fresh:m.summonedTurn===g.gameState.turnNumber}:null;
    return {turn:g.gameState.turnNumber,round:Math.ceil(g.gameState.turnNumber/2),player:p,step,...c,ap:d.actionPoints,gems:d.gems,life:d.life,opponentLife:g.players[3-p].life,deck:d.deck.length,hand:d.hand.map(m=>({name:m.name,cost:m.cost})),own:d.battlefield.map(monster),enemy:g.players[3-p].battlefield.map(monster),taken:''};
}
function verify() {
    const g=blank();g.players[1].gems=2;g.players[1].actionPoints=2;
    const c={name:'ゴブリン',hp:1,maxHp:1,attack:2,cost:1};g.players[1].hand=[{...c,id:'a'},{...c,id:'b'}];
    const a=choices(g);assert.equal(a.raw,9);assert.equal(a.unique,3);assert.equal(a.counts.summon,2);
    g.players[1].hand=[];g.players[1].actionPoints=0;g.players[1].canAttackThisTurn=true;g.players[1].battlefield[0]={...c,hasAttacked:false,summonedTurn:0};
    assert.equal(choices(g).unique,2);g.players[1].battlefield[0].summonedTurn=1;assert.equal(choices(g).unique,1);
}
verify();
const matches=[], states=[];
for(let n=0;n<200;n++){
    seed=7000+Math.floor(n/2);const g=blank();g.gameState.currentPlayer=n%2+1;g.createDecks();g.drawInitialHands();g.startTurn(g.gameState.currentPlayer,{skipDraw:true});
    const trace=[];
    while(!g.gameState.gameOver&&g.gameState.turnNumber<150){
        const p=g.gameState.currentPlayer;
        for(let step=0;step<14&&!g.gameState.gameOver;step++){
            const before=snapshot(g,step); trace.push(before);states.push(before);
            if(!g.performComputerAction(p)){before.taken='ターン終了';break;}
            before.taken=g.lastAction || '行動';
            assert.ok(step<13,'AI行動ループ');
        }
        if(!g.gameState.gameOver)g.endTurn();
    }
    assert.ok(g.gameState.gameOver);matches.push({id:n+1,turns:g.gameState.turnNumber,winner:g.gameState.winner,trace});
}
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const summary=a=>({n:a.length,mean:+avg(a.map(s=>s.unique)).toFixed(2),raw:+avg(a.map(s=>s.raw)).toFixed(2),onlyEnd:+(100*a.filter(s=>s.unique===1).length/a.length).toFixed(1),twoOrLess:+(100*a.filter(s=>s.unique<=2).length/a.length).toFixed(1),summon:+avg(a.map(s=>s.counts.summon)).toFixed(2),attack:+avg(a.map(s=>s.counts.attack)).toFixed(2),swap:+avg(a.map(s=>s.counts.swap)).toFixed(2)});
const starts=states.filter(s=>s.step===0);
const rounds=[...new Set(starts.map(s=>s.round))].sort((a,b)=>a-b).map(round=>({round,...summary(starts.filter(s=>s.round===round))}));
const phases=[['序盤',s=>s.round<=3],['中盤',s=>s.round>=4&&s.round<=8],['終盤',s=>s.round>=9]].map(([name,predicate])=>({name,start:summary(starts.filter(predicate)),all:summary(states.filter(predicate))}));
const situations=[['行動力0',s=>s.ap===0],['召喚できる手札なし',s=>!s.hand.some(c=>c.cost<=s.gems)],['前列2体',s=>!!s.own[0]&&!!s.own[1]],['後列にモンスターあり',s=>!!s.own[2]||!!s.own[3]]].map(([name,predicate])=>({name,...summary(states.filter(predicate))}));
const mostVaried=matches.slice().sort((a,b)=>Math.max(...b.trace.map(s=>s.unique))-Math.max(...a.trace.map(s=>s.unique)))[0];
const output={version:'v1.4',matches:matches.length,states:states.length,overall:summary(states),activeDecisions:summary(states.filter(s=>s.unique>1)),byStep:[...new Set(states.map(s=>s.step))].sort((a,b)=>a-b).map(step=>({step,...summary(states.filter(s=>s.step===step))})),turnStarts:summary(starts),situations,rounds,phases,example:{id:mostVaried.id,turns:mostVaried.turns,winner:mostVaried.winner,trace:mostVaried.trace}};
fs.writeFileSync('playtests/choices-v1.4.json',JSON.stringify(output));
console.log(JSON.stringify({...output,example:{id:output.example.id,turns:output.example.turns,steps:output.example.trace.length},rounds:output.rounds},null,2));
