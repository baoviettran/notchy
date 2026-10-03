/**
 * Recurrence arithmetic for scheduled transactions.
 *
 * Pure by construction: the anchor date is an argument, so a test can pin a
 * sequence without freezing the clock, and the caller (`postDueSchedules`) owns
 * "today". The algorithm is the same civil-date conversion Rust uses in
 * `domains/civil_date.rs` — no library, no `Date`, no timezone surface.
 */
export type ScheduleFrequency = 'weekly' | 'biweekly' | 'monthly' | 'yearly';

interface CivilDate {
	year: number;
	month: number; // 1-12
	day: number; // 1-31
}

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIso(iso: string): CivilDate {
	const match = ISO_PATTERN.exec(iso);
	if (!match) throw new Error(`not an ISO date: ${iso}`);
	return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function formatIso({ year, month, day }: CivilDate): string {
	return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isLeapYear(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Days in a 1-based month. */
function daysInMonth(year: number, month: number): number {
	const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	return lengths[month - 1];
}

/** Hinnant's days-from-civil: days since 1970-01-01. */
function daysFromCivil({ year, month, day }: CivilDate): number {
	const y = month <= 2 ? year - 1 : year;
	const era = Math.floor((y >= 0 ? y : y - 399) / 400);
	const yoe = y - era * 400;
	const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
	const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
	return era * 146097 + doe - 719468;
}

/** Hinnant's civil-from-days: the inverse of `daysFromCivil`. */
function civilFromDays(days: number): CivilDate {
	const z = days + 719468;
	const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
	const doe = z - era * 146097;
	const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
	const y = yoe + era * 400;
	const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
	const mp = Math.floor((5 * doy + 2) / 153);
	const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
	const month = mp + (mp < 10 ? 3 : -9);
	return { year: month <= 2 ? y + 1 : y, month, day };
}

/** Shift a civil date by whole days, going through the day number. */
function addDays(date: CivilDate, days: number): CivilDate {
	return civilFromDays(daysFromCivil(date) + days);
}

/**
 * Add whole months, anchoring on the day-of-month and clamping to the target
 * month's length. Month arithmetic is done on `year*12 + month` so the carry
 * is a single division, never a chain of `if (month > 12)`.
 */
function addMonths(date: CivilDate, months: number): CivilDate {
	const absolute = date.year * 12 + (date.month - 1) + months;
	const year = Math.floor(absolute / 12);
	const month = (absolute % 12) + 1;
	return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

export function nextDueDate(from: string, frequency: ScheduleFrequency, interval = 1): string {
	const anchor = parseIso(from);
	switch (frequency) {
		case 'weekly':
			return formatIso(addDays(anchor, 7 * interval));
		case 'biweekly':
			return formatIso(addDays(anchor, 14 * interval));
		case 'monthly':
			return formatIso(addMonths(anchor, interval));
		case 'yearly':
			return formatIso(addMonths(anchor, 12 * interval));
	}
}

/**
 * How many steps `firstDueOnOrAfter` will take before giving up (~19 years of
 * weekly occurrences). A bound is required: the loop's exit condition depends
 * on dates the caller supplies, and an unbounded `while` is a hang waiting for
 * a malformed row.
 */
export const REANCHOR_MAX_STEPS = 1000;

/**
 * The first occurrence on or after `today`, for re-anchoring a schedule the user
 * re-enabled. Deliberately different from `nextDueDate`: stepping one occurrence
 * at a time exists so that re-enabling never retroactively posts a disabled
 * period. Returns `null` when the bound is hit, meaning "leave the stored date
 * alone" — the posting engine's catch-up cap is the backstop then.
 */
export function firstDueOnOrAfter(
	from: string,
	frequency: ScheduleFrequency,
	today: string
): string | null {
	let candidate = from;
	for (let step = 0; step < REANCHOR_MAX_STEPS; step += 1) {
		if (candidate >= today) return candidate;
		candidate = nextDueDate(candidate, frequency);
	}
	return null;
}
