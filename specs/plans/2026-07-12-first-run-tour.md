# First-Run Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a spotlight coachmark tour that auto-starts once after onboarding, highlighting 5 core UI elements with overlay + tooltip, plus a Replay button in Settings.

**Architecture:** A runes-based `tour` store manages step state and meta persistence. `TourOverlay.svelte` renders a modal backdrop with a cutout highlight around the target element and a positioned tooltip. Shell components get `data-tour` attributes as anchor points. Grandfather logic ensures existing users skip the tour.

**Tech Stack:** Svelte 5 runes, Paraglide JS i18n, Vitest + jsdom, existing `app_meta` table via `meta.ts` repo.

## Global Constraints

- Amounts are always integers (smallest currency unit). No floats.
- Commit prefix: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`
- Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`), not legacy stores
- Paraglide flat underscore keys (no dotted IDs), pinned at 1.11.8
- Only the **main window** wires the tour (quick-add window must not call `tour.load()`)
- `load()` / `ensureTourGrandfathered` runs **once at main-layout boot, never after onboarding→`/` navigation**
- i18n: all user-visible strings in `messages/en.json` + `messages/vi.json`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/lib/db/repos/meta.ts` | Add `isTourComplete()` / `setTourComplete()` helpers |
| Create | `src/lib/tour/steps.ts` | Step definitions (id, target selector, i18n title/body) |
| Create | `src/lib/stores/tour.svelte.ts` | Runes store: load, start, next, back, skip, finish, grandfather |
| Create | `src/lib/components/tour/TourOverlay.svelte` | Overlay + cutout + positioned tooltip |
| Modify | `src/lib/components/layout/Sidebar.svelte` | Add `data-tour` attributes |
| Modify | `src/lib/components/layout/BottomNav.svelte` | Add `data-tour` attributes |
| Modify | `src/lib/components/layout/FAB.svelte` | Add `data-tour` attribute |
| Modify | `src/lib/components/layout/TopBar.svelte` | Add `data-tour` attribute on settings link |
| Modify | `src/routes/+page.svelte` | Add `data-tour` on net position section |
| Modify | `src/routes/+layout.svelte` | Wire tour store, render overlay, gate host shortcuts |
| Modify | `src/routes/settings/+page.svelte` | Add "Replay tour" button |
| Modify | `messages/en.json` | Add tour string keys |
| Modify | `messages/vi.json` | Add tour string keys |
| Create | `src/tests/unit/stores/tour.test.ts` | Store unit tests |
| Create | `src/tests/unit/tour/steps.test.ts` | Steps config unit tests |

---

### Task 1: Meta helpers for tour_complete

**Files:**
- Modify: `src/lib/db/repos/meta.ts`
- Test: `src/tests/unit/repos/meta-tour.test.ts`

**Interfaces:**
- Consumes: existing `getMeta` / `setMeta` from `meta.ts`
- Produces: `isTourComplete(db) → Promise<boolean>`, `setTourComplete(db) → Promise<void>`

- [ ] **Step 1: Write failing test for `isTourComplete` returning false when key missing**

```typescript
// src/tests/unit/repos/meta-tour.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import * as meta from '$lib/db/repos/meta';
import type { DatabaseService } from '$lib/db/service';

let db: DatabaseService;
beforeEach(async () => {
  db = createTestDb();
  await runMigrations(db, migrations);
});

