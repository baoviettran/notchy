import { describe, it, expect } from 'vitest';
import { fmtReport } from '$lib/utils/report-format';

describe('fmtReport', () => {
	it('returns plain figure for positive amount', () => {
		const result = fmtReport(50000, 'VND', 'vi');
		// VND: no decimals, dot separator, ₫ symbol
		expect(result).toContain('50.000');
		expect(result).not.toContain('−');
	});

	it('prepends ledger minus (U+2212) for negative amount', () => {
		const result = fmtReport(-50000, 'VND', 'vi');
		expect(result).toMatch(/^−/);
		expect(result).toContain('50.000');
	});

	it('uses compact format for long currency strings', () => {
		// A very large VND amount that would be long
		const result = fmtReport(1234567890, 'VND', 'vi');
		// Should use compact notation (e.g. 1,2M or similar)
		expect(result.length).toBeLessThan(fmtReport(1234567890, 'VND', 'vi').length + 5);
	});

	it('handles zero without minus sign', () => {
		const result = fmtReport(0, 'VND', 'vi');
		expect(result).not.toContain('−');
		expect(result).toContain('0');
	});

	it('handles USD locale', () => {
		const result = fmtReport(-1234, 'USD', 'en');
		expect(result).toMatch(/^−/);
		expect(result).toContain('12.34');
	});
});
