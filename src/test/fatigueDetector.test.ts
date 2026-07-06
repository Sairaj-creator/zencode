import * as assert from 'assert';
import {
	ActivitySample,
	clamp,
	computeFatigueScore,
	FatigueSignals,
	isIdle,
	isWithinWorkday,
	pruneSamples,
	summarizeFatigueSignals,
} from '../core/fatigueDetector';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
	try {
		fn();
		console.log(`ok - ${name}`);
		passed += 1;
	} catch (error) {
		console.error(`not ok - ${name}`);
		console.error(error);
		failed += 1;
	}
}

const now = 1_700_000_000_000;

// ============================================================
// clamp()
// ============================================================

test('clamp: value within range is unchanged', () => {
	assert.strictEqual(clamp(5, 0, 10), 5);
});

test('clamp: value below min is clamped up', () => {
	assert.strictEqual(clamp(-3, 0, 10), 0);
});

test('clamp: value above max is clamped down', () => {
	assert.strictEqual(clamp(15, 0, 10), 10);
});

test('clamp: boundary values are returned as-is', () => {
	assert.strictEqual(clamp(0, 0, 10), 0);
	assert.strictEqual(clamp(10, 0, 10), 10);
});

// ============================================================
// pruneSamples()
// ============================================================

test('old samples are pruned from the rolling window', () => {
	const samples: ActivitySample[] = [
		{ timestamp: now - 10 * 60000, typed: 100, deleted: 100, fileSwitches: 0, undoRedo: 0 },
		{ timestamp: now - 60000, typed: 100, deleted: 0, fileSwitches: 0, undoRedo: 0 },
	];

	assert.deepStrictEqual(pruneSamples(samples, now, 5), [samples[1]]);
});

test('pruneSamples: all samples within window are kept', () => {
	const samples: ActivitySample[] = [
		{ timestamp: now - 2 * 60000, typed: 10, deleted: 0, fileSwitches: 0, undoRedo: 0 },
		{ timestamp: now - 60000, typed: 20, deleted: 0, fileSwitches: 0, undoRedo: 0 },
		{ timestamp: now, typed: 30, deleted: 0, fileSwitches: 0, undoRedo: 0 },
	];

	assert.strictEqual(pruneSamples(samples, now, 5).length, 3);
});

test('pruneSamples: empty input returns empty output', () => {
	assert.deepStrictEqual(pruneSamples([], now, 5), []);
});

test('pruneSamples: exact boundary sample is included', () => {
	const samples: ActivitySample[] = [
		{ timestamp: now - 5 * 60000, typed: 50, deleted: 0, fileSwitches: 0, undoRedo: 0 },
	];
	// exactly at the boundary (5 minutes = window), should be included (<=)
	assert.strictEqual(pruneSamples(samples, now, 5).length, 1);
});

// ============================================================
// isIdle()
// ============================================================

test('idle detection resets after configured inactivity', () => {
	assert.strictEqual(isIdle(now, now - 6 * 60000, 5), true);
	assert.strictEqual(isIdle(now, now - 2 * 60000, 5), false);
});

test('isIdle: exactly at idle threshold is NOT idle (strict greater-than)', () => {
	// 5 minutes exactly — isIdle uses `>`, so exactly 5 min should be false
	assert.strictEqual(isIdle(now, now - 5 * 60000, 5), false);
});

test('isIdle: just 1ms beyond idle threshold IS idle', () => {
	assert.strictEqual(isIdle(now, now - 5 * 60000 - 1, 5), true);
});

// ============================================================
// isWithinWorkday()
// ============================================================

test('workday windows support normal and overnight schedules', () => {
	assert.strictEqual(isWithinWorkday(new Date('2026-06-25T10:00:00'), 9, 17), true);
	assert.strictEqual(isWithinWorkday(new Date('2026-06-25T20:00:00'), 9, 17), false);
	assert.strictEqual(isWithinWorkday(new Date('2026-06-25T23:00:00'), 22, 6), true);
	assert.strictEqual(isWithinWorkday(new Date('2026-06-25T12:00:00'), 22, 6), false);
});

test('isWithinWorkday: same start and end means all-day monitoring', () => {
	assert.strictEqual(isWithinWorkday(new Date('2026-06-25T03:00:00'), 0, 0), true);
	assert.strictEqual(isWithinWorkday(new Date('2026-06-25T15:00:00'), 0, 0), true);
	assert.strictEqual(isWithinWorkday(new Date('2026-06-25T23:59:00'), 12, 12), true);
});

