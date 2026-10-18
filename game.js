// Position constants for clarity
const POSITION = {
    FRONT_LEFT: 0,
    FRONT_RIGHT: 1,
    BACK_LEFT: 2,
    BACK_RIGHT: 3
};

// 召喚されたモンスターは、直後の相手手番の間だけ受けるダメージをこの値だけ減らす（0で無効）
// startingLife：開始ライフ
// trample：モンスターを倒した余剰ダメージの行き先。'player'＝持ち主、'back'＝同じ列の後列（いなければ持ち主）、false＝なし
const RULES = { summonGuard: 1, startingLife: 15, trample: 'back' };

// 演出の待ち時間（ミリ秒）
const TIMING = { aiFirstTurn: 900, aiAction: 350, autoEnd: 500 };

const ROW = {
    FRONT: 0,
    BACK: 1
};

const CARD_IMAGE_MAP = {
    "ゴブリン": "img/Goblin.PNG",
    "スライム": "img/Slime.PNG",
    "オーク": "img/Orc.PNG",
    "スケルトン": "img/Skeleton.PNG",
    "トロール": "img/Troll.PNG",
    "ナイト": "img/Knight.PNG",
    "ウィザード": "img/Wizard.PNG",
    "ドラゴン": "img/Dragon.PNG"
};

class CardGame {
    constructor() {
        const firstPlayer = Math.random() < 0.5 ? 1 : 2;

        this.gameState = {
            currentPlayer: firstPlayer,
            firstPlayer,
            turnNumber: 1,
            phase: 'main',
            gameOver: false,
            winner: null
        };
        
        this.players = {
            1: {
                life: RULES.startingLife,
                energy: 0,
                maxEnergy: 0,
                turnsTaken: 0,
                hand: [],
                deck: [],
                battlefield: [null, null, null, null],
                firstTurnCompleted: false,
                fatigue: 0,
                swappedColumns: new Set(),
                canAttackThisTurn: false
            },
            2: {
                life: RULES.startingLife,
                energy: 0,
                maxEnergy: 0,
                turnsTaken: 0,
                hand: [],
                deck: [],
                battlefield: [null, null, null, null],
                firstTurnCompleted: false,
                fatigue: 0,
                swappedColumns: new Set(),
                canAttackThisTurn: false
            }
        };
        
        this.computerPlayers = new Set([2]);

        this.selectedCard = null;
        this.previousPlayerStats = {};
        this.flashIds = new Set(); // 直前に行動したモンスターを光らせる

        this.computerTurnTimeout = null;
        this.autoEndTurnTimeout = null;

        this.initializeGame();
        this.setupEventListeners();
    }

    initializeGame() {
        this.createDecks();
        this.drawInitialHands();
        this.log("カードジャム v1.8 - ゲーム開始！");
        // 先攻も最初の手番にドローする（後攻は最初の手番のマナが3）
        this.startTurn(this.gameState.currentPlayer);

        // AIが先攻の場合は少し待ってから自動でプレイ
        if (this.isComputerTurn()) this.scheduleComputerTurn(TIMING.aiFirstTurn);
    }

    createDecks() {
        const cardTemplates = [
            { name: "ゴブリン", hp: 1, attack: 2, cost: 1 },
            { name: "スライム", hp: 5, attack: 1, cost: 2 },
            { name: "オーク", hp: 3, attack: 2, cost: 2 },
            { name: "スケルトン", hp: 1, attack: 3, cost: 2 },
            { name: "トロール", hp: 5, attack: 2, cost: 3 },
            { name: "ナイト", hp: 3, attack: 3, cost: 3 },
            { name: "ウィザード", hp: 2, attack: 4, cost: 3 },
            { name: "ドラゴン", hp: 4, attack: 4, cost: 4 }
        ];

        for (let player = 1; player <= 2; player++) {
            for (let i = 0; i < cardTemplates.length * 2; i++) {
                const template = cardTemplates[i % cardTemplates.length];
                const card = {
                    id: `${player}-${i}`,
                    ...template,
                    maxHp: template.hp
                };
                this.players[player].deck.push(card);
            }
            this.shuffleDeck(player);
        }
    }

    shuffleDeck(player) {
        const deck = this.players[player].deck;
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
    }

    drawInitialHands() {
        for (let player = 1; player <= 2; player++) {
            for (let i = 0; i < 3; i++) {
                this.drawCard(player);
            }
            // 初手に召喚できるカードを1枚保証する（デッキ構成は変えない）。
            if (!this.players[player].hand.some(card => card.cost <= 2)) {
                const index = this.players[player].deck.findIndex(card => card.cost <= 2);
                if (index >= 0) {
                    [this.players[player].hand[0], this.players[player].deck[index]] =
                        [this.players[player].deck[index], this.players[player].hand[0]];
                }
            }
        }
    }

    drawCard(player) {
        if (this.players[player].deck.length === 0) {
            this.players[player].fatigue += 1;
            this.players[player].life = Math.max(0, this.players[player].life - this.players[player].fatigue);
            this.log(`${this.playerName(player)}は山札切れ！疲労で${this.players[player].fatigue}ダメージ。`);
            this.checkWinCondition();
            return;
        }

        // 手札が満杯なら、手札と山札を保持してドローを見送る
        if (this.players[player].hand.length >= 4) {
            this.log(`${this.playerName(player)}は手札が4枚のためドローを見送りました。`);
            return;
        }

        const card = this.players[player].deck.pop();
        this.players[player].hand.push(card);
    }

