import { describe, it, expect } from 'vitest';
import { formatCurrency, formatCurrencyCompact, formatNumber, isLongCurrency } from '$lib/utils/currency';

describe('formatCurrency', () => {
	it('formats VND without decimals in vi locale', () => {
		const result = formatCurrency(50000, 'VND', 'vi');
		// VND has 0 fraction digits; vi-VN uses dot as thousand separator
		expect(result).toContain('50.000');
		expect(result).toContain('₫');
	});

	it('converts cents to dollars for USD', () => {
		const result = formatCurrency(1234, 'USD', 'en');
		// 1234 cents = $12.34
		expect(result).toContain('12.34');
	});

	it('handles zero amount', () => {
		const result = formatCurrency(0, 'VND', 'en');
		expect(result).toContain('0');
	});

	it('defaults to 2 decimal places for unknown currency', () => {
		const result = formatCurrency(1234, 'EUR', 'en');
		// EUR defaults to 2 fraction digits → 12.34
		expect(result).toContain('12.34');
	});
});

describe('formatNumber', () => {
	it('formats with Vietnamese number grouping', () => {
		const result = formatNumber(1000000, 'vi');
		// vi-VN uses dot as thousand separator
		expect(result).toContain('1');
		expect(result).toContain('000');
	});

	it('formats with English number grouping', () => {
		const result = formatNumber(1000000, 'en');
		// en-US uses comma as thousand separator
		expect(result).toBe('1,000,000');
	});
});

describe('formatCurrencyCompact', () => {
	it('compacts Vietnamese billions into magnitude words', () => {
		const result = formatCurrencyCompact(12_345_678_900, 'VND', 'vi');
		expect(result).toContain('T');
		expect(result.length).toBeLessThan(formatCurrency(12_345_678_900, 'VND', 'vi').length);
	});

	it('compacts to SI abbreviations in English', () => {
		const result = formatCurrencyCompact(12_345_678_900, 'VND', 'en');
		expect(result).toMatch(/B/);
	});

	it('keeps small amounts essentially intact', () => {
		const result = formatCurrencyCompact(50_000, 'VND', 'vi');
		expect(result).toContain('₫');
		expect(result).toContain('50');
	});
});

describe('isLongCurrency', () => {
	it('flags billion-scale VND figures as long', () => {
		expect(isLongCurrency(12_345_678_900, 'VND', 'en')).toBe(true);
	});

	it('treats everyday figures as short', () => {
		expect(isLongCurrency(50_000, 'VND', 'vi')).toBe(false);
		expect(isLongCurrency(1234, 'USD', 'en')).toBe(false);
	});
});