test('isWithinWorkday: boundary hour (start) is included', () => {
	assert.strictEqual(isWithinWorkday(new Date('2026-06-25T09:00:00'), 9, 17), true);
});

test('isWithinWorkday: boundary hour (end) is excluded', () => {
	assert.strictEqual(isWithinWorkday(new Date('2026-06-25T17:00:00'), 9, 17), false);
});

// ============================================================
// summarizeFatigueSignals() — rolling error rate
// ============================================================

test('minimum keystroke threshold prevents tiny-sample fatigue spikes', () => {
	const samples: ActivitySample[] = [
		{ timestamp: now, typed: 1, deleted: 1, fileSwitches: 0, undoRedo: 0 },
	];
	const signals = summarizeFatigueSignals({
		samples,
		interKeyIntervalsMs: [100, 150],
		now,
		samplingWindowMinutes: 5,
		sessionStartedAt: now - 60000,
	});

	assert.strictEqual(computeFatigueScore(signals, 50), 0);
});

test('rolling correction rate contributes to score after enough activity', () => {
	const samples: ActivitySample[] = [
		{ timestamp: now, typed: 80, deleted: 20, fileSwitches: 0, undoRedo: 0 },
	];
	const signals = summarizeFatigueSignals({
		samples,
		interKeyIntervalsMs: [100, 110, 140, 3000],
		now,
		samplingWindowMinutes: 5,
		sessionStartedAt: now - 20 * 60000,
	});

	assert.ok(computeFatigueScore(signals, 50) > 0);
	assert.strictEqual(Math.round(signals.rollingErrorRate * 100), 20);
});

test('rolling error rate is 0 when nothing is deleted', () => {
	const samples: ActivitySample[] = [
		{ timestamp: now, typed: 100, deleted: 0, fileSwitches: 0, undoRedo: 0 },
	];
	const signals = summarizeFatigueSignals({
		samples,
		interKeyIntervalsMs: [],
		now,
		samplingWindowMinutes: 5,
		sessionStartedAt: now - 60000,
	});

	assert.strictEqual(signals.rollingErrorRate, 0);
});

test('rolling error rate is 0.5 when half of keystrokes are deletes', () => {
	const samples: ActivitySample[] = [
		{ timestamp: now, typed: 50, deleted: 50, fileSwitches: 0, undoRedo: 0 },
	];
	const signals = summarizeFatigueSignals({
		samples,
		interKeyIntervalsMs: [],
		now,
		samplingWindowMinutes: 5,
	});

	assert.strictEqual(signals.rollingErrorRate, 0.5);
});

test('rolling error rate is 0 when no samples exist', () => {
	const signals = summarizeFatigueSignals({
		samples: [],
		interKeyIntervalsMs: [],
		now,
		samplingWindowMinutes: 5,
	});

	assert.strictEqual(signals.rollingErrorRate, 0);
	assert.strictEqual(signals.sampleKeystrokes, 0);
});

// ============================================================
// summarizeFatigueSignals() — typing rhythm variance
// ============================================================

test('typing rhythm variance is 0 with fewer than 2 intervals', () => {
	const samples: ActivitySample[] = [
		{ timestamp: now, typed: 50, deleted: 0, fileSwitches: 0, undoRedo: 0 },
	];
	const signals = summarizeFatigueSignals({
		samples,
		interKeyIntervalsMs: [100],
		now,
		samplingWindowMinutes: 5,
	});

	assert.strictEqual(signals.typingRhythmVariance, 0);
});

test('typing rhythm variance is 0 for perfectly uniform typing', () => {
	const samples: ActivitySample[] = [
		{ timestamp: now, typed: 50, deleted: 0, fileSwitches: 0, undoRedo: 0 },
	];
	const signals = summarizeFatigueSignals({
		samples,
		interKeyIntervalsMs: [100, 100, 100, 100, 100],
		now,
		samplingWindowMinutes: 5,
	});

	assert.strictEqual(signals.typingRhythmVariance, 0);
});

