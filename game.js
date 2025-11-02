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

        // Initialize audio context
        this.audioContext = null;
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.warn('Web Audio API not supported');
        }

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
                canAttackThisTurn: false,
                stats: {
                    damageDealt: 0,
                    damageTaken: 0,
                    monstersSummoned: 0,
                    monstersDestroyed: 0,
                    gemsSpent: 0
                }
            },
            2: {
                life: 20,
                gems: 0,
                actionPoints: 0,
                hand: [],
                deck: [],
                battlefield: [null, null, null, null],
                firstTurnCompleted: false,
                canAttackThisTurn: false,
                stats: {
                    damageDealt: 0,
                    damageTaken: 0,
                    monstersSummoned: 0,
                    monstersDestroyed: 0,
                    gemsSpent: 0
                }
            }
        };
        
        this.computerPlayers = new Set([2]);
        this.aiDifficulty = 'normal'; // easy, normal, hard

        this.selectedCard = null;

        this.computerTurnTimeout = null;
        this.autoEndTurnTimeout = null;

        this.abilityPopup = null;
        this.abilityPopupText = null;
        this.abilityPopupClose = null;
        this.lastAbilityTrigger = null;
        this.handleAbilityKeydown = this.handleAbilityKeydown.bind(this);

        this.initializeGame();
        this.setupEventListeners();
        this.setupAbilityPopup();
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
            { name: "ゴブリン", hp: 1, attack: 2, cost: 1, ability: "greed", abilityText: "召喚時:ジェム+1" },
            { name: "スライム", hp: 5, attack: 1, cost: 2, ability: "poison", abilityText: "破壊時:攻撃者に1ダメージ" },
            { name: "オーク", hp: 3, attack: 2, cost: 2, ability: "berserk", abilityText: "攻撃時:+1ダメージ/自身に1ダメージ" },
            { name: "スケルトン", hp: 1, attack: 3, cost: 2, ability: "curse", abilityText: "破壊時:相手に1ダメージ" },
            { name: "トロール", hp: 5, attack: 2, cost: 3, ability: "regenerate", abilityText: "ターン開始時:HP+1回復" },
            { name: "ナイト", hp: 3, attack: 3, cost: 3, ability: "guard", abilityText: "前列時:直接攻撃-1軽減" },
            { name: "ウィザード", hp: 2, attack: 4, cost: 3, ability: "magic", abilityText: "召喚時:相手前列に1ダメージ" },
            { name: "ドラゴン", hp: 4, attack: 4, cost: 4, ability: "mighty", abilityText: "直接攻撃時:+1ダメージ" }
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
        this.players[player].stats.gemsSpent += card.cost;
        this.players[player].stats.monstersSummoned += 1;
        this.players[player].actionPoints -= 1;
        this.players[player].battlefield[position] = card;
        this.players[player].hand.splice(cardIndex, 1);

        this.log(`プレイヤー${player}が${card.name}を召喚しました！`);
        this.playSound('summon');

        // Trigger summon abilities
        this.triggerAbility(card, 'summon', player);

        // Move back-row monsters to front if front positions are empty (no log)
        this.moveBackRowToFront(player, false);

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

        // Trigger attack abilities (like Berserk)
        if (attacker.ability === 'berserk') {
            damage += 1;
            attacker.hp -= 1;
            this.log(`${attacker.name}の狂戦士！攻撃力+1、自身に1ダメージ！`);
            if (attacker.hp <= 0) {
                this.players[attackerPlayer].battlefield[attackerPosition] = null;
                this.log(`${attacker.name}は破壊されました！`);
                this.players[attackerPlayer].gems += 1;
                this.moveBackRowToFront(attackerPlayer);
            }
        }

        if (targetPosition !== null) {
            const target = this.players[targetPlayer].battlefield[targetPosition];
            if (!target) {
                this.log("攻撃対象のモンスターがいません！");
                return false;
            }

            this.playSound('attack');
            target.hp -= damage;
            this.players[attackerPlayer].stats.damageDealt += damage;
            this.players[targetPlayer].stats.damageTaken += damage;
            this.log(`${attacker.name}が${target.name}に${damage}ダメージ！`);
            this.playSound('damage');

            // Check for counter-attack: front row attacking front row
            const attackerRow = this.getActualRow(attackerPosition, attackerPlayer);
            const targetRow = this.getActualRow(targetPosition, targetPlayer);

            if (attackerRow === ROW.FRONT && targetRow === ROW.FRONT && target.hp > 0) {
                // Front-to-front attack: target counter-attacks with its ATK
                const counterDamage = target.attack;
                attacker.hp -= counterDamage;
                this.players[targetPlayer].stats.damageDealt += counterDamage;
                this.players[attackerPlayer].stats.damageTaken += counterDamage;
                this.log(`${target.name}が反撃！${attacker.name}に${counterDamage}ダメージ！`);

                if (attacker.hp <= 0) {
                    this.players[attackerPlayer].battlefield[attackerPosition] = null;
                    this.players[targetPlayer].stats.monstersDestroyed += 1;
                    this.log(`${attacker.name}は破壊されました！`);
                    this.players[attackerPlayer].gems += 1;
                    this.log(`プレイヤー${attackerPlayer}はジェムを1獲得しました。`);

                    // Move back-row monsters to front if front positions are empty
                    this.moveBackRowToFront(attackerPlayer);
                }
            }

            if (target.hp <= 0) {
                // Trigger death abilities before removing
                if (target.ability === 'poison' && attacker && attacker.hp > 0) {
                    attacker.hp -= 1;
                    this.players[targetPlayer].stats.damageDealt += 1;
                    this.players[attackerPlayer].stats.damageTaken += 1;
                    this.log(`${target.name}の毒！${attacker.name}に1ダメージ！`);
                    if (attacker.hp <= 0) {
                        this.players[attackerPlayer].battlefield[attackerPosition] = null;
                        this.players[targetPlayer].stats.monstersDestroyed += 1;
                        this.log(`${attacker.name}は破壊されました！`);
                        this.players[attackerPlayer].gems += 1;
                        this.moveBackRowToFront(attackerPlayer);
                    }
                }
                if (target.ability === 'curse') {
                    this.players[attackerPlayer].life -= 1;
                    this.players[targetPlayer].stats.damageDealt += 1;
                    this.players[attackerPlayer].stats.damageTaken += 1;
                    this.log(`${target.name}の呪い！プレイヤー${attackerPlayer}に1ダメージ！`);
                }

                this.players[targetPlayer].battlefield[targetPosition] = null;
                this.players[attackerPlayer].stats.monstersDestroyed += 1;
                this.log(`${target.name}は破壊されました！`);
                this.players[targetPlayer].gems += 1;
                this.log(`プレイヤー${targetPlayer}はジェムを1獲得しました。`);

                // Move back-row monsters to front if front positions are empty
                this.moveBackRowToFront(targetPlayer);
            }
        } else {
            // Direct attack to player
            // Check for Dragon's mighty ability
            if (attacker.ability === 'mighty') {
                damage += 1;
                this.log(`${attacker.name}の強力な一撃！ダメージ+1！`);
            }

            // Check for Knight's guard ability (reduce damage to player)
            const guardReduction = this.calculateGuardReduction(targetPlayer);
            if (guardReduction > 0) {
                damage = Math.max(0, damage - guardReduction);
                this.log(`ナイトの守護！ダメージを${guardReduction}軽減！`);
            }

            this.playSound('attack');
            this.players[targetPlayer].life -= damage;
            this.players[attackerPlayer].stats.damageDealt += damage;
            this.players[targetPlayer].stats.damageTaken += damage;
            this.players[targetPlayer].gems += 1;
            this.log(`${attacker.name}がプレイヤー${targetPlayer}に${damage}ダメージ！ジェムを1獲得。`);
            this.playSound('damage');
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

        // Trigger turn start abilities (like Troll's regenerate)
        this.triggerTurnStartAbilities(player);

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

        this.playSound('turnEnd');
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
                this.playSound('victory');
                this.showGameStats(winner);
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

        this.registerAbilityTriggers();

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

            if (card.abilityText) {
                const abilityButton = document.createElement('button');
                abilityButton.type = 'button';
                abilityButton.className = 'card-ability ability-trigger';
                abilityButton.textContent = '⭐';
                abilityButton.title = card.abilityText;
                abilityButton.dataset.abilityText = card.abilityText;
                abilityButton.setAttribute('aria-label', `${card.name}の特殊能力を表示`);
                cardElement.appendChild(abilityButton);
            }

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
                    <div class="monster-name">${monster.name}${monster.abilityText ? ' ⭐' : ''}</div>
                    <div class="monster-stats">
                        <span>HP: ${monster.hp}/${monster.maxHp}</span>
                        <span>ATK: ${monster.attack}</span>
                    </div>
                `;

                if (monster.abilityText) {
                    const abilityButton = document.createElement('button');
                    abilityButton.type = 'button';
                    abilityButton.className = 'monster-ability ability-trigger';
                    abilityButton.textContent = monster.abilityText.split(':')[0];
                    abilityButton.title = monster.abilityText;
                    abilityButton.dataset.abilityText = monster.abilityText;
                    abilityButton.setAttribute('aria-label', `${monster.name}の特殊能力を表示`);
                    monsterElement.appendChild(abilityButton);
                }

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

        let targetCard;

        if (this.aiDifficulty === 'easy') {
            // Easy: Random selection
            targetCard = selectableCards[Math.floor(Math.random() * selectableCards.length)];
        } else if (this.aiDifficulty === 'hard') {
            // Hard: Advanced scoring with ability consideration
            selectableCards.sort((a, b) => {
                let scoreA = this.evaluateCardScore(a.card);
                let scoreB = this.evaluateCardScore(b.card);

                // Bonus for abilities
                if (a.card.ability) scoreA += 2;
                if (b.card.ability) scoreB += 2;

                const scoreDiff = scoreB - scoreA;
                if (scoreDiff !== 0) return scoreDiff;
                if (b.card.attack !== a.card.attack) {
                    return b.card.attack - a.card.attack;
                }
                return b.card.hp - a.card.hp;
            });
            targetCard = selectableCards[0];
        } else {
            // Normal: Standard scoring
            selectableCards.sort((a, b) => {
                const scoreDiff = this.evaluateCardScore(b.card) - this.evaluateCardScore(a.card);
                if (scoreDiff !== 0) return scoreDiff;
                if (b.card.attack !== a.card.attack) {
                    return b.card.attack - a.card.attack;
                }
                return b.card.hp - a.card.hp;
            });
            targetCard = selectableCards[0];
        }

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

        // Easy difficulty: Random attack
        if (this.aiDifficulty === 'easy' && !prioritizeLethal) {
            const attacker = attackers[Math.floor(Math.random() * attackers.length)];
            const opponentData = this.players[opponent];
            const attackerColumn = attacker.index % 2;
            const validTargets = opponentData.battlefield
                .map((monster, index) => ({ monster, index }))
                .filter(item => item.monster !== null && this.isValidAttackTarget(attacker.index, item.index, player, opponent));

            if (validTargets.length > 0) {
                const target = validTargets[Math.floor(Math.random() * validTargets.length)];
                const success = this.attackWithMonster(player, attacker.index, opponent, target.index);
                if (success) this.updateUI();
                return success;
            } else {
                const success = this.attackWithMonster(player, attacker.index, opponent, null);
                if (success) this.updateUI();
                return success;
            }
        }

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

        // Hard difficulty: More aggressive targeting
        if (this.aiDifficulty === 'hard') {
            candidateChoices.sort((a, b) => {
                if (a.lethal !== b.lethal) return b.lethal - a.lethal;
                if (a.willKill !== b.willKill) return b.willKill - a.willKill;
                // Prioritize high attack targets more
                if (a.targetAttack !== b.targetAttack) return (b.targetAttack * 1.5) - (a.targetAttack * 1.5);
                if (a.damage !== b.damage) return b.damage - a.damage;
                if (a.targetHp !== b.targetHp) return a.targetHp - b.targetHp;
                return b.attackerAttack - a.attackerAttack;
            });
        } else {
            candidateChoices.sort((a, b) => {
                if (a.lethal !== b.lethal) return b.lethal - a.lethal;
                if (a.willKill !== b.willKill) return b.willKill - a.willKill;
                if (a.targetAttack !== b.targetAttack) return b.targetAttack - a.targetAttack;
                if (a.damage !== b.damage) return b.damage - a.damage;
                if (a.targetHp !== b.targetHp) return a.targetHp - b.targetHp;
                return b.attackerAttack - a.attackerAttack;
            });
        }

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

        // Difficulty selection
        document.querySelectorAll('.difficulty-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.difficulty-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.aiDifficulty = e.target.dataset.difficulty;
                this.log(`AI難易度を「${e.target.textContent}」に変更しました。`);
            });
        });
    }

    setupAbilityPopup() {
        this.abilityPopup = document.getElementById('ability-popup');
        this.abilityPopupText = document.getElementById('ability-popup-text');
        this.abilityPopupClose = document.getElementById('ability-popup-close');

        if (!this.abilityPopup || !this.abilityPopupText) {
            return;
        }

        if (this.abilityPopupClose) {
            this.abilityPopupClose.addEventListener('click', () => this.hideAbilityPopup());
        }

        this.abilityPopup.addEventListener('click', (event) => {
            if (event.target === this.abilityPopup) {
                this.hideAbilityPopup();
            }
        });

        document.addEventListener('keydown', this.handleAbilityKeydown);
    }

    registerAbilityTriggers() {
        const triggers = document.querySelectorAll('.ability-trigger');
        triggers.forEach(trigger => {
            if (trigger.dataset.abilityListenerAttached === 'true') {
                return;
            }

            trigger.dataset.abilityListenerAttached = 'true';

            trigger.addEventListener('click', (event) => {
                event.stopPropagation();
                event.preventDefault();
                const abilityText = trigger.dataset.abilityText || trigger.title;
                if (abilityText) {
                    this.showAbilityPopup(abilityText, trigger);
                }
            });
        });
    }

    showAbilityPopup(text, trigger = null) {
        if (!this.abilityPopup || !this.abilityPopupText) {
            return;
        }

        this.lastAbilityTrigger = trigger;
        this.abilityPopupText.textContent = text;
        this.abilityPopup.classList.add('active');
        this.abilityPopup.setAttribute('aria-hidden', 'false');
        document.body.classList.add('ability-popup-open');

        if (this.abilityPopupClose) {
            this.abilityPopupClose.focus();
        }
    }

    hideAbilityPopup() {
        if (!this.abilityPopup) {
            return;
        }

        this.abilityPopup.classList.remove('active');
        this.abilityPopup.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('ability-popup-open');

        if (this.lastAbilityTrigger && typeof this.lastAbilityTrigger.focus === 'function') {
            this.lastAbilityTrigger.focus();
        }
        this.lastAbilityTrigger = null;
    }

    handleAbilityKeydown(event) {
        if (event.key === 'Escape' && this.abilityPopup && this.abilityPopup.classList.contains('active')) {
            this.hideAbilityPopup();
        }
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

    // Trigger abilities based on timing
    triggerAbility(card, timing, player) {
        const opponent = player === 1 ? 2 : 1;

        switch(timing) {
            case 'summon':
                if (card.ability === 'greed') {
                    // Goblin: Gain 1 gem on summon
                    this.players[player].gems += 1;
                    this.log(`${card.name}の強欲！ジェムを1獲得！`);
                } else if (card.ability === 'magic') {
                    // Wizard: Deal 1 damage to enemy front row monster on summon
                    const frontMonsters = [0, 1].map(pos => this.players[opponent].battlefield[pos]).filter(m => m !== null);
                    if (frontMonsters.length > 0) {
                        const target = frontMonsters[Math.floor(Math.random() * frontMonsters.length)];
                        const targetPos = this.players[opponent].battlefield.indexOf(target);
                        target.hp -= 1;
                        this.log(`${card.name}の魔法攻撃！${target.name}に1ダメージ！`);
                        if (target.hp <= 0) {
                            this.players[opponent].battlefield[targetPos] = null;
                            this.log(`${target.name}は破壊されました！`);
                            this.players[opponent].gems += 1;
                            this.moveBackRowToFront(opponent);
                        }
                    }
                }
                break;
        }
    }

    triggerTurnStartAbilities(player) {
        const battlefield = this.players[player].battlefield;
        battlefield.forEach((monster, pos) => {
            if (monster && monster.ability === 'regenerate') {
                // Troll: Regenerate 1 HP at turn start
                if (monster.hp < monster.maxHp) {
                    monster.hp += 1;
                    this.log(`${monster.name}の再生！HP+1回復！`);
                }
            }
        });
    }

    calculateGuardReduction(player) {
        // Check if player has Knights in front row
        let reduction = 0;
        const frontPositions = [POSITION.FRONT_LEFT, POSITION.FRONT_RIGHT];
        frontPositions.forEach(pos => {
            const monster = this.players[player].battlefield[pos];
            if (monster && monster.ability === 'guard') {
                reduction += 1;
            }
        });
        return reduction;
    }

    showGameStats(winner) {
        const loser = winner === 1 ? 2 : 1;
        const winnerStats = this.players[winner].stats;
        const loserStats = this.players[loser].stats;

        const statsMessage = `
━━━━━━━━ ゲーム終了 ━━━━━━━━

🏆 プレイヤー${winner}の勝利！

📊 ゲーム統計
────────────────────────
総ターン数: ${this.gameState.turnNumber}

プレイヤー${winner} (勝者):
  与ダメージ: ${winnerStats.damageDealt}
  被ダメージ: ${winnerStats.damageTaken}
  召喚数: ${winnerStats.monstersSummoned}
  撃破数: ${winnerStats.monstersDestroyed}
  消費ジェム: ${winnerStats.gemsSpent}
  残りライフ: ${this.players[winner].life}

プレイヤー${loser} (敗者):
  与ダメージ: ${loserStats.damageDealt}
  被ダメージ: ${loserStats.damageTaken}
  召喚数: ${loserStats.monstersSummoned}
  撃破数: ${loserStats.monstersDestroyed}
  消費ジェム: ${loserStats.gemsSpent}
  残りライフ: ${this.players[loser].life}
────────────────────────
        `.trim();

        alert(statsMessage);
    }

    // Sound effects using Web Audio API
    playSound(type) {
        if (!this.audioContext) return;

        const now = this.audioContext.currentTime;
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        switch(type) {
            case 'summon':
                // Upward sweep for summoning
                oscillator.frequency.setValueAtTime(200, now);
                oscillator.frequency.exponentialRampToValueAtTime(800, now + 0.2);
                gainNode.gain.setValueAtTime(0.3, now);
                gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
                oscillator.start(now);
                oscillator.stop(now + 0.2);
                break;

            case 'attack':
                // Sharp attack sound
                oscillator.frequency.setValueAtTime(400, now);
                oscillator.frequency.exponentialRampToValueAtTime(100, now + 0.15);
                gainNode.gain.setValueAtTime(0.4, now);
                gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
                oscillator.type = 'square';
                oscillator.start(now);
                oscillator.stop(now + 0.15);
                break;

            case 'damage':
                // Impact sound
                oscillator.frequency.setValueAtTime(150, now);
                oscillator.frequency.exponentialRampToValueAtTime(50, now + 0.1);
                gainNode.gain.setValueAtTime(0.5, now);
                gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
                oscillator.type = 'sawtooth';
                oscillator.start(now);
                oscillator.stop(now + 0.1);
                break;

            case 'turnEnd':
                // Pleasant chime for turn end
                oscillator.frequency.setValueAtTime(523.25, now); // C5
                oscillator.frequency.setValueAtTime(659.25, now + 0.1); // E5
                gainNode.gain.setValueAtTime(0.2, now);
                gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
                oscillator.start(now);
                oscillator.stop(now + 0.3);
                break;

            case 'victory':
                // Victory fanfare
                oscillator.frequency.setValueAtTime(523.25, now); // C5
                oscillator.frequency.setValueAtTime(659.25, now + 0.15); // E5
                oscillator.frequency.setValueAtTime(783.99, now + 0.3); // G5
                gainNode.gain.setValueAtTime(0.3, now);
                gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
                oscillator.start(now);
                oscillator.stop(now + 0.5);
                break;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new CardGame();
});