    summonMonster(player, cardIndex, position) {
        if (this.gameState.gameOver || player !== this.gameState.currentPlayer || !Number.isInteger(position) || position < 0 || position > 3) return false;
        const card = this.players[player].hand[cardIndex];
        
        if (!card) return false;
        if (this.players[player].energy < card.cost) {
            this.log("マナが足りません！");
            return false;
        }
        if (this.players[player].battlefield[position] !== null) {
            this.log("そのマスにはすでにモンスターがいます！");
            return false;
        }

        this.players[player].energy -= card.cost;
        card.hasAttacked = false;
        card.summonedTurn = this.gameState.turnNumber;
        this.players[player].battlefield[position] = card;
        this.players[player].hand.splice(cardIndex, 1);

        this.log(`${this.playerName(player)}が${card.name}を召喚しました！`);
        this.flashIds?.add(card.id);

        // Move back-row monsters to front if front positions are empty (no log)
        this.moveBackRowToFront(player, false);



        return true;
    }

    attackWithMonster(attackerPlayer, attackerPosition, targetPlayer, targetPosition = null) {
        if (this.gameState.gameOver || attackerPlayer !== this.gameState.currentPlayer || targetPlayer !== (attackerPlayer === 1 ? 2 : 1)) return false;
        const attacker = this.players[attackerPlayer].battlefield[attackerPosition];

        if (attacker && (attacker.hasAttacked || this.getActualRow(attackerPosition, attackerPlayer) !== ROW.FRONT)) {
            this.log("攻撃は前列のモンスター1体につき毎ターン1回です。");
            return false;
        }

        if (!attacker) {
            this.log("攻撃するモンスターがいません！");
            return false;
        }

        if (!this.players[attackerPlayer].canAttackThisTurn) {
            this.log("このターンは攻撃できません！");
            return false;
        }

        // Check if the attack is valid (front-facing only)
        if (targetPosition !== null && !this.isValidAttackTarget(attackerPosition, targetPosition, attackerPlayer, targetPlayer)) {
            this.log("その位置には攻撃できません！正面の前列モンスターのみ攻撃可能です。");
            return false;
        }

        const expectedTarget = this.players[targetPlayer].battlefield[attackerPosition % 2] ? attackerPosition % 2 : null;
        if (targetPosition !== expectedTarget) return false;

        if (targetPosition === null && attacker.summonedTurn === this.gameState.turnNumber) {
            this.log("召喚したターンは直接攻撃できません。敵モンスターには攻撃できます。");
            return false;
        }

        attacker.hasAttacked = true;
        this.flashIds?.add(attacker.id);

        // Calculate damage (no position modifiers)
        const guardTarget = targetPosition === null ? null : this.players[targetPlayer].battlefield[targetPosition];
        let damage = guardTarget ? this.damageTo(attacker, guardTarget) : attacker.attack;

        if (targetPosition !== null) {
            const target = this.players[targetPlayer].battlefield[targetPosition];
            if (!target) {
                this.log("攻撃対象のモンスターがいません！");
                return false;
            }

            target.hp -= damage;
            this.log(`${attacker.name}が${target.name}に${damage}ダメージ！${this.isGuarded(target) ? `（召喚直後の防御+${RULES.summonGuard}で軽減）` : ''}`);

            // Check for counter-attack: front row attacking front row
            const attackerRow = this.getActualRow(attackerPosition, attackerPlayer);
            const targetRow = this.getActualRow(targetPosition, targetPlayer);

            // Debug info

            if (attackerRow === ROW.FRONT && targetRow === ROW.FRONT && target.hp > 0) {
                // Front-to-front attack: target counter-attacks with its ATK
                const counterDamage = target.attack;
                attacker.hp -= counterDamage;
                this.log(`${target.name}が反撃！${attacker.name}に${counterDamage}ダメージ！`);

                if (attacker.hp <= 0) {
                    this.players[attackerPlayer].battlefield[attackerPosition] = null;
                    this.log(`${attacker.name}は破壊されました！`);

                    // Move back-row monsters to front if front positions are empty
                    this.moveBackRowToFront(attackerPlayer);
                }
            }

            if (target.hp <= 0) {
                this.players[targetPlayer].battlefield[targetPosition] = null;
                this.log(`${target.name}は破壊されました！`);
                this.applyTrample(targetPlayer, targetPosition, -target.hp);

                // Move back-row monsters to front if front positions are empty
                this.moveBackRowToFront(targetPlayer);
            }
        } else {
            this.players[targetPlayer].life = Math.max(0, this.players[targetPlayer].life - damage);
            this.log(`${attacker.name}が${this.playerName(targetPlayer)}に${damage}ダメージ！`);
        }

        this.checkWinCondition();
        return true;
    }

    // 倒したモンスターを超えた余剰ダメージを、ルールに応じて後列または持ち主へ
    applyTrample(owner, position, excess) {
        if (!RULES.trample || excess <= 0) return;
        const backPosition = position + 2;
        const back = RULES.trample === 'back' && position < 2 ? this.players[owner].battlefield[backPosition] : null;
        if (back) {
            back.hp -= excess;
            this.log(`貫通！後列の${back.name}に${excess}ダメージ！`);
            if (back.hp <= 0) {
                this.players[owner].battlefield[backPosition] = null;
                this.log(`${back.name}は破壊されました！`);
            }
            return;
        }
        this.players[owner].life = Math.max(0, this.players[owner].life - excess);
        this.log(`貫通！${this.playerName(owner)}に${excess}ダメージ！`);
    }

    // 直前の相手手番に召喚されたモンスターは守られている
    isGuarded(monster) {
        return RULES.summonGuard > 0 && !!monster && monster.summonedTurn === this.gameState.turnNumber - 1;
    }

    damageTo(attacker, target) {
        return Math.max(0, attacker.attack - (this.isGuarded(target) ? RULES.summonGuard : 0));
    }

