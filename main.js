
// Woodcutting Plugin Example
let taskRunner = null;
let pluginConfig = {
    treeId: 1276, // Oak tree
    targetLevel: 50,
    bankPreset: 1,
    enablePowerchop: true
};
class InitializationTask extends Task {
    async execute() {
        Logger.log("Initializing woodcutting session...", "info");
        
        // Check initial state
        const currentLevel = await this.getVarbit(1173); // Woodcutting XP varbit
        const gameState = await this.runOnTick(() => Client.getGameState());
        const player = await this.runOnTick(() => Client.getLocalPlayer());
        const playerLocation = await this.runOnTick(() => player ? player.getLocation() : null);
        
        if (!player || gameState !== 30) {
            Logger.log("Player not logged in!", "error");
            return taskRunner.currentTaskIndex;
        }
        
        Logger.log(`Starting woodcutting at level ${currentLevel}`, "info");
        Logger.log(`Player location: ${playerLocation}`, "debug");
        
        return taskRunner.currentTaskIndex + 1;
    }
}

class WalkToTreesTask extends Task {
    constructor() {
        super();
        this.targetLocation = { x: 3204, y: 3434, z: 0 }; // Varrock West Bank trees
        this.attempts = 0;
        this.maxAttempts = 5;
    }
    
    async execute() {
        this.attempts++;
        Logger.log(`Walking to trees (attempt ${this.attempts}/${this.maxAttempts})`, "info");
        
        const player = await this.runOnTick(() => Client.getLocalPlayer());
        const playerLoc = await this.runOnTick(() => player ? player.getLocation() : null);
        const distance = Math.sqrt(
            Math.pow(playerLoc.x - this.targetLocation.x, 2) + 
            Math.pow(playerLoc.y - this.targetLocation.y, 2)
        );
        
        if (distance < 10) {
            Logger.log("Arrived at trees!", "info");
            return 2; // Move to woodcutting task
        }
        
        // Check if player is moving
        const isMoving = await this.runOnTick(() => player && player.isMoving());
        
        if (!isMoving && this.attempts < this.maxAttempts) {
            Logger.log("Starting walk to trees...", "debug");
            PlayerHelper.walkTo({ x: this.targetLocation.x, y: this.targetLocation.y, z: this.targetLocation.z });
            
            // Wait a bit for movement to start
            await this.delay(2000);
        }
        
        if (this.attempts >= this.maxAttempts) {
            Logger.log("Failed to reach trees after max attempts", "error");
            throw new Error("Walking failed");
        }
        
        return taskRunner.currentTaskIndex;
    }
}

class WoodcuttingTask extends GameTickTask {
    constructor() {
        super();
        this.lastLogCount = 0;
        this.sessionLogs = 0;
        this.idleTicks = 0;
        this.maxIdleTicks = 50; // ~30 seconds
        this.lastXp = 0;
    }
    
    async initialize() {
        await super.initialize();
        
        // Get starting log count and XP
        this.lastLogCount = await this.runOnTick(() => Inventory.getItemCount(1511)); // Logs
        this.lastXp = await this.getVarbit(1173);
        
        Logger.log("Starting woodcutting...", "info");
    }
    
    processGameTick() {
        if (!this.isRunning) return false;
        
        // Every 5 ticks, check our status
        if (this.tickCount % 5 === 0) {
            this.checkWoodcuttingStatus();
        }
        
        // Every 50 ticks, update progress
        if (this.tickCount % 50 === 0) {
            this.updateProgress();
        }
        
        return true;
    }
    
    async checkWoodcuttingStatus() {
        const player = await this.runOnTick(() => Client.getLocalPlayer());
        const currentAnimation = await this.runOnTick(() => player ? player.getAnimation() : -1);
        const inventoryFull = await this.runOnTick(() => Game.info.inventory.isFull());
        const currentLogCount = await this.runOnTick(() => Game.info.inventory.getItemCount(1511));
        
        // Check if we got new logs
        if (currentLogCount > this.lastLogCount) {
            this.sessionLogs += (currentLogCount - this.lastLogCount);
            this.lastLogCount = currentLogCount;
            this.idleTicks = 0;
            Logger.log(`Chopped log! Session total: ${this.sessionLogs}`, "info");
        }
        
        // Check if inventory is full
        if (inventoryFull) {
            Logger.log("Inventory full! Moving to banking...", "info");
            taskRunner.signalTaskTransition(3); // Go to banking task
            return false;
        }
        
        // Check if we're idle (not woodcutting)
        const isWoodcutting = currentAnimation === 875; // Woodcutting animation
        
        if (!isWoodcutting) {
            this.idleTicks++;
            
            if (this.idleTicks > this.maxIdleTicks) {
                Logger.log("Been idle too long, looking for tree...", "warn");
                await this.findAndClickTree();
                this.idleTicks = 0;
            }
        } else {
            this.idleTicks = 0;
        }
    }
    
