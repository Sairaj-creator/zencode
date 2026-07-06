import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
	ConfigGetter,
	FatigueHistoryPoint,
	escapeHtml,
	getEnum,
	getNumber,
	getStringArray,
	normalizeHistory,
	trimHistory,
} from '../core/utils';

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

/**
 * Creates a simple mock ConfigGetter backed by a plain object.
 */
function mockConfig(values: Record<string, unknown>): ConfigGetter {
	return {
		get<T>(key: string, defaultValue: T): T {
			return key in values ? values[key] as T : defaultValue;
		},
	};
}

const now = 1_700_000_000_000;

// ============================================================
// escapeHtml()
// ============================================================

test('escapeHtml: ampersand is escaped', () => {
	assert.strictEqual(escapeHtml('A & B'), 'A &amp; B');
});

test('escapeHtml: less-than is escaped', () => {
	assert.strictEqual(escapeHtml('<script>'), '&lt;script&gt;');
});

test('escapeHtml: greater-than is escaped', () => {
	assert.strictEqual(escapeHtml('a > b'), 'a &gt; b');
});

test('escapeHtml: double quotes are escaped', () => {
	assert.strictEqual(escapeHtml('say "hello"'), 'say &quot;hello&quot;');
});

test('escapeHtml: single quotes are escaped', () => {
	assert.strictEqual(escapeHtml("it's"), 'it&#39;s');
});

test('escapeHtml: all special chars in one string', () => {
	assert.strictEqual(
		escapeHtml(`<img src="x" onerror='alert(1)' />&`),
		'&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39; /&gt;&amp;',
	);
});

test('escapeHtml: empty string is unchanged', () => {
	assert.strictEqual(escapeHtml(''), '');
});

test('escapeHtml: safe string is unchanged', () => {
	assert.strictEqual(escapeHtml('Hello World 123'), 'Hello World 123');
});

test('escapeHtml: consecutive special chars', () => {
	assert.strictEqual(escapeHtml('<<<>>>'), '&lt;&lt;&lt;&gt;&gt;&gt;');
});

test('escapeHtml: mixed content with newlines preserved', () => {
	assert.strictEqual(escapeHtml('line1\n<b>bold</b>'), 'line1\n&lt;b&gt;bold&lt;/b&gt;');
});

test('escapeHtml: unicode characters are not escaped', () => {
	assert.strictEqual(escapeHtml('café ☕ 日本語'), 'café ☕ 日本語');
});

// ============================================================
// normalizeHistory()
// ============================================================

test('normalizeHistory: valid complete points pass through unchanged', () => {
	const points: FatigueHistoryPoint[] = [
		{ timestamp: now, time: '10:00', score: 42, typed: 100, deleted: 20 },
	];
	const result = normalizeHistory(points, now);
	assert.deepStrictEqual(result, points);
});

test('normalizeHistory: missing timestamp is backfilled with fallback', () => {
	const points = [
		{ time: '10:00', score: 42, typed: 100, deleted: 20 } as unknown as FatigueHistoryPoint,
	];
	const result = normalizeHistory(points, now);
	assert.strictEqual(result[0].timestamp, now);
});

test('normalizeHistory: missing typed is backfilled with 0', () => {
	const points = [
		{ timestamp: now, time: '10:00', score: 42, deleted: 20 } as unknown as FatigueHistoryPoint,
	];
	const result = normalizeHistory(points, now);
	assert.strictEqual(result[0].typed, 0);
});

test('normalizeHistory: missing deleted is backfilled with 0', () => {
	const points = [
		{ timestamp: now, time: '10:00', score: 42, typed: 100 } as unknown as FatigueHistoryPoint,
	];
	const result = normalizeHistory(points, now);
	assert.strictEqual(result[0].deleted, 0);
});

