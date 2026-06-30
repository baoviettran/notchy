import { test, expect } from './fixtures/onboarded';

/**
 * /debts is read-only: debts surface as loan-type accounts created on /accounts.
 * This spec creates a loan_from_person account (=> "I Owe") via the AccountForm,
 * then verifies the counterparty appears on /debts.
 */
test('a loan created on /accounts surfaces under "I Owe" on /debts', async ({ onboardedPage: page }) => {
	// Create the loan via the Accounts page.
	await page.getByRole('link', { name: 'Accounts', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
	await page.getByRole('button', { name: '+ Add account' }).click();

	const modal = page.getByRole('dialog');
	await expect(modal.getByRole('heading', { name: 'Add account' })).toBeVisible();
	await modal.getByLabel('Name').fill('Car loan');
	// Native <select>: selectOption matches the option's visible label.
	await modal.getByLabel('Type').selectOption({ label: 'Loan from Person' });
	// Loan type reveals the Counterparty field (AccountForm.svelte:71).
	await modal.getByLabel('Counterparty').fill('Acme Motors');
	await modal.getByLabel('Initial balance (optional)').fill('5000');
	await modal.getByRole('button', { name: 'Create', exact: true }).click();

	// Navigate to /debts via the sidebar.
	await page.getByRole('link', { name: 'Debts', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Debts' })).toBeVisible();

	// The counterparty renders under the "I Owe" section heading.
	const iOwe = page.locator('section', { has: page.getByRole('heading', { name: 'I Owe' }) });
	await expect(iOwe.getByText('Acme Motors')).toBeVisible();
});
