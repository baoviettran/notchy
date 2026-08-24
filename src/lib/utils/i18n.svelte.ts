import { settings } from '$lib/stores/settings.svelte';

/**
 * Makes a paraglide message re-evaluate in place when the user switches
 * language mid-flow. `setLanguageTag` mutates module state Svelte cannot
 * track, so a bare `{m.some_key()}` freezes in the language it first
 * rendered with wherever it sits outside `{#key settings.locale}`. Reading
 * `settings.locale` inside this function registers it as a dependency of
 * whichever template effect evaluates it.
 *
 * Usage: `title={label(() => m.layout_add_transaction())}`
 */
export function label(get: () => string): string {
	void settings.locale;
	return get();
}
