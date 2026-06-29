import type { Locale } from './number_parse';
import * as m from '$lib/paraglide/messages';

/**
 * Formats an ISO date string for display.
 * vi-VN: dd/mm/yyyy
 * en-US: mm/dd/yyyy
 */
export function formatDate(isoDate: string, locale: Locale): string {
	const localeTag = locale === 'vi' ? 'vi-VN' : 'en-US';
	return new Intl.DateTimeFormat(localeTag, {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date(isoDate));
}

/**
 * Returns the local calendar date as a `YYYY-MM-DD` string. Date-only values
 * must be compared by local calendar day (not UTC) so a user viewing a
 * transaction "today" sees "Today" regardless of timezone.
 */
function localDateKey(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/**
 * Formats a date relative to today (Today, Yesterday, or full date).
 *
 * `isoDate` is a date-only `YYYY-MM-DD` string (no time component), as stored
 * throughout the app. Comparison is by local calendar day so the result is
 * stable across timezones and not affected by the UTC offset near midnight.
 */
export function formatDateRelative(isoDate: string, locale: Locale): string {
	const todayKey = localDateKey(new Date());

	const yesterday = new Date();
	yesterday.setDate(yesterday.getDate() - 1);
	const yesterdayKey = localDateKey(yesterday);

	// `isoDate` is already a `YYYY-MM-DD` key; slice in case a caller passes
	// a fuller ISO timestamp.
	const targetKey = isoDate.slice(0, 10);

	if (targetKey === todayKey) return m.common_today();
	if (targetKey === yesterdayKey) return m.common_yesterday();
	return formatDate(isoDate, locale);
}
