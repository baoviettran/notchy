# Quick-Add UX Polish Implementation Plan
**Serves:** STORY-002

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the quick-add capture window give honest feedback — a live readback of the parsed entry, a distinct and visible error state, and a save confirmation — while keeping every existing save path green.

**Architecture:** Three small, independent behavior fixes, all in the `/quick-add` route, driven by one new pure helper in `quick_parse.ts` so the parse→display contract is unit-tested without a DOM. The helper reuses `parseQuickInput` (it must NOT re-tokenize — `parseAmount` owns `k`/`m`/`tr` expansion) and `formatNumber` for the readback numerals. Error text moves to a new i18n key so it stops impersonating the placeholder, and is recolored to `--debit`. The save path gets a phosphor flash before the window hides, reusing the existing `flash` keyframe.

**Tech Stack:** Svelte 5 runes, Vitest (unit), Playwright (E2E), Paraglide JS 1.11.8 (i18n), Tailwind CSS + `app.css` tokens.

**Spec:** No separate spec file exists. This plan implements findings 1–3 of the 2026-08-19 code + visual UX review of `/quick-add`: (1) the payee line echoes the raw input string instead of the parsed entry, (2) the error renders in the placeholder's own text and color, (3) there is no save confirmation before the window hides. Each task's tests are the acceptance criteria.

## Global Constraints

- TDD red–green–refactor. No exceptions.
- `pnpm test` (vitest) and `pnpm exec playwright test src/tests/e2e/tray-quick-capture.spec.ts` must both pass before each commit.
- i18n: flat underscore keys; add each new key to BOTH `messages/en.json` and `messages/vi.json`. Paraglide regenerates on `pnpm build` (which the E2E webServer runs anyway); regenerate explicitly with `pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide` after editing messages if running unit/check first.
- Amounts stay integers (smallest currency unit) end-to-end.
- `quick_parse.ts` stays pure. The new helper must reuse `parseQuickInput`/`formatNumber`, never re-parse `k`/`m`/`tr` itself.
- `Locale` is `'en' | 'vi'` (number_parse.ts:3). E2E runs English. Confirmed Intl output: `formatNumber(50000,'en')` = `"50,000"`, `formatNumber(50000,'vi')` = `"50.000"`, `formatNumber(20000000,'en')` = `"20,000,000"`.
- E2E must use client-side navigation to preserve the volatile sql.js DB singleton (see the header comment in tray-quick-capture.spec.ts).
- Commit prefix: `fix:`.

**Out of scope** (from the review; separate plans): dead TopBar search, undo in quick-add, shortcut discoverability, refund sign, app-wide tour copy.

---

### Task 1: Add `quickAddReadback` pure helper

**Files:**
- Modify: `src/lib/utils/quick_parse.ts` — add `formatNumber` import + `QuickAddReadback` interface + `quickAddReadback` function
- Test: `src/tests/unit/quick_parse.test.ts`

**Interfaces:**
- Consumes: `parseQuickInput(input, locale, currency)` → `{ kind: 'expense'|'income', amount: number, payee: string|null }` (quick_parse.ts:21); `formatNumber(amount, locale)` → string (currency.ts:29).
- Produces: `QuickAddReadback` interface and `quickAddReadback(value: string, locale: Locale, currency?: string): QuickAddReadback | null` — `null` while the input is empty or unparseable; otherwise `{ kind, amountText, payee }` where `amountText` is `formatNumber` output with a `+` prefix for income.

- [ ] **Step 1: Write the failing tests**

Append to `src/tests/unit/quick_parse.test.ts`, after the last `it` block:

```ts
describe('quickAddReadback', () => {
  it('formats a parsed expense into numerals + payee', () => {
    expect(quickAddReadback('50k coffee', 'en')).toEqual({
      kind: 'expense',
      amountText: '50,000',
      payee: 'coffee'
    });
  });

  it('uses vi-VN thousands separators under the vi locale', () => {
    expect(quickAddReadback('50k lương', 'vi')).toEqual({
      kind: 'expense',
      amountText: '50.000',
      payee: 'lương'
    });
  });

  it('prepends + for income', () => {
    expect(quickAddReadback('+20m salary', 'en')).toEqual({
      kind: 'income',
      amountText: '+20,000,000',
      payee: 'salary'
    });
  });

  it('returns null for empty input', () => {
    expect(quickAddReadback('   ', 'en')).toBeNull();
  });

  it('returns null while input is unparseable', () => {
    expect(quickAddReadback('abc', 'en')).toBeNull();
    expect(quickAddReadback('coffee 50k', 'en')).toBeNull();
  });

  it('keeps null payee when the line has no payee', () => {
    expect(quickAddReadback('50k', 'en')).toEqual({
      kind: 'expense',
      amountText: '50,000',
      payee: null
    });
  });
});
```

Also add `quickAddReadback` to the existing import at the top of the file (line 2):

```ts
import { parseQuickInput, quickAddReadback } from '$lib/utils/quick_parse';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run src/tests/unit/quick_parse.test.ts`
Expected: FAIL — `quickAddReadback is not exported` (TypeScript/import error).

