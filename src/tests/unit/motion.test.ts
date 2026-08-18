import { describe, it, expect, vi, afterEach } from 'vitest';
import { slideUp, easeOutStrong } from '$lib/transitions/motion';

afterEach(() => {
	vi.unstubAllGlobals();
});

const node = { offsetHeight: 200 } as unknown as HTMLElement;

describe('slideUp', () => {
	it('returns a 150ms strong-ease-out transition by default', () => {
		const config = slideUp(node, {});
		expect(config.duration).toBe(150);
		expect(config.easing!(0)).toBeCloseTo(0, 5);
		expect(config.easing!(1)).toBeCloseTo(1, 5);
	});

	it('starts below the element and ends in place', () => {
		const config = slideUp(node, {});
		expect(config.css!(0, 1)).toContain('translateY(200px)');
		expect(config.css!(0, 1)).toContain('opacity: 0');
		expect(config.css!(1, 0)).toContain('translateY(0px)');
		expect(config.css!(1, 0)).toContain('opacity: 1');
	});

	it('respects a custom duration', () => {
		expect(slideUp(node, { duration: 250 }).duration).toBe(250);
	});

	it('drops the transform under prefers-reduced-motion', () => {
		vi.stubGlobal(
			'matchMedia',
			(query: string) => ({
				matches: query.includes('prefers-reduced-motion'),
				addEventListener: vi.fn(),
				removeEventListener: vi.fn()
			})
		);
		const config = slideUp(node, {});
		expect(config.css!(0, 1)).not.toContain('translateY');
		expect(config.css!(0, 1)).toContain('opacity: 0');
	});
});

describe('easeOutStrong', () => {
	it('is the design-system ease-out curve', () => {
		// cubic-bezier(0.23, 1, 0.32, 1): fast start, decelerates to rest
		expect(easeOutStrong(0)).toBeCloseTo(0, 5);
		expect(easeOutStrong(1)).toBeCloseTo(1, 5);
		expect(easeOutStrong(0.5)).toBeGreaterThan(0.5); // leading acceleration
	});
});
