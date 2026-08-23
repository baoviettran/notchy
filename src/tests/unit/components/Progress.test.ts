// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Progress from '$lib/components/primitives/Progress.svelte';

describe('Progress', () => {
	it('exposes progressbar semantics with a value', () => {
		render(Progress, { value: 40, max: 100 });
		const bar = screen.getByRole('progressbar');
		expect(bar).toHaveAttribute('aria-valuenow', '40');
		expect(bar).toHaveAttribute('aria-valuemin', '0');
		expect(bar).toHaveAttribute('aria-valuemax', '100');
	});

	it('uses the provided label as its accessible name', () => {
		render(Progress, { value: 40, max: 100, label: 'Groceries' });
		expect(screen.getByRole('progressbar', { name: 'Groceries' })).toBeInTheDocument();
	});

	it('renders debit segments when the value exceeds the max', () => {
		// Regression guard: overBudget used to compare against the clamped
		// percentage and could never fire.
		const { container } = render(Progress, { value: 120, max: 100 });
		const segments = Array.from(container.querySelectorAll('div > div > div'));
		expect(segments.length).toBeGreaterThan(0);
		expect(segments.every((s) => s.className.includes('bg-debit'))).toBe(true);
	});
});
