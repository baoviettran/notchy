export type Locale = 'en' | 'vi';

/**
 * Parses a user-entered amount string into an integer (smallest currency unit).
 * Supports:
 * - Vietnamese shortcuts: tr (triệu = million), k (nghìn = thousand)
 * - English shortcuts: m (million), k (thousand)
 * - Arithmetic: +, -, *, /
 * - Parentheses for grouping
 */
export function parseAmount(input: string, locale: Locale): number {
	const cleaned = input.replace(/[\s,]/g, '');
	if (cleaned === '') throw new Error('Invalid amount');

	// Expand locale-aware shortcuts
	const expanded = cleaned.replace(/(\d+(?:\.\d+)?)(tr|k|m)/gi, (_, num, unit) => {
		const u = unit.toLowerCase();
		if (u === 'tr' || (u === 'm' && locale === 'en')) return String(Number(num) * 1_000_000);
		if (u === 'k') return String(Number(num) * 1_000);
		if (u === 'm' && locale === 'vi') return String(Number(num) * 1_000_000);
		return num;
	});

	// Strict character whitelist — only digits, operators, parens, dots
	if (!/^[\d+\-*/.()\s]+$/.test(expanded)) throw new Error('Invalid amount');

	// Safe evaluation via Function constructor (input is whitelisted)
	const result = Function(`"use strict"; return (${expanded});`)();
	if (typeof result !== 'number' || !isFinite(result) || result <= 0) {
		throw new Error('Invalid amount');
	}
	return Math.round(result);
}
