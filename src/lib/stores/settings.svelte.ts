import { getDb } from '$lib/db';
import * as meta from '$lib/db/repos/meta';
import type { Locale } from '$lib/utils/number_parse';

class SettingsStore {
	locale = $state<Locale>('en');
	currency = $state('VND');
	firstRunComplete = $state(false);
	theme = $state<'auto' | 'light' | 'dark'>('auto');

	async load(): Promise<void> {
		const db = await getDb();
		this.locale = (await meta.getLocale(db)) as Locale;
		this.currency = await meta.getCurrency(db);
		this.firstRunComplete = await meta.isFirstRunComplete(db);
	}

	async setLocale(locale: Locale): Promise<void> {
		const db = await getDb();
		await meta.setMeta(db, 'locale', locale);
		this.locale = locale;
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
		if (typeof document !== 'undefined') {
			document.documentElement.classList.remove('light', 'dark');
			if (theme !== 'auto') document.documentElement.classList.add(theme);
		}
	}
}

export const settings = new SettingsStore();
