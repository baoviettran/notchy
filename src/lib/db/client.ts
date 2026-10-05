/**
 * AppDatabase — domain port interface.
 *
 * Exposes domain services only: no `execute`, no `transaction`, no raw SQL.
 * Two adapters implement this interface:
 * - `BrowserDatabaseClient` — owns sql.js; used by Vitest and Playwright E2E.
 * - `NativeDatabaseClient` — wraps Tauri invoke(); inactive until Task 14.
 */
import type { DatabaseService } from './browser/service';
import type {
	AccountType,
	AccountWithBalance,
	NewAccount,
} from './browser/repos/accounts';
import type {
	TransactionKind,
	Transaction,
	NewTransaction,
	TransactionFilter,
} from './browser/repos/transactions';
import type {
	Bucket,
	Tag,
	TagDeleteInfo,
} from './browser/repos/categories';
import type { BudgetSummary } from './browser/repos/budgets';
import type {
	GoalWithProgress,
	NewGoal,
	GoalStatus,
} from './browser/repos/goals';
import type {
	CategorizeRule,
	NewCategorizeRule,
	CategorizeRuleUpdate,
} from './browser/repos/rules';
import type { DebtAccount } from './browser/repos/debts';
import type {
	Reconciliation,
	ReconcileResult,
} from './browser/repos/reconciliations';
import type {
	OverviewReport,
	TrendPoint,
	CompareRow,
	CategoryTrendPoint,
	StackedCategoryPoint,
	YearOverYearPoint,
	NetWorthPoint,
} from './browser/repos/reports';

// ---------------------------------------------------------------------------
// Re-export domain types so consumers can import from '$lib/db/client'.
// ---------------------------------------------------------------------------
export type { AccountType, AccountWithBalance, NewAccount };
export { isAssetType, isLiabilityType, isLoanType } from './browser/repos/accounts';
export type { TransactionKind, Transaction, NewTransaction, TransactionFilter };
export type { Bucket, Tag, TagDeleteInfo };
export type { BudgetSummary } from './browser/repos/budgets';
export type { GoalWithProgress, NewGoal, GoalStatus };
export type { CategorizeRule, NewCategorizeRule, CategorizeRuleUpdate };
export type { DebtAccount };
export type { Reconciliation, ReconcileResult };
export type {
	OverviewReport,
	TrendPoint,
	CompareRow,
	CategoryTrendPoint,
	StackedCategoryPoint,
	YearOverYearPoint,
	NetWorthPoint,
};

// ---------------------------------------------------------------------------
// Schedule domain types.
//
// Defined here rather than re-exported from `browser/repos` because the browser
// repo lands with the browser adapter (Task 7); the port shape is the contract
// Tasks 7, 8 and 10 all code against.
// ---------------------------------------------------------------------------

export type ScheduleKind = 'expense' | 'income' | 'transfer';
export type ScheduleFrequency = 'weekly' | 'biweekly' | 'monthly' | 'yearly';

export interface Schedule { id: string; name: string; kind: ScheduleKind; amount: number;
	account_id: string; transfer_account_id: string | null; tag_id: string | null;
	payee: string | null; description: string | null; frequency: ScheduleFrequency;
	start_date: string; end_date: string | null; posts_transaction: number;
	next_due_date: string | null; last_posted_date: string | null; completed: number;
	enabled: number; errored_at: string | null; created_at: string; updated_at: string; }

export interface NewSchedule { name: string; kind: ScheduleKind; amount: number;
	account_id: string; transfer_account_id?: string | null; tag_id?: string | null;
	payee?: string | null; description?: string | null;
	frequency: ScheduleFrequency; start_date: string; end_date?: string | null;
	posts_transaction?: number; }

export interface ScheduleUpdate { name: string; kind: ScheduleKind; amount: number;
	account_id: string; transfer_account_id: string | null; tag_id: string | null;
	payee: string | null; description: string | null; frequency: ScheduleFrequency;
	start_date: string; end_date: string | null; posts_transaction: number; enabled: number;
	/** `null` leaves the stored due date untouched — the one field where a null
	 *  does not mean "clear". See `ScheduleUpdate` in the Rust types (Task 4) and
	 *  `firstDueOnOrAfter` (Task 1). */
	next_due_date: string | null; }

// ---------------------------------------------------------------------------
// Operation interfaces — one per domain.
// ---------------------------------------------------------------------------

export interface AccountOps {
	list(): Promise<AccountWithBalance[]>;
	get(id: string): Promise<AccountWithBalance | null>;
	getBalance(accountId: string): Promise<number>;
	getBalanceAsOf(accountId: string, date: string): Promise<number>;
	create(input: NewAccount): Promise<string>;
	update(id: string, patch: { name?: string; type?: AccountType; counterparty?: string | null; archived?: number }): Promise<void>;
	delete(id: string): Promise<void>;
	restore(id: string): Promise<void>;
}

export interface TransactionOps {
	list(filter?: TransactionFilter): Promise<Transaction[]>;
	get(id: string): Promise<Transaction | null>;
	create(input: NewTransaction): Promise<string>;
	createBatch(inputs: NewTransaction[]): Promise<string[]>;
	update(id: string, patch: Partial<NewTransaction>): Promise<void>;
	delete(id: string): Promise<void>;
	restore(id: string): Promise<void>;
	duplicate(id: string): Promise<string>;
	deleteMany(ids: string[]): Promise<void>;
	setTagMany(ids: string[], tagId: string | null): Promise<void>;
	setAccountMany(ids: string[], accountId: string): Promise<void>;
	getFrequent(sinceDate: string): Promise<FrequentTx[]>;
}