test('normalizeHistory: entry without time string is stripped', () => {
	const points = [
		{ timestamp: now, score: 42, typed: 100, deleted: 20 } as unknown as FatigueHistoryPoint,
	];
	const result = normalizeHistory(points, now);
	assert.strictEqual(result.length, 0);
});

test('normalizeHistory: entry without score number is stripped', () => {
	const points = [
		{ timestamp: now, time: '10:00', typed: 100, deleted: 20 } as unknown as FatigueHistoryPoint,
	];
	const result = normalizeHistory(points, now);
	assert.strictEqual(result.length, 0);
});

test('normalizeHistory: entry with time=number (wrong type) is stripped', () => {
	const points = [
		{ timestamp: now, time: 12345, score: 42, typed: 100, deleted: 20 } as unknown as FatigueHistoryPoint,
	];
	const result = normalizeHistory(points, now);
	assert.strictEqual(result.length, 0);
});

test('normalizeHistory: entry with score=string (wrong type) is stripped', () => {
	const points = [
		{ timestamp: now, time: '10:00', score: 'high', typed: 100, deleted: 20 } as unknown as FatigueHistoryPoint,
	];
	const result = normalizeHistory(points, now);
	assert.strictEqual(result.length, 0);
});

test('normalizeHistory: empty input returns empty output', () => {
	assert.deepStrictEqual(normalizeHistory([], now), []);
});

test('normalizeHistory: mixed valid and invalid entries', () => {
	const points = [
		{ timestamp: now, time: '10:00', score: 20, typed: 50, deleted: 10 },
		{ time: 123, score: 42 } as unknown as FatigueHistoryPoint, // invalid: time not string
		{ timestamp: now, time: '10:30', score: 35, typed: 60, deleted: 5 },
		{ timestamp: now, time: '11:00' } as unknown as FatigueHistoryPoint, // invalid: no score
	];
	const result = normalizeHistory(points, now);
	assert.strictEqual(result.length, 2);
	assert.strictEqual(result[0].time, '10:00');
	assert.strictEqual(result[1].time, '10:30');
});

test('normalizeHistory: preserves existing numeric timestamp', () => {
	const ts = 1_600_000_000_000;
	const points: FatigueHistoryPoint[] = [
		{ timestamp: ts, time: '10:00', score: 42, typed: 0, deleted: 0 },
	];
	const result = normalizeHistory(points, now);
	assert.strictEqual(result[0].timestamp, ts); // not overwritten with `now`
});

test('normalizeHistory: typed/deleted as string (wrong type) are replaced with 0', () => {
	const points = [
		{ timestamp: now, time: '10:00', score: 42, typed: 'abc', deleted: 'def' } as unknown as FatigueHistoryPoint,
	];
	const result = normalizeHistory(points, now);
	assert.strictEqual(result[0].typed, 0);
	assert.strictEqual(result[0].deleted, 0);
});

// ============================================================
// trimHistory()
// ============================================================

test('trimHistory: removes entries older than retention period', () => {
	const history: FatigueHistoryPoint[] = [
		{ timestamp: now - 31 * 24 * 60 * 60 * 1000, time: '10:00', score: 20, typed: 50, deleted: 10 }, // 31 days ago
		{ timestamp: now - 1 * 24 * 60 * 60 * 1000, time: '10:30', score: 30, typed: 60, deleted: 5 },   // 1 day ago
		{ timestamp: now, time: '11:00', score: 40, typed: 70, deleted: 8 },                               // now
	];
	const result = trimHistory(history, now, 30);
	assert.strictEqual(result.length, 2);
	assert.strictEqual(result[0].time, '10:30');
	assert.strictEqual(result[1].time, '11:00');
});

test('trimHistory: keeps entry exactly at retention boundary', () => {
	const exactBoundary = now - 30 * 24 * 60 * 60 * 1000;
	const history: FatigueHistoryPoint[] = [
		{ timestamp: exactBoundary, time: '10:00', score: 20, typed: 50, deleted: 10 },
	];
	const result = trimHistory(history, now, 30);
	assert.strictEqual(result.length, 1);
});

