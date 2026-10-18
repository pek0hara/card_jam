const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const context = vm.createContext({ console: { log() {} }, document: { addEventListener() {} }, setTimeout: fn => ({ fn }), clearTimeout: timer => { timer.cancelled = true; } });
vm.runInContext(fs.readFileSync('game.js', 'utf8') + '\nthis.Game = CardGame;', context);
function game() {
    const g = Object.create(context.Game.prototype);
    g.gameState = { currentPlayer: 1, turnNumber: 3, gameOver: false };
    g.players = {};
    for (const p of [1, 2]) g.players[p] = { life: 20, energy: 4, maxEnergy: 4, turnsTaken: 2, hand: [], deck: [], battlefield: [null,null,null,null], firstTurnCompleted: true, canAttackThisTurn: true, fatigue: 0, swappedColumns: new Set() };
    g.computerPlayers = new Set();
    g.log = g.updateUI = g.scheduleComputerTurn = () => {};
    return g;
}
const monster = (id = 'm') => ({ id, name: 'オーク', hp: 3, maxHp: 3, attack: 2, cost: 2, hasAttacked: false });
test('1体は1回だけ攻撃でき、交代しても攻撃済みを維持する', () => {
    const g = game(); const a = monster('a');
    g.players[1].battlefield = [a,null,monster('b'),null];
    assert.equal(g.attackWithMonster(1,0,2),true);
    assert.equal(g.attackWithMonster(1,0,2),false);
    assert.equal(g.players[1].energy,4);
    g.swapBackToFront(1,2);
    assert.equal(g.players[1].battlefield[2],a);
    g.swapBackToFront(1,2);
    assert.equal(g.players[1].battlefield[2],a);
    assert.equal(a.hasAttacked,true);
});
test('後列攻撃・壁を無視する直接攻撃・手番外操作を拒否する', () => {
    const g = game(); g.players[1].battlefield = [monster(),null,monster(),null]; g.players[2].battlefield[0] = monster();
    assert.equal(g.attackWithMonster(1,2,2,0),false);
    assert.equal(g.attackWithMonster(1,0,2),false);
    assert.equal(g.attackWithMonster(2,0,1,0),false);
    assert.equal(g.players[1].energy,4);
});
test('手札満杯なら手札・山札とも保持する', () => {
    const g = game(); g.players[1].hand = Array.from({length:4},(_,i)=>monster(i)); g.players[1].deck=[monster('draw')];
    g.drawCard(1); assert.equal(g.players[1].hand[0].id,0); assert.equal(g.players[1].deck.length,1);
});
test('山札切れダメージが増加し、勝敗後の攻撃と召喚を拒否する', () => {
    const g = game(); g.players[1].life=3;
    g.drawCard(1); assert.equal(g.players[1].life,2);
    g.drawCard(1); assert.equal(g.gameState.winner,2);
    g.players[1].hand=[monster()]; g.players[1].battlefield[0]=monster();
    assert.equal(g.summonMonster(1,0,1),false); assert.equal(g.attackWithMonster(1,0,2),false);
});
test('次のターンに攻撃・交代が回復する', () => {
    const g = game(); const a=monster(); a.hasAttacked=true; g.players[1].battlefield[0]=a; g.players[1].swappedColumns.add(0);
    g.startTurn(1,{skipDraw:true}); assert.equal(a.hasAttacked,false); assert.equal(g.players[1].swappedColumns.size,0);
});
test('デッキは双方同じ構成の16枚', () => {
    const g = game(); g.createDecks(); const names=p=>Array.from(g.players[p].deck,c=>c.name).sort();
    assert.equal(g.players[1].deck.length,16); assert.deepEqual(names(1),names(2));
});
test('初手は双方にコスト2以下を保証する', () => {
    const g=game(); g.createDecks();
    for (const p of [1,2]) g.players[p].deck.sort((a,b)=>a.cost-b.cost);
    g.drawInitialHands();
    for (const p of [1,2]) { assert.ok(g.players[p].hand.some(c=>c.cost<=2)); assert.equal(g.players[p].hand.length,3); assert.equal(g.players[p].deck.length,13); }
});
test('AI同士の100対戦が完了し、手番ごとの行動が有限である', () => {
    for (let n=0;n<100;n++) {
        const g=game(); g.createDecks(); g.drawInitialHands(); g.players[1].firstTurnCompleted=g.players[2].firstTurnCompleted=false; g.players[1].turnsTaken=g.players[2].turnsTaken=0;
        g.startTurn(1,{skipDraw:true});
        let turns=0;
        while (!g.gameState.gameOver && turns++<150) {
            const p=g.gameState.currentPlayer, opponent=p===1?2:1;
            let actions=0;
            while (!g.gameState.gameOver && actions++<24) {
                if (g.performComputerAction(p)) continue;
                break;
            }
            assert.ok(actions<24,'AIの交代ループ');
            if (!g.gameState.gameOver) g.endTurn();
        }
        assert.ok(g.gameState.gameOver,`対戦${n}が未決着`);
    }
});

