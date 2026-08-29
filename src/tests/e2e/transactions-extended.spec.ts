import { test, expect } from './fixtures/onboarded';
import { addTransaction } from './helpers/ui';

// Extended transaction coverage for the AUTO-tagged checklist items in §3.
// Conventions match transactions.spec.ts: SPA navigation only (the in-memory
// sql.js DB is wiped on page.goto), spec comments cite source lines + i18n keys,
// and VND formats with no fraction digits (currency.ts) → "₫50,000", expense
// prefixed "-" (transactions/+page.svelte:102).
//
// Verified against:
//  - src/routes/transactions/+page.svelte: search Input (type="search") +
//    "Search" button (lines 72/74); empty-state text (line 87); row rendering.
//  - src/lib/components/forms/TransactionForm.svelte: kind buttons incl. Refund
//    (forms_refund="Refund") + Adjustment (forms_adjustment="Adjustment") lines
//    70-71; validation messages lines 89-94; Tag Autocomplete line 157; Payee
//    Autocomplete line 162.
//
// NOTE: the Transactions page has NO "filter by kind" UI — only a free-text
// search box (queries payee + description per transactions.load). The
// checklist's "Filter by kind" item is therefore not exercisable as written;
// this spec covers the search box (the only filter that exists) and leaves a
// note. Refund/adjustment kinds are exercised via the kind button + list.

