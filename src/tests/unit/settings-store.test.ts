// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/db', () => ({
	getDb: vi.fn()
}));

vi.mock('$lib/paraglide/runtime', () => ({
	setLanguageTag: vi.fn()
}));

import { getDb } from '$lib/db';
import { settings } from '$lib/stores/settings.svelte';

describe('SettingsStore locale', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		document.documentElement.lang = '';
	});

	function mockDb(locale: string | null) {
		(getDb as ReturnType<typeof vi.fn>).mockReturnValue({
			meta: {
				get: vi.fn().mockResolvedValue(locale),
				getLocale: vi.fn().mockResolvedValue(locale ?? 'en'),
				getCurrency: vi.fn().mockResolvedValue('VND'),
				isFirstRunComplete: vi.fn().mockResolvedValue(true),
				set: vi.fn().mockResolvedValue(undefined)
			}
		});
	}

	it('mirrors the loaded locale onto <html lang> when loading', async () => {
		mockDb('vi');
		await settings.load();
		expect(document.documentElement.lang).toBe('vi');
	});

	it('sniffs navigator.language when no locale is stored (first run)', async () => {
		Object.defineProperty(window, 'navigator', {
			value: { language: 'vi-VN' },
			configurable: true,
			writable: true
		});
		mockDb(null);
		await settings.load();
		expect(document.documentElement.lang).toBe('vi');
	});

	it('falls back to en when nothing is stored and the OS is not Vietnamese', async () => {
		Object.defineProperty(window, 'navigator', {
			value: { language: 'fr-FR' },
			configurable: true,
			writable: true
		});
		mockDb(null);
		await settings.load();
		expect(document.documentElement.lang).toBe('en');
	});

	it('updates <html lang> when the locale changes', async () => {
		mockDb('en');
		await settings.load();
		await settings.setLocale('vi');
		expect(document.documentElement.lang).toBe('vi');
		await settings.setLocale('en');
		expect(document.documentElement.lang).toBe('en');
	});
});

describe('SettingsStore profile ownership', () => {
	it('keeps app locale/theme while profile currency changes', async () => {
		const db = { meta: { getCurrency: vi.fn().mockResolvedValue('USD'), isFirstRunComplete: vi.fn().mockResolvedValue(false), set: vi.fn() } };
		(getDb as ReturnType<typeof vi.fn>).mockReturnValue(db);
		settings.loadAppPreferences({ locale: 'vi', theme: 'dark' });
		await settings.loadProfileSettings();
		expect(settings.locale).toBe('vi');
		expect(settings.theme).toBe('dark');
		expect(settings.currency).toBe('USD');
		expect(settings.firstRunComplete).toBe(false);
	});
	it('persists locale through the app preference writer', async () => {
		const save = vi.fn(async () => {});
		settings.configureAppPreferences(save);
		settings.loadAppPreferences({ locale: 'en', theme: 'light' });
		await settings.setLocale('vi');
		expect(save).toHaveBeenCalledWith({ locale: 'vi', theme: 'light' });
		settings.configureAppPreferences(null);
	});
});

describe('app preference failure', () => {
	it('keeps the visible language when saving a new locale fails', async () => {
		settings.loadAppPreferences({ locale: 'en', theme: 'light' });
		settings.configureAppPreferences(async () => { throw new Error('disk full'); });
		await expect(settings.setLocale('vi')).rejects.toThrow('disk full');
		expect(settings.locale).toBe('en');
		expect(document.documentElement.lang).toBe('en');
		settings.configureAppPreferences(null);
	});
});
