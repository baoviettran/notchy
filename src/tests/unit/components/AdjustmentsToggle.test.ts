// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

import AdjustmentsToggle from '$lib/components/reports/AdjustmentsToggle.svelte';

describe('AdjustmentsToggle', () => {
	it('renders an unchecked switch with the label', () => {
		render(AdjustmentsToggle, {});
		const sw = screen.getByRole('switch');
		expect(sw).toBeInTheDocument();
		expect(sw).toHaveAttribute('aria-checked', 'false');
		expect(screen.getByText('Include adjustments')).toBeInTheDocument();
	});

	it('toggles checked on click', async () => {
		render(AdjustmentsToggle, {});
		const sw = screen.getByRole('switch');
		await fireEvent.click(sw);
		expect(sw).toHaveAttribute('aria-checked', 'true');
		await fireEvent.click(sw);
		expect(sw).toHaveAttribute('aria-checked', 'false');
	});

	it('renders checked when initialized true', () => {
		render(AdjustmentsToggle, { checked: true });
		expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
	});
});