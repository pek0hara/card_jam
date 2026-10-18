// 一方的な決着を減らすルール案を、実際のゲーム処理に差し込んでAI同士で比較する。
// 実行：node playtests/fun-experiments.cjs [対戦数] [案の名前...]
const fs = require('node:fs'), vm = require('node:vm');

let seed = 1;
const math = Object.create(Math);
math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

// 案ごとにgame.jsを読み直し、プロトタイプを差し替える
function loadGame(variant) {
    const c = vm.createContext({ Math: math, console: { log() {} }, document: { addEventListener() {} }, setTimeout: () => 0, clearTimeout() {} });
    // guardN：game.jsの召喚直後の守りをNに設定（AIと攻撃予告も同じ値を使う）
    const guard = variant.find(v => /^guard\d$/.test(v));
    let src = fs.readFileSync('game.js', 'utf8');
    if (guard) src = src.replace(/summonGuard: \d+/, `summonGuard: ${guard.slice(5)}`);
    // 貫通先：tramplePlayer／trampleBack／trampleOff
    const t = variant.find(v => /^trample(Player|Back|Off)$/.test(v));
    if (t) src = src.replace(/trample: (?:'player'|'back'|false)/, `trample: ${{ tramplePlayer: "'player'", trampleBack: "'back'", trampleOff: 'false' }[t]}`);
    vm.runInContext(src + '\nthis.Game=CardGame;', c);
    const P = c.Game.prototype;
    for (const name of variant) if (!/^guard\d$|^trample(Player|Back|Off)$/.test(name)) PATCHES[name](P);
    return c.Game;
}

const other = p => (p === 1 ? 2 : 1);

