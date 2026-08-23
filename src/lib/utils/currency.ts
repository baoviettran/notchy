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

/**
 * Compact currency formatting for figures too long to compose at display
 * sizes — Vietnamese billions ("₫12.345.678.900") wrap mid-digit on the
 * dashboard readout and crowd paired rows. vi-VN renders magnitude words
 * (Tr = triệu, T = tỷ); en-US renders SI abbreviations (K/M/B).
 */
export function formatCurrencyCompact(amount: number, currency: string, locale: Locale): string {
	const config = CURRENCY_CONFIG[currency] ?? { fractionDigits: 2 };
	const displayAmount = config.fractionDigits > 0 ? amount / Math.pow(10, config.fractionDigits) : amount;
	const localeTag = locale === 'vi' ? 'vi-VN' : 'en-US';

	return new Intl.NumberFormat(localeTag, {
		style: 'currency',
		currency,
		notation: 'compact',
		maximumFractionDigits: 1
	}).format(displayAmount);
}

/**
 * Compact plain-number formatting (no currency symbol) for deltas and
 * counts that share display space with full figures.
 */
export function formatNumberCompact(amount: number, locale: Locale): string {
	const localeTag = locale === 'vi' ? 'vi-VN' : 'en-US';
	return new Intl.NumberFormat(localeTag, { notation: 'compact', maximumFractionDigits: 1 }).format(amount);
}

/**
 * True when the exact figure is long enough that a display context should
 * offer the compact form instead. Threshold is presentation-driven
 * (~13 characters) so it stays currency- and locale-agnostic.
 */
export function isLongCurrency(amount: number, currency: string, locale: Locale): boolean {
	return formatCurrency(amount, currency, locale).length > 13;
}
