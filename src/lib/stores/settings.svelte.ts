import { getDb } from '$lib/db';
import { dataEpoch } from '$lib/profiles/epoch';
import type { AppPreferences } from '$lib/profiles/types';
import type { Locale } from '$lib/utils/number_parse';
import { detectInitialLocale } from '$lib/utils/locale';
import { setLanguageTag } from '$lib/paraglide/runtime';

class SettingsStore {
	locale = $state<Locale>('en');
	currency = $state('VND');
	firstRunComplete = $state(false);
	theme = $state<'auto' | 'light' | 'dark'>('light');
	private preferenceWriter: ((preferences: AppPreferences) => Promise<void>) | null = null;

	configureAppPreferences(writer: ((preferences: AppPreferences) => Promise<void>) | null): void {
		this.preferenceWriter = writer;
	}

	loadAppPreferences(preferences: AppPreferences): void {
		this.locale = preferences.locale;
		this.theme = preferences.theme;
		setLanguageTag(this.locale);
		this.applyThemeClass();
		this.applyDocumentLang();
	}

	async loadProfileSettings(): Promise<void> {
		const epoch = dataEpoch();
		const db = getDb();
		const currency = await db.meta.getCurrency();
		const firstRunComplete = await db.meta.isFirstRunComplete();
		if (epoch !== dataEpoch()) return;
		this.currency = currency;
		this.firstRunComplete = firstRunComplete;
	}


	async load(): Promise<void> {
		if (!this.preferenceWriter) {
			const db = getDb();
			const storedLocale = await db.meta.get('locale');
			this.locale = (storedLocale as Locale | null) ?? detectInitialLocale(typeof navigator !== 'undefined' ? navigator.language : undefined);
			setLanguageTag(this.locale);
		}
		await this.loadProfileSettings();
		this.applyThemeClass();
		this.applyDocumentLang();
	}

	async setLocale(newLocale: Locale): Promise<void> {
		if (this.preferenceWriter) await this.preferenceWriter({ locale: newLocale, theme: this.theme });
		else { const db = getDb(); await db.meta.set('locale', newLocale); }
		this.locale = newLocale;
		setLanguageTag(newLocale);
		this.applyDocumentLang();
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

	async saveTheme(theme: 'auto' | 'light' | 'dark'): Promise<void> {
		if (this.preferenceWriter) await this.preferenceWriter({ locale: this.locale, theme });
		this.setTheme(theme);
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

	// Screen readers pick pronunciation rules from <html lang>; paraglide's
	// setLanguageTag only swaps message tables, so mirror the locale here.
	private applyDocumentLang(): void {
		if (typeof document === 'undefined') return;
		document.documentElement.lang = this.locale;
	}
}

export const settings = new SettingsStore();
