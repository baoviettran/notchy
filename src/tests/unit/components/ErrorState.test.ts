// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ErrorState from '$lib/components/primitives/ErrorState.svelte';

describe('ErrorState', () => {
	it('renders with error message', () => {
		render(ErrorState, { description: 'Database connection failed' });
		expect(screen.getByText('Database connection failed')).toBeInTheDocument();
	});

	it('shows retry button when onRetry provided', () => {
		const onRetry = vi.fn();
		render(ErrorState, { description: 'Error', onRetry });
		expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
	});

	it('hides retry button when no onRetry', () => {
		render(ErrorState, { description: 'Error' });
		expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
	});

	it('has role="alert"', () => {
		render(ErrorState, { description: 'Error' });
		expect(screen.getByRole('alert')).toBeInTheDocument();
	});

	it('calls onRetry when retry button clicked', async () => {
		const onRetry = vi.fn();
		render(ErrorState, { description: 'Error', onRetry });
		await fireEvent.click(screen.getByRole('button', { name: /try again/i }));
		expect(onRetry).toHaveBeenCalledOnce();
	});

	it('renders the error icon', () => {
		const { container } = render(ErrorState, { description: 'Error' });
		expect(container.querySelector('svg')).toBeInTheDocument();
	});
});