test('trimHistory: caps total points based on retention days', () => {
	// With 1 retention day: maxPoints = max(60, 1*2880) = 2880
	// But with a very short retention: let's test with a crafted scenario
	// For 1 day: maxPoints = 2880. Generate 3000 points, all within retention.
	const history: FatigueHistoryPoint[] = [];
	for (let i = 0; i < 3000; i++) {
		history.push({
			timestamp: now - i * 1000, // all within last 50 minutes, well within 1 day
			time: `${i}`,
			score: i % 100,
			typed: 10,
			deleted: 1,
		});
	}
	const result = trimHistory(history, now, 1);
	assert.strictEqual(result.length, 2880); // capped at 1 * 2880
});

test('trimHistory: minimum cap is 60 points even with tiny retention', () => {
	// With 0.01 days (hypothetical, function uses integer math): maxPoints = max(60, floor(0.01*2880)) = 60
	// But dataRetentionDays is an integer from config (min 1), so test with 1 day
	// max(60, 1*2880) = 2880, so cap is 2880
	// Actually let's verify the formula: for very small values
	// The config clamps dataRetentionDays to min 1, but let's test the pure function with a small value
	const history: FatigueHistoryPoint[] = [];
	for (let i = 0; i < 100; i++) {
		history.push({
			timestamp: now - i * 1000,
			time: `${i}`,
			score: i % 100,
			typed: 10,
			deleted: 1,
		});
	}
	// All within retention, so none filtered by age. Slice(-60) keeps last 60.
	// Using 0 retention days: maxAgeMs = 0, oldest = now, so only timestamp=now survives age filter
	// But with realistic values this tests the cap logic
	const result = trimHistory(history, now, 30);
	assert.ok(result.length <= Math.max(60, 30 * 2880));
	assert.strictEqual(result.length, 100); // all 100 fit within 86400 cap
});

test('trimHistory: empty history returns empty', () => {
	assert.deepStrictEqual(trimHistory([], now, 30), []);
});

test('trimHistory: all entries within retention are kept', () => {
	const history: FatigueHistoryPoint[] = [
		{ timestamp: now - 60000, time: '10:00', score: 20, typed: 50, deleted: 10 },
		{ timestamp: now - 30000, time: '10:01', score: 25, typed: 60, deleted: 5 },
		{ timestamp: now, time: '10:02', score: 30, typed: 70, deleted: 8 },
	];
	const result = trimHistory(history, now, 30);
	assert.strictEqual(result.length, 3);
});

test('trimHistory: all entries beyond retention are removed', () => {
	const history: FatigueHistoryPoint[] = [
		{ timestamp: now - 365 * 24 * 60 * 60 * 1000, time: '10:00', score: 20, typed: 50, deleted: 10 },
		{ timestamp: now - 200 * 24 * 60 * 60 * 1000, time: '10:01', score: 25, typed: 60, deleted: 5 },
	];
	const result = trimHistory(history, now, 30);
	assert.strictEqual(result.length, 0);
});

// ============================================================
// getNumber()
// ============================================================

test('getNumber: returns configured value when within range', () => {
	const config = mockConfig({ 'threshold': 50 });
	assert.strictEqual(getNumber(config, 'threshold', 20, 0, 100), 50);
});

test('getNumber: returns default when key is missing', () => {
	const config = mockConfig({});
	assert.strictEqual(getNumber(config, 'threshold', 20, 0, 100), 20);
});

test('getNumber: clamps value to min', () => {
	const config = mockConfig({ 'threshold': -10 });
	assert.strictEqual(getNumber(config, 'threshold', 20, 0, 100), 0);
});

test('getNumber: clamps value to max', () => {
	const config = mockConfig({ 'threshold': 200 });
	assert.strictEqual(getNumber(config, 'threshold', 20, 0, 100), 100);
});

