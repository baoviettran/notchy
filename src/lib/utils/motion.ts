/**
 * How long the quick-add window holds open after a save so the phosphor
 * flash registers. Under prefers-reduced-motion the CSS suppresses the
 * flash entirely (app.css), so holding the window open is pure latency.
 */
export function savePauseMs(prefersReducedMotion: boolean): number {
	return prefersReducedMotion ? 0 : 400;
}