    async findAndClickTree() {
        const nearbyTrees = await this.runOnTick(() => {
            return Game.info.gameObject.getNearest([pluginConfig.treeId]);
        });
        
        if (nearbyTrees && nearbyTrees.length > 0) {
            const tree = nearbyTrees[0];
            Logger.log(`Clicking tree at ${tree.getLocation()}`, "debug");
            
            await this.runOnTick(() => {
                tree.interact("Chop down");
            });
        } else {
            Logger.log("No trees found nearby!", "warn");
        }
    }
    
    async updateProgress() {
        const currentXp = await this.getVarbit(1173);
        const currentLevel = await this.runOnTick(() => Skills.getLevel("Woodcutting"));
        
        if (currentXp > this.lastXp) {
            const xpGained = currentXp - this.lastXp;
            Logger.log(`XP gained: ${xpGained} (Level: ${currentLevel})`, "info");
            this.lastXp = currentXp;
        }
        
        // Check if we reached target level
        if (currentLevel >= pluginConfig.targetLevel) {
            Logger.log(`Target level ${pluginConfig.targetLevel} reached!`, "info");
            taskRunner.signalTaskTransition(99); // End plugin
            return false;
        }
    }
}

class BankingTask extends Task {
    constructor() {
        super();
        this.bankLocation = { x: 3185, y: 3436, z: 0 }; // Varrock West Bank
        this.attempts = 0;
    }
    
    async execute() {
        this.attempts++;
        Logger.log(`Banking attempt ${this.attempts}`, "info");
        
        // Check if bank is already open
        const bankOpen = await this.getWidget(12, 1); // Bank interface
        
        if (bankOpen) {
            return await this.performBanking();
        }
        
        // Walk to bank if not nearby
        const player = await this.runOnTick(() => Client.getLocalPlayer());
        const playerLoc = await this.runOnTick(() => player ? player.getLocation() : null);
        const distance = Math.sqrt(
            Math.pow(playerLoc.x - this.bankLocation.x, 2) + 
            Math.pow(playerLoc.y - this.bankLocation.y, 2)
        );
        
        if (distance > 5) {
            Logger.log("Walking to bank...", "debug");
            PlayerHelper.walkTo({ x: this.bankLocation.x, y: this.bankLocation.y, z: this.bankLocation.z });
            
            // Wait for movement
            await this.delay(3000);
            return taskRunner.currentTaskIndex;
        }
        
        // Open bank
        // Try to open nearest bank
        await this.runOnTick(() => {
            Game.interact.bank.openNearest(640, true); // 5 tiles = 640 units
        });
        
        // Wait for bank to open
        await this.delay(2000);
        
        return taskRunner.currentTaskIndex;
    }
    
    async performBanking() {
        Logger.log("Banking logs...", "info");
        
        // Deposit all logs
        const logCount = await this.runOnTick(() => Game.info.inventory.getItemCount(1511));
        
        if (logCount > 0) {
            await this.runOnTick(() => {
                Game.interact.bank.depositAllInventory();
            });
            
            Logger.log(`Deposited ${logCount} logs`, "info");
            
            // Wait for deposit
            await this.delay(1000);
        }
        
        // Bank presets not implemented
        
        // Close bank and return to woodcutting
        await this.runOnTick(() => Game.interact.bank.close());
        
        Logger.log("Banking complete, returning to trees...", "info");
        return 1; // Go back to walking to trees
    }
}

class CleanupTask extends Task {
    async execute() {
        Logger.log("Plugin session complete!", "info");
        
        const finalXp = await this.getVarbit(1173);
        const finalLevel = await this.runOnTick(() => Skills.getLevel("Woodcutting"));
        
        Logger.log(`Final level: ${finalLevel}`, "info");
        Logger.log("Thank you for using TaskRunner Woodcutting!", "info");
        
        // End the task runner
        if (taskRunner) {
            taskRunner.stop();
        }
        
        return taskRunner.currentTaskIndex;
    }
}

// ================================ //
//       Plugin Lifecycle          //
// ================================ //

function OnStart() {
    Logger.log("TaskRunner Woodcutting Plugin starting...", "info");
    
    // Initialize TaskRunner with our task sequence
    taskRunner = new TaskRunner()
        .addTask(new InitializationTask())     // 0: Setup and validation
        .addTask(new WalkToTreesTask())        // 1: Get to woodcutting area
        .addTask(new WoodcuttingTask())        // 2: Main woodcutting loop
        .addTask(new BankingTask())            // 3: Banking when full
        .addTask(new CleanupTask());           // 4: End of session
    
    // Start the task sequence
    taskRunner.run().catch(error => {
        Logger.log(`TaskRunner failed: ${error.message}`, "error");
    });
    
    Logger.log("Plugin started! Check logs for progress.", "info");
}

function OnShutdown() {
    Logger.log("Plugin shutting down...", "info");
    
    if (taskRunner) {
        taskRunner.stop();
        taskRunner = null;
    }
    
    Logger.log("TaskRunner stopped.", "info");
}

function OnGameTick() {
    // Process gametick-safe operations
    GameTickSafe.process();
    
    // Handle GameTickTask processing
    if (taskRunner && taskRunner.activeTask instanceof GameTickTask) {
        const shouldContinue = taskRunner.activeTask.processGameTick();
        if (!shouldContinue) {
            taskRunner.signalTaskTransition();
        }
    }
}