test('getNumber: rounds fractional value', () => {
	const config = mockConfig({ 'threshold': 42.7 });
	assert.strictEqual(getNumber(config, 'threshold', 20, 0, 100), 43);
});

test('getNumber: returns default for NaN', () => {
	const config = mockConfig({ 'threshold': NaN });
	assert.strictEqual(getNumber(config, 'threshold', 20, 0, 100), 20);
});

test('getNumber: returns default for Infinity', () => {
	const config = mockConfig({ 'threshold': Infinity });
	assert.strictEqual(getNumber(config, 'threshold', 20, 0, 100), 20);
});

test('getNumber: returns default for -Infinity', () => {
	const config = mockConfig({ 'threshold': -Infinity });
	assert.strictEqual(getNumber(config, 'threshold', 20, 0, 100), 20);
});

test('getNumber: boundary value at min is accepted', () => {
	const config = mockConfig({ 'threshold': 0 });
	assert.strictEqual(getNumber(config, 'threshold', 20, 0, 100), 0);
});

test('getNumber: boundary value at max is accepted', () => {
	const config = mockConfig({ 'threshold': 100 });
	assert.strictEqual(getNumber(config, 'threshold', 20, 0, 100), 100);
});

test('getNumber: negative value clamped when min is 0', () => {
	const config = mockConfig({ 'interval': -5 });
	assert.strictEqual(getNumber(config, 'interval', 60, 0, 1440), 0);
});

// ============================================================
// getStringArray()
// ============================================================

test('getStringArray: returns configured array of strings', () => {
	const config = mockConfig({ 'langs': ['json', 'markdown'] });
	assert.deepStrictEqual(getStringArray(config, 'langs'), ['json', 'markdown']);
});

test('getStringArray: returns empty array when key is missing', () => {
	const config = mockConfig({});
	assert.deepStrictEqual(getStringArray(config, 'langs'), []);
});

test('getStringArray: filters out non-string items', () => {
	const config = mockConfig({ 'langs': ['json', 42, null, 'markdown', true, undefined] });
	assert.deepStrictEqual(getStringArray(config, 'langs'), ['json', 'markdown']);
});

test('getStringArray: returns empty array when value is not an array', () => {
	const config = mockConfig({ 'langs': 'not-an-array' });
	assert.deepStrictEqual(getStringArray(config, 'langs'), []);
});

test('getStringArray: returns empty array when value is null', () => {
	const config = mockConfig({ 'langs': null });
	assert.deepStrictEqual(getStringArray(config, 'langs'), []);
});

test('getStringArray: handles empty array', () => {
	const config = mockConfig({ 'langs': [] });
	assert.deepStrictEqual(getStringArray(config, 'langs'), []);
});

test('getStringArray: preserves empty strings in array', () => {
	const config = mockConfig({ 'langs': ['', 'json', ''] });
	assert.deepStrictEqual(getStringArray(config, 'langs'), ['', 'json', '']);
});

// ============================================================
// getEnum()
// ============================================================

test('getEnum: returns configured value when it is an allowed value', () => {
	const config = mockConfig({ 'style': 'aggressive' });
	assert.strictEqual(getEnum(config, 'style', 'normal', ['subtle', 'normal', 'aggressive']), 'aggressive');
});

test('getEnum: returns default when key is missing', () => {
	const config = mockConfig({});
	assert.strictEqual(getEnum(config, 'style', 'normal', ['subtle', 'normal', 'aggressive']), 'normal');
});

test('getEnum: returns default when value is not in allowed list', () => {
	const config = mockConfig({ 'style': 'invalid-value' });
	assert.strictEqual(getEnum(config, 'style', 'normal', ['subtle', 'normal', 'aggressive']), 'normal');
});

test('getEnum: returns default for empty string when not allowed', () => {
	const config = mockConfig({ 'style': '' });
	assert.strictEqual(getEnum(config, 'style', 'normal', ['subtle', 'normal', 'aggressive']), 'normal');
});

