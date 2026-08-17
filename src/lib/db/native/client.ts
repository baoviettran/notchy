/**
 * NativeDatabaseClient — wraps Tauri invoke() calls for the native database boundary.
 *
 * Each method delegates to a Rust command registered via `#[tauri::command]`.
 * Mutations generate an operation ULID once per user intent; retry paths reuse
 * the same ULID for idempotency.
 */
import { invoke } from '@tauri-apps/api/core';
import type {
	AppDatabase,
	AccountOps,
	TransactionOps,
	CategoryOps,
	BudgetOps,
	GoalOps,
	RuleOps,
	MetaOps,
	DebtOps,
	ReconciliationOps,
	ReportOps,
} from '../client';
import type { AccountType, AccountWithBalance, NewAccount } from '../client';
import type { TransactionKind, Transaction, NewTransaction, TransactionFilter } from '../client';
import type { Bucket, Tag, TagDeleteInfo } from '../client';
import type { BudgetSummary } from '../client';
import type { GoalWithProgress, NewGoal, GoalStatus } from '../client';
import type { CategorizeRule, NewCategorizeRule, CategorizeRuleUpdate } from '../client';
import type { DebtAccount } from '../client';
import type { Reconciliation, ReconcileResult } from '../client';
import type {
	OverviewReport,
	TrendPoint,
	CompareRow,
	CategoryTrendPoint,
	StackedCategoryPoint,
	YearOverYearPoint,
	NetWorthPoint,
} from '../client';

// ---------------------------------------------------------------------------
// Lifecycle commands (main-window only)
// ---------------------------------------------------------------------------

export interface DatabaseStatus {
	state: string;
	current?: { checking: Record<string, never> } | { backing_up: Record<string, never> } | { migrating: Record<string, never> } | { verifying: Record<string, never> } | { ready: Record<string, never> };
	recovery?: {
		code: string;
		app_version: string;
		latest_schema_version: number;
		detected_schema_version: number | null;
		live_database_path: string;
		backup_path: string | null;
		detail: string;
	} | null;
}

export function databaseInitialize(): Promise<DatabaseStatus> {
	return invoke<DatabaseStatus>('database_initialize');
}

export function databaseRetry(): Promise<DatabaseStatus> {
	return invoke<DatabaseStatus>('database_retry');
}

export function databaseStatus(): Promise<DatabaseStatus> {
	return invoke<DatabaseStatus>('database_status');
}

// ---------------------------------------------------------------------------
// Account operations
// ---------------------------------------------------------------------------

class NativeAccountOps implements AccountOps {
	list(): Promise<AccountWithBalance[]> {
		return invoke<AccountWithBalance[]>('account_list');
	}

	get(id: string): Promise<AccountWithBalance | null> {
		return invoke<AccountWithBalance | null>('account_get', { id });
	}

	getBalance(accountId: string): Promise<number> {
		return invoke<number>('account_get_balance', { accountId });
	}

	getBalanceAsOf(accountId: string, date: string): Promise<number> {
		return invoke<number>('account_get_balance_as_of', { accountId, date });
	}

	create(input: NewAccount): Promise<string> {
		return invoke<string>('account_create', { input });
	}

	update(id: string, patch: { name?: string; type?: AccountType; counterparty?: string | null; archived?: number }): Promise<void> {
		return invoke<void>('account_update', { id, patch });
	}

	delete(id: string): Promise<void> {
		return invoke<void>('account_delete', { id });
	}
}

// ---------------------------------------------------------------------------
// Transaction operations
// ---------------------------------------------------------------------------

class NativeTransactionOps implements TransactionOps {
	list(filter?: TransactionFilter): Promise<Transaction[]> {
		return invoke<Transaction[]>('transaction_list', { filter: filter ?? null });
	}

	get(id: string): Promise<Transaction | null> {
		return invoke<Transaction | null>('transaction_get', { id });
	}

	create(input: NewTransaction): Promise<string> {
		return invoke<string>('transaction_create', { input });
	}

