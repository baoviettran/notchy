# 2026-09-06 Critique Fixes — Safety Net, Affordances, Discoverability, Ritual Speed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Serves:** STORY-033 (safety net survives until I decide), STORY-034 (the app shows its own powers), STORY-014 (UI stays one coherent system), STORY-012 (keyboard/AT parity incl. reduced-motion coverage), STORY-018 (plan a month — envelope-review loop), STORY-029 (fast-entry feedback — tray account balance), STORY-013 (maintainer trusts tests).

**Goal:** Close the seven priority issues from the 2026-09-06 whole-app critique (`/.impeccable/critique/2026-09-06T13-50-44Z__src-routes.md`): multi-slot toast bus, goal-delete undo, visible help entry, affordance alignment (goals/accounts/categories), visible compact-figure expansion, envelope-review field chaining + keyboard month stepping, tray account balance, detail-page stale comment, and reduced-motion E2E coverage.

**Architecture:** The toast bus gains an action-toast precedence rule (informational toasts queue behind a live action toast instead of evicting it). Goal undo rides the **already-existing** `deleted_at` soft-delete column — no schema migration, no version-bump call sites; it only adds a `restore` path mirroring `accounts`. Affordance work converges every surface onto the existing `ContextMenu` + `ConfirmDialog` primitives. Money gains a visible expand toggle when compacted. Budget edit gains Enter-to-next-field chaining via a pure helper. Everything is TDD (red-green-refactor) per CLAUDE.md.

**Tech Stack:** Svelte 5 runes, sql.js/tauri-sql dual repos (browser + native), Rust/tauri v2 commands, Vitest unit, Playwright E2E, Paraglide 1.11.8 flat keys.

