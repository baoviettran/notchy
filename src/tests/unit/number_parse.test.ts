import { describe, it, expect } from 'vitest';
import { parseAmount } from '$lib/utils/number_parse';

describe('parseAmount', () => {
	describe('basic numbers', () => {
		it('parses a plain integer', () => {
			expect(parseAmount('50000', 'vi')).toBe(50000);
		});

		it('parses a number with commas', () => {
			expect(parseAmount('50,000', 'vi')).toBe(50000);
		});

		it('parses a number with spaces', () => {
			expect(parseAmount('50 000', 'vi')).toBe(50000);
		});
	});

	describe('Vietnamese shortcuts', () => {
		it('expands "tr" to million', () => {
			expect(parseAmount('5tr', 'vi')).toBe(5_000_000);
		});

		it('expands "k" to thousand', () => {
			expect(parseAmount('50k', 'vi')).toBe(50_000);
		});

		it('expands "m" to million in vi locale', () => {
			expect(parseAmount('5m', 'vi')).toBe(5_000_000);
		});
	});

	describe('English shortcuts', () => {
		it('expands "m" to million in en locale', () => {
			expect(parseAmount('5m', 'en')).toBe(5_000_000);
		});

		it('expands "k" to thousand', () => {
			expect(parseAmount('5k', 'en')).toBe(5_000);
		});
	});

	describe('arithmetic', () => {
		it('evaluates addition', () => {
			expect(parseAmount('100+50', 'vi')).toBe(150);
		});

		it('evaluates division', () => {
			expect(parseAmount('1000/4', 'vi')).toBe(250);
		});

		it('evaluates multiplication', () => {
			expect(parseAmount('100*3', 'vi')).toBe(300);
		});

		it('evaluates subtraction', () => {
			expect(parseAmount('100-30', 'vi')).toBe(70);
		});
	});

	describe('rounding', () => {
		it('rounds decimal results', () => {
			expect(parseAmount('100.7', 'vi')).toBe(101);
		});
	});

	describe('currency scaling', () => {
		// Amounts are stored in the smallest currency unit. VND has 0 fraction
		// digits (1₫ = 1 unit), so the raw number is stored as-is. USD has 2
		// fraction digits, so "50" means 50 dollars = 5000 cents.
		it('stores VND as-is (0 fraction digits)', () => {
			expect(parseAmount('50000', 'vi', 'VND')).toBe(50000);
		});

		it('scales USD by 100 (2 fraction digits) — "50" → 5000 cents', () => {
			expect(parseAmount('50', 'en', 'USD')).toBe(5000);
		});

		it('scales USD decimals — "12.34" → 1234 cents', () => {
			expect(parseAmount('12.34', 'en', 'USD')).toBe(1234);
		});

		it('scales USD with shortcuts — "5k" → 500000 cents ($5000)', () => {
			expect(parseAmount('5k', 'en', 'USD')).toBe(500000);
		});

		it('rounds fractional cents — "12.349" → 1235 cents (rounds up)', () => {
			expect(parseAmount('12.349', 'en', 'USD')).toBe(1235);
		});

		it('defaults to VND when currency omitted (back-compat)', () => {
			expect(parseAmount('50', 'vi')).toBe(50);
		});
	});

	describe('errors', () => {
		it('throws on empty string', () => {
			expect(() => parseAmount('', 'vi')).toThrow('Invalid amount');
		});

		it('throws on negative result', () => {
			expect(() => parseAmount('5-10', 'vi')).toThrow('Invalid amount');
		});

		it('throws on zero result', () => {
			expect(() => parseAmount('0', 'vi')).toThrow('Invalid amount');
		});

		it('throws on invalid characters', () => {
			expect(() => parseAmount('abc', 'vi')).toThrow('Invalid amount');
		});
	});
});