	createBatch(inputs: NewTransaction[]): Promise<string[]> {
		return invoke<string[]>('transaction_create_batch', { inputs });
	}

	update(id: string, patch: Partial<NewTransaction>): Promise<void> {
		return invoke<void>('transaction_update', { id, patch });
	}

	delete(id: string): Promise<void> {
		return invoke<void>('transaction_delete', { id });
	}

	restore(id: string): Promise<void> {
		return invoke<void>('transaction_restore', { id });
	}

	duplicate(id: string): Promise<string> {
		return invoke<string>('transaction_duplicate', { id });
	}

	getFrequent(_sinceDate: string): Promise<import('../client').FrequentTx[]> {
		return invoke<import('../client').FrequentTx[]>('transaction_frequent', { sinceDate: _sinceDate });
	}
}

// ---------------------------------------------------------------------------
// Category operations
// ---------------------------------------------------------------------------

class NativeCategoryOps implements CategoryOps {
	listBuckets(): Promise<Bucket[]> {
		return invoke<Bucket[]>('category_list_buckets');
	}

	createBucket(name: string, budgetable?: number): Promise<string> {
		return invoke<string>('category_create_bucket', { name, budgetable: budgetable ?? null });
	}

	renameBucket(id: string, name: string): Promise<void> {
		return invoke<void>('category_rename_bucket', { id, name });
	}

	setRolloverEnabled(id: string, enabled: boolean): Promise<void> {
		return invoke<void>('category_set_rollover_enabled', { id, enabled });
	}

	deleteBucket(id: string): Promise<void> {
		return invoke<void>('category_delete_bucket', { id });
	}

	listTags(bucketId?: string): Promise<Tag[]> {
		return invoke<Tag[]>('category_list_tags', { bucketId: bucketId ?? null });
	}

	createTag(name: string, bucketId: string): Promise<string> {
		return invoke<string>('category_create_tag', { name, bucketId });
	}

	renameTag(id: string, name: string): Promise<void> {
		return invoke<void>('category_rename_tag', { id, name });
	}

	moveTag(tagId: string, newBucketId: string): Promise<TagDeleteInfo> {
		return invoke<TagDeleteInfo>('category_move_tag', { tagId, newBucketId });
	}

	getTagTransactionInfo(tagId: string): Promise<TagDeleteInfo> {
		return invoke<TagDeleteInfo>('category_get_tag_transaction_info', { tagId });
	}

	deleteTag(id: string, option: 'uncategorise' | { merge_into: string }): Promise<void> {
		return invoke<void>('category_delete_tag', { id, option: typeof option === 'string' ? option : JSON.stringify(option) });
	}
}

// ---------------------------------------------------------------------------
// Budget operations
// ---------------------------------------------------------------------------

class NativeBudgetOps implements BudgetOps {
	getForMonth(month: string): Promise<BudgetSummary[]> {
		return invoke<BudgetSummary[]>('budget_get_for_month', { month });
	}

	getSpentForBucket(typeId: string, month: string): Promise<number> {
		return invoke<number>('budget_get_spent_for_bucket', { typeId, month });
	}

	getRolledOver(typeId: string, month: string): Promise<number> {
		return invoke<number>('budget_get_rolled_over', { typeId, month });
	}

	setAllocation(typeId: string, month: string, allocated: number): Promise<void> {
		return invoke<void>('budget_set_allocation', { typeId, month, allocated });
	}

	copyFromPreviousMonth(targetMonth: string): Promise<void> {
		return invoke<void>('budget_copy_from_previous_month', { targetMonth });
	}

	hasAllocations(month: string): Promise<boolean> {
		return invoke<boolean>('budget_has_allocations', { month });
	}
}

// ---------------------------------------------------------------------------
// Goal operations
// ---------------------------------------------------------------------------

class NativeGoalOps implements GoalOps {
	list(): Promise<GoalWithProgress[]> {
		return invoke<GoalWithProgress[]>('goal_list');
	}