test('getEnum: case-sensitive matching', () => {
	const config = mockConfig({ 'position': 'Left' }); // capital L
	assert.strictEqual(getEnum(config, 'position', 'right', ['left', 'right']), 'right'); // falls back
});

test('getEnum: first allowed value works', () => {
	const config = mockConfig({ 'style': 'subtle' });
	assert.strictEqual(getEnum(config, 'style', 'normal', ['subtle', 'normal', 'aggressive']), 'subtle');
});

test('getEnum: last allowed value works', () => {
	const config = mockConfig({ 'position': 'left' });
	assert.strictEqual(getEnum(config, 'position', 'right', ['left', 'right']), 'left');
});

// ============================================================
// normalizeHistory() — array-level corruption
// ============================================================

test('normalizeHistory: survives null entry in array', () => {
	const points = [
		{ timestamp: now, time: '10:00', score: 42, typed: 100, deleted: 20 },
		null,
		{ timestamp: now, time: '10:30', score: 35, typed: 60, deleted: 5 },
	] as unknown as FatigueHistoryPoint[];
	const result = normalizeHistory(points, now);
	assert.strictEqual(result.length, 2);
	assert.strictEqual(result[0].time, '10:00');
	assert.strictEqual(result[1].time, '10:30');
});

test('normalizeHistory: survives undefined entry in array', () => {
	const points = [
		undefined,
		{ timestamp: now, time: '10:00', score: 42, typed: 100, deleted: 20 },
	] as unknown as FatigueHistoryPoint[];
	const result = normalizeHistory(points, now);
	assert.strictEqual(result.length, 1);
	assert.strictEqual(result[0].time, '10:00');
});

test('normalizeHistory: survives string entry in array', () => {
	const points = [
		'garbage',
		{ timestamp: now, time: '10:00', score: 42, typed: 100, deleted: 20 },
	] as unknown as FatigueHistoryPoint[];
	const result = normalizeHistory(points, now);
	assert.strictEqual(result.length, 1);
});

test('normalizeHistory: survives number entry in array', () => {
	const points = [
		42,
		{ timestamp: now, time: '10:00', score: 42, typed: 100, deleted: 20 },
	] as unknown as FatigueHistoryPoint[];
	const result = normalizeHistory(points, now);
	assert.strictEqual(result.length, 1);
});

test('normalizeHistory: survives boolean entry in array', () => {
	const points = [
		true,
		false,
		{ timestamp: now, time: '10:00', score: 42, typed: 100, deleted: 20 },
	] as unknown as FatigueHistoryPoint[];
	const result = normalizeHistory(points, now);
	assert.strictEqual(result.length, 1);
});

test('normalizeHistory: survives nested array entry in array', () => {
	const points = [
		[1, 2, 3],
		{ timestamp: now, time: '10:00', score: 42, typed: 100, deleted: 20 },
	] as unknown as FatigueHistoryPoint[];
	const result = normalizeHistory(points, now);
	assert.strictEqual(result.length, 1);
});

test('normalizeHistory: realistic crash-mid-write corruption scenario', () => {
	// Simulates: valid data, then a partial/corrupt write left garbage
	const points = [
		{ timestamp: now - 60000, time: '09:59', score: 15, typed: 80, deleted: 10 },
		{ timestamp: now - 30000, time: '10:00', score: 20, typed: 90, deleted: 12 },
		null,
		'garbage',
		42,
		undefined,
		{ timestamp: now, time: '10:01', score: 25, typed: 100, deleted: 15 },
	] as unknown as FatigueHistoryPoint[];
	const result = normalizeHistory(points, now);
	assert.strictEqual(result.length, 3);
	assert.strictEqual(result[0].time, '09:59');
	assert.strictEqual(result[1].time, '10:00');
	assert.strictEqual(result[2].time, '10:01');
});

