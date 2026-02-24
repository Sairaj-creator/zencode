import * as vscode from 'vscode';

// Data Storage (Simple array for this MVP)
let stressHistory: { time: string; score: number }[] = [];
let lastStressScore = 0;
let charsDeleted = 0;
let charsTyped = 0;
let fileSwitchCount = 0;
let intervalId: NodeJS.Timeout | undefined;
let postureIntervalId: NodeJS.Timeout | undefined;
let myStatusBarItem: vscode.StatusBarItem;

// Smart Break Handling
let lastActivityTime = Date.now();
let continuousWorkDurationMinutes = 0; // Tracks minutes of continuous work

export function activate(context: vscode.ExtensionContext) {
    // 1. Status Bar Setup
    myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    myStatusBarItem.command = 'zencode.openDashboard';
    context.subscriptions.push(myStatusBarItem);
    myStatusBarItem.show();

    // 2. Commands
    context.subscriptions.push(vscode.commands.registerCommand('zencode.showStats', () => {
        const currentErrorRate = charsTyped > 0 ? (charsDeleted / charsTyped) : 0;
        const currentStr = `Current Session (Live): ${charsTyped} keys, ${charsDeleted} deletions (${(currentErrorRate * 100).toFixed(1)}%)`;
        const lastStr = `Last Interval Score: ${lastStressScore}% Stress`;

        vscode.window.showInformationMessage(`${lastStr}  |  ${currentStr}`);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('zencode.openDashboard', () => {
        const panel = vscode.window.createWebviewPanel(
            'zenDashboard',
            'ZenCode Dashboard',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        panel.webview.html = getWebviewContent();
    }));

    // 3. The Spy Logic (Data Collection)
    // Track typing
    const textListener = vscode.workspace.onDidChangeTextDocument((event) => {
        lastActivityTime = Date.now(); // Update activity timestamp
        if (event.contentChanges.length === 0) return;
        event.contentChanges.forEach((change) => {
            change.text === '' ? charsDeleted += change.rangeLength : charsTyped += change.text.length;
        });
    });
    context.subscriptions.push(textListener);

    // Track file switching (AI Stress Detection)
    const activeEditorListener = vscode.window.onDidChangeActiveTextEditor(() => {
        lastActivityTime = Date.now();
        fileSwitchCount++;
    });
    context.subscriptions.push(activeEditorListener);


    // 4. The Recorder (Logs data every 30 seconds for the graph)
    intervalId = setInterval(() => {
        const config = vscode.workspace.getConfiguration('zencode');

        // --- AI Stress Calculation ---
        let stressScore = 0;

        // MINIMUM THRESHOLD: Ignore stats if user typed fewer than 15 characters
        // This prevents "1 typo / 1 key = 100% stress" false alarms.
        if (charsTyped > 15) {
            const errorRate = (charsDeleted / charsTyped);
            stressScore = Math.min(100, Math.floor(errorRate * 100));

            // "Frustration Detection": High file switching + high backspacing
            if (fileSwitchCount > 5 && charsDeleted > 20) {
                stressScore = Math.min(100, stressScore + 30); // Spike stress
            }
        }

        // Update global var for the "Show Stats" command
        lastStressScore = stressScore;

        // Save to history
        const timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        stressHistory.push({ time: timeLabel, score: stressScore });
        if (stressHistory.length > 20) stressHistory.shift();

        // Update UI & Triggers
        if (processActivity(config)) { // Only update if user is active
            updateStatusBar(stressScore, config);
        } else {
            // If idle, maybe clear the status bar or show "Zen"
            myStatusBarItem.text = `$(coffee) Zen: Idle`;
            myStatusBarItem.backgroundColor = undefined;
        }

        // Reset counters
        charsDeleted = 0;
        charsTyped = 0;
        fileSwitchCount = 0;
    }, 30000);

    // 5. Posture Reminder Logic
    setupPostureReminder(context);

    // Listen for config changes to restart timers if needed
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('zencode.postureReminderInterval')) {
            setupPostureReminder(context);
        }
    }));
}

