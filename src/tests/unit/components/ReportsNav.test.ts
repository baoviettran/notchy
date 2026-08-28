// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { get } from 'svelte/store';
import ReportsNav from '$lib/components/layout/ReportsNav.svelte';

// Mock $app/stores so $page.url.pathname is /reports (Flow group active).
vi.mock('$app/stores', () => ({
	page: {
		subscribe: (fn: (v: { url: { pathname: string } }) => void) => {
			fn({ url: { pathname: '/reports' } });
			return () => {};
		}
	}
}));

describe('ReportsNav', () => {
	it('renders three category groups with correct hrefs', () => {
		render(ReportsNav);
		expect(screen.getByRole('tab', { name: 'Flow' }).getAttribute('href')).toBe('/reports');
		expect(screen.getByRole('tab', { name: 'Breakdown' }).getAttribute('href')).toBe('/reports/category');
		expect(screen.getByRole('tab', { name: 'Compare' }).getAttribute('href')).toBe('/reports/compare');
	});

	it('renders sub-items for the active group (Flow when pathname is /reports)', () => {
		render(ReportsNav);
		expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('href')).toBe('/reports');
		expect(screen.getByRole('link', { name: 'Trend' }).getAttribute('href')).toBe('/reports/trend');
		expect(screen.getByRole('link', { name: 'Year Over Year' }).getAttribute('href')).toBe('/reports/yoy');
	});
});
