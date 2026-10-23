import type { MutationOptions } from '$lib/native/mutation-intent';
/**
 * NativeDatabaseClient — wraps Tauri invoke() calls for the native database boundary.
 *
 * Each method delegates to a Rust command registered via `#[tauri::command]`.
 * Mutations generate an operation ULID once per user intent; retry paths reuse
 * the same ULID for idempotency.
 */
import { invoke } from '$lib/native/invoke';
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
	BackupOps,
	ScheduleOps,
} from '../client';
import type { AccountType, AccountWithBalance, NewAccount } from '../client';
import type { TransactionKind, Transaction, NewTransaction, TransactionFilter } from '../client';
import type { Bucket, Tag, TagDeleteInfo } from '../client';
import type { BudgetSummary, ToBudgetBreakdown } from '../client';
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
import { NativeBackupOps } from './backup';
import type { SessionInvoker } from '$lib/profiles/session';
import { NativeScheduleOps } from './schedules';
import type { ToBudgetBreakdown as GeneratedToBudgetBreakdown } from '$lib/native/contracts.generated';
import type { AccountPatch, Patch, TransactionPatch } from '$lib/native/contracts.generated';

function nullablePatch<T>(value: T | null | undefined): Patch<T> {
	if (value === undefined) return { kind: 'omitted' };
	if (value === null) return { kind: 'explicit_null' };
	return { kind: 'replace', value };
}

/**
 * Every command goes through here: a Rust rejection is a `{code, meta}`
 * envelope, not an AppError, and would otherwise fall through to
 * `errors_unknown()`.
 */
// ---------------------------------------------------------------------------
// Lifecycle commands (main-window only)
// ---------------------------------------------------------------------------

export interface BackupSummary {
	id: string;
	path: string;
	schema_version: number;
	source_app_version: string;
	created_at: string;
	verified: boolean;
}

export interface DatabaseStatus {
	lifecycle: string;
	stage?: string | null;
	recovery?: {
		code: string;
		retryable: boolean;
	} | null;
	backups: BackupSummary[];
}

// ---------------------------------------------------------------------------
// Account operations
// ---------------------------------------------------------------------------

class NativeAccountOps implements AccountOps {
	constructor(private readonly invoke: SessionInvoker) {}
	list(): Promise<AccountWithBalance[]> {
		return this.invoke<AccountWithBalance[]>('account_list');
	}

	get(id: string): Promise<AccountWithBalance | null> {
		return this.invoke<AccountWithBalance | null>('account_get', { id });
	}

	getBalance(accountId: string): Promise<number> {
		return this.invoke<number>('account_get_balance', { accountId });
	}

	getBalanceAsOf(accountId: string, date: string): Promise<number> {
		return this.invoke<number>('account_get_balance_as_of', { accountId, date });
	}

	create(input: NewAccount, options?: MutationOptions): Promise<string> {
		return this.invoke<string>('account_create', { input }, options);
	}

	update(id: string, patch: { name?: string; type?: AccountType; counterparty?: string | null; archived?: number }, options?: MutationOptions): Promise<void> {
		const nativePatch: AccountPatch = {
			name: patch.name ?? null,
			type: patch.type ?? null,
			counterparty: nullablePatch(patch.counterparty),
			archived: patch.archived ?? null
		};
		return this.invoke<void>('account_update', { id, patch: nativePatch }, options);
	}

	delete(id: string, options?: MutationOptions): Promise<void> {
		return this.invoke<void>('account_delete', { id }, options);
	}

	restore(id: string, options?: MutationOptions): Promise<void> {
		return this.invoke<void>('account_restore', { id }, options);
	}
}

// ---------------------------------------------------------------------------
// Transaction operations
// ---------------------------------------------------------------------------

class NativeTransactionOps implements TransactionOps {
	constructor(private readonly invoke: SessionInvoker) {}
	list(filter?: TransactionFilter): Promise<Transaction[]> {
		return this.invoke<Transaction[]>('transaction_list', { filter: filter ?? null });
	}

	get(id: string): Promise<Transaction | null> {
		return this.invoke<Transaction | null>('transaction_get', { id });
	}

