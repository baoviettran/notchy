import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import { BrowserDatabaseClient } from '$lib/db/browser/client';
import * as meta from '$lib/db/repos/meta';
import type { DatabaseService } from '$lib/db';

// Mock getDb to return our test db wrapped in AppDatabase
let db: DatabaseService;
let appDb: BrowserDatabaseClient;
vi.mock('$lib/db', () => ({
	getDb: () => appDb
}));

// Fresh import per test group to reset singleton state
let tour: typeof import('$lib/stores/tour.svelte').tour;

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
	appDb = new BrowserDatabaseClient(db);
	vi.resetModules();
	tour = (await import('$lib/stores/tour.svelte')).tour;
});

describe('tour.load', () => {
	it('grandfathers when first_run_complete=1 and tour_complete missing', async () => {
		await meta.setMeta(db, 'first_run_complete', '1');
		await tour.load();
		expect(tour.complete).toBe(true);
		expect(await meta.isTourComplete(db)).toBe(true);
	});

	it('does NOT grandfather when first_run_complete=0 (fresh user)', async () => {
		// first_run_complete is absent (fresh user mid-onboarding)
		await tour.load();
		expect(tour.complete).toBe(false);
		expect(await meta.isTourComplete(db)).toBe(false);
	});

	it('sets complete=true when tour_complete already set', async () => {
		await meta.setMeta(db, 'first_run_complete', '1');
		await meta.setTourComplete(db);
		await tour.load();
		expect(tour.complete).toBe(true);
	});
});

describe('tour.start', () => {
	it('does not start if tour already complete', async () => {
		await meta.setMeta(db, 'first_run_complete', '1');
		await meta.setTourComplete(db);
		await tour.load();
		tour.start();
		expect(tour.active).toBe(false);
	});

	it('starts when not complete', async () => {
		// Fresh user: first_run_complete not set
		await tour.load();
		tour.start();
		expect(tour.active).toBe(true);
		expect(tour.currentStep).toBe(0);
	});

	it('force start overrides complete flag', async () => {
		await meta.setMeta(db, 'first_run_complete', '1');
		await meta.setTourComplete(db);
		await tour.load();
		tour.start({ force: true });
		expect(tour.active).toBe(true);
		expect(tour.currentStep).toBe(0);
	});
});

describe('tour navigation', () => {
	beforeEach(async () => {
		// Fresh user: first_run_complete not set
		await tour.load();
		tour.start();
	});

	it('next advances step', () => {
		tour.next();
		expect(tour.currentStep).toBe(1);
	});

	it('back decrements step', () => {
		tour.next();
		tour.back();
		expect(tour.currentStep).toBe(0);
	});

	it('back does not go below 0', () => {
		tour.back();
		expect(tour.currentStep).toBe(0);
	});

	it('next past last step finishes tour', async () => {
		for (let i = 0; i < 5; i++) await tour.next();
		expect(tour.active).toBe(false);
		expect(await meta.isTourComplete(db)).toBe(true);
	});
});

describe('tour.skip', () => {
	it('sets tour_complete and deactivates', async () => {
		await meta.setMeta(db, 'first_run_complete', '1');
		await tour.load();
		tour.start();
		tour.skip();
		expect(tour.active).toBe(false);
		expect(await meta.isTourComplete(db)).toBe(true);
	});
});

describe('tour.finish', () => {
	it('sets tour_complete and deactivates', async () => {
		await meta.setMeta(db, 'first_run_complete', '1');
		await tour.load();
		tour.start();
		tour.finish();
		expect(tour.active).toBe(false);
		expect(await meta.isTourComplete(db)).toBe(true);
	});
});
