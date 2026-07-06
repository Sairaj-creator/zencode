import * as vscode from 'vscode';
import {
	ActivitySample,
	DEFAULT_IDLE_RESET_MINUTES,
	DEFAULT_MINIMUM_KEYSTROKE_THRESHOLD,
	DEFAULT_SAMPLING_WINDOW_MINUTES,
	FatigueSignals,
	computeFatigueScore,
	isIdle,
	isWithinWorkday,
	pruneSamples,
	summarizeFatigueSignals,
} from './core/fatigueDetector';
import {
	FatigueHistoryPoint,
	escapeHtml,
	getEnum,
	getNumber,
	getStringArray,
	normalizeHistory,
	trimHistory as trimHistoryPure,
} from './core/utils';

interface ZenConfig {
	enabled: boolean;
	fatigueThreshold: number;
	strictMode: boolean;
	autoZenMode: boolean;
	postureReminderInterval: number;
	smartBreakDuration: number;
	wellnessNotifications: boolean;
	hydrationInterval: number;
	eyeExerciseInterval: number;
	samplingWindowMinutes: number;
	minimumKeystrokeThreshold: number;
	excludedLanguages: string[];
	excludedWorkspaces: string[];
	dataRetentionDays: number;
	statusBarPosition: 'left' | 'right';
	notificationStyle: 'subtle' | 'normal' | 'aggressive';
	workdayStartHour: number;
	workdayEndHour: number;
	privacyMode: boolean;
}

const HISTORY_STORAGE_KEY = 'zencode.history.v1';
const RECORDING_INTERVAL_MS = 30000;
const DEFAULT_SMART_BREAK_DURATION_MINUTES = 45;
const MAX_INTER_KEY_INTERVALS = 500;
const FATIGUE_NOTICE_COOLDOWN_MS = 15 * 60 * 1000;

let statusBarItem: vscode.StatusBarItem | undefined;
let dashboardPanel: vscode.WebviewPanel | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let config: ZenConfig;

let recordingIntervalId: NodeJS.Timeout | undefined;
let postureIntervalId: NodeJS.Timeout | undefined;
let hydrationIntervalId: NodeJS.Timeout | undefined;
let eyeExerciseIntervalId: NodeJS.Timeout | undefined;

let samples: ActivitySample[] = [];
let history: FatigueHistoryPoint[] = [];
let interKeyIntervalsMs: number[] = [];
let currentTyped = 0;
let currentDeleted = 0;
let currentFileSwitches = 0;
let currentUndoRedo = 0;
let lastStressScore = 0;
let lastSignals: FatigueSignals | undefined;
let lastActivityAt = Date.now();
let lastChangeAt: number | undefined;
let sessionStartedAt: number | undefined;
let lastFatigueNoticeAt = 0;
let lastBreakSuggestionAt = 0;
let autoZenTriggeredForEpisode = false;

export function activate(context: vscode.ExtensionContext): void {
	outputChannel = vscode.window.createOutputChannel('ZenCode');
	context.subscriptions.push(outputChannel);

	try {
		config = readConfig();
		history = config.privacyMode ? [] : normalizeHistory(context.globalState.get<FatigueHistoryPoint[]>(HISTORY_STORAGE_KEY, []));

		createStatusBarItem(context);
		registerCommands(context);
		registerListeners(context);
		startRecording(context);
		startReminderTimers();
		updateStatusBar('warming');
	} catch (error) {
		logError('Failed to activate ZenCode.', error);
		void vscode.window.showErrorMessage('ZenCode failed to activate. Check the ZenCode output channel for details.');
	}
}

export function deactivate(): void {
	clearRecordingTimer();
	clearReminderTimers();
	statusBarItem?.dispose();
	dashboardPanel?.dispose();
	outputChannel?.dispose();
}