test('typing rhythm variance is high for erratic typing', () => {
	const samples: ActivitySample[] = [
		{ timestamp: now, typed: 50, deleted: 0, fileSwitches: 0, undoRedo: 0 },
	];
	const signals = summarizeFatigueSignals({
		samples,
		interKeyIntervalsMs: [50, 5000, 80, 4000, 100, 3000],
		now,
		samplingWindowMinutes: 5,
	});

	assert.ok(signals.typingRhythmVariance > 500, `Expected high variance, got ${signals.typingRhythmVariance}`);
});

test('typing rhythm variance uses only last 200 intervals', () => {
	const uniform = new Array(250).fill(100);
	// Overwrite last 10 with high values to create variance
	for (let i = 240; i < 250; i++) {
		uniform[i] = 5000;
	}
	const samples: ActivitySample[] = [
		{ timestamp: now, typed: 50, deleted: 0, fileSwitches: 0, undoRedo: 0 },
	];
	const signalsAll = summarizeFatigueSignals({
		samples,
		interKeyIntervalsMs: uniform,
		now,
		samplingWindowMinutes: 5,
	});
	// First 50 uniform values should be sliced off, so we get last 200 which includes the erratic ones
	assert.ok(signalsAll.typingRhythmVariance > 0);
});

// ============================================================
// summarizeFatigueSignals() — session duration
// ============================================================

test('session duration is 0 when sessionStartedAt is undefined', () => {
	const signals = summarizeFatigueSignals({
		samples: [],
		interKeyIntervalsMs: [],
		now,
		samplingWindowMinutes: 5,
	});

	assert.strictEqual(signals.sessionDurationMinutes, 0);
});

test('session duration is calculated correctly from sessionStartedAt', () => {
	const signals = summarizeFatigueSignals({
		samples: [],
		interKeyIntervalsMs: [],
		now,
		samplingWindowMinutes: 5,
		sessionStartedAt: now - 30 * 60000,
	});

	assert.strictEqual(signals.sessionDurationMinutes, 30);
});

// ============================================================
// summarizeFatigueSignals() — pause frequency
// ============================================================

test('pause frequency counts intervals >= 3000ms per window minute', () => {
	const samples: ActivitySample[] = [
		{ timestamp: now, typed: 50, deleted: 0, fileSwitches: 0, undoRedo: 0 },
	];
	// 3 pauses (>= 3000ms) over a 5-minute window = 0.6 per minute
	const signals = summarizeFatigueSignals({
		samples,
		interKeyIntervalsMs: [100, 3000, 200, 5000, 150, 4000],
		now,
		samplingWindowMinutes: 5,
	});

	assert.strictEqual(signals.pauseFrequency, 3 / 5);
});

test('pause frequency is 0 when all intervals are short', () => {
	const samples: ActivitySample[] = [
		{ timestamp: now, typed: 50, deleted: 0, fileSwitches: 0, undoRedo: 0 },
	];
	const signals = summarizeFatigueSignals({
		samples,
		interKeyIntervalsMs: [100, 200, 150, 80],
		now,
		samplingWindowMinutes: 5,
	});

	assert.strictEqual(signals.pauseFrequency, 0);
});

// ============================================================
// summarizeFatigueSignals() — undo/redo rate
// ============================================================

test('undo/redo rate reflects ratio of undo/redo to total keystrokes', () => {
	const samples: ActivitySample[] = [
		{ timestamp: now, typed: 90, deleted: 10, fileSwitches: 0, undoRedo: 5 },
	];
	const signals = summarizeFatigueSignals({
		samples,
		interKeyIntervalsMs: [],
		now,
		samplingWindowMinutes: 5,
	});

	assert.strictEqual(signals.undoRedoRate, 5 / 100);
});

test('undo/redo rate is 0 when no undo/redo operations', () => {
	const samples: ActivitySample[] = [
		{ timestamp: now, typed: 100, deleted: 0, fileSwitches: 0, undoRedo: 0 },
	];
	const signals = summarizeFatigueSignals({
		samples,
		interKeyIntervalsMs: [],
		now,
		samplingWindowMinutes: 5,
	});

	assert.strictEqual(signals.undoRedoRate, 0);
});

// ============================================================
// summarizeFatigueSignals() — error diagnostic delta
// ============================================================

test('error diagnostic delta defaults to 0 when not provided', () => {
	const signals = summarizeFatigueSignals({
		samples: [],
		interKeyIntervalsMs: [],
		now,
		samplingWindowMinutes: 5,
	});

	assert.strictEqual(signals.errorDiagnosticDelta, 0);
});

