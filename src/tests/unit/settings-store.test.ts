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

	function mockDb(locale: string) {
		(getDb as ReturnType<typeof vi.fn>).mockReturnValue({
			meta: {
				getLocale: vi.fn().mockResolvedValue(locale),
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

	it('updates <html lang> when the locale changes', async () => {
		mockDb('en');
		await settings.load();
		await settings.setLocale('vi');
		expect(document.documentElement.lang).toBe('vi');
		await settings.setLocale('en');
		expect(document.documentElement.lang).toBe('en');
	});
});