function registerCommands(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.commands.registerCommand('zencode.showStats', () => {
		try {
			const errorRate = lastSignals ? (lastSignals.rollingErrorRate * 100).toFixed(1) : '0.0';
			const sampleCount = lastSignals?.sampleKeystrokes ?? 0;
			void vscode.window.showInformationMessage(
				`ZenCode: ${lastStressScore}% fatigue, ${errorRate}% correction rate, ${sampleCount} recent keystrokes.`,
			);
		} catch (error) {
			logError('Unable to show ZenCode stats.', error);
			void vscode.window.showErrorMessage('ZenCode could not show current stats.');
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('zencode.openDashboard', () => {
		try {
			openDashboard(context);
		} catch (error) {
			logError('Unable to open ZenCode dashboard.', error);
			void vscode.window.showErrorMessage('ZenCode could not open the dashboard.');
		}
	}));
}

function registerListeners(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(handleDocumentChange));
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => {
		if (!shouldTrackActiveEditor()) {
			return;
		}

		lastActivityAt = Date.now();
		currentFileSwitches += 1;
	}));

	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
		if (!event.affectsConfiguration('zencode')) {
			return;
		}

		config = readConfig();
		createStatusBarItem(context);
		startRecording(context);
		startReminderTimers();
		updateStatusBar(config.enabled ? 'warming' : 'disabled');
		refreshDashboard();
	}));
}

function handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
	if (!shouldTrackDocument(event.document)) {
		return;
	}

	const now = Date.now();
	lastActivityAt = now;
	sessionStartedAt ??= now;

	if (lastChangeAt !== undefined) {
		const interval = now - lastChangeAt;
		if (interval > 0) {
			interKeyIntervalsMs.push(interval);
			if (interKeyIntervalsMs.length > MAX_INTER_KEY_INTERVALS) {
				interKeyIntervalsMs = interKeyIntervalsMs.slice(-MAX_INTER_KEY_INTERVALS);
			}
		}
	}
	lastChangeAt = now;

	for (const change of event.contentChanges) {
		currentTyped += change.text.length;
		currentDeleted += change.rangeLength ?? 0;
	}

	if (event.reason === vscode.TextDocumentChangeReason.Undo || event.reason === vscode.TextDocumentChangeReason.Redo) {
		currentUndoRedo += 1;
	}
}

function startRecording(context: vscode.ExtensionContext): void {
	clearRecordingTimer();
	recordActivity(context);
	recordingIntervalId = setInterval(() => recordActivity(context), RECORDING_INTERVAL_MS);
}

function clearRecordingTimer(): void {
	if (recordingIntervalId) {
		clearInterval(recordingIntervalId);
		recordingIntervalId = undefined;
	}
}

function recordActivity(context: vscode.ExtensionContext): void {
	const now = Date.now();

	if (!config.enabled) {
		resetCurrentCounters();
		updateStatusBar('disabled');
		return;
	}

	if (!isWithinWorkday(new Date(now), config.workdayStartHour, config.workdayEndHour)) {
		resetCurrentCounters();
		updateStatusBar('outside-hours');
		return;
	}

	if (isIdle(now, lastActivityAt, DEFAULT_IDLE_RESET_MINUTES)) {
		resetSession();
		updateStatusBar('idle');
		refreshDashboard();
		return;
	}

	if (currentTyped > 0 || currentDeleted > 0 || currentFileSwitches > 0 || currentUndoRedo > 0) {
		samples.push({
			timestamp: now,
			typed: currentTyped,
			deleted: currentDeleted,
			fileSwitches: currentFileSwitches,
			undoRedo: currentUndoRedo,
		});
	}

	samples = pruneSamples(samples, now, config.samplingWindowMinutes);
	lastSignals = summarizeFatigueSignals({
		samples,
		interKeyIntervalsMs,
		now,
		samplingWindowMinutes: config.samplingWindowMinutes,
		sessionStartedAt,
	});
	lastStressScore = computeFatigueScore(lastSignals, config.minimumKeystrokeThreshold);

	history.push({
		timestamp: now,
		time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
		score: lastStressScore,
		typed: currentTyped,
		deleted: currentDeleted,
	});
	trimHistory(now);
	persistHistory(context);

	updateStatusBar(lastSignals.sampleKeystrokes < config.minimumKeystrokeThreshold ? 'warming' : 'active');
	maybeSuggestSmartBreak(now);
	maybeNotifyFatigue(lastStressScore);
	refreshDashboard();
	resetCurrentCounters();
}

function maybeSuggestSmartBreak(now: number): void {
	if (!sessionStartedAt || config.smartBreakDuration <= 0 || !config.wellnessNotifications) {
		return;
	}

	const sessionMinutes = (now - sessionStartedAt) / 60000;
	if (sessionMinutes < config.smartBreakDuration) {
		return;
	}

	const sinceLastSuggestion = (now - lastBreakSuggestionAt) / 60000;
	if (lastBreakSuggestionAt > 0 && sinceLastSuggestion < config.smartBreakDuration) {
		return;
	}

	lastBreakSuggestionAt = now;
	void vscode.window.showInformationMessage(
		`ZenCode: ${config.smartBreakDuration} focused minutes logged. Take a short reset?`,
		'OK',
	);
}

