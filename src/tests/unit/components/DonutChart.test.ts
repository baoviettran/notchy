// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/svelte';
import DonutChart from '../../../lib/components/charts/DonutChart.svelte';

// Mock ResizeObserver for LayerCake
beforeAll(() => {
	global.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});

describe('DonutChart', () => {
    it('renders correct number of arcs', () => {
        const data = [
            { label: 'A', value: 100, color: '#f00' },
            { label: 'B', value: 200, color: '#0f0' }
        ];
        const { container } = render(DonutChart, { props: { data } });
        const paths = container.querySelectorAll('path');
        expect(paths.length).toBe(2);
    });

    it('renders legend items matching data length', () => {
        const data = [
            { label: 'A', value: 100, color: '#f00' },
            { label: 'B', value: 200, color: '#0f0' },
            { label: 'C', value: 50, color: '#00f' }
        ];
        const { container } = render(DonutChart, { props: { data } });
        const legendItems = container.querySelectorAll('.legend-item');
        expect(legendItems.length).toBe(3);
    });

    it('renders nothing when data is empty', () => {
        const { container } = render(DonutChart, { props: { data: [] } });
        const svg = container.querySelector('svg');
        expect(svg).toBeNull();
    });

	it('applies colors through the style attribute so CSS var() references resolve', () => {
		const data = [{ label: 'A', value: 100, color: 'var(--phosphor)' }];
		const { container } = render(DonutChart, { props: { data } });
		const path = container.querySelector('path');
		expect(path?.getAttribute('style')).toContain('var(--phosphor)');
	});

	it('renders the center label when provided', () => {
		const data = [{ label: 'A', value: 100, color: 'var(--phosphor)' }];
		const { container } = render(DonutChart, {
			props: { data, centerLabel: '1,234 ₫' }
		});
		expect(container.textContent).toContain('1,234 ₫');
	});
});
