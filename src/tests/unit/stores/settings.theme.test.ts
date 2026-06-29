// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { settings } from '$lib/stores/settings.svelte';

describe('settings theme', () => {
	beforeEach(() => {
		document.documentElement.classList.remove('light', 'dark');
	});

	it('defaults to light', () => {
		expect(settings.theme).toBe('light');
	});

	it('applies the light class on setTheme("light")', () => {
		settings.setTheme('light');
		expect(document.documentElement.classList.contains('light')).toBe(true);
		expect(document.documentElement.classList.contains('dark')).toBe(false);
	});

	it('applies the dark class on setTheme("dark")', () => {
		settings.setTheme('dark');
		expect(document.documentElement.classList.contains('dark')).toBe(true);
		expect(document.documentElement.classList.contains('light')).toBe(false);
	});

	it('clears both classes on setTheme("auto")', () => {
		settings.setTheme('dark');
		settings.setTheme('auto');
		expect(document.documentElement.classList.contains('light')).toBe(false);
		expect(document.documentElement.classList.contains('dark')).toBe(false);
	});
});
