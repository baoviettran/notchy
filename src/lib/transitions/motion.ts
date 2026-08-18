import type { TransitionConfig } from 'svelte/transition';

/**
 * Motion primitives for Notchy's VFD personality: crisp, fast, ease-out.
 * Shared so every popover/sheet uses the same curve and respects
 * prefers-reduced-motion (fade-only there — keep opacity, drop movement).
 */

/** The design-system ease-out curve, cubic-bezier(0.23, 1, 0.32, 1). */
export const easeOutStrong = cubicBezier(0.23, 1, 0.32, 1);

function prefersReducedMotion(): boolean {
	if (typeof globalThis.matchMedia !== 'function') return false;
	return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Slide an element up from its own height while fading in (reverse for out).
 * Transform-based and interruptible — Svelte retargets the transition when the
 * element re-enters instead of restarting from zero like a keyframe.
 */
export function slideUp(node: Element, params?: { duration?: number }): TransitionConfig {
	const duration = params?.duration ?? 150;
	if (prefersReducedMotion()) {
		// Reduced motion: fade only, keep opacity for comprehension, drop the movement.
		return {
			duration,
			css: (t) => `opacity: ${t}`
		};
	}
	const height = (node as HTMLElement).offsetHeight;
	return {
		duration,
		easing: easeOutStrong,
		css: (t) => `transform: translateY(${(1 - t) * height}px); opacity: ${t}`
	};
}

/**
 * Cubic-bezier easing (standard solved form, same algorithm as bezier-easing):
 * solves x→t via Newton-Raphson with binary-subdivision fallback, then samples
 * the y curve. Hand-rolled so the design token (0.23, 1, 0.32, 1) is exact in
 * JS, not an approximation of Svelte's built-ins.
 */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
	const NEWTON_ITERATIONS = 4;
	const NEWTON_MIN_SLOPE = 0.001;
	const SUBDIVISION_PRECISION = 1e-7;
	const SUBDIVISION_MAX_ITERATIONS = 10;
	const SAMPLE_SIZE = 11;
	const SAMPLE_STEP = 1 / (SAMPLE_SIZE - 1);

	function calcBezier(t: number, a1: number, a2: number) {
		return ((1 - 3 * a2 + 3 * a1) * t + (3 * a2 - 6 * a1)) * t * t + 3 * a1 * t;
	}
	function getSlope(t: number, a1: number, a2: number) {
		return 3 * (1 - 3 * a2 + 3 * a1) * t * t + 2 * (3 * a2 - 6 * a1) * t + 3 * a1;
	}

	const sampleValues = new Float32Array(SAMPLE_SIZE);
	for (let i = 0; i < SAMPLE_SIZE; i++) {
		sampleValues[i] = calcBezier(i * SAMPLE_STEP, x1, x2);
	}

	function newtonRaphson(x: number, guessT: number) {
		for (let i = 0; i < NEWTON_ITERATIONS; i++) {
			const slope = getSlope(guessT, x1, x2);
			if (slope === 0) return guessT;
			guessT -= (calcBezier(guessT, x1, x2) - x) / slope;
		}
		return guessT;
	}

	function binarySubdivide(x: number, a: number, b: number) {
		let currentT: number;
		let currentX: number;
		let i = 0;
		do {
			currentT = a + (b - a) / 2;
			currentX = calcBezier(currentT, x1, x2) - x;
			if (currentX > 0) b = currentT;
			else a = currentT;
		} while (Math.abs(currentX) > SUBDIVISION_PRECISION && ++i < SUBDIVISION_MAX_ITERATIONS);
		return currentT;
	}

	function getTForX(x: number) {
		let intervalStart = 0;
		let currentSample = 1;
		while (currentSample !== SAMPLE_SIZE - 1 && sampleValues[currentSample] <= x) {
			intervalStart += SAMPLE_STEP;
			currentSample++;
		}
		const dist =
			(x - sampleValues[currentSample - 1]) / (sampleValues[currentSample] - sampleValues[currentSample - 1]);
		const guessT = intervalStart + dist * SAMPLE_STEP;
		const slope = getSlope(guessT, x1, x2);
		if (slope >= NEWTON_MIN_SLOPE) return newtonRaphson(x, guessT);
		if (slope === 0) return guessT;
		return binarySubdivide(x, intervalStart, intervalStart + SAMPLE_STEP);
	}

	return (t: number) => calcBezier(getTForX(t), y1, y2);
}
