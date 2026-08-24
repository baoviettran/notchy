import { setLanguageTag } from '$lib/paraglide/runtime';
import { detectInitialLocale } from '$lib/utils/locale';
import { settings } from '$lib/stores/settings.svelte';

export const ssr = false;
export const prerender = false;

// First-paint locale. Paraglide's compile-time default is 'en', and
// settings.load() only runs once the DB is ready — and never during
// onboarding — so without this a Vietnamese-OS user reads English through
// the entire first-run journey, including the language-choice screen itself.
// Sniff synchronously here; settings.load() remains authoritative once a
// stored locale exists (it re-calls setLanguageTag).
if (typeof navigator !== 'undefined') {
	const initial = detectInitialLocale(navigator.language);
	setLanguageTag(initial);
	// Seed the store too: the onboarding language selector initializes from
	// settings.locale, and load() won't run until first run completes —
	// without this, vi users would see Vietnamese copy with English
	// pre-selected.
	settings.locale = initial;
	// Mirror onto <html> immediately: screen readers announce the first-run
	// journey under this language, long before settings.load() runs.
	document.documentElement.lang = initial;
}
