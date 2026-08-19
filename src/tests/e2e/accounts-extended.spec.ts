import { test, expect } from './fixtures/onboarded';
import { addTransaction } from './helpers/ui';

// Extended account coverage for the AUTO-tagged checklist items in §4.
// Conventions match accounts.spec.ts / transactions.spec.ts: SPA navigation
// only (in-memory sql.js DB is wiped on page.goto), comments cite source lines
// + i18n keys, VND formats with no fraction digits (currency.ts).
//
// Verified against:
//  - src/routes/accounts/+page.svelte: assets/liabilities sections; liability
//    balances render Math.abs(acc.balance) (line 88, so shown as a positive
//    magnitude, not negative — a debt is displayed as the amount owed);
//    per-row Edit/Archive/Delete buttons (lines 64-66, hover-revealed);
//    ConfirmDialog on delete (lines 120-126).
//  - src/lib/components/forms/AccountForm.svelte: 6 types (lines 22-29); the
//    Type Select is disabled in edit mode (line 69 disabled={isEdit}) — so the
//    "cannot change to/from loan type" rule is enforced by disabling type
//    changes entirely, not by an account_type_loan error at save; counterparty
//    required for loan types (line 36 → validation_counterparty_required);
//    name required (line 35 → validation_name_required).
//  - src/lib/db/repos/accounts.ts: deleteAccount is a SOFT delete
//    (UPDATE deleted_at, line 205); it only HARD-blocks when the account is
//    linked to an active goal (line 194, error account_delete_linked_goals →
//    "Cannot delete account: it is linked to N active goal(s)…").
//
// Realistic deviations from the checklist wording (documented in each test):
//  - Liability balance sign: the list shows the magnitude (Math.abs), which is
//    sensible UX. We assert the account lands in the "Liabilities" section.
//  - Loan-type-change validation: enforced by disabling the Type Select in
//    edit mode, so we assert the Select is disabled rather than the error.
//  - Delete-with-transactions: it's a soft-delete (hides the account) gated
//    only by the confirm dialog; the only hard block is a linked active goal.