test('コスト0でも攻撃でき、最後の攻撃後にだけ自動終了する', () => {
    const g=game(); g.players[1].energy=0; g.players[1].battlefield=[monster('a'),monster('b'),null,null];
    g.checkAutoEndTurn(); assert.equal(g.autoEndTurnTimeout,undefined);
    assert.equal(g.attackWithMonster(1,0,2),true); g.checkAutoEndTurn(); assert.equal(g.autoEndTurnTimeout,undefined);
    assert.equal(g.attackWithMonster(1,1,2),true); assert.equal(g.players[1].energy,0);
    g.checkAutoEndTurn(); assert.ok(g.autoEndTurnTimeout); g.autoEndTurnTimeout.fn(); assert.equal(g.gameState.currentPlayer,2);
});
test('最後のコストで召喚しても敵モンスターへの無料攻撃が残る', () => {
    const g=game(); g.players[1].energy=2; g.players[1].hand=[monster()]; g.players[2].battlefield[0]=monster('target');
    assert.equal(g.summonMonster(1,0,0),true); assert.equal(g.players[1].energy,0);
    g.checkAutoEndTurn(); assert.equal(g.autoEndTurnTimeout,undefined);
    assert.equal(g.canMonsterAttack(1,0),true); assert.equal(g.attackWithMonster(1,0,2,0),true);
    assert.equal(g.players[1].battlefield[0].hasAttacked,true);
});
test('召喚直後の直接攻撃は拒否され、次の自分のターンに解禁される', () => {
    const g=game(); g.players[1].hand=[monster()]; g.summonMonster(1,0,0);
    assert.equal(g.canMonsterAttack(1,0),false); assert.equal(g.attackWithMonster(1,0,2),false);
    assert.equal(g.players[1].battlefield[0].hasAttacked,false); assert.equal(g.players[2].life,20);
    g.gameState.turnNumber+=2; g.startTurn(1,{skipDraw:true});
    assert.equal(g.canMonsterAttack(1,0),true); assert.equal(g.attackWithMonster(1,0,2),true);
});
test('召喚直後の制限は交代・自動前進しても維持される', () => {
    const g=game(); g.players[1].battlefield[0]=monster('old'); g.players[1].hand=[monster('new')];
    g.summonMonster(1,0,2); g.swapBackToFront(1,2);
    assert.equal(g.attackWithMonster(1,0,2),false);
    g.players[1].battlefield[0]=null; g.players[1].battlefield[2].summonedTurn=g.gameState.turnNumber;
    g.moveBackRowToFront(1); assert.equal(g.attackWithMonster(1,0,2),false);
});
test('双方の初回ターンはモンスターにも攻撃できない', () => {
    const g=game(); g.players[1].firstTurnCompleted=false; g.startTurn(1,{skipDraw:true});
    g.players[1].hand=[monster()]; g.players[2].battlefield[0]=monster(); g.summonMonster(1,0,0);
    assert.equal(g.canMonsterAttack(1,0),false); assert.equal(g.attackWithMonster(1,0,2,0),false);
});
test('AIは召喚直後の直接攻撃を避け、コスト0でも既存モンスターで攻撃する', async () => {
    const g=game(); g.gameState.currentPlayer=2; g.computerPlayers.add(2); g.players[2].energy=2;
    g.players[2].hand=[monster('new')]; g.players[2].battlefield[1]=monster('old');
    g.delay=async()=>{}; g.endTurn=()=>{g.ended=true;}; await g.runComputerTurn();
    assert.equal(g.players[2].energy,0); assert.equal(g.players[1].life,18);
    assert.equal(g.players[2].battlefield[0].hasAttacked,false); assert.equal(g.players[2].battlefield[1].hasAttacked,true); assert.equal(g.ended,true);
});