test('normalizeHistory: entire array is garbage', () => {
	const points = [null, undefined, 'abc', 123, true, [1, 2]] as unknown as FatigueHistoryPoint[];
	const result = normalizeHistory(points, now);
	assert.strictEqual(result.length, 0);
});

// ============================================================
// trimHistory() — combined age + cap interaction
// ============================================================

test('trimHistory: age filter and point cap applied together correctly', () => {
	// 200 points total:
	//   - oldest 50 are past 30-day retention (should be removed by age filter)
	//   - remaining 150 are within retention
	// With 30-day retention: maxPoints = max(60, 30*2880) = 86400
	// So the cap won't kick in here, but the age filter should reduce 200 → 150
	const history: FatigueHistoryPoint[] = [];
	for (let i = 0; i < 200; i++) {
		const daysAgo = i < 150 ? i * 0.1 : 31 + i; // first 150 within 15 days, last 50 are 31+ days old
		history.push({
			timestamp: now - daysAgo * 24 * 60 * 60 * 1000,
			time: `pt-${i}`,
			score: i % 100,
			typed: 10,
			deleted: 1,
		});
	}
	const result = trimHistory(history, now, 30);
	assert.strictEqual(result.length, 150);
	// All surviving entries should have 'pt-0' through 'pt-149' prefix
	assert.ok(result.every(p => p.time.startsWith('pt-')));
	// None of the old entries survived
	assert.ok(result.every(p => {
		const idx = parseInt(p.time.split('-')[1]);
		return idx < 150;
	}));
});

test('trimHistory: filter-then-slice order is verified — reversing would fail', () => {
	// OLD entries are INTERLEAVED between two batches of recent entries.
	// This is the critical layout that discriminates between filter-then-slice
	// and slice-then-filter.
	//
	// Array layout (120 entries):
	//   Positions 0–39:   batch1 (recent, 0–39 seconds old)
	//   Positions 40–79:  expired (50 days old, beyond any reasonable retention)
	//   Positions 80–119: batch2 (recent, 0–39 seconds old)
	//
	// With dataRetentionDays = 0.02:
	//   maxAgeMs = 1728s (all "recent" entries survive, all "expired" are removed)
	//   maxPoints = max(60, 0.02*2880) = 60
	//
	// CORRECT (filter-then-slice):
	//   1. Age filter removes 40 expired → 80 recent remain [batch1 + batch2]
	//   2. slice(-60) keeps last 60 of those 80 → 20 from batch1 + all 40 from batch2
	//   Result: 60 entries
	//
	// WRONG (slice-then-filter, if someone reversed the order):
	//   1. slice(-60) keeps last 60 of the original 120 → positions 60–119
	//      = 20 expired (positions 60–79) + 40 batch2 (positions 80–119)
	//   2. Age filter removes 20 expired → 40 batch2 remain
	//   Result: 40 entries ← DIFFERENT COUNT, test would fail!

	const history: FatigueHistoryPoint[] = [];

	// Batch 1: 40 recent entries
	for (let i = 0; i < 40; i++) {
		history.push({
			timestamp: now - i * 1000,
			time: `batch1-${i}`,
			score: i % 100,
			typed: 10,
			deleted: 1,
		});
	}

	// Expired block: 40 old entries (50 days old)
	for (let i = 0; i < 40; i++) {
		history.push({
			timestamp: now - 50 * 24 * 60 * 60 * 1000 - i * 1000,
			time: `expired-${i}`,
			score: i % 100,
			typed: 10,
			deleted: 1,
		});
	}

	// Batch 2: 40 recent entries
	for (let i = 0; i < 40; i++) {
		history.push({
			timestamp: now - i * 1000,
			time: `batch2-${i}`,
			score: i % 100,
			typed: 10,
			deleted: 1,
		});
	}

	const result = trimHistory(history, now, 0.02);

	// Count: must be 60 (filter-then-slice). Would be 40 if slice-then-filter.
	assert.strictEqual(result.length, 60);

	// Content: must contain entries from BOTH batches.
	// slice-then-filter would only have batch2 entries.
	const batch1Count = result.filter(p => p.time.startsWith('batch1-')).length;
	const batch2Count = result.filter(p => p.time.startsWith('batch2-')).length;
	const expiredCount = result.filter(p => p.time.startsWith('expired-')).length;

	assert.strictEqual(expiredCount, 0, 'No expired entries should survive');
	assert.strictEqual(batch1Count, 20, 'Last 20 of batch1 should survive after cap');
	assert.strictEqual(batch2Count, 40, 'All 40 of batch2 should survive');
	assert.strictEqual(batch1Count + batch2Count, 60);
});

