# TaskRunner Framework

Simple async task orchestration for DeadZone plugins with gametick-safe API calls.

The plugin is free to use, no fees or charges. But I do expect credit and a link to this repo in your public packages if you used this to create it.
Also let me know what you create (public or private!) using this framework!
## Usage

```javascript
class MyTask extends Task {
    async execute() {
        const widget = await this.getWidget(12, 1);  // Safe call
        const level = await this.getVarbit(1173);
        
        if (level >= 50) {
            return taskRunner.currentTaskIndex + 1;  // Next task
        }
        return taskRunner.currentTaskIndex;  // Stay here
    }
}

taskRunner = new TaskRunner()
    .addTask(new MyTask());

taskRunner.run();
```

## OnGameTick Integration

```javascript
function OnGameTick() {
    GameTickSafe.process();
    
    if (taskRunner && taskRunner.activeTask instanceof GameTickTask) {
        const shouldContinue = taskRunner.activeTask.processGameTick();
        if (!shouldContinue) {
            taskRunner.signalTaskTransition();
        }
    }
}
```

## Features

- Async/await support without client hangs
- Safe widget/varbit access via gametick queuing  
- Task chaining and flow control
- GameTickTask for timing-dependent operations
- Automatic cleanup and error handling

See `main.js` for a complete woodcutting example.
