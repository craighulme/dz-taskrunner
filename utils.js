// TaskRunner Framework
// Provides async task orchestration with gametick-safe API calls

// GameTick safety system
const GameTickSafe = {
    queue: [],
    promises: new Map(),
    promiseId: 0,
    
    async run(operation, timeout = 3000) {
        return new Promise((resolve, reject) => {
            const id = ++this.promiseId;
            const timer = setTimeout(() => {
                this.promises.delete(id);
                reject(new Error('GameTick timeout'));
            }, timeout);
            
            this.promises.set(id, { resolve, reject, timer });
            this.queue.push({ operation, id });
        });
    },
    
    process() {
        while (this.queue.length > 0) {
            const { operation, id } = this.queue.shift();
            const promise = this.promises.get(id);
            
            if (promise) {
                try {
                    const result = operation();
                    clearTimeout(promise.timer);
                    promise.resolve(result);
                } catch (error) {
                    clearTimeout(promise.timer);
                    promise.reject(error);
                } finally {
                    this.promises.delete(id);
                }
            }
        }
    }
};

class Task {
    constructor() {
        this.name = this.constructor.name;
    }

    async initialize() {
        // Override in subclasses for setup logic
    }

    async execute() {
        throw new Error(`Task.execute() not implemented in ${this.name}`);
    }

    async cleanup() {
        // Override in subclasses for cleanup logic
    }

    // Gametick-safe API methods
    async getWidget(groupId, childId) {
        return GameTickSafe.run(() => Game.info.getWidget(groupId, childId));
    }

    async getVarbit(varbitId) {
        return GameTickSafe.run(() => Game.getVarbitValue(varbitId));
    }

    async getVarp(varpId) {
        return GameTickSafe.run(() => Game.getVarPlayerValue(varpId));
    }

    async runOnTick(operation) {
        return GameTickSafe.run(operation);
    }

    // Async delay function that works with await
    async delay(ms) {
        return new Promise(resolve => {
            Utility.invokeLater(() => {
                resolve();
            }, ms);
        });
    }
}

class GameTickTask extends Task {
    constructor() {
        super();
        this.isRunning = false;
        this.tickCount = 0;
    }

    async initialize() {
        await super.initialize();
        this.isRunning = true;
    }

    async execute() {
        Logger.log(`Starting gametick-based task: ${this.name}`, "info");
        await this.initialize();
        return TaskRunner.STAY_ON_CURRENT_TASK;
    }

    // Override this method for gametick logic
    processGameTick() {
        if (!this.isRunning) return false;
        this.tickCount++;
        return true;
    }

    async cleanup() {
        this.isRunning = false;
        await super.cleanup();
    }
}

class TaskRunner {
    constructor() {
        this.tasks = [];
        this.currentTaskIndex = 0;
        this.activeTask = null;
        this.isRunning = false;
        this.transitionPromiseResolve = null;
    }

    addTask(task) {
        this.tasks.push(task);
        return this;
    }

    signalTaskTransition(targetTaskIndex = null) {
        if (this.transitionPromiseResolve) {
            this.transitionPromiseResolve(targetTaskIndex !== null ? targetTaskIndex : this.currentTaskIndex + 1);
            this.transitionPromiseResolve = null;
        }
    }

    waitForTaskTransition() {
        return new Promise(resolve => {
            this.transitionPromiseResolve = resolve;
        });
    }

    async run() {
        this.isRunning = true;

        while (this.isRunning && this.currentTaskIndex < this.tasks.length) {
            if (this.activeTask) {
                Logger.log(`Cleaning up previous task: ${this.activeTask.name}`, "debug");
                await this.activeTask.cleanup();
                this.activeTask = null;
            }

            this.activeTask = this.tasks[this.currentTaskIndex];
            const task = this.activeTask;

            try {
                Logger.log(`Executing task ${this.currentTaskIndex + 1}/${this.tasks.length}: ${task.name}`, "info");

                // // Register this task with the watchdog
                // if (watchdogSystem) {
                //     watchdogSystem.startTask(task.name);
                // }

                const result = await task.execute();

                if (result === TaskRunner.STAY_ON_CURRENT_TASK) {
                    const nextTaskIndex = await this.waitForTaskTransition();
                    this.currentTaskIndex = nextTaskIndex;
                } else if (typeof result === "number") {
                    this.currentTaskIndex = result;
                } else {
                    this.currentTaskIndex++;
                }
            } catch (err) {
                Logger.log(`Task ${task.name} failed: ${err.message}`, "error");
                if (task.onError) {
                    await task.onError(err);
                }
                break;
            } finally {
                // Complete this task in the watchdog
                // if (watchdogSystem) {
                //     watchdogSystem.completeTask();
                // }
            }
        }

        if (this.activeTask) {
            Logger.log(`Final cleanup, stopping task: ${this.activeTask.name}`, "debug");
            await this.activeTask.cleanup();
            this.activeTask = null;
        }

        this.isRunning = false;
    }

    stop() {
        this.isRunning = false;
        if (this.transitionPromiseResolve) {
            this.transitionPromiseResolve(this.currentTaskIndex);
            this.transitionPromiseResolve = null;
        }
    }
}

// Constants
TaskRunner.STAY_ON_CURRENT_TASK = "STAY_ON_CURRENT_TASK";

// OnGameTick Integration
// Add this to your plugin's OnGameTick function:
//
// function OnGameTick() {
//     GameTickSafe.process();
//     
//     if (taskRunner && taskRunner.activeTask instanceof GameTickTask) {
//         const shouldContinue = taskRunner.activeTask.processGameTick();
//         if (!shouldContinue) {
//             taskRunner.signalTaskTransition();
//         }
//     }
// }