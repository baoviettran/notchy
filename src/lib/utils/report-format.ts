import { formatCurrency, formatCurrencyCompact, isLongCurrency } from '$lib/utils/currency';
import type { Locale } from '$lib/utils/number_parse';

/**
 * Format a report figure with the ledger's own minus (U+2212), never
 * Intl's hyphen. Compact when the currency string is too long for the tape.
 */
export function fmtReport(amount: number, currency: string, locale: Locale): string {
	const magnitude = Math.abs(amount);
	const figure = isLongCurrency(magnitude, currency, locale)
		? formatCurrencyCompact(magnitude, currency, locale)
		: formatCurrency(magnitude, currency, locale);
	return (amount < 0 ? '−' : '') + figure;
}