function maybeNotifyFatigue(score: number): void {
	if (score <= config.fatigueThreshold) {
		autoZenTriggeredForEpisode = false;
		return;
	}

	const now = Date.now();
	if (now - lastFatigueNoticeAt < FATIGUE_NOTICE_COOLDOWN_MS) {
		return;
	}

	lastFatigueNoticeAt = now;

	if (config.strictMode || config.notificationStyle === 'aggressive') {
		void vscode.window.showWarningMessage(
			`ZenCode: fatigue is elevated at ${score}%. Take a short break?`,
			{ modal: config.strictMode },
			'Snooze 15 min',
		);
	} else if (config.notificationStyle === 'normal') {
		void vscode.window.showWarningMessage(`ZenCode: fatigue is elevated at ${score}%.`);
	}

	if (config.autoZenMode && !autoZenTriggeredForEpisode) {
		autoZenTriggeredForEpisode = true;
		void vscode.commands.executeCommand('workbench.action.toggleZenMode').then(
			() => vscode.window.showInformationMessage('ZenCode enabled Zen Mode to reduce visual noise.'),
			error => logError('Unable to toggle VS Code Zen Mode.', error),
		);
	}
}

function updateStatusBar(state: 'active' | 'warming' | 'idle' | 'disabled' | 'outside-hours'): void {
	if (!statusBarItem) {
		return;
	}

	statusBarItem.command = 'zencode.openDashboard';
	statusBarItem.tooltip = buildStatusTooltip(state);

	if (state === 'disabled') {
		statusBarItem.text = '$(circle-slash) ZenCode: Off';
		statusBarItem.backgroundColor = undefined;
		statusBarItem.show();
		return;
	}

	if (state === 'outside-hours') {
		statusBarItem.text = '$(clock) ZenCode: Paused';
		statusBarItem.backgroundColor = undefined;
		statusBarItem.show();
		return;
	}

	if (state === 'idle') {
		statusBarItem.text = '$(coffee) ZenCode: Idle';
		statusBarItem.backgroundColor = undefined;
		statusBarItem.show();
		return;
	}

	if (state === 'warming') {
		const count = lastSignals?.sampleKeystrokes ?? 0;
		statusBarItem.text = `$(pulse) ZenCode: ${count}/${config.minimumKeystrokeThreshold}`;
		statusBarItem.backgroundColor = undefined;
		statusBarItem.show();
		return;
	}

	if (lastStressScore > config.fatigueThreshold) {
		statusBarItem.text = `$(warning) Fatigue: ${lastStressScore}%`;
		statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
	} else {
		statusBarItem.text = `$(heart) Zen: ${100 - lastStressScore}%`;
		statusBarItem.backgroundColor = undefined;
	}
	statusBarItem.show();
}

function buildStatusTooltip(state: string): string {
	if (state === 'warming') {
		return `ZenCode is collecting ${config.minimumKeystrokeThreshold} keystrokes before scoring fatigue.`;
	}

	if (state === 'disabled') {
		return 'ZenCode monitoring is disabled in settings.';
	}

	if (state === 'outside-hours') {
		return 'ZenCode monitoring is paused outside configured work hours.';
	}

	return 'Open the ZenCode wellness dashboard.';
}

function createStatusBarItem(_context: vscode.ExtensionContext): void {
	const alignment = config.statusBarPosition === 'left' ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right;
	statusBarItem?.dispose();
	statusBarItem = vscode.window.createStatusBarItem(alignment, 100);
}

function openDashboard(context: vscode.ExtensionContext): void {
	if (dashboardPanel) {
		dashboardPanel.reveal(vscode.ViewColumn.One);
		refreshDashboard();
		return;
	}

	dashboardPanel = vscode.window.createWebviewPanel(
		'zenDashboard',
		'ZenCode Dashboard',
		vscode.ViewColumn.One,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
		},
	);
	dashboardPanel.onDidDispose(() => {
		dashboardPanel = undefined;
	});
	dashboardPanel.webview.html = getWebviewContent(dashboardPanel.webview);
	context.subscriptions.push(dashboardPanel);
}

