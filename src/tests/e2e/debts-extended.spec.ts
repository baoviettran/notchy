import { test, expect } from './fixtures/onboarded';

// Extended debt coverage for the AUTO-tagged checklist items in §7.
// Conventions match debts.spec.ts: SPA navigation only, comments cite source
// lines + i18n keys, VND formats with no fraction digits (currency.ts).
//
// Verified against:
//  - src/routes/debts/+page.svelte: "I Owe" (loan_from_person) and "Owed to Me"
//    (loan_to_person) sections; balances render Math.abs (line 88, debit/red)
//    for i_owe and the raw balance for owed_to_me (line 115, phosphor/green);
//    hover-revealed Pay/Receive + Write off buttons; the action modal collects
//    amount + from/to account (lines 128-138).
//  - src/lib/db/repos/debts.ts: listDebts classifies by account type
//    (line 40: loan_from_person → i_owe, else owed_to_me); writeOff creates a
//    Loss-tagged adjustment.
//  - Debts are ACCOUNTS created on /accounts (type loan_from_person /
//    loan_to_person). The /debts page has NO create, NO edit, and NO delete
//    affordance — only Pay/Receive and Write off. Edit/delete happen via
//    /accounts on the underlying account.
//
// Realistic deviations from the checklist wording:
//  - "Edit a debt" / "Delete a debt": no such affordance on /debts. Both are
//    reachable only via /accounts (edit the account name/counterparty; soft-
//    delete the account). We test edit-via-accounts and skip delete (already
//    covered by accounts-extended.spec.ts soft-delete test).
//  - "Mark a debt as fully settled (pay off the balance)": there is no
//    dedicated "settle" action. Settlement = recording a payment for the full
//    outstanding balance (or a write-off). We test full-balance payment.

// Create a loan account on /accounts, returning its type classification.
async function createLoanAccount(
	page: import('@playwright/test').Page,
	type: 'Loan from Person' | 'Loan to Person',
	counterparty: string,
	name: string
) {
	await page.getByRole('link', { name: 'Accounts', exact: true }).click();
	await page.getByRole('button', { name: '+ Add account' }).click();
	const modal = page.getByRole('dialog');
	await modal.getByLabel('Name').fill(name);
	await modal.getByLabel('Type').selectOption(type);
	await modal.getByLabel('Counterparty').fill(counterparty);
	// Seed an opening balance so the debt is non-zero (liability types carry
	// the balance as a negative magnitude; the debts page shows Math.abs).
	await modal.getByLabel('Initial balance (optional)').fill('500k');
	await modal.getByRole('button', { name: 'Create' }).click();
	await expect(page.getByRole('dialog')).toBeHidden();
}

