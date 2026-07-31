import { describe, it, expect, beforeEach } from 'vitest';
import { ReportsStore } from './reports.svelte';

describe('ReportsStore', () => {
	let store: ReportsStore;

	beforeEach(() => {
		store = new ReportsStore();
	});

	it('initializes with default values', () => {
		expect(store.window).toBe(12);
		expect(store.includeAdjustments).toBe(false);
		expect(store.netWorth).toEqual([]);
	});

	it('updates window state', () => {
		store.window = 6;
		expect(store.window).toBe(6);
	});

	it('updates includeAdjustments state', () => {
		store.includeAdjustments = true;
		expect(store.includeAdjustments).toBe(true);
	});
});
