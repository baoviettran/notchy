// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/svelte';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import GroupedBarChart from '../../../lib/components/charts/GroupedBarChart.svelte';

// Mock ResizeObserver for LayerCake
beforeAll(() => {
	global.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});

describe('GroupedBarChart', () => {
	it('renders SVG with grouped bars', () => {
		const data = [
			{
				month: '01',
				yearAIncome: 5000,
				yearAExpense: 3000,
				yearBIncome: 5500,
				yearBExpense: 3200
			}
		];
		const { container } = render(GroupedBarChart, {
			props: {
				data,
				yFormat: (n) => `$${n}`,
				xFormat: (m) => m
			}
		});
		const svg = container.querySelector('svg');
		expect(svg).not.toBeNull();
	});

	it('renders legend with 4 series', () => {
		const data = [
			{
				month: '01',
				yearAIncome: 5000,
				yearAExpense: 3000,
				yearBIncome: 5500,
				yearBExpense: 3200
			}
		];
		const { container } = render(GroupedBarChart, {
			props: {
				data,
				yFormat: (n) => `$${n}`,
				xFormat: (m) => m
			}
		});
		const legendItems = container.querySelectorAll('.legend-item');
		expect(legendItems.length).toBe(4);
	});

	it('renders empty state when data is empty', () => {
		const { container } = render(GroupedBarChart, {
			props: {
				data: [],
				yFormat: (n) => `$${n}`,
				xFormat: (m) => m
			}
		});
		const svg = container.querySelector('svg');
		expect(svg).toBeNull();
	});

	it('uses the two-ink palette and fades year B to half strength', () => {
		const data = [
			{
				month: '01',
				yearAIncome: 5000,
				yearAExpense: 3000,
				yearBIncome: 5500,
				yearBExpense: 3200
			}
		];
		const { container } = render(GroupedBarChart, {
			props: {
				data,
				yFormat: (n) => `$${n}`,
				xFormat: (m) => m
			}
		});
		const rects = container.querySelectorAll('rect');
		expect(rects.length).toBe(4);
		expect(rects[0].getAttribute('style')).toContain('var(--phosphor)');
		expect(rects[1].getAttribute('style')).toContain('var(--debit)');
		expect(rects[0].getAttribute('opacity')).toBe('1');
		expect(rects[2].getAttribute('opacity')).toBe('0.55');
		expect(rects[3].getAttribute('opacity')).toBe('0.55');
	});

	it('uses design-system tokens, not library fallbacks', () => {
		const source = readFileSync(
			resolve(import.meta.dirname, '../../../lib/components/charts/GroupedBarChart.svelte'),
			'utf-8'
		);
		const styleBlock = source.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
		expect(styleBlock).toMatch(/\.axis-line\s*\{[^}]*var\(--line\)/);
		expect(styleBlock).toMatch(/\.tick-label\s*\{[^}]*var\(--dim\)/);
		expect(styleBlock).toMatch(/\.legend-label\s*\{[^}]*var\(--dim\)/);
		expect(styleBlock).not.toContain('--color-');
		expect(styleBlock).not.toContain('#666');
	});
});