function processActivity(config: vscode.WorkspaceConfiguration): boolean {
    const now = Date.now();

    // Resets smart break timer if idle for > 30 seconds
    if (now - lastActivityTime > 30000) {
        continuousWorkDurationMinutes = 0;
        return false; // User is idle
    } else {
        // User is active, increment approximately 0.5 minutes (since this runs every 30s)
        continuousWorkDurationMinutes += 0.5;

        // Check Smart Break
        const smartBreakDuration = config.get<number>('smartBreakDuration', 42);
        if (continuousWorkDurationMinutes >= smartBreakDuration) {
            vscode.window.showInformationMessage(`🧠 You've been verified "In The Zone" for ${smartBreakDuration} mins! Time for a brain break?`, "Okay");
            continuousWorkDurationMinutes = 0; // Reset after notifying
        }
        return true;
    }
}

function updateStatusBar(stressScore: number, config: vscode.WorkspaceConfiguration) {
    const threshold = config.get<number>('fatigueThreshold', 20);
    const strict = config.get<boolean>('strictMode', false);
    const autoZen = config.get<boolean>('autoZenMode', false);

    if (stressScore > threshold) {
        myStatusBarItem.text = `$(alert) Fatigue: ${stressScore}%`;
        myStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');

        if (strict) {
            vscode.window.showWarningMessage(`High Fatigue (${stressScore}%) Detected! Take a short break.`, { modal: true });
        }

        if (autoZen) {
            // Toggle Zen Mode if not likely already in it (Hard to detect exact state, but safe to toggle)
            // A better approach would be to check config "zenMode.fullScreen" but let's just run command.
            vscode.commands.executeCommand('workbench.action.toggleZenMode');
            vscode.window.showInformationMessage("Zen Mode activated to reduce visual noise.");
        }

    } else {
        const zenScore = 100 - stressScore;
        myStatusBarItem.text = `$(heart) Zen: ${zenScore}%`;
        myStatusBarItem.backgroundColor = undefined;
    }
    myStatusBarItem.tooltip = "Click to open ZenCode Dashboard";
}

function setupPostureReminder(context: vscode.ExtensionContext) {
    if (postureIntervalId) clearInterval(postureIntervalId);

    const config = vscode.workspace.getConfiguration('zencode');
    const intervalMinutes = config.get<number>('postureReminderInterval', 60);

    if (intervalMinutes > 0) {
        postureIntervalId = setInterval(() => {
            vscode.window.showInformationMessage("CHECK YOUR POSTURE 👀");
        }, intervalMinutes * 60 * 1000);
    }
}