test('error diagnostic delta is passed through when provided', () => {
	const signals = summarizeFatigueSignals({
		samples: [],
		interKeyIntervalsMs: [],
		now,
		samplingWindowMinutes: 5,
		errorDiagnosticDelta: 15,
	});

	assert.strictEqual(signals.errorDiagnosticDelta, 15);
});

// ============================================================
// summarizeFatigueSignals() — multi-sample aggregation
// ============================================================

test('signals aggregate across multiple samples in window', () => {
	const samples: ActivitySample[] = [
		{ timestamp: now - 2 * 60000, typed: 40, deleted: 10, fileSwitches: 1, undoRedo: 2 },
		{ timestamp: now - 60000, typed: 30, deleted: 5, fileSwitches: 2, undoRedo: 1 },
		{ timestamp: now, typed: 20, deleted: 5, fileSwitches: 0, undoRedo: 0 },
	];
	const signals = summarizeFatigueSignals({
		samples,
		interKeyIntervalsMs: [],
		now,
		samplingWindowMinutes: 5,
	});

	// Total typed: 90, deleted: 20, total keystrokes: 110
	assert.strictEqual(signals.sampleKeystrokes, 110);
	// Error rate: 20/110
	const expectedErrorRate = 20 / 110;
	assert.ok(Math.abs(signals.rollingErrorRate - expectedErrorRate) < 0.001);
	// Undo/redo rate: 3/110
	const expectedUndoRate = 3 / 110;
	assert.ok(Math.abs(signals.undoRedoRate - expectedUndoRate) < 0.001);
});

// ============================================================
// computeFatigueScore() — weighted scoring
// ============================================================

test('fatigue score is 0 when all signals are zero', () => {
	const signals: FatigueSignals = {
		rollingErrorRate: 0,
		typingRhythmVariance: 0,
		sessionDurationMinutes: 0,
		pauseFrequency: 0,
		undoRedoRate: 0,
		errorDiagnosticDelta: 0,
		sampleKeystrokes: 100,
	};

	assert.strictEqual(computeFatigueScore(signals, 50), 0);
});

test('fatigue score is capped at 100 even with extreme signals', () => {
	const signals: FatigueSignals = {
		rollingErrorRate: 1.0,
		typingRhythmVariance: 5000,
		sessionDurationMinutes: 300,
		pauseFrequency: 20,
		undoRedoRate: 0.5,
		errorDiagnosticDelta: 100,
		sampleKeystrokes: 100,
	};

	assert.strictEqual(computeFatigueScore(signals, 50), 100);
});

test('fatigue score weights: error rate has the largest weight (45)', () => {
	// Only error rate contributing, all others zero
	const signalsErrorOnly: FatigueSignals = {
		rollingErrorRate: 0.35, // at highWatermark = normalize to 1.0
		typingRhythmVariance: 0,
		sessionDurationMinutes: 0,
		pauseFrequency: 0,
		undoRedoRate: 0,
		errorDiagnosticDelta: 0,
		sampleKeystrokes: 100,
	};

	assert.strictEqual(computeFatigueScore(signalsErrorOnly, 50), 45);
});

test('fatigue score partial contribution: medium error rate gives proportional score', () => {
	const signals: FatigueSignals = {
		rollingErrorRate: 0.175, // half of 0.35 highWatermark = 0.5 normalized
		typingRhythmVariance: 0,
		sessionDurationMinutes: 0,
		pauseFrequency: 0,
		undoRedoRate: 0,
		errorDiagnosticDelta: 0,
		sampleKeystrokes: 100,
	};

	// 0.5 * 45 = 22.5, rounded = 23
	assert.strictEqual(computeFatigueScore(signals, 50), 23);
});

test('fatigue score includes session duration contribution at weight 15', () => {
	const signals: FatigueSignals = {
		rollingErrorRate: 0,
		typingRhythmVariance: 0,
		sessionDurationMinutes: 90, // at highWatermark = normalize to 1.0
		pauseFrequency: 0,
		undoRedoRate: 0,
		errorDiagnosticDelta: 0,
		sampleKeystrokes: 100,
	};

	assert.strictEqual(computeFatigueScore(signals, 50), 15);
});

