import { test, expect } from './fixtures/onboarded';
import { addTransaction } from './helpers/ui';

test.describe('transactions', () => {
	test('add expense, income, transfer', async ({ onboardedPage: page }) => {
		// Transfer needs a second account. Create one via the Accounts page.
		// exact: the Sidebar link must be distinguished from the Dashboard's
		// "Accounts →" shortcut (both match a non-exact name query).
		await page.getByRole('link', { name: 'Accounts', exact: true }).click();
		// Accounts page button label is m.accounts_add() = "+ Add account" (accounts/+page.svelte:45).
		await page.getByRole('button', { name: '+ Add account' }).click();
		const acctModal = page.getByRole('dialog');
		await acctModal.getByLabel('Name').fill('Savings');
		// AccountForm create button is m.forms_create() = "Create" (AccountForm.svelte:79).
		await acctModal.getByRole('button', { name: 'Create' }).click();
		await page.getByRole('link', { name: 'Dashboard', exact: true }).click();

		await addTransaction(page, { kind: 'expense', amount: '50k' });
		await addTransaction(page, { kind: 'income', amount: '1.2k' });
		// Transfer is not covered by addTransaction — it requires a destination
		// account (TransactionForm.svelte:93 blocks save with "Select a
		// destination account" when transferAccountId is empty), which the
		// helper doesn't set. Drive the modal directly: pick Transfer, amount,
		// then the "To Account" (Savings), then Save.
		await page.getByRole('button', { name: 'Add transaction' }).click();
		const txModal = page.getByRole('dialog');
		await expect(txModal.getByRole('heading', { name: 'Add transaction' })).toBeVisible();
		await txModal.getByRole('button', { name: 'Transfer', exact: true }).click();
		await txModal.getByLabel('Amount').fill('20k');
		await txModal.getByLabel('To Account').selectOption('Savings');
		await txModal.getByRole('button', { name: 'Save' }).click();
		// Wait for the modal overlay to clear before navigating (condition, not
		// a fixed wait) — otherwise the backdrop intercepts the nav click.
		await expect(page.getByRole('dialog')).toBeHidden();

		await page.getByRole('link', { name: 'Transactions', exact: true }).click();
		const main = page.getByRole('main');
		// Expense is prefixed with "-" (transactions/+page.svelte:102); VND formats
		// with no fraction digits under en-US locale (currency.ts:4) → "-₫50,000".
		await expect(main.getByText('-₫50,000')).toBeVisible();
		await expect(main.getByText('₫1,200')).toBeVisible();
	});

	test('edit a transaction changes the amount in the list', async ({ onboardedPage: page }) => {
		await addTransaction(page, { kind: 'expense', amount: '50k' });
		await page.getByRole('link', { name: 'Transactions', exact: true }).click();
		// Open edit via the row's flex-1 button (transactions/+page.svelte:92). Its
		// accessible name is "{payee||label} {date} · {label}" — for a payee-less
		// expense that is "Expense Today · Expense". The amount ("-₫50,000") is a
		// sibling <span>, not inside the button, so it can't be the click target.
		await page.getByRole('main').getByRole('button', { name: /^Expense/ }).click();
		const editModal = page.getByRole('dialog');
		// Modal title is m.transactions_edit() = "Edit transaction" (+page.svelte:120).
		await expect(editModal.getByRole('heading', { name: 'Edit transaction' })).toBeVisible();
		await editModal.getByLabel('Amount').fill('75k');
		// Edit-mode save button is m.forms_save_changes() = "Save changes"
		// (TransactionForm.svelte:171), NOT the add-mode "Save".
		await editModal.getByRole('button', { name: 'Save changes' }).click();
		await expect(page.getByRole('main').getByText('-₫75,000')).toBeVisible();
		await expect(page.getByRole('main').getByText('-₫50,000')).toHaveCount(0);
	});

	test('delete a transaction removes it from the list', async ({ onboardedPage: page }) => {
		await addTransaction(page, { kind: 'expense', amount: '50k' });
		await page.getByRole('link', { name: 'Transactions', exact: true }).click();
		await expect(page.getByRole('main').getByText('-₫50,000')).toBeVisible();
		// Delete is a direct ✕ button (transactions/+page.svelte:106); no
		// ConfirmDialog — doDelete runs immediately. The ✕ alone is ambiguous
		// (a modal close ✕ also exists), so scope by its title="Delete".
		await page.getByRole('main').getByTitle('Delete').click();
		await expect(page.getByRole('main').getByText('-₫50,000')).toHaveCount(0);
	});

	test('transfer kind is disabled in edit mode', async ({ onboardedPage: page }) => {
		await addTransaction(page, { kind: 'expense', amount: '50k' });
		await page.getByRole('link', { name: 'Transactions', exact: true }).click();
		// Row button accessible name: "Expense Today · Expense" (see edit test).
		await page.getByRole('main').getByRole('button', { name: /^Expense/ }).click();
		const editModal = page.getByRole('dialog');
		// Kind buttons carry disabled={isEdit} (TransactionForm.svelte:145).
		await expect(editModal.getByRole('button', { name: 'Expense', exact: true })).toBeDisabled();
	});
});
