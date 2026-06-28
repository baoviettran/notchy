import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import * as goals from '$lib/db/repos/goals';
import * as accounts from '$lib/db/repos/accounts';
import type { DatabaseService } from '$lib/db/service';

let db: DatabaseService;

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
});

describe('createGoal', () => {
	it('creates a savings goal', async () => {
		const accId = await accounts.createAccount(db, { name: 'Savings', type: 'savings', currency: 'VND' });
		const id = await goals.createGoal(db, {
			name: 'Vacation', type: 'savings', target_amount: 10000000,
			target_date: '2027-01-01', linked_account_id: accId, starting_amount: 0
		});
		const goal = await goals.getGoal(db, id);
		expect(goal!.name).toBe('Vacation');
		expect(goal!.type).toBe('savings');
		expect(goal!.velocity_status).toBe('insufficient_data');
	});

	it('creates a net_worth goal without linked account', async () => {
		const id = await goals.createGoal(db, {
			name: 'Net Worth 100M', type: 'net_worth', target_amount: 100000000,
			target_date: '2030-01-01', starting_amount: 0
		});
		const goal = await goals.getGoal(db, id);
		expect(goal!.linked_account_id).toBeNull();
	});
});

describe('updateGoal', () => {
	it('marks goal as completed', async () => {
		const id = await goals.createGoal(db, {
			name: 'Test', type: 'savings', target_amount: 1000000,
			target_date: '2027-01-01', starting_amount: 0
		});
		await goals.updateGoal(db, id, { status: 'completed' });
		const goal = await goals.getGoal(db, id);
		expect(goal!.status).toBe('completed');
		expect(goal!.closed_at).not.toBeNull();
	});

	it('extends target date', async () => {
		const id = await goals.createGoal(db, {
			name: 'Test', type: 'savings', target_amount: 1000000,
			target_date: '2026-12-01', starting_amount: 0
		});
		await goals.updateGoal(db, id, { target_date: '2027-06-01' });
		const goal = await goals.getGoal(db, id);
		expect(goal!.target_date).toBe('2027-06-01');
	});
});

describe('deleteGoal', () => {
	it('soft-deletes a goal', async () => {
		const id = await goals.createGoal(db, {
			name: 'Test', type: 'savings', target_amount: 1000000,
			target_date: '2027-01-01', starting_amount: 0
		});
		await goals.deleteGoal(db, id);
		expect(await goals.getGoal(db, id)).toBeNull();
	});
});

describe('progress calculation', () => {
	it('computes progress percentage from account balance', async () => {
		const accId = await accounts.createAccount(db, {
			name: 'Savings', type: 'savings', currency: 'VND', initial_balance: 5000000
		});
		const id = await goals.createGoal(db, {
			name: 'Goal', type: 'savings', target_amount: 10000000,
			target_date: '2027-01-01', linked_account_id: accId, starting_amount: 0
		});
		const goal = await goals.getGoal(db, id);
		expect(goal!.current_amount).toBe(5000000);
		expect(goal!.progress_pct).toBe(50);
	});

	it('net_worth subtracts liability balances from asset balances', async () => {
		// Asset: 10,000,000 in checking
		const assetId = await accounts.createAccount(db, {
			name: 'Checking', type: 'checking', currency: 'VND', initial_balance: 10000000
		});
		// Liability: 4,000,000 credit-card balance
		const liabId = await accounts.createAccount(db, {
			name: 'Credit Card', type: 'credit_card', currency: 'VND', initial_balance: 4000000
		});
		const id = await goals.createGoal(db, {
			name: 'Net Worth', type: 'net_worth', target_amount: 100000000,
			target_date: '2030-01-01', starting_amount: 0
		});
		const goal = await goals.getGoal(db, id);
		// Net worth = assets − liabilities = 10,000,000 − 4,000,000 = 6,000,000.
		// Bug today: liabilities are summed as assets → 14,000,000.
		expect(goal!.current_amount).toBe(6000000);
	});
});

describe('listGoals', () => {
	it('returns all non-deleted goals with progress', async () => {
		await goals.createGoal(db, { name: 'A', type: 'net_worth', target_amount: 100000000, target_date: '2030-01-01', starting_amount: 0 });
		await goals.createGoal(db, { name: 'B', type: 'net_worth', target_amount: 50000000, target_date: '2028-01-01', starting_amount: 0 });
		const list = await goals.listGoals(db);
		expect(list).toHaveLength(2);
	});
});
