// v1.5のAI方針とv1.6のAIを席を入れ替えて対戦させ、AI同士の先攻勝率も測る。
// 実行：node playtests/ai-compare.cjs [対戦数]
const fs = require('node:fs'), vm = require('node:vm');
let seed = 1;
const math = Object.create(Math);
math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const c = vm.createContext({ Math: math, console: { log() {} }, document: { addEventListener() {} }, setTimeout: () => 0, clearTimeout() {} });
vm.runInContext(fs.readFileSync('game.js', 'utf8') + '\nthis.Game=CardGame;', c);

// v1.5の行動順と判断（反撃で倒される攻撃も行い、攻撃より先に交代する）
function oldAction(g, p) {
    const o = 3 - p;
    const oldAttack = lethalOnly => {
        const choices = [];
        for (const i of [0, 1]) {
            if (!g.canMonsterAttack(p, i)) continue;
            const a = g.players[p].battlefield[i], t = g.players[o].battlefield[i];
            if (t) choices.push({ i, t: i, lethal: false, kill: a.attack >= t.hp, ta: t.attack, d: a.attack, th: t.hp });
            else choices.push({ i, t: null, lethal: a.attack >= g.players[o].life, kill: false, ta: 0, d: a.attack, th: g.players[o].life });
        }
        const list = lethalOnly ? choices.filter(x => x.lethal) : choices;
        if (!list.length) return false;
        list.sort((a, b) => (b.lethal - a.lethal) || (b.kill - a.kill) || (b.ta - a.ta) || (b.d - a.d) || (a.th - b.th));
        return g.attackWithMonster(p, list[0].i, o, list[0].t);
    };
    const oldSwap = () => {
        const d = g.players[p];
        if (d.energy < 1) return false;
        for (const bp of [2, 3]) {
            const b = d.battlefield[bp];
            if (!b || b.hasAttacked || d.swappedColumns.has(bp % 2)) continue;
            const f = d.battlefield[bp - 2];
            if (!f || f.hasAttacked || f.attack < b.attack) return g.swapBackToFront(p, bp);
        }
        return false;
    };
    return oldAttack(true) || g.computerMove(p) || oldSwap() || g.computerSummon(p) || oldAttack(false);
}

function play(n, policies) {
    seed = 31000 + Math.floor(n / 2);
    const g = Object.create(c.Game.prototype);
    const first = n % 2 + 1;
    g.gameState = { currentPlayer: first, firstPlayer: first, turnNumber: 1, gameOver: false };
    g.players = {};
    for (const p of [1, 2]) g.players[p] = { life: 20, energy: 0, maxEnergy: 0, turnsTaken: 0, hand: [], deck: [], battlefield: [null, null, null, null], firstTurnCompleted: false, canAttackThisTurn: false, fatigue: 0, swappedColumns: new Set() };
    g.computerPlayers = new Set();
    g.log = g.updateUI = g.scheduleComputerTurn = () => {};
    g.createDecks(); g.drawInitialHands(); g.startTurn(first);
    while (!g.gameState.gameOver && g.gameState.turnNumber < 200) {
        const p = g.gameState.currentPlayer;
        for (let step = 0; step < 30 && !g.gameState.gameOver; step++) if (!policies[p](g, p)) break;
        if (!g.gameState.gameOver) g.endTurn();
    }
    return { winner: g.gameState.winner, first, turns: g.gameState.turnNumber };
}

const N = Number(process.argv[2] || 2000);
const newAction = (g, p) => g.performComputerAction(p);
let newWins = 0;
for (let n = 0; n < N; n++) {
    // 同じ乱数で新AIの席を入れ替える
    const newSeat = Math.floor(n / 2) % 2 === 0 ? 1 : 2;
    const policies = newSeat === 1 ? { 1: newAction, 2: oldAction } : { 1: oldAction, 2: newAction };
    if (play(n, policies).winner === newSeat) newWins++;
}
let firstWins = 0, turns = 0;
for (let n = 0; n < N; n++) {
    const r = play(n, { 1: newAction, 2: newAction });
    firstWins += r.winner === r.first; turns += r.turns;
}
const oldFirst = (() => { let w = 0; for (let n = 0; n < N; n++) { const r = play(n, { 1: oldAction, 2: oldAction }); w += r.winner === r.first; } return w; })();
const result = { matches: N, newVsOldWinPct: +(newWins / N * 100).toFixed(2), newAiFirstPlayerWinPct: +(firstWins / N * 100).toFixed(2), newAiMeanTurns: +(turns / N).toFixed(2), oldAiFirstPlayerWinPct: +(oldFirst / N * 100).toFixed(2) };
console.log(JSON.stringify(result, null, 2));
