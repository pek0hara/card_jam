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

class CardGame {
    constructor() {
        const firstPlayer = Math.random() < 0.5 ? 1 : 2;
        console.log(`先攻プレイヤーを決定: プレイヤー${firstPlayer}`);

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
                gems: 0,
                actionPoints: 0,
                hand: [],
                deck: [],
                battlefield: [null, null, null, null],
                firstTurnCompleted: false,
                canAttackThisTurn: false
            },
            2: {
                life: 20,
                gems: 0,
                actionPoints: 0,
                hand: [],
                deck: [],
                battlefield: [null, null, null, null],
                firstTurnCompleted: false,
                canAttackThisTurn: false
            }
        };
        
        this.computerPlayers = new Set([2]);

        this.selectedCard = null;

        this.computerTurnTimeout = null;
        this.autoEndTurnTimeout = null;

        this.initializeGame();
        this.setupEventListeners();
    }

    initializeGame() {
        this.createDecks();
        this.drawInitialHands();
        this.log("カードジャム v1.2 - ゲーム開始！");
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
            for (let i = 0; i < 15; i++) {
                const template = cardTemplates[Math.floor(Math.random() * cardTemplates.length)];
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
        }
    }

    drawCard(player) {
        if (this.players[player].deck.length === 0) {
            this.log(`プレイヤー${player}は山札が切れています！ドローできません。`);
            return;
        }

        // 手札が4枚の場合、一番左のカードを捨ててからドロー
        if (this.players[player].hand.length >= 4) {
            const discardedCard = this.players[player].hand.shift();
            this.log(`プレイヤー${player}は${discardedCard.name}を捨てました。`);
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
        const card = this.players[player].hand[cardIndex];
        
        if (!card) return false;
        if (this.players[player].gems < card.cost) {
            this.log("ジェムが不足しています！");
            return false;
        }
        if (this.players[player].actionPoints < 1) {
            this.log("行動力が不足しています！");
            return false;
        }
        if (this.players[player].battlefield[position] !== null) {
            this.log("そのマスにはすでにモンスターがいます！");
            return false;
        }

        this.players[player].gems -= card.cost;
        this.players[player].actionPoints -= 1;
        this.players[player].battlefield[position] = card;
        this.players[player].hand.splice(cardIndex, 1);

        this.log(`プレイヤー${player}が${card.name}を召喚しました！`);

        // Move back-row monsters to front if front positions are empty (no log)
        this.moveBackRowToFront(player, false);

        // Debug: Show final position
        console.log(`Summoned ${card.name} at position ${position} for player ${player}`);
        const actualRow = this.getActualRow(position, player);
        const rowLabel = actualRow === ROW.FRONT ? 'FRONT' : 'BACK';
        console.log(`Position ${position} is ${rowLabel} row`);

        return true;
    }

    attackWithMonster(attackerPlayer, attackerPosition, targetPlayer, targetPosition = null) {
        const attacker = this.players[attackerPlayer].battlefield[attackerPosition];

        if (!attacker) {
            this.log("攻撃するモンスターがいません！");
            return false;
        }

        if (!this.players[attackerPlayer].canAttackThisTurn) {
            this.log("このターンは攻撃できません！");
            return false;
        }

        if (this.players[attackerPlayer].actionPoints < 1) {
            this.log("行動力が不足しています！");
            return false;
        }

        // Check if the attack is valid (front-facing only)
        if (targetPosition !== null && !this.isValidAttackTarget(attackerPosition, targetPosition, attackerPlayer, targetPlayer)) {
            this.log("その位置には攻撃できません！正面の前列モンスターのみ攻撃可能です。");
            return false;
        }

        this.players[attackerPlayer].actionPoints -= 1;

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
            console.log(`Attack: Player${attackerPlayer} pos ${attackerPosition} (actual row ${attackerRow}) -> Player${targetPlayer} pos ${targetPosition} (actual row ${targetRow}), target HP: ${target.hp}`);

            if (attackerRow === ROW.FRONT && targetRow === ROW.FRONT && target.hp > 0) {
                // Front-to-front attack: target counter-attacks with its ATK
                const counterDamage = target.attack;
                attacker.hp -= counterDamage;
                this.log(`${target.name}が反撃！${attacker.name}に${counterDamage}ダメージ！`);
                console.log(`Counter-attack: ${target.name} deals ${counterDamage} to ${attacker.name}`);

                if (attacker.hp <= 0) {
                    this.players[attackerPlayer].battlefield[attackerPosition] = null;
                    this.log(`${attacker.name}は破壊されました！`);
                    this.players[attackerPlayer].gems += 1;
                    this.log(`プレイヤー${attackerPlayer}はジェムを1獲得しました。`);

                    // Move back-row monsters to front if front positions are empty
                    this.moveBackRowToFront(attackerPlayer);
                }
            }

            if (target.hp <= 0) {
                this.players[targetPlayer].battlefield[targetPosition] = null;
                this.log(`${target.name}は破壊されました！`);
                this.players[targetPlayer].gems += 1;
                this.log(`プレイヤー${targetPlayer}はジェムを1獲得しました。`);

                // Move back-row monsters to front if front positions are empty
                this.moveBackRowToFront(targetPlayer);
            }
        } else {
            this.players[targetPlayer].life -= damage;
            this.players[targetPlayer].gems += 1;
            this.log(`${attacker.name}がプレイヤー${targetPlayer}に${damage}ダメージ！ジェムを1獲得。`);
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

        // First turn: 2 gems, subsequent turns: 1 gem
        if (isFirstTurnForPlayer) {
            playerData.gems += 2;
        } else {
            playerData.gems += 1;
        }
        playerData.actionPoints = 2;
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
                alert(`プレイヤー${winner}の勝利！`);
                return;
            }
        }
    }

    updateUI() {
        for (let player = 1; player <= 2; player++) {
            document.getElementById(`player${player}-life`).textContent = this.players[player].life;
            document.getElementById(`player${player}-gems`).textContent = this.players[player].gems;

            // Display action points as circles
            const actionPoints = this.players[player].actionPoints;
            let actionDisplay = '';
            if (actionPoints === 2) {
                actionDisplay = '⚫︎⚫︎';
            } else if (actionPoints === 1) {
                actionDisplay = '⚫︎⚪︎';
            } else {
                actionDisplay = '⚪︎⚪︎';
            }
            document.getElementById(`player${player}-action`).textContent = actionDisplay;
            
            this.renderHand(player);
            this.renderBattlefield(player);
        }

        const endTurnBtn = document.getElementById('end-turn-btn');
        if (this.isComputerTurn()) {
            endTurnBtn.disabled = true;
            endTurnBtn.textContent = 'AI思考中...';
        } else {
            endTurnBtn.disabled = false;
            endTurnBtn.textContent = 'ターン終了';
        }
    }

    renderHand(player) {
        const handElement = document.getElementById(`player${player}-hand`);
        handElement.innerHTML = '';

        console.log(`renderHand for player ${player}, selectedCard: ${this.selectedCard}, currentPlayer: ${this.gameState.currentPlayer}`);

        this.players[player].hand.forEach((card, index) => {
            const cardElement = document.createElement('div');
            cardElement.className = 'card';

            // 選択されたカードにselectedクラスを追加
            if (player === this.gameState.currentPlayer && this.selectedCard === index) {
                cardElement.classList.add('selected');
            }

            cardElement.innerHTML = `
                <div class="card-name">
                    <span class="card-name-text">${card.name}</span>
                    <span class="card-cost">[${card.cost}]</span>
                </div>
                <div class="card-stats">
                    <span>HP:${card.hp}</span>
                    <span>ATK:${card.attack}</span>
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
            const monster = this.players[player].battlefield[position];
            
            if (monster) {
                const monsterElement = document.createElement('div');
                monsterElement.className = 'monster';
                monsterElement.innerHTML = `
                    <div class="monster-name">${monster.name}</div>
                    <div class="monster-stats">
                        <span>HP: ${monster.hp}/${monster.maxHp}</span>
                        <span>ATK: ${monster.attack}</span>
                    </div>
                `;
                
                if (player === this.gameState.currentPlayer && !this.isComputerPlayer(player)) {
                    monsterElement.addEventListener('click', () => this.selectMonster(player, position));
                    monsterElement.style.cursor = 'pointer';
                }

                slot.appendChild(monsterElement);
            } else if (this.selectedCard !== null && player === this.gameState.currentPlayer && !this.isComputerPlayer(player)) {
                slot.addEventListener('click', () => this.placeMonster(position));
                slot.style.cursor = 'pointer';
                slot.classList.add('empty-slot');
            }
        });
    }

    selectCard(cardIndex) {
        if (this.isComputerTurn()) return;

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
        if (player !== this.gameState.currentPlayer) return;
        if (this.isComputerPlayer(player)) return;

        const monster = this.players[player].battlefield[position];
        if (!monster) return;

        const actualRow = this.getActualRow(position, player);

        if (actualRow === ROW.FRONT) {
            // Front row monster: direct attack
            this.attackFrontMonster(player, position);
        } else {
            // Back row monster: swap with front row (only if action points > 0)
            if (this.players[player].actionPoints <= 0) {
                this.log("行動力が0のため、入れ替えできません！");
                return;
            }
            this.swapBackToFront(player, position);
        }

        this.selectedCard = null;
        this.updateUI();

        // Check if action points are 0 and auto-end turn
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

    // Swap back row monster with front row (no action cost)
    swapBackToFront(player, position) {
        const column = position % 2; // 0 for left, 1 for right
        const frontPosition = column; // front position in same column
        const backPosition = position;

        const backMonster = this.players[player].battlefield[backPosition];
        const frontMonster = this.players[player].battlefield[frontPosition];

        if (!backMonster) return;

        // Swap positions (no action cost)
        this.players[player].battlefield[frontPosition] = backMonster;
        this.players[player].battlefield[backPosition] = frontMonster;

        if (frontMonster) {
            this.log(`${backMonster.name}と${frontMonster.name}が位置を交代しました！`);
        } else {
            this.log(`${backMonster.name}が前列に移動しました！`);
        }
    }

    placeMonster(position) {
        if (this.selectedCard === null) return;
        if (this.isComputerTurn()) return;

        if (this.summonMonster(this.gameState.currentPlayer, this.selectedCard, position)) {
            this.selectedCard = null;
            this.updateUI();

            // Check if action points are 0 and auto-end turn
            this.checkAutoEndTurn();
        }
    }

    // Check if action points are 0 and automatically end turn
    checkAutoEndTurn() {
        if (this.isComputerTurn()) return; // Don't auto-end computer turns
        if (this.gameState.gameOver) return;

        const currentPlayer = this.gameState.currentPlayer;
        if (this.players[currentPlayer].actionPoints <= 0) {
            this.log("行動力が0になりました。自動的にターンを終了します。");

            // Clear any existing auto-end timeout
            if (this.autoEndTurnTimeout) {
                clearTimeout(this.autoEndTurnTimeout);
            }

            this.autoEndTurnTimeout = setTimeout(() => {
                this.autoEndTurnTimeout = null;
                if (!this.gameState.gameOver && this.gameState.currentPlayer === currentPlayer) {
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
        const opponent = player === 1 ? 2 : 1;

        await this.delay(600);

        let performedAction = true;
        while (!this.gameState.gameOver && this.players[player].actionPoints > 0 && performedAction) {
            performedAction = false;

            if (this.computerAttack(player, opponent, true)) {
                performedAction = true;
                await this.delay(600);
                continue;
            }

            const hasAttackers = this.players[player].battlefield.some(monster => monster !== null);
            const canSpareActionPointForSummon = this.players[player].actionPoints > 1 || !hasAttackers;

            if (canSpareActionPointForSummon && this.computerSummon(player)) {
                performedAction = true;
                await this.delay(600);
                continue;
            }

            // Try swapping back row monsters to front for better positioning
            if (this.computerSwap(player)) {
                performedAction = true;
                await this.delay(600);
                continue;
            }

            if (this.computerAttack(player, opponent)) {
                performedAction = true;
                await this.delay(600);
            }
        }

        if (!this.gameState.gameOver) {
            await this.delay(600);
            this.endTurn();
        }
    }

    computerSummon(player) {
        const playerData = this.players[player];

        if (playerData.actionPoints < 1) return false;

        const openPositions = [];
        playerData.battlefield.forEach((monster, index) => {
            if (monster === null) {
                openPositions.push(index);
            }
        });

        if (openPositions.length === 0) return false;

        const selectableCards = playerData.hand
            .map((card, index) => ({ card, index }))
            .filter(item => item.card.cost <= playerData.gems);

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
        const position = openPositions[Math.floor(Math.random() * openPositions.length)];

        const success = this.summonMonster(player, targetCard.index, position);
        if (success) {
            this.updateUI();
        }
        return success;
    }

    computerAttack(player, opponent, prioritizeLethal = false) {
        const playerData = this.players[player];

        if (!playerData.canAttackThisTurn) return false;

        if (playerData.actionPoints < 1) return false;

        const attackers = playerData.battlefield
            .map((monster, index) => ({ monster, index }))
            .filter(item => {
                if (!item.monster) return false;
                // Only front row monsters can attack
                const actualRow = this.getActualRow(item.index, player);
                return actualRow === ROW.FRONT;
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
            if (validTargets.length === 0) {
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
        document.getElementById('end-turn-btn').addEventListener('click', () => {
            if (this.isComputerTurn()) return;
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

        // Find back row monsters that could benefit from moving to front
        const backRowPositions = [POSITION.BACK_LEFT, POSITION.BACK_RIGHT];

        for (let backPos of backRowPositions) {
            const backMonster = playerData.battlefield[backPos];
            if (!backMonster) continue;

            const frontPos = backPos - 2; // Convert back position to front position
            const frontMonster = playerData.battlefield[frontPos];

            // Only swap if front position is empty or front monster is weaker
            if (!frontMonster || frontMonster.attack < backMonster.attack) {
                this.swapBackToFront(player, backPos);
                return true;
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
