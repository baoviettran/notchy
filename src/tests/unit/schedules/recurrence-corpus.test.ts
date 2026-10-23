import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { nextDueDate, type ScheduleFrequency } from '$lib/utils/schedule_next_due';
it('matches the recurrence corpus shared with the native posting engine', () => {
	const cases = JSON.parse(readFileSync('src-tauri/tests/fixtures/recurrence-cases.json', 'utf8')) as { date: string; frequency: ScheduleFrequency; next: string }[];
	for (const c of cases) expect(nextDueDate(c.date, c.frequency)).toBe(c.next);
});
it('rejects recurrence beyond the supported four-digit year range', () => {
	expect(() => nextDueDate('9999-12-31', 'monthly')).toThrow();
});
