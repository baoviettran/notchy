import type { Locale } from './number_parse';

/**
 * First-run locale: trust the user's OS/browser language when it is one the
 * app ships, otherwise English. Only consulted when no locale is stored in
 * app_meta — an explicit in-app choice always wins.
 */
export function detectInitialLocale(navigatorLanguage?: string): Locale {
	return navigatorLanguage?.toLowerCase().startsWith('vi') ? 'vi' : 'en';
}
