# Quick-Add UX Polish Implementation Plan
**Serves:** STORY-029, STORY-002

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the quick-add capture window give honest feedback — a live readback of the parsed entry, a distinct and visible error state, and a save confirmation. Most of this shipped before the plan was executed; what remains is the test coverage the review demanded and one accessibility gap in the save path.

> **2026-09-08 revision:** reviewed against actual code. The original Task 1 (`quickAddReadback` helper) and Task 2 (parsed readback UI) were **superseded**: the readback ships as a live `preview` derived in the route (`src/routes/quick-add/+page.svelte:41`), built on `parseQuickInput` + `formatCurrency` — commit `bbba835`. The distinct error state ships via `m.validation_invalid_amount()` with `.error` in `var(--debit)` — commit `961f463`. The save flash ships via `justSaved` → `.animate-flash` — commit `d95c337`. The original plan's exact strings, keys and selectors no longer match the code; those tasks were retired rather than fake-flipped. Product decision (2026-09-08): keep the existing terse `validation_invalid_amount` ("Invalid amount") copy — the planned richer `quick_add_error_invalid_amount` key is **not** adopted.

**Architecture:** Two remaining deltas. (1) The live preview has no test at all — add an E2E that pins the parse→display contract (`parseQuickInput` → `formatCurrency` numerals + kind sign + payee) so a regression can't silently revert the readback to raw-text echo. (2) The 400ms save pause runs unconditionally; under `prefers-reduced-motion: reduce` the flash CSS already disables (`app.css` `@media (prefers-reduced-motion: reduce)`), but the JS delay keeps the window open — extract the pause into a pure helper, unit-test it, and skip it under reduced motion.

**Tech Stack:** Svelte 5 runes, Vitest (unit), Playwright (E2E), Tailwind CSS + `app.css` tokens.

**Spec:** No separate spec file exists. This plan implements findings 1–3 of the 2026-08-19 code + visual UX review of `/quick-add`. Each task's tests are the acceptance criteria.

## Completed before this revision (no checkboxes — already landed)

| Finding | Shipped as | Commit |
| --- | --- | --- |
| Parsed readback UI (kind·amount·payee spans, income indicator, dim-when-empty) | `preview` `$derived.by` in `+page.svelte:41-51`, markup `:212-221` | `bbba835` |
| Distinct error text + `--debit` color, input keeps failed content | `m.validation_invalid_amount()` at `+page.svelte:138`, `.error` at `:352` | `961f463` |
| Save flash before window hides | `justSaved` 400ms pause at `+page.svelte:162-164`, `.animate-flash` on mark + SAVE | `d95c337` |

## Global Constraints

- TDD red–green–refactor. No exceptions.
- `pnpm test` (vitest) and `pnpm exec playwright test src/tests/e2e/tray-quick-capture.spec.ts` must both pass before each commit.
- Amounts stay integers (smallest currency unit) end-to-end.
- `quick_parse.ts` stays pure. Nothing here re-parses `k`/`m`/`tr` — the preview path reuses `parseQuickInput` and must keep doing so.
- **`formatCurrency`, not `formatNumber`:** the preview renders `formatCurrency(parsed.amount, settings.currency, settings.locale)` — for 50000 VND/en that is `"₫50,000"` (symbol included), rendered in its own `.preview-amount` span with the sign in a separate `.preview-kind` span (`'−'` expense / `'+'` income). Do not assert bare numerals or a sign inside the amount string.
- E2E must use client-side navigation to preserve the volatile sql.js DB singleton (see the header comment in tray-quick-capture.spec.ts).
- Commit prefix: `fix:`.

**Out of scope** (from the review; separate plans): dead TopBar search, undo in quick-add, shortcut discoverability, refund sign, app-wide tour copy.

---

### Task 1: E2E coverage for the live parsed preview

> **Deviation (executed 2026-09-08):** the plan's `.payee.empty` selector was wrong at source — `class:empty` keys on `!value && !preview` in `src/routes/quick-add/+page.svelte:211`. The test locates `.payee` with the `/payee/i` assertion instead.

**Files:**
- Test: `src/tests/e2e/tray-quick-capture.spec.ts`

**Interfaces:**
- Consumes: `.preview-kind` / `.preview-amount` / `.preview-payee` spans in `+page.svelte:212-221`; `formatCurrency(50000,'VND','en')` → `"₫50,000"`.

- [x] **Step 1: Write the failing E2E test**

Append inside the `test.describe('quick-add route', ...)` block in `src/tests/e2e/tray-quick-capture.spec.ts`:

