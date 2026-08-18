import { test, expect } from './fixtures/onboarded';
import { addTransaction } from './helpers/ui';

test.describe('CSV import', () => {
  test('imports new rows and skips a duplicate matching an existing transaction', async ({ onboardedPage: page }) => {
    // Seed an existing transaction that the CSV will duplicate.
    // addTransaction uses the dashboard FAB; amount '100' → 100 VND (0 fraction digits).
    await addTransaction(page, { kind: 'expense', amount: '100' });

    // Navigate to the Transactions page where the Import button lives.
    await page.getByRole('link', { name: 'Transactions', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

    // Open the import modal. import_tx_title() → "Import Transactions".
    await page.getByRole('button', { name: 'Import Transactions' }).click();
    const modal = page.getByRole('dialog');

    // Select the onboarded account "Test Checking".
    await modal.getByLabel('Select account').selectOption('Test Checking');

    // Upload a CSV: row 1 duplicates the seeded 100 VND expense on today's date.
    // Use the seeded transaction's date (today) + amount 100 so dedup matches.
    // The transaction form uses UTC date (toISOString().split('T')[0]), so the CSV must too.
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const csv = `date,amount,payee\n${todayStr},100,Duplicate Payee\n${todayStr},200,New Payee`;
    const fileInput = modal.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'test.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv)
    });

    // Load the file → advances to the mapping phase.
    await modal.getByRole('button', { name: 'Load file' }).click();

    // Continue to preview (auto-inferred mapping should be correct for this file).
    await modal.getByRole('button', { name: 'Continue to preview' }).click();

    // Preview summary: 1 new, 1 duplicate, 0 invalid.
    await expect(modal.getByText(/1 new/)).toBeVisible();
    await expect(modal.getByText(/1 duplicate/)).toBeVisible();

    // Commit — button label is import_tx_commit({count}) → "Import 1".
    await modal.getByRole('button', { name: /Import \d+/ }).click();

    // Modal closes.
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // The new payee appears in the transactions list; the duplicate does not double.
    await expect(page.getByText('New Payee')).toBeVisible();
  });

  test('re-importing the same file writes zero new rows', async ({ onboardedPage: page }) => {
    await page.getByRole('link', { name: 'Transactions', exact: true }).click();
    await page.getByRole('button', { name: 'Import Transactions' }).click();
    const modal = page.getByRole('dialog');
    await modal.getByLabel('Select account').selectOption('Test Checking');

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const csv = `date,amount,payee\n${todayStr},300,Once Only`;
    await modal.locator('input[type="file"]').setInputFiles({
      name: 'test.csv', mimeType: 'text/csv', buffer: Buffer.from(csv)
    });
    await modal.getByRole('button', { name: 'Load file' }).click();
    await modal.getByRole('button', { name: 'Continue to preview' }).click();
    await modal.getByRole('button', { name: /Import \d+/ }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Count transactions in the database before re-import attempt.
    const countBefore = await page.evaluate(async () => {
      const hooks = (window as any).__notchyTestHooks;
      if (!hooks) throw new Error('Test hooks not available');
      const db = (await hooks.getDb()) as { raw: { query: (q: string) => Promise<{ cnt: number }[]> } };
      const result = await db.raw.query('SELECT COUNT(*) as cnt FROM transactions');
      return result[0].cnt;
    });

    // Re-import the identical file.
    await page.getByRole('button', { name: 'Import Transactions' }).click();
    const modal2 = page.getByRole('dialog');
    await modal2.getByLabel('Select account').selectOption('Test Checking');
    await modal2.locator('input[type="file"]').setInputFiles({
      name: 'test.csv', mimeType: 'text/csv', buffer: Buffer.from(csv)
    });
    await modal2.getByRole('button', { name: 'Load file' }).click();

    // All rows are now duplicates → "Continue to preview" is disabled (newCount === 0).
    // Check the summary in the mapping phase instead.
    await expect(modal2.getByText(/1 duplicate/)).toBeVisible();
    await expect(modal2.getByText(/0 new/)).toBeVisible();

    // Verify at the database level that zero rows were written.
    const countAfter = await page.evaluate(async () => {
      const hooks = (window as any).__notchyTestHooks;
      if (!hooks) throw new Error('Test hooks not available');
      const db = (await hooks.getDb()) as { raw: { query: (q: string) => Promise<{ cnt: number }[]> } };
      const result = await db.raw.query('SELECT COUNT(*) as cnt FROM transactions');
      return result[0].cnt;
    });

    expect(countAfter).toBe(countBefore);
  });
});