    // Get actual row for position considering player 2's visual layout
    getActualRow(position, player) {
        // For Player 1: Normal layout
        // FRONT_LEFT(0), FRONT_RIGHT(1) = front row
        // BACK_LEFT(2), BACK_RIGHT(3) = back row

        // For Player 2: CSS flipped layout means:
        // BACK_LEFT(2), BACK_RIGHT(3) = visually appear as front row (下側)
        // FRONT_LEFT(0), FRONT_RIGHT(1) = visually appear as back row (上側)

        if (position === POSITION.FRONT_LEFT || position === POSITION.FRONT_RIGHT) {
            return player === 1 ? ROW.FRONT : ROW.FRONT;  // P1: 前列, P2: 前列（視覚的に下側）
        } else if (position === POSITION.BACK_LEFT || position === POSITION.BACK_RIGHT) {
            return player === 1 ? ROW.BACK : ROW.BACK;     // P1: 後列, P2: 後列（視覚的に上側）
        }

        return ROW.FRONT; // fallback
    }

    // Check if attack target is valid (front-facing only)
    isValidAttackTarget(attackerPosition, targetPosition, attackerPlayer, targetPlayer) {
        // Position mapping: 0=front-left, 1=front-right, 2=back-left, 3=back-right
        // Attackers can only target the same column (left attacks left, right attacks right)
        // and only front row targets
        const attackerColumn = attackerPosition % 2; // 0 for left, 1 for right
        const targetColumn = targetPosition % 2;
        const targetRow = this.getActualRow(targetPosition, targetPlayer);

        return attackerColumn === targetColumn && targetRow === ROW.FRONT;
    }

    // Move back-row monsters to front-row if front positions are empty
    moveBackRowToFront(player, showLog = true) {
        const battlefield = this.players[player].battlefield;
        let moved = false;

        // Check left column (FRONT_LEFT and BACK_LEFT)
        if (!battlefield[POSITION.FRONT_LEFT] && battlefield[POSITION.BACK_LEFT]) {
            battlefield[POSITION.FRONT_LEFT] = battlefield[POSITION.BACK_LEFT];
            battlefield[POSITION.BACK_LEFT] = null;
            if (showLog) {
                this.log(`${battlefield[POSITION.FRONT_LEFT].name}が前列に移動しました！`);
            }
            moved = true;
        }

        // Check right column (FRONT_RIGHT and BACK_RIGHT)
        if (!battlefield[POSITION.FRONT_RIGHT] && battlefield[POSITION.BACK_RIGHT]) {
            battlefield[POSITION.FRONT_RIGHT] = battlefield[POSITION.BACK_RIGHT];
            battlefield[POSITION.BACK_RIGHT] = null;
            if (showLog) {
                this.log(`${battlefield[POSITION.FRONT_RIGHT].name}が前列に移動しました！`);
            }
            moved = true;
        }

        return moved;
    }

    startTurn(player, { skipDraw = false } = {}) {
        if (this.gameState.gameOver) return;

        const playerData = this.players[player];
        const isFirstTurnForPlayer = !playerData.firstTurnCompleted;

        if (!skipDraw) {
            this.drawCard(player);
            if (this.gameState.gameOver) {
                this.updateUI();
                return;
            }
        }

        playerData.turnsTaken += 1;
        // 先攻・後攻の差を縮めるため、後攻はマナが1手番早く伸びる（先攻2→3→4、後攻3→4）
        const isSecondPlayer = this.gameState.firstPlayer !== undefined && player !== this.gameState.firstPlayer;
        playerData.maxEnergy = Math.min(4, playerData.turnsTaken + (isSecondPlayer ? 2 : 1));
        playerData.energy = playerData.maxEnergy;
        playerData.battlefield.forEach(monster => { if (monster) monster.hasAttacked = false; });
        playerData.swappedColumns.clear();
        playerData.canAttackThisTurn = !isFirstTurnForPlayer;

        this.selectedCard = null;

        this.log(`${this.playerName(player)}のターンです。`);
        if (!playerData.canAttackThisTurn) {
            this.log("このターンは攻撃できません。");
        }

        this.updateUI();

        if (this.isComputerTurn()) {
            this.scheduleComputerTurn();
        }
    }

    endTurn() {
        if (this.gameState.gameOver) return;

        // Clear any pending auto-end turn timeout
        if (this.autoEndTurnTimeout) {
            clearTimeout(this.autoEndTurnTimeout);
            this.autoEndTurnTimeout = null;
        }

        const currentPlayer = this.gameState.currentPlayer;
        this.players[currentPlayer].firstTurnCompleted = true;
        this.players[currentPlayer].canAttackThisTurn = true;

        const nextPlayer = currentPlayer === 1 ? 2 : 1;
        this.gameState.currentPlayer = nextPlayer;
        this.gameState.turnNumber++;

        this.startTurn(nextPlayer);
    }

    checkWinCondition() {
        for (let player = 1; player <= 2; player++) {
            if (this.players[player].life <= 0) {
                const winner = player === 1 ? 2 : 1;
                this.gameState.gameOver = true;
                this.gameState.winner = winner;
                if (this.computerTurnTimeout) {
                    clearTimeout(this.computerTurnTimeout);
                    this.computerTurnTimeout = null;
                }
                if (this.autoEndTurnTimeout) {
                    clearTimeout(this.autoEndTurnTimeout);
                    this.autoEndTurnTimeout = null;
                }
                this.log(`${this.playerName(winner)}の勝利！`);
                this.selectedCard = null;
                this.updateUI();
                return;
            }
        }
    }

    playerName(player) {
        return this.isComputerPlayer(player) ? 'AI' : 'あなた';
    }

