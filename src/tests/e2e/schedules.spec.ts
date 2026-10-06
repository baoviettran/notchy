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
	// Read start_date here, before the schedule query below runs (after the
	// second reload), so the posted row's date can be compared to it directly.
	const start = await liveQuery<{ start_date: string }>(
		page,
		'SELECT start_date FROM schedules WHERE deleted_at IS NULL'
	);
	// Not a format check: the row must be dated the schedule's own start_date.
	// A UTC-vs-local `todayIso` shift or an off-by-one in the engine's re-anchor
	// (`next = schedule.next_due_date ?? schedule.start_date`) posts a different
	// but still well-formed `YYYY-MM-DD`; `toBe` catches it, a regex would not.
	expect(first[0].date).toBe(start[0].start_date);

	// Reloading again must not post it a second time: the schedule advanced past
	// today. This is the assertion that makes the test cover the advance, not
	// just the insert.
	//
	// `markPosted` writes next_due_date and last_posted_date in the same
	// statement, so waiting for last_posted_date to become non-NULL proves the
	// advance has committed before this flush persists it — otherwise reload #2
	// rehydrates a not-yet-advanced schedule and re-posts the same occurrence.
	await expect
		.poll(
			async () =>
				(
					await liveQuery<{ last_posted_date: string | null }>(
						page,
						'SELECT last_posted_date FROM schedules WHERE deleted_at IS NULL'
					)
				)[0]?.last_posted_date,
			{ timeout: 10_000 }
		)
		.not.toBeNull();
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

test('one boot aggregates a posted and a due notice into a single toast', async ({ tauriMockPage: page }) => {
	// Guards the boot toast's aggregation (f994f0f). `bootSummaryMessage` has a
	// unit test, but nothing asserted that +layout.svelte actually calls it once
	// instead of `toast.show`ing each part — and ToastBus keeps a single
	// informational toast, so the old three-call shape left only the last
	// visible. That hole needs a boot with TWO non-zero parts: with one part the
	// aggregate and a single show() render identically, so a one-part boot would
	// guard nothing.
	await onboard(page);
	// Durably persist the onboarded DB before the first full page load.
	await flushDb(page);

	await page.goto('/schedules');

	// A — "Rent": the default controls (expense, monthly, "Posts a transaction",
	// start date today) post one transaction on the next boot → summary.posted = 1.
	await page.getByRole('button', { name: 'New schedule' }).first().click();
	await page.getByRole('dialog').getByLabel('Name').fill('Rent');
	await page.getByRole('dialog').getByLabel('Amount').fill('500000');
	await page.getByRole('dialog').getByLabel('Payee').fill('Landlord');
	await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('Rent', { exact: true })).toBeVisible();

	// B — "Netflix": "Reminder only" (posts_transaction = 0) fires no
	// transaction but contributes a name to summary.notices → the due part.
	await page.getByRole('button', { name: 'New schedule' }).first().click();
	await page.getByRole('dialog').getByLabel('Name').fill('Netflix');
	await page.getByRole('dialog').getByLabel('Amount').fill('200000');
	await page.getByRole('dialog').getByRole('radio', { name: 'Reminder only' }).check();
	await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('Netflix', { exact: true })).toBeVisible();

	// Both schedules are dated today, so the next boot posts A and notices B in
	// the one pass: `bootSummaryMessage` joins them — under the old three
	// sequential show() calls only the due (last) one survived, so the posted
	// substring below is what makes this fail against the un-aggregated layout.
	await flushDb(page);
	await page.reload();

	// Both parts sit in ONE element's text, so assert them together in a single
	// regex. Not `toContainText([a, b])`: the array form is positional across
	// matched elements and would compare the second string against a non-existent
	// second element, so it can never pass against this single `role="status"`
	// region. The regex also pins the order the aggregation joins them in. The
	// toast auto-dismisses after ~3s (ToastBus's timer), but the retrying
	// assertion catches it on the first poll after the reload; `role="status"` is
	// GlobalToast's persistent region.
	await expect(page.getByRole('status')).toContainText(
		/scheduled transactions posted[\s\S]*scheduled transactions are due/
	);
});
