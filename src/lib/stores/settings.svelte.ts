import { getDb } from '$lib/db';
import type { Locale } from '$lib/utils/number_parse';
import { setLanguageTag } from '$lib/paraglide/runtime';

class SettingsStore {
	locale = $state<Locale>('en');
	currency = $state('VND');
	firstRunComplete = $state(false);
	theme = $state<'auto' | 'light' | 'dark'>('light');

	async load(): Promise<void> {
		const db = getDb();
		this.locale = (await db.meta.getLocale()) as Locale;
		setLanguageTag(this.locale);
		this.currency = await db.meta.getCurrency();
		this.firstRunComplete = await db.meta.isFirstRunComplete();
		this.applyThemeClass();
	}

	async setLocale(newLocale: Locale): Promise<void> {
		const db = getDb();
		await db.meta.set('locale', newLocale);
		this.locale = newLocale;
		setLanguageTag(newLocale);
	}

	async setCurrency(currency: string): Promise<void> {
		const db = getDb();
		await db.meta.set('currency', currency);
		this.currency = currency;
	}

	async completeOnboarding(): Promise<void> {
		const db = getDb();
		await db.meta.set('first_run_complete', '1');
		await db.meta.set('onboarding_step', 'complete');
		this.firstRunComplete = true;
	}

	setTheme(theme: 'auto' | 'light' | 'dark'): void {
		this.theme = theme;
		this.applyThemeClass();
	}

	private applyThemeClass(): void {
		if (typeof document === 'undefined') return;
		document.documentElement.classList.remove('light', 'dark');
		if (this.theme !== 'auto') document.documentElement.classList.add(this.theme);
	}
}

export const settings = new SettingsStore();
