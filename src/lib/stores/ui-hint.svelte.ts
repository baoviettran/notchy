/**
 * Cross-component UI hints — lightweight signals that let child routes
 * request chrome changes (e.g. hide the FAB) without tight coupling.
 *
 * Each hint is a reactive $state inside a class. The layout reads these;
 * child routes write them. Hints reset on navigation so a stale value
 * never persists beyond the route that set it.
 */

class UIHints {
	/** When true, the FAB should hide (e.g. batch-action bar is visible). */
	hideFab = $state(false);
}

export const uiHints = new UIHints();