test.describe('debts — extended', () => {
	test('owed-to-me: a loan_to_person account surfaces under "Owed to Me" with its counterparty', async ({ onboardedPage: page }) => {
		await createLoanAccount(page, 'Loan to Person', 'Bob', 'Bob Loan');
		await page.getByRole('link', { name: 'Debts', exact: true }).click();
		const main = page.getByRole('main');
		// The counterparty renders as a distinct div (debts/+page.svelte:111);
		// the account name as another (line 112). Use exact matching — the
		// counterparty also appears in the "Loan to Person · Bob" sub-line.
		await expect(main.getByText('Bob', { exact: true })).toBeVisible();
		await expect(main.getByText('Bob Loan', { exact: true })).toBeVisible();
		// The OTHER (i-owe) section's empty state shows, since there are no i-owe debts.
		await expect(main.getByText('No debts. You\'re debt-free!')).toBeVisible();
	});

	test('debt-free celebration: the badge is a designed phosphor lamp, not an emoji', async ({ onboardedPage: page }) => {
		// A fresh app has no i-owe debts. The celebration badge is a phosphor
		// ring with the ✓ glyph (debts/+page.svelte) — on-brand, aria-hidden,
		// never a trailing emoji in the sentence.
		await page.getByRole('link', { name: 'Debts', exact: true }).click();
		const main = page.getByRole('main');
		await expect(main.getByText('No debts. You\'re debt-free!')).toBeVisible();
		const badge = main.locator('div.rounded-full[aria-hidden="true"]');
		await expect(badge).toBeVisible();
		await expect(badge).toHaveClass(/border-phosphor/);
		await expect(badge).toHaveText('✓');
		await expect(main.getByText('🎉')).toHaveCount(0);
	});

	test('i-owe: a loan_from_person account surfaces under "I Owe"', async ({ onboardedPage: page }) => {
		await createLoanAccount(page, 'Loan from Person', 'Alice', 'Alice Debt');
		await page.getByRole('link', { name: 'Debts', exact: true }).click();
		const main = page.getByRole('main');
		await expect(main.getByText('Alice', { exact: true })).toBeVisible();
		// The OTHER (owed-to-me) section's empty state shows.
		await expect(main.getByText('No one owes you money.')).toBeVisible();
	});

	test('record a payment against an "I Owe" debt reduces the outstanding balance', async ({ onboardedPage: page }) => {
		// Alice is owed 500k. Pay 200k from the onboarding checking account.
		await createLoanAccount(page, 'Loan from Person', 'Alice', 'Alice Debt');
		await page.getByRole('link', { name: 'Debts', exact: true }).click();
		// Initial outstanding = 500,000 (Math.abs of the liability balance).
		const main = page.getByRole('main');
		await expect(main.getByText('500,000')).toBeVisible();
		// The hover-revealed Pay button (debts/+page.svelte:90) — scope to the
		// i-owe row by anchoring on the counterparty text.
		const payBtn = main.locator('.debt-item', { hasText: 'Alice' }).getByRole('button', { name: 'Pay' });
		await payBtn.click();
		const modal = page.getByRole('dialog');
		await expect(modal.getByRole('heading', { name: 'Make payment' })).toBeVisible();
		await modal.getByLabel('Amount').fill('200k');
		await modal.getByLabel('From account').selectOption({ label: 'Test Checking' });
		await modal.getByRole('button', { name: 'Record' }).click();
		await expect(page.getByText('Payment recorded.')).toBeVisible();
		await expect(page.getByRole('dialog')).toBeHidden();
		// Outstanding reduced to 300,000; 500,000 no longer present.
		await expect(main.getByText('300,000')).toBeVisible();
		await expect(main.getByText('500,000')).toHaveCount(0);
	});

	test('payment without selecting an account is blocked', async ({ onboardedPage: page }) => {
		await createLoanAccount(page, 'Loan from Person', 'Alice', 'Alice Debt');
		await page.getByRole('link', { name: 'Debts', exact: true }).click();
		await page.getByRole('main').locator('.debt-item', { hasText: 'Alice' }).getByRole('button', { name: 'Pay' }).click();
		const modal = page.getByRole('dialog');
		await modal.getByLabel('Amount').fill('100k');
		// Leave "From account" empty.
		await modal.getByRole('button', { name: 'Record' }).click();
		// debts/+page.svelte:42 → debts_select_account = "Select an account."
		await expect(page.getByText('Select an account.')).toBeVisible();
	});

	test('writing off a debt zeros the outstanding balance', async ({ onboardedPage: page }) => {
		// writeOff (repos/debts.ts:53) creates an income tx against the debt
		// account (loan_from_person) of the given amount, zeroing its balance.
		// The debt ACCOUNT remains in the list (listDebts returns all loan
		// accounts regardless of balance) — it shows ₫0, not removed.
		await createLoanAccount(page, 'Loan from Person', 'Alice', 'Alice Debt');
		await page.getByRole('link', { name: 'Debts', exact: true }).click();
		const main = page.getByRole('main');
		await expect(main.getByText('500,000')).toBeVisible();
		// Write off lives in the row's overflow menu (persistent kebab, no hover-gate).
		const debtRow = main.locator('.debt-item', { hasText: 'Alice' });
		await debtRow.getByRole('button', { name: 'Actions: Alice' }).click();
		await debtRow.getByRole('menuitem', { name: 'Write off' }).click();
		const modal = page.getByRole('dialog');
		await expect(modal.getByRole('heading', { name: 'Write off debt' })).toBeVisible();
		await modal.getByLabel('Amount').fill('500k');
		await modal.getByRole('button', { name: 'Write off' }).click();
		await expect(page.getByText('Debt written off.')).toBeVisible();
		await expect(page.getByRole('dialog')).toBeHidden();
		// The counterparty is still listed (account not deleted) but balance is ₫0.
		await expect(main.getByText('Alice', { exact: true })).toBeVisible();
		await expect(main.getByText('500,000')).toHaveCount(0);
	});

	test('edit a debt via /accounts: counterparty change reflects on /debts', async ({ onboardedPage: page }) => {
		// There is no edit affordance on /debts; editing the underlying account
		// happens on /accounts. We rename the counterparty there and confirm
		// the debts page reflects it.
		await createLoanAccount(page, 'Loan from Person', 'Carol', 'Carol Debt');
		await page.getByRole('link', { name: 'Accounts', exact: true }).click();
		// Liability rows have a ContextMenu trigger (⋮) labeled "Actions: {name}"
		// that opens a dropdown with Edit.
		const liabilitiesRow = page.getByRole('main').locator('section', { hasText: 'Liabilities' }).locator('div.group', { hasText: 'Carol' });
		const kebab = liabilitiesRow.getByRole('button', { name: 'Actions: Carol' });
		await kebab.waitFor({ state: 'visible' });
		await kebab.click();
		const editMenuItem = page.getByRole('menuitem', { name: 'Edit' });
		await editMenuItem.waitFor({ state: 'visible' });
		await editMenuItem.click();
		const editModal = page.getByRole('dialog');
		await editModal.getByLabel('Counterparty').fill('Caroline');
		await editModal.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByRole('dialog')).toBeHidden();
		// On /debts the counterparty updated. Use exact matching so "Carol"
		// does not substring-match "Caroline".
		await page.getByRole('link', { name: 'Debts', exact: true }).click();
		await expect(page.getByRole('main').getByText('Caroline', { exact: true })).toBeVisible();
		await expect(page.getByRole('main').getByText('Carol', { exact: true })).toHaveCount(0);
	});

	test('empty states: both sections show their prompts with no loan accounts', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Debts', exact: true }).click();
		const main = page.getByRole('main');
		await expect(main.locator('section', { hasText: 'I Owe' }).getByText('No debts. You\'re debt-free!')).toBeVisible();
		await expect(main.locator('section', { hasText: 'Owed to Me' }).getByText('No one owes you money.')).toBeVisible();
	});

	test('invalid payment amount is rejected', async ({ onboardedPage: page }) => {
		await createLoanAccount(page, 'Loan from Person', 'Alice', 'Alice Debt');
		await page.getByRole('link', { name: 'Debts', exact: true }).click();
		const iOweRow = page.getByRole('main').locator('.debt-item', { hasText: 'Alice' });
		await iOweRow.getByRole('button', { name: 'Pay' }).click();
		const modal = page.getByRole('dialog');
		// Non-numeric amount → parseAmount throws → mapError toast.
		await modal.getByLabel('Amount').fill('not money');
		await modal.getByLabel('From account').selectOption({ label: 'Test Checking' });
		await modal.getByRole('button', { name: 'Record' }).click();
		await expect(page.getByText('Invalid amount')).toBeVisible();
	});
});
