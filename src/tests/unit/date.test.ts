import { describe, it, expect } from 'vitest';
import { formatDate, formatDateRelative } from '$lib/utils/date';
import { setLanguageTag } from '$lib/paraglide/runtime';

describe('formatDate', () => {
	it('formats vi locale as dd/mm/yyyy', () => {
		const result = formatDate('2026-01-15', 'vi');
		// vi-VN uses dd/mm/yyyy
		expect(result).toBe('15/01/2026');
	});

	it('formats en locale as mm/dd/yyyy', () => {
		const result = formatDate('2026-01-15', 'en');
		// en-US uses mm/dd/yyyy
		expect(result).toBe('01/15/2026');
	});

	it('handles end-of-year dates', () => {
		const result = formatDate('2026-12-31', 'vi');
		expect(result).toBe('31/12/2026');
	});
});

describe('formatDateRelative', () => {
	it('returns "Today" for today in en locale', () => {
		setLanguageTag('en');
		const today = new Date().toISOString().slice(0, 10);
		expect(formatDateRelative(today, 'en')).toBe('Today');
	});

	it('returns "Hôm nay" for today in vi locale', () => {
		setLanguageTag('vi');
		const today = new Date().toISOString().slice(0, 10);
		expect(formatDateRelative(today, 'vi')).toBe('Hôm nay');
	});

	it('returns "Yesterday" for yesterday in en locale', () => {
		setLanguageTag('en');
		const d = new Date();
		d.setDate(d.getDate() - 1);
		const yesterday = d.toISOString().slice(0, 10);
		expect(formatDateRelative(yesterday, 'en')).toBe('Yesterday');
	});

	it('returns "Hôm qua" for yesterday in vi locale', () => {
		setLanguageTag('vi');
		const d = new Date();
		d.setDate(d.getDate() - 1);
		const yesterday = d.toISOString().slice(0, 10);
		expect(formatDateRelative(yesterday, 'vi')).toBe('Hôm qua');
	});

	it('falls back to formatDate for dates older than yesterday', () => {
		setLanguageTag('vi');
		const d = new Date();
		d.setDate(d.getDate() - 7);
		const oldDate = d.toISOString().slice(0, 10);
		const result = formatDateRelative(oldDate, 'vi');
		expect(result).toBe(formatDate(oldDate, 'vi'));
	});
});
