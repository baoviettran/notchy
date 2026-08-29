// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';

import TapeLine from '$lib/components/reports/TapeLine.svelte';

describe('TapeLine', () => {
	it('renders a plain line with the label, a dotted leader, and the figure', () => {
		const { container } = render(TapeLine, { label: 'Coffee', amount: '50,000' });
		expect(screen.getByText('Coffee')).toBeInTheDocument();
		expect(screen.getByText('50,000')).toBeInTheDocument();
		const row = container.firstElementChild as HTMLElement;
		// Default tone → ledger; default variant → plain line (no rules/glow).
		expect(row.className).not.toContain('border-t');
		expect(row.querySelector('.text-sm.text-ledger')).not.toBeNull();
		// Dotted leader span always present.
		expect(row.querySelector('.border-dotted')).not.toBeNull();
	});

	it('applies the tone class to the label', () => {
		render(TapeLine, { label: 'Rent', amount: '1,000', tone: 'debit' });
		expect(screen.getByText('Rent').className).toContain('text-debit');
	});

	it('renders a subtotal row with a dashed rule, backing-plate label, and larger figure', () => {
		const { container } = render(TapeLine, { label: 'Subtotal', amount: '10,000', variant: 'subtotal' });
		const row = container.firstElementChild as HTMLElement;
		expect(row.className).toContain('border-dashed');
		// Subtotal label is a plate, not the plain truncating span.
		expect(screen.getByText('Subtotal').className).toContain('plate');
		// Figure scales to text-base on subtotal rows.
		expect(row.querySelector('.figures.text-base')).not.toBeNull();
	});

	it('renders a total row with a double rule and the glow figure', () => {
		const { container } = render(TapeLine, { label: 'Net', amount: '99,000', variant: 'total' });
		const row = container.firstElementChild as HTMLElement;
		expect(row.className).toContain('border-double');
		expect(screen.getByText('Net').className).toContain('plate');
		expect(screen.getByText('Net').className).toContain('text-ledger');
		expect(row.querySelector('.figures-glow')).not.toBeNull();
		expect(row.querySelector('.figures.text-lg')).not.toBeNull();
	});

	it('prints the note when provided', () => {
		const { container } = render(TapeLine, { label: 'Food', amount: '42,000', note: '42%' });
		expect(screen.getByText('42%')).toBeInTheDocument();
		expect(container.querySelector('.figures.text-xs')).not.toBeNull();
	});

	it('omits the note span when note is absent', () => {
		const { container } = render(TapeLine, { label: 'Food', amount: '42,000' });
		expect(container.querySelector('.figures.text-xs')).toBeNull();
	});

	it('passes the title through to the figure for a hover affordance', () => {
		render(TapeLine, { label: 'Food', amount: '42,000', title: '₫42,000.00' });
		expect(screen.getByText('42,000')).toHaveAttribute('title', '₫42,000.00');
	});
});