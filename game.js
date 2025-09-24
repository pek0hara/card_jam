class CardGame {
    constructor() {
        this.gameState = {
            currentPlayer: 1,
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
        this.selectedMonster = null;
        this.attackMode = false;

        this.computerTurnTimeout = null;
        
        this.initializeGame();
        this.setupEventListeners();
    }

    initializeGame() {
        this.createDecks();
        this.drawInitialHands();
        this.log("カードジャム v1.2 - ゲーム開始！");
        this.startTurn(this.gameState.currentPlayer, { skipDraw: true });
    }

    createDecks() {
        const cardTemplates = [
            { name: "ゴブリン", hp: 2, attack: 1, cost: 1 },
            { name: "オーク", hp: 3, attack: 2, cost: 2 },
            { name: "トロール", hp: 5, attack: 3, cost: 4 },
            { name: "ドラゴン", hp: 8, attack: 6, cost: 7 },
            { name: "スライム", hp: 1, attack: 1, cost: 1 },
            { name: "スケルトン", hp: 2, attack: 2, cost: 2 },
            { name: "ナイト", hp: 4, attack: 3, cost: 3 },
            { name: "ウィザード", hp: 2, attack: 4, cost: 3 }
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
            this.players[player].life -= 10;
            this.log(`プレイヤー${player}は山札切れで10ダメージを受けました！`);
            this.checkWinCondition();
            return;
        }

        const card = this.players[player].deck.pop();
        this.players[player].hand.push(card);

        if (this.players[player].hand.length > 4) {
            this.discardExcessCards(player);
        }
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

        this.players[attackerPlayer].actionPoints -= 1;

        if (targetPosition !== null) {
            const target = this.players[targetPlayer].battlefield[targetPosition];
            if (!target) {
                this.log("攻撃対象のモンスターがいません！");
                return false;
            }
            
            target.hp -= attacker.attack;
            this.log(`${attacker.name}が${target.name}に${attacker.attack}ダメージ！`);
            
            if (target.hp <= 0) {
                this.players[targetPlayer].battlefield[targetPosition] = null;
                this.log(`${target.name}は破壊されました！`);
                this.players[targetPlayer].gems += 1;
                this.log(`プレイヤー${targetPlayer}はジェムを1獲得しました。`);
            }
        } else {
            this.players[targetPlayer].life -= attacker.attack;
            this.log(`${attacker.name}がプレイヤー${targetPlayer}に${attacker.attack}ダメージ！`);
        }
        
        this.checkWinCondition();
        return true;
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

        playerData.gems += 2;
        playerData.actionPoints = 2;
        playerData.canAttackThisTurn = !isFirstTurnForPlayer;

        this.selectedCard = null;
        this.selectedMonster = null;
        this.attackMode = false;

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
            document.getElementById(`player${player}-action`).textContent = this.players[player].actionPoints;
            
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
                } else if (this.attackMode) {
                    monsterElement.addEventListener('click', () => this.executeAttack(this.gameState.currentPlayer, player, position));
                    monsterElement.style.cursor = 'crosshair';
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
        
        this.selectedMonster = position;
        this.selectedCard = null;
        this.attackMode = true;
        this.updateUI();
        this.log("攻撃対象を選択してください。");
    }

    placeMonster(position) {
        if (this.selectedCard === null) return;
        if (this.isComputerTurn()) return;

        if (this.summonMonster(this.gameState.currentPlayer, this.selectedCard, position)) {
            this.selectedCard = null;
            this.updateUI();
        }
    }

    executeAttack(attackerPlayer, targetPlayer, targetPosition) {
        if (this.selectedMonster === null) return;
        
        const opponentHasMonsters = this.players[targetPlayer].battlefield.some(monster => monster !== null);
        
        if (opponentHasMonsters) {
            this.attackWithMonster(attackerPlayer, this.selectedMonster, targetPlayer, targetPosition);
        } else {
            this.attackWithMonster(attackerPlayer, this.selectedMonster, targetPlayer, null);
        }
        
        this.selectedMonster = null;
        this.attackMode = false;
        this.updateUI();
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
            .filter(item => item.monster !== null);

        if (attackers.length === 0) return false;

        const opponentData = this.players[opponent];
        const opponentMonsters = opponentData.battlefield
            .map((monster, index) => ({ monster, index }))
            .filter(item => item.monster !== null);

        const choices = [];

        attackers.forEach(attacker => {
            if (opponentMonsters.length > 0) {
                opponentMonsters.forEach(target => {
                    choices.push({
                        attackerIndex: attacker.index,
                        attackerAttack: attacker.monster.attack,
                        targetPosition: target.index,
                        damage: attacker.monster.attack,
                        lethal: false,
                        willKill: attacker.monster.attack >= target.monster.hp,
                        targetHp: target.monster.hp,
                        targetAttack: target.monster.attack
                    });
                });
            } else {
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
        
        document.getElementById('player1-area').addEventListener('click', (e) => {
            if (this.attackMode && this.gameState.currentPlayer === 1) {
                const targetPlayer = 2;
                const hasMonsters = this.players[targetPlayer].battlefield.some(monster => monster !== null);
                if (!hasMonsters) {
                    this.executeAttack(1, targetPlayer, null);
                }
            }
        });
        
        document.getElementById('player2-area').addEventListener('click', (e) => {
            if (this.attackMode && this.gameState.currentPlayer === 2) {
                const targetPlayer = 1;
                const hasMonsters = this.players[targetPlayer].battlefield.some(monster => monster !== null);
                if (!hasMonsters) {
                    this.executeAttack(2, targetPlayer, null);
                }
            }
        });
    }

    log(message) {
        const logContent = document.getElementById('log-content');
        const logEntry = document.createElement('div');
        logEntry.textContent = message;
        logContent.appendChild(logEntry);
        logContent.scrollTop = logContent.scrollHeight;
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
