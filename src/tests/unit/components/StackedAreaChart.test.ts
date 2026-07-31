// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/svelte';
import StackedAreaChart from '$lib/components/charts/StackedAreaChart.svelte';

// Mock ResizeObserver for LayerCake
beforeAll(() => {
	global.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});

describe('StackedAreaChart', () => {
    it('renders SVG with stacked areas', () => {
        const data = [
            {
                month: '2026-01',
                tags: [
                    { tagId: 'a', name: 'Groceries', total: 200 },
                    { tagId: 'b', name: 'Rent', total: 1000 }
                ]
            }
        ];
        const colors = { a: '#f00', b: '#0f0' };
        const { container } = render(StackedAreaChart, {
            props: {
                data,
                yFormat: (n) => `$${n}`,
                xFormat: (m) => m,
                colors
            }
        });
        const svg = container.querySelector('svg');
        expect(svg).not.toBeNull();
    });

    it('renders legend with tags', () => {
        const data = [
            {
                month: '2026-01',
                tags: [
                    { tagId: 'a', name: 'Groceries', total: 200 },
                    { tagId: 'b', name: 'Rent', total: 1000 }
                ]
            }
        ];
        const colors = { a: '#f00', b: '#0f0' };
        const { container } = render(StackedAreaChart, {
            props: {
                data,
                yFormat: (n) => `$${n}`,
                xFormat: (m) => m,
                colors
            }
        });
        const legendItems = container.querySelectorAll('.legend-item');
        expect(legendItems.length).toBe(2);
    });

    it('renders empty state when data is empty', () => {
        const { container } = render(StackedAreaChart, {
            props: {
                data: [],
                yFormat: (n) => `$${n}`,
                xFormat: (m) => m,
                colors: {}
            }
        });
        const svg = container.querySelector('svg');
        expect(svg).toBeNull();
    });
});