function refreshDashboard(): void {
	if (dashboardPanel) {
		const correctionRate = lastSignals ? (lastSignals.rollingErrorRate * 100).toFixed(1) : '0.0';
		const sessionMinutes = lastSignals ? Math.round(lastSignals.sessionDurationMinutes) : 0;
		void dashboardPanel.webview.postMessage({
			type: 'update',
			fatigueScore: lastStressScore,
			correctionRate,
			sessionMinutes,
			history: history.slice(-60),
			fatigueThreshold: config.fatigueThreshold,
		});
	}
}

function getWebviewContent(webview: vscode.Webview): string {
	const correctionRate = lastSignals ? (lastSignals.rollingErrorRate * 100).toFixed(1) : '0.0';
	const sessionMinutes = lastSignals ? Math.round(lastSignals.sessionDurationMinutes) : 0;
	const initialData = JSON.stringify({
		fatigueScore: lastStressScore,
		correctionRate,
		sessionMinutes,
		history: history.slice(-60),
		fatigueThreshold: config.fatigueThreshold,
	});

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
	<title>ZenCode Dashboard</title>
	<style>
		body {
			margin: 0;
			padding: 20px;
			background: var(--vscode-editor-background);
			color: var(--vscode-foreground);
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
		}
		header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 16px;
			padding-bottom: 16px;
			border-bottom: 1px solid var(--vscode-widget-border);
		}
		h1 {
			margin: 0;
			font-size: 22px;
			font-weight: 600;
		}
		.state {
			color: var(--vscode-descriptionForeground);
			white-space: nowrap;
		}
		.grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
			gap: 12px;
			margin: 18px 0;
		}
		.metric {
			border: 1px solid var(--vscode-widget-border);
			background: var(--vscode-editor-inactiveSelectionBackground);
			border-radius: 6px;
			padding: 14px;
		}
		.label {
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
			text-transform: uppercase;
		}
		.value {
			margin-top: 6px;
			font-size: 28px;
			font-weight: 600;
			transition: opacity 0.3s ease;
		}
		.chart {
			border: 1px solid var(--vscode-widget-border);
			background: var(--vscode-editor-inactiveSelectionBackground);
			border-radius: 6px;
			padding: 12px;
			min-height: 260px;
			position: relative;
		}
		.empty {
			display: grid;
			min-height: 230px;
			place-items: center;
			color: var(--vscode-descriptionForeground);
			text-align: center;
		}
		canvas {
			display: block;
			width: 100%;
			height: 260px;
		}
		.tooltip {
			position: absolute;
			pointer-events: none;
			background: var(--vscode-editorWidget-background, #1e1e1e);
			border: 1px solid var(--vscode-widget-border);
			border-radius: 4px;
			padding: 4px 8px;
			font-size: 12px;
			opacity: 0;
			transition: opacity 0.15s ease;
			white-space: nowrap;
			z-index: 10;
		}
	</style>
</head>
<body>
	<header>
		<h1>ZenCode Dashboard</h1>
		<div class="state">${escapeHtml(config.enabled ? 'Monitoring active' : 'Monitoring off')}</div>
	</header>
	<section class="grid" aria-label="Current wellness metrics">
		<div class="metric">
			<div class="label">Fatigue Score</div>
			<div class="value" id="fatigue-value">${lastStressScore}%</div>
		</div>
		<div class="metric">
			<div class="label">Correction Rate</div>
			<div class="value" id="correction-value">${correctionRate}%</div>
		</div>
		<div class="metric">
			<div class="label">Session Minutes</div>
			<div class="value" id="session-value">${sessionMinutes}</div>
		</div>
	</section>
	<section class="chart" aria-label="Fatigue trend chart" id="chart-container">
		<canvas id="chart-canvas"></canvas>
		<div class="tooltip" id="tooltip"></div>
	</section>
	<script>
	(function() {
		const vscode = acquireVsCodeApi();
		const canvas = document.getElementById('chart-canvas');
		const ctx = canvas.getContext('2d');
		const tooltip = document.getElementById('tooltip');
		const chartContainer = document.getElementById('chart-container');

		let currentPoints = [];
		let targetPoints = [];
		let animationProgress = 1;
		let animationId = null;
		let fatigueThreshold = 20;

		const PADDING = 28;
		const ANIM_DURATION = 500;

		function getComputedColor(varName, fallback) {
			const style = getComputedStyle(document.body);
			return style.getPropertyValue(varName).trim() || fallback;
		}

		function resizeCanvas() {
			const rect = canvas.getBoundingClientRect();
			const dpr = window.devicePixelRatio || 1;
			canvas.width = rect.width * dpr;
			canvas.height = rect.height * dpr;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		}

		function computeCoordinates(history, w, h) {
			const visible = history.slice(-60);
			if (visible.length === 0) return [];
			const maxIndex = Math.max(1, visible.length - 1);
			return visible.map((pt, i) => ({
				x: PADDING + (i / maxIndex) * (w - PADDING * 2),
				y: PADDING + (1 - pt.score / 100) * (h - PADDING * 2),
				label: pt.time + ': ' + pt.score + '%',
				score: pt.score
			}));
		}

		function lerp(a, b, t) {
			return a + (b - a) * t;
		}

		function easeInOut(t) {
			return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
		}

		function interpolatePoints(from, to, t) {
			const maxLen = Math.max(from.length, to.length);
			const result = [];
			for (let i = 0; i < maxLen; i++) {
				const fPt = from[Math.min(i, from.length - 1)] || to[i];
				const tPt = to[Math.min(i, to.length - 1)] || fPt;
				result.push({
					x: lerp(fPt.x, tPt.x, t),
					y: lerp(fPt.y, tPt.y, t),
					label: tPt.label,
					score: tPt.score
				});
			}
			return result;
		}

		function drawChart(points) {
			const rect = canvas.getBoundingClientRect();
			const w = rect.width;
			const h = rect.height;

			ctx.clearRect(0, 0, w, h);

			const axisColor = getComputedColor('--vscode-descriptionForeground', '#888');
			const lineColor = getComputedColor('--vscode-charts-green', '#89d185');

			// Draw axes
			ctx.strokeStyle = axisColor;
			ctx.globalAlpha = 0.45;
			ctx.lineWidth = 1;

			// X axis
			ctx.beginPath();
			ctx.moveTo(PADDING, h - PADDING);
			ctx.lineTo(w - PADDING, h - PADDING);
			ctx.stroke();

			// Y axis
			ctx.beginPath();
			ctx.moveTo(PADDING, PADDING);
			ctx.lineTo(PADDING, h - PADDING);
			ctx.stroke();

			// Threshold line
			const threshY = PADDING + (1 - fatigueThreshold / 100) * (h - PADDING * 2);
			ctx.beginPath();
			ctx.setLineDash([6, 4]);
			ctx.moveTo(PADDING, threshY);
			ctx.lineTo(w - PADDING, threshY);
			ctx.stroke();
			ctx.setLineDash([]);

			// Y-axis labels
			ctx.globalAlpha = 0.5;
			ctx.fillStyle = axisColor;
			ctx.font = '10px ' + getComputedStyle(document.body).fontFamily;
			ctx.textAlign = 'right';
			for (let pct = 0; pct <= 100; pct += 25) {
				const yy = PADDING + (1 - pct / 100) * (h - PADDING * 2);
				ctx.fillText(pct + '%', PADDING - 4, yy + 3);
			}

			ctx.globalAlpha = 1;

			if (points.length === 0) {
				ctx.fillStyle = axisColor;
				ctx.globalAlpha = 0.6;
				ctx.textAlign = 'center';
				ctx.font = '14px ' + getComputedStyle(document.body).fontFamily;
				ctx.fillText('Start coding to see your fatigue trend.', w / 2, h / 2);
				return;
			}

			// Draw gradient fill under line
			if (points.length > 1) {
				const gradient = ctx.createLinearGradient(0, PADDING, 0, h - PADDING);
				gradient.addColorStop(0, lineColor + '40');
				gradient.addColorStop(1, lineColor + '05');

				ctx.beginPath();
				ctx.moveTo(points[0].x, h - PADDING);
				for (const pt of points) {
					ctx.lineTo(pt.x, pt.y);
				}
				ctx.lineTo(points[points.length - 1].x, h - PADDING);
				ctx.closePath();
				ctx.fillStyle = gradient;
				ctx.fill();
			}

			// Draw line
			ctx.strokeStyle = lineColor;
			ctx.lineWidth = 2.5;
			ctx.lineJoin = 'round';
			ctx.lineCap = 'round';
			ctx.beginPath();
			points.forEach((pt, i) => {
				if (i === 0) ctx.moveTo(pt.x, pt.y);
				else ctx.lineTo(pt.x, pt.y);
			});
			ctx.stroke();

			// Draw points
			for (const pt of points) {
				ctx.beginPath();
				ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
				ctx.fillStyle = lineColor;
				ctx.fill();
			}
		}

		function animate(startTime) {
			const now = performance.now();
			const elapsed = now - startTime;
			animationProgress = Math.min(1, elapsed / ANIM_DURATION);
			const easedT = easeInOut(animationProgress);

			const interp = interpolatePoints(currentPoints, targetPoints, easedT);
			resizeCanvas();
			drawChart(interp);

			if (animationProgress < 1) {
				animationId = requestAnimationFrame(() => animate(startTime));
			} else {
				currentPoints = targetPoints.map(p => ({...p}));
				animationId = null;
			}
		}

		function updateChart(historyData) {
			const rect = canvas.getBoundingClientRect();
			const w = rect.width;
			const h = rect.height;
			targetPoints = computeCoordinates(historyData, w, h);

			if (currentPoints.length === 0) {
				currentPoints = targetPoints.map(p => ({...p}));
				resizeCanvas();
				drawChart(currentPoints);
				return;
			}

			if (animationId) cancelAnimationFrame(animationId);
			animationProgress = 0;
			animate(performance.now());
		}

		// Tooltip on hover
		canvas.addEventListener('mousemove', function(e) {
			const rect = canvas.getBoundingClientRect();
			const mx = e.clientX - rect.left;
			const my = e.clientY - rect.top;
			const pts = currentPoints;
			let closest = null;
			let minDist = Infinity;
			for (const pt of pts) {
				const d = Math.hypot(pt.x - mx, pt.y - my);
				if (d < minDist && d < 20) {
					minDist = d;
					closest = pt;
				}
			}
			if (closest) {
				tooltip.textContent = closest.label;
				tooltip.style.left = closest.x + 'px';
				tooltip.style.top = (closest.y - 30) + 'px';
				tooltip.style.opacity = '1';
			} else {
				tooltip.style.opacity = '0';
			}
		});

		canvas.addEventListener('mouseleave', function() {
			tooltip.style.opacity = '0';
		});

		// Handle messages from extension
		window.addEventListener('message', function(event) {
			const msg = event.data;
			if (msg.type === 'update') {
				document.getElementById('fatigue-value').textContent = msg.fatigueScore + '%';
				document.getElementById('correction-value').textContent = msg.correctionRate + '%';
				document.getElementById('session-value').textContent = msg.sessionMinutes;
				fatigueThreshold = msg.fatigueThreshold;
				updateChart(msg.history || []);
			}
		});

		// Handle resize
		window.addEventListener('resize', function() {
			resizeCanvas();
			drawChart(currentPoints);
		});

		// Initial render
		const initialData = ${initialData};
		fatigueThreshold = initialData.fatigueThreshold;
		setTimeout(function() {
			resizeCanvas();
			updateChart(initialData.history || []);
		}, 50);
	})();
	</script>
</body>
</html>`;
}

function startReminderTimers(): void {
	clearReminderTimers();

	if (!config.enabled || !config.wellnessNotifications) {
		return;
	}

	postureIntervalId = createReminderTimer(config.postureReminderInterval, 'ZenCode: quick posture check.');
	hydrationIntervalId = createReminderTimer(config.hydrationInterval, 'ZenCode: hydrate when you have a moment.');
	eyeExerciseIntervalId = createReminderTimer(config.eyeExerciseInterval, 'ZenCode: 20-20-20 eye reset time.');
}

function createReminderTimer(intervalMinutes: number, message: string): NodeJS.Timeout | undefined {
	if (intervalMinutes <= 0) {
		return undefined;
	}

	return setInterval(() => {
		if (!config.enabled || !config.wellnessNotifications || isIdle(Date.now(), lastActivityAt, DEFAULT_IDLE_RESET_MINUTES)) {
			return;
		}

		void vscode.window.showInformationMessage(message, 'OK');
	}, intervalMinutes * 60 * 1000);
}

function clearReminderTimers(): void {
	for (const timer of [postureIntervalId, hydrationIntervalId, eyeExerciseIntervalId]) {
		if (timer) {
			clearInterval(timer);
		}
	}
	postureIntervalId = undefined;
	hydrationIntervalId = undefined;
	eyeExerciseIntervalId = undefined;
}

function shouldTrackActiveEditor(): boolean {
	const editor = vscode.window.activeTextEditor;
	return editor ? shouldTrackDocument(editor.document) : config.enabled;
}

function shouldTrackDocument(document: vscode.TextDocument): boolean {
	if (!config.enabled) {
		return false;
	}

	if (!isWithinWorkday(new Date(), config.workdayStartHour, config.workdayEndHour)) {
		return false;
	}

	if (config.excludedLanguages.includes(document.languageId)) {
		return false;
	}

	const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
	return !config.excludedWorkspaces.some(excluded =>
		workspaceFolders.some(folder => folder.uri.fsPath.toLowerCase().includes(excluded.toLowerCase())),
	);
}

function resetCurrentCounters(): void {
	currentTyped = 0;
	currentDeleted = 0;
	currentFileSwitches = 0;
	currentUndoRedo = 0;
}

function resetSession(): void {
	resetCurrentCounters();
	samples = [];
	interKeyIntervalsMs = [];
	sessionStartedAt = undefined;
	lastChangeAt = undefined;
	lastStressScore = 0;
	lastSignals = undefined;
	lastBreakSuggestionAt = 0;
	autoZenTriggeredForEpisode = false;
}

function persistHistory(context: vscode.ExtensionContext): void {
	if (config.privacyMode) {
		return;
	}

	void context.globalState.update(HISTORY_STORAGE_KEY, history).then(
		undefined,
		error => logError('Unable to persist ZenCode history.', error),
	);
}

function trimHistory(now: number): void {
	history = trimHistoryPure(history, now, config.dataRetentionDays);
}

// normalizeHistory is now imported from ./core/utils

function readConfig(): ZenConfig {
	const workspaceConfig = vscode.workspace.getConfiguration('zencode');

	return {
		enabled: workspaceConfig.get<boolean>('enabled', true),
		fatigueThreshold: getNumber(workspaceConfig, 'fatigueThreshold', 20, 0, 100),
		strictMode: workspaceConfig.get<boolean>('strictMode', false),
		autoZenMode: workspaceConfig.get<boolean>('autoZenMode', false),
		postureReminderInterval: getNumber(workspaceConfig, 'postureReminderInterval', 60, 0, 1440),
		smartBreakDuration: getNumber(workspaceConfig, 'smartBreakDuration', DEFAULT_SMART_BREAK_DURATION_MINUTES, 1, 240),
		wellnessNotifications: workspaceConfig.get<boolean>('wellnessNotifications', true),
		hydrationInterval: getNumber(workspaceConfig, 'hydrationInterval', 30, 0, 1440),
		eyeExerciseInterval: getNumber(workspaceConfig, 'eyeExerciseInterval', 20, 0, 1440),
		samplingWindowMinutes: getNumber(workspaceConfig, 'samplingWindowMinutes', DEFAULT_SAMPLING_WINDOW_MINUTES, 1, 60),
		minimumKeystrokeThreshold: getNumber(
			workspaceConfig,
			'minimumKeystrokeThreshold',
			DEFAULT_MINIMUM_KEYSTROKE_THRESHOLD,
			1,
			10000,
		),
		excludedLanguages: getStringArray(workspaceConfig, 'excludedLanguages'),
		excludedWorkspaces: getStringArray(workspaceConfig, 'excludedWorkspaces'),
		dataRetentionDays: getNumber(workspaceConfig, 'dataRetentionDays', 30, 1, 365),
		statusBarPosition: getEnum(workspaceConfig, 'statusBarPosition', 'right', ['left', 'right']),
		notificationStyle: getEnum(workspaceConfig, 'notificationStyle', 'normal', ['subtle', 'normal', 'aggressive']),
		workdayStartHour: getNumber(workspaceConfig, 'workdayStartHour', 0, 0, 23),
		workdayEndHour: getNumber(workspaceConfig, 'workdayEndHour', 0, 0, 23),
		privacyMode: workspaceConfig.get<boolean>('privacyMode', false),
	};
}

// getNumber, getStringArray, getEnum, escapeHtml are now imported from ./core/utils

function logError(message: string, error: unknown): void {
	const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
	outputChannel?.appendLine(`${message}\n${detail}`);
}