	get(id: string): Promise<GoalWithProgress | null> {
		return invoke<GoalWithProgress | null>('goal_get', { id });
	}

	create(input: NewGoal): Promise<string> {
		return invoke<string>('goal_create', {
			name: input.name,
			goalType: input.type,
			targetAmount: input.target_amount,
			targetDate: input.target_date,
			linkedAccountId: input.linked_account_id ?? null,
			startingAmount: input.starting_amount ?? 0,
			showOnDashboard: input.show_on_dashboard ?? 1,
		});
	}

	update(id: string, patch: Partial<NewGoal> & { status?: GoalStatus }): Promise<void> {
		return invoke<void>('goal_update', {
			id,
			name: patch.name ?? null,
			targetAmount: patch.target_amount ?? null,
			targetDate: patch.target_date ?? null,
			showOnDashboard: patch.show_on_dashboard ?? null,
			status: patch.status ?? null,
		});
	}

	delete(id: string): Promise<void> {
		return invoke<void>('goal_delete', { id });
	}
}

// ---------------------------------------------------------------------------
// Rule operations
// ---------------------------------------------------------------------------

class NativeRuleOps implements RuleOps {
	list(): Promise<CategorizeRule[]> {
		return invoke<CategorizeRule[]>('rule_list');
	}

	listAll(): Promise<CategorizeRule[]> {
		return invoke<CategorizeRule[]>('rule_list_all');
	}

	create(input: NewCategorizeRule): Promise<CategorizeRule> {
		return invoke<CategorizeRule>('rule_create', {
			payeeTerm: input.payee_term,
			matchMode: input.match_mode,
			tagId: input.tag_id,
			source: input.source ?? 'manual',
		});
	}

	update(id: string, patch: CategorizeRuleUpdate): Promise<CategorizeRule> {
		return invoke<CategorizeRule>('rule_update', {
			id,
			payeeTerm: patch.payee_term ?? null,
			matchMode: patch.match_mode ?? null,
			tagId: patch.tag_id ?? null,
			source: patch.source ?? null,
			enabled: patch.enabled ?? null,
		});
	}

	delete(id: string): Promise<void> {
		return invoke<void>('rule_delete', { id });
	}

	upsertLearned(payeeTerm: string, tagId: string): Promise<CategorizeRule> {
		return invoke<CategorizeRule>('rule_upsert_learned', { payeeTerm, tagId });
	}
}

// ---------------------------------------------------------------------------
// Meta operations
// ---------------------------------------------------------------------------

class NativeMetaOps implements MetaOps {
	get(key: string): Promise<string | null> {
		return invoke<string | null>('meta_get', { key });
	}

	set(key: string, value: string): Promise<void> {
		return invoke<void>('meta_set', { key, value });
	}

	delete(key: string): Promise<void> {
		return invoke<void>('meta_delete', { key });
	}

	isFirstRunComplete(): Promise<boolean> {
		return invoke<boolean>('meta_is_first_run_complete');
	}

	getLocale(): Promise<string> {
		return invoke<string>('meta_get_locale');
	}

	getCurrency(): Promise<string> {
		return invoke<string>('meta_get_currency');
	}

	isTourComplete(): Promise<boolean> {
		return invoke<boolean>('meta_is_tour_complete');
	}

	setTourComplete(): Promise<void> {
		return invoke<void>('meta_set_tour_complete');
	}

	setFirstRunComplete(): Promise<void> {
		return invoke<void>('meta_set_first_run_complete');
	}

	getDefaultQuickAccount(): Promise<string | null> {
		return invoke<string | null>('meta_get_default_quick_account');
	}

	setDefaultQuickAccount(accountId: string): Promise<void> {
		return invoke<void>('meta_set_default_quick_account', { accountId });
	}

	clearDefaultQuickAccount(): Promise<void> {
		return invoke<void>('meta_clear_default_quick_account');
	}
}

// ---------------------------------------------------------------------------
// Debt operations
// ---------------------------------------------------------------------------