function getWebviewContent() {
    // Current state (simplified for immediate render, in reality you'd pass args)
    const config = vscode.workspace.getConfiguration('zencode');
    const threshold = config.get<number>('fatigueThreshold', 20);
    const stressScore = lastStressScore;
    const errorRate = charsTyped > 0 ? ((charsDeleted / charsTyped) * 100).toFixed(1) : "0.0";
    const safeStress = Math.min(100, Math.max(0, stressScore)); // Bound 0-100

    // Prepare data for chart
    const labels = JSON.stringify(stressHistory.map(d => d.time));
    const data = JSON.stringify(stressHistory.map(d => d.score));

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>ZenCode Analytics</title>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <style>
            body { 
                font-family: var(--vscode-font-family); 
                background-color: var(--vscode-editor-background); 
                color: var(--vscode-editor-foreground); 
                padding: 20px; 
                margin: 0;
            }
            .header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid var(--vscode-widget-border);
                padding-bottom: 15px;
                margin-bottom: 25px;
            }
            .header h1 {
                font-size: 1.5rem;
                margin: 0;
                font-weight: 600;
                color: var(--vscode-editor-foreground);
            }
            .live-badge {
                background: rgba(32, 201, 151, 0.1);
                color: #20c997;
                padding: 5px 12px;
                border-radius: 20px;
                font-size: 0.85rem;
                font-weight: bold;
                display: flex;
                align-items: center;
                gap: 6px;
                border: 1px solid rgba(32, 201, 151, 0.2);
            }
            .thunder-icon {
                animation: pulse 2s infinite;
            }
            @keyframes pulse {
                0% { opacity: 0.5; }
                50% { opacity: 1; text-shadow: 0 0 8px #20c997; }
                100% { opacity: 0.5; }
            }
            .grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 20px;
                margin-bottom: 30px;
            }
            .card {
                background: var(--vscode-editor-inactiveSelectionBackground);
                border: 1px solid var(--vscode-widget-border);
                padding: 20px;
                border-radius: 6px;
                text-align: center;
            }
            .card-title {
                font-size: 0.75rem;
                color: var(--vscode-descriptionForeground);
                text-transform: uppercase;
                letter-spacing: 1px;
                margin-bottom: 8px;
            }
            .card-value {
                font-size: 2rem;
                font-weight: 300;
                color: var(--vscode-editor-foreground);
            }
            .stress-high { color: #ff6b6b; }
            .stress-normal { color: #20c997; }
            
            .chart-container { 
                position: relative; 
                height: 350px; 
                width: 100%; 
                background: var(--vscode-editor-inactiveSelectionBackground);
                border: 1px solid var(--vscode-widget-border);
                border-radius: 6px;
                padding: 20px;
                box-sizing: border-box; 
            }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>ZenCode Analytics</h1>
            <div class="live-badge">
                <span class="thunder-icon">⚡</span> LIVE TRACKING
            </div>
        </div>

        <div class="grid">
             <div class="card">
                <div class="card-title">Cognitive Load</div>
                <div class="card-value ${safeStress > threshold ? 'stress-high' : 'stress-normal'}">
                    ${safeStress}%
                </div>
            </div>
            <div class="card">
                <div class="card-title">Error Rate</div>
                <div class="card-value">${errorRate}%</div>
            </div>
            <div class="card">
                <div class="card-title">Session Keys</div>
                <div class="card-value">${charsTyped}</div>
            </div>
        </div>

        <div class="chart-container">
            <canvas id="stressChart"></canvas>
        </div>

        <script>
            const ctx = document.getElementById('stressChart').getContext('2d');
            
            // Create Gradient
            let gradient = ctx.createLinearGradient(0, 0, 0, 350);
            gradient.addColorStop(0, 'rgba(32, 201, 151, 0.25)');
            gradient.addColorStop(1, 'rgba(32, 201, 151, 0.0)');

            // Font settings
            Chart.defaults.color = '#888';
            Chart.defaults.font.family = 'Segoe UI, sans-serif';

            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: ${labels},
                    datasets: [{
                        label: 'Stress Level',
                        data: ${data},
                        borderColor: '#20c997',
                        backgroundColor: gradient,
                        borderWidth: 2,
                        tension: 0.2, // Technical look
                        fill: true,
                        pointBackgroundColor: '#20c997',
                        pointBorderColor: '#fff',
                        pointRadius: 3,
                        pointHoverRadius: 5
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            mode: 'index',
                            intersect: false,
                             backgroundColor: 'rgba(0,0,0,0.8)',
                             titleColor: '#fff',
                             bodyColor: '#fff',
                             borderColor: '#444',
                             borderWidth: 1
                        }
                    },
                    scales: {
                        y: { 
                            beginAtZero: true, 
                            max: 100, 
                            grid: { 
                                color: 'rgba(255, 255, 255, 0.05)',
                                borderDash: [5, 5]
                            },
                        },
                        x: { 
                            grid: { display: false }
                        }
                    },
                    interaction: {
                        mode: 'nearest',
                        axis: 'x',
                        intersect: false
                    }
                }
            });
        </script>
    </body>
    </html>`;
}

export function deactivate() {
    if (intervalId) clearInterval(intervalId);
    if (postureIntervalId) clearInterval(postureIntervalId);
}