- [ ] **Step 3: Implement the helper**

In `src/lib/utils/quick_parse.ts`, add the import (after line 1, keeping the `$lib/errors` import last):

```ts
import { formatNumber } from './currency';
```

Append at the end of the file (after line 45):

```ts
export interface QuickAddReadback {
  kind: 'expense' | 'income';
  /** Formatted numerals, e.g. "50,000" or "+20,000,000" (income gets a '+' prefix). */
  amountText: string;
  payee: string | null;
}

/**
 * Live readback for the quick-add window: print what the machine understood
 * without failing the whole line. Returns null while the input is empty or not
 * yet parseable, so the UI can fall back to echoing the raw text.
 */
export function quickAddReadback(
  value: string,
  locale: Locale,
  currency: string = 'VND'
): QuickAddReadback | null {
  if (value.trim() === '') return null;
  try {
    const parsed = parseQuickInput(value, locale, currency);
    const sign = parsed.kind === 'income' ? '+' : '';
    return {
      kind: parsed.kind,
      amountText: sign + formatNumber(parsed.amount, locale),
      payee: parsed.payee
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/tests/unit/quick_parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/quick_parse.ts src/tests/unit/quick_parse.test.ts
git commit -m "fix: add quick-add readback helper"
```

---

### Task 2: Show the parsed readback in the quick-add window

**Files:**
- Modify: `src/routes/quick-add/+page.svelte`
- Test: `src/tests/e2e/tray-quick-capture.spec.ts`

**Interfaces:**
- Consumes: `quickAddReadback(value, locale, currency)` from Task 1.
- Produces: `.payee` line rendering `amountText` (formatted numerals, `+`-prefixed for income) and the parsed payee, replacing the raw-input echo.

- [ ] **Step 1: Write the failing E2E test**

Append inside the `test.describe('quick-add route', ...)` block in `src/tests/e2e/tray-quick-capture.spec.ts`:

```ts
test('shows a formatted readback of the parsed entry while typing', async ({ onboardedPage: page }) => {
  await gotoClientSide(page, '/quick-add');

  const input = page.locator('#qa-input');
  await expect(input).toBeEnabled();

  await input.fill('50k coffee');
  const payee = page.locator('.payee');
  await expect(payee).toContainText('50,000');
  await expect(payee).toContainText('coffee');

  await input.fill('+20m salary');
  await expect(payee).toContainText('+20,000,000');
  await expect(payee).toContainText('salary');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec playwright test src/tests/e2e/tray-quick-capture.spec.ts` (webServer auto-runs `pnpm build && pnpm preview`)
Expected: FAIL — the `.payee` line contains the raw `50k coffee` / `+20m salary`, not the formatted numerals.

- [ ] **Step 3: Implement the page change**

In `src/routes/quick-add/+page.svelte`:

1. Update the import (line 8):

```ts
import { parseQuickInput, quickAddReadback } from '$lib/utils/quick_parse';
```

2. Add a derived readback after `accountName` (after line 18):

```ts
const readback = $derived(quickAddReadback(value, settings.locale, settings.currency));
```

3. Replace the payee markup (lines 157–159):

```svelte
	<div class="payee" class:empty={!readback}>
		{#if readback}
			<span class="figures amount-text" class:income={readback.kind === 'income'}>{readback.amountText}</span>
			<span class="payee-name">{readback.payee ?? m.quick_add_payee_hint()}</span>
		{:else if value}
			{value}
		{:else}
			{m.quick_add_payee_hint()}
		{/if}
	</div>
```

4. Replace the `.payee` CSS (lines 210–217):

```css
	.payee {
		color: var(--ledger);
		font-size: 15px;
		min-height: 1.2em;
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}
	.payee .amount-text { color: var(--ledger); }
	.payee .amount-text.income { color: var(--phosphor); }
	.payee .payee-name { color: var(--ledger); }
	.payee.empty { color: var(--dim); }
```

- [ ] **Step 4: Run the E2E test to verify it passes**

Run: `pnpm exec playwright test src/tests/e2e/tray-quick-capture.spec.ts`
Expected: PASS (all tests in the spec, including the two pre-existing save tests).

- [ ] **Step 5: Run the unit suite**

Run: `pnpm test`
Expected: PASS — confirms Task 1's helper tests still pass alongside the full suite.

- [ ] **Step 6: Commit**

```bash
git add src/routes/quick-add/+page.svelte src/tests/e2e/tray-quick-capture.spec.ts
git commit -m "fix: show parsed readback in quick-add"
```

---

### Task 3: Distinct, visible error state

**Files:**
- Modify: `messages/en.json`, `messages/vi.json`, `src/routes/quick-add/+page.svelte`
- Test: `src/tests/e2e/tray-quick-capture.spec.ts`

**Interfaces:**
- Consumes: `AppError.code` (`'invalid_amount'`) from `$lib/errors`; `m.quick_add_error_invalid_amount()` from Paraglide (compiled from the new key).
- Produces: `.error` line showing the new message in `--debit`; the input keeps its failed content (not cleared).

