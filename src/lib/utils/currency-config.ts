/**
 * Single source of truth for currency configuration.
 * Both currency.ts (display formatting) and number_parse.ts (amount parsing)
 * must agree on fraction digits — this file prevents drift.
 */
export const CURRENCY_CONFIG: Record<string, { fractionDigits: number }> = {
	VND: { fractionDigits: 0 },
	USD: { fractionDigits: 2 },
	EUR: { fractionDigits: 2 },
	JPY: { fractionDigits: 0 },
	THB: { fractionDigits: 2 }
};

/** Ordered list of supported currency codes (for UI rendering). */
export const CURRENCY_CODES = Object.keys(CURRENCY_CONFIG);
