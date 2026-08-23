// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/db', () => ({
	getDb: vi.fn(() => ({
		meta: {
			isFirstRunComplete: vi.fn().mockResolvedValue(true),
			isTourComplete: vi.fn().mockResolvedValue(false),
			setTourComplete: vi.fn().mockResolvedValue(undefined)
		}
	}))
}));

import TourOverlay from '$lib/components/tour/TourOverlay.svelte';
import { tour } from '$lib/stores/tour.svelte';

describe('TourOverlay', () => {
	beforeEach(() => {
		tour.active = false;
		tour.complete = false;
	});

	it('moves focus into the tooltip when the tour becomes active', async () => {
		render(TourOverlay);
		tour.start({ force: true });
		await vi.waitFor(() => {
			expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
		});
	});

	it('keeps Tab focus inside the tooltip when cycling forward past its last control', async () => {
		render(TourOverlay);
		tour.start({ force: true });
		let dialog: HTMLElement;
		await vi.waitFor(() => {
			dialog = screen.getByRole('dialog');
			expect(dialog).toContainElement(document.activeElement as HTMLElement);
		});
		screen.getByRole('button', { name: 'Next' }).focus();
		await fireEvent.keyDown(dialog!, { key: 'Tab' });
		expect(screen.getByRole('button', { name: 'Skip' })).toHaveFocus();
	});
});