	create(input: NewTransaction, options?: MutationOptions): Promise<string> {
		return this.invoke<string>('transaction_create', { input }, options);
	}

	createBatch(inputs: NewTransaction[], options?: MutationOptions): Promise<string[]> {
		return this.invoke<string[]>('transaction_create_batch', { inputs }, options);
	}

	update(id: string, patch: Partial<NewTransaction>, options?: MutationOptions): Promise<void> {
		const nativePatch: TransactionPatch = {
			kind: patch.kind ?? null,
			date: patch.date ?? null,
			amount: patch.amount ?? null,
			transfer_account_id: patch.transfer_account_id ?? null,
			tag_id: nullablePatch(patch.tag_id),
			payee: nullablePatch(patch.payee),
			description: nullablePatch(patch.description)
		};
		return this.invoke<void>('transaction_update', { id, patch: nativePatch }, options);
	}

	delete(id: string, options?: MutationOptions): Promise<void> {
		return this.invoke<void>('transaction_delete', { id }, options);
	}

	restore(id: string, options?: MutationOptions): Promise<void> {
		return this.invoke<void>('transaction_restore', { id }, options);
	}

	duplicate(id: string, options?: MutationOptions): Promise<string> {
		return this.invoke<string>('transaction_duplicate', { id }, options);
	}

	deleteMany(ids: string[], options?: MutationOptions): Promise<void> {
		return this.invoke<void>('transaction_delete_many', { ids }, options);
	}

	setTagMany(ids: string[], tagId: string | null, options?: MutationOptions): Promise<void> {
		return this.invoke<void>('transaction_set_tag_many', { ids, tagId }, options);
	}

	setAccountMany(ids: string[], accountId: string, options?: MutationOptions): Promise<void> {
		return this.invoke<void>('transaction_set_account_many', { ids, accountId }, options);
	}

	getFrequent(_sinceDate: string): Promise<import('../client').FrequentTx[]> {
		return this.invoke<import('../client').FrequentTx[]>('transaction_frequent', { sinceDate: _sinceDate });
	}
}

// ---------------------------------------------------------------------------
// Category operations
// ---------------------------------------------------------------------------

class NativeCategoryOps implements CategoryOps {
	constructor(private readonly invoke: SessionInvoker) {}
	listBuckets(): Promise<Bucket[]> {
		return this.invoke<Bucket[]>('category_list_buckets');
	}

	createBucket(name: string, budgetable?: number, options?: MutationOptions): Promise<string> {
		return this.invoke<string>('category_create_bucket', { name, budgetable: budgetable ?? null }, options);
	}

	renameBucket(id: string, name: string, options?: MutationOptions): Promise<void> {
		return this.invoke<void>('category_rename_bucket', { id, name }, options);
	}

	setRolloverEnabled(id: string, enabled: boolean, options?: MutationOptions): Promise<void> {
		return this.invoke<void>('category_set_rollover_enabled', { id, enabled }, options);
	}

	deleteBucket(id: string, options?: MutationOptions): Promise<void> {
		return this.invoke<void>('category_delete_bucket', { id }, options);
	}

	listTags(bucketId?: string): Promise<Tag[]> {
		return this.invoke<Tag[]>('category_list_tags', { bucketId: bucketId ?? null });
	}

	createTag(name: string, bucketId: string, options?: MutationOptions): Promise<string> {
		return this.invoke<string>('category_create_tag', { name, bucketId }, options);
	}

	renameTag(id: string, name: string, options?: MutationOptions): Promise<void> {
		return this.invoke<void>('category_rename_tag', { id, name }, options);
	}

	moveTag(tagId: string, newBucketId: string, options?: MutationOptions): Promise<TagDeleteInfo> {
		return this.invoke<TagDeleteInfo>('category_move_tag', { tagId, newBucketId }, options);
	}

	getTagTransactionInfo(tagId: string): Promise<TagDeleteInfo> {
		return this.invoke<TagDeleteInfo>('category_get_tag_transaction_info', { tagId });
	}