```ts
test('shows a parsed readback of the entry while typing', async ({ onboardedPage: page }) => {
  await gotoClientSide(page, '/quick-add');

  const input = page.locator('#qa-input');
  await expect(input).toBeEnabled();

  await input.fill('50k coffee');
  await expect(page.locator('.preview-kind')).toHaveText('−');
  await expect(page.locator('.preview-amount')).toHaveText('₫50,000');
  await expect(page.locator('.preview-payee')).toHaveText('coffee');

  await input.fill('+20m salary');
  await expect(page.locator('.preview-kind')).toHaveText('+');
  await expect(page.locator('.preview-amount')).toHaveText('₫20,000,000');
  await expect(page.locator('.preview-payee')).toHaveText('salary');

  // Unparseable input falls back to the hint instead of echoing raw text.
  await input.fill('abc');
  await expect(page.locator('.payee.empty')).toHaveText(/payee/i);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec playwright test src/tests/e2e/tray-quick-capture.spec.ts`
Expected: likely PASS (behavior already shipped by `bbba835`) — this is a **coverage-first** test, not a strict red. If any assertion is red, fix the selector or investigate the regression before proceeding; do not proceed with a failing suite.

- [x] **Step 3: Run the full suite and commit**

```bash
pnpm exec playwright test src/tests/e2e/tray-quick-capture.spec.ts && pnpm test
```

Then:

```bash
git add src/tests/e2e/tray-quick-capture.spec.ts
git commit -m "test: pin the quick-add parsed readback in E2E"
```

---

### Task 2: Skip the save pause under reduced motion

> **Deviation (executed 2026-09-08):** the plan's test path `src/tests/unit/motion.test.ts` collided with an existing `$lib/transitions/motion` test; the new tests live in `src/tests/unit/utils-motion.test.ts`.

**Files:**
- Create: `src/lib/utils/motion.ts` — pure `savePauseMs` helper
- Modify: `src/routes/quick-add/+page.svelte` — consult `matchMedia` at save time
- Test: `src/tests/unit/motion.test.ts`

**Interfaces:**
- Produces: `savePauseMs(prefersReducedMotion: boolean): number` — `400` normally (the flash beat), `0` under reduced motion (CSS already suppresses the flash; the delay is pure latency for a motion-sensitive user).

- [x] **Step 1: Write the failing unit test**

Create `src/tests/unit/motion.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { savePauseMs } from '$lib/utils/motion';

describe('savePauseMs', () => {
  it('keeps the 400ms flash beat by default', () => {
    expect(savePauseMs(false)).toBe(400);
  });

  it('returns 0 under reduced motion', () => {
    expect(savePauseMs(true)).toBe(0);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/tests/unit/motion.test.ts`
Expected: FAIL — no such module.

- [x] **Step 3: Implement the helper**

Create `src/lib/utils/motion.ts`:

```ts
/**
 * How long the quick-add window holds open after a save so the phosphor
 * flash registers. Under prefers-reduced-motion the CSS suppresses the
 * flash entirely (app.css), so holding the window open is pure latency.
 */
export function savePauseMs(prefersReducedMotion: boolean): number {
	return prefersReducedMotion ? 0 : 400;
}
```

- [x] **Step 4: Wire it into the save path**

In `src/routes/quick-add/+page.svelte`, replace the fixed delay (lines 162–164):

```ts
justSaved = true;
await new Promise((r) => setTimeout(r, 400));
justSaved = false;
```

with:

```ts
justSaved = true;
const pause = savePauseMs(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
if (pause > 0) await new Promise((r) => setTimeout(r, pause));
justSaved = false;
```

and add the import next to the other `$lib/utils` imports.

- [x] **Step 5: Run the suites to verify they pass**

Run: `pnpm exec playwright test src/tests/e2e/tray-quick-capture.spec.ts`
Expected: PASS — the two pre-existing save tests confirm the pause change doesn't break saving or list surfacing.

Run: `pnpm test`
Expected: PASS.

- [x] **Step 6: Verify visually in the desktop app**

Run: `pnpm tauri dev`
1. Trigger the global shortcut (`CmdOrCtrl+Shift+N`) to open quick-add, type `50k coffee`, press Enter.
2. Confirm the amount line flashes bright phosphor for a beat before the window closes.
3. Enable System Settings → Accessibility → Motion → Reduce motion and confirm the save is instant (no flash, no delay).

- [x] **Step 7: Commit**

```bash
git add src/lib/utils/motion.ts src/tests/unit/utils-motion.test.ts src/routes/quick-add/+page.svelte
git commit -m "fix: skip the quick-add save pause under reduced motion"
```