    updateUI() {
        if (this.isSimulation || typeof document === 'undefined') return;
        // 再描画で要素が作り直されるので、キーボードのフォーカスを引き継ぐ
        const focusKey = document.activeElement?.dataset?.focusKey;

        for (let player = 1; player <= 2; player++) {
            const data = this.players[player];
            const playerArea = document.getElementById(`player${player}-area`);
            playerArea.classList.toggle('active-turn', player === this.gameState.currentPlayer);

            this.updateStatWithAnimation(player, 'life', data.life, document.getElementById(`player${player}-life`));
            this.updateStatWithAnimation(player, 'energy', `${data.energy}/${data.maxEnergy}`, document.getElementById(`player${player}-energy`));
            const gems = document.getElementById(`player${player}-gems`);
            if (gems) gems.textContent = '◆'.repeat(data.energy) + '◇'.repeat(Math.max(0, data.maxEnergy - data.energy));
            const deckElement = document.getElementById(`player${player}-deck`);
            if (deckElement) {
                deckElement.textContent = data.deck.length > 0 ? `${data.deck.length}` : `0（次の疲労${data.fatigue + 1}）`;
                deckElement.parentElement.classList.toggle('warning', data.deck.length === 0);
                deckElement.parentElement.title = data.deck.length > 0
                    ? `山札残り${data.deck.length}枚。0枚でドローすると疲労ダメージ。`
                    : `次のドローで疲労${data.fatigue + 1}ダメージ`;
            }
            const handCount = document.getElementById(`player${player}-handcount`);
            if (handCount) {
                handCount.textContent = `${data.hand.length}/4`;
                handCount.parentElement.title = data.hand.length >= 4 ? '手札満杯：次のドローは見送り（山札0なら疲労は受ける）' : '手札は4枚まで';
            }

            this.renderHand(player);
            this.renderBattlefield(player);
        }
        this.flashIds?.clear();

        const status = document.getElementById('turn-status');
        if (this.gameState.gameOver) {
            status.textContent = `対戦終了 · ${this.playerName(this.gameState.winner)}の勝利`;
        } else {
            status.textContent = `ターン${this.gameState.turnNumber} · ${this.isComputerTurn() ? 'AIの手番' : 'あなたの手番'}${!this.players[this.gameState.currentPlayer].canAttackThisTurn ? '（初回は攻撃不可）' : ''}`;
            if (!this.isComputerTurn() && this.players[1].energy === 0) {
                const remainingAttacks = [0, 1].filter(position => this.canMonsterAttack(1, position)).length;
                if (remainingAttacks > 0) status.textContent += ` · マナ0でも攻撃可能（${remainingAttacks}体）`;
            }
        }
        const endTurnBtn = document.getElementById('end-turn-btn');
        if (this.gameState.gameOver) {
            endTurnBtn.disabled = true;
            endTurnBtn.textContent = this.gameState.winner === 1 ? 'あなたの勝利！' : 'AIの勝利';
        } else if (this.isComputerTurn()) {
            endTurnBtn.disabled = true;
            endTurnBtn.textContent = 'AI思考中...';
        } else {
            endTurnBtn.disabled = false;
            endTurnBtn.textContent = 'ターン終了';
        }

        if (focusKey) {
            const target = document.querySelector(`[data-focus-key="${focusKey}"]`) ||
                (!endTurnBtn.disabled ? endTurnBtn : null);
            if (target && !target.disabled) target.focus();
        }
    }

    updateStatWithAnimation(player, statKey, value, element) {
        if (!element) return;

        const previousValue = this.previousPlayerStats[player]?.[statKey];
        element.textContent = value;

        if (previousValue !== undefined && previousValue !== value) {
            element.classList.remove('stat-bump-up', 'stat-bump-down');
            // Force reflow so repeated animation reliably triggers.
            void element.offsetWidth;

            const prevNum = Number(String(previousValue).split('/')[0]);
            const nextNum = Number(String(value).split('/')[0]);
            const isNumericChange = !Number.isNaN(prevNum) && !Number.isNaN(nextNum);
            const animationClass = isNumericChange && nextNum < prevNum
                ? 'stat-bump-down'
                : 'stat-bump-up';

            element.classList.add(animationClass);
        }

        if (!this.previousPlayerStats[player]) {
            this.previousPlayerStats[player] = {};
        }
        this.previousPlayerStats[player][statKey] = value;
    }