	deleteTag(id: string, option: 'uncategorise' | { merge_into: string }, options?: MutationOptions): Promise<void> {
		return this.invoke<void>('category_delete_tag', { id, option: typeof option === 'string' ? option : JSON.stringify(option) }, options);
	}
}

// ---------------------------------------------------------------------------
// Budget operations
// ---------------------------------------------------------------------------

/**
 * Compile-time provenance guard for `ToBudgetBreakdown`.
 *
 * `getToBudget` below types `this.invoke<ToBudgetBreakdown>('budget_get_to_budget')`
 * from the *hand-written* interface in `src/lib/db/browser/repos/budgets.ts`
 * (re-exported via `$lib/db/client`), while the Rust DTO's generated TS mirror
 * lives in `src/lib/native/contracts.generated.ts`. `pnpm check:db-contracts`
 * only compares that generated file to its own generator, so renaming or
 * retyping a field on either side could leave every check green while the
 * desktop build deserialized a renamed key and read `undefined` at runtime —
 * exactly the snake_case-vs-camelCase hazard the spec calls out. This
 * assignment makes the two shapes mutually assignable: change either one and
 * `pnpm check` (which type-checks this file) fails here instead.
 */
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const toBudgetBreakdownIsRustShaped: MutuallyAssignable<
	ToBudgetBreakdown,
	GeneratedToBudgetBreakdown
> = true;

class NativeBudgetOps implements BudgetOps {
	constructor(private readonly invoke: SessionInvoker) {}
	getForMonth(month: string): Promise<BudgetSummary[]> {
		return this.invoke<BudgetSummary[]>('budget_get_for_month', { month });
	}

	getSpentForBucket(typeId: string, month: string): Promise<number> {
		return this.invoke<number>('budget_get_spent_for_bucket', { typeId, month });
	}

	getRolledOver(typeId: string, month: string): Promise<number> {
		return this.invoke<number>('budget_get_rolled_over', { typeId, month });
	}

	getToBudget(month: string): Promise<ToBudgetBreakdown> {
		return this.invoke<ToBudgetBreakdown>('budget_get_to_budget', { month });
	}

	setAllocation(typeId: string, month: string, allocated: number, options?: MutationOptions): Promise<void> {
		return this.invoke<void>('budget_set_allocation', { typeId, month, allocated }, options);
	}

	copyFromPreviousMonth(targetMonth: string, options?: MutationOptions): Promise<void> {
		return this.invoke<void>('budget_copy_from_previous_month', { targetMonth }, options);
	}

	hasAllocations(month: string): Promise<boolean> {
		return this.invoke<boolean>('budget_has_allocations', { month });
	}
}

// ---------------------------------------------------------------------------
// Goal operations
// ---------------------------------------------------------------------------

class NativeGoalOps implements GoalOps {
	constructor(private readonly invoke: SessionInvoker) {}
	list(): Promise<GoalWithProgress[]> {
		return this.invoke<GoalWithProgress[]>('goal_list');
	}

	get(id: string): Promise<GoalWithProgress | null> {
		return this.invoke<GoalWithProgress | null>('goal_get', { id });
	}

	create(input: NewGoal, options?: MutationOptions): Promise<string> {
		return this.invoke<string>('goal_create', {
			name: input.name,
			goalType: input.type,
			targetAmount: input.target_amount,
			targetDate: input.target_date,
			linkedAccountId: input.linked_account_id ?? null,
			startingAmount: input.starting_amount ?? 0,
			showOnDashboard: input.show_on_dashboard ?? 1,
		}, options);
	}

	update(id: string, patch: Partial<NewGoal> & { status?: GoalStatus }, options?: MutationOptions): Promise<void> {
		return this.invoke<void>('goal_update', {
			id,
			name: patch.name ?? null,
			targetAmount: patch.target_amount ?? null,
			targetDate: patch.target_date ?? null,
			showOnDashboard: patch.show_on_dashboard ?? null,
			status: patch.status ?? null,
		}, options);
	}

	delete(id: string, options?: MutationOptions): Promise<void> {
		return this.invoke<void>('goal_delete', { id }, options);
	}

