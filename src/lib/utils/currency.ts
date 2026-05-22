import type { Locale } from './number_parse';

const CURRENCY_CONFIG: Record<string, { fractionDigits: number }> = {
	VND: { fractionDigits: 0 },
	USD: { fractionDigits: 2 }
};

/**
 * Formats an integer amount (smallest currency unit) into a display string.
 * VND: 50000 → "50,000" (no decimals)
 * USD: 1234 → "12.34" (cents to dollars)
 */
export function formatCurrency(amount: number, currency: string, locale: Locale): string {
	const config = CURRENCY_CONFIG[currency] ?? { fractionDigits: 2 };
	const displayAmount = config.fractionDigits > 0 ? amount / Math.pow(10, config.fractionDigits) : amount;
	const localeTag = locale === 'vi' ? 'vi-VN' : 'en-US';

	return new Intl.NumberFormat(localeTag, {
		style: 'currency',
		currency,
		minimumFractionDigits: config.fractionDigits,
		maximumFractionDigits: config.fractionDigits
	}).format(displayAmount);
}

/**
 * Formats a plain number (no currency symbol).
 */
export function formatNumber(amount: number, locale: Locale): string {
	const localeTag = locale === 'vi' ? 'vi-VN' : 'en-US';
	return new Intl.NumberFormat(localeTag).format(amount);
}
