import type { ProfileSession } from './types';
import { advanceDataEpoch } from './epoch';
import { accounts } from '$lib/stores/accounts.svelte';
import { transactions } from '$lib/stores/transactions.svelte';
import { categories } from '$lib/stores/categories.svelte';
import { budgets } from '$lib/stores/budgets.svelte';
import { goals } from '$lib/stores/goals.svelte';
import { debts } from '$lib/stores/debts.svelte';
import { schedules } from '$lib/stores/schedules.svelte';
import { rules } from '$lib/stores/rules.svelte';
import { reportsStore } from '$lib/stores/reports.svelte';
import { ruleUI } from '$lib/stores/rule-ui.svelte';
import { uiHints } from '$lib/stores/ui-hint.svelte';
import { tour } from '$lib/stores/tour.svelte';
import { session as uiSession } from '$lib/stores/session.svelte';
import { settings } from '$lib/stores/settings.svelte';
import { toast } from '$lib/stores/toast.svelte';
import { monthKey } from '$lib/logic/budget-calc';
import { dbStore } from '$lib/stores/db.svelte';

export function resetProfileState(_session: ProfileSession | null): void {
	advanceDataEpoch();
	for (const store of [accounts, transactions, categories, budgets, goals, debts, schedules, rules, reportsStore]) {
		store.loading = false;
		store.error = null;
	}
	accounts.items = [];
	transactions.items = []; transactions.monthFlow = null; transactions.resetProfileFilter();
	categories.buckets = []; categories.tags = []; categories.lastUsedBucketId = null;
	budgets.items = []; budgets.toBudget = null; budgets.hasAllocations = false; budgets.month = monthKey(new Date());
	goals.items = [];
	debts.i_owe = []; debts.owed_to_me = [];
	schedules.items = []; rules.items = [];
	reportsStore.netWorth = []; reportsStore.trend = []; reportsStore.categoryTrend = [];
	reportsStore.stackedComposition = []; reportsStore.yearOverYear = [];
	ruleUI.editorOpen = false; ruleUI.editing = null; ruleUI.deleteTarget = null;
	ruleUI.clearOpen = false; ruleUI.saving = false;
	uiHints.hideFab = false;
	tour.active = false; tour.currentStep = 0; tour.complete = false;
	uiSession.lastUsedAccountId = null; uiSession.lastEnteredDate = null; uiSession.undoStack = [];
	dbStore.resetForProfile(_session);
	settings.currency = 'VND'; settings.firstRunComplete = false;
	toast.reset();
}
