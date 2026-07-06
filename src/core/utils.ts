/**
 * Pure utility functions extracted from extension.ts for testability.
 * No VS Code API dependencies.
 */

// ─── Interfaces ─────────────────────────────────────────────

export interface FatigueHistoryPoint {
	timestamp: number;
	time: string;
	score: number;
	typed: number;
	deleted: number;
}

// ─── HTML Escaping ──────────────────────────────────────────

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

// ─── History Normalization ──────────────────────────────────

/**
 * Validates and repairs history data loaded from storage.
 * Strips entries missing required fields, backfills optional fields with defaults.
 */
export function normalizeHistory(points: FatigueHistoryPoint[], fallbackTimestamp?: number): FatigueHistoryPoint[] {
	const now = fallbackTimestamp ?? Date.now();
	return points
		.filter(point => point != null && typeof point === 'object' && !Array.isArray(point))
		.filter(point => typeof point.time === 'string' && typeof point.score === 'number')
		.map(point => ({
			timestamp: typeof point.timestamp === 'number' ? point.timestamp : now,
			time: point.time,
			score: point.score,
			typed: typeof point.typed === 'number' ? point.typed : 0,
			deleted: typeof point.deleted === 'number' ? point.deleted : 0,
		}));
}

// ─── History Trimming ───────────────────────────────────────

/**
 * Purges history entries older than `dataRetentionDays` and caps the total
 * number of points to prevent unbounded growth.
 */
export function trimHistory(
	history: FatigueHistoryPoint[],
	now: number,
	dataRetentionDays: number,
): FatigueHistoryPoint[] {
	const maxAgeMs = dataRetentionDays * 24 * 60 * 60 * 1000;
	const oldestAllowed = now - maxAgeMs;
	const maxPoints = Math.max(60, dataRetentionDays * 2880);
	return history
		.filter(point => point.timestamp >= oldestAllowed)
		.slice(-maxPoints);
}

// ─── Config Parsing Helpers ─────────────────────────────────

/**
 * A minimal interface matching the shape of vscode.WorkspaceConfiguration.get().
 * Allows unit testing without the VS Code API.
 */
export interface ConfigGetter {
	get<T>(key: string, defaultValue: T): T;
}

export function getNumber(
	config: ConfigGetter,
	key: string,
	defaultValue: number,
	min: number,
	max: number,
): number {
	const value = config.get<number>(key, defaultValue);
	return Number.isFinite(value) ? Math.round(Math.min(max, Math.max(min, value))) : defaultValue;
}

export function getStringArray(config: ConfigGetter, key: string): string[] {
	const value = config.get<string[]>(key, []);
	return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
}

export function getEnum<T extends string>(
	config: ConfigGetter,
	key: string,
	defaultValue: T,
	allowedValues: readonly T[],
): T {
	const value = config.get<string>(key, defaultValue);
	return allowedValues.includes(value as T) ? value as T : defaultValue;
}