test('fatigue score includes undo/redo at weight 10', () => {
	const signals: FatigueSignals = {
		rollingErrorRate: 0,
		typingRhythmVariance: 0,
		sessionDurationMinutes: 0,
		pauseFrequency: 0,
		undoRedoRate: 0.12, // at highWatermark = normalize to 1.0
		errorDiagnosticDelta: 0,
		sampleKeystrokes: 100,
	};

	assert.strictEqual(computeFatigueScore(signals, 50), 10);
});

test('fatigue score returns 0 when keystrokes below custom threshold', () => {
	const signals: FatigueSignals = {
		rollingErrorRate: 0.35,
		typingRhythmVariance: 1200,
		sessionDurationMinutes: 90,
		pauseFrequency: 4,
		undoRedoRate: 0.12,
		errorDiagnosticDelta: 20,
		sampleKeystrokes: 10, // below threshold of 20
	};

	assert.strictEqual(computeFatigueScore(signals, 20), 0);
});

test('fatigue score with default threshold (50) returns 0 for insufficient keystrokes', () => {
	const signals: FatigueSignals = {
		rollingErrorRate: 0.35,
		typingRhythmVariance: 1200,
		sessionDurationMinutes: 90,
		pauseFrequency: 4,
		undoRedoRate: 0.12,
		errorDiagnosticDelta: 20,
		sampleKeystrokes: 49,
	};

	assert.strictEqual(computeFatigueScore(signals), 0);
});

test('fatigue score negative diagnostic delta is clamped to 0', () => {
	const signals: FatigueSignals = {
		rollingErrorRate: 0,
		typingRhythmVariance: 0,
		sessionDurationMinutes: 0,
		pauseFrequency: 0,
		undoRedoRate: 0,
		errorDiagnosticDelta: -10, // negative — should be Math.max(0, ...) = 0
		sampleKeystrokes: 100,
	};

	assert.strictEqual(computeFatigueScore(signals, 50), 0);
});

// ============================================================
// Integration: end-to-end fatigue scoring
// ============================================================

test('end-to-end: moderate fatigue scenario produces reasonable score', () => {
	const samples: ActivitySample[] = [
		{ timestamp: now - 2 * 60000, typed: 60, deleted: 15, fileSwitches: 3, undoRedo: 2 },
		{ timestamp: now - 60000, typed: 50, deleted: 12, fileSwitches: 2, undoRedo: 1 },
		{ timestamp: now, typed: 40, deleted: 10, fileSwitches: 1, undoRedo: 1 },
	];
	const signals = summarizeFatigueSignals({
		samples,
		interKeyIntervalsMs: [100, 200, 3500, 120, 150, 4000, 110, 3100],
		now,
		samplingWindowMinutes: 5,
		sessionStartedAt: now - 45 * 60000,
	});

	const score = computeFatigueScore(signals, 50);
	// Should be non-zero and reasonable (not 0, not 100)
	assert.ok(score > 0, `Expected positive score, got ${score}`);
	assert.ok(score < 100, `Expected score under 100, got ${score}`);
});

test('end-to-end: zero activity scenario produces score of 0', () => {
	const signals = summarizeFatigueSignals({
		samples: [],
		interKeyIntervalsMs: [],
		now,
		samplingWindowMinutes: 5,
	});

	assert.strictEqual(computeFatigueScore(signals, 50), 0);
});

test('end-to-end: heavy fatigue scenario produces high score', () => {
	const samples: ActivitySample[] = [
		{ timestamp: now, typed: 30, deleted: 30, fileSwitches: 10, undoRedo: 10 },
		{ timestamp: now - 30000, typed: 20, deleted: 25, fileSwitches: 5, undoRedo: 8 },
	];
	const signals = summarizeFatigueSignals({
		samples,
		interKeyIntervalsMs: [50, 5000, 80, 6000, 100, 4500, 200, 7000],
		now,
		samplingWindowMinutes: 5,
		sessionStartedAt: now - 120 * 60000,
		errorDiagnosticDelta: 25,
	});

	const score = computeFatigueScore(signals, 50);
	assert.ok(score > 50, `Expected high fatigue score, got ${score}`);
});

// ============================================================
// Summary
// ============================================================

console.log(`\n${'='.repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
console.log(`${'='.repeat(50)}`);

if (failed > 0) {
	process.exit(1);
}
