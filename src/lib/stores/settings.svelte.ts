import { getDb } from '$lib/db';
import * as meta from '$lib/db/repos/meta';
import type { Locale } from '$lib/utils/number_parse';
import { setLanguageTag } from '$lib/paraglide/runtime';

class SettingsStore {
	locale = $state<Locale>('en');
	currency = $state('VND');
	firstRunComplete = $state(false);
	theme = $state<'auto' | 'light' | 'dark'>('light');

	async load(): Promise<void> {
		const db = await getDb();
		this.locale = (await meta.getLocale(db)) as Locale;
		setLanguageTag(this.locale);
		this.currency = await meta.getCurrency(db);
		this.firstRunComplete = await meta.isFirstRunComplete(db);
		this.applyThemeClass();
	}

	async setLocale(locale: Locale): Promise<void> {
		const db = await getDb();
		await meta.setMeta(db, 'locale', locale);
		this.locale = locale;
		setLanguageTag(locale);
	}

	async setCurrency(currency: string): Promise<void> {
		const db = await getDb();
		await meta.setMeta(db, 'currency', currency);
		this.currency = currency;
	}

	async completeOnboarding(): Promise<void> {
		const db = await getDb();
		await meta.setMeta(db, 'first_run_complete', '1');
		await meta.setMeta(db, 'onboarding_step', 'complete');
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
