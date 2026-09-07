// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

// Money reads the active locale/currency to format + decide whether to compact.
// VND has 0 fraction digits, so integer amounts pass through untransformed.
vi.mock('$lib/stores/settings.svelte', () => ({
	settings: { locale: 'en', currency: 'VND' }
}));

import Money from '$lib/components/reports/Money.svelte';

type MoneyProps = { tone?: 'ledger' | 'dim' | 'phosphor' | 'debit' };
const BOGUS_TONE = 'bogus' as unknown as MoneyProps['tone'];

function figure(container: HTMLElement): HTMLElement {
	const el = container.querySelector('[aria-hidden="true"]');
	if (!el) throw new Error('visible figure span not found');
	return el as HTMLElement;
}

describe('Money', () => {
	it('renders a short positive figure with no sign glyph and no compact screen-reader twin', () => {
		const { container } = render(Money, { amount: 50000 });
		const f = figure(container);
		expect(f.textContent).toContain('50,000');
		expect(f.textContent?.startsWith('−')).toBe(false);
		expect(container.querySelector('.sr-only')).toBeNull();
	});

	it('prefixes a short negative figure with the minus glyph', () => {
		const { container } = render(Money, { amount: -50000 });
		expect(figure(container).textContent?.startsWith('−')).toBe(true);
		expect(container.querySelector('.sr-only')).toBeNull();
	});

	it('honors an explicit glyph over the sign', () => {
		const { container } = render(Money, { amount: -50000, glyph: '+' });
		const f = figure(container);
		expect(f.textContent?.startsWith('+')).toBe(true);
		expect(f.textContent?.startsWith('−')).toBe(false);
	});

	it('compacts a long figure and announces the full-precision value to assistive tech', () => {
		const { container } = render(Money, { amount: 1000000000000 });
		const f = figure(container);
		// The visible span falls back to the compact form.
		expect(f.textContent?.length).toBeLessThan(20);
		// The sr-only twin carries the full figure + a title affordance.
		const sr = container.querySelector('.sr-only');
		expect(sr?.textContent).toContain('1,000,000,000,000');
		const root = container.querySelector('.figures');
		expect(root?.getAttribute('title')).toContain('1,000,000,000,000');
	});

	it('applies the tone and glow classes', () => {
		const { container } = render(Money, { amount: 1000, tone: 'debit', glow: true });
		const root = container.querySelector('.figures');
		expect(root?.classList.contains('text-debit')).toBe(true);
		expect(root?.classList.contains('figures-glow')).toBe(true);
	});

	it('defaults to the ledger tone without glow', () => {
		const { container } = render(Money, { amount: 1000 });
		const root = container.querySelector('.figures');
		expect(root?.classList.contains('text-ledger')).toBe(true);
		expect(root?.classList.contains('figures-glow')).toBe(false);
	});

	it('appends extra classes passed through', () => {
		const { container } = render(Money, { amount: 1000, class: 'font-bold' });
		expect(container.querySelector('.font-bold')).not.toBeNull();
	});

	it('compacts a long negative figure with the minus glyph on both twins', () => {
		const { container } = render(Money, { amount: -1_500_000_000 });
		const compact = container.querySelector('[aria-hidden="true"]');
		expect(compact?.textContent?.startsWith('−')).toBe(true);
		expect(container.querySelector('.sr-only')?.textContent?.startsWith('−')).toBe(true);
	});

	it('compacted figures expand on click without relying on title', async () => {
		const { container } = render(Money, { amount: 1_500_000_000 });
		// A long figure is a real button (keyboard/touch operable), not only a
		// span with a hover title.
		const btn = container.querySelector('button.figures-expand') as HTMLButtonElement | null;
		expect(btn).not.toBeNull();
		expect(btn?.getAttribute('type')).toBe('button');
		// Collapsed: compact visible text, sr-only full figure, title kept as a
		// redundant mouse hint, aria-label announces the expand action.
		const compact = btn?.querySelector('[aria-hidden="true"]');
		expect(compact?.textContent).toContain('1.5');
		expect(btn?.querySelector('.sr-only')?.textContent).toContain('1,500,000,000');
		// Redundant mouse hint stays on the outer figures span.
		expect(container.querySelector('.figures')?.getAttribute('title')).toContain('1,500,000,000');
		expect(btn?.getAttribute('aria-label')).toBe('Show exact amount');
		// Click → the exact figure is visible (no sr-only twin needed).
		await fireEvent.click(btn as HTMLButtonElement);
		expect(btn?.textContent).toContain('1,500,000,000');
		expect(btn?.getAttribute('aria-label')).toBe('Show compact amount');
		// Click again → back to compact.
		await fireEvent.click(btn as HTMLButtonElement);
		expect(btn?.querySelector('[aria-hidden="true"]')?.textContent).toContain('1.5');
		expect(btn?.getAttribute('aria-label')).toBe('Show exact amount');
	});

	it('expand click neither default-navigates an ancestor anchor nor bubbles to an ancestor button', async () => {
		const wrapper = document.createElement('div');
		document.body.appendChild(wrapper);

		// Hazard 1 (dashboard / account row): Money sits inside an <a href>.
		// jsdom anchors never navigate, so assert on the event itself: the
		// dispatch must come back cancelled (preventDefault called), which is
		// what suppresses the ancestor anchor's navigation.
		const anchor = document.createElement('a');
		anchor.href = '/recent';
		const anchorMount = document.createElement('span');
		anchor.appendChild(anchorMount);
		wrapper.appendChild(anchor);
		const r1 = render(Money, { props: { amount: 1_500_000_000 }, target: anchorMount });
		const btn1 = anchorMount.querySelector('button.figures-expand') as HTMLButtonElement;
		expect(btn1).not.toBeNull();
		expect(await fireEvent.click(btn1)).toBe(false); // cancelled → no row navigation
		r1.unmount();

		// Hazard 2 (frequent chip): Money sits inside a parent <button> with
		// its own handler — a bubble-through there would fire armOrRepeat and
		// record a real transaction, so the click must not reach it.
		const parentBtn = document.createElement('button');
		parentBtn.type = 'button';
		const chipMount = document.createElement('span');
		parentBtn.appendChild(chipMount);
		wrapper.appendChild(parentBtn);
		const onChipClick = vi.fn();
		parentBtn.addEventListener('click', onChipClick);
		const r2 = render(Money, { props: { amount: 1_500_000_000 }, target: chipMount });
		const btn2 = chipMount.querySelector('button.figures-expand') as HTMLButtonElement;
		expect(btn2).not.toBeNull();
		await fireEvent.click(btn2);
		expect(onChipClick).not.toHaveBeenCalled();

		r2.unmount();
		wrapper.remove();
	});

	it('keeps short figures a plain span with no toggle button', () => {
		const { container } = render(Money, { amount: 50000 });
		expect(container.querySelector('button.figures-expand')).toBeNull();
	});

	it('tolerates an unknown tone without crashing', () => {
		// Defensive: an out-of-enum tone must degrade to the base figure styles,
		// not throw or blank the figure — for both short and compacted figures.
		const short = render(Money, { amount: 1000, tone: BOGUS_TONE });
		expect(short.container.querySelector('.figures')).not.toBeNull();
		expect(figure(short.container).textContent).toContain('1,000');

		const long = render(Money, { amount: 1_500_000_000, tone: BOGUS_TONE });
		expect(long.container.querySelector('button.figures-expand')).not.toBeNull();
	});

	it('collapses an expanded figure when the amount changes', async () => {
		const { container, rerender } = render(Money, { amount: 1_500_000_000 });
		const btn = container.querySelector('button.figures-expand') as HTMLButtonElement;
		await fireEvent.click(btn);
		expect(btn.getAttribute('aria-label')).toBe('Show compact amount');
		await rerender({ amount: 2_000_000_000 });
		expect(btn.getAttribute('aria-label')).toBe('Show exact amount');
	});
});