const PATCHES = {
    // 自分のモンスターが破壊されたら1枚ドロー（山札があり手札に空きがあるときだけ）
    deathDraw(P) {
        const attack = P.attackWithMonster;
        P.attackWithMonster = function (ap, apos, tp, tpos = null) {
            const before = { 1: this.players[1].battlefield.filter(Boolean).length, 2: this.players[2].battlefield.filter(Boolean).length };
            const ok = attack.call(this, ap, apos, tp, tpos);
            if (ok && !this.gameState.gameOver) {
                for (const p of [1, 2]) {
                    const lost = before[p] - this.players[p].battlefield.filter(Boolean).length;
                    for (let i = 0; i < lost; i++) {
                        if (this.players[p].deck.length > 0 && this.players[p].hand.length < 4) this.players[p].hand.push(this.players[p].deck.pop());
                    }
                }
            }
            return ok;
        };
    },
    // 自分の手番開始時、後列のモンスターは体力1回復
    backRest(P) {
        const start = P.startTurn;
        P.startTurn = function (player, opts) {
            for (const pos of [2, 3]) {
                const m = this.players[player].battlefield[pos];
                if (m) m.hp = Math.min(m.maxHp, m.hp + 1);
            }
            return start.call(this, player, opts);
        };
    },
    // 手番開始時にライフ10以下なら、その手番のコスト上限+1（最大5）
    lowLifeCost(P) {
        const start = P.startTurn;
        P.startTurn = function (player, opts) {
            start.call(this, player, opts);
            const d = this.players[player];
            if (!this.gameState.gameOver && d.life <= 10 && d.turnsTaken >= 2) { d.maxEnergy = d.maxEnergy + 1; d.energy = d.maxEnergy; }
        };
    },
    // 1手番に相手本体へ与えるダメージは合計5まで
    directCap(P) {
        const attack = P.attackWithMonster;
        P.attackWithMonster = function (ap, apos, tp, tpos = null) {
            const m = this.players[ap]?.battlefield[apos];
            if (tpos !== null || !m) return attack.call(this, ap, apos, tp, tpos);
            const key = `${this.gameState.turnNumber}`;
            if (this.directKey !== key) { this.directKey = key; this.directDone = 0; }
            const room = Math.max(0, 5 - this.directDone);
            const original = m.attack;
            m.attack = Math.min(original, room);
            const ok = attack.call(this, ap, apos, tp, tpos);
            m.attack = original;
            if (ok) this.directDone += Math.min(original, room);
            return ok;
        };
        const clone = P.cloneForSearch;
        P.cloneForSearch = function () { const s = clone.call(this); s.directKey = this.directKey; s.directDone = this.directDone; return s; };
    },
    // 直前の相手手番に召喚されたモンスターは、受けるダメージ-1（展開した側が一方的に狩られにくくする）
    summonGuard(P) {
        const attack = P.attackWithMonster;
        P.attackWithMonster = function (ap, apos, tp, tpos = null) {
            const m = this.players[ap]?.battlefield[apos];
            const t = tpos === null ? null : this.players[tp]?.battlefield[tpos];
            if (!m || !t || t.summonedTurn !== this.gameState.turnNumber - 1) return attack.call(this, ap, apos, tp, tpos);
            const original = m.attack;
            m.attack = Math.max(0, original - 1);
            const ok = attack.call(this, ap, apos, tp, tpos);
            m.attack = original;
            return ok;
        };
        const preview = P.previewAttack;
        if (preview) P.previewAttack = preview; // 表示は実装時に対応
    },
    // 前の自分の手番に攻撃しなかったモンスターは「守備」：受けるダメージ-1
    guardIdle(P) {
        const attack = P.attackWithMonster;
        P.attackWithMonster = function (ap, apos, tp, tpos = null) {
            const m = this.players[ap]?.battlefield[apos];
            const t = tpos === null ? null : this.players[tp]?.battlefield[tpos];
            if (!m || !t || t.hasAttacked) return attack.call(this, ap, apos, tp, tpos);
            const original = m.attack;
            m.attack = Math.max(0, original - 1);
            const ok = attack.call(this, ap, apos, tp, tpos);
            m.attack = original;
            return ok;
        };
    },
    // 直前の相手手番に召喚されたモンスターは、次の相手手番の間は攻撃されない
    summonShelter(P) {
        const can = P.canMonsterAttack;
        P.canMonsterAttack = function (player, position) {
            if (!can.call(this, player, position)) return false;
            const t = this.players[other(player)].battlefield[position];
            if (t && t.summonedTurn === this.gameState.turnNumber - 1) return false;
            return true;
        };
        const attack = P.attackWithMonster;
        P.attackWithMonster = function (ap, apos, tp, tpos = null) {
            const t = tpos === null ? null : this.players[tp]?.battlefield[tpos];
            if (t && t.summonedTurn === this.gameState.turnNumber - 1) return false;
            return attack.call(this, ap, apos, tp, tpos);
        };
    },
    // 召喚したモンスターは、召喚後最初の相手手番の間だけ体力+1（一時的な盾）
    summonShield(P) {
        const summon = P.summonMonster;
        P.summonMonster = function (player, idx, pos) {
            const card = this.players[player].hand[idx];
            const ok = summon.call(this, player, idx, pos);
            if (ok) { card.shield = 1; }
            return ok;
        };
        const attack = P.attackWithMonster;
        P.attackWithMonster = function (ap, apos, tp, tpos = null) {
            const m = this.players[ap]?.battlefield[apos];
            const t = tpos === null ? null : this.players[tp]?.battlefield[tpos];
            if (!m || !t || !t.shield) return attack.call(this, ap, apos, tp, tpos);
            const absorbed = Math.min(t.shield, m.attack);
            const original = m.attack;
            m.attack = original - absorbed;
            const ok = attack.call(this, ap, apos, tp, tpos);
            m.attack = original;
            if (ok) t.shield -= absorbed;
            return ok;
        };
        const end = P.endTurn;
        P.endTurn = function () {
            // 盾は相手の次の手番が終わったら消える
            const next = other(this.gameState.currentPlayer);
            this.players[this.gameState.currentPlayer].battlefield.forEach(m => { if (m && m.summonedTurn < this.gameState.turnNumber) m.shield = 0; });
            return end.call(this);
        };
    },
    // 召喚直後の守り-2
    summonGuard2(P) {
        const attack = P.attackWithMonster;
        P.attackWithMonster = function (ap, apos, tp, tpos = null) {
            const m = this.players[ap]?.battlefield[apos];
            const t = tpos === null ? null : this.players[tp]?.battlefield[tpos];
            if (!m || !t || t.summonedTurn !== this.gameState.turnNumber - 1) return attack.call(this, ap, apos, tp, tpos);
            const original = m.attack;
            m.attack = Math.max(0, original - 2);
            const ok = attack.call(this, ap, apos, tp, tpos);
            m.attack = original;
            return ok;
        };
    },
    // 後攻はコストの伸びが1手番早い（3→4）
    secondFast(P) {
        const start = P.startTurn;
        P.startTurn = function (player, opts) {
            start.call(this, player, opts);
            const d = this.players[player];
            if (!this.gameState.gameOver && player !== this.gameState.firstPlayer && d.turnsTaken === 2) { d.maxEnergy = 4; d.energy = 4; }
        };
    },
    // 先攻の最初の手番のコストは1
    firstCost1(P) {
        const start = P.startTurn;
        P.startTurn = function (player, opts) {
            start.call(this, player, opts);
            const d = this.players[player];
            if (player === this.gameState.firstPlayer && d.turnsTaken === 1) { d.maxEnergy = 1; d.energy = 1; }
        };
    },
    // 後攻はライフ22
    secondLife22(P) {
        const create = P.createDecks;
        P.createDecks = function () { create.call(this); this.players[other(this.gameState.firstPlayer)].life = 22; };
    },
    // v1.7用の貫通パッチ（v1.8以降はgame.jsのRULES.trampleを tramplePlayer などで切り替える）
    trample(P) {
        const attack = P.attackWithMonster;
        P.attackWithMonster = function (ap, apos, tp, tpos = null) {
            const t = tpos === null ? null : this.players[tp]?.battlefield[tpos];
            const ok = attack.call(this, ap, apos, tp, tpos);
            if (ok && t && t.hp < 0 && !this.gameState.gameOver) {
                this.players[tp].life = Math.max(0, this.players[tp].life + t.hp);
                this.checkWinCondition();
            }
            return ok;
        };
    },
    // 勝敗の仕様：自分のモンスターが破壊されるとライフ-1
    deathPenalty(P) {
        const attack = P.attackWithMonster;
        P.attackWithMonster = function (ap, apos, tp, tpos = null) {
            const count = p => this.players[p].battlefield.filter(Boolean).length;
            const before = { 1: count(1), 2: count(2) };
            const ok = attack.call(this, ap, apos, tp, tpos);
            if (ok && !this.gameState.gameOver) {
                for (const p of [1, 2]) this.players[p].life = Math.max(0, this.players[p].life - (before[p] - count(p)));
                this.checkWinCondition();
            }
            return ok;
        };
    },
    // 先攻・後攻の補正の組み替え：先攻の初回ドローなし
    firstNoDraw(P) {
        const start = P.startTurn;
        P.startTurn = function (player, opts = {}) {
            return start.call(this, player, this.gameState.turnNumber === 1 ? { ...opts, skipDraw: true } : opts);
        };
    },
    // 後攻の初回コストを3にしない（2から）
    secondCost2(P) {
        const start = P.startTurn;
        P.startTurn = function (player, opts) {
            start.call(this, player, opts);
            const d = this.players[player];
            if (player !== this.gameState.firstPlayer && d.turnsTaken === 1) { d.maxEnergy = 2; d.energy = 2; }
        };
    },
    // 防御側の反撃は、倒されなかった場合に+1（待ち構える側を少し有利に）
    counterPlus(P) {
        const attack = P.attackWithMonster;
        P.attackWithMonster = function (ap, apos, tp, tpos = null) {
            const t = tpos === null ? null : this.players[tp]?.battlefield[tpos];
            if (!t) return attack.call(this, ap, apos, tp, tpos);
            t.attack += 1;
            const ok = attack.call(this, ap, apos, tp, tpos);
            t.attack -= 1;
            return ok;
        };
    }
};