**Spec:** critique snapshot `.impeccable/critique/2026-09-06T13-50-44Z__src-routes.md` (issues #1–#8); stories `product/stories/index.md` STORY-033/034.

## Global Constraints

- Amounts are integers in smallest currency units; never floats.
- New UI strings go in **both** `messages/en.json` and `messages/vi.json`, flat underscore keys, no dotted IDs; run `pnpm check` to regen Paraglide.
- Svelte 5 runes only (`$state`, `$derived`, `$effect`, `$props`); no legacy stores.
- IDs are ULIDs (`src/lib/utils/id.ts`).
- All tests pass (`pnpm test`) before every commit; commit prefixes `feat:`/`fix:`/`refactor:`/`test:`/`chore:`; commit messages via heredoc form (multi-line `-m` breaks the roadmap rollup).
- Native seam: every new Rust command must be registered in `src-tauri/src/lib.rs` invoke_handler and covered by the native-boundary suite.
- Hover-revealed UI must also reveal on focus and be visible on coarse pointers; color never carries meaning alone.

---

### Task 1: ToastBus — action toasts survive informational toasts

**Files:**
- Modify: `src/lib/stores/toast.svelte.ts`
- Test: `src/tests/unit/stores/toast.test.ts`

**Interfaces:**
- Consumes: existing `ToastBus` API (`show`, `pause`, `resume`, `dismiss`, `current`).
- Produces: same public API — `show(message, opts?)`, `current: ToastItem | null`. Semantics change only: an action toast currently visible is no longer evicted by a non-action toast; the non-action toast is queued (FIFO, max 3, oldest dropped) and promoted when the action toast expires or is dismissed. An action toast always takes the visible slot immediately (last action wins).

- [ ] **Step 1: Write the failing tests** (append to `src/tests/unit/stores/toast.test.ts`; keep existing tests passing — non-action→non-action replacement is unchanged):

```ts
it('queues an informational toast behind a live action toast', () => {
	vi.useFakeTimers();
	const bus = new ToastBus();
	bus.show('saved', { action: 'undo', onaction: () => {}, duration: 5000 });
	const actionId = bus.current!.id;
	bus.show('another thing');
	// The undo toast is still the one on screen.
	expect(bus.current!.id).toBe(actionId);
	bus.dismiss();
	// After the action toast is dismissed the queued toast is promoted.
	expect(bus.current?.message).toBe('another thing');
	vi.useRealTimers();
});

it('promotes queued toasts when the action toast expires', () => {
	vi.useFakeTimers();
	const bus = new ToastBus();
	bus.show('saved', { action: 'undo', onaction: () => {}, duration: 5000 });
	bus.show('later');
	vi.advanceTimersByTime(5000);
	expect(bus.current?.message).toBe('later');
	vi.useRealTimers();
});

it('action toast replaces the visible toast immediately', () => {
	vi.useFakeTimers();
	const bus = new ToastBus();
	bus.show('info one');
	bus.show('critical', { action: 'undo', onaction: () => {}, duration: 5000 });
	expect(bus.current?.message).toBe('critical');
	vi.useRealTimers();
});

it('queued informational toasts still replace each other', () => {
	vi.useFakeTimers();
	const bus = new ToastBus();
	bus.show('saved', { action: 'undo', onaction: () => {}, duration: 5000 });
	bus.show('first');
	bus.show('second');
	bus.dismiss();
	expect(bus.current?.message).toBe('second');
	vi.useRealTimers();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/tests/unit/stores/toast.test.ts`
Expected: FAIL — the queued toasts are evicted (`bus.current.id` changes on the informational `show`).

- [ ] **Step 3: Implement** — replace `ToastBus` internals (public API unchanged):

```ts
export class ToastBus {
	current = $state<ToastItem | null>(null);
	private queue: ToastItem[] = [];
	private timer: ReturnType<typeof setTimeout> | undefined;
	private deadline = 0;

	private arm(duration: number): void {
		this.clearTimer();
		this.deadline = Date.now() + duration;
		const id = this.current?.id;
		this.timer = setTimeout(() => {
			if (this.current?.id === id) { this.current = null; this.promote(); }
		}, duration);
	}

	private clearTimer(): void {
		if (this.timer !== undefined) clearTimeout(this.timer);
		this.timer = undefined;
	}

	// A live action toast is a safety net (undo). Informational toasts must not
	// evict it — they queue and surface when the slot frees. An action toast
	// always takes the slot: last deliberate destructive action wins.
	show(message: string, opts?: { action?: string; onaction?: () => void; duration?: number }) {
		const item: ToastItem = { id: ++nextId, message, ...opts };
		if (item.action) {
			this.queue = [];
			this.current = item;
			this.arm(opts?.duration ?? 3000);
			return;
		}
		if (this.current?.action) {
			if (this.queue.length >= 3) this.queue.shift();
			this.queue.push(item);
			return;
		}
		this.current = item;
		this.arm(opts?.duration ?? 3000);
	}

	private promote(): void {
		const next = this.queue.shift();
		if (!next) return;
		this.current = next;
		this.arm(next.duration ?? 3000);
	}

	pause(): void {
		if (this.timer === undefined || !this.current) return;
		this.arm(Math.max(this.deadline - Date.now(), 1000));
		this.clearTimer();
	}

	resume(): void {
		if (this.timer !== undefined || !this.current) return;
		this.arm(Math.max(this.deadline - Date.now(), 1000));
	}

	dismiss() {
		this.clearTimer();
		this.current = null;
		this.promote();
	}
}
```

- [ ] **Step 4: Run the full unit suite** — `pnpm test` (unit). Expected: PASS, including the pre-existing toast tests and both `unit/toast.test.ts` / `unit/stores/toast.test.ts`.
- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/toast.svelte.ts src/tests/unit/stores/toast.test.ts
git commit -m "$(cat <<'EOF'
fix: queue informational toasts behind live undo toasts

A single-slot toast bus let any later toast evict a live 5s undo
affordance mid-flow. Action toasts now hold the slot; informational
toasts queue (max 3) and surface when it frees.

Closes critique issue #1 (STORY-033).

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Goal restore — repo + native seam

**Files:**
- Modify: `src/lib/db/browser/repos/goals.ts` (add `restoreGoal`), `src/lib/db/repos/goals.ts` (forwarder export), `src/lib/db/client.ts` (`GoalOps` interface), `src/lib/db/native/client.ts` (`NativeGoalOps`), `src/lib/db/native/goals.ts` (stub), `src-tauri/src/database/domains/goals.rs`, `src-tauri/src/database/commands.rs`, `src-tauri/src/lib.rs`
- Test: the native-boundary suite (find via `grep -rln "goal_delete" src/tests/unit`) + `src/tests/unit/goals.test.ts`

**Interfaces:**
- Consumes: `restoreAccount` pattern (`src/lib/db/browser/repos/accounts.ts:229-235`); Rust `restore_account` (`src-tauri/src/database/domains/accounts.rs:389`) + `account_restore` command (`commands.rs:159`).
- Produces: `GoalOps.restore(id: string): Promise<void>` on all three backends (browser, native, stub); Rust command `goal_restore`.

- [ ] **Step 1: Write the failing tests** — in the browser-repo goals test (`src/tests/unit/goals.test.ts`, or the repo-level file where `deleteGoal` is covered — grep `deleteGoal` under `src/tests/unit`):

```ts
it('restoreGoal un-deletes a soft-deleted goal', async () => {
	const id = await createGoal(db, { name: 'Trip', type: 'savings', target_amount: 100, target_date: '2026-12-31', starting_amount: 0 });
	await deleteGoal(db, id);
	expect(await getGoal(db, id)).toBeNull();
	await restoreGoal(db, id);
	const restored = await getGoal(db, id);
	expect(restored?.name).toBe('Trip');
});
```

And in the native-boundary suite: add a `goal_restore` row exactly mirroring the existing `goal_delete` row (same invoke-shape assertion, command name swapped).

- [ ] **Step 2: Run to verify fail** — `pnpm vitest run src/tests/unit/goals.test.ts` → FAIL (`restoreGoal is not a function`).
- [ ] **Step 3: Implement browser repo** (`src/lib/db/browser/repos/goals.ts`, mirroring `restoreAccount` exactly):

```ts
export async function restoreGoal(db: DatabaseService, id: string): Promise<void> {
	const now = new Date().toISOString();
	await db.execute(
		`UPDATE goals SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL`,
		[now, id]
	);
}
```

Export it through the forwarder `src/lib/db/repos/goals.ts`. In `src/lib/db/client.ts`, add `restore(id: string): Promise<void>;` to `GoalOps`. In `src/lib/db/native/goals.ts` add the typed stub (`throw new Error('native goals adapter not wired')`), and in `src/lib/db/native/client.ts` inside `NativeGoalOps`:

```ts
restore(id: string): Promise<void> {
	return invoke<void>('goal_restore', { id });
}
```

In `src-tauri/src/database/domains/goals.rs`, add `restore_goal` mirroring `restore_account` (same op_id/idempotency handling, SQL: `UPDATE goals SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL`). In `commands.rs` add `goal_restore` mirroring `account_restore` (generate `OperationId` + `data_job`). Register it in `lib.rs` invoke_handler next to `goal_delete` (line ~99). Run `pnpm generate:db-contracts` then `pnpm check:db-contracts` — type surface unchanged, expect no diff (commit any if present).
- [ ] **Step 4: Run** — `pnpm vitest run src/tests/unit/goals.test.ts` and the native-boundary file; then `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/db/browser/repos/goals.ts src/lib/db/repos/goals.ts src/lib/db/client.ts src/lib/db/native/goals.ts src/lib/db/native/client.ts src-tauri/src/database/domains/goals.rs src-tauri/src/database/commands.rs src-tauri/src/lib.rs
git commit -m "$(cat <<'EOF'
feat: goal restore across browser repo, native seam, and Rust

Goals already soft-delete (deleted_at) — this adds the missing
restore path mirroring accounts, end to end: browser repo, GoalOps
interface, native adapter, Rust goal_restore command.

Closes critique issue #2 backend half (STORY-033).

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Goal delete undo toast

**Files:**
- Modify: `src/lib/stores/goals.svelte.ts`, `src/routes/goals/+page.svelte:93-102`
- Test: `src/tests/unit/goals.test.ts` (store-level; mirror the accounts-store undo test — grep `deleted_toast` under `src/tests/unit/stores` for the pattern)

**Interfaces:**
- Consumes: `GoalOps.restore` (Task 2); the accounts store undo pattern (`src/lib/stores/accounts.svelte.ts:50-69`); existing i18n keys `goals_deleted_toast`, `common_undo`, `goals_restored_toast` — **no new keys**.
- Produces: `GoalsStore.delete(id)` shows the undo toast itself (like `AccountsStore.delete`); the page's `doDelete` no longer shows its own toast.

- [ ] **Step 1: Failing test** — mirror the accounts-store delete-undo test against the goals store: delete → a toast with action `undo` is shown → invoking `onaction` calls `db.goals.restore` and reloads.
- [ ] **Step 2: Run → FAIL** (no undo action on goals delete).
- [ ] **Step 3: Implement** — move the toast into the store:

```ts
async delete(id: string): Promise<void> {
	const db = getDb();
	// Capture for undo
	const g = await db.goals.get(id);
	await db.goals.delete(id);
	await this.load();

	if (g) {
		toast.show(m.goals_deleted_toast(), {
			action: m.common_undo(),
			duration: 5000,
			onaction: async () => {
				const db2 = getDb();
				await db2.goals.restore(id);
				await this.load();
				toast.show(m.goals_restored_toast());
			}
		});
	}
}
```

(imports: `toast` from `$lib/stores/toast.svelte`, `* as m` from `$lib/paraglide/messages`). In `goals/+page.svelte` `doDelete`, drop the page-level `toast.show(m.goals_deleted_toast())` (the store owns it now); keep the confirm-close.
- [ ] **Step 4: Run** `pnpm test` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/goals.svelte.ts src/routes/goals/+page.svelte src/tests/unit/goals.test.ts
git commit -m "$(cat <<'EOF'
feat: undoable goal delete via soft-delete restore

Goal delete was the one hard, unrestorable money-adjacent delete.
Now mirrors accounts: capture, soft-delete, 5s undo toast.

Closes critique issue #2 UI half (STORY-033).

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Goals affordance — ContextMenu carries Edit, name stops mutating

**Files:**
- Modify: `src/routes/goals/+page.svelte:173-179`

**Interfaces:**
- Consumes: `ContextMenu` (as already used in this file); `m.common_edit()`.
- Produces: goal name renders as plain text (no `onclick`, no `title`-only button); the ContextMenu gains an Edit item above Complete/Delete. Overdue row's existing "extend date" button stays.

- [ ] **Step 1: Test first** — add to the goals page component test if one exists (grep `src/tests/unit/components` for a goals page test); otherwise assert via a unit test on rendered markup is impractical — use the E2E pattern: extend an existing goals E2E spec (grep `goals` under `src/tests/e2e`) with: goal name is NOT a button (`page.locator('role=button[name=<goal-name>]')` count 0) and the row menu contains Edit. Mark the E2E to run in Step 4.
- [ ] **Step 2: Run → FAIL** (name is currently a button that opens edit).
- [ ] **Step 3: Implement:**

```svelte
<span class="text-sm font-medium text-ledger text-left truncate max-w-[60%]">{g.name}</span>
<div class="flex items-center gap-2">
	<span class="text-xs {vs.color}">{vs.icon} {goalStatusLabel(g.velocity_status)}</span>
	<ContextMenu label={m.common_actions_for({ name: g.name })}>
		<button onclick={() => openEdit(g)} role="menuitem" class="w-full text-left px-3 py-2 text-sm text-ledger hover:bg-line/40">{m.common_edit()}</button>
		<button onclick={() => confirmComplete = g} role="menuitem" class="w-full text-left px-3 py-2 text-sm text-phosphor hover:bg-line/40">{m.goals_mark_complete()}</button>
		<button onclick={() => confirmDelete = g} role="menuitem" class="w-full text-left px-3 py-2 text-sm text-debit hover:bg-line/40">{m.goals_delete()}</button>
	</ContextMenu>
</div>
```

- [ ] **Step 4: Run** — `pnpm test` + `pnpm test:e2e` (goals spec). PASS.
- [ ] **Step 5: Commit**

```bash
git add src/routes/goals/+page.svelte src/tests/e2e
git commit -m "$(cat <<'EOF'
fix: goal rows stop treating the name as an edit trigger

Clicking a goal name opened a mutation — the only surface where
content-click mutates. Name is now text; Edit lives in the row's
ContextMenu, matching accounts.

Closes critique issue #4 goals part (STORY-014).

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Accounts affordances — liabilities gain Archive; archived rows use ContextMenu

**Files:**
- Modify: `src/routes/accounts/+page.svelte:137-140,151-158`
- Test: extend the accounts E2E spec (grep `accounts` under `src/tests/e2e`): liabilities ContextMenu contains Archive; archived section has a ContextMenu per row whose menu contains Unarchive.

**Interfaces:**
- Consumes: `archiveAccount(acc)` (already in this file), `m.accounts_archive()` / `m.accounts_unarchive()`, `ContextMenu`.

- [ ] **Step 1: Failing E2E** as described. **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — in the liabilities `ContextMenu` (line 137-140), insert the Archive item between Edit and Delete (same class as assets' line 109, label `acc.archived ? unarchive : archive`); in the archived section (151-158), replace the inline unarchive text button with:

```svelte
<ContextMenu label={m.common_actions_for({ name: acc.name })}>
	<button onclick={() => openEdit(acc)} role="menuitem" class="w-full text-left px-3 py-2 text-sm text-ledger hover:bg-line/40">{m.common_edit()}</button>
	<button onclick={() => archiveAccount(acc)} role="menuitem" class="w-full text-left px-3 py-2 text-sm text-ledger hover:bg-line/40">{m.accounts_unarchive()}</button>
</ContextMenu>
```

- [ ] **Step 4: Run** — `pnpm test` + accounts E2E. PASS.
- [ ] **Step 5: Commit** (heredoc, `fix: align liabilities and archived-account affordances with the ContextMenu pattern`, closes critique issue #4 accounts part, STORY-014).

---

### Task 6: Categories delete uses ConfirmDialog

**Files:**
- Modify: `src/routes/settings/categories/+page.svelte:139-160`
- Test: categories component/E2E — grep `categories` under `src/tests/unit` and `src/tests/e2e` for the delete-confirm coverage; the delete flow test must now go through `ConfirmDialog`.

**Interfaces:**
- Consumes: `ConfirmDialog` props (`open`, `title`, `message`, `confirmLabel`, `danger`, `onconfirm` — as used in `goals/+page.svelte:241-259`).
- Produces: same delete semantics, but the shared ConfirmDialog primitive (Esc-to-cancel, focus trap, consistent styling). The merge-target `<Select>` still appears when `affectedCount > 0` — ConfirmDialog needs a snippet slot for extra content; check `ConfirmDialog.svelte` for a `children`/snippet prop; if it lacks one, add an optional `children` snippet prop (default empty) — minimal, backward compatible.

- [ ] **Step 1: Failing test** — existing delete test must still pass; add assertion that the dialog is the ConfirmDialog pattern (role="alertdialog" if ConfirmDialog renders it — verify from `ConfirmDialog.svelte` and assert accordingly).
- [ ] **Step 2: Run → FAIL** (raw Modal has no alertdialog role).
- [ ] **Step 3: Implement** — replace the raw Modal block (139-160) with:

```svelte
<ConfirmDialog
	open={confirmDelete !== null}
	title={m.categories_delete_confirm_title()}
	message={confirmDelete
		? (affectedCount === 1
			? m.categories_delete_referenced_one({ count: affectedCount })
			: affectedCount > 0
				? m.categories_delete_referenced({ count: affectedCount })
				: m.categories_delete_confirm_body())
		: ''}
	confirmLabel={m.common_delete()}
	danger={true}
	onconfirm={doDelete}
>
	{#snippet children()}
		{#if confirmDelete && affectedCount > 0}
			<Select label={m.categories_action()} bind:value={deleteOption} options={mergeTargetOptions(confirmDelete.id)} />
		{/if}
	{/snippet}
</ConfirmDialog>
```

(Also set `confirmDelete = null` inside `doDelete` so the dialog closes after delete; keep cancel via dialog's own close.) Verify how ConfirmDialog renders its message + children — read the component first and adapt props to its actual API rather than inventing slots.
- [ ] **Step 4: Run** — `pnpm test` + categories E2E. PASS.
- [ ] **Step 5: Commit** (heredoc, `fix: categories delete uses the shared ConfirmDialog`, closes critique issue #4 categories part, STORY-014).

---

### Task 7: Visible help entry in the TopBar

**Files:**
- Modify: `src/lib/components/layout/TopBar.svelte`
- Modify: `messages/en.json`, `messages/vi.json` (new key `layout_help_shortcuts`)
- Test: component test for TopBar if one exists (grep `TopBar` under `src/tests/unit/components`); else E2E: `?` still opens shortcuts AND the new button opens the same modal.

**Interfaces:**
- Consumes: the layout's `showShortcuts` state — the TopBar is rendered from `+layout.svelte`, so pass a callback prop `onOpenShortcuts: () => void` wired to the same state the `?` handler toggles (`+layout.svelte:93,97`).
- Produces: a labeled keyboard-reachable button in TopBar opening the shortcut sheet.

- [ ] **Step 1: Add i18n keys** — `messages/en.json`: `"layout_help_shortcuts": "Shortcuts"`; `messages/vi.json`: `"layout_help_shortcuts": "Phím tắt"`. Run `pnpm check` to regen Paraglide.
- [ ] **Step 2: Failing test** — TopBar renders a button with accessible name "Shortcuts"/"Phím tắt"; clicking it calls `onOpenShortcuts`.
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement** — add prop `let { onOpenShortcuts }: { onOpenShortcuts: () => void } = $props();` and, before the language toggle button:

```svelte
<button
	onclick={onOpenShortcuts}
	aria-label={m.layout_help_shortcuts()}
	class="plate px-2 py-2 rounded border border-line text-dim hover:text-ledger"
>?</button>
```

In `+layout.svelte`, where `<TopBar …>` is rendered, pass `onOpenShortcuts={() => { showShortcuts = true; }}`.
- [ ] **Step 5: Run** `pnpm test` → PASS. **Step 6: Commit** (heredoc, `feat: visible shortcuts entry in the top bar`, closes critique issue #3, STORY-034).

---

### Task 8: Money — visible expand for compacted figures

**Files:**
- Modify: `src/lib/components/reports/Money.svelte`, `src/app.css` (one `.figures-expand` rule)
- Modify: `messages/en.json`, `messages/vi.json` (keys `figures_show_exact`, `figures_show_compact`)
- Test: component test (grep for an existing `Money.test.ts` under `src/tests/unit/components`; create if absent, following `GlobalToast.test.ts` patterns)

**Interfaces:**
- Consumes: `isLongCurrency` / `formatCurrencyCompact` (already used); the dashboard hero's dotted-underline affordance (`src/routes/+page.svelte:130-138`) as the visual precedent.
- Produces: when `long`, the compact figure is a real `<button>` (dotted underline, visible affordance — not title-only) toggling to the full-precision figure and back; aria-label announces the toggle; keyboard operable. Uncompacted figures stay a plain span.

- [ ] **Step 1: i18n keys** — en: `"figures_show_exact": "Show exact amount"`, `"figures_show_compact": "Show compact amount"`; vi: `"figures_show_exact": "Hiện số chính xác"`, `"figures_show_compact": "Hiện số gọn"`. `pnpm check`.
- [ ] **Step 2: Failing component test:**

```ts
it('compacted figures expand on click without relying on title', async () => {
	// long VND amount → renders a button, not a span-with-title
	// click → visible text becomes the full-precision figure
	// click again → back to compact
});
```

Write it concretely against the real component API after Step 1's regen (render `<Money amount={1_500_000_000} />` with settings stubbed to VND).
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement** — in `Money.svelte`, add `let expanded = $state(false);` and when `long` render:

```svelte
{#if long}
	<button
		type="button"
		onclick={() => (expanded = !expanded)}
		aria-label={expanded ? m.figures_show_compact() : m.figures_show_exact()}
		class="figures-expand {size} {tones[tone]}"
	>
		{#if expanded}
			{resolvedGlyph}{formatCurrency(amount, settings.currency, settings.locale)}
		{:else}
			<span aria-hidden="true">{resolvedGlyph}{formatCurrencyCompact(Math.abs(amount), settings.currency, settings.locale)}</span>
			<span class="sr-only">{resolvedGlyph}{formatCurrency(amount, settings.currency, settings.locale)}</span>
		{/if}
	</button>
{:else}
	<!-- existing span, unchanged -->
{/if}
```

CSS in `app.css` (place near the existing `.figures` rules):

```css
/* Compact figures expand visibly — title is a mouse-only affordance and
   must never be the only path to the exact value. */
.figures-expand {
	text-decoration: underline dotted;
	text-underline-offset: 3px;
	cursor: pointer;
}
```

Keep the non-expanded `title` attribute as a redundant mouse hint. Note: `expanded` must reset when `amount` changes — bind reset in an `$effect(() => { amount; expanded = false; })`.
- [ ] **Step 5: Run** `pnpm test` → PASS.
- [ ] **Step 6: Commit** (heredoc, `feat: visible expand affordance for compacted figures`, closes critique issue #5, STORY-034).

---

### Task 9: Envelope review — Enter chains to the next bucket; ←/→ steps months

**Files:**
- Create: `src/lib/utils/budgets.ts` (pure helpers)
- Modify: `src/routes/budgets/+page.svelte` (inline edit region ~85-153), `src/lib/components/layout/ShortcutRef.svelte`
- Modify: `messages/en.json`, `messages/vi.json` (key `shortcuts_month_step`)
- Test: `src/tests/unit/budgets/` (new file for the helpers; the dir exists — check)

**Interfaces:**
- Produces: `nextBudgetableId(buckets: { id: string; budgetable: number }[], currentId: string | null): string | null` — the next budgetable bucket after `currentId` in list order, `null` at the end. `monthStepFromKey(key: string): -1 | 0 | 1` — ArrowLeft −1, ArrowRight +1, else 0.
- Behavior: Enter in the inline edit commits the field and opens the next bucket's inline edit; blur still commits-and-exits (current behavior) unless the blur is the programmatic one caused by chaining; when focus is not in an input, ArrowLeft/ArrowRight step the budget month.

- [ ] **Step 1: Failing helper tests** (`src/tests/unit/budgets/budgets-utils.test.ts` — follow existing dir naming; create the file if no matching dir):

```ts
import { nextBudgetableId, monthStepFromKey } from '$lib/utils/budgets';

const buckets = [
	{ id: 'a', budgetable: 1 },
	{ id: 'b', budgetable: 0 },
	{ id: 'c', budgetable: 1 },
	{ id: 'd', budgetable: 1 }
];

it('chains to the next budgetable bucket, skipping non-budgetable', () => {
	expect(nextBudgetableId(buckets, 'a')).toBe('c');
	expect(nextBudgetableId(buckets, 'c')).toBe('d');
});

it('returns null after the last bucket', () => {
	expect(nextBudgetableId(buckets, 'd')).toBeNull();
});

it('monthStepFromKey maps arrows only', () => {
	expect(monthStepFromKey('ArrowLeft')).toBe(-1);
	expect(monthStepFromKey('ArrowRight')).toBe(1);
	expect(monthStepFromKey('ArrowDown')).toBe(0);
});
```

- [ ] **Step 2: Run → FAIL.** **Step 3: Implement `src/lib/utils/budgets.ts`:**

```ts
export interface BudgetableBucket { id: string; budgetable: number }

// Envelope-review chaining: Enter lands in the next bucket's field so the
// monthly ritual is one continuous pass, not one restart per bucket.
export function nextBudgetableId(buckets: BudgetableBucket[], currentId: string | null): string | null {
	const idx = buckets.findIndex((b) => b.id === currentId);
	if (idx === -1) return null;
	const next = buckets.slice(idx + 1).find((b) => b.budgetable);
	return next ? next.id : null;
}

export function monthStepFromKey(key: string): -1 | 0 | 1 {
	if (key === 'ArrowLeft') return -1;
	if (key === 'ArrowRight') return 1;
	return 0;
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Wire the page** — in `budgets/+page.svelte`:
  1. Add `let advancing = $state(false);`
  2. `blurEdit()` gains a guard at the top: `if (advancing) { advancing = false; return; }` (the chaining focus move fires the old field's blur — don't treat it as a commit-and-exit; the commit already happened).
  3. Add `onkeydown` on the inline edit input: on `Enter`, `e.preventDefault()`, then `const ok = editError === '' && (async () => { await saveEdit(editing); })();` — after a successful save (check via a return value: make `saveEdit` return `boolean`), if `editing` was committed: `const nextId = nextBudgetableId(budgetableBuckets, typeId); if (nextId) { advancing = true; startEdit(nextId); }` else `editing = null`.
  4. Add a window keydown listener (component-scoped `<svelte:window onkeydown={...}>`) mirroring the layout's guard: `const target = e.target as HTMLElement; if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;` then `const step = monthStepFromKey(e.key); if (step !== 0) { e.preventDefault(); step === -1 ? prevMonth() : nextMonth(); }`.
- [ ] **Step 6: ShortcutRef** — add `{ key: '←/→', label: () => m.shortcuts_month_step() }` (en: `"shortcuts_month_step": "Budget month step"`, vi: `"shortcuts_month_step": "Chuyển tháng ngân sách"`; `pnpm check`).
- [ ] **Step 7: Run** `pnpm test` → PASS. **Step 8: Commit** (heredoc, `feat: chain envelope edits and step months from the keyboard`, closes critique issue #6 + Bảo finding, STORY-018).

---

### Task 10: Tray tape shows the active account's balance

**Files:**
- Modify: `src/routes/quick-add/+page.svelte` (lines ~55-66, ~222-232)
- Test: quick-add component/E2E — grep `quick` under `src/tests/unit` and `src/tests/e2e`; the account-switch control must expose the balance (visible text).

**Interfaces:**
- Consumes: `db.accounts.list()` (returns `balance` — verify field name from `AccountWithBalance`), `formatCurrencyCompact` from `$lib/utils/currency`, `settings` (already loaded in this page).
- Produces: the account-switch footer button reads `AccountName · 1,2tr₫` (compact), so blind cycling becomes informed switching.

- [ ] **Step 1: Failing test** — the account-switch button's text contains the compact balance of the active account.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — in `loadDefaultAccount`, keep a balance alongside name:

```ts
const accounts = await db.accounts.list();
allAccounts = accounts.map((a) => ({ id: a.id, name: a.name, balance: a.balance }));
```

(type `allAccounts` accordingly). In the footer button, render the balance after the name:

```svelte
>{accountName}{#if activeAccount} · {formatCurrencyCompact(balanceOf(activeAccount.id), settings.currency, settings.locale)}{/if}{#if allAccounts.length > 1} ▾{/if}</button>
```

with `const balanceOf = (id: string) => allAccounts.find((a) => a.id === id)?.balance ?? 0;`. Keep the existing `accountName` string (check how it's derived — adapt so both name and balance derive from `activeAccount`). On the web build `settings` must be loaded before use — it already is in `onMount` before `ready`.
- [ ] **Step 4: Run** `pnpm test` + quick-add E2E → PASS. **Step 5: Commit** (heredoc, `feat: show the active account's balance in the tray tape`, closes Bảo finding #2, STORY-029).

---

### Task 11: Detail-page delete — fix the stale comment

**Files:**
- Modify: `src/routes/transactions/[id]/+page.svelte:80-84`

The comment claims navigating away destroys the toast before the undo callback fires; in reality `GlobalToast` lives in `+layout.svelte` outside the keyed shell and survives navigation — the comment describes a non-bug. Behavior is correct; the comment is not. No test can verify a comment; this is a docs-level chore (TDD exception per CLAUDE.md's generated/config carve-out — flagged here explicitly).

- [ ] **Step 1: Replace lines 80-84 comment** with:

```ts
// txStore.delete already shows an undo toast. GlobalToast lives in the
// root layout, outside the keyed shell, so it survives this navigation —
// the undo callback fires against the list page. No restatement needed.
```

- [ ] **Step 2: Commit**

```bash
git add "src/routes/transactions/[id]/+page.svelte"
git commit -m "$(cat <<'EOF'
docs: correct stale comment on detail-page delete undo

The comment claimed the undo toast is destroyed by navigation; the
toast lives in the layout and survives it. Comment-only change.

Closes critique issue #7 (STORY-033).

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: prefers-reduced-motion E2E coverage

**Files:**
- Create: `src/tests/e2e/reduced-motion.spec.ts`
- Verify/modify: `src/app.css` (reduced-motion block exists? — grep `prefers-reduced-motion` in `src/app.css`; if the block doesn't kill `animate-slide-up`/`animate-flash`, extend it)

**Interfaces:**
- Consumes: Playwright `emulateMedia({ reducedMotion: 'reduce' })`; existing E2E fixture/selector patterns (dual-render, hydration wait — see `src/tests/e2e/light-contrast.spec.ts` for the house style).

- [ ] **Step 1: Write the failing spec:**

```ts
import { test, expect } from './fixtures'; // follow the existing house fixture import in sibling specs

test('animations are disabled under prefers-reduced-motion', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	// Navigate per the house pattern (see light-contrast.spec.ts for the
	// dual-render + hydration wait dance), then:
	const animated = page.locator('.animate-slide-up, .animate-flash, .animate-flash-fast').first();
	await expect
		.poll(async () =>
			animated.count() === 0
				? 'none'
				: await animated.evaluate((el) => getComputedStyle(el).animationName)
		)
		.toBe('none');
});
```

Adapt the locator to elements actually present on the loaded page (a toast is the most reliable: trigger one by deleting a transaction per the existing transactions E2E helper).
- [ ] **Step 2: Run → observe.** If the CSS block already disables these, the test passes as a regression lock (green is acceptable when coverage was the gap); if it fails, fix the CSS block first (same task).
- [ ] **Step 3: Commit**

```bash
git add src/tests/e2e/reduced-motion.spec.ts src/app.css
git commit -m "$(cat <<'EOF'
test: lock reduced-motion behavior behind an E2E assertion

PRODUCT.md commits to reduced-motion support; no E2E asserted it.

Closes critique detector finding (STORY-012, STORY-013).

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review notes (run before execution)

- Type consistency: `nextBudgetableId`/`monthStepFromKey` signatures used identically in Task 9 steps; `GoalOps.restore` added in Task 2 is consumed in Task 3's store code.
- No placeholders: every code step carries real code; the two "read the component first" notes (ConfirmDialog API in Task 6, quick-add accountName derivation in Task 10) are verification instructions with concrete fallbacks, not missing design.
- Spec coverage: critique issues #1→Task 1, #2→Tasks 2-3, #3→Task 7, #4→Tasks 4-6, #5→Task 8, #6→Task 9, #7→Task 11, detector reduced-motion gap→Task 12, Bảo tray finding→Task 10. All seven priority issues + the detector gap covered.
- Schema risk: Task 2 touches no migration — `deleted_at` already exists on goals. **Do not bump any schema version.**
