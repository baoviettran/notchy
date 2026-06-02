// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Input from '$lib/components/primitives/Input.svelte';

describe('Input', () => {
	it('renders label when provided', () => {
		render(Input, { label: 'Email', id: 'email' });
		expect(screen.getByText('Email')).toBeInTheDocument();
	});

	it('does not render label element when omitted', () => {
		const { container } = render(Input, {});
		expect(container.querySelector('label')).not.toBeInTheDocument();
	});

	it('renders error message when provided', () => {
		render(Input, { error: 'Required field' });
		expect(screen.getByText('Required field')).toBeInTheDocument();
	});

	it('does not render error paragraph when error is empty', () => {
		const { container } = render(Input, { error: '' });
		expect(container.querySelector('p.text-red-500')).not.toBeInTheDocument();
	});

	it('applies placeholder', () => {
		render(Input, { placeholder: 'Enter amount' });
		expect(screen.getByPlaceholderText('Enter amount')).toBeInTheDocument();
	});

	it('is disabled when disabled=true', () => {
		render(Input, { disabled: true, placeholder: 'test' });
		expect(screen.getByPlaceholderText('test')).toBeDisabled();
	});

	it('has text input type by default', () => {
		render(Input, { id: 'type-test-default' });
		expect(document.getElementById('type-test-default')).toHaveAttribute('type', 'text');
	});

	it('sets custom type when provided', () => {
		render(Input, { type: 'number', placeholder: 'amount' });
		expect(screen.getByPlaceholderText('amount')).toHaveAttribute('type', 'number');
	});
});