test('コスト0で反撃に倒されても自動前進したモンスターで攻撃を続けられる', () => {
    const g=game(); g.players[1].energy=0;
    const weak=monster('weak'); weak.hp=1; weak.attack=1;
    g.players[1].battlefield=[weak,null,monster('reserve'),null];
    g.players[2].battlefield[0]=monster('target');
    assert.equal(g.attackWithMonster(1,0,2,0),true);
    assert.equal(g.players[1].battlefield[0].id,'reserve');
    g.checkAutoEndTurn(); assert.equal(g.autoEndTurnTimeout,undefined);
    assert.equal(g.attackWithMonster(1,0,2,0),true);
});
test('自動終了の待機中に攻撃が可能になった場合は終了しない', () => {
    const g=game(); g.players[1].energy=0; g.checkAutoEndTurn();
    const callback=g.autoEndTurnTimeout.fn;
    g.players[1].battlefield[0]=monster(); callback();
    assert.equal(g.gameState.currentPlayer,1);
});

test('共通コストが自分の手番ごとに2→3→4と全回復し、持ち越さない', () => {
    const g=game(); g.players[1].turnsTaken=0;
    for (const expected of [2,3,4,4]) { g.players[1].energy=99; g.startTurn(1,{skipDraw:true}); assert.equal(g.players[1].energy,expected); assert.equal(g.players[1].maxEnergy,expected); }
});
test('コスト1を4枚召喚でき、召喚回数の別上限がない', () => {
    const g=game(); g.players[1].hand=Array.from({length:4},(_,i)=>({...monster(i),cost:1}));
    for(const pos of [0,1,2,3]) assert.equal(g.summonMonster(1,0,pos),true);
    assert.equal(g.players[1].energy,0);
});
test('直接攻撃やモンスター破壊ではコストが増えない', () => {
    const g=game(); g.players[1].battlefield=[monster('a'),monster('b'),null,null];g.players[2].energy=0;
    const target=monster('target');target.hp=1;g.players[2].battlefield[0]=target;
    g.attackWithMonster(1,0,2,0);assert.equal(g.players[2].energy,0);
    g.attackWithMonster(1,1,2);assert.equal(g.players[2].energy,0);assert.equal(g.players[1].energy,4);
});
test('左右移動と交代は召喚と同じコストを消費する', () => {
    const g=game();g.players[1].energy=4;g.players[1].hand=[monster('new')];
    g.players[1].battlefield[0]=monster('old');assert.equal(g.moveSideways(1,0),true);assert.equal(g.players[1].energy,3);
    assert.equal(g.moveSideways(1,1),false);
    assert.equal(g.summonMonster(1,0,3),true);assert.equal(g.players[1].energy,1);
    assert.equal(g.swapBackToFront(1,3),true);assert.equal(g.players[1].energy,0);
});
test('左右移動しても攻撃済み・召喚直後は解除されない', () => {
    const g=game();const m=monster();m.hasAttacked=true;m.summonedTurn=g.gameState.turnNumber;g.players[1].battlefield[0]=m;
    assert.equal(g.moveSideways(1,0),true);assert.equal(g.players[1].battlefield[1],m);assert.equal(g.attackWithMonster(1,1,2),false);
    m.hasAttacked=false;assert.equal(g.attackWithMonster(1,1,2),false);
});
test('左右移動はコスト不足・移動先占有・手番外・終了後にはできない', () => {
    const g=game();g.players[1].battlefield[0]=monster();g.players[1].energy=0;assert.equal(g.moveSideways(1,0),false);
    g.players[1].energy=4;g.players[1].battlefield[1]=monster();assert.equal(g.moveSideways(1,0),false);
    assert.equal(g.moveSideways(2,0),false);g.players[1].battlefield[1]=null;g.gameState.gameOver=true;assert.equal(g.moveSideways(1,0),false);
});
test('左右移動で前列が空いたら後列は自動前進する', () => {
    const g=game();g.players[1].battlefield=[monster('a'),null,monster('reserve'),null];g.moveSideways(1,0);
    assert.equal(g.players[1].battlefield[0].id,'reserve');assert.equal(g.players[1].battlefield[1].id,'a');
});