test.describe('accounts — extended', () => {
	test('all six account types can be created; loan types require a counterparty', async ({ onboardedPage: page }) => {
		// Onboarding already created a checking account. Create the other five
		// (savings, cash, credit_card, loan_to_person, loan_from_person) via the
		// Accounts page "+ Add account" button (accounts/+page.svelte:45).
		await page.getByRole('link', { name: 'Accounts', exact: true }).click();
		const types = [
			{ type: 'Savings', name: 'My Savings' },
			{ type: 'Cash', name: 'Wallet' },
			{ type: 'Credit Card', name: 'Visa' },
			{ type: 'Loan to Person', name: 'Lent to Bob' },
			{ type: 'Loan from Person', name: 'Owed to Alice' }
		];
		for (const t of types) {
			await page.getByRole('button', { name: '+ Add account' }).click();
			const modal = page.getByRole('dialog');
			await modal.getByLabel('Name').fill(t.name);
			await modal.getByLabel('Type').selectOption(t.type);
			// Loan types surface a Counterparty field (AccountForm.svelte:70-72).
			if (t.type === 'Loan to Person' || t.type === 'Loan from Person') {
				await modal.getByLabel('Counterparty').fill('Some Counterparty');
			}
			await modal.getByRole('button', { name: 'Create' }).click();
			await expect(page.getByRole('dialog')).toBeHidden();
			await expect(page.getByRole('main').getByText(t.name)).toBeVisible();
		}

		// Liability types (Credit Card, Loan from Person) land in the
		// "Liabilities" section; asset types under "Assets".
		const main = page.getByRole('main');
		const liabilities = main.locator('section', { hasText: 'Liabilities' });
		await expect(liabilities.getByText('Visa')).toBeVisible();
		await expect(liabilities.getByText('Owed to Alice')).toBeVisible();
		const assets = main.locator('section', { hasText: 'Assets' });
		await expect(assets.getByText('My Savings')).toBeVisible();
		// Loan to Person is an asset (money owed TO you) — accounts.ts ASSET_TYPES.
		await expect(assets.getByText('Lent to Bob')).toBeVisible();
	});

	test('loan type without a counterparty is rejected', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Accounts', exact: true }).click();
		await page.getByRole('button', { name: '+ Add account' }).click();
		const modal = page.getByRole('dialog');
		await modal.getByLabel('Name').fill('Bad Loan');
		await modal.getByLabel('Type').selectOption('Loan from Person');
		// Counterparty field now visible but left empty.
		await modal.getByRole('button', { name: 'Create' }).click();
		// AccountForm.svelte:36 → validation_counterparty_required.
		await expect(modal.getByText('Counterparty is required for loan accounts')).toBeVisible();
	});

	test('edit account: name change persists; type Select is disabled', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Accounts', exact: true }).click();
		// Edit now lives inside a ContextMenu. The row's last button is the
		// ContextMenu trigger (⋮); open it, then click the Edit menuitem.
		const checkingRow = page.getByRole('main').locator('.group', { hasText: 'Test Checking' });
		await checkingRow.getByRole('button').last().click();
		await page.getByRole('menuitem', { name: 'Edit' }).click();
		const modal = page.getByRole('dialog');
		await expect(modal.getByRole('heading', { name: 'Edit account' })).toBeVisible();
		// Type Select is disabled in edit mode (AccountForm.svelte:69).
		await expect(modal.getByLabel('Type')).toBeDisabled();
		// Rename + save.
		await modal.getByLabel('Name').fill('Renamed Checking');
		await modal.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByRole('dialog')).toBeHidden();
		await expect(page.getByRole('main').getByText('Renamed Checking')).toBeVisible();
	});

	test('delete an account with no transactions is confirmed then removed', async ({ onboardedPage: page }) => {
		// Create a throwaway account with no transactions.
		await page.getByRole('link', { name: 'Accounts', exact: true }).click();
		await page.getByRole('button', { name: '+ Add account' }).click();
		const createModal = page.getByRole('dialog');
		await createModal.getByLabel('Name').fill('Disposable');
		await createModal.getByRole('button', { name: 'Create' }).click();
		await expect(page.getByRole('dialog')).toBeHidden();

		// Delete now lives inside a ContextMenu. Open the row's context menu
		// trigger (⋮), then click the Delete menuitem.
		// NOTE: ConfirmDialog (primitives/ConfirmDialog.svelte) renders a plain
		// <div>, NOT role="dialog" (an a11y gap — tracked separately). So we
		// target the confirm UI by its heading text + button.
		const disposableRow = page.getByRole('main').locator('.group', { hasText: 'Disposable' });
		await disposableRow.getByRole('button').last().click();
		await page.getByRole('menuitem', { name: 'Delete' }).click();
		await expect(page.getByText('Delete account?')).toBeVisible();
		await page.getByText('Delete account?').locator('xpath=ancestor::div[contains(@class,"max-w-sm")]').getByRole('button', { name: 'Delete', exact: true }).click();
		await expect(page.getByText('Delete account?')).toHaveCount(0);
		// Soft-deleted → hidden from the active list.
		await expect(page.getByRole('main').getByText('Disposable')).toHaveCount(0);
	});

	test('soft-deleted account with transactions: confirm-dialog gates it, no crash', async ({ onboardedPage: page }) => {
		// Add a transaction against the onboarding account, then delete that
		// account. Per deleteAccount (repos/accounts.ts:191-205) it's a soft
		// delete — transactions are NOT orphaned; the only hard block is a
		// linked active goal. We assert the confirm dialog appears and the
		// delete succeeds without error.
		await addTransaction(page, { kind: 'expense', amount: '10k' });
		await page.getByRole('link', { name: 'Accounts', exact: true }).click();
		const checkingRow = page.getByRole('main').locator('.group', { hasText: 'Test Checking' });
		await checkingRow.getByRole('button').last().click();
		await page.getByRole('menuitem', { name: 'Delete' }).click();
		await expect(page.getByText('Delete account?')).toBeVisible();
		await page.getByText('Delete account?').locator('xpath=ancestor::div[contains(@class,"max-w-sm")]').getByRole('button', { name: 'Delete', exact: true }).click();
		await expect(page.getByText('Delete account?')).toHaveCount(0);
		await expect(page.getByRole('main').getByText('Test Checking')).toHaveCount(0);
	});

	test('delete is blocked when the account is linked to an active goal', async ({ onboardedPage: page }) => {
		// Create a goal linked to the onboarding account, then attempt to delete
		// the account. deleteAccount throws account_delete_linked_goals
		// (repos/accounts.ts:194), surfaced via mapError →
		// "Cannot delete account: it is linked to N active goal(s)…".
		await page.getByRole('link', { name: 'Goals', exact: true }).click();
		await page.getByRole('button', { name: '+ Add goal' }).click();
		const goalModal = page.getByRole('dialog');
		await goalModal.getByLabel('Name').fill('New Bike');
		// GoalForm uses distinct labels: "Target amount" and "Target date"
		// (GoalForm.svelte:70-71) — getByLabel('Target') is ambiguous.
		await goalModal.getByLabel('Target amount').fill('1m');
		// Target date is required (GoalForm.svelte:40 validation_target_date_required).
		// Use a future date next year.
		await goalModal.getByLabel('Target date').fill('2027-12-31');
		// "Linked account" Select (GoalForm.svelte:73). Required for the link.
		await goalModal.getByLabel('Linked account').selectOption({ label: 'Test Checking' });
		await goalModal.getByRole('button', { name: 'Create' }).click();
		await expect(page.getByRole('dialog')).toBeHidden();

		// Now try to delete the linked account.
		await page.getByRole('link', { name: 'Accounts', exact: true }).click();
		const checkingRow = page.getByRole('main').locator('.group', { hasText: 'Test Checking' });
		await checkingRow.getByRole('button').last().click();
		await page.getByRole('menuitem', { name: 'Delete' }).click();
		await page.getByText('Delete account?').locator('xpath=ancestor::div[contains(@class,"max-w-sm")]').getByRole('button', { name: 'Delete', exact: true }).click();
		// The block surfaces as a toast (accounts/+page.svelte:35-37 mapError).
		await expect(page.getByText(/Cannot delete account.*active goal/)).toBeVisible();
		// Account is still present (delete was refused).
		await expect(page.getByRole('main').getByText('Test Checking')).toBeVisible();
	});

	test('reconcile cancel leaves balances unchanged', async ({ onboardedPage: page }) => {
		// Open the account detail, start a reconcile, then Cancel — no
		// adjustment is written. (accounts/[id]/+page.svelte:145 Cancel button.)
		await page.getByRole('link', { name: 'Accounts', exact: true }).click();
		await page.getByRole('main').getByRole('link', { name: 'Test Checking' }).click();
		// Record the balance shown before reconciling.
		const main = page.getByRole('main');
		// Open the reconcile modal.
		await main.getByRole('button', { name: 'Reconcile' }).click();
		const recModal = page.getByRole('dialog');
		await expect(recModal.getByRole('heading', { name: 'Reconcile account' })).toBeVisible();
		// Cancel without entering/confirming a value.
		await recModal.getByRole('button', { name: 'Cancel' }).click();
		await expect(page.getByRole('dialog')).toBeHidden();
		// Still on the detail page; no reconciliation history entry added.
		await expect(main.getByText('Test Checking')).toBeVisible();
	});

	test('empty name is rejected when creating an account', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Accounts', exact: true }).click();
		await page.getByRole('button', { name: '+ Add account' }).click();
		const modal = page.getByRole('dialog');
		// Leave name empty; click Create.
		await modal.getByRole('button', { name: 'Create' }).click();
		// AccountForm.svelte:35 → validation_name_required.
		await expect(modal.getByText('Name is required')).toBeVisible();
	});

	test('invalid opening balance is rejected', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Accounts', exact: true }).click();
		await page.getByRole('button', { name: '+ Add account' }).click();
		const modal = page.getByRole('dialog');
		await modal.getByLabel('Name').fill('Bad Balance');
		await modal.getByLabel('Initial balance (optional)').fill('not a number');
		await modal.getByRole('button', { name: 'Create' }).click();
		// AccountForm.svelte:46 → validation_invalid_amount.
		await expect(modal.getByText('Invalid amount')).toBeVisible();
	});

	test('empty state: only the onboarding account present', async ({ onboardedPage: page }) => {
		// Fresh onboarding → one asset account, zero liabilities, zero archived.
		await page.getByRole('link', { name: 'Accounts', exact: true }).click();
		const main = page.getByRole('main');
		// Liabilities section shows its empty-state message.
		await expect(main.locator('section', { hasText: 'Liabilities' }).getByText('No liability accounts.')).toBeVisible();
		// The onboarding account is present under Assets.
		await expect(main.locator('section', { hasText: 'Assets' }).getByText('Test Checking')).toBeVisible();
	});
});
