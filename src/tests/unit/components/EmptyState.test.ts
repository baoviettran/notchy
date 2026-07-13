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

	it('renders the default glyph when no icon given', () => {
		render(EmptyState, { message: 'Empty' });
		expect(screen.getByText('▮▯▯▯')).toBeInTheDocument();
	});

	it('renders a custom icon when provided', () => {
		render(EmptyState, { message: 'Empty', icon: '◈' });
		expect(screen.getByText('◈')).toBeInTheDocument();
		expect(screen.queryByText('▮▯▯▯')).not.toBeInTheDocument();
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
