// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

// DatePicker formats and names months through the locale; the brand-new MCP
// `languageTag()` is the only runtime export DatePicker touches. It also lets a
// single test flip to `vi` to cover the locale ternary in MONTHS/dateFormatter.
const lang = vi.hoisted(() => ({ tag: 'en' }));
vi.mock('$lib/paraglide/runtime', () => ({ languageTag: () => lang.tag }));

import DatePickerBindProbe from './helpers/DatePickerBindProbe.svelte';

// Compute expectations from "now" rather than hardcoding, so the assertions
// stay correct if a run straddles midnight or a month boundary.
function nowParts() {
	const n = new Date();
	const m = String(n.getMonth() + 1).padStart(2, '0');
	const d = String(n.getDate()).padStart(2, '0');
	return { yyyymm: `${n.getFullYear()}-${m}`, today: `${n.getFullYear()}-${m}-${d}` };
}

describe('DatePicker', () => {
	beforeEach(() => {
		lang.tag = 'en';
	});

	it('shows the placeholder and opens the dialog on click', async () => {
		render(DatePickerBindProbe, { label: 'Target date' });
		expect(screen.getByLabelText('Target date')).toBeInTheDocument();
		expect(screen.queryByRole('dialog', { name: 'Date picker' })).not.toBeInTheDocument();

		await fireEvent.click(screen.getByLabelText('Target date'));
		expect(screen.getByRole('dialog', { name: 'Date picker' })).toBeInTheDocument();
	});

	it('closes when the open field is clicked again', async () => {
		render(DatePickerBindProbe, { label: 'Target date' });
		await fireEvent.click(screen.getByLabelText('Target date'));
		expect(screen.getByRole('dialog', { name: 'Date picker' })).toBeInTheDocument();
		await fireEvent.click(screen.getByLabelText('Target date'));
		expect(screen.queryByRole('dialog', { name: 'Date picker' })).not.toBeInTheDocument();
	});

	it('closes the open panel on Escape', async () => {
		render(DatePickerBindProbe, { label: 'Target date' });
		await fireEvent.click(screen.getByLabelText('Target date'));
		expect(screen.getByRole('dialog', { name: 'Date picker' })).toBeInTheDocument();
		// Await so Svelte flushes the open→false unmount before we query.
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(screen.queryByRole('dialog', { name: 'Date picker' })).not.toBeInTheDocument();
	});

	it('selecting a day sets the bound value and closes the panel', async () => {
		render(DatePickerBindProbe, { label: 'Target date' });
		await fireEvent.click(screen.getByLabelText('Target date'));
		await fireEvent.click(screen.getByText('15'));

		expect(screen.getByTestId('value').textContent).toBe(`${nowParts().yyyymm}-15`);
		expect(screen.queryByRole('dialog', { name: 'Date picker' })).not.toBeInTheDocument();
	});

	it('pads single-digit days to two digits', async () => {
		render(DatePickerBindProbe, { label: 'Target date' });
		await fireEvent.click(screen.getByLabelText('Target date'));
		await fireEvent.click(screen.getByText('1'));

		expect(screen.getByTestId('value').textContent).toBe(`${nowParts().yyyymm}-01`);
	});

	it('labels months in the active locale', async () => {
		lang.tag = 'vi';
		render(DatePickerBindProbe, { label: 'Target date', initial: '2026-06-05' });
		await fireEvent.click(screen.getByLabelText('Target date'));
		// The header span is "MONTH[l] year". Under vi-VN the month localizes
		// (e.g. "tháng 6"); asserting it's no longer the English form proves the
		// locale ternary runs without pinning a specific Vietnamese word.
		const header = screen.getByRole('dialog', { name: 'Bộ chọn ngày' }).querySelector('.text-sm.font-medium');
		expect(header?.textContent).toContain('2026');
		expect(header?.textContent).not.toBe('June 2026');
	});

	it('labels the dialog and grid in the active locale (vi)', async () => {
		// The two labels that were hardcoded English ("Date picker" /
		// "Calendar") — the vi flip proves they route through paraglide now.
		lang.tag = 'vi';
		render(DatePickerBindProbe, { label: 'Target date' });
		await fireEvent.click(screen.getByLabelText('Target date'));

		expect(screen.getByRole('dialog', { name: 'Bộ chọn ngày' })).toBeInTheDocument();
		expect(screen.getByRole('grid', { name: 'Lịch' })).toBeInTheDocument();
	});

	it('navigates across a year boundary forward', async () => {
		// Open on December 2026 → next month wraps to January 2027.
		render(DatePickerBindProbe, { label: 'Target date', initial: '2026-12-15' });
		await fireEvent.click(screen.getByLabelText('Target date'));
		await fireEvent.click(screen.getByText('▶'));

		expect(screen.getByText('January 2027')).toBeInTheDocument();
	});

	it('navigates across a year boundary backward', async () => {
		// Open on January 2026 → previous month wraps to December 2025.
		render(DatePickerBindProbe, { label: 'Target date', initial: '2026-01-05' });
		await fireEvent.click(screen.getByLabelText('Target date'));
		await fireEvent.click(screen.getByText('◀'));

		expect(screen.getByText('December 2025')).toBeInTheDocument();
	});

	it('selects today', async () => {
		render(DatePickerBindProbe, { label: 'Target date' });
		await fireEvent.click(screen.getByLabelText('Target date'));
		await fireEvent.click(screen.getByText('Today'));

		expect(screen.getByTestId('value').textContent).toBe(nowParts().today);
		expect(screen.queryByRole('dialog', { name: 'Date picker' })).not.toBeInTheDocument();
	});

	it('clears an existing value via the Clear action', async () => {
		render(DatePickerBindProbe, { label: 'Target date', initial: '2026-07-15' });
		await fireEvent.click(screen.getByLabelText('Target date'));
		await fireEvent.click(screen.getByText('Clear'));

		expect(screen.getByTestId('value').textContent).toBe('');
	});

	it('formats an existing value as a localized display instead of the placeholder', () => {
		render(DatePickerBindProbe, { label: 'Target date', initial: '2026-07-15' });
		// en-US → mm/dd/yyyy.
		expect(screen.getByText('07/15/2026')).toBeInTheDocument();
		expect(screen.queryByText('dd/mm/yyyy')).not.toBeInTheDocument();
	});

	it('disabled field neither formats nor opens', async () => {
		render(DatePickerBindProbe, { label: 'Target date', disabled: true });
		const field = screen.getByLabelText('Target date') as HTMLButtonElement;
		expect(field.disabled).toBe(true);

		await fireEvent.click(field);
		expect(screen.queryByRole('dialog', { name: 'Date picker' })).not.toBeInTheDocument();
	});

	// --- Keyboard navigation (ARIA grid roving tabindex) ---
	// The grid marks the keyboard-focused day with tabindex=0 (roving tabindex),
	// so focus assertions read the DOM instead of component internals.

	async function openOn(initial?: string) {
		render(DatePickerBindProbe, { label: 'Target date', ...(initial ? { initial } : {}) });
		await fireEvent.click(screen.getByLabelText('Target date'));
		return screen.getByRole('grid');
	}

	function focusedDay() {
		return screen
			.getAllByRole('gridcell')
			.map((c) => c.querySelector('button'))
			.find((b) => b?.tabIndex === 0)?.textContent;
	}

	it('moves focus with arrow keys within the month', async () => {
		const grid = await openOn('2026-06-15');
		expect(focusedDay()).toBe('15');

		await fireEvent.keyDown(grid, { key: 'ArrowRight' });
		expect(focusedDay()).toBe('16');
		await fireEvent.keyDown(grid, { key: 'ArrowDown' });
		expect(focusedDay()).toBe('23');
		await fireEvent.keyDown(grid, { key: 'ArrowUp' });
		expect(focusedDay()).toBe('16');
		await fireEvent.keyDown(grid, { key: 'ArrowLeft' });
		expect(focusedDay()).toBe('15');
	});

	it('moves focus backward across a month boundary', async () => {
		const grid = await openOn('2026-06-01');
		await fireEvent.keyDown(grid, { key: 'ArrowLeft' });

		expect(screen.getByText('May 2026')).toBeInTheDocument();
		expect(focusedDay()).toBe('31');
	});

	it('moves focus forward across a month boundary', async () => {
		const grid = await openOn('2026-06-30');
		await fireEvent.keyDown(grid, { key: 'ArrowRight' });

		expect(screen.getByText('July 2026')).toBeInTheDocument();
		expect(focusedDay()).toBe('1');
	});

	it('jumps to first and last day with Home and End', async () => {
		const grid = await openOn('2026-06-15');
		await fireEvent.keyDown(grid, { key: 'End' });
		expect(focusedDay()).toBe('30');

		await fireEvent.keyDown(grid, { key: 'Home' });
		expect(focusedDay()).toBe('1');
	});

	it('flips month with PageUp/PageDown, clamping the focus day', async () => {
		// March 31 → April has 30 days, so the focus day clamps to 30.
		const grid = await openOn('2026-03-31');
		await fireEvent.keyDown(grid, { key: 'PageDown' });

		expect(screen.getByText('April 2026')).toBeInTheDocument();
		expect(focusedDay()).toBe('30');

		await fireEvent.keyDown(grid, { key: 'PageUp' });
		expect(screen.getByText('March 2026')).toBeInTheDocument();
		expect(focusedDay()).toBe('30');
	});

	it('selects the focused day with Enter and closes the panel', async () => {
		const grid = await openOn('2026-06-15');
		await fireEvent.keyDown(grid, { key: 'ArrowRight' });
		await fireEvent.keyDown(grid, { key: 'Enter' });

		expect(screen.getByTestId('value').textContent).toBe('2026-06-16');
		expect(screen.queryByRole('dialog', { name: 'Date picker' })).not.toBeInTheDocument();
	});

	it('mid-month header arrows step a single month', async () => {
		await openOn('2026-06-15');
		await fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
		expect(screen.getByText('July 2026')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
		expect(screen.getByText('May 2026')).toBeInTheDocument();
	});
});