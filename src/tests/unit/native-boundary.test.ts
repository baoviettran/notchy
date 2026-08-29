/**
 * Native DB boundary contract test.
 *
 * Locks the live-desktop seam: `NativeDatabaseClient` -> Rust `#[tauri::command]`.
 * Every op's command NAME must match the registered Rust surface
 * (`src-tauri/src/lib.rs` `generate_handler!`), its ARG KEYS must be the
 * camelCase form the IPC layer snake_cases to the Rust params, and returned
 * values must deserialize to the documented domain types.
 *
 * Before this test, the only coverage of `db/native/client.ts` was that invoke
 * errors propagate (`native-client.test.ts`). This is the first assertion that
 * a correct operation is issued with the right command and argument shape.
 *
 * The mock substitutes for Tauri's IPC bridge: `invoke(cmd, args)` records the
 * pair and returns a per-command fixture. It does NOT exercise the real Rust
 * side (the Rust commands keep their `cargo test` coverage in CI / `pnpm tauri
 * dev`). This is the approved JS-side substitute for real-native smoke.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NewAccount, NewTransaction, NewGoal, NewCategorizeRule } from '$lib/db/client';

// Hoisted so the module mock can reference it before `@tauri-apps/api/core`
// is imported by client.ts.
const { invokeMock, calls } = vi.hoisted(() => {
	const calls: Array<{ command: string; args?: unknown }> = [];
	// Plain JSON fixtures keyed by registered Rust command name.
	const FIXTURES: Record<string, unknown> = {
		account_list: [
			{
				id: 'acct1',
				name: 'Cash',
				type: 'cash',
				counterparty: null,
				currency: 'VND',
				archived: 0,
				created_at: '2026-01-01T00:00:00Z',
				updated_at: '2026-01-01T00:00:00Z',
				balance: 0,
			},
		],
		account_get_balance: 50000,
		transaction_create: 'txn1',
		category_list_buckets: [],
		budget_get_for_month: [],
		goal_list: [],
		rule_list: [],
		meta_get: 'vi',
		debt_list: { i_owe: [], owed_to_me: [] },
		reconciliation_get_history: [],
		report_get_overview: {},
		database_status: { lifecycle: 'ready' },
	};

	const invokeMock = vi.fn(async (command: string, args?: unknown) => {
		calls.push({ command, args });
		return FIXTURES[command] ?? null;
	});

	return { invokeMock, calls };
});

vi.mock('@tauri-apps/api/core', () => ({
	invoke: invokeMock,
}));

import { invoke } from '@tauri-apps/api/core';
import { NativeDatabaseClient, databaseStatus, databaseRetry } from '$lib/db/native/client';

function lastCall() {
	return calls[calls.length - 1];
}

beforeEach(() => {
	calls.length = 0;
});

afterEach(() => {
	calls.length = 0;
});

describe('NativeDatabaseClient: command-name mapping (vs src-tauri/src/lib.rs)', () => {
	const client = new NativeDatabaseClient();

	it('lifecycle databaseStatus issues the registered database_status command', async () => {
		await databaseStatus();
		expect(lastCall().command).toBe('database_status');
	});

	it('accounts: getBalance issues account_get_balance', async () => {
		await client.accounts.getBalance('acc1');
		expect(lastCall().command).toBe('account_get_balance');
	});

	it('transactions: create issues transaction_create', async () => {
		await client.transactions.create({
			kind: 'expense',
			date: '2026-01-15',
			amount: 50000,
			account_id: 'acc1',
		});
		expect(lastCall().command).toBe('transaction_create');
	});

	it('categories: listBuckets issues category_list_buckets', async () => {
		await client.categories.listBuckets();
		expect(lastCall().command).toBe('category_list_buckets');
	});

	it('budgets: getForMonth issues budget_get_for_month', async () => {
		await client.budgets.getForMonth('2026-01');
		expect(lastCall().command).toBe('budget_get_for_month');
	});

	it('goals: list issues goal_list', async () => {
		await client.goals.list();
		expect(lastCall().command).toBe('goal_list');
	});

	it('rules: list issues rule_list', async () => {
		await client.rules.list();
		expect(lastCall().command).toBe('rule_list');
	});

	it('meta: get issues meta_get', async () => {
		await client.meta.get('locale');
		expect(lastCall().command).toBe('meta_get');
	});

	it('debts: list issues debt_list', async () => {
		await client.debts.list();
		expect(lastCall().command).toBe('debt_list');
	});

	it('reconciliations: getHistory issues reconciliation_get_history', async () => {
		await client.reconciliations.getHistory('acc1');
		expect(lastCall().command).toBe('reconciliation_get_history');
	});

	it('reports: getOverview issues report_get_overview', async () => {
		await client.reports.getOverview('2026-01');
		expect(lastCall().command).toBe('report_get_overview');
	});
});

describe('NativeDatabaseClient: serialization seam (camelCase keys -> snake_case Rust params)', () => {
	const client = new NativeDatabaseClient();

	// The suspected live bug from the inventory: JS passes `accountId` but the
	// Rust command takes `account_id`. Tauri v2 IPC converts camelCase invoke
	// keys to snake_case command args by default, so this is GREEN — the client
	// correctly sends `accountId`, which Tauri renames to `account_id`. A
	// regression here (key renamed to snake_case in JS, or a key typo) would
	// make every affected op fail arg deserialization in the real app.
	it('account_get_balance sends the camelCase accountId key', async () => {
		await client.accounts.getBalance('acc1');
		expect(lastCall().args).toEqual({ accountId: 'acc1' });
	});

	it('budget_get_spent_for_bucket sends typeId + month (-> type_id, month)', async () => {
		await client.budgets.getSpentForBucket('bucketType1', '2026-01');
		expect(lastCall().args).toEqual({ typeId: 'bucketType1', month: '2026-01' });
	});

	it('debt_write_off sends accountId + amount + tagId (-> account_id, amount, tag_id)', async () => {
		await client.debts.writeOff('acc1', 10000, 'tag1');
		expect(lastCall().args).toEqual({ accountId: 'acc1', amount: 10000, tagId: 'tag1' });
	});

	it('reconciliation_reconcile sends createAdjustment (-> create_adjustment)', async () => {
		await client.reconciliations.reconcile('acc1', 5000, true);
		expect(lastCall().args).toEqual({
			accountId: 'acc1',
			actualBalance: 5000,
			createAdjustment: true,
			notes: null,
		});
	});

	it('goal_create sends goalType/targetAmount/... (-> goal_type/target_amount/...)', async () => {
		await client.goals.create({
			name: 'Runway',
			type: 'savings', // GoalType: "savings" | "debt_payoff" | "net_worth"
			target_amount: 10000000,
			target_date: '2027-12-31', // target_date is a required string on create
			starting_amount: 0,
			show_on_dashboard: 1,
		});
		expect(lastCall().args).toMatchObject({
			name: 'Runway',
			goalType: 'savings',
			targetAmount: 10000000,
			targetDate: '2027-12-31',
			startingAmount: 0,
			showOnDashboard: 1,
		});
	});

	it('transaction_list forwards the filter object unchanged (no per-key rename needed)', async () => {
		const filter = { account_id: 'acc1', limit: 20, offset: 0 };
		await client.transactions.list(filter);
		expect(lastCall().args).toEqual({ filter });
	});
});

describe('NativeDatabaseClient: result shaping', () => {
	const client = new NativeDatabaseClient();

	it('accounts.list resolves to the deserialized AccountWithBalance[]', async () => {
		const accounts = await client.accounts.list();
		expect(Array.isArray(accounts)).toBe(true);
		expect(accounts[0]).toMatchObject({
			id: 'acct1',
			name: 'Cash',
			balance: 0,
		});
	});

	it('transaction.create resolves to the created id string', async () => {
		const id = await client.transactions.create({
			kind: 'expense',
			date: '2026-01-15',
			amount: 50000,
			account_id: 'acc1',
		});
		expect(id).toBe('txn1');
	});

	it('account_get_balance resolves to the numeric balance', async () => {
		const balance = await client.accounts.getBalance('acc1');
		expect(balance).toBe(50000);
	});

	it('meta.get resolves the raw stored string value', async () => {
		const locale = await client.meta.get('locale');
		expect(locale).toBe('vi');
	});
});

describe('NativeDatabaseClient: mutation idempotency contract (documented, not asserted)', () => {
	const client = new NativeDatabaseClient();

	// FINDING: `db/native/client.ts`'s header comment says "Mutations generate an
	// operation ULID once per user intent; retry paths reuse the same ULID." That
	// claim is NOT implemented here — no op in this file mints or forwards an
	// operation id, and the `NewTransaction`/`NewAccount`/`NewGoal` domain types
	// carry no `operation_id` field. The real idempotency surface is the Rust
	// `operation_id_conflict` error code, which is exercised by `cargo test`.
	// So there is no JS-side retry-ULID behavior to lock; asserting one would
	// fabricate behavior. This test pins the CURRENT honest contract: mutations
	// pass only their domain payload, and an operation id field is NOT present.
	it('transaction_create carries no operation id (idempotency is Rust-side)', async () => {
		await client.transactions.create({
			kind: 'expense',
			date: '2026-01-15',
			amount: 50000,
			account_id: 'acc1',
		});
		expect(lastCall().args).toEqual({ input: {
			kind: 'expense',
			date: '2026-01-15',
			amount: 50000,
			account_id: 'acc1',
		} });
		expect(JSON.stringify(lastCall().args)).not.toContain('operation_id');
	});
});

describe('NativeDatabaseClient: full surface sweep (command name + camelCase arg key set)', () => {
	// Task 5 Step 3 response: the boundary test originally asserted ~10 ops, so
	// db/native/client.ts scored 23.53% total mutation / 54.37% covered, with 135
	// surviving mutants because the rest of the ~70-command surface was never
	// exercised. This sweep invokes every op and locks (a) the REGISTERED snake_case
	// command name and (b) the camelCase arg-KEY SET sent over the IPC seam. A
	// command-string mutant or an arg-key rename mutant now kills a test.
	//
	// The sweep asserts shape, not values: create/update inputs are cast minimal
	// literals because the ops pass the payload through untouched (no runtime
	// validation on the JS side). Precise multi-field assertions for the complex
	// creates are covered by the dedicated tests above.

	interface Row {
		label: string;
		run: () => Promise<unknown>;
		command: string;
		argKeys: string[] | null;
	}

	const client = new NativeDatabaseClient();

	const rows: Row[] = [
		// Lifecycle (module fns)
		{ label: 'databaseInitialize', run: () => databaseRetry(), command: 'database_retry', argKeys: null },

		// Accounts
		{ label: 'accounts.list', run: () => client.accounts.list(), command: 'account_list', argKeys: null },
		{ label: 'accounts.get', run: () => client.accounts.get('acc1'), command: 'account_get', argKeys: ['id'] },
		{ label: 'accounts.getBalanceAsOf', run: () => client.accounts.getBalanceAsOf('acc1', '2026-01-15'), command: 'account_get_balance_as_of', argKeys: ['accountId', 'date'] },
		{ label: 'accounts.create', run: () => client.accounts.create({ name: 'Cash', type: 'cash', currency: 'VND' } as NewAccount), command: 'account_create', argKeys: ['input'] },
		{ label: 'accounts.update', run: () => client.accounts.update('acc1', { name: 'Wallet' }), command: 'account_update', argKeys: ['id', 'patch'] },
		{ label: 'accounts.delete', run: () => client.accounts.delete('acc1'), command: 'account_delete', argKeys: ['id'] },
		{ label: 'accounts.restore', run: () => client.accounts.restore('acc1'), command: 'account_restore', argKeys: ['id'] },

		// Transactions
		{ label: 'transactions.list', run: () => client.transactions.list(), command: 'transaction_list', argKeys: ['filter'] },
		{ label: 'transactions.get', run: () => client.transactions.get('tx1'), command: 'transaction_get', argKeys: ['id'] },
		{ label: 'transactions.createBatch', run: () => client.transactions.createBatch([{ kind: 'expense', date: '2026-01-15', amount: 50000, account_id: 'acc1' } as NewTransaction]), command: 'transaction_create_batch', argKeys: ['inputs'] },
		{ label: 'transactions.update', run: () => client.transactions.update('tx1', { amount: 60000 }), command: 'transaction_update', argKeys: ['id', 'patch'] },
		{ label: 'transactions.delete', run: () => client.transactions.delete('tx1'), command: 'transaction_delete', argKeys: ['id'] },
		{ label: 'transactions.restore', run: () => client.transactions.restore('tx1'), command: 'transaction_restore', argKeys: ['id'] },
		{ label: 'transactions.duplicate', run: () => client.transactions.duplicate('tx1'), command: 'transaction_duplicate', argKeys: ['id'] },
		{ label: 'transactions.deleteMany', run: () => client.transactions.deleteMany(['tx1', 'tx2']), command: 'transaction_delete_many', argKeys: ['ids'] },
		{ label: 'transactions.setTagMany', run: () => client.transactions.setTagMany(['tx1'], 'tag1'), command: 'transaction_set_tag_many', argKeys: ['ids', 'tagId'] },
		{ label: 'transactions.setAccountMany', run: () => client.transactions.setAccountMany(['tx1'], 'acc1'), command: 'transaction_set_account_many', argKeys: ['ids', 'accountId'] },
		{ label: 'transactions.getFrequent', run: () => client.transactions.getFrequent('2026-01-01'), command: 'transaction_frequent', argKeys: ['sinceDate'] },

		// Categories
		{ label: 'categories.listBuckets', run: () => client.categories.listBuckets(), command: 'category_list_buckets', argKeys: null },
		{ label: 'categories.createBucket', run: () => client.categories.createBucket('Food'), command: 'category_create_bucket', argKeys: ['name', 'budgetable'] },
		{ label: 'categories.renameBucket', run: () => client.categories.renameBucket('b1', 'Food'), command: 'category_rename_bucket', argKeys: ['id', 'name'] },
		{ label: 'categories.setRolloverEnabled', run: () => client.categories.setRolloverEnabled('b1', false), command: 'category_set_rollover_enabled', argKeys: ['id', 'enabled'] },
		{ label: 'categories.deleteBucket', run: () => client.categories.deleteBucket('b1'), command: 'category_delete_bucket', argKeys: ['id'] },
		{ label: 'categories.listTags', run: () => client.categories.listTags('b1'), command: 'category_list_tags', argKeys: ['bucketId'] },
		{ label: 'categories.createTag', run: () => client.categories.createTag('Salary', 'b1'), command: 'category_create_tag', argKeys: ['name', 'bucketId'] },
		{ label: 'categories.renameTag', run: () => client.categories.renameTag('t1', 'Wages'), command: 'category_rename_tag', argKeys: ['id', 'name'] },
		{ label: 'categories.moveTag', run: () => client.categories.moveTag('t1', 'b2'), command: 'category_move_tag', argKeys: ['tagId', 'newBucketId'] },
		{ label: 'categories.getTagTransactionInfo', run: () => client.categories.getTagTransactionInfo('t1'), command: 'category_get_tag_transaction_info', argKeys: ['tagId'] },
		{ label: 'categories.deleteTag', run: () => client.categories.deleteTag('t1', 'uncategorise'), command: 'category_delete_tag', argKeys: ['id', 'option'] },

		// Budgets
		{ label: 'budgets.getRolledOver', run: () => client.budgets.getRolledOver('bt1', '2026-01'), command: 'budget_get_rolled_over', argKeys: ['typeId', 'month'] },
		{ label: 'budgets.setAllocation', run: () => client.budgets.setAllocation('bt1', '2026-01', 100000), command: 'budget_set_allocation', argKeys: ['typeId', 'month', 'allocated'] },
		{ label: 'budgets.copyFromPreviousMonth', run: () => client.budgets.copyFromPreviousMonth('2026-02'), command: 'budget_copy_from_previous_month', argKeys: ['targetMonth'] },
		{ label: 'budgets.hasAllocations', run: () => client.budgets.hasAllocations('2026-01'), command: 'budget_has_allocations', argKeys: ['month'] },

		// Goals
		{ label: 'goals.get', run: () => client.goals.get('g1'), command: 'goal_get', argKeys: ['id'] },
		{ label: 'goals.create', run: () => client.goals.create({ name: 'Runway', type: 'savings', target_amount: 10000000, target_date: '2027-12-31' } as NewGoal), command: 'goal_create', argKeys: ['name', 'goalType', 'targetAmount', 'targetDate', 'linkedAccountId', 'startingAmount', 'showOnDashboard'] },
		{ label: 'goals.update', run: () => client.goals.update('g1', { status: 'active' }), command: 'goal_update', argKeys: ['id', 'name', 'targetAmount', 'targetDate', 'showOnDashboard', 'status'] },
		{ label: 'goals.delete', run: () => client.goals.delete('g1'), command: 'goal_delete', argKeys: ['id'] },

		// Rules
		{ label: 'rules.listAll', run: () => client.rules.listAll(), command: 'rule_list_all', argKeys: null },
		{ label: 'rules.create', run: () => client.rules.create({ payee_term: 'walmart', match_mode: 'substring', tag_id: 't1', source: 'manual' } as unknown as NewCategorizeRule), command: 'rule_create', argKeys: ['payeeTerm', 'matchMode', 'tagId', 'source'] },
		{ label: 'rules.update', run: () => client.rules.update('r1', { enabled: 0 }), command: 'rule_update', argKeys: ['id', 'payeeTerm', 'matchMode', 'tagId', 'source', 'enabled'] },
		{ label: 'rules.delete', run: () => client.rules.delete('r1'), command: 'rule_delete', argKeys: ['id'] },
		{ label: 'rules.upsertLearned', run: () => client.rules.upsertLearned('walmart', 't1'), command: 'rule_upsert_learned', argKeys: ['payeeTerm', 'tagId'] },

		// Meta
		{ label: 'meta.set', run: () => client.meta.set('locale', 'vi'), command: 'meta_set', argKeys: ['key', 'value'] },
		{ label: 'meta.delete', run: () => client.meta.delete('locale'), command: 'meta_delete', argKeys: ['key'] },
		{ label: 'meta.isFirstRunComplete', run: () => client.meta.isFirstRunComplete(), command: 'meta_is_first_run_complete', argKeys: null },
		{ label: 'meta.getLocale', run: () => client.meta.getLocale(), command: 'meta_get_locale', argKeys: null },
		{ label: 'meta.getCurrency', run: () => client.meta.getCurrency(), command: 'meta_get_currency', argKeys: null },
		{ label: 'meta.isTourComplete', run: () => client.meta.isTourComplete(), command: 'meta_is_tour_complete', argKeys: null },
		{ label: 'meta.setTourComplete', run: () => client.meta.setTourComplete(), command: 'meta_set_tour_complete', argKeys: null },
		{ label: 'meta.setFirstRunComplete', run: () => client.meta.setFirstRunComplete(), command: 'meta_set_first_run_complete', argKeys: null },
		{ label: 'meta.getDefaultQuickAccount', run: () => client.meta.getDefaultQuickAccount(), command: 'meta_get_default_quick_account', argKeys: null },
		{ label: 'meta.setDefaultQuickAccount', run: () => client.meta.setDefaultQuickAccount('acc1'), command: 'meta_set_default_quick_account', argKeys: ['accountId'] },
		{ label: 'meta.clearDefaultQuickAccount', run: () => client.meta.clearDefaultQuickAccount(), command: 'meta_clear_default_quick_account', argKeys: null },

		// Debts
		{ label: 'debts.writeOff', run: () => client.debts.writeOff('acc1', 10000, 'tag1'), command: 'debt_write_off', argKeys: ['accountId', 'amount', 'tagId'] },

		// Reconciliations
		{ label: 'reconciliations.reconcile', run: () => client.reconciliations.reconcile('acc1', 5000, true, 'note'), command: 'reconciliation_reconcile', argKeys: ['accountId', 'actualBalance', 'createAdjustment', 'notes'] },

		// Reports
		{ label: 'reports.getTrend', run: () => client.reports.getTrend(12), command: 'report_get_trend', argKeys: ['months', 'includeAdjustments', 'bucketId'] },
		{ label: 'reports.getComparison', run: () => client.reports.getComparison('2026-01', '2026-02'), command: 'report_get_comparison', argKeys: ['monthA', 'monthB', 'includeAdjustments'] },
		{ label: 'reports.getCategoryTrend', run: () => client.reports.getCategoryTrend('t1', 12), command: 'report_get_category_trend', argKeys: ['tagId', 'months', 'includeAdjustments'] },
		{ label: 'reports.getStackedCategorySeries', run: () => client.reports.getStackedCategorySeries(12), command: 'report_get_stacked_category_series', argKeys: ['months', 'includeAdjustments'] },
		{ label: 'reports.getYearOverYear', run: () => client.reports.getYearOverYear(2025, 2026), command: 'report_get_year_over_year', argKeys: ['yearA', 'yearB', 'includeAdjustments'] },
		{ label: 'reports.getNetWorthSeries', run: () => client.reports.getNetWorthSeries(12), command: 'report_get_net_worth_series', argKeys: ['months', 'includeAdjustments'] },
	];

	it.each(rows.map((r) => [r.label, r.run, r.command, r.argKeys] as const))(
		'%s issues the registered %s command with the camelCase arg-key set',
		async (_label, run, command, argKeys) => {
			calls.length = 0;
			await run();
			expect(lastCall().command).toBe(command);
			const actualKeys = lastCall().args ? Object.keys(lastCall().args as object).sort() : null;
			expect(actualKeys).toEqual(argKeys ? argKeys.slice().sort() : null);
		}
	);
});