// 実力差の確認用：攻撃はAIと同じだが、召喚はランダム、移動・交代・勝ち筋探索なし
function weakPolicy(g, p) {
    if (g.computerAttack(p, other(p))) return true;
    const d = g.players[p];
    const cards = d.hand.map((c, i) => i).filter(i => d.hand[i].cost <= d.energy);
    const slots = [0, 1, 2, 3].filter(i => !d.battlefield[i]);
    if (!cards.length || !slots.length) return false;
    return g.summonMonster(p, cards[Math.floor(math.random() * cards.length)], slots[Math.floor(math.random() * slots.length)]);
}
// 合法手からランダムに選ぶ操作
function randomPolicy(g, p) {
    const d = g.players[p];
    const actions = [];
    for (const a of g.listTacticalActions(p)) actions.push(() => g.applyTacticalAction(p, a));
    d.hand.forEach((card, i) => { if (card.cost <= d.energy) d.battlefield.forEach((m, pos) => { if (!m) actions.push(() => g.summonMonster(p, i, pos)); }); });
    if (!actions.length || math.random() < 0.15) return false;
    return actions[Math.floor(math.random() * actions.length)]() !== false;
}
const aiPolicy = (g, p) => g.performComputerAction(p);

function play(Game, n, policies, metrics, startLife = 20) {
    seed = Number(process.env.SEED || 52000) + Math.floor(n / 2);
    const g = Object.create(Game.prototype);
    const first = n % 2 + 1;
    g.gameState = { currentPlayer: first, firstPlayer: first, turnNumber: 1, gameOver: false };
    g.players = {};
    for (const p of [1, 2]) g.players[p] = { life: 20, energy: 0, maxEnergy: 0, turnsTaken: 0, hand: [], deck: [], battlefield: [null, null, null, null], firstTurnCompleted: false, canAttackThisTurn: false, fatigue: 0, swappedColumns: new Set() };
    g.computerPlayers = new Set();
    g.log = g.updateUI = g.scheduleComputerTurn = () => {};
    let fatigue = false;
    const draw = g.drawCard;
    g.drawCard = function (p) { draw.call(this, p); if (this.gameState.gameOver) fatigue = true; };
    g.players[1].life = g.players[2].life = startLife;
    g.createDecks(); g.drawInitialHands(); g.startTurn(first);
    const diffs = [];
    while (!g.gameState.gameOver && g.gameState.turnNumber < 300) {
        const p = g.gameState.currentPlayer;
        for (let s = 0; s < 40 && !g.gameState.gameOver; s++) if (!policies[p](g, p)) break;
        diffs.push(g.players[1].life - g.players[2].life);
        if (!g.gameState.gameOver) g.endTurn();
    }
    const w = g.gameState.winner;
    const winnerLife = g.players[w].life;
    // 勝者が途中でライフ5以上負けていたか
    const sign = w === 1 ? 1 : -1;
    const comeback = diffs.some(d => d * sign <= -startLife / 4);
    let changes = 0, last = 0;
    for (const d of diffs) { const s = Math.sign(d); if (s && last && s !== last) changes++; if (s) last = s; }
    if (metrics) {
        metrics.n++; metrics.turns += g.gameState.turnNumber; metrics.firstWins += w === first; metrics.fatigue += fatigue;
        metrics.close += winnerLife <= startLife / 4; metrics.blowout += winnerLife >= startLife * 3 / 4; metrics.comeback += comeback; metrics.changes += changes;
        metrics.winnerLife += winnerLife / startLife;
    }
    return w;
}