	restore(id: string, options?: MutationOptions): Promise<void> {
		return this.invoke<void>('goal_restore', { id }, options);
	}
}

// ---------------------------------------------------------------------------
// Rule operations
// ---------------------------------------------------------------------------

class NativeRuleOps implements RuleOps {
	constructor(private readonly invoke: SessionInvoker) {}
	list(): Promise<CategorizeRule[]> {
		return this.invoke<CategorizeRule[]>('rule_list');
	}

	listAll(): Promise<CategorizeRule[]> {
		return this.invoke<CategorizeRule[]>('rule_list_all');
	}

	create(input: NewCategorizeRule, options?: MutationOptions): Promise<CategorizeRule> {
		return this.invoke<CategorizeRule>('rule_create', {
			payeeTerm: input.payee_term,
			matchMode: input.match_mode,
			tagId: input.tag_id,
			source: input.source ?? 'manual',
		}, options);
	}

	update(id: string, patch: CategorizeRuleUpdate, options?: MutationOptions): Promise<CategorizeRule> {
		return this.invoke<CategorizeRule>('rule_update', {
			id,
			payeeTerm: patch.payee_term ?? null,
			matchMode: patch.match_mode ?? null,
			tagId: patch.tag_id ?? null,
			source: patch.source ?? null,
			enabled: patch.enabled ?? null,
		}, options);
	}

	delete(id: string, options?: MutationOptions): Promise<void> {
		return this.invoke<void>('rule_delete', { id }, options);
	}

	upsertLearned(payeeTerm: string, tagId: string, options?: MutationOptions): Promise<CategorizeRule> {
		return this.invoke<CategorizeRule>('rule_upsert_learned', { payeeTerm, tagId }, options);
	}
}

// ---------------------------------------------------------------------------
// Meta operations
// ---------------------------------------------------------------------------

class NativeMetaOps implements MetaOps {
	constructor(private readonly invoke: SessionInvoker) {}
	get(key: string): Promise<string | null> {
		return this.invoke<string | null>('meta_get', { key });
	}

	set(key: string, value: string): Promise<void> {
		return this.invoke<void>('meta_set', { key, value });
	}

	delete(key: string): Promise<void> {
		return this.invoke<void>('meta_delete', { key });
	}

	isFirstRunComplete(): Promise<boolean> {
		return this.invoke<boolean>('meta_is_first_run_complete');
	}

	getLocale(): Promise<string> {
		return this.invoke<string>('meta_get_locale');
	}

	getCurrency(): Promise<string> {
		return this.invoke<string>('meta_get_currency');
	}

	isTourComplete(): Promise<boolean> {
		return this.invoke<boolean>('meta_is_tour_complete');
	}

	setTourComplete(): Promise<void> {
		return this.invoke<void>('meta_set_tour_complete');
	}

	setFirstRunComplete(): Promise<void> {
		return this.invoke<void>('meta_set_first_run_complete');
	}

	getDefaultQuickAccount(): Promise<string | null> {
		return this.invoke<string | null>('meta_get_default_quick_account');
	}

	setDefaultQuickAccount(accountId: string): Promise<void> {
		return this.invoke<void>('meta_set_default_quick_account', { accountId });
	}

	clearDefaultQuickAccount(): Promise<void> {
		return this.invoke<void>('meta_clear_default_quick_account');
	}
}

// ---------------------------------------------------------------------------
// Debt operations
// ---------------------------------------------------------------------------

class NativeDebtOps implements DebtOps {
	constructor(private readonly invoke: SessionInvoker) {}
	list(): Promise<{ i_owe: DebtAccount[]; owed_to_me: DebtAccount[] }> {
		return this.invoke<{ i_owe: DebtAccount[]; owed_to_me: DebtAccount[] }>('debt_list');
	}

	writeOff(accountId: string, amount: number, tagId?: string, options?: MutationOptions): Promise<string> {
		return this.invoke<string>('debt_write_off', { accountId, amount, tagId: tagId ?? null }, options);
	}
}

// ---------------------------------------------------------------------------
// Reconciliation operations
// ---------------------------------------------------------------------------

