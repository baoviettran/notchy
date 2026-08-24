import { describe, it, expect } from 'vitest';
import { detectInitialLocale } from '$lib/utils/locale';

describe('detectInitialLocale', () => {
	it('returns vi for Vietnamese browser language', () => {
		expect(detectInitialLocale('vi')).toBe('vi');
	});

	it('returns vi for regional Vietnamese variants', () => {
		expect(detectInitialLocale('vi-VN')).toBe('vi');
	});

	it('is case-insensitive', () => {
		expect(detectInitialLocale('VI-vn')).toBe('vi');
	});

	it('returns en for any other language', () => {
		expect(detectInitialLocale('en-US')).toBe('en');
		expect(detectInitialLocale('fr')).toBe('en');
		expect(detectInitialLocale('ja-JP')).toBe('en');
	});

	it('returns en when no language is available', () => {
		expect(detectInitialLocale(undefined)).toBe('en');
	});
});