function evaluate(name, variant, N) {
    const lifeTag = variant.find(v => /^life\d+$/.test(v));
    const defaultLife = Number(/startingLife: (\d+)/.exec(fs.readFileSync('game.js', 'utf8'))?.[1] || 20);
    const startLife = lifeTag ? Number(lifeTag.slice(4)) : defaultLife;
    const Game = loadGame(variant.filter(v => v !== lifeTag));
    const m = { n: 0, turns: 0, firstWins: 0, fatigue: 0, close: 0, blowout: 0, comeback: 0, changes: 0, winnerLife: 0 };
    for (let n = 0; n < N; n++) play(Game, n, { 1: aiPolicy, 2: aiPolicy }, m, startLife);
    // 実力差：AIがランダム操作にどれだけ勝つか（席を交代）
    const S = Math.min(N, 1000);
    let skill = 0;
    for (let n = 0; n < S; n++) {
        const seat = Math.floor(n / 2) % 2 === 0 ? 1 : 2;
        const pol = seat === 1 ? { 1: aiPolicy, 2: weakPolicy } : { 1: weakPolicy, 2: aiPolicy };
        if (play(Game, n, pol, null, startLife) === seat) skill++;
    }
    const pct = x => +(x / m.n * 100).toFixed(1);
    return {
        案: name, 接戦率: pct(m.close), 大差率: pct(m.blowout), 逆転率: pct(m.comeback),
        リード交代: +(m.changes / m.n).toFixed(2), 勝者残りライフ率: Math.round(m.winnerLife / m.n * 100),
        平均手番: +(m.turns / m.n).toFixed(1), 疲労決着: pct(m.fatigue), 先攻勝率: pct(m.firstWins),
        対中級勝率: +(skill / S * 100).toFixed(1)
    };
}

const VARIANTS = {
    'v1.8': [],
    守りなし: ['guard0'],
    撃破ドロー: ['deathDraw'],
    後列休息: ['backRest'],
    低ライフコスト: ['lowLifeCost'],
    直接ダメージ上限5: ['directCap'],
    召喚直後の守り: ['summonGuard'],
    反撃プラス1: ['counterPlus'],
    待機で守備: ['guardIdle'],
    召喚直後は攻撃されない: ['summonShelter'],
    召喚時の盾1: ['summonShield'],
};
module.exports = { PATCHES, VARIANTS, evaluate, loadGame, play };

if (require.main === module) {
    const N = Number(process.argv[2] || 2000);
    const names = process.argv.slice(3);
    const extra = {};
    for (const n of names) if (!VARIANTS[n]) extra[n] = n.split('+').map(k => VARIANTS[k] ? VARIANTS[k][0] : k);
    const list = names.length ? names : Object.keys(VARIANTS);
    const rows = list.map(n => evaluate(n, VARIANTS[n] || extra[n], N));
    console.table(rows);
}
