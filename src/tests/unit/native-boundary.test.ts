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
import { NativeDatabaseClient, databaseStatus } from '$lib/db/native/client';

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
			type: 'target',
			target_amount: 10000000,
			target_date: null,
			starting_amount: 0,
			show_on_dashboard: 1,
		});
		expect(lastCall().args).toMatchObject({
			name: 'Runway',
			goalType: 'target',
			targetAmount: 10000000,
			targetDate: null,
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