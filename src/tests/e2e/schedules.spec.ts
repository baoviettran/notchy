import { test, expect, rawQuery, flushDb } from './fixtures/tauri-mock';
import { onboard } from './helpers/ui';
import type { Page } from '@playwright/test';

/**
 * Scheduled transactions end to end (Tauri IPC mock).
 *
 * Drives the REAL posting engine (`postDueSchedulesOnce`, wired into the root
 * layout's boot effect) against the Task 12 Tauri IPC mock, so the whole
 * journey — UI create → boot posts → schedule advances → a second boot does NOT
 * re-post — runs on the production code path.
 *
 * Persist mode is required: the journey crosses full page loads
 * (`page.goto('/schedules')` and two `page.reload()`s), and the mock's virtual
 * FS / DB registry are per-page-load. `flushDb()` is called at each durability
 * point (the mock never auto-flushes from the execute handler — see
 * reload-survival.spec.ts).
 */
test.use({ tauriMockOptions: { persist: true } });

async function liveQuery<T>(page: Page, sql: string): Promise<T[]> {
	return rawQuery<T>(page, sql);
}

const POSTED_ROWS = "FROM transactions WHERE payee = 'Landlord' AND deleted_at IS NULL";

test('a schedule that is due posts on the next open, exactly once', async ({ tauriMockPage: page }) => {
	// Onboarding creates an account and sets first_run_complete, so the next full
	// load runs the boot pass and the schedule below has somewhere to post.
	await onboard(page);
	// Durably persist the onboarded DB before the first full page load; without
	// it the load rehydrates a fresh database and bounces to /onboarding.
	await flushDb(page);

	await page.goto('/schedules');
	await page.getByRole('button', { name: 'New schedule' }).first().click();
	const dialog = page.getByRole('dialog');
	// Expense, monthly, the onboarded account, "posts a transaction", and a start
	// date of today are ScheduleForm's defaults — so the first occurrence is due
	// on the very next boot. Only the identifying fields need typing.
	await dialog.getByLabel('Name').fill('Rent');
	await dialog.getByLabel('Amount').fill('500000');
	await dialog.getByLabel('Payee').fill('Landlord');
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('Rent', { exact: true })).toBeVisible();

	// Persist the created schedule, then reload: the boot pass sees it due and
	// posts it.
	await flushDb(page);
	await page.reload();
	await expect(page.getByRole('button', { name: 'New schedule' }).first()).toBeVisible();

	// The posted row exists exactly once, dated the schedule's start date. Poll:
	// the boot pass is async and may still be running when the page settles.
	const count = async () =>
		(await liveQuery<{ c: number }>(page, `SELECT COUNT(*) AS c ${POSTED_ROWS}`))[0].c;
	await expect.poll(count, { timeout: 10_000 }).toBe(1);
	const first = await liveQuery<{ date: string }>(page, `SELECT MIN(date) AS date ${POSTED_ROWS}`);
	expect(first[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

	// Reloading again must not post it a second time: the schedule advanced past
	// today. This is the assertion that makes the test cover the advance, not
	// just the insert.
	await flushDb(page);
	await page.reload();
	await expect(page.getByRole('button', { name: 'New schedule' }).first()).toBeVisible();
	await expect.poll(count, { timeout: 10_000 }).toBe(1);

	// And the schedule itself moved forward rather than re-firing.
	const schedule = await liveQuery<{ next_due_date: string; last_posted_date: string }>(
		page,
		'SELECT next_due_date, last_posted_date FROM schedules WHERE deleted_at IS NULL'
	);
	expect(schedule[0].last_posted_date).toBe(first[0].date);
	expect(schedule[0].next_due_date > first[0].date).toBe(true);
});