- [ ] **Step 1: Write the failing E2E test**

Append inside the `test.describe('quick-add route', ...)` block:

```ts
test('shows a distinct, visible error for invalid input', async ({ onboardedPage: page }) => {
  await gotoClientSide(page, '/quick-add');

  const input = page.locator('#qa-input');
  await expect(input).toBeEnabled();

  await input.fill('abc');
  await page.keyboard.press('Enter');

  // The message is distinct from the placeholder ("Type an amount…"), and a
  // failed save must not wipe what the user typed.
  const error = page.locator('.error');
  await expect(error).toHaveText('Enter an amount first, e.g. 50k');
  await expect(input).toHaveValue('abc');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec playwright test src/tests/e2e/tray-quick-capture.spec.ts`
Expected: FAIL — current error text is the placeholder `Type an amount…`, not `Enter an amount first, e.g. 50k`.

- [ ] **Step 3: Add the i18n keys**

In `messages/en.json`, after `"quick_add_database_update_required"` (line 280):

```json
"quick_add_error_invalid_amount": "Enter an amount first, e.g. 50k"
```

In `messages/vi.json`, after `"quick_add_database_update_required"` (line 280):

```json
"quick_add_error_invalid_amount": "Nhập số tiền trước, ví dụ 50k"
```

- [ ] **Step 4: Regenerate Paraglide**

Run: `pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`
Expected: exit 0, `src/lib/paraglide/messages/` regenerated.

- [ ] **Step 5: Implement the page change**

In `src/routes/quick-add/+page.svelte`:

1. Replace the parse catch (lines 96–99) to branch on the error code instead of reusing the placeholder:

```ts
			} catch (e) {
				error =
					e instanceof AppError && e.code === 'invalid_amount'
						? m.quick_add_error_invalid_amount()
						: m.errors_unknown();
				return;
			}
```

2. Recolor `.error` (line 228) from phosphor to debit:

```css
	.error {
		color: var(--debit);
		font-size: 11px;
		margin-top: 0.25rem;
	}
```

- [ ] **Step 6: Run the E2E test to verify it passes**

Run: `pnpm exec playwright test src/tests/e2e/tray-quick-capture.spec.ts`
Expected: PASS.

- [ ] **Step 7: Run unit + type checks**

Run: `pnpm test && pnpm check`
Expected: both PASS. (`pnpm check` type-checks the new `m.quick_add_error_invalid_amount()` call against the regenerated Paraglide messages; the i18n-messages test keeps en/vi in parity.)

- [ ] **Step 8: Commit**

```bash
git add messages/en.json messages/vi.json src/routes/quick-add/+page.svelte src/tests/e2e/tray-quick-capture.spec.ts
git commit -m "fix: distinct visible error in quick-add"
```

---

### Task 4: Save confirmation flash

**Files:**
- Modify: `src/routes/quick-add/+page.svelte`

**Interfaces:**
- Consumes: `.animate-flash` utility + `flash` keyframe (app.css:128, 146) — already honors `prefers-reduced-motion`.
- Produces: after a successful save, the amount line flashes phosphor for ~250ms before the window hides. No new automated test — the flash is a 250ms transient class (flaky to sample) and the hide is a desktop-only no-op in web; the behavioral contract (save lands, input clears) is already covered by the two pre-existing save tests.

- [ ] **Step 1: Implement the flash**

In `src/routes/quick-add/+page.svelte`:

1. Add state and a motion guard near the other state (after line 16):

```ts
	let saved = $state(false);
	const REDUCED_MOTION = () =>
		typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
```

2. Replace the success tail of `submit()` (lines 118–119):

```ts
			saved = true;
			if (!REDUCED_MOTION()) await new Promise((r) => setTimeout(r, 250));
			value = '';
			saved = false;
			await hideWindow();
```

   `submitting` stays true through the 250ms (the `finally` runs after), so a rapid double-Enter during the flash is still ignored. Resetting `saved = false` before hiding matters: the window is hidden, not destroyed, and a stale `saved` would stop the next save from re-triggering the animation.

3. Add the flash class to the amount input (after `class="amount"`, line 145):

```svelte
		class:animate-flash={saved}
```

- [ ] **Step 2: Verify save paths still pass**

Run: `pnpm exec playwright test src/tests/e2e/tray-quick-capture.spec.ts`
Expected: PASS — the two pre-existing save tests confirm the 250ms delay doesn't break saving or list surfacing.

- [ ] **Step 3: Run the unit suite**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 4: Verify visually in the desktop app**

Run: `pnpm tauri dev`
1. Trigger the global shortcut (`CmdOrCtrl+Shift+N`) to open quick-add, type `50k coffee`, press Enter.
2. Confirm the amount line flashes bright phosphor for a beat before the window closes.
3. Enable System Settings → Accessibility → Motion → Reduce motion and confirm the save is instant (no flash, no delay).

- [ ] **Step 5: Commit**

```bash
git add src/routes/quick-add/+page.svelte
git commit -m "fix: flash save confirmation in quick-add"
```
