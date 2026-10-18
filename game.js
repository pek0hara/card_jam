// Position constants for clarity
const POSITION = {
    FRONT_LEFT: 0,
    FRONT_RIGHT: 1,
    BACK_LEFT: 2,
    BACK_RIGHT: 3
};

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
            turnNumber: 1,
            phase: 'main',
            gameOver: false,
            winner: null
        };
        
        this.players = {
            1: {
                life: 20,
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
                life: 20,
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

        this.computerTurnTimeout = null;
        this.autoEndTurnTimeout = null;

        this.initializeGame();
        this.setupEventListeners();
    }

    initializeGame() {
        this.createDecks();
        this.drawInitialHands();
        this.log("カードジャム v1.5 - ゲーム開始！");
        this.startTurn(this.gameState.currentPlayer, { skipDraw: true });

        // コンピュータプレイヤーが先攻の場合は自動でプレイ
        if (this.computerPlayers.has(this.gameState.currentPlayer)) {
            this.log(`プレイヤー${this.gameState.currentPlayer}はコンピュータプレイヤーです。自動でプレイします。`);
            this.scheduleComputerTurn(1500);
        }
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
            this.log(`プレイヤー${player}は山札切れ！疲労で${this.players[player].fatigue}ダメージ。`);
            this.checkWinCondition();
            return;
        }

        // 手札が満杯なら、手札と山札を保持してドローを見送る
        if (this.players[player].hand.length >= 4) {
            this.log(`プレイヤー${player}は手札が4枚のためドローを見送りました。`);
            return;
        }

        const card = this.players[player].deck.pop();
        this.players[player].hand.push(card);
    }

    discardExcessCards(player) {
        while (this.players[player].hand.length > 4) {
            const randomIndex = Math.floor(Math.random() * this.players[player].hand.length);
            const discardedCard = this.players[player].hand.splice(randomIndex, 1)[0];
            this.log(`プレイヤー${player}は${discardedCard.name}を捨てました。`);
        }
    }

    summonMonster(player, cardIndex, position) {
        if (this.gameState.gameOver || player !== this.gameState.currentPlayer || !Number.isInteger(position) || position < 0 || position > 3) return false;
        const card = this.players[player].hand[cardIndex];
        
        if (!card) return false;
        if (this.players[player].energy < card.cost) {
            this.log("コストが不足しています！");
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

        this.log(`プレイヤー${player}が${card.name}を召喚しました！`);

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

        // Calculate damage (no position modifiers)
        let damage = attacker.attack;

        if (targetPosition !== null) {
            const target = this.players[targetPlayer].battlefield[targetPosition];
            if (!target) {
                this.log("攻撃対象のモンスターがいません！");
                return false;
            }

            target.hp -= damage;
            this.log(`${attacker.name}が${target.name}に${damage}ダメージ！`);

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

                // Move back-row monsters to front if front positions are empty
                this.moveBackRowToFront(targetPlayer);
            }
        } else {
            this.players[targetPlayer].life = Math.max(0, this.players[targetPlayer].life - damage);
            this.log(`${attacker.name}がプレイヤー${targetPlayer}に${damage}ダメージ！`);
        }

        this.checkWinCondition();
        return true;
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

    // Calculate damage with position-based modifiers
    calculateDamageWithPositionModifier(attackerPosition, targetPosition, baseDamage, attackerPlayer, targetPlayer) {
        const attackerRow = this.getActualRow(attackerPosition, attackerPlayer);
        const targetRow = this.getActualRow(targetPosition, targetPlayer);

        let damage = baseDamage;

        if (attackerRow === ROW.FRONT && targetRow === ROW.BACK) {
            // Front row attacking back row: -1 damage
            damage -= 1;
        } else if (attackerRow === ROW.BACK && targetRow === ROW.FRONT) {
            // Back row attacking front row: -1 damage
            damage -= 1;
        } else if (attackerRow === ROW.BACK && targetRow === ROW.BACK) {
            // Back row attacking back row: -2 damage
            damage -= 2;
        }

        return Math.max(0, damage); // Minimum 0 damage
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
        playerData.maxEnergy = Math.min(4, playerData.turnsTaken + 1);
        playerData.energy = playerData.maxEnergy;
        playerData.battlefield.forEach(monster => { if (monster) monster.hasAttacked = false; });
        playerData.swappedColumns.clear();
        playerData.canAttackThisTurn = !isFirstTurnForPlayer;

        this.selectedCard = null;

        this.log(`プレイヤー${player}のターンです。`);
        if (skipDraw) {
            this.log("先攻プレイヤーの最初のターンはドローを行いません。");
        }
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
                this.log(`プレイヤー${winner}の勝利！`);
                this.selectedCard = null;
                this.updateUI();
                return;
            }
        }
    }

    updateUI() {
        for (let player = 1; player <= 2; player++) {
            const playerArea = document.getElementById(`player${player}-area`);
            playerArea.classList.toggle('active-turn', player === this.gameState.currentPlayer);

            const lifeElement = document.getElementById(`player${player}-life`);
            const energyElement = document.getElementById(`player${player}-energy`);
            this.updateStatWithAnimation(player, 'life', this.players[player].life, lifeElement);
            this.updateStatWithAnimation(player, 'energy', `${this.players[player].energy}/${this.players[player].maxEnergy}`, energyElement);

            this.renderHand(player);
            this.renderBattlefield(player);
        }

        document.getElementById('turn-status').textContent = this.gameState.gameOver
            ? '対戦終了'
            : `ターン${this.gameState.turnNumber} · ${this.isComputerTurn() ? 'AIの手番' : 'あなたの手番'}${!this.players[this.gameState.currentPlayer].canAttackThisTurn ? '（初回は攻撃不可）' : ''}`;
        if (!this.gameState.gameOver && !this.isComputerTurn() && this.players[1].energy === 0) {
            const remainingAttacks = [0, 1].filter(position => this.canMonsterAttack(1, position)).length;
            if (remainingAttacks > 0) document.getElementById('turn-status').textContent += ` · コスト0でも攻撃可能（${remainingAttacks}体）`;
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

    renderHand(player) {
        const handElement = document.getElementById(`player${player}-hand`);
        handElement.innerHTML = '';


        this.players[player].hand.forEach((card, index) => {
            const cardElement = document.createElement('div');
            cardElement.className = 'card';
            cardElement.title = `${card.name}：召喚コスト${card.cost}`;
            if (player === 1 && card.cost > this.players[player].energy) cardElement.classList.add('unaffordable');

            // 選択されたカードにselectedクラスを追加
            if (player === this.gameState.currentPlayer && this.selectedCard === index) {
                cardElement.classList.add('selected');
            }

            cardElement.innerHTML = `
                <div class="card-name">
                    <span class="card-name-text">${card.name}</span>
                    <span class="card-cost">${card.cost}</span>
                </div>
                <img class="card-image" src="${this.getCardImagePath(card.name)}" alt="${card.name}">
                <div class="card-stats">
                    <span class="stat-pill hp-stat"><img class="stat-icon" src="img/heart.svg" alt="体力"><span class="stat-value">${card.hp}</span></span>
                    <span class="stat-pill attack-stat"><img class="stat-icon" src="img/sword.svg" alt="攻撃"><span class="stat-value">${card.attack}</span></span>
                </div>
            `;

            if (player === this.gameState.currentPlayer && !this.isComputerPlayer(player)) {
                cardElement.addEventListener('click', () => this.selectCard(index));
                cardElement.style.cursor = 'pointer';
            }

            handElement.appendChild(cardElement);
        });
    }

    renderBattlefield(player) {
        const battlefieldElement = document.getElementById(`player${player}-battlefield`);
        const slots = battlefieldElement.querySelectorAll('.field-slot');
        
        slots.forEach((slot, position) => {
            slot.innerHTML = '';
            slot.onclick = null;
            slot.classList.remove('empty-slot');
            slot.style.cursor = '';
            slot.dataset.label = `${position < 2 ? '前列' : '後列'}${position % 2 === 0 ? '左' : '右'}`;
            const monster = this.players[player].battlefield[position];
            
            if (monster) {
                const monsterElement = document.createElement('div');
                monsterElement.className = 'monster';
                const status = this.gameState.gameOver ? '対戦終了'
                    : player !== this.gameState.currentPlayer ? '待機中'
                    : position < 2 ? (monster.hasAttacked ? '攻撃済み' : (!this.players[player].canAttackThisTurn ? '初回は攻撃不可'
                        : monster.summonedTurn === this.gameState.turnNumber
                            ? (this.canMonsterAttack(player, position) ? '攻撃可能（敵のみ）' : '召喚直後：直接不可') : '攻撃可能'))
                    : (this.players[player].swappedColumns.has(position % 2) ? '交代済み' : this.players[player].energy > 0 ? '交代コスト1' : 'コスト不足');
                if (monster.hasAttacked) monsterElement.classList.add('exhausted');
                monsterElement.title = `${monster.name}：${status}`;
                monsterElement.innerHTML = `
                    <span class="monster-label">${monster.name} · ${status}</span>
                    <img class="monster-image" src="${this.getCardImagePath(monster.name)}" alt="${monster.name}">
                    <div class="monster-stats">
                        <span class="stat-pill hp-stat"><img class="stat-icon" src="img/heart.svg" alt="体力"><span>${monster.hp}/${monster.maxHp}</span></span>
                        <span class="stat-pill attack-stat"><img class="stat-icon" src="img/sword.svg" alt="攻撃"><span>${monster.attack}</span></span>
                    </div>
                `;
                
                if (player === this.gameState.currentPlayer && !this.isComputerPlayer(player)) {
                    monsterElement.addEventListener('click', () => this.selectMonster(player, position));
                    monsterElement.style.cursor = 'pointer';
                }

                if (player === this.gameState.currentPlayer && !this.isComputerPlayer(player) && !this.gameState.gameOver) {
                    const controls = document.createElement('div');
                    controls.className = 'monster-actions';
                    const moveButton = document.createElement('button');
                    moveButton.textContent = `${position % 2 === 0 ? '右へ' : '左へ'} · 1`;
                    moveButton.setAttribute('aria-label', `${monster.name}を${position % 2 === 0 ? '右' : '左'}へ移動（コスト1）`);
                    moveButton.disabled = !this.canMoveSideways(player, position);
                    moveButton.addEventListener('click', event => {
                        event.stopPropagation();
                        if (this.moveSideways(player, position)) {
                            this.selectedCard = null;
                            this.updateUI();
                            this.checkAutoEndTurn();
                        }
                    });
                    controls.appendChild(moveButton);
                    monsterElement.appendChild(controls);
                }
                slot.appendChild(monsterElement);
            } else if (this.selectedCard !== null && player === this.gameState.currentPlayer && !this.isComputerPlayer(player)) {
                slot.onclick = () => this.placeMonster(position);
                slot.style.cursor = 'pointer';
                slot.classList.add('empty-slot');
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
            this.log(`選択を解除しました。`);
        } else {
            this.selectedCard = cardIndex;
            this.log(`${this.players[this.gameState.currentPlayer].hand[cardIndex].name}を選択しました。`);
        }

        this.selectedMonster = null;
        this.attackMode = false;
        this.updateUI();
    }

    selectMonster(player, position) {
        if (this.gameState.gameOver || player !== this.gameState.currentPlayer) return;
        if (this.isComputerPlayer(player)) return;

        const monster = this.players[player].battlefield[position];
        if (!monster) return;

        const actualRow = this.getActualRow(position, player);

        if (actualRow === ROW.FRONT) {
            // Front row monster: direct attack
            this.attackFrontMonster(player, position);
        } else {
            // Back row monster: swap with front row (only if shared cost > 0)
            if (this.players[player].energy <= 0) {
                this.log("コストが0のため、交代できません！");
                return;
            }
            this.swapBackToFront(player, position);
        }

        this.selectedCard = null;
        this.updateUI();

        // Check if shared cost are 0 and auto-end turn
        this.checkAutoEndTurn();
    }

    // Front row monster attacks directly ahead (front row only)
    attackFrontMonster(player, position) {
        if (!this.players[player].canAttackThisTurn) {
            this.log("このターンは攻撃できません！");
            return;
        }

        const opponent = player === 1 ? 2 : 1;
        const column = position % 2; // 0 for left, 1 for right

        // Only target front row monsters, not back row
        const frontTarget = this.players[opponent].battlefield[column]; // same column front

        if (frontTarget) {
            // Attack front row monster
            this.attackWithMonster(player, position, opponent, column);
        } else {
            // Attack player directly (back row monsters are protected)
            this.attackWithMonster(player, position, opponent, null);
        }
    }

    // 前後交代は共通コスト1。
    swapBackToFront(player, position) {
        if (this.gameState.gameOver || player !== this.gameState.currentPlayer || position < 2 || position > 3 || this.players[player].energy < 1) return false;
        const column = position % 2; // 0 for left, 1 for right
        if (this.players[player].swappedColumns.has(column)) return false;
        const frontPosition = column; // front position in same column
        const backPosition = position;

        const backMonster = this.players[player].battlefield[backPosition];
        const frontMonster = this.players[player].battlefield[frontPosition];

        if (!backMonster) return;

        this.players[player].energy -= 1;
        this.players[player].swappedColumns.add(column);
        // 攻撃済み・召喚直後の状態はそのまま維持する。
        this.players[player].battlefield[frontPosition] = backMonster;
        this.players[player].battlefield[backPosition] = frontMonster;

        if (frontMonster) {
            this.log(`${backMonster.name}と${frontMonster.name}が位置を交代しました（コスト1）！`);
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
        this.log(`${monster.name}が${position % 2 === 0 ? '右' : '左'}列へ移動しました（コスト1）。`);
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

    // コストを使い切っても、無料攻撃が残っている間は手番を維持する。
    checkAutoEndTurn() {
        if (this.gameState.gameOver || this.isComputerTurn()) return; // Don't auto-end computer turns
        if (this.autoEndTurnTimeout) {
            clearTimeout(this.autoEndTurnTimeout);
            this.autoEndTurnTimeout = null;
        }
        const currentPlayer = this.gameState.currentPlayer;
        if (this.players[currentPlayer].energy <= 0 && ![0, 1].some(position => this.canMonsterAttack(currentPlayer, position))) {
            this.log("コストが0で、攻撃も残っていないためターンを終了します。");
            this.autoEndTurnTimeout = setTimeout(() => {
                this.autoEndTurnTimeout = null;
                if (!this.gameState.gameOver && this.gameState.currentPlayer === currentPlayer &&
                    this.players[currentPlayer].energy <= 0 &&
                    ![0, 1].some(position => this.canMonsterAttack(currentPlayer, position))) {
                    this.endTurn();
                }
            }, 1000); // 1秒待ってからターン終了
        }
    }

    scheduleComputerTurn(delay = 600) {
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
        await this.delay(600);
        while (!this.gameState.gameOver && this.gameState.currentPlayer === player && this.performComputerAction(player)) {
            await this.delay(600);
        }

        if (!this.gameState.gameOver) {
            await this.delay(600);
            this.endTurn();
        }
    }

    performComputerAction(player) {
        if (this.gameState.gameOver || player !== this.gameState.currentPlayer) return false;
        const opponent = player === 1 ? 2 : 1;
        return this.computerAttack(player, opponent, true) || this.computerMove(player) || this.computerSwap(player) ||
            this.computerSummon(player) || this.computerAttack(player, opponent);
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

    computerAttack(player, opponent, prioritizeLethal = false) {
        const playerData = this.players[player];

        if (!playerData.canAttackThisTurn) return false;

        const attackers = playerData.battlefield
            .map((monster, index) => ({ monster, index }))
            .filter(item => {
                return this.canMonsterAttack(player, item.index);
            });

        if (attackers.length === 0) return false;

        const opponentData = this.players[opponent];
        const opponentMonsters = opponentData.battlefield
            .map((monster, index) => ({ monster, index }))
            .filter(item => item.monster !== null);

        const choices = [];

        attackers.forEach(attacker => {
            // Check for valid monster targets in the same column (front-facing)
            const attackerColumn = attacker.index % 2;
            const validTargets = opponentMonsters.filter(target =>
                this.isValidAttackTarget(attacker.index, target.index, player, opponent)
            );

            // Add monster attack choices
            validTargets.forEach(target => {
                const damage = attacker.monster.attack;
                choices.push({
                    attackerIndex: attacker.index,
                    attackerAttack: attacker.monster.attack,
                    targetPosition: target.index,
                    damage: damage,
                    lethal: false,
                    willKill: damage >= target.monster.hp,
                    targetHp: target.monster.hp,
                    targetAttack: target.monster.attack
                });
            });

            // Add direct player attack choice if no valid monster targets in front
            if (validTargets.length === 0 && attacker.monster.summonedTurn !== this.gameState.turnNumber) {
                const damage = attacker.monster.attack;
                choices.push({
                    attackerIndex: attacker.index,
                    attackerAttack: attacker.monster.attack,
                    targetPosition: null,
                    damage,
                    lethal: damage >= opponentData.life,
                    willKill: false,
                    targetHp: opponentData.life,
                    targetAttack: 0
                });
            }
        });

        if (choices.length === 0) return false;

        let candidateChoices = choices;
        if (prioritizeLethal) {
            const lethalChoices = choices.filter(choice => choice.lethal);
            if (lethalChoices.length === 0) {
                return false;
            }
            candidateChoices = lethalChoices;
        }

        candidateChoices.sort((a, b) => {
            if (a.lethal !== b.lethal) return b.lethal - a.lethal;
            if (a.willKill !== b.willKill) return b.willKill - a.willKill;
            if (a.targetAttack !== b.targetAttack) return b.targetAttack - a.targetAttack;
            if (a.damage !== b.damage) return b.damage - a.damage;
            if (a.targetHp !== b.targetHp) return a.targetHp - b.targetHp;
            return b.attackerAttack - a.attackerAttack;
        });

        const choice = candidateChoices[0];
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
        document.getElementById('restart-btn').addEventListener('click', () => window.location.reload());
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

    computerSwap(player) {
        const playerData = this.players[player];
        if (playerData.energy < 1) return false;

        // Find back row monsters that could benefit from moving to front
        const backRowPositions = [POSITION.BACK_LEFT, POSITION.BACK_RIGHT];

        for (let backPos of backRowPositions) {
            const backMonster = playerData.battlefield[backPos];
            if (!backMonster || backMonster.hasAttacked || playerData.swappedColumns.has(backPos % 2)) continue;

            const frontPos = backPos - 2; // Convert back position to front position
            const frontMonster = playerData.battlefield[frontPos];

            // Only swap if front position is empty or front monster is weaker
            if (!frontMonster || frontMonster.hasAttacked || frontMonster.attack < backMonster.attack) {
                return this.swapBackToFront(player, backPos);
            }
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