class NativeReconciliationOps implements ReconciliationOps {
	constructor(private readonly invoke: SessionInvoker) {}
	getHistory(accountId: string): Promise<Reconciliation[]> {
		return this.invoke<Reconciliation[]>('reconciliation_get_history', { accountId });
	}

	reconcile(accountId: string, actualBalance: number, createAdjustment: boolean, notes?: string, options?: MutationOptions): Promise<ReconcileResult> {
		return this.invoke<ReconcileResult>('reconciliation_reconcile', {
			accountId,
			actualBalance,
			createAdjustment,
			notes: notes ?? null,
		}, options);
	}
}

// ---------------------------------------------------------------------------
// Report operations
// ---------------------------------------------------------------------------

class NativeReportOps implements ReportOps {
	constructor(private readonly invoke: SessionInvoker) {}
	getOverview(month: string, includeAdjustments?: boolean): Promise<OverviewReport> {
		return this.invoke<OverviewReport>('report_get_overview', { month, includeAdjustments: includeAdjustments ?? null });
	}

	getTrend(months: number, includeAdjustments?: boolean, bucketId?: string): Promise<TrendPoint[]> {
		return this.invoke<TrendPoint[]>('report_get_trend', { months, includeAdjustments: includeAdjustments ?? null, bucketId: bucketId ?? null });
	}

	getComparison(monthA: string, monthB: string, includeAdjustments?: boolean): Promise<CompareRow[]> {
		return this.invoke<CompareRow[]>('report_get_comparison', { monthA, monthB, includeAdjustments: includeAdjustments ?? null });
	}

	getCategoryTrend(tagId: string, months: number, includeAdjustments?: boolean): Promise<CategoryTrendPoint[]> {
		return this.invoke<CategoryTrendPoint[]>('report_get_category_trend', { tagId, months, includeAdjustments: includeAdjustments ?? null });
	}

	getStackedCategorySeries(months: number, includeAdjustments?: boolean): Promise<StackedCategoryPoint[]> {
		return this.invoke<StackedCategoryPoint[]>('report_get_stacked_category_series', { months, includeAdjustments: includeAdjustments ?? null });
	}

	getYearOverYear(yearA: number, yearB: number, includeAdjustments?: boolean): Promise<YearOverYearPoint[]> {
		return this.invoke<YearOverYearPoint[]>('report_get_year_over_year', { yearA, yearB, includeAdjustments: includeAdjustments ?? null });
	}

	getNetWorthSeries(months: number, includeAdjustments?: boolean): Promise<NetWorthPoint[]> {
		return this.invoke<NetWorthPoint[]>('report_get_net_worth_series', { months, includeAdjustments: includeAdjustments ?? null });
	}
}

// ---------------------------------------------------------------------------
// NativeDatabaseClient — the production Tauri adapter
// ---------------------------------------------------------------------------

export class NativeDatabaseClient implements AppDatabase {
	readonly accounts: AccountOps;
	readonly transactions: TransactionOps;
	readonly categories: CategoryOps;
	readonly budgets: BudgetOps;
	readonly goals: GoalOps;
	readonly rules: RuleOps;
	readonly meta: MetaOps;
	readonly debts: DebtOps;
	readonly reconciliations: ReconciliationOps;
	readonly reports: ReportOps;
	readonly backup: BackupOps;
	readonly schedules: ScheduleOps;

	constructor(invoker: SessionInvoker = invoke) {
		this.accounts = new NativeAccountOps(invoker);
		this.transactions = new NativeTransactionOps(invoker);
		this.categories = new NativeCategoryOps(invoker);
		this.budgets = new NativeBudgetOps(invoker);
		this.goals = new NativeGoalOps(invoker);
		this.rules = new NativeRuleOps(invoker);
		this.meta = new NativeMetaOps(invoker);
		this.debts = new NativeDebtOps(invoker);
		this.reconciliations = new NativeReconciliationOps(invoker);
		this.reports = new NativeReportOps(invoker);
		this.backup = new NativeBackupOps(invoker);
		this.schedules = new NativeScheduleOps(invoker);
	}
}
