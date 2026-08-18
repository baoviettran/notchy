import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/svelte';
import { afterEach } from 'vitest';

// jsdom has no Web Animations API, but Svelte 5 transitions call
// element.animate() and complete each phase via `animation.onfinish`
// (a dummy delay animation, then the real one). Provide a minimal polyfill
// that fires the assigned onfinish on the next microtask so 150ms in/out
// transitions finish in one tick instead of hanging the component tests.
// Node-environment tests have no global Element — skip there.
if (typeof Element !== 'undefined' && !Element.prototype.animate) {
	Element.prototype.animate = function () {
		const animation = {
			onfinish: null as (() => void) | null,
			finished: Promise.resolve(),
			cancel: () => {},
			play: () => {},
			pause: () => {},
			finish: () => animation.onfinish?.(),
			reverse: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			currentTime: 0,
			playState: 'finished'
		};
		Promise.resolve().then(() => animation.onfinish?.());
		return animation as unknown as Animation;
	};
}

// Ensure DOM is cleaned up between component tests
afterEach(() => {
	cleanup();
});
