// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import EmptyState from '$lib/components/primitives/EmptyState.svelte';
import { snip } from '../helpers/snippet';

describe('EmptyState', () => {
	it('renders the message text', () => {
		render(EmptyState, { message: 'No transactions yet.' });
		expect(screen.getByText('No transactions yet.')).toBeInTheDocument();
	});

	it('renders the default tape glyph when nothing is provided', () => {
		render(EmptyState, { message: 'Empty' });
		expect(screen.getByText('▮▯▯▯')).toBeInTheDocument();
	});

	it('renders a named glyph preset', () => {
		render(EmptyState, { message: 'Empty', glyph: 'vault' });
		expect(screen.getByText('▣▯')).toBeInTheDocument();
		expect(screen.queryByText('▮▯▯▯')).not.toBeInTheDocument();
	});

	it('falls back to the tape glyph for an unknown preset', () => {
		// @ts-expect-error intentionally invalid preset to test fallback
		render(EmptyState, { message: 'Empty', glyph: 'nope' });
		expect(screen.getByText('▮▯▯▯')).toBeInTheDocument();
	});

	it('renders a custom icon when provided, overriding the glyph', () => {
		render(EmptyState, { message: 'Empty', icon: '◈' });
		expect(screen.getByText('◈')).toBeInTheDocument();
		expect(screen.queryByText('▮▯▯▯')).not.toBeInTheDocument();
	});

	it('renders a title when provided', () => {
		render(EmptyState, { message: 'Empty', title: 'Nothing here yet' });
		const title = screen.getByText('Nothing here yet');
		expect(title).toBeInTheDocument();
		expect(title.tagName).toBe('P');
	});

	it('does not render a title element when none is provided', () => {
		const { container } = render(EmptyState, { message: 'Empty' });
		expect(container.querySelector('.empty-title')).not.toBeInTheDocument();
	});

	it('applies the positive tone class to the glyph when tone is positive', () => {
		render(EmptyState, { message: 'Empty', glyph: 'check', tone: 'positive' });
		expect(screen.getByText('✓').className).toContain('text-phosphor');
	});

	it('keeps the neutral tone by default (no positive color)', () => {
		render(EmptyState, { message: 'Empty' });
		expect(screen.getByText('▮▯▯▯').className).not.toContain('text-phosphor');
	});

	it('renders an action snippet container when action is provided', () => {
		const { container } = render(EmptyState, { message: 'Empty', action: snip('Add one') });
		expect(container.querySelector('.mt-4')).toBeInTheDocument();
	});

	it('does not render an action container when no action provided', () => {
		const { container } = render(EmptyState, { message: 'Empty' });
		expect(container.querySelector('.mt-4')).not.toBeInTheDocument();
	});

	it('uses the figures-glow class on the glyph', () => {
		render(EmptyState, { message: 'Empty' });
		expect(screen.getByText('▮▯▯▯').className).toContain('figures-glow');
	});
});
