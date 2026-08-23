// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Select from '$lib/components/primitives/Select.svelte';

const options = [
	{ value: 'checking', label: 'Checking' },
	{ value: 'savings', label: 'Savings' },
	{ value: 'cash', label: 'Cash' }
];

describe('Select', () => {
	it('renders label when provided', () => {
		render(Select, { label: 'Account Type', options });
		expect(screen.getByText('Account Type')).toBeInTheDocument();
	});

	it('does not render label when omitted', () => {
		const { container } = render(Select, { options });
		expect(container.querySelector('label')).not.toBeInTheDocument();
	});

	it('renders all options', () => {
		render(Select, { options });
		expect(screen.getByText('Checking')).toBeInTheDocument();
		expect(screen.getByText('Savings')).toBeInTheDocument();
		expect(screen.getByText('Cash')).toBeInTheDocument();
	});

	it('is disabled when disabled=true', () => {
		const { container } = render(Select, { options, disabled: true });
		const select = container.querySelector('select');
		expect(select).toBeDisabled();
	});

	it('renders correct number of option elements', () => {
		const { container } = render(Select, { options });
		const select = container.querySelector('select');
		expect(select!.querySelectorAll('option')).toHaveLength(3);
	});

	it('shows error message and wires aria attributes when error provided', () => {
		const { container } = render(Select, { options, label: 'Account', error: 'Select an account' });
		const select = container.querySelector('select');
		expect(screen.getByText('Select an account')).toBeInTheDocument();
		expect(select).toHaveAttribute('aria-invalid', 'true');
		expect(select).toHaveAttribute('aria-describedby');
		expect(screen.getByRole('alert')).toHaveTextContent('Select an account');
	});

	it('does not set aria-invalid when error is empty', () => {
		const { container } = render(Select, { options, error: '' });
		expect(container.querySelector('select')).not.toHaveAttribute('aria-invalid');
	});
});