describe('isTourComplete', () => {
  it('returns false when tour_complete key is missing', async () => {
    expect(await meta.isTourComplete(db)).toBe(false);
  });

  it('returns true when tour_complete is 1', async () => {
    await meta.setTourComplete(db);
    expect(await meta.isTourComplete(db)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/tests/unit/repos/meta-tour.test.ts`
Expected: FAIL — `meta.isTourComplete is not a function`

- [ ] **Step 3: Implement `isTourComplete` and `setTourComplete`**

Add to `src/lib/db/repos/meta.ts`:

```typescript
export async function isTourComplete(db: DatabaseService): Promise<boolean> {
	const val = await getMeta(db, 'tour_complete');
	return val === '1';
}

export async function setTourComplete(db: DatabaseService): Promise<void> {
	await setMeta(db, 'tour_complete', '1');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/tests/unit/repos/meta-tour.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/repos/meta.ts src/tests/unit/repos/meta-tour.test.ts
git commit -m "feat: add tour_complete meta helpers"
```

---

### Task 2: Tour step definitions

**Files:**
- Create: `src/lib/tour/steps.ts`
- Test: `src/tests/unit/tour/steps.test.ts`

**Interfaces:**
- Consumes: nothing (pure config)
- Produces: `TOUR_STEPS` array, `TourStep` type `{ id: string; targets: string[]; titleKey: string; bodyKey: string }`

- [ ] **Step 1: Write failing test for step definitions**

```typescript
// src/tests/unit/tour/steps.test.ts
import { describe, it, expect } from 'vitest';
import { TOUR_STEPS } from '$lib/tour/steps';

describe('TOUR_STEPS', () => {
  it('has 5 steps', () => {
    expect(TOUR_STEPS).toHaveLength(5);
  });

  it('has expected step ids in order', () => {
    expect(TOUR_STEPS.map(s => s.id)).toEqual(['net', 'add', 'transactions', 'budgets', 'more']);
  });

  it('each step has at least one target selector', () => {
    for (const step of TOUR_STEPS) {
      expect(step.targets.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('each step has titleKey and bodyKey', () => {
    for (const step of TOUR_STEPS) {
      expect(step.titleKey).toBeTruthy();
      expect(step.bodyKey).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/tests/unit/tour/steps.test.ts`
Expected: FAIL — cannot find module `$lib/tour/steps`

- [ ] **Step 3: Implement step definitions**

```typescript
// src/lib/tour/steps.ts
export interface TourStep {
  id: string;
  /** CSS selectors tried in order; first visible element wins. */
  targets: string[];
  titleKey: string;
  bodyKey: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'net',
    targets: ['[data-tour="net"]'],
    titleKey: 'tour_net_title',
    bodyKey: 'tour_net_body'
  },
  {
    id: 'add',
    targets: ['[data-tour="add"]'],
    titleKey: 'tour_add_title',
    bodyKey: 'tour_add_body'
  },
  {
    id: 'transactions',
    targets: ['[data-tour="transactions"]'],
    titleKey: 'tour_transactions_title',
    bodyKey: 'tour_transactions_body'
  },
  {
    id: 'budgets',
    targets: ['[data-tour="budgets"]'],
    titleKey: 'tour_budgets_title',
    bodyKey: 'tour_budgets_body'
  },
  {
    id: 'more',
    targets: ['[data-tour="accounts"]', '[data-tour="settings"]'],
    titleKey: 'tour_more_title',
    bodyKey: 'tour_more_body'
  }
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/tests/unit/tour/steps.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/tour/steps.ts src/tests/unit/tour/steps.test.ts
git commit -m "feat: add tour step definitions"
```

---

### Task 3: Tour store (runes)

**Files:**
- Create: `src/lib/stores/tour.svelte.ts`
- Test: `src/tests/unit/stores/tour.test.ts`

**Interfaces:**
- Consumes: `meta.isTourComplete`, `meta.setTourComplete`, `meta.isFirstRunComplete` from `$lib/db/repos/meta`, `TOUR_STEPS` from `$lib/tour/steps`, `getDb` from `$lib/db`
- Produces: `tour` singleton export with: `active: boolean`, `currentStep: number`, `complete: boolean`, `load()`, `start(opts?)`, `next()`, `back()`, `skip()`, `finish()`

- [ ] **Step 1: Write failing tests for tour store**

```typescript
// src/tests/unit/stores/tour.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import * as meta from '$lib/db/repos/meta';
import type { DatabaseService } from '$lib/db/service';

// Mock getDb to return our test db
let db: DatabaseService;
vi.mock('$lib/db', () => ({
  getDb: async () => db
}));

// Fresh import per test group to reset singleton state
let tour: typeof import('$lib/stores/tour.svelte').tour;

beforeEach(async () => {
  db = createTestDb();
  await runMigrations(db, migrations);
  vi.resetModules();
  tour = (await import('$lib/stores/tour.svelte')).tour;
});

describe('tour.load', () => {
  it('grandfathers when first_run_complete=1 and tour_complete missing', async () => {
    await meta.setMeta(db, 'first_run_complete', '1');
    await tour.load();
    expect(tour.complete).toBe(true);
    expect(await meta.isTourComplete(db)).toBe(true);
  });

  it('does NOT grandfather when first_run_complete=0 (fresh user)', async () => {
    // first_run_complete is absent (fresh user mid-onboarding)
    await tour.load();
    expect(tour.complete).toBe(false);
    expect(await meta.isTourComplete(db)).toBe(false);
  });

  it('sets complete=true when tour_complete already set', async () => {
    await meta.setMeta(db, 'first_run_complete', '1');
    await meta.setTourComplete(db);
    await tour.load();
    expect(tour.complete).toBe(true);
  });
});

describe('tour.start', () => {
  it('does not start if tour already complete', async () => {
    await meta.setMeta(db, 'first_run_complete', '1');
    await meta.setTourComplete(db);
    await tour.load();
    tour.start();
    expect(tour.active).toBe(false);
  });

  it('starts when not complete', async () => {
    await meta.setMeta(db, 'first_run_complete', '1');
    await tour.load();
    tour.start();
    expect(tour.active).toBe(true);
    expect(tour.currentStep).toBe(0);
  });

  it('force start overrides complete flag', async () => {
    await meta.setMeta(db, 'first_run_complete', '1');
    await meta.setTourComplete(db);
    await tour.load();
    tour.start({ force: true });
    expect(tour.active).toBe(true);
    expect(tour.currentStep).toBe(0);
  });
});

describe('tour navigation', () => {
  beforeEach(async () => {
    await meta.setMeta(db, 'first_run_complete', '1');
    await tour.load();
    tour.start();
  });

  it('next advances step', () => {
    tour.next();
    expect(tour.currentStep).toBe(1);
  });

  it('back decrements step', () => {
    tour.next();
    tour.back();
    expect(tour.currentStep).toBe(0);
  });

  it('back does not go below 0', () => {
    tour.back();
    expect(tour.currentStep).toBe(0);
  });

  it('next past last step finishes tour', async () => {
    for (let i = 0; i < 5; i++) tour.next();
    expect(tour.active).toBe(false);
    expect(await meta.isTourComplete(db)).toBe(true);
  });
});

describe('tour.skip', () => {
  it('sets tour_complete and deactivates', async () => {
    await meta.setMeta(db, 'first_run_complete', '1');
    await tour.load();
    tour.start();
    tour.skip();
    expect(tour.active).toBe(false);
    expect(await meta.isTourComplete(db)).toBe(true);
  });
});

describe('tour.finish', () => {
  it('sets tour_complete and deactivates', async () => {
    await meta.setMeta(db, 'first_run_complete', '1');
    await tour.load();
    tour.start();
    tour.finish();
    expect(tour.active).toBe(false);
    expect(await meta.isTourComplete(db)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/tests/unit/stores/tour.test.ts`
Expected: FAIL — cannot find module `$lib/stores/tour.svelte`

- [ ] **Step 3: Implement tour store**

```typescript
// src/lib/stores/tour.svelte.ts
import { getDb } from '$lib/db';
import * as meta from '$lib/db/repos/meta';
import { TOUR_STEPS } from '$lib/tour/steps';

class TourStore {
  active = $state(false);
  currentStep = $state(0);
  complete = $state(false);

  /** Called once at main-layout boot. Grandfathers existing users. */
  async load(): Promise<void> {
    const db = await getDb();
    const firstRunDone = await meta.isFirstRunComplete(db);
    const tourDone = await meta.isTourComplete(db);

    if (firstRunDone && !tourDone) {
      // Grandfather: existing user who finished onboarding before tour existed.
      await meta.setTourComplete(db);
      this.complete = true;
      return;
    }

    if (tourDone) {
      this.complete = true;
    }
    // If firstRunDone is false (fresh user mid-onboarding), do nothing —
    // the tour will auto-start after onboarding completes and layout re-runs.
  }

  start(opts?: { force?: boolean }): void {
    if (!opts?.force && this.complete) return;
    this.currentStep = 0;
    this.active = true;
  }

  next(): void {
    if (!this.active) return;
    if (this.currentStep + 1 >= TOUR_STEPS.length) {
      this.finish();
      return;
    }
    this.currentStep++;
  }

  back(): void {
    if (!this.active) return;
    if (this.currentStep > 0) this.currentStep--;
  }

  async skip(): Promise<void> {
    this.active = false;
    const db = await getDb();
    await meta.setTourComplete(db);
    this.complete = true;
  }

  async finish(): Promise<void> {
    this.active = false;
    const db = await getDb();
    await meta.setTourComplete(db);
    this.complete = true;
  }
}

export const tour = new TourStore();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/tests/unit/stores/tour.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/tour.svelte.ts src/tests/unit/stores/tour.test.ts
git commit -m "feat: add tour runes store with grandfather logic"
```

---

### Task 4: i18n strings

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/vi.json`

**Interfaces:**
- Consumes: nothing
- Produces: `tour_net_title`, `tour_net_body`, `tour_add_title`, `tour_add_body`, `tour_transactions_title`, `tour_transactions_body`, `tour_budgets_title`, `tour_budgets_body`, `tour_more_title`, `tour_more_body`, `tour_next`, `tour_back`, `tour_skip`, `tour_finish`, `tour_progress`, `tour_replay`, `tour_replay_desc`

- [ ] **Step 1: Add English tour strings to `messages/en.json`**

Add these keys (alphabetical position among existing keys):

```json
"tour_net_title": "Your net position",
"tour_net_body": "This is the big picture — what you own minus what you owe, updated in real time.",
"tour_add_title": "Add a transaction",
"tour_add_body": "Tap here or press N to quickly log income, expenses, or transfers.",
"tour_transactions_title": "Transactions",
"tour_transactions_body": "See every transaction in your ledger. Filter, search, and edit entries here.",
"tour_budgets_title": "Budgets",
"tour_budgets_body": "Set monthly spending limits by category and track how you're doing.",
"tour_more_title": "Accounts & settings",
"tour_more_body": "Manage your bank accounts, app preferences, categories, and backups.",
"tour_next": "Next",
"tour_back": "Back",
"tour_skip": "Skip",
"tour_finish": "Done",
"tour_progress": "{current} of {total}",
"tour_replay": "Replay tour",
"tour_replay_desc": "Re-show the guided tour of the app's main features."
```

- [ ] **Step 2: Add Vietnamese tour strings to `messages/vi.json`**

```json
"tour_net_title": "Vị thế ròng",
"tour_net_body": "Tổng quan tài chính — những gì bạn có trừ những gì bạn nợ, cập nhật theo thời gian thực.",
"tour_add_title": "Thêm giao dịch",
"tour_add_body": "Nhấn vào đây hoặc nhấn N để ghi nhanh thu nhập, chi tiêu, hoặc chuyển khoản.",
"tour_transactions_title": "Giao dịch",
"tour_transactions_body": "Xem mọi giao dịch trong sổ cái. Lọc, tìm kiếm, và chỉnh sửa tại đây.",
"tour_budgets_title": "Ngân sách",
"tour_budgets_body": "Đặt giới hạn chi tiêu hàng tháng theo danh mục và theo dõi tiến độ.",
"tour_more_title": "Tài khoản & cài đặt",
"tour_more_body": "Quản lý tài khoản ngân hàng, tùy chọn ứng dụng, danh mục, và sao lưu.",
"tour_next": "Tiếp",
"tour_back": "Lùi",
"tour_skip": "Bỏ qua",
"tour_finish": "Xong",
"tour_progress": "{current} / {total}",
"tour_replay": "Xem lại hướng dẫn",
"tour_replay_desc": "Hiển thị lại hướng dẫn các tính năng chính của ứng dụng."
```

- [ ] **Step 3: Regenerate Paraglide messages**

Run: `pnpm check`
Expected: Paraglide compiles, no errors. Verify `src/lib/paraglide/messages/` contains the new keys.

- [ ] **Step 4: Commit**

```bash
git add messages/en.json messages/vi.json
git commit -m "feat: add tour i18n strings (en + vi)"
```

---

### Task 5: Add `data-tour` attributes to shell components

**Files:**
- Modify: `src/routes/+page.svelte` (net position section)
- Modify: `src/lib/components/layout/FAB.svelte`
- Modify: `src/lib/components/layout/Sidebar.svelte`
- Modify: `src/lib/components/layout/BottomNav.svelte`
- Modify: `src/lib/components/layout/TopBar.svelte`

**Interfaces:**
- Consumes: nothing
- Produces: `data-tour` attributes on real DOM elements for the overlay to target

- [ ] **Step 1: Add `data-tour="net"` to dashboard net position section**

In `src/routes/+page.svelte`, find the net position `<section>` (line ~50) and add the attribute:

```svelte
<section class="surface rounded-lg p-5 md:p-6 relative overflow-hidden" data-tour="net">
```

- [ ] **Step 2: Add `data-tour="add"` to FAB**

In `src/lib/components/layout/FAB.svelte`, add to the `<button>`:

```svelte
<button
  {onclick}
  data-tour="add"
  class="..."
```

- [ ] **Step 3: Add `data-tour` to Sidebar nav items**

In `src/lib/components/layout/Sidebar.svelte`, add `data-tour` to each `<a>` in the primary and secondary nav loops. The key maps:

- `transactions` → `data-tour="transactions"`
- `budgets` → `data-tour="budgets"`
- `accounts` → `data-tour="accounts"`
- `settings` → `data-tour="settings"`

Update the primaryNav/secondaryNav arrays to include a `tourId` field:

```typescript
const primaryNav = [
  { href: '/', key: 'dashboard', label: () => m.nav_dashboard() },
  { href: '/transactions', key: 'transactions', label: () => m.nav_transactions(), tourId: 'transactions' },
  { href: '/budgets', key: 'budgets', label: () => m.nav_budgets(), tourId: 'budgets' },
  { href: '/reports', key: 'reports', label: () => m.nav_reports() }
];
const secondaryNav = [
  { href: '/accounts', key: 'accounts', label: () => m.nav_accounts(), tourId: 'accounts' },
  { href: '/goals', key: 'goals', label: () => m.nav_goals() },
  { href: '/debts', key: 'debts', label: () => m.nav_debts() },
  { href: '/settings', key: 'settings', label: () => m.nav_settings(), tourId: 'settings' }
];
```

Then in each `{#each}` template, add `data-tour={item.tourId}` conditionally:

```svelte
<a
  href={item.href}
  data-tour={item.tourId}
  ...
```

- [ ] **Step 4: Add `data-tour` to BottomNav tabs**

In `src/lib/components/layout/BottomNav.svelte`, add `tourId` to the tabs array:

```typescript
const tabs = [
  { href: '/', label: m.layout_home(), d: '...', tourId: 'transactions' },
  { href: '/transactions', label: m.layout_trans(), d: '...', tourId: 'transactions' },
  { href: '/budgets', label: m.layout_budget(), d: '...', tourId: 'budgets' },
  { href: '/reports', label: m.nav_reports(), d: '...' }
];
```

Add `data-tour={tab.tourId}` to the `<a>` element.

Note: Both sidebar and bottom nav share `data-tour="transactions"` and `data-tour="budgets"`. The overlay picks the visible one.

- [ ] **Step 5: Skip — no `data-tour` changes needed on TopBar**

The `more` step targets `accounts` and `settings` in the Sidebar. On mobile, the Sidebar is hidden, so `findTarget()` returns null and the overlay falls back to a centered tooltip. No TopBar changes needed.

- [ ] **Step 6: Verify build**

Run: `pnpm check`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/routes/+page.svelte src/lib/components/layout/FAB.svelte src/lib/components/layout/Sidebar.svelte src/lib/components/layout/BottomNav.svelte
git commit -m "feat: add data-tour attributes to shell components"
```

---

### Task 6: TourOverlay component

**Files:**
- Create: `src/lib/components/tour/TourOverlay.svelte`

**Interfaces:**
- Consumes: `tour` store, `TOUR_STEPS`, Paraglide messages
- Produces: Modal overlay with backdrop cutout, positioned tooltip, navigation buttons

- [ ] **Step 1: Implement TourOverlay.svelte**

```svelte
<!-- src/lib/components/tour/TourOverlay.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { tour } from '$lib/stores/tour.svelte';
  import { TOUR_STEPS } from '$lib/tour/steps';
  import * as m from '$lib/paraglide/messages';

  let tooltipPos = $state({ top: 0, left: 0 });
  let targetRect = $state<DOMRect | null>(null);
  let targetEl: Element | null = $state(null);
  const TOOLTIP_WIDTH = 320; // w-80
  const TOOLTIP_MARGIN = 8;

  const mKeys: Record<string, () => string> = {
    tour_net_title: () => m.tour_net_title(),
    tour_net_body: () => m.tour_net_body(),
    tour_add_title: () => m.tour_add_title(),
    tour_add_body: () => m.tour_add_body(),
    tour_transactions_title: () => m.tour_transactions_title(),
    tour_transactions_body: () => m.tour_transactions_body(),
    tour_budgets_title: () => m.tour_budgets_title(),
    tour_budgets_body: () => m.tour_budgets_body(),
    tour_more_title: () => m.tour_more_title(),
    tour_more_body: () => m.tour_more_body()
  };

  function title(): string {
    const step = TOUR_STEPS[tour.currentStep];
    return mKeys[step.titleKey]?.() ?? step.titleKey;
  }

  function body(): string {
    const step = TOUR_STEPS[tour.currentStep];
    return mKeys[step.bodyKey]?.() ?? step.bodyKey;
  }

  function findTarget(): Element | null {
    const step = TOUR_STEPS[tour.currentStep];
    for (const selector of step.targets) {
      const els = document.querySelectorAll(selector);
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return el;
      }
    }
    return null;
  }

  function measure() {
    targetEl = findTarget();
    if (targetEl) {
      targetRect = targetEl.getBoundingClientRect();
      // Position tooltip below or above the target
      const spaceBelow = window.innerHeight - targetRect.bottom;
      const top = spaceBelow > 200
        ? targetRect.bottom + 12
        : targetRect.top - 12;
      const left = Math.max(
        TOOLTIP_MARGIN,
        Math.min(targetRect.left, window.innerWidth - TOOLTIP_WIDTH - TOOLTIP_MARGIN)
      );
      tooltipPos = { top, left };
    } else {
      // No visible target — center the tooltip
      targetRect = null;
      tooltipPos = {
        top: window.innerHeight / 2 - 80,
        left: (window.innerWidth - TOOLTIP_WIDTH) / 2
      };
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      tour.skip();
    }
  }

  onMount(() => {
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
  });

  onDestroy(() => {
    window.removeEventListener('resize', measure);
    window.removeEventListener('scroll', measure, true);
  });

  // Re-measure when step changes
  $effect(() => {
    void tour.currentStep;
    measure();
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#if tour.active}
  <!-- Backdrop with cutout -->
  <div class="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title()}>
    <!-- SVG backdrop with a hole cut around the target -->
    <svg class="absolute inset-0 w-full h-full" aria-hidden="true">
      <defs>
        <mask id="tour-mask">
          <rect width="100%" height="100%" fill="white" />
          {#if targetRect}
            <rect
              x={targetRect.x - 4}
              y={targetRect.y - 4}
              width={targetRect.width + 8}
              height={targetRect.height + 8}
              rx="8"
              fill="black"
            />
          {/if}
        </mask>
      </defs>
      <rect width="100%" height="100%" fill="rgba(0,0,0,0.6)" mask="url(#tour-mask)" />
    </svg>

    <!-- Highlight ring around target -->
    {#if targetRect}
      <div
        class="absolute rounded-lg border-2 border-phosphor pointer-events-none transition-all duration-200"
        style="top: {targetRect.y - 4}px; left: {targetRect.x - 4}px; width: {targetRect.width + 8}px; height: {targetRect.height + 8}px;"
      ></div>
    {/if}

    <!-- Tooltip -->
    <div
      class="absolute z-10 w-80 max-w-[calc(100vw-2rem)] surface rounded-lg border border-line p-4 shadow-xl"
      style="top: {tooltipPos.top}px; left: {tooltipPos.left}px;"
    >
      <h3 class="plate text-ledger text-base mb-1">{title()}</h3>
      <p class="text-sm text-dim mb-4">{body()}</p>
      <div class="flex items-center justify-between">
        <span class="text-xs text-dim figures">{m.tour_progress({ current: String(tour.currentStep + 1), total: String(TOUR_STEPS.length) })}</span>
        <div class="flex gap-2">
          <button
            onclick={() => tour.skip()}
            class="px-3 py-1 text-sm rounded-md text-dim hover:text-ledger transition-colors"
          >{m.tour_skip()}</button>
          <button
            onclick={() => tour.back()}
            disabled={tour.currentStep === 0}
            class="px-3 py-1 text-sm rounded-md border border-line text-dim hover:text-ledger disabled:opacity-30 transition-colors"
          >{m.tour_back()}</button>
          {#if tour.currentStep >= TOUR_STEPS.length - 1}
            <button
              onclick={() => tour.finish()}
              class="px-3 py-1 text-sm rounded-md bg-phosphor text-ink font-medium hover:bg-phosphor-bright transition-colors"
            >{m.tour_finish()}</button>
          {:else}
            <button
              onclick={() => tour.next()}
              class="px-3 py-1 text-sm rounded-md bg-phosphor text-ink font-medium hover:bg-phosphor-bright transition-colors"
            >{m.tour_next()}</button>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}
```

- [ ] **Step 2: Verify build**

Run: `pnpm check`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/tour/TourOverlay.svelte
git commit -m "feat: add TourOverlay component with spotlight and tooltip"
```

---

### Task 7: Wire tour into layout

**Files:**
- Modify: `src/routes/+layout.svelte`

**Interfaces:**
- Consumes: `tour` store, `TourOverlay` component
- Produces: Tour auto-starts after onboarding, overlay rendered in shell, host shortcuts gated

- [ ] **Step 1: Import tour store and TourOverlay**

Add to the `<script>` block in `src/routes/+layout.svelte`:

```typescript
import { tour } from '$lib/stores/tour.svelte';
import TourOverlay from '$lib/components/tour/TourOverlay.svelte';
```

- [ ] **Step 2: Wire tour.load() and auto-start in onMount**

After `await settings.load()` (line ~49), add:

```typescript
await tour.load();
if (dbStore.firstRunComplete && !tour.complete) {
  tour.start();
}
```

The full onMount block becomes:

```typescript
onMount(async () => {
  const isQuickAddWindow = $page.url.pathname.startsWith('/quick-add');
  if (isQuickAddWindow) return;

  await dbStore.init();
  if (dbStore.ready && !dbStore.firstRunComplete && $page.url.pathname !== '/onboarding') {
    goto('/onboarding');
  }
  if (dbStore.ready && dbStore.firstRunComplete) {
    await settings.load();
    await tour.load();
    if (!tour.complete) {
      tour.start();
    }
  }
  if (dbStore.ready && dbStore.firstRunComplete) {
    unlisten = await attachTransactionSavedListener(listen, async () => {
      await transactions.load();
    });
  }
});
```

- [ ] **Step 3: Gate host keyboard shortcuts when tour is active**

In the `onKeydown` function, add a guard:

```typescript
function onKeydown(e: KeyboardEvent) {
  // Host shortcuts yield to the tour overlay
  if (tour.active) return;
  const target = e.target as HTMLElement;
  const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
  if (e.key === 'Escape') { showTxModal = false; return; }
  if (inInput) return;
  if (e.key === 'n') { showTxModal = true; e.preventDefault(); }
  if (e.key === '/') { document.querySelector<HTMLInputElement>('[type="search"]')?.focus(); e.preventDefault(); }
}
```

- [ ] **Step 4: Render TourOverlay in the shell**

Add `<TourOverlay />` inside the main shell `{#else}` block (after `<GlobalToast />`):

```svelte
{:else}
  <div class="h-screen flex flex-col bg-ink text-ledger">
    <TopBar />
    <div class="flex flex-1 overflow-hidden">
      <Sidebar />
      <main class="flex-1 overflow-y-auto p-4 md:p-8 pb-24 md:pb-8 max-w-5xl mx-auto w-full">
        {@render children()}
      </main>
    </div>
    <BottomNav />
    <FAB onclick={() => showTxModal = true} />
    <Modal bind:open={showTxModal} title={m.layout_add_transaction()}>
      <TransactionForm onclose={() => showTxModal = false} />
    </Modal>
    <GlobalToast />
    <TourOverlay />
  </div>
{/if}
```

- [ ] **Step 5: Verify build**

Run: `pnpm check`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/+layout.svelte
git commit -m "feat: wire tour store and overlay into app shell"
```

---

### Task 8: Replay tour button in Settings

**Files:**
- Modify: `src/routes/settings/+page.svelte`

**Interfaces:**
- Consumes: `tour` store, `goto` from `$app/navigation`
- Produces: "Replay tour" button that forces tour restart

- [ ] **Step 1: Add Replay tour button to Settings page**

In `src/routes/settings/+page.svelte`, add import:

```typescript
import { tour } from '$lib/stores/tour.svelte';
import { goto } from '$app/navigation';
```

Add a function:

```typescript
function replayTour() {
  if ($page.url.pathname !== '/') {
    goto('/');
  }
  tour.start({ force: true });
}
```

Add the button in the settings list (before the version info div):

```svelte
<div class="bg-tape rounded-lg border border-line p-4">
  <div class="font-medium text-ledger">{m.tour_replay()}</div>
  <div class="text-sm text-dim mb-3">{m.tour_replay_desc()}</div>
  <button
    onclick={replayTour}
    class="px-3 py-1.5 text-sm rounded-md bg-phosphor text-ink font-medium hover:bg-phosphor-bright transition-colors"
  >{m.tour_replay()}</button>
</div>
```

- [ ] **Step 2: Verify build**

Run: `pnpm check`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/settings/+page.svelte
git commit -m "feat: add replay tour button to settings"
```

---

### Task 9: Run full test suite and verify

- [ ] **Step 1: Run all unit tests**

Run: `pnpm test`
Expected: All tests pass (existing + new tour tests).

- [ ] **Step 2: Run type check**

Run: `pnpm check`
Expected: No errors.

- [ ] **Step 3: Manual testing checklist**

In `pnpm tauri dev`:

1. **Fresh user path:** Clear DB → complete onboarding → tour auto-starts → step through all 5 steps → tour_complete set → tour does not reappear on reload.
2. **Skip path:** Start tour → press Escape → tour dismissed → tour_complete set.
3. **Replay path:** Settings → Replay tour → tour restarts from step 1.
4. **Grandfather path:** Existing user with `first_run_complete=1` but no `tour_complete` → load app → tour does NOT start (grandfathered).
5. **Host shortcut suppression:** During tour, press N → transaction modal does NOT open.
6. **Mobile targets:** Resize to mobile width → `data-tour` on BottomNav is targeted instead of Sidebar.
7. **Resize/scroll:** During tour, resize window or scroll → tooltip repositions.

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: tour overlay adjustments from manual testing"
```
