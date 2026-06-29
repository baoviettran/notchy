import { AppError } from '$lib/errors';

export type Locale = 'en' | 'vi';

/** Fraction digits per currency (smallest-unit storage). Mirrors currency.ts. */
const FRACTION_DIGITS: Record<string, number> = {
	VND: 0,
	USD: 2
};

/**
 * Parses a user-entered amount string into an integer (smallest currency unit).
 * Supports:
 * - Vietnamese shortcuts: tr (triệu = million), k (nghìn = thousand)
 * - English shortcuts: m (million), k (thousand)
 * - Arithmetic: +, -, *, /
 * - Parentheses for grouping
 *
 * `currency` scales the result to the smallest unit: VND (0 digits) stores the
 * number as-is; USD (2 digits) multiplies by 100 so "50" → 5000 cents. Defaults
 * to VND to preserve existing callers.
 */
export function parseAmount(input: string, locale: Locale, currency: string = 'VND'): number {
	const cleaned = input.replace(/[\s,]/g, '');
	if (cleaned === '') throw new AppError('invalid_amount');

	// Expand locale-aware shortcuts
	const expanded = cleaned.replace(/(\d+(?:\.\d+)?)(tr|k|m)/gi, (_, num, unit) => {
		const u = unit.toLowerCase();
		if (u === 'tr' || (u === 'm' && locale === 'en')) return String(Number(num) * 1_000_000);
		if (u === 'k') return String(Number(num) * 1_000);
		if (u === 'm' && locale === 'vi') return String(Number(num) * 1_000_000);
		return num;
	});

	// Strict character whitelist — only digits, operators, parens, dots
	if (!/^[\d+\-*/.()\s]+$/m.test(expanded)) throw new AppError('invalid_amount');

	// Safe evaluation via a hand-written recursive-descent parser (NOT Function/
	// eval), so the production CSP can ship without 'unsafe-eval'. Grammar:
	//   expr   := term (('+'|'-') term)*
	//   term   := factor (('*'|'/') factor)*
	//   factor := ('-'|'+')? ('(' expr ')' | number)
	const result = evalExpr(expanded);
	if (typeof result !== 'number' || !isFinite(result) || result <= 0) {
		throw new AppError('invalid_amount');
	}

	// Scale to smallest currency unit (VND: ×1, USD: ×100) and round to integer.
	const fractionDigits = FRACTION_DIGITS[currency] ?? 0;
	return Math.round(result * Math.pow(10, fractionDigits));
}

function evalExpr(input: string): number {
	let pos = 0;

	function skipWs() {
		while (pos < input.length && /\s/.test(input[pos])) pos++;
	}

	function parseExpr(): number {
		let value = parseTerm();
		skipWs();
		while (pos < input.length && (input[pos] === '+' || input[pos] === '-')) {
			const op = input[pos++];
			const rhs = parseTerm();
			value = op === '+' ? value + rhs : value - rhs;
			skipWs();
		}
		return value;
	}

	function parseTerm(): number {
		let value = parseFactor();
		skipWs();
		while (pos < input.length && (input[pos] === '*' || input[pos] === '/')) {
			const op = input[pos++];
			const rhs = parseFactor();
			value = op === '*' ? value * rhs : value / rhs;
			skipWs();
		}
		return value;
	}

	function parseFactor(): number {
		skipWs();
		// Unary plus/minus
		if (input[pos] === '+' || input[pos] === '-') {
			const op = input[pos++];
			const v = parseFactor();
			return op === '-' ? -v : v;
		}
		// Parenthesized sub-expression
		if (input[pos] === '(') {
			pos++; // consume '('
			const v = parseExpr();
			skipWs();
			if (input[pos] === ')') pos++; // consume ')'
			return v;
		}
		// Number (digits + optional decimal point)
		let num = '';
		while (pos < input.length && /[\d.]/.test(input[pos])) {
			num += input[pos++];
		}
		if (num === '') throw new AppError('invalid_amount');
		return Number(num);
	}

	try {
		const v = parseExpr();
		skipWs();
		if (pos !== input.length) throw new AppError('invalid_amount'); // trailing chars
		return v;
	} catch {
		throw new AppError('invalid_amount');
	}
}
