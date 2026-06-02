// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Button from '$lib/components/primitives/Button.svelte';

describe('Button', () => {
	it('renders a button element', () => {
		render(Button, { children: () => 'Click me' });
		expect(screen.getByRole('button')).toBeInTheDocument();
	});

	it('has type="button" by default', () => {
		render(Button, { children: () => 'Test' });
		expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
	});

	it('sets type="submit" when specified', () => {
		render(Button, { children: () => 'Submit', type: 'submit' });
		expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
	});

	it('fires onclick when clicked', async () => {
		const onclick = vi.fn();
		render(Button, { children: () => 'Click', onclick });
		await fireEvent.click(screen.getByRole('button'));
		expect(onclick).toHaveBeenCalledOnce();
	});

	it('is disabled when disabled=true', () => {
		render(Button, { children: () => 'Test', disabled: true });
		expect(screen.getByRole('button')).toBeDisabled();
	});

	it('applies danger variant class', () => {
		render(Button, { children: () => 'Delete', variant: 'danger' });
		expect(screen.getByRole('button').className).toContain('bg-red-500');
	});

	it('applies primary variant class by default', () => {
		render(Button, { children: () => 'Save' });
		expect(screen.getByRole('button').className).toContain('bg-emerald-600');
	});

	it('applies sm size class', () => {
		render(Button, { children: () => 'Small', size: 'sm' });
		expect(screen.getByRole('button').className).toContain('px-3');
	});
});
