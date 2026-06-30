import { test, expect } from './fixtures/onboarded';

// NOTE on navigation: in-browser tests run against the in-memory sql.js DB
// (src/lib/db/index.ts), which is NOT persisted across a full page reload.
// page.goto() would reload the page, wipe the in-memory DB, and re-trigger
// onboarding. So navigation here uses SPA (client-side) link clicks.

// Verified against src/routes/settings/+page.svelte and
// src/routes/settings/categories/+page.svelte:
//  - The sidebar exposes a "Settings" link (m.nav_settings).
//  - The settings index page links to categories via a card whose visible
//    text is {m.settings_categories()} = "Categories" (settings/+page.svelte:26).
//  - The categories page heading is {m.categories_title()} = "Categories"
//    (categories/+page.svelte:82).
//  - Add button is {m.categories_add_tag()} = "+ Add tag" (line 83).
//  - Create form: Name input label {m.categories_name()} = "Name" (line 116),
//    Create button {m.categories_create()} = "Create" (line 120).
//  - Each non-system tag row has a Delete button {m.categories_delete()} =
//    "Delete" (line 103). They are hover-revealed (opacity-0 group-hover) but
//    Playwright clicks them regardless of CSS visibility.
//  - The merge Select (line 136) only renders when affectedCount > 0, i.e. the
//    tag is referenced by at least one transaction. The merge target option
//    label is {m.categories_merge_into({ name })} = "Merge into: <name>".
//    The Select is a native <select> (Select.svelte).
//  - Delete-confirm modal danger button is {m.common_delete()} = "Delete"
//    (line 140) — same text as the row Delete buttons, so it must be scoped
//    inside the delete modal (the last-opened dialog).
//
// To genuinely exercise merge-into (not just unreferenced delete), the test
// creates two tags, tags a transaction with Tag A via the TransactionForm tag
// Autocomplete, then deletes Tag A choosing "Merge into: Tag B".

test('a tag can be created, and deleting a referenced tag merges into another', async ({ onboardedPage: page }) => {
	// SPA navigation to /settings/categories (keeps the in-memory DB alive).
	await page.getByRole('link', { name: 'Settings', exact: true }).click();
	await page.getByRole('link', { name: /Categories/ }).first().click();
	await expect(page.getByRole('heading', { name: 'Categories', exact: true })).toBeVisible();

	// Create Tag A.
	await page.getByRole('button', { name: '+ Add tag' }).click();
	let modal = page.getByRole('dialog');
	await modal.getByLabel('Name').fill('Tag A');
	await modal.getByRole('button', { name: 'Create' }).click();
	await expect(page.getByText('Tag A')).toBeVisible();

	// Create Tag B.
	await page.getByRole('button', { name: '+ Add tag' }).click();
	modal = page.getByRole('dialog');
	await modal.getByLabel('Name').fill('Tag B');
	await modal.getByRole('button', { name: 'Create' }).click();
	await expect(page.getByText('Tag B')).toBeVisible();

	// Tag a transaction with Tag A so the tag becomes referenced
	// (affectedCount > 0), which is the only path that surfaces the merge Select.
	await page.getByRole('button', { name: 'Add transaction' }).click();
	const txModal = page.getByRole('dialog');
	// The Tag field is an Autocomplete (role="combobox") labelled "Tag".
	const tagCombo = txModal.getByLabel('Tag');
	await tagCombo.click();
	await tagCombo.fill('Tag A');
	await page.getByRole('option', { name: 'Tag A' }).click();
	await txModal.getByLabel('Amount').fill('10k');
	await txModal.getByRole('button', { name: 'Save' }).click();

	// Return to /settings/categories via SPA navigation.
	await page.getByRole('link', { name: 'Settings', exact: true }).click();
	await page.getByRole('link', { name: /Categories/ }).first().click();

	// Delete Tag A, merging into Tag B. Tag A is the first row, so its Delete
	// button is the first one. The row Delete buttons are hover-revealed but
	// Playwright interacts regardless of CSS opacity.
	await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
	const delModal = page.getByRole('dialog');
	// Tag A is referenced, so the merge Select must appear.
	const mergeSelect = delModal.locator('select').first();
	await expect(mergeSelect).toBeVisible();
	await mergeSelect.selectOption({ label: 'Merge into: Tag B' });
	await delModal.getByRole('button', { name: 'Delete', exact: true }).click();

	// Tag A is gone; Tag B remains.
	await expect(page.getByText('Tag A')).toHaveCount(0);
	await expect(page.getByText('Tag B')).toBeVisible();
});
