// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/svelte';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import LineChart from '../../../lib/components/charts/LineChart.svelte';

// Mock ResizeObserver for LayerCake
beforeAll(() => {
	global.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});

describe('LineChart', () => {
	const sampleData = [
		{ x: new Date('2024-01-01'), y: 100 },
		{ x: new Date('2024-01-02'), y: 150 },
		{ x: new Date('2024-01-03'), y: 120 }
	];

	const xFormat = (d: Date) => d.toLocaleDateString();
	const yFormat = (n: number) => `$${n}`;

	it('renders SVG with line path', () => {
		const { container } = render(LineChart, {
			props: { data: sampleData, xFormat, yFormat }
		});
		const svg = container.querySelector('svg');
		expect(svg).not.toBeNull();
		const path = container.querySelector('path');
		expect(path).not.toBeNull();
	});

	it('renders axis labels', () => {
		const { container } = render(LineChart, {
			props: { data: sampleData, xFormat, yFormat }
		});
		const textElements = container.querySelectorAll('text');
		expect(textElements.length).toBeGreaterThan(0);
	});

	it('renders area fill when showArea is true', () => {
		const { container } = render(LineChart, {
			props: { data: sampleData, xFormat, yFormat, showArea: true }
		});
		const paths = container.querySelectorAll('path');
		expect(paths.length).toBeGreaterThanOrEqual(2);
	});

	it('renders empty state when data is empty', () => {
		const { container } = render(LineChart, {
			props: { data: [], xFormat, yFormat }
		});
		const svg = container.querySelector('svg');
		expect(svg).toBeNull();
	});

	it('uses design-system tokens, not library fallbacks', () => {
		const source = readFileSync(
			resolve(import.meta.dirname, '../../../lib/components/charts/LineChart.svelte'),
			'utf-8'
		);
		const styleBlock = source.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
		expect(styleBlock).toMatch(/\.line-stroke\s*\{[^}]*var\(--phosphor\)/);
		expect(styleBlock).toMatch(/\.tick-label\s*\{[^}]*var\(--dim\)/);
		expect(styleBlock).toMatch(/\.axis-line\s*\{[^}]*var\(--line\)/);
		expect(styleBlock).not.toContain('--color-');
		expect(styleBlock).not.toContain('#00ff00');
		expect(styleBlock).not.toContain('#666');
	});
});
