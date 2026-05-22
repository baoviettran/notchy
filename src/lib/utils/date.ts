import type { Locale } from './number_parse';

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
 * Formats a date relative to today (Today, Yesterday, or full date).
 */
export function formatDateRelative(isoDate: string, locale: Locale): string {
	const date = new Date(isoDate);
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const target = new Date(date);
	target.setHours(0, 0, 0, 0);

	const diffDays = Math.round((today.getTime() - target.getTime()) / 86_400_000);

	if (diffDays === 0) return locale === 'vi' ? 'Hôm nay' : 'Today';
	if (diffDays === 1) return locale === 'vi' ? 'Hôm qua' : 'Yesterday';
	return formatDate(isoDate, locale);
}