export interface FrequentTx {
	payee: string;
	tag_id: string | null;
	account_id: string;
	amount: number;
	kind: string;
	count: number;
}

export interface CategoryOps {
	listBuckets(): Promise<Bucket[]>;
	createBucket(name: string, budgetable?: number): Promise<string>;
	renameBucket(id: string, name: string): Promise<void>;
	setRolloverEnabled(id: string, enabled: boolean): Promise<void>;
	deleteBucket(id: string): Promise<void>;
	listTags(bucketId?: string): Promise<Tag[]>;
	createTag(name: string, bucketId: string): Promise<string>;
	renameTag(id: string, name: string): Promise<void>;
	moveTag(tagId: string, newBucketId: string): Promise<TagDeleteInfo>;
	getTagTransactionInfo(tagId: string): Promise<TagDeleteInfo>;
	deleteTag(id: string, option: 'uncategorise' | { merge_into: string }): Promise<void>;
}

export interface BudgetOps {
	getForMonth(month: string): Promise<BudgetSummary[]>;
	getSpentForBucket(typeId: string, month: string): Promise<number>;
	getRolledOver(typeId: string, month: string): Promise<number>;
	setAllocation(typeId: string, month: string, allocated: number): Promise<void>;
	copyFromPreviousMonth(targetMonth: string): Promise<void>;
	hasAllocations(month: string): Promise<boolean>;
}

export interface GoalOps {
	list(): Promise<GoalWithProgress[]>;
	get(id: string): Promise<GoalWithProgress | null>;
	create(input: NewGoal): Promise<string>;
	update(id: string, patch: Partial<NewGoal> & { status?: GoalStatus }): Promise<void>;
	delete(id: string): Promise<void>;
	restore(id: string): Promise<void>;
}

export interface RuleOps {
	list(): Promise<CategorizeRule[]>;
	listAll(): Promise<CategorizeRule[]>;
	create(input: NewCategorizeRule): Promise<CategorizeRule>;
	update(id: string, patch: CategorizeRuleUpdate): Promise<CategorizeRule>;
	delete(id: string): Promise<void>;
	upsertLearned(payeeTerm: string, tagId: string): Promise<CategorizeRule>;
}

export interface MetaOps {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	delete(key: string): Promise<void>;
	isFirstRunComplete(): Promise<boolean>;
	setFirstRunComplete(): Promise<void>;
	getLocale(): Promise<string>;
	getCurrency(): Promise<string>;
	isTourComplete(): Promise<boolean>;
	setTourComplete(): Promise<void>;
	getDefaultQuickAccount(): Promise<string | null>;
	setDefaultQuickAccount(accountId: string): Promise<void>;
	clearDefaultQuickAccount(): Promise<void>;
}

export interface DebtOps {
	list(): Promise<{ i_owe: DebtAccount[]; owed_to_me: DebtAccount[] }>;
	writeOff(accountId: string, amount: number, tagId?: string): Promise<string>;
}

export interface ReconciliationOps {
	getHistory(accountId: string): Promise<Reconciliation[]>;
	reconcile(accountId: string, actualBalance: number, createAdjustment: boolean, notes?: string): Promise<ReconcileResult>;
}

export interface ReportOps {
	getOverview(month: string, includeAdjustments?: boolean): Promise<OverviewReport>;
	getTrend(months: number, includeAdjustments?: boolean, bucketId?: string): Promise<TrendPoint[]>;
	getComparison(monthA: string, monthB: string, includeAdjustments?: boolean): Promise<CompareRow[]>;
	getCategoryTrend(tagId: string, months: number, includeAdjustments?: boolean): Promise<CategoryTrendPoint[]>;
	getStackedCategorySeries(months: number, includeAdjustments?: boolean): Promise<StackedCategoryPoint[]>;
	getYearOverYear(yearA: number, yearB: number, includeAdjustments?: boolean): Promise<YearOverYearPoint[]>;
	getNetWorthSeries(months: number, includeAdjustments?: boolean): Promise<NetWorthPoint[]>;
}

/**
 * Backup and export operations. Both adapters publish through one crash-safe
 * path: the browser adapter over sql.js, the native adapter over Rust's
 * publication protocol. No op exposes a query handle — a caller gets a path or
 * an error, never SQL.
 */
export interface BackupOps {
	/**
	 * Publish a routine backup into the app's routine backup directory and
	 * resolve to its canonical path. Records `last_backup_at` only if the
	 * publication succeeded.
	 */
	create(): Promise<string>;
	/**
	 * Write a validated copy of the live database to exactly `targetPath`.
	 *
	 * Replacement differs by adapter: the native adapter atomically replaces an
	 * existing target, while the browser adapter refuses one — `VACUUM INTO`
	 * errors on an existing file — and leaves that file untouched.
	 */
	exportSqlite(targetPath: string): Promise<void>;
	/**
	 * Write one CSV per exported table into `dir`, replacing existing files.
	 * Resolves to the written paths — one per table, including a table with no
	 * rows.
	 */
	exportCsv(dir: string): Promise<string[]>;
}

export interface ScheduleOps {
	list(): Promise<Schedule[]>;
	create(input: NewSchedule): Promise<string>;
	update(id: string, input: ScheduleUpdate): Promise<void>;
	remove(id: string): Promise<void>;
	/** Active schedules whose `next_due_date` is on or before `today`, oldest first. */
	listDue(today: string): Promise<Schedule[]>;
	markPosted(id: string, lastPostedDate: string | null, nextDueDate: string | null, completed: number): Promise<void>;
	markErrored(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Domain port
// ---------------------------------------------------------------------------

export interface AppDatabase {
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
}
