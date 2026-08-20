// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/svelte';
import { readFileSync } from 'fs';
import { resolve } from 'path';
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

    it('uses design-system tokens, not library fallbacks', () => {
        const source = readFileSync(
            resolve(import.meta.dirname, '../../../lib/components/charts/StackedAreaChart.svelte'),
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
