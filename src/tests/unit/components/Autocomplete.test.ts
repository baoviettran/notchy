// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Autocomplete from '$lib/components/primitives/Autocomplete.svelte';
import BindProbe from './helpers/AutocompleteBindProbe.svelte';

// onBlur commits the value via a setTimeout(150ms) — a real timer, so the
// probe only updates after it fires. We use real timers and wait for the
// assertion to become true rather than fake timers (Svelte 5 reactivity +
// fake timers interleave poorly in jsdom).
async function waitForProbe(text: string) {
	await vi.waitFor(() => {
		expect(screen.getByTestId('probe')).toHaveTextContent(text);
	});
}
afterEach(() => vi.useRealTimers());

const OPTS = [
	{ value: 'a1', label: 'Acme Corp' },
	{ value: 'b2', label: 'Bigshop' }
];

// Svelte 5 $bindable values are not exposed on the component instance, and the
// controlled input's `.value` is unreliable in jsdom (it can show the local
// query even after the bound value reverts). To observe the actual bound value
// we render a tiny wrapper (AutocompleteBindProbe.svelte) that two-way-binds
// the value and mirrors it into a <div data-testid="probe">. That text is the
// oracle for whether the typed text was committed or discarded.

describe('Autocomplete', () => {
	it('commits a typed free-text value on blur when allowFreeText is set', async () => {
		// Regression: previously onInput updated only the local query buffer and
		// the bound value was set exclusively by select(). Typing a novel payee
		// (one not in the option list) and blurring left value='' — the payee
		// was silently dropped on save.
		render(BindProbe, { options: OPTS, allowFreeText: true });
		const input = screen.getByRole('combobox');
		await fireEvent.focus(input);
		await fireEvent.input(input, { target: { value: 'A Novel Payee' } });
		await fireEvent.blur(input);
		// The probe mirrors the bound value — it must hold the typed text.
		await waitForProbe('A Novel Payee');
	});

	it('discards typed text on blur when free text is NOT allowed (tag semantics)', async () => {
		// For id-backed fields (Tag → tagId ULID), typing a partial label must
		// NOT commit the typed text as the value; the bound value stays intact.
		render(BindProbe, { options: OPTS, allowFreeText: false, initial: 'a1' });
		const input = screen.getByRole('combobox');
		await fireEvent.focus(input);
		await fireEvent.input(input, { target: { value: 'partial' } });
		await fireEvent.blur(input);
		// Probe still shows the bound id 'a1' — typed text discarded.
		await waitForProbe('a1');
	});

	it('selecting an option commits its value', async () => {
		render(BindProbe, { options: OPTS, allowFreeText: true });
		const input = screen.getByRole('combobox');
		await fireEvent.focus(input);
		await fireEvent.input(input, { target: { value: 'Acme' } });
		await fireEvent.mouseDown(screen.getByRole('option', { name: 'Acme Corp' }));
		expect(screen.getByTestId('probe')).toHaveTextContent('a1');
	});

	it('defaults to NOT allowing free text (backward compatible with Tag usage)', async () => {
		render(BindProbe, { options: OPTS });
		const input = screen.getByRole('combobox');
		await fireEvent.focus(input);
		await fireEvent.input(input, { target: { value: 'whatever' } });
		await fireEvent.blur(input);
		// Probe is empty — bound value never received the typed text.
		await waitForProbe('');
	});
});

// Sanity: the bare component still renders a combobox (no regression on the
// default render path).
describe('Autocomplete render', () => {
	it('renders a combobox with the given label', () => {
		render(Autocomplete, { label: 'Payee', value: '', options: OPTS });
		expect(screen.getByRole('combobox')).toBeInTheDocument();
		expect(screen.getByText('Payee')).toBeInTheDocument();
	});
});

describe('keyboard selection', () => {
	it('opens and highlights the first option on ArrowDown', async () => {
		render(Autocomplete, { options: OPTS });
		const input = screen.getByRole('combobox');
		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		expect(screen.getByRole('listbox')).toBeInTheDocument();
		const opts = screen.getAllByRole('option');
		await vi.waitFor(() => expect(input).toHaveAttribute('aria-activedescendant', opts[0].id));
	});

	it('selects the highlighted option with Enter', async () => {
		const onselect = vi.fn();
		render(Autocomplete, { options: OPTS, value: 'a1', onselect });
		const input = screen.getByRole('combobox');
		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(onselect).toHaveBeenCalledWith('b2');
	});

	it('moves the highlight with ArrowUp / Home / End', async () => {
		render(Autocomplete, { options: OPTS });
		const input = screen.getByRole('combobox');
		const opts = () => screen.getAllByRole('option');
		await fireEvent.keyDown(input, { key: 'End' });
		await vi.waitFor(() => expect(input).toHaveAttribute('aria-activedescendant', opts()[1].id));
		await fireEvent.keyDown(input, { key: 'Home' });
		await vi.waitFor(() => expect(input).toHaveAttribute('aria-activedescendant', opts()[0].id));
		await fireEvent.keyDown(input, { key: 'ArrowUp' });
		await vi.waitFor(() => expect(input).toHaveAttribute('aria-activedescendant', opts()[1].id));
	});

	it('dismisses the listbox on Escape', async () => {
		render(Autocomplete, { options: OPTS });
		const input = screen.getByRole('combobox');
		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		expect(screen.getByRole('listbox')).toBeInTheDocument();
		await fireEvent.keyDown(input, { key: 'Escape' });
		expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
	});
});