test.describe('transactions — extended', () => {
	test('refund and adjustment kinds save and render without a minus sign', async ({ onboardedPage: page }) => {
		// Only expense is prefixed "-" (transactions/+page.svelte:102); refund,
		// adjustment, income, transfer all render the bare formatted amount.
		await addTransaction(page, { kind: 'expense', amount: '50k' });

		// Refund: drive the modal directly (addTransaction helper doesn't expose it).
		await page.getByRole('button', { name: 'Add transaction' }).first().click();
		let modal = page.getByRole('dialog');
		await modal.getByRole('button', { name: 'More' }).click();
		await modal.getByRole('button', { name: 'Refund', exact: true }).click();
		await modal.getByLabel('Amount').fill('20k');
		await modal.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByRole('dialog')).toBeHidden();

		// Adjustment.
		await page.getByRole('button', { name: 'Add transaction' }).first().click();
		modal = page.getByRole('dialog');
		await modal.getByRole('button', { name: 'More' }).click();
		await modal.getByRole('button', { name: 'Adjustment', exact: true }).click();
		await modal.getByLabel('Amount').fill('10k');
		await modal.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByRole('dialog')).toBeHidden();

		await page.getByRole('link', { name: 'Transactions', exact: true }).click();
		const main = page.getByRole('main');
		// Both render as positive (no "-"): ₫20,000 and ₫10,000. Use exact text to
		// avoid matching the expense's −₫50,000.
		await expect(main.getByText('₫20,000', { exact: true })).toBeVisible();
		await expect(main.getByText('₫10,000', { exact: true })).toBeVisible();
	});

	test('search filters the list by payee', async ({ onboardedPage: page }) => {
		// Add two expenses with distinct payees. The dashboard modal's Payee field
		// is an Autocomplete labelled "Payee" (TransactionForm.svelte:162).
		await page.getByRole('button', { name: 'Add transaction' }).first().click();
		let modal = page.getByRole('dialog');
		await modal.getByLabel('Amount').fill('10k');
		await modal.getByLabel('Payee').fill('Acme Corp');
		await modal.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByRole('dialog')).toBeHidden();

		await page.getByRole('button', { name: 'Add transaction' }).first().click();
		modal = page.getByRole('dialog');
		await modal.getByLabel('Amount').fill('20k');
		await modal.getByLabel('Payee').fill('Bigshop');
		await modal.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByRole('dialog')).toBeHidden();

		await page.getByRole('link', { name: 'Transactions', exact: true }).click();
		const main = page.getByRole('main');
		await expect(main.getByText('Acme Corp')).toBeVisible();
		await expect(main.getByText('Bigshop')).toBeVisible();

		// TopBar search: focus the global search (type="search" in the layout header),
		// type a query, press Enter → SPA navigates to /transactions?q=Acme,
		// the page's $effect picks up the URL param and reloads the list.
		const topSearch = page.locator('[type="search"]').first();
		await topSearch.fill('Acme');
		await topSearch.press('Enter');
		await expect(main.getByText('Acme Corp')).toBeVisible();
		await expect(main.getByText('Bigshop')).toHaveCount(0);

		// Clear search → both back.
		await topSearch.fill('');
		await topSearch.press('Enter');
		await expect(main.getByText('Bigshop')).toBeVisible();
	});

	test('pagination bar is hidden on a single-page list', async ({ onboardedPage: page }) => {
		// Fresh onboarding → 0 transactions, certainly 1 page. The Prev/Next
		// buttons should not be rendered at all (no dead controls).
		await page.getByRole('link', { name: 'Transactions', exact: true }).click();
		await page.waitForURL('**/transactions');
		await expect(page.getByRole('button', { name: '← Previous' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Next →' })).toHaveCount(0);
	});

	test('payee autocomplete surfaces existing payees', async ({ onboardedPage: page }) => {
		// Create a transaction with a known payee. The Payee field is free-text
		// (allowFreeText, TransactionForm.svelte:162), so typing commits the
		// value on blur/Save; this also seeds the payeeOptions list for the next
		// modal (TransactionForm.svelte:76-80).
		await page.getByRole('button', { name: 'Add transaction' }).first().click();
		let modal = page.getByRole('dialog');
		await modal.getByLabel('Amount').fill('10k');
		await modal.getByLabel('Payee').fill('Familiar Payee');
		await modal.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByRole('dialog')).toBeHidden();

		// Open a fresh modal and focus the Payee field.
		await page.getByRole('button', { name: 'Add transaction' }).first().click();
		modal = page.getByRole('dialog');
		const payee = modal.getByLabel('Payee');
		await payee.click();
		await payee.fill('Familiar');
		// The Autocomplete renders a listbox option for the matching payee.
		await expect(page.getByRole('option', { name: 'Familiar Payee' })).toBeVisible();
		await page.keyboard.press('Escape');
	});

	test('empty state shows the no-transactions message', async ({ onboardedPage: page }) => {
		// Fresh onboarding → no transactions yet. Go straight to /transactions.
		await page.getByRole('link', { name: 'Transactions', exact: true }).click();
		// transactions/+page.svelte:87: transactions_empty_state = "No transactions found."
		await expect(page.getByRole('main').getByText('No transactions found.')).toBeVisible();
	});

	test('empty amount disables Save; the Save button gates on amount', async ({ onboardedPage: page }) => {
		// The account Select always defaults to accounts.items[0]
		// (TransactionForm.svelte:55), so the forms_select_account error is
		// unreachable via the UI post-onboarding — that path is unit-tested at
		// the store/repo layer instead. Here we assert the genuine client-side
		// gate: Save is disabled until an amount is entered
		// (TransactionForm.svelte:171: disabled={saving || !amount}).
		await page.getByRole('button', { name: 'Add transaction' }).first().click();
		const modal = page.getByRole('dialog');
		await expect(modal.getByRole('button', { name: 'Save' })).toBeDisabled();
		await modal.getByLabel('Amount').fill('10k');
		await expect(modal.getByRole('button', { name: 'Save' })).toBeEnabled();
	});

	test('invalid amount is rejected with an inline error', async ({ onboardedPage: page }) => {
		// parseAmount throws on garbage → validation_invalid_amount = "Invalid amount"
		// (TransactionForm.svelte:88-90).
		await page.getByRole('button', { name: 'Add transaction' }).first().click();
		const modal = page.getByRole('dialog');
		await modal.getByLabel('Amount').fill('not a number');
		await modal.getByRole('button', { name: 'Save' }).click();
		await expect(modal.getByText('Invalid amount')).toBeVisible();
	});

	test('large amount with suffix (2tr) expands and saves', async ({ onboardedPage: page }) => {
		// parseAmount (en/VNĐ) expands "tr" → million. 2tr = 2,000,000.
		await addTransaction(page, { kind: 'expense', amount: '2tr' });
		await page.getByRole('link', { name: 'Transactions', exact: true }).click();
		await expect(page.getByRole('main').getByText('−₫2,000,000')).toBeVisible();
	});

	test('self-transfer is rejected with source/destination error', async ({ onboardedPage: page }) => {
		// transferAccountId defaults to '' (TransactionForm.svelte:35), so with a
		// single account the form surfaces "Select a destination account", not the
		// differ error. To exercise validation_source_dest_differ, we need two
		// accounts and must explicitly select the SAME account for both From and
		// To. Create a second account first.
		await page.getByRole('link', { name: 'Accounts', exact: true }).click();
		await page.getByRole('button', { name: '+ Add account' }).first().click();
		const acctModal = page.getByRole('dialog');
		await acctModal.getByLabel('Name').fill('Savings');
		await acctModal.getByRole('button', { name: 'Create' }).click();
		await page.getByRole('link', { name: 'Dashboard', exact: true }).click();

		// Now open the transfer form and pick the same account for From and To.
		await page.getByRole('button', { name: 'Add transaction' }).first().click();
		const modal = page.getByRole('dialog');
		await modal.getByRole('button', { name: 'More' }).click();
		await modal.getByRole('button', { name: 'Transfer', exact: true }).click();
		await modal.getByLabel('Amount').fill('10k');
		// From Account defaults to the first account; set To Account to the same.
		const fromAccount = modal.getByLabel('From Account');
		const fromValue = await fromAccount.inputValue();
		await modal.getByLabel('To Account').selectOption(fromValue);
		await modal.getByRole('button', { name: 'Save' }).click();
		// TransactionForm.svelte:94: validation_source_dest_differ.
		await expect(modal.getByText('Source and destination must differ')).toBeVisible();
	});
});
