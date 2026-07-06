export interface ActivitySample {
	timestamp: number;
	typed: number;
	deleted: number;
	fileSwitches: number;
	undoRedo: number;
}

export interface FatigueSignals {
	rollingErrorRate: number;
	typingRhythmVariance: number;
	sessionDurationMinutes: number;
	pauseFrequency: number;
	undoRedoRate: number;
	errorDiagnosticDelta: number;
	sampleKeystrokes: number;
}

export interface SignalSummaryInput {
	samples: ActivitySample[];
	interKeyIntervalsMs: number[];
	now: number;
	samplingWindowMinutes: number;
	sessionStartedAt?: number;
	errorDiagnosticDelta?: number;
}

export const DEFAULT_MINIMUM_KEYSTROKE_THRESHOLD = 50;
export const DEFAULT_SAMPLING_WINDOW_MINUTES = 5;
export const DEFAULT_IDLE_RESET_MINUTES = 5;

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function pruneSamples(samples: ActivitySample[], now: number, samplingWindowMinutes: number): ActivitySample[] {
	const windowMs = Math.max(1, samplingWindowMinutes) * 60 * 1000;
	return samples.filter(sample => now - sample.timestamp <= windowMs);
}

export function isIdle(now: number, lastActivityAt: number, idleResetMinutes: number): boolean {
	return now - lastActivityAt > Math.max(1, idleResetMinutes) * 60 * 1000;
}

export function isWithinWorkday(date: Date, startHour: number, endHour: number): boolean {
	const hour = date.getHours();
	const start = clamp(Math.floor(startHour), 0, 23);
	const end = clamp(Math.floor(endHour), 0, 23);

	if (start === end) {
		return true;
	}

	if (start < end) {
		return hour >= start && hour < end;
	}

	return hour >= start || hour < end;
}

export function summarizeFatigueSignals(input: SignalSummaryInput): FatigueSignals {
	const samples = pruneSamples(input.samples, input.now, input.samplingWindowMinutes);
	const totals = samples.reduce(
		(acc, sample) => ({
			typed: acc.typed + sample.typed,
			deleted: acc.deleted + sample.deleted,
			undoRedo: acc.undoRedo + sample.undoRedo,
		}),
		{ typed: 0, deleted: 0, undoRedo: 0 },
	);

	const sampleKeystrokes = totals.typed + totals.deleted;
	const rollingErrorRate = sampleKeystrokes > 0 ? totals.deleted / sampleKeystrokes : 0;
	const undoRedoRate = sampleKeystrokes > 0 ? totals.undoRedo / sampleKeystrokes : 0;
	const recentIntervals = input.interKeyIntervalsMs.slice(-200);

	return {
		rollingErrorRate,
		typingRhythmVariance: standardDeviation(recentIntervals),
		sessionDurationMinutes: input.sessionStartedAt ? Math.max(0, (input.now - input.sessionStartedAt) / 60000) : 0,
		pauseFrequency: countPauses(recentIntervals) / Math.max(1, input.samplingWindowMinutes),
		undoRedoRate,
		errorDiagnosticDelta: input.errorDiagnosticDelta ?? 0,
		sampleKeystrokes,
	};
}

export function computeFatigueScore(
	signals: FatigueSignals,
	minimumKeystrokeThreshold = DEFAULT_MINIMUM_KEYSTROKE_THRESHOLD,
): number {
	if (signals.sampleKeystrokes < minimumKeystrokeThreshold) {
		return 0;
	}

	const weightedScore =
		normalize(signals.rollingErrorRate, 0.35) * 45 +
		normalize(signals.typingRhythmVariance, 1200) * 15 +
		normalize(signals.sessionDurationMinutes, 90) * 15 +
		normalize(signals.pauseFrequency, 4) * 10 +
		normalize(signals.undoRedoRate, 0.12) * 10 +
		normalize(Math.max(0, signals.errorDiagnosticDelta), 20) * 5;

	return Math.round(clamp(weightedScore, 0, 100));
}

function normalize(value: number, highWatermark: number): number {
	if (highWatermark <= 0) {
		return 0;
	}

	return clamp(value / highWatermark, 0, 1);
}

function standardDeviation(values: number[]): number {
	if (values.length < 2) {
		return 0;
	}

	const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
	const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
	return Math.sqrt(variance);
}

function countPauses(values: number[]): number {
	return values.filter(value => value >= 3000).length;
}