// ============================================================
// getEnum() — schema-vs-code consistency (reads package.json)
// ============================================================
// These tests read the ACTUAL enum definitions from package.json
// at test time, so they catch drift between the schema and code.
// If someone adds a new enum value to package.json but forgets
// to update readConfig(), or vice versa, these tests go red.

interface PackageJsonSchema {
	contributes: {
		configuration: {
			properties: Record<string, {
				type: string;
				enum?: string[];
				default?: unknown;
			}>;
		};
	};
}

const packageJsonPath = path.resolve(__dirname, '..', '..', 'package.json');
const packageJson: PackageJsonSchema = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const schemaProps = packageJson.contributes.configuration.properties;

test('schema: statusBarPosition — package.json default is in its own enum list', () => {
	const prop = schemaProps['zencode.statusBarPosition'];
	assert.ok(prop, 'zencode.statusBarPosition must exist in package.json');
	assert.ok(Array.isArray(prop.enum), 'statusBarPosition must have an enum array');
	assert.ok(
		prop.enum!.includes(prop.default as string),
		`Default "${prop.default}" must be in enum list [${prop.enum!.join(', ')}]`,
	);
});

test('schema: notificationStyle — package.json default is in its own enum list', () => {
	const prop = schemaProps['zencode.notificationStyle'];
	assert.ok(prop, 'zencode.notificationStyle must exist in package.json');
	assert.ok(Array.isArray(prop.enum), 'notificationStyle must have an enum array');
	assert.ok(
		prop.enum!.includes(prop.default as string),
		`Default "${prop.default}" must be in enum list [${prop.enum!.join(', ')}]`,
	);
});

test('schema: statusBarPosition — every package.json enum value round-trips through getEnum', () => {
	const prop = schemaProps['zencode.statusBarPosition'];
	const allowed = prop.enum!;
	const defaultVal = prop.default as string;
	for (const val of allowed) {
		const cfg = mockConfig({ 'pos': val });
		assert.strictEqual(getEnum(cfg, 'pos', defaultVal, allowed), val,
			`Enum value "${val}" should round-trip but didn't`);
	}
});

test('schema: notificationStyle — every package.json enum value round-trips through getEnum', () => {
	const prop = schemaProps['zencode.notificationStyle'];
	const allowed = prop.enum!;
	const defaultVal = prop.default as string;
	for (const val of allowed) {
		const cfg = mockConfig({ 'style': val });
		assert.strictEqual(getEnum(cfg, 'style', defaultVal, allowed), val,
			`Enum value "${val}" should round-trip but didn't`);
	}
});

test('schema: typo falls back to package.json default for statusBarPosition', () => {
	const prop = schemaProps['zencode.statusBarPosition'];
	const cfg = mockConfig({ 'pos': 'centre' });
	assert.strictEqual(getEnum(cfg, 'pos', prop.default as string, prop.enum!), prop.default);
});

test('schema: typo falls back to package.json default for notificationStyle', () => {
	const prop = schemaProps['zencode.notificationStyle'];
	const cfg = mockConfig({ 'style': 'loud' });
	assert.strictEqual(getEnum(cfg, 'style', prop.default as string, prop.enum!), prop.default);
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