// v1.6
test('AIは攻撃→交代→攻撃の組み合わせで勝てる手順を見つける', () => {
    const g=game(); g.gameState.currentPlayer=2; g.players[1].life=7; g.players[2].energy=1;
    const knight={...monster('k'),attack:3,hp:3}, dragon={...monster('d'),attack:4,hp:4};
    g.players[2].battlefield=[knight,null,dragon,null];
    for (let i=0;i<8&&!g.gameState.gameOver;i++) if(!g.performComputerAction(2)) break;
    assert.equal(g.gameState.winner,2);
});
test('勝ち筋探索は実際の盤面を変更しない', () => {
    const g=game(); g.gameState.currentPlayer=2; g.players[1].life=99;
    g.players[2].battlefield=[monster('a'),null,monster('b'),null];
    assert.equal(g.findLethalPlan(2),null);
    assert.equal(g.players[2].energy,4); assert.equal(g.players[2].battlefield[0].hasAttacked,false); assert.equal(g.players[1].life,99);
});
test('AIは交代しても攻撃できない後列モンスターを交代しない', () => {
    const g=game(); g.gameState.currentPlayer=2;
    const front=monster('front'); front.hasAttacked=true;
    const fresh=monster('fresh'); fresh.summonedTurn=g.gameState.turnNumber;
    g.players[2].battlefield=[front,null,fresh,null];
    assert.equal(g.computerSwap(2),false); assert.equal(g.players[2].energy,4);
    fresh.summonedTurn=1; assert.equal(g.computerSwap(2),true);
});
test('先攻も最初の手番にドローし、コストは先攻2→3→4、後攻3→4', () => {
    const g=game(); g.gameState.firstPlayer=1; g.gameState.currentPlayer=1;
    for (const p of [1,2]) Object.assign(g.players[p],{turnsTaken:0,firstTurnCompleted:false,hand:[monster('h')],deck:[monster('d1'),monster('d2')]});
    g.startTurn(1); assert.equal(g.players[1].hand.length,2); assert.equal(g.players[1].maxEnergy,2);
    g.endTurn(); assert.equal(g.players[2].hand.length,2); assert.equal(g.players[2].maxEnergy,3);
    g.endTurn(); assert.equal(g.players[1].maxEnergy,3);
    g.endTurn(); assert.equal(g.players[2].maxEnergy,4);
    g.endTurn(); assert.equal(g.players[1].maxEnergy,4);
});
test('攻撃予告は撃破・反撃・直接攻撃を区別する', () => {
    const g=game(); const a={...monster('a'),attack:3,hp:2};
    g.players[1].battlefield[0]=a;
    assert.match(g.previewAttack(1,0).short,/本体に3/);
    g.players[2].battlefield[0]={...monster('t'),hp:3,attack:1}; assert.match(g.previewAttack(1,0).short,/撃破/);
    g.players[2].battlefield[0]={...monster('t'),hp:5,attack:2}; const p=g.previewAttack(1,0);
    assert.equal(p.dies,true); assert.match(p.short,/反撃で倒れる/);
    g.players[2].battlefield[0]={...monster('t'),hp:5,attack:1}; assert.match(g.previewAttack(1,0).short,/反撃1/);
});
test('ログの主語はあなた/AIで表示する', () => {
    const g=game(); g.computerPlayers=new Set([2]); const logs=[]; g.log=m=>logs.push(m);
    g.players[1].battlefield[0]=monster(); g.attackWithMonster(1,0,2);
    assert.ok(logs.some(m=>m.includes('AIに2ダメージ'))); assert.ok(!logs.some(m=>m.includes('プレイヤー')));
});

// v1.7
test('召喚直後のモンスターは、直後の相手手番だけ受けるダメージ-1', () => {
    const g=game(); g.gameState.currentPlayer=2; g.players[2].hand=[{...monster('new'),hp:3}];
    g.summonMonster(2,0,0); const fresh=g.players[2].battlefield[0];
    g.gameState.turnNumber++; g.gameState.currentPlayer=1;
    const a={...monster('a'),attack:3,hp:9}; g.players[1].battlefield[0]=a;
    assert.equal(g.isGuarded(fresh),true); assert.equal(g.damageTo(a,fresh),2);
    assert.match(g.previewAttack(1,0).detail,/守りで-1/);
    g.attackWithMonster(1,0,2,0); assert.equal(fresh.hp,1);
    g.gameState.turnNumber+=2; assert.equal(g.isGuarded(fresh),false); assert.equal(g.damageTo(a,fresh),3);
});
test('守りは本体への直接攻撃に影響しない', () => {
    const g=game(); const a={...monster('a'),attack:3}; g.players[1].battlefield[0]=a;
    g.attackWithMonster(1,0,2); assert.equal(g.players[2].life,17);
});
test('AIは守りでダメージ0になる攻撃をしない', () => {
    const g=game(); g.gameState.currentPlayer=2;
    g.players[2].battlefield[0]={...monster('weak'),attack:1,summonedTurn:1};
    g.players[1].battlefield[0]={...monster('fresh'),summonedTurn:g.gameState.turnNumber-1};
    assert.equal(g.computerAttackChoices(2).length,0);
});