class NativeDebtOps implements DebtOps {
	list(): Promise<{ i_owe: DebtAccount[]; owed_to_me: DebtAccount[] }> {
		return invoke<{ i_owe: DebtAccount[]; owed_to_me: DebtAccount[] }>('debt_list');
	}

	writeOff(accountId: string, amount: number, tagId?: string): Promise<string> {
		return invoke<string>('debt_write_off', { accountId, amount, tagId: tagId ?? '' });
	}
}

// ---------------------------------------------------------------------------
// Reconciliation operations
// ---------------------------------------------------------------------------

class NativeReconciliationOps implements ReconciliationOps {
	getHistory(accountId: string): Promise<Reconciliation[]> {
		return invoke<Reconciliation[]>('reconciliation_get_history', { accountId });
	}

	reconcile(accountId: string, actualBalance: number, createAdjustment: boolean, notes?: string): Promise<ReconcileResult> {
		return invoke<ReconcileResult>('reconciliation_reconcile', {
			accountId,
			actualBalance,
			createAdjustment,
			notes: notes ?? null,
		});
	}
}

// ---------------------------------------------------------------------------
// Report operations
// ---------------------------------------------------------------------------

class NativeReportOps implements ReportOps {
	getOverview(month: string, includeAdjustments?: boolean): Promise<OverviewReport> {
		return invoke<OverviewReport>('report_get_overview', { month, includeAdjustments: includeAdjustments ?? null });
	}

	getTrend(months: number, includeAdjustments?: boolean, bucketId?: string): Promise<TrendPoint[]> {
		return invoke<TrendPoint[]>('report_get_trend', { months, includeAdjustments: includeAdjustments ?? null, bucketId: bucketId ?? null });
	}

	getComparison(monthA: string, monthB: string, includeAdjustments?: boolean): Promise<CompareRow[]> {
		return invoke<CompareRow[]>('report_get_comparison', { monthA, monthB, includeAdjustments: includeAdjustments ?? null });
	}

	getCategoryTrend(tagId: string, months: number, includeAdjustments?: boolean): Promise<CategoryTrendPoint[]> {
		return invoke<CategoryTrendPoint[]>('report_get_category_trend', { tagId, months, includeAdjustments: includeAdjustments ?? null });
	}

	getStackedCategorySeries(months: number, includeAdjustments?: boolean): Promise<StackedCategoryPoint[]> {
		return invoke<StackedCategoryPoint[]>('report_get_stacked_category_series', { months, includeAdjustments: includeAdjustments ?? null });
	}

	getYearOverYear(yearA: number, yearB: number, includeAdjustments?: boolean): Promise<YearOverYearPoint[]> {
		return invoke<YearOverYearPoint[]>('report_get_year_over_year', { yearA, yearB, includeAdjustments: includeAdjustments ?? null });
	}

	getNetWorthSeries(months: number, includeAdjustments?: boolean): Promise<NetWorthPoint[]> {
		return invoke<NetWorthPoint[]>('report_get_net_worth_series', { months, includeAdjustments: includeAdjustments ?? null });
	}
}

// ---------------------------------------------------------------------------
// NativeDatabaseClient — the production Tauri adapter
// ---------------------------------------------------------------------------

export class NativeDatabaseClient implements AppDatabase {
	readonly accounts: AccountOps = new NativeAccountOps();
	readonly transactions: TransactionOps = new NativeTransactionOps();
	readonly categories: CategoryOps = new NativeCategoryOps();
	readonly budgets: BudgetOps = new NativeBudgetOps();
	readonly goals: GoalOps = new NativeGoalOps();
	readonly rules: RuleOps = new NativeRuleOps();
	readonly meta: MetaOps = new NativeMetaOps();
	readonly debts: DebtOps = new NativeDebtOps();
	readonly reconciliations: ReconciliationOps = new NativeReconciliationOps();
	readonly reports: ReportOps = new NativeReportOps();

	// NativeDatabaseClient delegates raw SQL operations to Rust commands.
	// No DatabaseService instance is available here.
}
