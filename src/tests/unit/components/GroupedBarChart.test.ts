// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/svelte';
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
});
