// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ReportsNav from '$lib/components/layout/ReportsNav.svelte';

describe('ReportsNav', () => {
	it('renders all seven report destinations with their routes', () => {
		render(ReportsNav);
		expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('href')).toBe('/reports');
		expect(screen.getByRole('link', { name: 'Trend' }).getAttribute('href')).toBe('/reports/trend');
		expect(screen.getByRole('link', { name: 'Compare' }).getAttribute('href')).toBe('/reports/compare');
		expect(screen.getByRole('link', { name: 'Net Worth' }).getAttribute('href')).toBe('/reports/net-worth');
		expect(screen.getByRole('link', { name: 'Tag Trend' }).getAttribute('href')).toBe('/reports/category');
		expect(screen.getByRole('link', { name: 'Composition' }).getAttribute('href')).toBe('/reports/composition');
		expect(screen.getByRole('link', { name: 'Year Over Year' }).getAttribute('href')).toBe('/reports/yoy');
	});
});
