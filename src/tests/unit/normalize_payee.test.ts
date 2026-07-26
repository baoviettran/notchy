// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { normalizePayee } from '$lib/utils/normalize_payee';

describe('normalizePayee', () => {
	it('trims whitespace', () => {
		expect(normalizePayee('  starbucks  ')).toBe('starbucks');
	});

	it('lowercases', () => {
		expect(normalizePayee('STARBUCKS')).toBe('starbucks');
	});

	it('collapses internal whitespace', () => {
		expect(normalizePayee('ca   phe')).toBe('ca phe');
	});

	it('handles null input', () => {
		expect(normalizePayee(null)).toBe('');
	});

	it('handles empty string', () => {
		expect(normalizePayee('')).toBe('');
	});

	it('folds Vietnamese diacritics: cà phê → ca phe', () => {
		expect(normalizePayee('cà phê')).toBe('ca phe');
	});

	it('folds Vietnamese diacritics: nguyễn → nguyen', () => {
		expect(normalizePayee('nguyễn')).toBe('nguyen');
	});

	it('folds Vietnamese đ → d', () => {
		expect(normalizePayee('đồng')).toBe('dong');
	});

	it('folds Vietnamese Đ → d', () => {
		expect(normalizePayee('ĐỒNG')).toBe('dong');
	});

	it('handles mixed case + diacritics + whitespace', () => {
		expect(normalizePayee('  CÀ  PHÊ  ')).toBe('ca phe');
	});

	it('preserves non-Vietnamese Unicode (e.g., emoji)', () => {
		expect(normalizePayee('cafe ☕')).toBe('cafe ☕');
	});
});