    // Enter/Spaceでもクリックと同じ操作をする
    makeActivatable(element, label, onActivate) {
        element.tabIndex = 0;
        element.setAttribute('role', 'button');
        element.setAttribute('aria-label', label);
        element.addEventListener('click', onActivate);
        element.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onActivate();
            }
        });
    }

    renderHand(player) {
        const handElement = document.getElementById(`player${player}-hand`);
        handElement.innerHTML = '';
        const interactive = player === this.gameState.currentPlayer && !this.isComputerPlayer(player) && !this.gameState.gameOver;

        this.players[player].hand.forEach((card, index) => {
            const cardElement = document.createElement('div');
            cardElement.className = 'card';
            cardElement.title = `${card.name}：召喚にマナ${card.cost}`;
            const unaffordable = player === 1 && card.cost > this.players[player].energy;
            if (unaffordable) cardElement.classList.add('unaffordable');

            if (interactive && this.selectedCard === index) {
                cardElement.classList.add('selected');
            }

            cardElement.innerHTML = `
                <div class="card-name">
                    <span class="card-name-text">${card.name}</span>
                    <span class="card-cost">${card.cost}</span>
                </div>
                <img class="card-image" src="${this.getCardImagePath(card.name)}" alt="">
                <div class="card-stats">
                    <span class="stat-pill hp-stat"><img class="stat-icon" src="img/heart.svg" alt="体力"><span class="stat-value">${card.hp}</span></span>
                    <span class="stat-pill attack-stat"><img class="stat-icon" src="img/sword.svg" alt="攻撃"><span class="stat-value">${card.attack}</span></span>
                </div>
            `;

            if (interactive) {
                cardElement.dataset.focusKey = `hand-${card.id}`;
                this.makeActivatable(cardElement,
                    `${card.name}（マナ${card.cost}、体力${card.hp}、攻撃${card.attack}）${unaffordable ? '、マナ不足' : ''}を選択`,
                    () => this.selectCard(index));
                cardElement.setAttribute('aria-pressed', String(this.selectedCard === index));
            }

            handElement.appendChild(cardElement);
        });
    }

    // 攻撃した場合の結果を実行前に示す
    previewAttack(player, position) {
        const monster = this.players[player].battlefield[position];
        const opponent = player === 1 ? 2 : 1;
        const target = this.players[opponent].battlefield[position % 2];
        if (!target) {
            return { short: `本体に${monster.attack}`, detail: `${this.playerName(opponent)}に${monster.attack}ダメージ` };
        }
        const damage = this.damageTo(monster, target);
        const kills = damage >= target.hp;
        const counter = kills ? 0 : target.attack;
        const dies = !kills && counter >= monster.hp;
        const excess = RULES.trample && kills ? damage - target.hp : 0;
        const back = RULES.trample === 'back' ? this.players[opponent].battlefield[(position % 2) + 2] : null;
        const trampleTo = back ? back.name : '本体';
        const short = kills ? `${target.name}撃破${excess > 0 ? `+${trampleTo}${excess}` : ''}` : dies ? `${damage}・反撃で倒れる` : `${damage}・反撃${counter}`;
        const guardNote = this.isGuarded(target) ? `召喚直後の防御+${RULES.summonGuard}。` : '';
        const detail = guardNote + (kills
            ? `${target.name}に${damage}ダメージで撃破（反撃なし）${excess > 0 ? `。貫通で${back ? `後列の${back.name}` : this.playerName(opponent)}に${excess}ダメージ` : ''}`
            : `${target.name}に${damage}ダメージ（残り体力${target.hp - damage}）。反撃${counter}${dies ? 'で倒れます' : ''}`);
        return { short, detail, dies };
    }

    monsterStatus(player, position) {
        const monster = this.players[player].battlefield[position];
        if (this.gameState.gameOver || player !== this.gameState.currentPlayer) return '';
        const justSummoned = monster.summonedTurn === this.gameState.turnNumber;
        if (monster.hasAttacked) return '攻撃済み';
        if (!this.players[player].canAttackThisTurn) return '初回は攻撃不可';
        if (position < 2) return justSummoned && !this.canMonsterAttack(player, position) ? '召喚直後：直接攻撃不可' : '';
        return justSummoned ? '後列・召喚直後' : '後列・攻撃可';
    }

    createActionButton(label, ariaLabel, focusKey, { disabled = false, title = '', kind = '' } = {}, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.setAttribute('aria-label', ariaLabel);
        button.dataset.focusKey = focusKey;
        if (kind) button.classList.add(...kind.split(" "));
        if (title) button.title = title;
        button.disabled = disabled;
        button.addEventListener('click', event => {
            event.stopPropagation();
            onClick();
        });
        return button;
    }

    renderBattlefield(player) {
        const battlefieldElement = document.getElementById(`player${player}-battlefield`);
        const slots = battlefieldElement.querySelectorAll('.field-slot');
        const interactive = player === this.gameState.currentPlayer && !this.isComputerPlayer(player) && !this.gameState.gameOver;
        const data = this.players[player];

        slots.forEach((slot, position) => {
            const fresh = slot.cloneNode(false); // 古いイベントを残さない
            slot.replaceWith(fresh);
            slot = fresh;
            slot.classList.remove('empty-slot');
            slot.removeAttribute('role');
            slot.removeAttribute('tabindex');
            slot.removeAttribute('aria-label');
            delete slot.dataset.focusKey;
            const slotName = `${position < 2 ? '前列' : '後列'}${position % 2 === 0 ? '左' : '右'}`;
            slot.dataset.label = slotName;
            const monster = data.battlefield[position];

            if (monster) {
                const monsterElement = document.createElement('div');
                monsterElement.className = 'monster';
                const status = this.monsterStatus(player, position);
                if (monster.hasAttacked) monsterElement.classList.add('exhausted');
                if (this.flashIds?.has(monster.id)) monsterElement.classList.add('flash');
                const guarded = !this.gameState.gameOver && this.isGuarded(monster);
                if (guarded) monsterElement.classList.add('guarded');
                monsterElement.title = `${monster.name}（${slotName}）${status ? '：' + status : ''}`;
                monsterElement.innerHTML = `
                    <img class="monster-image" src="${this.getCardImagePath(monster.name)}" alt="">
                    <div class="monster-info">
                        <span class="monster-label">${monster.name}${guarded ? `<span class="guard-badge" title="召喚直後：この手番の間、防御+${RULES.summonGuard}（受けるダメージ-${RULES.summonGuard}）">防御+${RULES.summonGuard}</span>` : ''}${status ? `<small> · ${status}</small>` : ''}</span>
                        <div class="monster-stats">
                            <span class="stat-pill hp-stat"><img class="stat-icon" src="img/heart.svg" alt="体力"><span>${monster.hp}/${monster.maxHp}</span></span>
                            <span class="stat-pill attack-stat"><img class="stat-icon" src="img/sword.svg" alt="攻撃"><span>${monster.attack}</span></span>
                        </div>
                    </div>
                `;

                if (interactive) {
                    const controls = document.createElement('div');
                    controls.className = 'monster-actions';
                    if (position < 2) {
                        if (this.canMonsterAttack(player, position)) {
                            const preview = this.previewAttack(player, position);
                            controls.appendChild(this.createActionButton(
                                `攻撃：${preview.short}`, `${monster.name}で攻撃：${preview.detail}`, `attack-${monster.id}`,
                                { title: preview.detail, kind: preview.dies ? 'attack danger' : 'attack' },
                                () => this.runPlayerAction(() => this.attackFrontMonster(player, position))));
                        }
                    } else {
                        const swapped = data.swappedColumns.has(position % 2);
                        const front = data.battlefield[position % 2];
                        controls.appendChild(this.createActionButton(
                            swapped ? '交代済み' : '前へ交代 ◆1',
                            `${monster.name}を前列${front ? `の${front.name}と交代` : 'へ移動'}（マナ1）`,
                            `swap-${monster.id}`,
                            { disabled: swapped || data.energy < 1, title: swapped ? 'この列は今ターン交代済み' : data.energy < 1 ? 'マナ不足' : '' },
                            () => this.runPlayerAction(() => this.swapBackToFront(player, position))));
                    }
                    if (!data.battlefield[position ^ 1]) {
                        const moved = monster.movedTurn === this.gameState.turnNumber;
                        const direction = position % 2 === 0 ? '右' : '左';
                        controls.appendChild(this.createActionButton(
                            moved ? '移動済み' : `${direction}へ ◆1`,
                            `${monster.name}を${direction}へ移動（マナ1）`,
                            `move-${monster.id}`,
                            { disabled: !this.canMoveSideways(player, position), title: moved ? 'このモンスターは今ターン移動済み' : data.energy < 1 ? 'マナ不足' : '' },
                            () => this.runPlayerAction(() => this.moveSideways(player, position))));
                    }
                    if (controls.childElementCount > 0) monsterElement.querySelector('.monster-info').appendChild(controls);
                }
                slot.appendChild(monsterElement);
            } else if (interactive && this.selectedCard !== null) {
                slot.classList.add('empty-slot');
                slot.dataset.focusKey = `slot-${position}`;
                const card = data.hand[this.selectedCard];
                this.makeActivatable(slot, `${card ? card.name : ''}を${slotName}に召喚`, () => this.placeMonster(position));
            }
        });
    }

    getCardImagePath(cardName) {
        return CARD_IMAGE_MAP[cardName] || '';
    }

    selectCard(cardIndex) {
        if (this.gameState.gameOver || this.isComputerTurn()) return;

        // 同じカードを再選択した場合は選択解除
        if (this.selectedCard === cardIndex) {
            this.selectedCard = null;
        } else {
            this.selectedCard = cardIndex;
        }
        this.updateUI();
    }

    // ボタンからの攻撃・交代・移動を実行して画面を更新する
    runPlayerAction(action) {
        if (this.gameState.gameOver || this.isComputerTurn()) return;
        const result = action();
        this.selectedCard = null;
        this.updateUI();
        if (result !== false) this.checkAutoEndTurn();
    }

    // 前列モンスターが正面へ攻撃する（敵前列がいなければ相手本体）
    attackFrontMonster(player, position) {
        if (!this.players[player].canAttackThisTurn) {
            this.log("このターンは攻撃できません！");
            return false;
        }
        const opponent = player === 1 ? 2 : 1;
        const column = position % 2;
        return this.attackWithMonster(player, position, opponent, this.players[opponent].battlefield[column] ? column : null);
    }

    // 前後交代はマナ1。
    swapBackToFront(player, position) {
        if (this.gameState.gameOver || player !== this.gameState.currentPlayer || position < 2 || position > 3 || this.players[player].energy < 1) return false;
        const column = position % 2; // 0 for left, 1 for right
        if (this.players[player].swappedColumns.has(column)) return false;
        const frontPosition = column; // front position in same column
        const backPosition = position;

        const backMonster = this.players[player].battlefield[backPosition];
        const frontMonster = this.players[player].battlefield[frontPosition];

        if (!backMonster) return false;

        this.players[player].energy -= 1;
        this.players[player].swappedColumns.add(column);
        // 攻撃済み・召喚直後の状態はそのまま維持する。
        this.players[player].battlefield[frontPosition] = backMonster;
        this.players[player].battlefield[backPosition] = frontMonster;

        if (frontMonster) {
            this.log(`${backMonster.name}と${frontMonster.name}が位置を交代しました（マナ1）！`);
        } else {
            this.log(`${backMonster.name}が前列に移動しました！`);
        }
        return true;
    }

    canMoveSideways(player, position) {
        if (this.gameState.gameOver || player !== this.gameState.currentPlayer || !Number.isInteger(position) || position < 0 || position > 3) return false;
        const data = this.players[player];
        const monster = data.battlefield[position];
        return data.energy >= 1 && !!monster && !data.battlefield[position ^ 1] && monster.movedTurn !== this.gameState.turnNumber;
    }

    moveSideways(player, position) {
        if (!this.canMoveSideways(player, position)) return false;
        const data = this.players[player];
        const monster = data.battlefield[position];
        data.energy -= 1;
        data.battlefield[position ^ 1] = monster;
        data.battlefield[position] = null;
        monster.movedTurn = this.gameState.turnNumber;
        this.log(`${monster.name}が${position % 2 === 0 ? '右' : '左'}列へ移動しました（マナ1）。`);
        this.moveBackRowToFront(player);
        return true;
    }

    computerMove(player) {
        const opponent = player === 1 ? 2 : 1;
        for (const position of [0, 1]) {
            const monster = this.players[player].battlefield[position];
            if (!monster || monster.hasAttacked || !this.players[player].canAttackThisTurn || monster.summonedTurn === this.gameState.turnNumber) continue;
            if (this.canMoveSideways(player, position) && this.players[opponent].battlefield[position] && !this.players[opponent].battlefield[position ^ 1]) {
                if (this.moveSideways(player, position)) { this.updateUI(); return true; }
            }
        }
        return false;
    }

    placeMonster(position) {
        if (this.selectedCard === null) return;
        if (this.gameState.gameOver || this.isComputerTurn()) return;

        if (this.summonMonster(this.gameState.currentPlayer, this.selectedCard, position)) {
            this.selectedCard = null;
            this.updateUI();

            // Check if shared cost are 0 and auto-end turn
            this.checkAutoEndTurn();
        }
    }

    canMonsterAttack(player, position) {
        if (this.gameState.gameOver || player !== this.gameState.currentPlayer || position < 0 || position > 1) return false;
        const monster = this.players[player].battlefield[position];
        if (!monster || monster.hasAttacked || !this.players[player].canAttackThisTurn) return false;
        return monster.summonedTurn !== this.gameState.turnNumber || !!this.players[player === 1 ? 2 : 1].battlefield[position];
    }

    // マナを使い切っても、無料攻撃が残っている間は手番を維持する。
    checkAutoEndTurn() {
        if (this.gameState.gameOver || this.isComputerTurn()) return; // Don't auto-end computer turns
        if (this.autoEndTurnTimeout) {
            clearTimeout(this.autoEndTurnTimeout);
            this.autoEndTurnTimeout = null;
        }
        const currentPlayer = this.gameState.currentPlayer;
        if (this.players[currentPlayer].energy <= 0 && ![0, 1].some(position => this.canMonsterAttack(currentPlayer, position))) {
            this.log("マナが0で、攻撃も残っていないためターンを終了します。");
            this.autoEndTurnTimeout = setTimeout(() => {
                this.autoEndTurnTimeout = null;
                if (!this.gameState.gameOver && this.gameState.currentPlayer === currentPlayer &&
                    this.players[currentPlayer].energy <= 0 &&
                    ![0, 1].some(position => this.canMonsterAttack(currentPlayer, position))) {
                    this.endTurn();
                }
            }, TIMING.autoEnd);
        }
    }

    scheduleComputerTurn(delay = TIMING.aiAction) {
        if (this.computerTurnTimeout) {
            clearTimeout(this.computerTurnTimeout);
        }
        this.computerTurnTimeout = setTimeout(() => {
            this.computerTurnTimeout = null;
            this.runComputerTurn();
        }, delay);
    }

    async runComputerTurn() {
        if (!this.isComputerTurn() || this.gameState.gameOver) return;

        const player = this.gameState.currentPlayer;
        await this.delay(TIMING.aiAction);
        while (!this.gameState.gameOver && this.gameState.currentPlayer === player && this.performComputerAction(player)) {
            await this.delay(TIMING.aiAction);
        }

        if (!this.gameState.gameOver) {
            await this.delay(TIMING.aiAction);
            this.endTurn();
        }
    }

    performComputerAction(player) {
        if (this.gameState.gameOver || player !== this.gameState.currentPlayer) return false;
        const opponent = player === 1 ? 2 : 1;

        // 攻撃・交代・移動を組み合わせて、この手番で勝てる手順があれば最優先で実行する
        const lethalPlan = this.findLethalPlan(player);
        if (lethalPlan && lethalPlan.length > 0) {
            const success = this.applyTacticalAction(player, lethalPlan[0]);
            if (success) {
                this.updateUI();
                return true;
            }
        }

        return this.computerMove(player) || this.computerAttack(player, opponent) || this.computerSwap(player) ||
            this.computerSummon(player);
    }

    // 探索用に盤面を複製する（ログや画面更新はしない）
    cloneForSearch() {
        const sim = Object.create(CardGame.prototype);
        sim.isSimulation = true;
        sim.gameState = { ...this.gameState };
        sim.players = {};
        for (const p of [1, 2]) {
            const data = this.players[p];
            sim.players[p] = {
                ...data,
                hand: data.hand.map(card => ({ ...card })),
                deck: [],
                battlefield: data.battlefield.map(monster => monster && { ...monster }),
                swappedColumns: new Set(data.swappedColumns)
            };
        }
        sim.computerPlayers = this.computerPlayers;
        sim.computerTurnTimeout = null;
        sim.autoEndTurnTimeout = null;
        sim.log = () => {};
        return sim;
    }

    canSwap(player, position) {
        const data = this.players[player];
        return !this.gameState.gameOver && player === this.gameState.currentPlayer && (position === 2 || position === 3) &&
            data.energy >= 1 && !!data.battlefield[position] && !data.swappedColumns.has(position % 2);
    }

    listTacticalActions(player) {
        const actions = [];
        for (const position of [0, 1]) if (this.canMonsterAttack(player, position)) actions.push({ type: 'attack', position });
        for (const position of [2, 3]) if (this.canSwap(player, position)) actions.push({ type: 'swap', position });
        for (const position of [0, 1, 2, 3]) if (this.canMoveSideways(player, position)) actions.push({ type: 'move', position });
        return actions;
    }

    applyTacticalAction(player, action) {
        if (action.type === 'attack') return this.attackFrontMonster(player, action.position);
        if (action.type === 'swap') return this.swapBackToFront(player, action.position);
        if (action.type === 'move') return this.moveSideways(player, action.position);
        return false;
    }

    // 同一手番内の致死手順を深さ優先で探す。見つからなければnull。
    findLethalPlan(player, nodeLimit = 5000) {
        const opponent = player === 1 ? 2 : 1;
        if (!this.players[player].canAttackThisTurn) return null;
        let nodes = 0;
        const search = state => {
            if (state.gameState.gameOver) return state.gameState.winner === player ? [] : null;
            if (++nodes > nodeLimit) return null;
            // 直接攻撃できる可能性があるモンスターの攻撃力合計が足りなければ打ち切る
            const potential = state.players[player].battlefield
                .filter(monster => monster && !monster.hasAttacked && monster.summonedTurn !== state.gameState.turnNumber)
                .reduce((sum, monster) => sum + monster.attack, 0);
            if (potential < state.players[opponent].life) return null;
            for (const action of state.listTacticalActions(player)) {
                const next = state.cloneForSearch();
                if (!next.applyTacticalAction(player, action)) continue;
                const rest = search(next);
                if (rest) return [action, ...rest];
            }
            return null;
        };
        return search(this.cloneForSearch());
    }

    computerSummon(player) {
        const playerData = this.players[player];

        if (playerData.energy < 1) return false;

        const openPositions = [];
        playerData.battlefield.forEach((monster, index) => {
            if (monster === null) {
                openPositions.push(index);
            }
        });

        if (openPositions.length === 0) return false;

        const selectableCards = playerData.hand
            .map((card, index) => ({ card, index }))
            .filter(item => item.card.cost <= playerData.energy);

        if (selectableCards.length === 0) return false;

        selectableCards.sort((a, b) => {
            const scoreDiff = this.evaluateCardScore(b.card) - this.evaluateCardScore(a.card);
            if (scoreDiff !== 0) return scoreDiff;
            if (b.card.attack !== a.card.attack) {
                return b.card.attack - a.card.attack;
            }
            return b.card.hp - a.card.hp;
        });

        const targetCard = selectableCards[0];
        const opponent = player === 1 ? 2 : 1;
        openPositions.sort((a, b) => {
            const score = pos => pos < 2 ? (this.players[opponent].battlefield[pos] ? 2 : 1) : 0;
            return score(b) - score(a);
        });
        const position = openPositions[0];

        const success = this.summonMonster(player, targetCard.index, position);
        if (success) {
            this.updateUI();
        }
        return success;
    }

    // 攻撃候補。反撃で倒れる攻撃も含める（その敵は次の手番にこちらを倒せるため、先に削る方が得）
    computerAttackChoices(player) {
        const opponent = player === 1 ? 2 : 1;
        const opponentData = this.players[opponent];
        const choices = [];
        for (const position of [0, 1]) {
            if (!this.canMonsterAttack(player, position)) continue;
            const attacker = this.players[player].battlefield[position];
            const target = opponentData.battlefield[position];
            if (target) {
                const damage = this.damageTo(attacker, target);
                if (damage === 0) continue; // 防御で無効になる攻撃は反撃を受けるだけ
                const willKill = damage >= target.hp;
                const trample = RULES.trample && willKill ? damage - target.hp : 0;
                choices.push({ attackerIndex: position, targetPosition: position, willKill, damage: damage + trample,
                    targetHp: target.hp, targetAttack: target.attack, attackerAttack: attacker.attack });
            } else {
                choices.push({ attackerIndex: position, targetPosition: null, willKill: false, damage: attacker.attack,
                    targetHp: opponentData.life, targetAttack: 0, attackerAttack: attacker.attack });
            }
        }
        return choices;
    }

    computerAttack(player, opponent, lethalOnly = false) {
        let choices = this.computerAttackChoices(player);
        if (lethalOnly) choices = choices.filter(choice => choice.targetPosition === null && choice.damage >= this.players[opponent].life);
        if (choices.length === 0) return false;

        choices.sort((a, b) => {
            if (a.willKill !== b.willKill) return b.willKill - a.willKill;
            if (a.targetAttack !== b.targetAttack) return b.targetAttack - a.targetAttack;
            if (a.damage !== b.damage) return b.damage - a.damage;
            if (a.targetHp !== b.targetHp) return a.targetHp - b.targetHp;
            return b.attackerAttack - a.attackerAttack;
        });

        const choice = choices[0];
        const success = this.attackWithMonster(player, choice.attackerIndex, opponent, choice.targetPosition);
        if (success) {
            this.updateUI();
        }
        return success;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    evaluateCardScore(card) {
        return card.attack * 3 + card.hp * 2 - card.cost;
    }

    setupEventListeners() {
        // 対戦途中の誤クリックで対戦が消えないよう、2回押しで新しい対戦を始める
        const restartBtn = document.getElementById('restart-btn');
        let restartTimer = null;
        restartBtn.addEventListener('click', () => {
            const inProgress = !this.gameState.gameOver && this.gameState.turnNumber > 2;
            if (!inProgress || restartTimer) {
                window.location.reload();
                return;
            }
            restartBtn.textContent = 'もう一度押すと新しい対戦';
            restartBtn.classList.add('confirming');
            restartTimer = setTimeout(() => {
                restartTimer = null;
                restartBtn.textContent = '新しい対戦';
                restartBtn.classList.remove('confirming');
            }, 3000);
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && this.selectedCard !== null) {
                this.selectedCard = null;
                this.updateUI();
            }
        });
        document.getElementById('end-turn-btn').addEventListener('click', () => {
            if (this.gameState.gameOver || this.isComputerTurn()) return;
            this.endTurn();
        });
    }

    log(message) {
        const logContent = document.getElementById('log-content');
        const logEntry = document.createElement('div');
        logEntry.textContent = message;

        // Insert at the beginning to show newest first
        logContent.insertBefore(logEntry, logContent.firstChild);

        // Scroll to top to show the newest entry
        logContent.scrollTop = 0;
    }

    // 交代は、交代したモンスターがこの手番に攻撃できる場合だけ行う
    computerSwap(player) {
        const playerData = this.players[player];
        if (playerData.energy < 1 || !playerData.canAttackThisTurn) return false;
        const opponent = player === 1 ? 2 : 1;
        const usefulFront = new Set(this.computerAttackChoices(player).map(choice => choice.attackerIndex));
        // 後列は攻撃されないので、反撃で倒れるだけの交代はしない

        for (const backPos of [POSITION.BACK_LEFT, POSITION.BACK_RIGHT]) {
            if (!this.canSwap(player, backPos)) continue;
            const backMonster = playerData.battlefield[backPos];
            if (backMonster.hasAttacked) continue;
            const frontPos = backPos - 2;
            if (usefulFront.has(frontPos)) continue; // 前列が先に攻撃できるなら交代しない
            const enemy = this.players[opponent].battlefield[frontPos];
            if (!enemy && backMonster.summonedTurn === this.gameState.turnNumber) continue;
            if (enemy && backMonster.attack < enemy.hp && enemy.attack >= backMonster.hp) continue;
            return this.swapBackToFront(player, backPos);
        }
        return false;
    }

    isComputerPlayer(player) {
        return this.computerPlayers.has(player);
    }

    isComputerTurn() {
        return this.isComputerPlayer(this.gameState.currentPlayer);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new CardGame();
});
