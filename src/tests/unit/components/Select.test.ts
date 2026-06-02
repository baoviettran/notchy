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
});
