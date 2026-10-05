# Scheduled Transactions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Serves:** STORY-009

**Goal:** A user defines a recurring bill/income/transfer once, and Notchy posts every missed occurrence when the app next opens — so rent and salary stop being re-entered by hand.

**Architecture:** One adapter-agnostic posting loop lives in `src/lib/logic/post-due-schedules.ts` and is called once at boot from `+layout.svelte` (main window only). It consumes the port's own `db.schedules` and `db.transactions`, so every posted row goes through the existing transaction validation and transfer-pair model — the engine writes no SQL and owns no second copy of the rules. All recurrence arithmetic is a pure function, `src/lib/utils/schedule_next_due.ts`; **Rust never computes a due date** — it stores whatever dates the engine hands it. Rust owns the table, its CRUD, and the idempotent mutations, exactly like every other domain since the native cutover.

**Tech Stack:** Rust + rusqlite + Tauri v2 commands; TypeScript; Svelte 5 runes; SvelteKit; SQLite (sql.js in the browser adapter, better-sqlite3 in unit tests); Paraglide 1.11.8; Vitest; Playwright.

**Spec:** `specs/2026-07-06-scheduled-transactions-and-rollover-pool-design.md` — **Part 1 (Scheduled Transactions) only.** The spec's Part 2 (rollover to-budget pool) is deliberately out of scope here and gets its own plan: it needs **no migration**, it rewrites existing budget queries, and it changes numbers an existing user already sees — a different risk profile from a greenfield feature, and a different reviewer's decision. Nothing in this plan implements, enables, or prepares Part 2.

## Global Constraints

- **TDD (CLAUDE.md):** write the failing test first, watch it fail, implement the minimum, refactor. `pnpm test` passes before every commit. No exceptions; ask first if you believe one is warranted.
- **Amounts are always integers** in the smallest currency unit. No floats, ever — not even transiently in the UI.
- **IDs are ULIDs** (`src/lib/utils/id.ts` in TS; `OperationId`/ULID helpers in Rust).
- **Commit messages** use the house prefixes (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`) and **the heredoc form**, because a multi-line `-m` string makes `pnpm test:roadmap` mark the plan stale:
  ```bash
  git commit -m "$(cat <<'EOF'
  feat: <subject>

  Co-Authored-By: Claude Code <noreply@anthropic.com>
  EOF
  ```
- **Checkbox discipline:** when a task's commit lands, flip that task's steps to `[x]` in this file. A task counts as done only if its boxes are `[x]` **and** `git log` has the commit.
- **i18n (Paraglide 1.11.8):** flat underscore keys, **no dotted IDs**; every new key goes into **both** `messages/en.json` and `messages/vi.json`; run `pnpm check` (or `pnpm exec paraglide-js compile …`) to regenerate `src/lib/paraglide/messages/`, which is generated and never hand-edited.
- **Svelte 5 runes** (`$state`, `$derived`, `$effect`, `$props`) — not legacy stores.
- **Rust command pattern:** `#[tauri::command] pub async fn x(manager: State<'_, Arc<DatabaseManager>>, input: T) -> Result<R, DbError>`, writes through `manager.data_job(move |state| domains::…(state.connection_mut()?, op_id, …))`, registered in `tauri::generate_handler![…]` (`src-tauri/src/lib.rs`).
- **Every mutation is idempotent** through `run_idempotent(conn, op_id, command_kind, &request, |tx| …)`; one `OperationId::generate()` per user intent.
- **Two migration registries, deliberately one apart.** JS (`src/lib/db/browser/migrations/index.ts`) is canonical at `LATEST_SCHEMA_VERSION = 5`; Rust (`src-tauri/src/database/migrations.rs`) is at `6` because Rust alone has `migration_006 "operation_receipts"`. This plan adds JS `006` (→ JS latest **6**) and Rust `007` (→ Rust latest **7**). Neither side gets renumbered.
- **Generated contracts:** `src/lib/native/contracts.generated.ts` is produced by `pnpm generate:db-contracts`; CI verifies with `pnpm check:db-contracts`. Never hand-edit it.
- **Boundary sweep:** every production `invoke()` call site must have a `FIXTURES` entry in `src/tests/unit/native-boundary.test.ts`, and each command's camelCase arg keys are asserted against the parsed Rust signature. Adding a command without its fixture is a red test by design.

## Review Focus

The spec is a vision document; it says what the software must do, not everything it will meet. These five are the input classes most likely to bite a real user, most likely first. Each is pinned by a test in the task that owns the code.

1. **A schedule whose `next_due_date` is NULL** (the column is nullable, and "computed" is easy to forget on the create path) must never be silently skipped forever — a schedule the user cannot see is worse than one that errors loudly. Pinned in Task 2 (`create` writes `next_due_date = start_date`), Task 7 (`listDue` excludes NULL), Task 8 (the engine re-anchors to `start_date` rather than skipping).
2. **A long-closed app — or a schedule the user deliberately paused — meeting the catch-up engine** must be handled in a way the user can see and stop: not flooded with 60 back-dated rows, not silently dropped, and not replayed in full because "it was disabled for six months". Either failure corrupts a month. Pinned in Task 1 (`firstDueOnOrAfter`), Task 4 (the two resume semantics), Task 8 (the cap and its chunked drain), and Task 10.
3. **A monthly schedule anchored on the 31st** crosses February, where the 31st does not exist. Pinned in Task 1 (the exact clamped sequence is asserted) and recorded as a known drift in this plan's *Accepted risks*.
4. **The account is deleted after the schedule was created.** The post must fail *that schedule* only — mark it errored, keep boot alive, and still post every other due schedule. **The spec's mechanism for this does not work here:** `deleteAccount` soft-deletes, so no foreign key fires and `createTransaction` has no deleted-account guard — left alone, rent would post silently against an account the user removed. The engine checks the account is live and parks the schedule. Pinned in Task 8 (both the injected-failure and the real soft-delete case).
5. **A reminder-only schedule (`posts_transaction = 0`) missed over several months** must produce **one** notice and **zero** transactions, while still advancing past today. N kinds of "you owe rent" or a pile of phantom rows are both wrong. Pinned in Task 8.

---

### Task 1: `nextDueDate` — the pure recurrence step

Pure date arithmetic, no DB, no wiring. Everything downstream depends on this being right; it is also the only place recurrence is implemented, so it is the cheapest place to be wrong.

**Files:**
- Create: `src/lib/utils/schedule_next_due.ts`
- Test: `src/tests/unit/schedules/schedule-next-due.test.ts`

**Interfaces:**
- Consumes: nothing. This task is standalone.
- Produces:
  - `export type ScheduleFrequency = 'weekly' | 'biweekly' | 'monthly' | 'yearly'` — Task 2's SQL `CHECK` and Task 3's Rust `ScheduleFrequency` enum agree with this exact set. (The spec names this type `Frequency`; it is `ScheduleFrequency` here so it matches the Rust enum's name and cannot be confused with a future general-purpose type.)
  - `export function nextDueDate(from: string, frequency: ScheduleFrequency, interval = 1): string` — advances one recurrence step from an ISO `YYYY-MM-DD` date. Pure: `from` is passed in, there is no `Date.now()` inside. Throws on a malformed `from`.
  - `export function firstDueOnOrAfter(from: string, frequency: ScheduleFrequency, today: string): string | null` — the first occurrence on or after `today`, bounded to `REANCHOR_MAX_STEPS = 1000` steps (returns `null` if it cannot reach `today` in that many, which means "leave the stored date alone"). Task 10 uses it when re-enabling a disabled schedule, so re-enabling does not retroactively post the disabled period — see this plan's note under *Accepted risks*.

- [x] **Step 1: Write the failing test**

`src/tests/unit/schedules/schedule-next-due.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextDueDate, firstDueOnOrAfter } from '$lib/utils/schedule_next_due';

describe('nextDueDate', () => {
	it('advances weekly by 7 days and biweekly by 14', () => {
		expect(nextDueDate('2026-01-01', 'weekly')).toBe('2026-01-08');
		expect(nextDueDate('2026-01-01', 'biweekly')).toBe('2026-01-15');
	});

	it('carries a weekly step across a month and a year boundary', () => {
		expect(nextDueDate('2026-01-28', 'weekly')).toBe('2026-02-04');
		expect(nextDueDate('2026-12-28', 'weekly')).toBe('2027-01-04');
	});

	it('advances monthly to the same day next month', () => {
		expect(nextDueDate('2026-03-15', 'monthly')).toBe('2026-04-15');
		expect(nextDueDate('2026-12-15', 'monthly')).toBe('2027-01-15');
	});

	it('clamps a monthly step to the last day of a short month', () => {
		// January 31 has no February counterpart; the step clamps to month end.
		expect(nextDueDate('2026-01-31', 'monthly')).toBe('2026-02-28');
		expect(nextDueDate('2024-01-31', 'monthly')).toBe('2024-02-29'); // leap year
		expect(nextDueDate('2026-03-31', 'monthly')).toBe('2026-04-30');
	});

	it('advances yearly to the same month and day', () => {
		expect(nextDueDate('2026-07-04', 'yearly')).toBe('2027-07-04');
	});

	it('clamps a yearly step onto a leap day', () => {
		expect(nextDueDate('2024-02-29', 'yearly')).toBe('2025-02-28');
	});

	it('multiplies by the interval', () => {
		expect(nextDueDate('2026-01-01', 'weekly', 3)).toBe('2026-01-22');
		expect(nextDueDate('2026-01-15', 'monthly', 3)).toBe('2026-04-15');
		expect(nextDueDate('2026-01-15', 'yearly', 2)).toBe('2028-01-15');
	});

	it('is pure — the same input always yields the same output', () => {
		expect(nextDueDate('2026-01-31', 'monthly')).toBe(nextDueDate('2026-01-31', 'monthly'));
	});
});

describe('firstDueOnOrAfter', () => {
	it('returns the anchor unchanged when it is already today or later', () => {
		expect(firstDueOnOrAfter('2026-06-01', 'monthly', '2026-06-01')).toBe('2026-06-01');
		expect(firstDueOnOrAfter('2026-07-01', 'monthly', '2026-06-01')).toBe('2026-07-01');
	});

	it('skips forward past a disabled period instead of replaying it', () => {
		// Disabled from January to June: re-enabling must not post five months of rent.
		expect(firstDueOnOrAfter('2026-01-31', 'monthly', '2026-06-01')).toBe('2026-06-28');
		expect(firstDueOnOrAfter('2026-01-01', 'weekly', '2026-01-10')).toBe('2026-01-15');
	});

	it('clamps across a short month while skipping', () => {
		expect(firstDueOnOrAfter('2026-01-31', 'monthly', '2026-02-01')).toBe('2026-02-28');
	});

	it('gives up rather than looping forever on an unreachable date', () => {
		// 1000 weekly steps is ~19 years; past that the caller keeps the stored date.
		expect(firstDueOnOrAfter('1970-01-01', 'weekly', '2100-01-01')).toBeNull();
	});
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/tests/unit/schedules/schedule-next-due.test.ts`
Expected: FAIL — `Failed to resolve import "$lib/utils/schedule_next_due"`.

- [x] **Step 3: Write the minimal implementation**

`src/lib/utils/schedule_next_due.ts`:

```ts
/**
 * Recurrence arithmetic for scheduled transactions.
 *
 * Pure by construction: the anchor date is an argument, so a test can pin a
 * sequence without freezing the clock, and the caller (`postDueSchedules`) owns
 * "today". The algorithm is the same civil-date conversion Rust uses in
 * `domains/civil_date.rs` — no library, no `Date`, no timezone surface.
 */
export type ScheduleFrequency = 'weekly' | 'biweekly' | 'monthly' | 'yearly';

interface CivilDate {
	year: number;
	month: number; // 1-12
	day: number; // 1-31
}

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIso(iso: string): CivilDate {
	const match = ISO_PATTERN.exec(iso);
	if (!match) throw new Error(`not an ISO date: ${iso}`);
	return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function formatIso({ year, month, day }: CivilDate): string {
	return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isLeapYear(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Days in a 1-based month. */
function daysInMonth(year: number, month: number): number {
	const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	return lengths[month - 1];
}

/** Hinnant's days-from-civil: days since 1970-01-01. */
function daysFromCivil({ year, month, day }: CivilDate): number {
	const y = month <= 2 ? year - 1 : year;
	const era = Math.floor((y >= 0 ? y : y - 399) / 400);
	const yoe = y - era * 400;
	const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
	const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
	return era * 146097 + doe - 719468;
}

/** Hinnant's civil-from-days: the inverse of `daysFromCivil`. */
function civilFromDays(days: number): CivilDate {
	const z = days + 719468;
	const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
	const doe = z - era * 146097;
	const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
	const y = yoe + era * 400;
	const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
	const mp = Math.floor((5 * doy + 2) / 153);
	const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
	const month = mp + (mp < 10 ? 3 : -9);
	return { year: month <= 2 ? y + 1 : y, month, day };
}

/** Shift a civil date by whole days, going through the day number. */
function addDays(date: CivilDate, days: number): CivilDate {
	return civilFromDays(daysFromCivil(date) + days);
}

/**
 * Add whole months, anchoring on the day-of-month and clamping to the target
 * month's length. Month arithmetic is done on `year*12 + month` so the carry
 * is a single division, never a chain of `if (month > 12)`.
 */
function addMonths(date: CivilDate, months: number): CivilDate {
	const absolute = date.year * 12 + (date.month - 1) + months;
	const year = Math.floor(absolute / 12);
	const month = (absolute % 12) + 1;
	return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

export function nextDueDate(from: string, frequency: ScheduleFrequency, interval = 1): string {
	const anchor = parseIso(from);
	switch (frequency) {
		case 'weekly':
			return formatIso(addDays(anchor, 7 * interval));
		case 'biweekly':
			return formatIso(addDays(anchor, 14 * interval));
		case 'monthly':
			return formatIso(addMonths(anchor, interval));
		case 'yearly':
			return formatIso(addMonths(anchor, 12 * interval));
	}
}

/**
 * How many steps `firstDueOnOrAfter` will take before giving up (~19 years of
 * weekly occurrences). A bound is required: the loop's exit condition depends
 * on dates the caller supplies, and an unbounded `while` is a hang waiting for
 * a malformed row.
 */
export const REANCHOR_MAX_STEPS = 1000;

/**
 * The first occurrence on or after `today`, for re-anchoring a schedule the user
 * re-enabled. Deliberately different from `nextDueDate`: stepping one occurrence
 * at a time exists so that re-enabling never retroactively posts a disabled
 * period. Returns `null` when the bound is hit, meaning "leave the stored date
 * alone" — the posting engine's catch-up cap is the backstop then.
 */
export function firstDueOnOrAfter(
	from: string,
	frequency: ScheduleFrequency,
	today: string
): string | null {
	let candidate = from;
	for (let step = 0; step < REANCHOR_MAX_STEPS; step += 1) {
		if (candidate >= today) return candidate;
		candidate = nextDueDate(candidate, frequency);
	}
	return null;
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/tests/unit/schedules/schedule-next-due.test.ts`
Expected: PASS — all 12 cases (8 under `nextDueDate`, 4 under `firstDueOnOrAfter`).

- [x] **Step 5: Commit**

```bash
git add src/lib/utils/schedule_next_due.ts src/tests/unit/schedules/schedule-next-due.test.ts
git commit -m "$(cat <<'EOF'
feat: add pure nextDueDate recurrence step for scheduled transactions

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: JS schema `006_schedules` and the schema-version call-site sweep

The `schedules` table, in the canonical JS registry, plus every literal that assumes "latest = 5". The sweep is not optional bookkeeping: the drift guard (`src/tests/unit/schema-version-drift.test.ts`) is designed to fail until it is done, and the "newer than latest" fixtures silently stop being newer if they are missed.

**Files:**
- Create: `src/lib/db/browser/migrations/006_schedules.ts`
- Create: `src/lib/db/migrations/006_schedules.ts` (forwarder, 3 lines)
- Modify: `src/lib/db/browser/migrations/index.ts` (import + append + `LATEST_SCHEMA_VERSION` derives itself)
- Modify: `src/tests/e2e/fixtures/tauri-mock.ts` (`const LATEST = 5` → `6`; `if (currentVersion < 5)` → `< LATEST`; add the `schedules` table; `schema_version', '5'` → `'6'`)
- Modify: the "current schema" and "newer than current" literals listed in Step 3
- Test: `src/tests/unit/migrations.test.ts` (extend)

**Interfaces:**
- Consumes: `Migration` from `src/lib/db/browser/migrations/runner.ts` (`{ version, name, up(db: DatabaseService) }`), and the idempotency pattern of `004_rollover_toggle.ts`.
- Produces: table `schedules` at JS schema **6**, with columns `(id, name, kind, amount, account_id, transfer_account_id, tag_id, payee, description, frequency, start_date, end_date, posts_transaction, next_due_date, last_posted_date, completed, enabled, errored_at, created_at, updated_at, deleted_at)`. Task 3 writes the same shape as Rust `migration_007`; Task 7's browser repo and Task 12's mock write against it.

**Three deliberate deviations from the spec's SQL, recorded here so they are not mistaken for oversights.**

1. **`errored_at TEXT` (nullable) is added.** The spec's DDL has no column that can hold "this schedule tried to post and could not". Without one, the cap branch and the failed-post branch would retry on *every* boot — re-toasting forever while posting nothing — because `listDue` has no way to exclude them. It is set by `markErrored`, excluded by `listDue`, shown in the UI as a badge with a **Resume** action, and cleared when the user re-enables the schedule (Task 4).
2. **`name` gets a lower bound** (`length(name) BETWEEN 1 AND 64` rather than `<= 64`), so a nameless schedule cannot exist. Every user-facing list is keyed by this string.
3. **Both `kind`-versus-`transfer_account_id` directions are CHECKed**, where the spec has only the comment *"set iff kind='transfer'"*. A transfer schedule with no destination, or an expense carrying one, is a row the engine would fail on at post time — better rejected at write time on both adapters.

- [x] **Step 1: Write the failing test**

Append to `src/tests/unit/migrations.test.ts` (it already has `db` + `migrations` in scope from its existing `beforeEach`; follow its existing imports):

```ts
describe('migration 006 — schedules', () => {
	it('creates the schedules table with the recurrence columns', async () => {
		const columns = await db.query<{ name: string }>('PRAGMA table_info(schedules)');
		const names = columns.map((column) => column.name).sort();
		expect(names).toEqual(
			[
				'account_id',
				'amount',
				'completed',
				'created_at',
				'deleted_at',
				'description',
				'enabled',
				'end_date',
				'errored_at',
				'frequency',
				'id',
				'kind',
				'last_posted_date',
				'name',
				'next_due_date',
				'payee',
				'posts_transaction',
				'start_date',
				'tag_id',
				'transfer_account_id',
				'updated_at',
			].sort()
		);
	});

	it('rejects a recurrence the pure util cannot produce', async () => {
		await db.execute(
			`INSERT INTO schedules (id, name, kind, amount, account_id, frequency, start_date, next_due_date, created_at, updated_at)
			 VALUES ('s1', 'Rent', 'expense', 100, 'acct', 'fortnightly', '2026-01-01', '2026-01-01', 'x', 'x')`
		).then(
			() => {
				throw new Error('expected the CHECK constraint to reject an unknown frequency');
			},
			() => undefined
		);
	});

	it('rejects a non-positive amount', async () => {
		await db.execute(
			`INSERT INTO schedules (id, name, kind, amount, account_id, frequency, start_date, next_due_date, created_at, updated_at)
			 VALUES ('s2', 'Zero', 'expense', 0, 'acct', 'monthly', '2026-01-01', '2026-01-01', 'x', 'x')`
		).then(
			() => {
				throw new Error('expected the CHECK constraint to reject a zero amount');
			},
			() => undefined
		);
	});

	it('rejects a start date outside the range transactions.date allows', async () => {
		await db.execute(
			`INSERT INTO schedules (id, name, kind, amount, account_id, frequency, start_date, next_due_date, created_at, updated_at)
			 VALUES ('s3', 'Ancient', 'expense', 100, 'acct', 'monthly', '1899-12-31', '1899-12-31', 'x', 'x')`
		).then(
			() => {
				throw new Error('expected the CHECK constraint to reject an out-of-range start date');
			},
			() => undefined
		);
	});

	it('is idempotent — re-running the registry is a no-op', async () => {
		await runMigrations(db, migrations);
		const columns = await db.query<{ name: string }>('PRAGMA table_info(schedules)');
		expect(columns.length).toBe(21);
	});
});
```

Add `runMigrations` + `migrations` to that file's imports if they are not already there.

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/tests/unit/migrations.test.ts`
Expected: FAIL — `no such table: schedules` (and the two CHECK cases fail with the same error, not a constraint rejection).

- [x] **Step 3: Write the migration, the forwarder, the registry entry, and the sweep**

`src/lib/db/browser/migrations/006_schedules.ts`:

```ts
import type { Migration } from './runner';

/**
 * Scheduled transactions. Idempotent via `CREATE TABLE IF NOT EXISTS`, so a
 * half-applied migration (table created, version not bumped) cannot brick the
 * next boot — the same race `004` guards against with its PRAGMA check.
 *
 * `errored_at` is not in the original spec DDL: without it a schedule that
 * cannot post would retry on every boot. See the plan's note on the deviation.
 */
export const migration006: Migration = {
	version: 6,
	name: 'schedules',
	async up(db) {
		await db.execute(`
			CREATE TABLE IF NOT EXISTS schedules (
				id                  TEXT PRIMARY KEY,
				name                TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
				kind                TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer')),
				amount              INTEGER NOT NULL CHECK (amount > 0 AND amount <= 999999999999),
				account_id          TEXT NOT NULL REFERENCES accounts(id),
				transfer_account_id TEXT REFERENCES accounts(id),
				tag_id              TEXT REFERENCES category_tags(id),
				payee               TEXT CHECK (payee IS NULL OR length(payee) <= 128),
				description         TEXT CHECK (description IS NULL OR length(description) <= 1024),
				frequency           TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'yearly')),
				start_date          TEXT NOT NULL CHECK (start_date BETWEEN '1970-01-01' AND '2100-12-31'),
				end_date            TEXT CHECK (end_date IS NULL OR end_date >= start_date),
				posts_transaction   INTEGER NOT NULL DEFAULT 1 CHECK (posts_transaction IN (0, 1)),
				next_due_date       TEXT,
				last_posted_date    TEXT,
				completed           INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
				enabled             INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
				errored_at          TEXT,
				created_at          TEXT NOT NULL,
				updated_at          TEXT NOT NULL,
				deleted_at          TEXT,
				CHECK (kind <> 'transfer' OR (transfer_account_id IS NOT NULL AND tag_id IS NULL)),
				CHECK (kind = 'transfer' OR transfer_account_id IS NULL)
			)
		`);
		await db.execute(`
			CREATE INDEX IF NOT EXISTS idx_schedules_due
			ON schedules(enabled, completed, errored_at, next_due_date, deleted_at)
		`);
	}
};
```

`src/lib/db/migrations/006_schedules.ts` — the forwarder, matching `005`:

```ts
// Forwarder — canonical implementation moved to browser/migrations/006_schedules.ts
export { migration006 } from '../browser/migrations/006_schedules';
```

`src/lib/db/browser/migrations/index.ts` — add the import and append to the array (do **not** touch the exported `LATEST_SCHEMA_VERSION`; it derives from the array):

```ts
import { migration006 } from './006_schedules';
export const migrations: Migration[] = [
	migration001,
	migration002,
	migration003,
	migration004,
	migration005,
	migration006,
];
```

Then the sweep. The registry version moves 5 → 6, so **two classes of literal change**, in opposite directions:

**(a) "this is the current schema" literals — 5 → 6:**

| File | What |
| --- | --- |
| `src/tests/e2e/fixtures/tauri-mock.ts` | `const LATEST = 5;` → `6` (line ~494) |
| `src/tests/e2e/fixtures/tauri-mock.ts` | `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '5')` → `'6'` (line ~583) |
| `src/tests/unit/startup.test.ts` | `schemaVersion: 5` at ~110, ~152, ~189; `schema_version: '5'` / `last_successful_schema_version: '5'` at ~120-122 |
| `src/tests/unit/upgrade-backup.test.ts` | `{ exact: 5 }` + `{ schemaVersion: 5 }` at ~43; `{ min: 5, max: 5 }` at ~60 |
| `src/tests/e2e/backup-restore.spec.ts` | `expect(result).toEqual({ schemaVersion: 5 })` at ~82 |
| `src/tests/unit/backup-health.test.ts` | `schema_version', '6'` at ~36 and the `'6'` at ~77 — these become ambiguous now that 6 is current; if either assertion means "the app's schema", set it to `6` and comment why |

Also in `tauri-mock.ts`, the migration-needs-running branch `if (currentVersion < 5)` (line ~527) hardcodes the old latest. Change it to `if (currentVersion < LATEST)` so the next bump cannot leave it behind, and extend the mock's bootstrap with the table it now owns:

```ts
// Migration 006 (mirrors src/lib/db/migrations/006-*.ts: schedules table).
db.run("CREATE TABLE IF NOT EXISTS schedules (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, amount INTEGER NOT NULL, account_id TEXT NOT NULL, transfer_account_id TEXT, tag_id TEXT, payee TEXT, description TEXT, frequency TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT, posts_transaction INTEGER NOT NULL DEFAULT 1, next_due_date TEXT, last_posted_date TEXT, completed INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1, errored_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)");
```

**(b) "newer than latest" fixtures — 6 → 7** (they must stay *above* the new latest, or the rejection tests turn into acceptance tests):

| File | What |
| --- | --- |
| `src/tests/unit/schema.test.ts` | the `[[1,'older'],[4,'older'],[5,'current'],[6,'newer']]` table at ~11 → `…[6,'current'],[7,'newer']` |
| `src/tests/unit/migrations.test.ts` | `UPDATE app_meta SET value = '6'` at ~273, and the expected error string `database_schema_newer:6:5` at ~275 |
| `src/tests/unit/startup.test.ts` | `UPDATE app_meta SET value = '6'` at ~200 |
| `src/tests/unit/recovery.test.ts` | the `'6'` at ~62, ~67 (`schemaVersion: 6`), ~115 |
| `src/tests/e2e/backup-restore.spec.ts` | `INSERT INTO app_meta (key, value) VALUES ('schema_version', '6')` at ~216 |

`src/tests/e2e/startup-recovery.spec.ts` already uses `initialSchemaVersion: 7` (line 24) and stays correct; fix its stale header comment at line 10, which still says 6.

Then **enumerate the call sites yourself — do not treat the two tables above as complete.** They are
what `grep` found at plan time. Re-run the grep and reconcile, because a literal the tables miss does
not necessarily go red:

```bash
grep -rn "LATEST = 5\|LATEST_SCHEMA_VERSION = 5\|schemaVersion: 5\|schemaVersion: '5'\|schema_version: '5'\|schema_version', '5'\|last_successful_schema_version: '5'\|exact: 5\|min: 5, max: 5\|currentVersion < 5" src/
grep -rn "schema_version', '6'\|schema_version: '6'\|schemaVersion: '6'\|database_schema_newer\|'newer'" src/tests/
```

Classification is the actual work — a literal that looks like the others may not change:

- **"the app's current schema"** → moves 5 → 6. Tests that assert what the app *reports* after
  startup, and fixtures that build a DB at the app's latest, are this class.
- **"a version I made up for this fixture"** → **stays.** `upgrade-backup.test.ts` passes an explicit
  expected version to `validateDatabase` (e.g. `{ exact: 5 }` against a fixture DB built at 5); the
  version there is a parameter under test, not the app's latest, so changing one without the other
  breaks it. Do not churn these.
- **"newer than the app's latest"** → moves 6 → 7, so it stays *above* the new latest; miss this and
  a rejection test silently becomes an acceptance test.

Two sites need a human read, and neither is caught by a test:

- `tauri-mock.ts:490` carries the comment `// LATEST aligns to the JS registry (LATEST_SCHEMA_VERSION = 5 in …)`.
  `schema-version-drift.test.ts` greps `const LATEST = (\d+)` and the `schema_version', 'N'` insert —
  not this comment — so it goes stale in silence. Fix it.
- `src/tests/unit/startup.test.ts:397` inserts `('schema_version', '5')`, and
  `src/tests/unit/backup-health.test.ts:26` has `schemaVersion: 5`; the tables name neither. Read
  each, place it in one of the three classes above, and say which in your report.

In your report, give the classification you assigned to every site the grep returned — the reconciled
list, not the tables.

After the edits, run the whole suite and fix any remaining red literal.

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm test && pnpm test:e2e`
Expected: PASS — including `schema-version-drift.test.ts`, whose two assertions (mock `LATEST`, every `schema_version', 'N'` insert in the mock) now both require 6.

- [x] **Step 5: Commit**

```bash
git add src/lib/db/browser/migrations/006_schedules.ts src/lib/db/migrations/006_schedules.ts src/lib/db/browser/migrations/index.ts src/tests/unit/migrations.test.ts src/tests/unit/startup.test.ts src/tests/unit/upgrade-backup.test.ts src/tests/unit/schema.test.ts src/tests/unit/recovery.test.ts src/tests/unit/backup-health.test.ts src/tests/e2e/fixtures/tauri-mock.ts src/tests/e2e/backup-restore.spec.ts src/tests/e2e/startup-recovery.spec.ts
git commit -m "$(cat <<'EOF'
feat: add the schedules table as JS schema 006 and sweep schema-version call sites

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Rust `migration_007`, the v7 manifest, and the native version bump

Rust keeps its own registry and its own manifest of expected tables per version; a schema bump that misses `manifest.rs` fails `validate_manifest` at startup — a bricked boot, not a red test you can ignore.

**Files:**
- Modify: `src-tauri/src/database/migrations.rs` (add `migration_007`, append to `MIGRATIONS`, `LATEST_SCHEMA_VERSION = 7`, fix the "migrations 1-6" doc comments at :1 and :165)
- Modify: `src-tauri/src/database/manifest.rs` (add `TABLES_V7` and the `manifest_for` arm)
- Modify: `src-tauri/tests/migrations.rs` (the version-literal sweep below; header comment at :2)
- Modify: `src-tauri/tests/crash_recovery.rs:224` (`assert_eq!(version, "6")` → `"7"`)
- Modify: `src-tauri/tests/startup.rs:218` (`assert_eq!(meta, "6")` → `"7"`)
- Create: `src-tauri/tests/fixtures/v008.sqlite` (copy of `v007.sqlite` with `app_meta.schema_version` set to `8`)
- Test: `src-tauri/tests/migrations.rs` (extend)

**The version-literal sweep.** Bumping `LATEST_SCHEMA_VERSION` to 7 breaks every Rust test that
hard-codes a schema number. Do not assume these follow the constant — grep first, then sweep. Two
classes, both verified by grep at plan review:

*Class (a) — "this is the current schema" (6 → 7):* `migrations.rs:183` (and rename
`supported_v4_migrates_to_v6_atomically` → `..._to_v7_atomically`), `:211`, `:228` (**both** the
`for version in 1..=6` loop bound → `1..=7` and the `assert_eq!(schema_version(&db), 6)` plus its
"published DB is schema 6" comment), `:265`, `:476`; `crash_recovery.rs:224`; `startup.rs:218`.

*Class (b) — "this is newer than the app" (7 → 8):* `v007.sqlite` is the committed
newer-than-latest fixture, so once 7 is current it is `Current`, not `Newer`, and both of its call
sites break — `migrations.rs:190` (the loop asserting every listed fixture `is_rejected()`) and
`:332` (`Newer { version: 7 }`). Create `v008.sqlite` and re-point both. No manifest is needed:
`inspect_schema` (`manifest.rs:566`) classifies by integer comparison *before* any manifest lookup,
so a fixture only has to carry `app_meta` and one user table claiming the version — which is the
same shape `v007.sqlite` must have, there being no fixture generator in the repo. `copy_fixture`
panics on a missing file, so a bad fixture is a red gate rather than a silent pass.

**Interfaces:**
- Consumes: `Migration { version, name, up: fn(&Transaction<'_>) -> DbResult<()> }`, the `failpoint_step` atomicity helper, `sql(...)` error mapping, and the `TABLES_V6` / `manifest_for` pattern in `manifest.rs`.
- Produces: Rust schema **7** with `schedules` present; `manifest_for(7)` returns a manifest whose table list includes `schedules`. Task 4's domain code is the only writer.

- [x] **Step 1: Write the failing test**

Append to `src-tauri/tests/migrations.rs`, following its existing helper usage:

```rust
// ---------------------------------------------------------------------------
// Migration 7 (schedules)
// ---------------------------------------------------------------------------
#[test]
fn migration_seven_creates_the_schedules_table() {
    let db = fresh_schema7_db();
    let columns: Vec<String> = db
        .prepare("PRAGMA table_info(schedules)")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert!(columns.iter().any(|name| name == "next_due_date"));
    assert!(columns.iter().any(|name| name == "errored_at"));
    assert!(columns.iter().any(|name| name == "transfer_account_id"));
}

#[test]
fn the_v7_manifest_is_the_latest_one() {
    assert_eq!(LATEST_SCHEMA_VERSION, 7);
    assert_eq!(MIN_SUPPORTED_SCHEMA_VERSION, 3);
    // A database at 7 validates against the manifest for 7 — the startup gate.
    let db = fresh_schema7_db();
    validate_manifest(&db, LATEST_SCHEMA_VERSION).unwrap();
}

#[test]
fn migration_seven_rejects_an_unknown_frequency() {
    let (mut db, account_id) = fresh_schema7_db_with_account();
    let error = db
        .execute(
            "INSERT INTO schedules (id, name, kind, amount, account_id, frequency, start_date, next_due_date, created_at, updated_at)
             VALUES ('s1', 'Rent', 'expense', 100, ?1, 'fortnightly', '2026-01-01', '2026-01-01', 'x', 'x')",
            [account_id],
        )
        .expect_err("the frequency CHECK must be authoritative on the native path too");
    // Attribute the failure to the named constraint, not to "something rejected it".
    let message = error.to_string();
    assert!(
        message.contains("CHECK constraint failed") && message.contains("frequency"),
        "expected the frequency CHECK, got: {message}"
    );
}

#[test]
fn migration_seven_rejects_an_out_of_range_start_date() {
    let (mut db, account_id) = fresh_schema7_db_with_account();
    let error = db
        .execute(
            "INSERT INTO schedules (id, name, kind, amount, account_id, frequency, start_date, next_due_date, created_at, updated_at)
             VALUES ('s1', 'Rent', 'expense', 100, ?1, 'monthly', '1899-12-31', '1899-12-31', 'x', 'x')",
            [account_id],
        )
        .expect_err("the date bound must match transactions.date and the JS side");
    let message = error.to_string();
    assert!(
        message.contains("CHECK constraint failed") && message.contains("start_date"),
        "expected the start_date CHECK, got: {message}"
    );
}

#[test]
fn migration_seven_accepts_a_well_formed_expense_and_transfer() {
    // The other half of the contract: a row that satisfies every CHECK must be storable.
    // Without this, an over-tightened CHECK passes every rejection test above.
    let (mut db, account_id) = fresh_schema7_db_with_account();
    let transfer_id = accounts::create_account(&mut db, op(), account_named("Dest")).unwrap();

    for (id, kind, destination) in
        [("ok-expense", "expense", None), ("ok-transfer", "transfer", Some(&transfer_id))]
    {
        db.execute(
            "INSERT INTO schedules (id, name, kind, amount, account_id, transfer_account_id, frequency, start_date, next_due_date, created_at, updated_at)
             VALUES (?1, 'Rent', ?2, 100, ?3, ?4, 'monthly', '2026-01-01', '2026-01-01', 'x', 'x')",
            rusqlite::params![id, kind, account_id, destination],
        )
        .unwrap_or_else(|e| panic!("{kind} schedule {id} must be accepted, got: {e}"));
    }
}
```

The two helpers the snippet calls — define them at the top of the file, copying the existing idiom from
`src-tauri/tests/domain_accounts_transactions.rs` (which every domain test file already follows):

```rust
/// A freshly bootstrapped schema-7 database, read-only for inspection.
fn fresh_schema7_db() -> Connection {
    let path = fresh_path("schema7");
    bootstrap_current(&path, FailurePoint::None).unwrap();
    open_ro(&path)
}

/// A freshly bootstrapped schema-7 database, **read-write**, with one account row inserted.
/// Read-write is mandatory: an INSERT through `open_ro` fails with "attempt to write a readonly
/// database" for every input, so every rejection test above would pass with the CHECKs deleted.
fn fresh_schema7_db_with_account() -> (Connection, String) {
    let path = fresh_path("schema7-rw");
    bootstrap_current(&path, FailurePoint::None).unwrap();
    let mut conn =
        Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_WRITE).unwrap();
    let account_id = accounts::create_account(&mut conn, op(), account_named("Main")).unwrap();
    (conn, account_id)
}
```

Use the `open_ro` / `Connection::open_with_flags(…READ_WRITE)` pair exactly as in
`domain_accounts_transactions.rs:34-38` — that file's `fresh_db` is the shape both of these follow.

Both rejection tests insert `account_id 'acct'`, which no row satisfies. If the connection they use
has `PRAGMA foreign_keys = ON` (production does — `connection.rs:80`; a bare `rusqlite::Connection`
does not), these inserts fail on the foreign key and the CHECK under test is never reached — the
assertion passes for the wrong reason. **Do both, not either:** insert a real account row first
*and* assert on the error text, so each failure is attributable to the constraint the test names
regardless of how the harness is configured. The read-only trap above is the bigger version of the
same mistake and is not optional to fix. Pin
`start_date` to the same `BETWEEN` bound the JS migration uses; `transactions.date` already carries
that exact check on both sides (`migrations.rs:302`, `001_initial.ts:58`), and these two tables are
the only pair in the feature that must not drift.

Rename the existing `assert_eq!(LATEST_SCHEMA_VERSION, 6)` assertion into the new test above rather than leaving two tests that assert the same constant.

**`migrated_fresh()` does not exist — this is the concrete idiom to use instead.** `src-tauri/tests/migrations.rs`
has exactly one way to obtain a fully-migrated database, and it is already used by
`fresh_bootstrap_creates_current_schema`:

```rust
let path = fresh_path("schedules-reject");
bootstrap_current(&path, FailurePoint::None).unwrap();
let db = open_ro(&path);          // <-- READ-ONLY. See the warning below.
```

Use the same first two lines, then open a **read-write** connection for the two rejection tests.

> **The read-only trap — the one way these tests can pass without testing anything.**
> `open_ro` (`migrations.rs:49`) opens with `SQLITE_OPEN_READ_ONLY`, and it is the idiom every
> inspection test in this file uses — no test in `migrations.rs` currently calls `execute()` at all.
> An `INSERT` through it fails with *"attempt to write a readonly database"* for **every** input, so
> both rejection tests would pass **even if all three CHECK constraints were deleted**. A test that
> cannot fail is worse than no test, because it reports green. Open read-write instead:
>
> ```rust
> let db = Connection::open(&path).unwrap();   // read-write, like migrations.rs:169/304/484
> ```
>
> Note also that a bare `rusqlite::Connection` has `foreign_keys` **off** by default, unlike production
> (`connection.rs:80` turns it on, and no test in `src-tauri/tests/` sets it). So the foreign-key
> wrong-reason does not currently fire — but that is a property of the test harness, not a guarantee.
> Assert on the error text anyway, so the test pins the constraint it names under either pragma.

> **Also cover the `kind`-versus-`transfer_account_id` CHECKs here.** The plan's stated rationale for
> adding them is that a bad row must be "rejected at write time **on both adapters**" — but only the
> JS adapter tests them, so the native adapter enforcing them is currently an untested claim. Add
> the three rejection tests (transfer with no destination, expense with a destination, transfer with
> a `tag_id`), in the same read-write + error-text-asserting shape.

- [x] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test migrations`
Expected: FAIL — `no such table: schedules`, and `assertion failed: 6 == 7`.

- [x] **Step 3: Write the migration, the manifest entry, and the version-literal sweep**

In `src-tauri/src/database/migrations.rs`: change `pub const LATEST_SCHEMA_VERSION: i64 = 6;` to `7`, append to `MIGRATIONS`, update the two "migrations 1-6" doc comments, and add the up-function mirroring the JS DDL (Rust is the authority for the native path; the two must not drift):

```rust
fn migration_007(transaction: &Transaction<'_>) -> DbResult<()> {
    sql(transaction.execute(
        "CREATE TABLE IF NOT EXISTS schedules (
            id                  TEXT PRIMARY KEY,
            name                TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
            kind                TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer')),
            amount              INTEGER NOT NULL CHECK (amount > 0 AND amount <= 999999999999),
            account_id          TEXT NOT NULL REFERENCES accounts(id),
            transfer_account_id TEXT REFERENCES accounts(id),
            tag_id              TEXT REFERENCES category_tags(id),
            payee               TEXT CHECK (payee IS NULL OR length(payee) <= 128),
            description         TEXT CHECK (description IS NULL OR length(description) <= 1024),
            frequency           TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'yearly')),
            start_date          TEXT NOT NULL CHECK (start_date BETWEEN '1970-01-01' AND '2100-12-31'),
            end_date            TEXT CHECK (end_date IS NULL OR end_date >= start_date),
            posts_transaction   INTEGER NOT NULL DEFAULT 1 CHECK (posts_transaction IN (0, 1)),
            next_due_date       TEXT,
            last_posted_date    TEXT,
            completed           INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
            enabled             INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
            errored_at          TEXT,
            created_at          TEXT NOT NULL,
            updated_at          TEXT NOT NULL,
            deleted_at          TEXT,
            CHECK (kind <> 'transfer' OR (transfer_account_id IS NOT NULL AND tag_id IS NULL)),
            CHECK (kind = 'transfer' OR transfer_account_id IS NULL)
        )",
        [],
    ))?;
    failpoint_step(7)?;
    sql(transaction.execute(
        "CREATE INDEX IF NOT EXISTS idx_schedules_due
         ON schedules(enabled, completed, errored_at, next_due_date, deleted_at)",
        [],
    ))?;
    failpoint_step(7)?;
    Ok(())
}
```

In `src-tauri/src/database/manifest.rs`, copy the `TABLES_V6` table-manifest entry set into a `TABLES_V7` that additionally declares `schedules`, then add the `manifest_for` arm:

```rust
7 => Some(&SCHEMA_V7),
```

matching the shape of the existing `6 => Some(&SCHEMA_V6)` arm. The `schedules` entry must list every column the migration creates, in the manifest's own column-descriptor shape — `validate_manifest` is what proves it.

Declare the CHECK constraints too, not just the columns: `validate_manifest` compares them against the live schema, so the `start_date` range bound has to appear here exactly as migration 007 writes it. A manifest that lists the column but omits its check is the drift this step exists to prevent — and it is also the reason to keep the migration's bound and the manifest's bound in one edit rather than two.

Then apply the version-literal sweep from the Files block — every class (a) site to `7`, and the
`v007.sqlite` → `v008.sqlite` re-point with its new fixture. Build the fixture with SQLite itself,
so it is a real database rather than a byte copy claiming a version:

```bash
cp src-tauri/tests/fixtures/v007.sqlite src-tauri/tests/fixtures/v008.sqlite
python3 - <<'PY'
import sqlite3
con = sqlite3.connect('src-tauri/tests/fixtures/v008.sqlite')
con.execute("UPDATE app_meta SET value = '8' WHERE key = 'schema_version'")
con.commit()
print(con.execute("SELECT key, value FROM app_meta").fetchall())
con.close()
PY
```

Use `python3`'s stdlib `sqlite3`, not the `sqlite3` CLI: the CLI is **not installed** on the
development machine (checked 2026-10-03), so the shell form fails at the first command. Verify the
fixture reads back `schema_version = '8'` and that `v007.sqlite` still reads `'7'` — they must
differ, or the newer-than-latest fixture is not newer than anything.

Confirm it reads back, and delete nothing: `v007.sqlite` stays in the fixtures directory as the
v7-shaped database, even though its role as the newer-than-latest fixture moves to v008.

- [x] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS — the new migration tests, the v7 manifest, and the pre-existing migration/startup/crash-recovery suites **once the version-literal sweep above is applied**. Those suites do *not* all follow the constant: several hard-code `6`, and two use `v007.sqlite` as the newer-than-latest fixture. Run this before the sweep and you will see exactly those failures — that is the sweep's own red step, and fixing them is part of this task, not a follow-up.

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/database/migrations.rs src-tauri/src/database/manifest.rs \
  src-tauri/tests/migrations.rs src-tauri/tests/crash_recovery.rs src-tauri/tests/startup.rs \
  src-tauri/tests/fixtures/v008.sqlite
git commit -m "$(cat <<'EOF'
feat: add the schedules table as native migration 007 with its manifest

Also sweeps every Rust schema-version literal the bump invalidates: the
"current schema" assertions move to 7, and the newer-than-latest fixture
moves from v007.sqlite to a new v008.sqlite (v007 is current once 7 ships).

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Rust domain — types and `domains/schedules.rs`

**Files:**
- Modify: `src-tauri/src/database/types.rs` (add `ScheduleKind`, `ScheduleFrequency`, `Schedule`, `NewSchedule`, `ScheduleUpdate`)
- Create: `src-tauri/src/database/domains/schedules.rs`
- Modify: `src-tauri/src/database/domains/mod.rs` (`pub mod schedules;` + re-exports)
- Test: `src-tauri/tests/domain_schedules.rs`

**Interfaces:**
- Consumes: `run_idempotent`, `OperationId`, `now_iso_utc`/`today_iso` (`domains/civil_date.rs`), `map_sqlite_error`, the `AccountCreated`-style inner receipt struct from `domains/accounts.rs`.
- Produces (Task 5 wraps each in a command; Task 6 mirrors the shape in TypeScript):
  - `pub fn list_schedules(conn: &Connection) -> DbResult<Vec<Schedule>>` — active + completed + errored, newest first, `deleted_at IS NULL`.
  - `pub fn list_due_schedules(conn: &Connection, today: &str) -> DbResult<Vec<Schedule>>` — `enabled = 1 AND completed = 0 AND errored_at IS NULL AND deleted_at IS NULL AND next_due_date IS NOT NULL AND next_due_date <= today`, ordered by `next_due_date, id`.
  - `pub fn create_schedule(conn: &mut Connection, op_id: OperationId, input: NewSchedule) -> DbResult<String>` — **initializes `next_due_date = start_date`** (Review Focus 1).
  - `pub fn update_schedule(conn: &mut Connection, op_id: OperationId, id: &str, input: ScheduleUpdate) -> DbResult<()>` — sets `updated_at`; **`enabled = 1` clears `errored_at`** (the Resume path).
  - `pub fn delete_schedule(conn: &mut Connection, op_id: OperationId, id: &str) -> DbResult<()>` — soft delete + `updated_at`.
  - `pub fn mark_schedule_posted(conn: &mut Connection, op_id: OperationId, id: &str, last_posted_date: Option<String>, next_due_date: Option<String>, completed: i64) -> DbResult<()>`
  - `pub fn mark_schedule_errored(conn: &mut Connection, op_id: OperationId, id: &str) -> DbResult<()>`

`types.rs` additions:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleKind { Expense, Income, Transfer }

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleFrequency { Weekly, Biweekly, Monthly, Yearly }

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, ts_rs::TS)]
pub struct Schedule {
    pub id: String,
    pub name: String,
    pub kind: ScheduleKind,
    pub amount: i64,
    pub account_id: String,
    pub transfer_account_id: Option<String>,
    pub tag_id: Option<String>,
    pub payee: Option<String>,
    pub description: Option<String>,
    pub frequency: ScheduleFrequency,
    pub start_date: String,
    pub end_date: Option<String>,
    pub posts_transaction: i64,
    pub next_due_date: Option<String>,
    pub last_posted_date: Option<String>,
    pub completed: i64,
    pub enabled: i64,
    pub errored_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, ts_rs::TS)]
pub struct NewSchedule {
    pub name: String,
    pub kind: ScheduleKind,
    pub amount: i64,
    pub account_id: String,
    pub transfer_account_id: Option<String>,
    pub tag_id: Option<String>,
    pub payee: Option<String>,
    pub description: Option<String>,
    pub frequency: ScheduleFrequency,
    pub start_date: String,
    pub end_date: Option<String>,
    pub posts_transaction: i64,
}

/// A full replacement of every field the form can change. A patch type is
/// deliberately avoided: with `Patch<T>`-style omitted/explicit-null triples, a
/// form that submits the whole schedule would have to express "unchanged" for
/// fields it is in fact setting. Everything here is present; `Option` fields
/// mean "clear it" — **except** `next_due_date`, which is the one exception and
/// says so on its own field.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, ts_rs::TS)]
pub struct ScheduleUpdate {
    pub name: String,
    pub kind: ScheduleKind,
    pub amount: i64,
    pub account_id: String,
    pub transfer_account_id: Option<String>,
    pub tag_id: Option<String>,
    pub payee: Option<String>,
    pub description: Option<String>,
    pub frequency: ScheduleFrequency,
    pub start_date: String,
    pub end_date: Option<String>,
    pub posts_transaction: i64,
    pub enabled: i64,
    /// `None` leaves the stored value untouched — the opposite of every other
    /// optional field here, and deliberately so: this column is engine-owned, so
    /// a form must not be able to blank it by omitting a field. Callers that
    /// re-enable a disabled schedule pass `firstDueOnOrAfter(...)` so the
    /// disabled period is not retroactively posted (Task 10); callers resuming a
    /// parked schedule pass `None` so its backlog drains. `mark_schedule_posted`
    /// is the only other writer of this column.
    pub next_due_date: Option<String>,
}
```

- [x] **Step 1: Write the failing tests**

Create `src-tauri/tests/domain_schedules.rs`. Copy the connection/fixture scaffolding of `src-tauri/tests/domain_accounts_transactions.rs` (its `mod common;` usage and its `use common::{…}` line) rather than inventing a new harness:

```rust
//! Domain tests for scheduled transactions (Task 4).
use notchy_lib::database::domains::schedules::{
    create_schedule, delete_schedule, list_due_schedules, list_schedules, mark_schedule_errored,
    mark_schedule_posted, update_schedule,
};
use notchy_lib::database::types::{NewSchedule, ScheduleFrequency, ScheduleKind, ScheduleUpdate};
use notchy_lib::database::OperationId;

#[test]
fn create_initializes_next_due_date_from_start_date() {
    let (mut conn, account_id) = fixture_conn_with_account();
    let input = NewSchedule {
        name: "Rent".into(),
        kind: ScheduleKind::Expense,
        amount: 5_000_000,
        account_id,
        transfer_account_id: None,
        tag_id: None,
        payee: Some("Landlord".into()),
        description: None,
        frequency: ScheduleFrequency::Monthly,
        start_date: "2026-01-31".into(),
        end_date: None,
        posts_transaction: 1,
    };
    let id = create_schedule(&mut conn, OperationId::generate(), input).unwrap();
    let schedule = list_schedules(&conn).unwrap();
    let row = schedule.iter().find(|s| s.id == id).unwrap();
    // Review Focus 1: a NULL next_due_date would be skipped forever.
    assert_eq!(row.next_due_date.as_deref(), Some("2026-01-31"));
    assert_eq!(row.completed, 0);
    assert_eq!(row.errored_at, None);
}

#[test]
fn creating_the_same_request_twice_returns_the_same_schedule() {
    // run_idempotent: one OperationId, one row, no duplicate on retry.
    let (mut conn, account_id) = fixture_conn_with_account();
    let op_id = OperationId::generate();
    let input = NewSchedule { name: "Rent".into(), kind: ScheduleKind::Expense, amount: 5_000_000,
        account_id, transfer_account_id: None, tag_id: None, payee: None, description: None,
        frequency: ScheduleFrequency::Monthly, start_date: "2026-01-31".into(),
        end_date: None, posts_transaction: 1 };

    let first = create_schedule(&mut conn, op_id.clone(), input.clone()).unwrap();
    let second = create_schedule(&mut conn, op_id.clone(), input).unwrap();

    assert_eq!(first, second);
    assert_eq!(list_schedules(&conn).unwrap().len(), 1);
}

#[test]
fn list_due_excludes_null_disabled_completed_errored_and_future() {
    // Review Focus 1: the NULL case is named in the title on purpose. A schedule
    // with no due date must be invisible to this query but still present in
    // list_schedules — the engine re-anchors it rather than the query hiding it
    // from the user forever.
    let (mut conn, account_id) = fixture_conn_with_account();
    let mut make = |name: &str, start: &str| {
        create_schedule(&mut conn, OperationId::generate(), NewSchedule {
            name: name.into(), kind: ScheduleKind::Expense, amount: 100, account_id: account_id.clone(),
            transfer_account_id: None, tag_id: None, payee: None, description: None,
            frequency: ScheduleFrequency::Monthly, start_date: start.into(),
            end_date: None, posts_transaction: 1,
        }).unwrap()
    };
    let due = make("Due", "2026-01-01");
    let null_date = make("Null", "2026-01-01");
    let disabled = make("Disabled", "2026-01-01");
    let completed = make("Completed", "2026-01-01");
    let errored = make("Errored", "2026-01-01");
    let future = make("Future", "2027-01-01");

    conn.execute("UPDATE schedules SET next_due_date = NULL WHERE id = ?1", [&null_date]).unwrap();
    conn.execute("UPDATE schedules SET enabled = 0 WHERE id = ?1", [&disabled]).unwrap();
    conn.execute("UPDATE schedules SET completed = 1 WHERE id = ?1", [&completed]).unwrap();
    conn.execute("UPDATE schedules SET errored_at = '2026-01-02T00:00:00Z' WHERE id = ?1", [&errored]).unwrap();

    let returned: Vec<String> = list_due_schedules(&conn, "2026-01-10").unwrap()
        .into_iter().map(|s| s.id).collect();

    assert_eq!(returned, vec![due]);
    // The NULL row is only skipped by this query, never hidden from the user.
    assert!(list_schedules(&conn).unwrap().iter().any(|s| s.id == null_date));
    assert!(!returned.contains(&future));
}

#[test]
fn mark_posted_advances_the_dates_and_can_complete() {
    let (mut conn, account_id) = fixture_conn_with_account();
    let id = create_schedule(&mut conn, OperationId::generate(), schedule("Rent", account_id)).unwrap();

    mark_schedule_posted(&mut conn, OperationId::generate(), &id,
        Some("2026-01-31".into()), Some("2026-02-28".into()), 1).unwrap();

    let row = list_schedules(&conn).unwrap().into_iter().find(|s| s.id == id).unwrap();
    assert_eq!(row.last_posted_date.as_deref(), Some("2026-01-31"));
    assert_eq!(row.next_due_date.as_deref(), Some("2026-02-28"));
    assert_eq!(row.completed, 1);
}

#[test]
fn mark_posted_is_a_no_op_for_an_unknown_id() {
    // A schedule deleted mid-pass must not fail the boot of every other one.
    let (mut conn, _) = fixture_conn_with_account();
    mark_schedule_posted(&mut conn, OperationId::generate(), "missing", None, None, 0).unwrap();
}

#[test]
fn mark_errored_parks_a_schedule_and_re_enabling_resumes_it() {
    // errored_at is set; list_due skips it; update_schedule enabling it again
    // clears errored_at so the schedule becomes due again. Passes
    // next_due_date: None, so the stored date is untouched — a parked backlog
    // must survive Resume.
    let (mut conn, account_id) = fixture_conn_with_account();
    let id = create_schedule(&mut conn, OperationId::generate(), schedule("Rent", account_id)).unwrap();

    mark_schedule_errored(&mut conn, OperationId::generate(), &id).unwrap();
    assert!(list_due_schedules(&conn, "2026-06-01").unwrap().is_empty());

    let resume = update_of(&conn, &id, 1, None);
    update_schedule(&mut conn, OperationId::generate(), &id, resume).unwrap();

    let row = list_schedules(&conn).unwrap().into_iter().find(|s| s.id == id).unwrap();
    assert_eq!(row.errored_at, None);
    assert_eq!(row.next_due_date.as_deref(), Some("2026-01-31"));
    assert_eq!(list_due_schedules(&conn, "2026-06-01").unwrap().len(), 1);
}

#[test]
fn update_sets_next_due_date_when_the_caller_supplies_one() {
    // This is the one field where None means "unchanged" rather than "clear", so
    // it gets its own test in both directions.
    let (mut conn, account_id) = fixture_conn_with_account();
    let id = create_schedule(&mut conn, OperationId::generate(), schedule("Rent", account_id)).unwrap();

    let input = update_of(&conn, &id, 0, Some("2026-06-28".into()));
    update_schedule(&mut conn, OperationId::generate(), &id, input).unwrap();
    let row = list_schedules(&conn).unwrap().into_iter().find(|s| s.id == id).unwrap();
    assert_eq!(row.next_due_date.as_deref(), Some("2026-06-28"));

    let input = update_of(&conn, &id, 0, None);
    update_schedule(&mut conn, OperationId::generate(), &id, input).unwrap();
    let row = list_schedules(&conn).unwrap().into_iter().find(|s| s.id == id).unwrap();
    assert_eq!(row.next_due_date.as_deref(), Some("2026-06-28"), "None must not clear the date");
}

#[test]
fn delete_soft_deletes_and_hides_from_list() {
    let (mut conn, account_id) = fixture_conn_with_account();
    let id = create_schedule(&mut conn, OperationId::generate(), schedule("Rent", account_id)).unwrap();

    delete_schedule(&mut conn, OperationId::generate(), &id).unwrap();

    assert!(list_schedules(&conn).unwrap().is_empty());
    let deleted_at: Option<String> = conn
        .query_row("SELECT deleted_at FROM schedules WHERE id = ?1", [&id], |row| row.get(0))
        .unwrap();
    assert!(deleted_at.is_some(), "soft delete, not a hard DELETE");
}

#[test]
fn create_rejects_a_transfer_without_a_destination() {
    // The DB CHECK is the authority; the domain must not paper over it.
    let (mut conn, account_id) = fixture_conn_with_account();
    let result = create_schedule(&mut conn, OperationId::generate(), NewSchedule {
        name: "Savings".into(), kind: ScheduleKind::Transfer, amount: 1_000_000,
        account_id, transfer_account_id: None, tag_id: None, payee: None, description: None,
        frequency: ScheduleFrequency::Monthly, start_date: "2026-01-01".into(),
        end_date: None, posts_transaction: 1,
    });
    assert!(result.is_err());
}
```

Two local helpers the bodies above call — define them once at the top of the file, next to the fixture:

- `schedule(name: &str, account_id: String) -> NewSchedule` — the monthly-expense baseline the tests vary.
- `update_of(conn: &Connection, id: &str, enabled: i64, next_due_date: Option<String>) -> ScheduleUpdate` — reads the stored row and projects it into a `ScheduleUpdate` with the full field set `ScheduleUpdate` requires, overriding only `enabled` and `next_due_date`. This mirrors the store's `toUpdateFields` (Task 10) and is why the "full replacement, not a patch" choice in Task 4 needs no `Patch<T>` triples. Its body:

```rust
fn update_of(
    conn: &Connection,
    id: &str,
    enabled: i64,
    next_due_date: Option<String>,
) -> ScheduleUpdate {
    let stored = list_schedules(conn)
        .unwrap()
        .into_iter()
        .find(|s| s.id == id)
        .expect("schedule exists");
    ScheduleUpdate {
        name: stored.name,
        kind: stored.kind,
        amount: stored.amount,
        account_id: stored.account_id,
        transfer_account_id: stored.transfer_account_id,
        tag_id: stored.tag_id,
        payee: stored.payee,
        description: stored.description,
        frequency: stored.frequency,
        start_date: stored.start_date,
        end_date: stored.end_date,
        posts_transaction: stored.posts_transaction,
        enabled,
        next_due_date,
    }
}
```

**Call it on its own line, never nested inside the `update_schedule` call.** `update_schedule` takes `&mut conn` and `update_of` takes `&conn`; writing `update_schedule(&mut conn, op, &id, update_of(&conn, &id, 1, None))` borrows `conn` mutably and immutably in one expression and does not compile. Bind it first:

```rust
let input = update_of(&conn, &id, 1, None);
update_schedule(&mut conn, OperationId::generate(), &id, input).unwrap();
```

And `fixture_conn_with_account()`: do **not** invent a harness. Copy the existing one from
`src-tauri/tests/domain_accounts_transactions.rs`, which already has exactly the two pieces this
file needs — its `fresh_db` (`:34-38`) and its `op()` (`:41-43`) / `default_account` (`:45`):

```rust
/// A migrated database opened **read-write**, with one account row already inserted.
fn fixture_conn_with_account() -> (Connection, String) {
    let mut db = fresh_db("schedules");          // domain_accounts_transactions.rs:34
    let account_id = accounts::create_account(&mut db, op(), default_account("Main")).unwrap();
    (db, account_id)
}
```

Bring `fresh_db`, `op`, and `default_account` across verbatim rather than re-deriving them. Note
`fresh_db` opens `SQLITE_OPEN_READ_WRITE` — every test in this task inserts rows, so a read-only
connection would make all of them fail for a reason unrelated to what they assert. If that file uses
a shared `mod common`, use the same one instead of copying.

Fill each body with the concrete arrangement its title names — one inserted row per exclusion reason is the point of the `list_due` test, and the assertions must name which row survived and why.

- [x] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_schedules`
Expected: FAIL — `unresolved import notchy_lib::database::domains::schedules`.

- [x] **Step 3: Implement the domain**

`src-tauri/src/database/domains/schedules.rs`. Follow `domains/accounts.rs` exactly: `row_to_schedule(&Row) -> DbResult<Schedule>` with the `kind`/`frequency` string→enum mapping in the `match` style accounts.rs uses for `AccountType`, read functions querying directly, and mutations wrapped in `run_idempotent` with an inner receipt struct:

```rust
#[derive(serde::Serialize, serde::Deserialize)]
struct ScheduleCreated { schedule_id: String }
```

`run_idempotent(conn, op_id, "schedule_create", &input, |tx| { …; Ok(ScheduleCreated { schedule_id: id }) })` returns the serialized receipt so a retried request replays the same id — the closure itself must return `DbResult<ScheduleCreated>`, so it ends in `Ok(…)` rather than the bare receipt. `update_schedule` binds the full `ScheduleUpdate` plus `updated_at = now_iso_utc()` and writes:

```sql
UPDATE schedules
   SET name = ?1, kind = ?2, amount = ?3, account_id = ?4,
       transfer_account_id = ?5, tag_id = ?6, payee = ?7, description = ?8,
       frequency = ?9, start_date = ?10, end_date = ?11,
       posts_transaction = ?12, enabled = ?13,
       errored_at = CASE WHEN ?13 = 1 THEN NULL ELSE errored_at END,
       next_due_date = COALESCE(?14, next_due_date),
       updated_at = ?15
 WHERE id = ?16 AND deleted_at IS NULL
```

`enabled = 1` clears `errored_at` (the Resume path) but leaves `next_due_date` to the caller's `?14` — which is how one statement serves both re-enable cases without Rust learning any date arithmetic: pass a re-anchored date to skip a disabled period, pass `None` to resume a parked backlog.

and rejects an id that matched no row with the existing not-found code (`ErrorCode::InvalidInput` in this codebase's vocabulary for a bad id, matching what `update_account` does — read it and copy its choice rather than guessing).

`mark_schedule_posted` is a plain `UPDATE` of `last_posted_date`, `next_due_date`, `completed`, `updated_at`; `mark_schedule_errored` sets `errored_at = now_iso_utc(), updated_at = now_iso_utc()`. Both go through `run_idempotent` so a retried boot cannot double-advance a schedule.

Add to `domains/mod.rs`:

```rust
pub mod schedules;
pub use schedules::{
    create_schedule, delete_schedule, list_due_schedules, list_schedules, mark_schedule_errored,
    mark_schedule_posted, update_schedule,
};
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS, and `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` clean.

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/database/types.rs src-tauri/src/database/domains/schedules.rs src-tauri/src/database/domains/mod.rs src-tauri/tests/domain_schedules.rs
git commit -m "$(cat <<'EOF'
feat: add the native schedules domain with idempotent CRUD and posting marks

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Tauri commands and regenerated contracts

**Files:**
- Modify: `src-tauri/src/database/commands.rs` (seven commands; extend `generate_bindings`)
- Modify: `src-tauri/src/lib.rs` (register the seven in `tauri::generate_handler![…]`)
- Modify: `src/lib/native/contracts.generated.ts` (regenerated, never hand-edited)
- Test: `src-tauri/tests/command_guards.rs` (extend: the new commands are data jobs)

**Interfaces:**
- Consumes: Task 4's domain functions; the `OperationId::generate()` + `manager.data_job(…)` pattern from `account_create`.
- Produces the seven commands Task 6 bridges from TypeScript: `schedule_list`, `schedule_create(input)`, `schedule_update(id, input)`, `schedule_delete(id)`, `schedule_list_due(today)`, `schedule_mark_posted(id, last_posted_date, next_due_date, completed)`, `schedule_mark_errored(id)`.

- [ ] **Step 1: Write the failing test**

`generate_bindings` is a hand-maintained list, so the failing test is the binding check itself. Add to `src-tauri/tests/contracts.rs` (which already asserts the generated string):

```rust
#[test]
fn bindings_declare_the_schedule_contracts() {
    let generated = notchy_lib::database::generate_bindings();
    for expected in [
        "export type ScheduleKind =",
        "export type ScheduleFrequency =",
        "export type Schedule = {",
        "export type NewSchedule = {",
        "export type ScheduleUpdate = {",
    ] {
        assert!(generated.contains(expected), "missing from bindings: {expected}");
    }
}
```

And extend `src-tauri/tests/command_guards.rs`'s not-ready test so the new writes are covered by the same gate as every other data job:

```rust
#[tokio::test]
async fn schedule_writes_reject_when_not_ready() {
    let manager = manager_fresh().await; // not initialized → not Ready
    let app = mock_app(Arc::clone(&manager));
    let state = app.app.state::<Arc<DatabaseManager>>();
    let error = schedule_create(
        state,
        NewSchedule { name: "Rent".into(), kind: ScheduleKind::Expense, amount: 100,
            account_id: "acct".into(), transfer_account_id: None, tag_id: None,
            payee: None, description: None, frequency: ScheduleFrequency::Monthly,
            start_date: "2026-01-01".into(), end_date: None, posts_transaction: 1 },
    )
    .await
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::DatabaseNotReady);
}
```

Use the exact `ErrorCode` variant name `command_guards.rs` already asserts elsewhere — read it rather than trusting this snippet's spelling.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: FAIL — `cannot find function schedule_create`; the bindings test fails on the first missing type.

- [ ] **Step 3: Write the commands, register them, regenerate**

In `commands.rs`, following `account_create`'s shape:

```rust
#[tauri::command]
pub async fn schedule_list(
    manager: State<'_, Arc<DatabaseManager>>,
) -> Result<Vec<Schedule>, DbError> {
    manager.data_job(|state| domains::schedules::list_schedules(state.connection()?)).await
}

#[tauri::command]
pub async fn schedule_list_due(
    manager: State<'_, Arc<DatabaseManager>>,
    today: String,
) -> Result<Vec<Schedule>, DbError> {
    manager.data_job(move |state| {
        domains::schedules::list_due_schedules(state.connection()?, &today)
    })
    .await
}

#[tauri::command]
pub async fn schedule_create(
    manager: State<'_, Arc<DatabaseManager>>,
    input: NewSchedule,
) -> Result<String, DbError> {
    let op_id = OperationId::generate();
    manager
        .data_job(move |state| domains::schedules::create_schedule(state.connection_mut()?, op_id, input))
        .await
}

#[tauri::command]
pub async fn schedule_update(
    manager: State<'_, Arc<DatabaseManager>>,
    id: String,
    input: ScheduleUpdate,
) -> Result<(), DbError> {
    let op_id = OperationId::generate();
    manager
        .data_job(move |state| {
            domains::schedules::update_schedule(state.connection_mut()?, op_id, &id, input)
        })
        .await
}

#[tauri::command]
pub async fn schedule_delete(
    manager: State<'_, Arc<DatabaseManager>>,
    id: String,
) -> Result<(), DbError> {
    let op_id = OperationId::generate();
    manager
        .data_job(move |state| domains::schedules::delete_schedule(state.connection_mut()?, op_id, &id))
        .await
}

#[tauri::command]
pub async fn schedule_mark_posted(
    manager: State<'_, Arc<DatabaseManager>>,
    id: String,
    last_posted_date: Option<String>,
    next_due_date: Option<String>,
    completed: i64,
) -> Result<(), DbError> {
    let op_id = OperationId::generate();
    manager
        .data_job(move |state| {
            domains::schedules::mark_schedule_posted(
                state.connection_mut()?, op_id, &id, last_posted_date, next_due_date, completed,
            )
        })
        .await
}

#[tauri::command]
pub async fn schedule_mark_errored(
    manager: State<'_, Arc<DatabaseManager>>,
    id: String,
) -> Result<(), DbError> {
    let op_id = OperationId::generate();
    manager
        .data_job(move |state| domains::schedules::mark_schedule_errored(state.connection_mut()?, op_id, &id))
        .await
}
```

In `lib.rs`, add a `// Schedule commands` block to `generate_handler!` with all seven. In `generate_bindings`, add to the tail of the type list:

```rust
push_decl(&mut out, ScheduleKind::decl(&cfg));
push_decl(&mut out, ScheduleFrequency::decl(&cfg));
push_decl(&mut out, Schedule::decl(&cfg));
push_decl(&mut out, NewSchedule::decl(&cfg));
push_decl(&mut out, ScheduleUpdate::decl(&cfg));
```

Then regenerate:

```bash
pnpm generate:db-contracts
pnpm check:db-contracts
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml && pnpm check:db-contracts`
Expected: PASS — bindings contain the five types, and the committed file matches the generator.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/database/commands.rs src-tauri/src/lib.rs src-tauri/tests/contracts.rs src-tauri/tests/command_guards.rs src/lib/native/contracts.generated.ts
git commit -m "$(cat <<'EOF'
feat: expose schedule commands and regenerate the native contracts

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `ScheduleOps` on the port, and the native adapter

**Files:**
- Modify: `src/lib/db/client.ts` (schedule types, `ScheduleOps`, add `schedules` to `AppDatabase`)
- Create: `src/lib/db/native/schedules.ts` (`NativeScheduleOps`)
- Modify: `src/lib/db/native/client.ts` (construct + expose `schedules`)
- Modify: `src/tests/unit/native-boundary.test.ts` (seven `FIXTURES` entries + arg-key assertions)
- Test: `src/tests/unit/native-boundary.test.ts`

**Interfaces:**
- Consumes: Task 5's commands and generated contracts.
- Produces the interface Task 7 (browser adapter), Task 8 (engine) and Task 10 (UI) all code against. Exact shape:

```ts
export type ScheduleKind = 'expense' | 'income' | 'transfer';
export type ScheduleFrequency = 'weekly' | 'biweekly' | 'monthly' | 'yearly';

export interface Schedule { id: string; name: string; kind: ScheduleKind; amount: number;
	account_id: string; transfer_account_id: string | null; tag_id: string | null;
	payee: string | null; description: string | null; frequency: ScheduleFrequency;
	start_date: string; end_date: string | null; posts_transaction: number;
	next_due_date: string | null; last_posted_date: string | null; completed: number;
	enabled: number; errored_at: string | null; created_at: string; updated_at: string; }

export interface NewSchedule { name: string; kind: ScheduleKind; amount: number;
	account_id: string; transfer_account_id?: string | null; tag_id?: string | null;
	payee?: string | null; description?: string | null;
	frequency: ScheduleFrequency; start_date: string; end_date?: string | null;
	posts_transaction?: number; }

export interface ScheduleUpdate { name: string; kind: ScheduleKind; amount: number;
	account_id: string; transfer_account_id: string | null; tag_id: string | null;
	payee: string | null; description: string | null; frequency: ScheduleFrequency;
	start_date: string; end_date: string | null; posts_transaction: number; enabled: number;
	/** `null` leaves the stored due date untouched — the one field where a null
	 *  does not mean "clear". See `ScheduleUpdate` in the Rust types (Task 4) and
	 *  `firstDueOnOrAfter` (Task 1). */
	next_due_date: string | null; }

export interface ScheduleOps {
	list(): Promise<Schedule[]>;
	create(input: NewSchedule): Promise<string>;
	update(id: string, input: ScheduleUpdate): Promise<void>;
	remove(id: string): Promise<void>;
	/** Active schedules whose `next_due_date` is on or before `today`, oldest first. */
	listDue(today: string): Promise<Schedule[]>;
	markPosted(id: string, lastPostedDate: string | null, nextDueDate: string | null, completed: number): Promise<void>;
	markErrored(id: string): Promise<void>;
}
```

- [ ] **Step 1: Write the failing test**

In `src/tests/unit/native-boundary.test.ts`, add to `FIXTURES` (the mock throws on an unlisted command, so this is what makes the sweep real):

```ts
	// Schedules
	schedule_list: [{ id: 'sch1', name: 'Rent', kind: 'expense', amount: 5000000,
		account_id: 'acct1', transfer_account_id: null, tag_id: null, payee: 'Landlord',
		description: null, frequency: 'monthly', start_date: '2026-01-31', end_date: null,
		posts_transaction: 1, next_due_date: '2026-01-31', last_posted_date: null,
		completed: 0, enabled: 1, errored_at: null, created_at: 'x', updated_at: 'x' }],
	schedule_create: 'sch1',
	schedule_update: null,
	schedule_delete: null,
	schedule_list_due: [],
	schedule_mark_posted: null,
	schedule_mark_errored: null,
```

and in the arg-key assertions section:

```ts
	it('schedule_create forwards the input object unchanged', async () => {
		await client.schedules.create({
			name: 'Rent', kind: 'expense', amount: 5000000, account_id: 'acct1',
			frequency: 'monthly', start_date: '2026-01-31',
		});
		expect(lastCall().args).toEqual({
			input: { name: 'Rent', kind: 'expense', amount: 5000000, account_id: 'acct1',
				frequency: 'monthly', start_date: '2026-01-31' },
		});
	});

	it('schedule_mark_posted uses camelCase argument keys', async () => {
		await client.schedules.markPosted('sch1', '2026-01-31', '2026-02-28', 0);
		expect(lastCall().args).toEqual({
			id: 'sch1', lastPostedDate: '2026-01-31', nextDueDate: '2026-02-28', completed: 0,
		});
	});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/tests/unit/native-boundary.test.ts`
Expected: FAIL — `client.schedules is not a function` / `Property 'schedules' does not exist`.

- [ ] **Step 3: Add the port types and the native adapter**

Add the types and `ScheduleOps` to `src/lib/db/client.ts` as written in Interfaces above, plus `readonly schedules: ScheduleOps;` on `AppDatabase`. Re-export the schedule types from the same barrel style the file already uses for `AccountType`/`TransactionKind`.

`src/lib/db/native/schedules.ts` — bare `invoke()` bridges, no `isTauri()` guard, for the reason `NativeBackupOps` documents (the client is only constructed under Tauri, and a guard would put `db/index → native/client → native/schedules → db/index` on the runtime graph):

```ts
import { invoke } from '@tauri-apps/api/core';
import type { ScheduleOps, Schedule, NewSchedule, ScheduleUpdate } from '../client';

export class NativeScheduleOps implements ScheduleOps {
	list(): Promise<Schedule[]> {
		return invoke<Schedule[]>('schedule_list');
	}

	create(input: NewSchedule): Promise<string> {
		return invoke<string>('schedule_create', { input });
	}

	update(id: string, input: ScheduleUpdate): Promise<void> {
		return invoke<void>('schedule_update', { id, input });
	}

	remove(id: string): Promise<void> {
		return invoke<void>('schedule_delete', { id });
	}

	listDue(today: string): Promise<Schedule[]> {
		return invoke<Schedule[]>('schedule_list_due', { today });
	}

	markPosted(id: string, lastPostedDate: string | null, nextDueDate: string | null, completed: number): Promise<void> {
		return invoke<void>('schedule_mark_posted', { id, lastPostedDate, nextDueDate, completed });
	}

	markErrored(id: string): Promise<void> {
		return invoke<void>('schedule_mark_errored', { id });
	}
}
```

Wire it in `src/lib/db/native/client.ts`: import, `readonly schedules: ScheduleOps;`, and `this.schedules = new NativeScheduleOps();` beside the other ops.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/tests/unit/native-boundary.test.ts`
Expected: PASS — every `invoke()` site resolves to a registered command, and the camelCase keys match the parsed Rust signatures.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/client.ts src/lib/db/native/schedules.ts src/lib/db/native/client.ts src/tests/unit/native-boundary.test.ts
git commit -m "$(cat <<'EOF'
feat: add ScheduleOps to the domain port with the native adapter

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Browser adapter — the repo, the ops class, and the wiring

Playwright E2E and the unit tests drive this adapter, so it is the one that decides whether the engine is testable without a package build.

**Files:**
- Create: `src/lib/db/browser/repos/schedules.ts`
- Create: `src/lib/db/browser/schedules.ts` (`BrowserScheduleOps`)
- Create: `src/lib/db/repos/schedules.ts` (forwarder)
- Modify: `src/lib/db/browser/client.ts` (construct + expose `schedules`)
- Test: `src/tests/unit/repos/schedules.test.ts`

**Interfaces:**
- Consumes: `DatabaseService` (`execute`/`query`/`transaction`), `ScheduleOps` + types from `../client`, the repo-per-domain pattern of `browser/repos/accounts.ts` (`AppError` for domain rejections).
- Produces: `BrowserScheduleOps` implementing `ScheduleOps` exactly as Task 6 defines it, plus repo functions `listSchedules(db)`, `createSchedule(db, input)`, `updateSchedule(db, id, input)`, `deleteSchedule(db, id)`, `listDueSchedules(db, today)`, `markSchedulePosted(db, …)`, `markScheduleErrored(db, id)`.

- [ ] **Step 1: Write the failing tests**

`src/tests/unit/repos/schedules.test.ts`, following `src/tests/unit/repos/categories.test.ts`'s setup exactly (`createTestDb()` + `runMigrations(db, migrations)` in `beforeEach`), plus the FK pragma the production adapters set:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import * as scheduleRepo from '$lib/db/repos/schedules';
import type { DatabaseService } from '$lib/db';

let db: DatabaseService;

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
	// Both production adapters enable this (browser/pragmas.ts, connection.rs);
	// test-db does not, and the deleted-account case depends on it.
	await db.execute('PRAGMA foreign_keys = ON');
	await db.execute(
		`INSERT INTO accounts (id, name, type, currency, archived, created_at, updated_at)
		 VALUES ('acct1', 'Cash', 'cash', 'VND', 0, 'x', 'x')`
	);
});

describe('createSchedule', () => {
	it('initializes next_due_date from start_date', async () => {
		const id = await scheduleRepo.createSchedule(db, {
			name: 'Rent', kind: 'expense', amount: 5_000_000, account_id: 'acct1',
			frequency: 'monthly', start_date: '2026-01-31',
		});
		const [row] = (await scheduleRepo.listSchedules(db)).filter((s) => s.id === id);
		expect(row.next_due_date).toBe('2026-01-31');
		expect(row.completed).toBe(0);
		expect(row.errored_at).toBeNull();
	});

	it('rejects a transfer without a destination account', async () => {
		await expect(
			scheduleRepo.createSchedule(db, {
				name: 'Savings', kind: 'transfer', amount: 1_000_000, account_id: 'acct1',
				frequency: 'monthly', start_date: '2026-01-01',
			})
		).rejects.toThrow();
	});
});

describe('listDueSchedules', () => {
	it('excludes a NULL next_due_date, a disabled, a completed, an errored, and a future schedule', async () => {
		const due = await scheduleRepo.createSchedule(db, {
			name: 'Due', kind: 'expense', amount: 1, account_id: 'acct1',
			frequency: 'weekly', start_date: '2026-01-01',
		});
		const nullDate = await scheduleRepo.createSchedule(db, {
			name: 'Null', kind: 'expense', amount: 1, account_id: 'acct1',
			frequency: 'weekly', start_date: '2026-01-01',
		});
		await db.execute(`UPDATE schedules SET next_due_date = NULL WHERE id = ?`, [nullDate]);
		const rows = await scheduleRepo.listDueSchedules(db, '2026-01-10');
		expect(rows.map((s) => s.id)).toEqual([due]);
	});
});

describe('updateSchedule', () => {
	it('clears errored_at when the schedule is re-enabled', async () => {
		const id = await scheduleRepo.createSchedule(db, {
			name: 'Rent', kind: 'expense', amount: 1, account_id: 'acct1',
			frequency: 'monthly', start_date: '2026-01-01',
		});
		await scheduleRepo.markScheduleErrored(db, id);
		expect((await scheduleRepo.listSchedules(db)).find((s) => s.id === id)!.errored_at).not.toBeNull();
		const row = (await scheduleRepo.listSchedules(db)).find((s) => s.id === id)!;
		await scheduleRepo.updateSchedule(db, id, {
			name: row.name, kind: row.kind, amount: row.amount, account_id: row.account_id,
			transfer_account_id: null, tag_id: null, payee: null, description: null,
			frequency: row.frequency, start_date: row.start_date, end_date: null,
			posts_transaction: 1, enabled: 1, next_due_date: null,
		});
		expect((await scheduleRepo.listSchedules(db)).find((s) => s.id === id)!.errored_at).toBeNull();
	});

	it('re-anchors the due date when the caller supplies one, and keeps it when it does not', async () => {
		// The disabled → re-enabled path supplies a re-anchored date; a parked
		// schedule's Resume passes null. Both go through the same statement.
	});
});

describe('markSchedulePosted', () => {
	it('advances the dates and records completion', async () => {
		const id = await scheduleRepo.createSchedule(db, {
			name: 'Rent', kind: 'expense', amount: 1, account_id: 'acct1',
			frequency: 'monthly', start_date: '2026-01-31',
		});

		await scheduleRepo.markSchedulePosted(db, id, '2026-01-31', '2026-02-28', 1);

		const row = (await scheduleRepo.listSchedules(db)).find((s) => s.id === id)!;
		expect(row.last_posted_date).toBe('2026-01-31');
		expect(row.next_due_date).toBe('2026-02-28');
		expect(row.completed).toBe(1);
	});

	it('is a no-op for an unknown id rather than throwing', async () => {
		// The engine may mark a schedule the user deleted mid-pass; that must not
		// turn into a boot error for every other schedule in the queue.
		await expect(
			scheduleRepo.markSchedulePosted(db, 'does-not-exist', null, null, 0)
		).resolves.toBeUndefined();
	});
});

describe('deleteSchedule', () => {
	it('soft-deletes so the row disappears from list but not from the table', async () => {
		const id = await scheduleRepo.createSchedule(db, {
			name: 'Rent', kind: 'expense', amount: 1, account_id: 'acct1',
			frequency: 'monthly', start_date: '2026-01-01',
		});

		await scheduleRepo.deleteSchedule(db, id);

		expect((await scheduleRepo.listSchedules(db)).map((s) => s.id)).not.toContain(id);
		// Soft, not hard: a posted history keeps its parent row, and the deletion
		// survives a backup/restore round-trip like every other table's.
		const rows = await db.query<{ deleted_at: string | null }>(
			'SELECT deleted_at FROM schedules WHERE id = ?',
			[id]
		);
		expect(rows[0].deleted_at).not.toBeNull();
	});
});
```

Fill the empty bodies with the concrete arrangement their titles name.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/tests/unit/repos/schedules.test.ts`
Expected: FAIL — `Failed to resolve import "$lib/db/repos/schedules"`.

- [ ] **Step 3: Implement the repo, the ops class, and the wiring**

`src/lib/db/browser/repos/schedules.ts`: a `row_to_schedule` mapper (snake_case columns straight through; the row shape already matches `Schedule`), a shared `mutableColumnsFrom(input)` helper, and:

- `createSchedule(db, input)` — generates a ULID via `$lib/utils/id`, inserts with `next_due_date = start_date`, `last_posted_date = NULL`, `completed = 0`, `enabled = 1`, `errored_at = NULL`, `created_at = updated_at = now`. Returns the id. Wrap the insert in `db.transaction` so a future change cannot leave a half-row.
- `listSchedules(db)` — `SELECT … WHERE deleted_at IS NULL ORDER BY next_due_date IS NULL, next_due_date, created_at`.
- `listDueSchedules(db, today)` — the filter from Task 4's `list_due_schedules`, same predicate, ordered by `next_due_date, id`.
- `updateSchedule(db, id, input)` — the `CASE WHEN ? = 1 THEN NULL ELSE errored_at END` and `next_due_date = COALESCE(?, next_due_date)` tricks from Task 4; sets `updated_at`. Identical semantics on both adapters, so a schedule behaves the same whether the user is on the desktop build or the web build — the browser adapter is what E2E exercises.
- `markSchedulePosted` / `markScheduleErrored` / `deleteSchedule` — single `UPDATE`s, `updated_at` refreshed.

`src/lib/db/browser/schedules.ts`:

```ts
export class BrowserScheduleOps implements ScheduleOps {
	constructor(private db: DatabaseService) {}
	list() { return listSchedules(this.db); }
	create(input: NewSchedule) { return createSchedule(this.db, input); }
	update(id: string, input: ScheduleUpdate) { return updateSchedule(this.db, id, input); }
	remove(id: string) { return deleteSchedule(this.db, id); }
	listDue(today: string) { return listDueSchedules(this.db, today); }
	markPosted(id: string, lastPostedDate: string | null, nextDueDate: string | null, completed: number) {
		return markSchedulePosted(this.db, id, lastPostedDate, nextDueDate, completed);
	}
	markErrored(id: string) { return markScheduleErrored(this.db, id); }
}
```

`src/lib/db/repos/schedules.ts` forwarder, in the house style:

```ts
// Forwarder — canonical implementation moved to browser/repos/schedules.ts
export {
	createSchedule,
	deleteSchedule,
	listDueSchedules,
	listSchedules,
	markScheduleErrored,
	markSchedulePosted,
	updateSchedule,
} from '../browser/repos/schedules';
```

Wire `readonly schedules: ScheduleOps;` and `this.schedules = new BrowserScheduleOps(db);` into `BrowserDatabaseClient`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/browser/repos/schedules.ts src/lib/db/browser/schedules.ts src/lib/db/repos/schedules.ts src/lib/db/browser/client.ts src/tests/unit/repos/schedules.test.ts
git commit -m "$(cat <<'EOF'
feat: add the browser schedules repo and adapter for ScheduleOps

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: The posting engine

The heart of the feature, and the five Review Focus lines that are not about NULLs on the schema. It consumes only the port, so it runs identically on both adapters.

**Files:**
- Create: `src/lib/logic/post-due-schedules.ts`
- Test: `src/tests/unit/schedules/post-due-schedules.test.ts`

**Interfaces:**
- Consumes: `AppDatabase` (`db.schedules`, `db.transactions`), `nextDueDate` + `ScheduleFrequency` from Task 1, `BrowserDatabaseClient` in tests.
- Produces: `postDueSchedules(db, today)` and `postDueSchedulesOnce(db, today)`; `CATCH_UP_CAP`; `PostDueSummary`. Task 10 consumes `postDueSchedulesOnce` and `PostDueSummary`.

```ts
export const CATCH_UP_CAP = 24;

export interface PostDueSummary {
	/** How many schedules were due when the pass started. */
	due: number;
	/** How many transactions were written. */
	posted: number;
	/** How many schedules advanced their dates (capped ones did not). */
	advanced: number;
	/** Names of reminder-only schedules that were due — one entry per schedule. */
	notices: string[];
	/** Schedules that could not post and are now parked. */
	errors: { id: string; name: string }[];
	/** Schedules parked for hitting the catch-up cap. */
	capped: string[];
}

export async function postDueSchedules(db: AppDatabase, today: string): Promise<PostDueSummary>;
/**
 * Boot entry point. Runs the pass at most once per process: the layout's
 * `$effect` re-runs on every stage transition, and a second pass would
 * double-post anything the first one advanced to exactly `today`.
 */
export async function postDueSchedulesOnce(db: AppDatabase, today: string): Promise<PostDueSummary>;
```

- [ ] **Step 1: Write the failing tests**

**Before writing them, read `deleteAccount` in `src/lib/db/browser/repos/accounts.ts` and `createTransaction` in `src/lib/db/browser/repos/transactions.ts`.** The spec assumes a deleted account makes `createTransaction` fail on a foreign key. That is not what this codebase does, and the difference decides how the engine must behave:

- `deleteAccount` is a **soft** delete (`UPDATE accounts SET deleted_at = …`). The row survives, so **no foreign key fires** — and `createTransaction` has no deleted-account guard, so it would happily post rent to an account the user removed. Silent wrong data, not an error.
- A genuinely absent row (a restore, a manual edit) *does* trip the FK on both production adapters, which both set `PRAGMA foreign_keys = ON`.

So the engine cannot delegate this to the database. It checks the account is live before posting and parks the schedule when it is not — see Step 3 — and the `try/catch` stays as the backstop for the truly-absent case. This is a deliberate deviation from the spec's mechanism, in service of the spec's requirement ("schedule errored + toast, not a crash"); record it in the commit body.

`src/tests/unit/schedules/post-due-schedules.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import type { DatabaseService } from '$lib/db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import { BrowserDatabaseClient } from '$lib/db/browser/client';
import type { AppDatabase, NewSchedule } from '$lib/db/client';
import * as scheduleRepo from '$lib/db/repos/schedules';
import { postDueSchedules, postDueSchedulesOnce, CATCH_UP_CAP } from '$lib/logic/post-due-schedules';

let raw: DatabaseService;
let db: AppDatabase;

beforeEach(async () => {
	raw = createTestDb();
	await runMigrations(raw, migrations);
	// Both production adapters enable this; test-db does not. The absent-account
	// backstop depends on it.
	await raw.execute('PRAGMA foreign_keys = ON');
	for (const id of ['acct1', 'acct2']) {
		await raw.execute(
			`INSERT INTO accounts (id, name, type, currency, archived, created_at, updated_at)
			 VALUES (?, ?, 'cash', 'VND', 0, 'x', 'x')`,
			[id, id]
		);
	}
	db = new BrowserDatabaseClient(raw);
});

/** Seed through the repo the browser adapter delegates to — the same code path
 *  `db.schedules.create` takes, without a second copy of the INSERT. */
function seed(overrides: Partial<NewSchedule> = {}): Promise<string> {
	return scheduleRepo.createSchedule(raw, {
		name: 'Rent',
		kind: 'expense',
		amount: 5_000_000,
		account_id: 'acct1',
		frequency: 'monthly',
		start_date: '2026-01-31',
		...overrides,
	});
}

async function txDates(): Promise<string[]> {
	const rows = await raw.query<{ date: string }>(
		'SELECT date FROM transactions WHERE deleted_at IS NULL ORDER BY date'
	);
	return rows.map((row) => row.date);
}

async function reload(id: string) {
	return (await scheduleRepo.listSchedules(raw)).find((s) => s.id === id)!;
}

/** Emulate the Resume action: enable the schedule and keep its stored date. */
async function resumeKeepingDate(id: string) {
	const row = await reload(id);
	await scheduleRepo.updateSchedule(raw, id, {
		name: row.name,
		kind: row.kind,
		amount: row.amount,
		account_id: row.account_id,
		transfer_account_id: row.transfer_account_id,
		tag_id: row.tag_id,
		payee: row.payee,
		description: row.description,
		frequency: row.frequency,
		start_date: row.start_date,
		end_date: row.end_date,
		posts_transaction: row.posts_transaction,
		enabled: 1,
		next_due_date: null,
	});
}

describe('postDueSchedules', () => {
	it('posts one missed occurrence and advances the schedule', async () => {
		const id = await seed({ frequency: 'weekly', start_date: '2026-01-01' });

		const summary = await postDueSchedules(db, '2026-01-07');

		expect(summary.due).toBe(1);
		expect(summary.posted).toBe(1);
		expect(summary.errors).toEqual([]);
		expect(await txDates()).toEqual(['2026-01-01']);
		const row = await reload(id);
		expect(row.next_due_date).toBe('2026-01-08');
		expect(row.last_posted_date).toBe('2026-01-01');
	});

	it('posts each missed occurrence for a long-closed app', async () => {
		// Monthly from Jan 31, reopened Apr 30: Jan 31 → Feb 28 (clamped) →
		// Mar 28 (drifted) → Apr 28, each posted separately — the user owed rent
		// four times.
		const id = await seed();

		const summary = await postDueSchedules(db, '2026-04-30');

		expect(summary.posted).toBe(4);
		expect(await txDates()).toEqual(['2026-01-31', '2026-02-28', '2026-03-28', '2026-04-28']);
		const row = await reload(id);
		expect(row.next_due_date).toBe('2026-05-28');
		expect(row.last_posted_date).toBe('2026-04-28');
		expect(row.errored_at).toBeNull();
	});

	it('parks a schedule that exceeds the catch-up cap instead of flooding', async () => {
		// Weekly from 2020-01-01 to 2026-01-01 is ~313 occurrences — far past the cap.
		const id = await seed({ frequency: 'weekly', start_date: '2020-01-01' });

		const first = await postDueSchedules(db, '2026-01-01');

		expect(first.posted).toBe(CATCH_UP_CAP);
		expect(first.capped).toEqual([id]);
		const parked = await reload(id);
		// The 24 rows exist, so the bookkeeping records them: parking must not
		// leave the schedule lying about what it already posted.
		expect(parked.last_posted_date).toBe('2020-06-10');
		expect(parked.next_due_date).toBe('2020-06-17');
		expect(parked.errored_at).not.toBeNull();

		// Parked means parked: a second boot posts nothing more.
		const second = await postDueSchedules(db, '2026-01-01');
		expect(second.due).toBe(0);
		expect(second.posted).toBe(0);
		expect(await txDates()).toHaveLength(CATCH_UP_CAP);
	});

	it('drains a parked backlog a cap-sized chunk at a time once re-enabled', async () => {
		const id = await seed({ frequency: 'weekly', start_date: '2020-01-01' });
		await postDueSchedules(db, '2026-01-01');
		await resumeKeepingDate(id);

		const second = await postDueSchedules(db, '2026-01-01');

		expect(second.posted).toBe(CATCH_UP_CAP);
		expect(second.capped).toEqual([id]);
		expect((await reload(id)).errored_at).not.toBeNull();
		// 48 rows: the backlog advanced by exactly one chunk, nothing lost.
		expect(await txDates()).toHaveLength(CATCH_UP_CAP * 2);
	});

	it('posts nothing when the start date is in the future', async () => {
		await seed({ start_date: '2027-01-01' });

		const summary = await postDueSchedules(db, '2026-10-03');

		expect(summary.due).toBe(0);
		expect(summary.posted).toBe(0);
		expect(await txDates()).toEqual([]);
	});

	it('marks a schedule completed at its end_date and posts no further', async () => {
		const id = await seed({ start_date: '2026-01-01', end_date: '2026-02-15' });

		const summary = await postDueSchedules(db, '2026-06-01');

		expect(summary.posted).toBe(2);
		expect(await txDates()).toEqual(['2026-01-01', '2026-02-01']);
		const row = await reload(id);
		expect(row.completed).toBe(1);
		expect(row.errored_at).toBeNull();

		// Completed schedules are out of the due set for good.
		expect((await postDueSchedules(db, '2026-06-01')).due).toBe(0);
	});

	it('parks a schedule whose account is gone and still posts the others', async () => {
		// Review Focus 4. Two schedules are due; one names an account that no
		// longer exists. The failure is injected at the port boundary so the test
		// pins the engine's isolation, not whichever error the account path
		// happens to raise today (see this task's note on soft deletes).
		const broken = await seed({ account_id: 'acct2', name: 'Gym' });
		const healthy = await seed({ account_id: 'acct1', name: 'Rent' });
		const failing: AppDatabase = {
			...db,
			transactions: {
				...db.transactions,
				create: async (input) => {
					if (input.account_id === 'acct2') throw new Error('account is gone');
					return db.transactions.create(input);
				},
			},
		};

		const summary = await postDueSchedules(failing, '2026-04-30');

		expect(summary.errors).toEqual([{ id: broken, name: 'Gym' }]);
		expect(summary.capped).toEqual([]);
		expect((await reload(broken)).errored_at).not.toBeNull();
		// The healthy schedule must have posted all four of its occurrences.
		const healthyRow = await reload(healthy);
		expect(healthyRow.last_posted_date).toBe('2026-01-31');
		expect(healthyRow.errored_at).toBeNull();
		expect(await txDates()).toHaveLength(4);
	});

	it('parks a schedule whose account was soft-deleted rather than posting to it', async () => {
		// The case the spec assumed the FK would catch. It does not — the row is
		// still there — so the engine's live-account check is what prevents this
		// transaction from landing on an account the user removed.
		await seed({ account_id: 'acct2' });
		await raw.execute(`UPDATE accounts SET deleted_at = '2026-04-01T00:00:00Z' WHERE id = 'acct2'`);

		const summary = await postDueSchedules(db, '2026-04-30');

		expect(summary.posted).toBe(0);
		expect(summary.errors).toHaveLength(1);
		expect(await txDates()).toEqual([]);
	});

	it('advances a reminder-only schedule with one notice and no transaction', async () => {
		// Review Focus 5: three missed months, so the naive implementation emits
		// three notices and/or three phantom rows. Neither is acceptable.
		const id = await seed({ posts_transaction: 0 });

		const summary = await postDueSchedules(db, '2026-04-30');

		expect(summary.notices).toEqual(['Rent']);
		expect(summary.posted).toBe(0);
		expect(await txDates()).toEqual([]);
		const row = await reload(id);
		expect(row.next_due_date).toBe('2026-05-28');
		// Reminder-only is not an error state: the bill is still live.
		expect(row.errored_at).toBeNull();
		expect(row.completed).toBe(0);

		// And it does not announce itself again on the next boot.
		expect((await postDueSchedules(db, '2026-04-30')).notices).toEqual([]);
	});

	it('re-anchors a schedule whose next_due_date is NULL rather than skipping it', async () => {
		// Review Focus 1: a NULL due date means the schedule would never post.
		// The column is nullable, so a create path that forgot to seed it — or a
		// row written by any future code path — must still be recoverable.
		const id = await seed({ start_date: '2026-01-31' });
		await raw.execute('UPDATE schedules SET next_due_date = NULL WHERE id = ?', [id]);

		const summary = await postDueSchedules(db, '2026-04-30');

		expect(summary.posted).toBe(4);
		expect((await reload(id)).next_due_date).toBe('2026-05-28');
	});
});

describe('postDueSchedulesOnce', () => {
	it('runs the pass at most once per process', async () => {
		// The layout's $effect re-runs on every stage transition; a second pass
		// could double-post anything the first one advanced to exactly `today`.
		await seed({ frequency: 'weekly', start_date: '2026-01-01' });

		const [first, second] = await Promise.all([
			postDueSchedulesOnce(db, '2026-01-07'),
			postDueSchedulesOnce(db, '2026-01-07'),
		]);

		expect(first).toBe(second); // one promise, not two identical results
		expect(await txDates()).toEqual(['2026-01-01']);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/tests/unit/schedules/post-due-schedules.test.ts`
Expected: FAIL — `Failed to resolve import "$lib/logic/post-due-schedules"`.

- [ ] **Step 3: Implement the engine**

`src/lib/logic/post-due-schedules.ts`:

```ts
import type { AppDatabase, Schedule } from '$lib/db/client';
import { nextDueDate } from '$lib/utils/schedule_next_due';

export const CATCH_UP_CAP = 24;

export interface PostDueSummary { /* as in Interfaces */ }

interface PostedOne { posted: number; reminderDue: boolean; capped: boolean; }

/**
 * Whether every account this schedule would touch is still live.
 *
 * The database cannot answer this: `deleteAccount` soft-deletes, so a schedule
 * still holds a valid foreign key to an account the user removed, and
 * `createTransaction` has no deleted-account guard — it would post silently to
 * that account. Asking is the only way to get the spec's stated behaviour
 * ("schedule errored + toast, not a crash") on the real code path.
 */
function accountsAreLive(schedule: Schedule, liveAccountIds: ReadonlySet<string>): boolean {
	const needed = [schedule.account_id, schedule.transfer_account_id].filter(
		(id): id is string => id !== null
	);
	return needed.every((id) => liveAccountIds.has(id));
}

async function postOne(
	db: AppDatabase,
	schedule: Schedule,
	today: string,
	liveAccountIds: ReadonlySet<string>
): Promise<PostedOne> {
	// `listDue` excludes a NULL date, but a schedule the user cannot see is worse
	// than one that errors — re-anchor instead of returning early (Review Focus 1).
	let next = schedule.next_due_date ?? schedule.start_date;
	let lastPosted = schedule.last_posted_date;
	let posted = 0;
	let reminderDue = false;
	let completed = 0;

	if (!accountsAreLive(schedule, liveAccountIds)) {
		throw new AppError('schedule_account_missing', { scheduleId: schedule.id });
	}

	while (next <= today) {
		if (schedule.end_date !== null && next > schedule.end_date) {
			completed = 1;
			break;
		}
		if (posted >= CATCH_UP_CAP) {
			// Over the cap: record what was actually written, then park it. The 24
			// rows exist, so leaving the bookkeeping at the old date would make the
			// schedule lie about its own history — and the next Resume picks up
			// from here, draining the rest a chunk at a time (nothing is lost).
			await db.schedules.markPosted(schedule.id, lastPosted, next, completed);
			await db.schedules.markErrored(schedule.id);
			return { posted, reminderDue, capped: true };
		}
		if (schedule.posts_transaction === 1) {
			// Posted rows go through the port's own create, so they inherit every
			// existing constraint — kind/tag/account checks, transfer pairing,
			// refund validation. The engine adds no second copy of those rules.
			await db.transactions.create({
				kind: schedule.kind,
				date: next,
				amount: schedule.amount,
				account_id: schedule.account_id,
				transfer_account_id: schedule.kind === 'transfer' ? schedule.transfer_account_id ?? undefined : undefined,
				tag_id: schedule.kind === 'transfer' ? undefined : schedule.tag_id ?? undefined,
				payee: schedule.payee ?? undefined,
				description: schedule.description ?? undefined,
			});
			posted += 1;
			lastPosted = next;
		} else {
			// One notice per schedule, not one per missed occurrence (Review Focus 5).
			reminderDue = true;
		}
		next = nextDueDate(next, schedule.frequency);
	}

	await db.schedules.markPosted(schedule.id, lastPosted, next, completed);
	return { posted, reminderDue, capped: false };
}

export async function postDueSchedules(db: AppDatabase, today: string): Promise<PostDueSummary> {
	const summary: PostDueSummary = { due: 0, posted: 0, advanced: 0, notices: [], errors: [], capped: [] };
	const [due, liveAccounts] = await Promise.all([
		db.schedules.listDue(today),
		db.accounts.list(),
	]);
	summary.due = due.length;
	// One lookup per pass, not per occurrence: `accounts.list()` is a single query
	// and the account set cannot change mid-pass (the pass is the only writer).
	const liveAccountIds = new Set(liveAccounts.map((account) => account.id));

	for (const schedule of due) {
		let result: PostedOne | null = null;
		try {
			result = await postOne(db, schedule, today, liveAccountIds);
		} catch {
			result = null;
		}

		if (result === null) {
			// The port exposes no transaction, so per-schedule isolation comes from
			// here: one damaged schedule is caught, parked, and the loop continues —
			// which is what the spec's "its own db.transaction" was protecting.
			// A failure while parking it must not abort the remaining schedules, so
			// that write is swallowed — the error is still reported to the user.
			try {
				await db.schedules.markErrored(schedule.id);
			} catch {
				/* reported below regardless */
			}
			summary.errors.push({ id: schedule.id, name: schedule.name });
			continue;
		}

		summary.posted += result.posted;
		if (result.reminderDue) summary.notices.push(schedule.name);
		if (result.capped) summary.capped.push(schedule.id);
		else summary.advanced += 1;
	}

	return summary;
}

let once: Promise<PostDueSummary> | null = null;

export function postDueSchedulesOnce(db: AppDatabase, today: string): Promise<PostDueSummary> {
	once ??= postDueSchedules(db, today);
	return once;
}
```

Three details the tests in Step 1 depend on, so do not "simplify" them away:

1. **`db.accounts.list()` must exclude soft-deleted accounts** — verify by reading `src/lib/db/browser/repos/accounts.ts` before relying on it. If it returns deleted rows too, filter them here (`accounts.filter((a) => a.deleted_at === null)`); the soft-delete test in Step 1 is what tells you which it is.
2. **The cap branch calls `markPosted` before `markErrored`** — two writes, not one round trip. If the process dies between them the schedule is not parked but its date has advanced, so the next boot posts the next chunk. That is the better failure direction: progress, not a flood.
3. **`accountsAreLive` throws rather than returning a flag**, so it flows into the same `catch` as an FK failure and gets parked by the same code. One parking path, two triggers.

`AppError` comes from `$lib/utils/errors` — use the constructor signature that file actually exports, and add `schedule_account_missing` to `RUST_ERROR_MESSAGES`/the error map only if that map is where browser-side codes live (read `src/lib/utils/errors.ts`; do not invent a registration site).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/tests/unit/schedules/post-due-schedules.test.ts`
Expected: PASS — all cases, including the cap, the deleted account, and the reminder-only notice.

- [ ] **Step 5: Commit**

```bash
git add src/lib/logic/post-due-schedules.ts src/tests/unit/schedules/post-due-schedules.test.ts
git commit -m "$(cat <<'EOF'
feat: add the scheduled-transaction posting engine with catch-up and parking

The spec expects a deleted account to trip a foreign key. It does not:
deleteAccount soft-deletes, so the row survives and createTransaction has no
deleted-account guard, which would let a schedule post rent against an account
the user removed. The engine checks the account is live and parks the schedule
instead; the FK path stays as the backstop for a genuinely absent row.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Run the pass at boot

**Files:**
- Modify: `src/routes/+layout.svelte` (call `postDueSchedulesOnce` inside the existing ready-firstRun effect, main window only)
- Modify: `src/lib/utils/date.ts` (`todayIso`)
- Modify: `src/lib/stores/quick-refresh.ts` (extract `emitTransactionsChanged`)
- Modify: `messages/en.json`, `messages/vi.json` (three toast keys)
- Test: `src/tests/unit/schedules/today-iso.test.ts`, `src/tests/unit/quick-refresh.test.ts`

**Interfaces:**
- Consumes: `postDueSchedulesOnce` + `PostDueSummary` (Task 8), `toast` (`$lib/stores/toast.svelte` — `show(message: string, opts?)`), `dbStore`, `transactions` and `schedules` stores.
- Produces: `export async function emitTransactionsChanged(): Promise<void>` in `src/lib/stores/quick-refresh.ts` — the cross-window "transactions changed" signal, lifted out of `ImportTransactionsModal.svelte:78-82` where the same five lines already live inline. The layout's `attachTransactionSavedListener` is what receives it. (Pointing that modal at the helper too is a reasonable follow-up, but it is not this plan's job — do not refactor it here.)

**Why this task emits an event at all.** The spec's posting flow ends with *"After posting, emit `transaction:saved` so dashboard/ledger refresh."* Without it, a user opens the app, watches rent post (a toast fires) — and the dashboard behind the toast still shows the old balance, because each Tauri webview is a separate JS context with its own stores. The refresh is the difference between "it posted" and "I can see that it posted".

- [ ] **Step 1: Write the failing tests**

`src/tests/unit/schedules/today-iso.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { todayIso } from '$lib/utils/date';

describe('todayIso', () => {
	it('formats the given instant as a UTC ISO calendar date', () => {
		expect(todayIso(new Date('2026-10-03T23:30:00Z'))).toBe('2026-10-03');
	});

	it('pads single-digit months and days', () => {
		expect(todayIso(new Date('2026-01-04T12:00:00Z'))).toBe('2026-01-04');
	});

	it('is a pure function of its argument', () => {
		const at = new Date('2026-06-15T00:00:00Z');
		expect(todayIso(at)).toBe(todayIso(at));
	});
});
```

And in `src/tests/unit/quick-refresh.test.ts`, alongside its existing listener cases, following that file's injection style:

```ts
describe('emitTransactionsChanged', () => {
	it('dispatches a window event in a browser context', async () => {
		// No __TAURI_INTERNALS__ on window → the window/CustomEvent path.
	});

	it('emits the Tauri event under Tauri', async () => {
		// __TAURI_INTERNALS__ present → the dynamic import + emit path.
	});

	it('never throws when the emit itself fails', async () => {
		// The signal is best-effort: a failed refresh must not turn a successful
		// post into a boot error.
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/tests/unit/schedules/today-iso.test.ts src/tests/unit/quick-refresh.test.ts`
Expected: FAIL — `todayIso is not a function` and `emitTransactionsChanged is not a function`.

- [ ] **Step 3: Add `todayIso`, the emit helper, the toast keys, and the boot call**

`src/lib/utils/date.ts`:

```ts
/** Today as `YYYY-MM-DD` in UTC. Takes its instant as an argument so callers
 *  (and tests) own the clock; the posting engine never reads it itself. */
export function todayIso(at: Date = new Date()): string {
	return at.toISOString().slice(0, 10);
}
```

`src/lib/stores/quick-refresh.ts` — move `ImportTransactionsModal.svelte:78-82`'s five lines here verbatim, so the reason they exist is documented once:

```ts
/**
 * Tell every window that transactions changed.
 *
 * Each Tauri webview has its own JS context and its own stores, so a write in
 * one window is invisible to another until this signal crosses the boundary.
 * Under Tauri that is an `emit` the layout's `attachTransactionSavedListener`
 * picks up; in the browser build it is a window event (and the caller refreshes
 * its own list directly, since nothing listens there).
 *
 * Best-effort by design: a caller has already committed its writes by the time
 * it calls this, so a failure here must never surface as an error.
 */
export async function emitTransactionsChanged(): Promise<void> {
	try {
		if (typeof window !== 'undefined' && (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
			const { emit } = await import('@tauri-apps/api/event');
			await emit('transaction:saved', {});
		} else {
			window.dispatchEvent(new Event('transaction:saved'));
		}
	} catch {
		/* non-fatal: the calling window refreshes its own stores regardless */
	}
}
```

New keys in **both** `messages/en.json` and `messages/vi.json`:

| Key | en | vi |
| --- | --- | --- |
| `schedules_toast_posted` | `{count} scheduled transactions posted` | `Đã ghi {count} giao dịch định kỳ` |
| `schedules_toast_due` | `{count} scheduled transactions are due` | `{count} giao dịch định kỳ đến hạn` |
| `schedules_toast_errored` | `{count} scheduled transactions could not be posted` | `Không thể ghi {count} giao dịch định kỳ` |

In `+layout.svelte`'s existing ready/firstRun `$effect` block, inside the same `(async () => { … })()` that already loads `settings` and `tour` — and **after** the `attachTransactionSavedListener` call, so this window is already listening when it emits. The effect's `isQuickAddWindow` early return at the top of the block is the main-window guard the spec requires; it is the only one needed, and the pass must not be hoisted above it:

```ts
				const summary = await postDueSchedulesOnce(dbStore.db!, todayIso());
				if (summary.posted > 0) {
					// Refresh before the toast: the user should not read "3 posted"
					// over a dashboard that still shows yesterday's balance.
					await transactions.load();
					await schedules.load();
					await emitTransactionsChanged();
					toast.show(m.schedules_toast_posted({ count: summary.posted }));
				}
				if (summary.notices.length > 0) {
					toast.show(m.schedules_toast_due({ count: summary.notices.length }));
				}
				if (summary.errors.length > 0 || summary.capped.length > 0) {
					toast.show(
						m.schedules_toast_errored({ count: summary.errors.length + summary.capped.length })
					);
				}
```

Add the imports: `postDueSchedulesOnce` (`$lib/logic/post-due-schedules`), `todayIso` (`$lib/utils/date`), `emitTransactionsChanged` (`$lib/stores/quick-refresh`), and the `schedules` store (Task 10 creates it — if this task is executed before Task 10, import the store only after it exists, or drop the `schedules.load()` line and add it in Task 10; do not create the store file here).

Every toast is conditional on a non-zero count, so a boot with nothing due is silent — that is what keeps the existing E2E suite's toast assertions meaningful.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test && pnpm check && pnpm test:e2e`
Expected: PASS — the pure date test, the emit-helper cases, and no E2E regression from the extra boot work (a run with no schedules produces an empty summary, no toast, and no refresh).

- [ ] **Step 5: Commit**

```bash
git add src/routes/+layout.svelte src/lib/utils/date.ts src/lib/stores/quick-refresh.ts messages/en.json messages/vi.json src/tests/unit/schedules/today-iso.test.ts src/tests/unit/quick-refresh.test.ts
git commit -m "$(cat <<'EOF'
feat: post due scheduled transactions at boot and refresh the open windows

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

**Note (not a step):** `dbStore.db!` is non-null only because the effect's `ready` gate guarantees it. If `$effect` ever runs with `stage === 'ready'` before `db` is assigned, prefer `dbStore.db` in a guard — read `db.svelte.ts` and match how other consumers of the store access it rather than assuming.

---

### Task 10: The schedules page and form

**Files:**
- Create: `src/routes/schedules/+page.svelte`
- Create: `src/lib/components/forms/ScheduleForm.svelte`
- Modify: `src/lib/nav-items.ts` (`secondaryNav` entry + icon)
- Modify: `messages/en.json`, `messages/vi.json` (the `schedules_*` page keys)
- Create: `src/lib/stores/schedules.svelte.ts`
- Test: `src/tests/unit/components/ScheduleForm.test.ts`, `src/tests/unit/stores/schedules.test.ts`

**Interfaces:**
- Consumes: the `ScheduleOps` port (Tasks 6–7), `Schedule`/`NewSchedule`/`ScheduleUpdate` (Task 6), `firstDueOnOrAfter` (Task 1), `AccountOps.list()`, `CategoryOps.listTags()`, `formatDate` (`$lib/utils/date`), `toast`, `mapError`.
- Produces: the `schedules` store that Task 9's boot pass refreshes and Task 12's E2E spec drives, plus the route `/schedules`.

**The store is not optional filler.** Every other domain in this app has one (`accounts`, `budgets`, `categories`, `debts`, `goals`, `rules`, `transactions` — all `.svelte.ts` under `src/lib/stores/`), and every route reads its domain through it. A page that reached into `dbStore.db.schedules` directly would be the only one in the codebase, and Task 9 has nothing to refresh after the boot pass without it. Model it on `goals.svelte.ts`.

- [ ] **Step 1: Write the failing tests**

`src/tests/unit/stores/schedules.test.ts` — the two behaviours that are not thin delegation. Follow `src/lib/stores/reports.test.ts`'s pattern exactly (`vi.hoisted` op mocks, `vi.mock('$lib/db', …)`, `new SchedulesStore()`); that means the store must export its class, not only the singleton:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Schedule } from '$lib/db/client';

const mocks = vi.hoisted(() => ({
	scheduleOps: {
		list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
		listDue: vi.fn(), markPosted: vi.fn(), markErrored: vi.fn(),
	},
	getDb: vi.fn(),
}));

vi.mock('$lib/db', () => ({ getDb: mocks.getDb }));
import { SchedulesStore } from './schedules.svelte';

const base: Schedule = {
	id: '', name: 'Rent', kind: 'expense', amount: 5_000_000, account_id: 'acct1',
	transfer_account_id: null, tag_id: null, payee: null, description: null,
	frequency: 'monthly', start_date: '2026-01-31', end_date: null, posts_transaction: 1,
	next_due_date: '2026-01-31', last_posted_date: null, completed: 0, enabled: 1,
	errored_at: null, created_at: 'x', updated_at: 'x',
};

describe('SchedulesStore.resume', () => {
	let store: SchedulesStore;

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getDb.mockReturnValue({ schedules: mocks.scheduleOps });
		mocks.scheduleOps.update.mockResolvedValue(undefined);
		mocks.scheduleOps.list.mockResolvedValue([
			{ ...base, id: 'disabled', enabled: 0 },
			{ ...base, id: 'parked', errored_at: '2026-05-01T00:00:00Z' },
		]);
		store = new SchedulesStore();
	});

	it('re-anchors the due date when a disabled schedule is re-enabled', async () => {
		await store.load();

		await store.resume('disabled', '2026-06-01');

		const [, input] = mocks.scheduleOps.update.mock.calls[0];
		// Jan 31 monthly, five months later: the disabled period is skipped, not replayed.
		expect(input.next_due_date).toBe('2026-06-28');
		expect(input.enabled).toBe(1);
		// The full-field projection is what stops a resume from blanking the rest.
		expect(input).toMatchObject({ frequency: 'monthly', start_date: '2026-01-31', amount: 5_000_000 });
	});

	it('keeps the stored due date when resuming a parked schedule', async () => {
		await store.load();

		await store.resume('parked', '2026-06-01');

		const [, input] = mocks.scheduleOps.update.mock.calls[0];
		// null leaves the stored date, so the backlog keeps draining (Task 8).
		expect(input.next_due_date).toBeNull();
		expect(input.enabled).toBe(1);
	});
});
```

`src/tests/unit/components/ScheduleForm.test.ts` with the `// @vitest-environment jsdom` directive the folder requires. Assert behavior, not markup:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import ScheduleForm from '$lib/components/forms/ScheduleForm.svelte';
import type { Schedule } from '$lib/db/client';

/** The stored row the edit cases start from — every field non-default, so a
 *  dropped field is visible in the assertion rather than coincidentally equal. */
const stored: Schedule = {
	id: 'sch1', name: 'Rent', kind: 'expense', amount: 5_000_000, account_id: 'acct1',
	transfer_account_id: null, tag_id: 'tag1', payee: 'Landlord', description: 'monthly',
	frequency: 'monthly', start_date: '2026-01-31', end_date: '2027-01-31',
	posts_transaction: 1, next_due_date: '2026-01-31', last_posted_date: null,
	completed: 0, enabled: 1, errored_at: null, created_at: 'x', updated_at: 'x',
};

it('submits an integer amount and an ISO start date', async () => {
	const onsubmit = vi.fn();
	render(ScheduleForm, { props: { accounts: ['acct1'], tags: ['tag1'], onsubmit } });

	await userEvent.type(screen.getByLabelText(m.schedules_name()), 'Rent');
	await userEvent.type(screen.getByLabelText(m.schedules_amount()), '5000000');
	await userEvent.click(screen.getByRole('button', { name: m.schedules_save() }));

	const input = onsubmit.mock.calls[0][0];
	// No float anywhere on the path from the input to the argument.
	expect(input.amount).toBe(5_000_000);
	expect(Number.isInteger(input.amount)).toBe(true);
	expect(input.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

it('requires a destination account when the kind is transfer, and hides the category', async () => {
	const onsubmit = vi.fn();
	render(ScheduleForm, { props: { accounts: ['acct1'], tags: ['tag1'], onsubmit } });

	await userEvent.click(screen.getByRole('radio', { name: m.schedules_kind_transfer() }));

	// The destination picker appears and the category picker goes away — the DB
	// CHECK rejects both mismatches, so the form must not offer them.
	expect(screen.getByLabelText(m.schedules_transfer_account())).toBeInTheDocument();
	expect(screen.queryByLabelText(m.schedules_category())).not.toBeInTheDocument();
	await userEvent.click(screen.getByRole('button', { name: m.schedules_save() }));
	expect(onsubmit).not.toHaveBeenCalled(); // destination is required
});

it('submits the existing schedule fields unchanged when only the amount is edited', async () => {
	const onsubmit = vi.fn();
	render(ScheduleForm, { props: { schedule: stored, accounts: ['acct1'], tags: ['tag1'], onsubmit } });

	const amount = screen.getByLabelText(m.schedules_amount());
	await userEvent.clear(amount);
	await userEvent.type(amount, '6000000');
	await userEvent.click(screen.getByRole('button', { name: m.schedules_save() }));

	expect(onsubmit).toHaveBeenCalledWith({
		...toUpdateFields(stored), // the same projection the store uses
		amount: 6_000_000,
	});
	// Spelled out, because these are what a partial submit silently destroys:
	expect(onsubmit.mock.calls[0][0]).toMatchObject({
		frequency: 'monthly', start_date: '2026-01-31', end_date: '2027-01-31',
		tag_id: 'tag1', payee: 'Landlord', enabled: 1,
	});
});
```

The third case is the one that matters: a partial-submit bug here silently rewrites `frequency` or `start_date` — a user correcting a typo in an amount would find their schedule rescheduled. Wire the submit handler to send a complete `ScheduleUpdate` built from the loaded schedule plus the edited fields, and assert every other field on the captured argument.

The exact prop names (`accounts`, `tags`, `onsubmit`) and the render/query helpers are yours to match against `src/tests/unit/components/ImportTransactionsModal.test.ts` — read it and follow its setup rather than trusting the shapes above. The behaviours asserted above are the requirement; the plumbing is that file's convention.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/tests/unit/stores/schedules.test.ts src/tests/unit/components/ScheduleForm.test.ts`
Expected: FAIL — module not found for both.

- [ ] **Step 3: Build the store, the page, the form, the nav entry, and the strings**

`src/lib/stores/schedules.svelte.ts` — the `goals.svelte.ts` shape (`getDb()`, `$state` fields for `items`/`loading`/`error`, `mapError` + `toast` in the catch blocks, a module-level singleton export):

```ts
	/** Turn a disabled schedule back on. `today` is passed in by the caller so
	 *  the store stays testable without freezing the clock. */
	async resume(id: string, today: string) {
		const row = this.items.find((s) => s.id === id);
		if (!row) return;
		// A parked schedule keeps its date so its backlog drains in chunks; a
		// merely disabled one jumps forward, so a long pause is not replayed.
		const next =
			row.errored_at === null ? firstDueOnOrAfter(row.next_due_date ?? row.start_date, row.frequency, today) : null;
		await this.update(id, { ...toUpdateFields(row), enabled: 1, next_due_date: next });
	}
```

Write `toUpdateFields(row)` once (the full-field projection `ScheduleUpdate` requires) and use it from `resume` and from the form — the same projection is what makes the "only the amount was edited" test pass.

`src/routes/schedules/+page.svelte` — reads `schedules` from the store (`onMount` → `schedules.load()`), the list with, per row: name, amount (via the existing currency formatting component/helper), frequency label, `next_due_date`, `last_posted_date`, and status. Status is a badge with exactly four states, in this precedence: **Errored** (`errored_at !== null`) → **Completed** (`completed === 1`) → **Reminder** (`posts_transaction === 0`, still active) → **Active**. Each row offers a **Resume** on errored rows and an **Enable** toggle on disabled ones — both call `schedules.resume(id, todayIso())`, which is the only path that clears `errored_at`. A completed row gets neither. Empty state: `schedules_empty`.

`src/lib/components/forms/ScheduleForm.svelte` — props `{ schedule?: Schedule }` and a modal in the style of the existing forms. The kind selector (expense/income/transfer) drives which fields render: `transfer` shows the destination-account picker and hides the category picker (the DB enforces this too, per Task 2's CHECK). Amount is parsed with the repo's existing integer-amount input convention — do not route amounts through any float path.

`src/lib/nav-items.ts` — add to `secondaryNav` next to `/goals`:

```ts
	{ href: '/schedules', key: 'schedules', label: () => m.nav_schedules() },
```

and an icon under the `schedules` key in the `icons` map, drawn in the same single-stroke language (a calendar-with-arrow glyph, stroke path only — no fills, matching its neighbours).

New keys in both message files: `nav_schedules`, `schedules_title`, `schedules_empty`, `schedules_new`, `schedules_name`, `schedules_amount`, `schedules_kind`, `schedules_kind_expense`, `schedules_kind_income`, `schedules_kind_transfer`, `schedules_frequency`, `schedules_freq_weekly`, `schedules_freq_biweekly`, `schedules_freq_monthly`, `schedules_freq_yearly`, `schedules_account`, `schedules_transfer_account`, `schedules_payee`, `schedules_category`, `schedules_description`, `schedules_start_date`, `schedules_end_date`, `schedules_posts_transaction`, `schedules_reminder_only`, `schedules_next_due`, `schedules_last_posted`, `schedules_status_active`, `schedules_status_reminder`, `schedules_status_completed`, `schedules_status_errored`, `schedules_resume`, `schedules_save`, `schedules_cancel`, `schedules_delete`, `schedules_delete_confirm`.

Run `pnpm check` afterwards to regenerate Paraglide and confirm no dotted-ID or missing-key errors.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test && pnpm check`
Expected: PASS; `pnpm check` clean (Svelte 5 runes, no `$:`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/schedules.svelte.ts src/routes/schedules/+page.svelte src/lib/components/forms/ScheduleForm.svelte src/lib/nav-items.ts messages/en.json messages/vi.json src/tests/unit/components/ScheduleForm.test.ts src/tests/unit/stores/schedules.test.ts
git commit -m "$(cat <<'EOF'
feat: add the schedules store, page, form, and navigation entry

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

If Task 9 was executed first and dropped its `schedules.load()` line, add it now — the boot pass should refresh this store the way it refreshes `transactions`.

---

### Task 11: Warn before deleting an account that scheduled transactions use

The spec flags this explicitly ("Deleting an account should warn about active schedules"), and Review Focus 4 is the failure it prevents: a schedule parked errored — or worse, posting into an account the user thinks is gone.

**Files:**
- Modify: the accounts page/component that owns account deletion (find it with `codegraph explore "account delete confirmation"`; the delete path calls `db.accounts.delete` via `deleteAccount`)
- Modify: `messages/en.json`, `messages/vi.json` (two keys)
- Test: extend the accounts list/delete component's existing test

**Interfaces:**
- Consumes: the `schedules` store's `items` (Task 10) — filter client-side for `completed === 0 && errored_at === null && account_id === id`, with no new op. The store is already loaded by the accounts page's sibling routes; if it is not, call `schedules.load()` when the dialog opens rather than adding a port method.
- Produces: nothing downstream.

**Read the existing delete path first, and match it.** `deleteAccount` already refuses to delete an account with active linked goals, and the confirmation dialog already renders that refusal. Two design questions follow, and the plan does not answer them for you:

1. **Warn or block?** The spec says "warn", and this plan keeps it advisory: the engine parks the schedule safely, and a user deleting an account on purpose should not be stopped by a schedule they abandoned. But the goals case *blocks*, and a reviewer may well prefer consistency. Ship the warning; note the choice in the commit body so the reviewer can see it was considered rather than missed.
2. **Which schedules count as active?** `errored_at`-free and not completed. A schedule already parked because of this very account is not a new surprise and must not inflate the count — that is what the test's two-schedule arrangement pins.

- [ ] **Step 1: Write the failing test**

Add to the accounts component test that already covers the delete confirmation, following its existing seeding style:

```ts
	it('warns when the account still has active scheduled transactions', async () => {
		// Two schedules on the account being deleted: one active, one completed.
		// Open the delete confirmation.
		// It must mention the count of ACTIVE schedules and must not count the
		// completed one — an inflated warning trains people to click through it.
	});

	it('shows no warning for an account with only completed schedules', async () => {
		// The zero case is the one that regresses silently: a warning that always
		// shows is the same as no warning at all.
	});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test <the accounts test path>`
Expected: FAIL — the warning text is absent.

- [ ] **Step 3: Add the warning**

The confirmation dialog gains a line when the active count is non-zero: `accounts_delete_active_schedules` — en: `{count} scheduled transactions still post to this account`; vi: `{count} giao dịch định kỳ vẫn ghi vào tài khoản này`. One key, plural count, in **both** message files. Use the same pluralization approach the neighbouring `account_delete_linked_goals` key uses rather than introducing a second convention.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test && pnpm check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components src/routes/accounts messages/en.json messages/vi.json
git commit -m "$(cat <<'EOF'
feat: warn when deleting an account that active schedules still post to

Advisory rather than blocking, unlike the linked-goals check: the posting
engine parks an affected schedule, so the delete is recoverable and a user
who abandoned a schedule should not be stopped by it.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: The E2E mock handlers and the journey

**Files:**
- Modify: `src/tests/e2e/fixtures/tauri-mock.ts` (seven dispatch handlers)
- Create: `src/tests/e2e/schedules.spec.ts`

**Interfaces:**
- Consumes: the mock's `loadDb`/`select`/`run` helpers and its existing handler style; the port's method names, which the handlers must match one-for-one (the mock throws `tauri-mock: unhandled invoke` otherwise).
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test**

`src/tests/e2e/schedules.spec.ts`:

```ts
import { test, expect } from './fixtures/onboarded';
import type { Page } from '@playwright/test';

/** Read the browser adapter's live SQLite database from the page, the way
 *  backup-restore.spec.ts:25 does — copy that helper rather than inventing one. */
async function liveQuery<T>(page: Page, sql: string): Promise<T[]> {
	return page.evaluate((statement) => {
		const raw = (window as unknown as { __notchyTestDb?: { query: (s: string) => Promise<T[]> } })
			.__notchyTestDb;
		return raw!.query(statement);
	}, sql);
}

test('a schedule that is due posts on the next open, exactly once', async ({ onboardedPage: page }) => {
	// The onboarded fixture has already created an account and landed on the
	// dashboard, so the schedule below has somewhere to post.
	await page.goto('/schedules');
	await page.getByRole('button', { name: 'New schedule' }).click();
	// Fill with the real labels from Task 10's message keys: name "Rent", expense,
	// an amount, the onboarded account, monthly, and a start date of today — so
	// the first occurrence is already due on the very next boot.
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('Rent')).toBeVisible();

	await page.reload();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	// The posted row exists exactly once, dated the schedule's start date.
	const first = await liveQuery<{ c: number; date: string }>(
		page,
		"SELECT COUNT(*) AS c, MIN(date) AS date FROM transactions WHERE payee = 'Landlord' AND deleted_at IS NULL"
	);
	expect(first[0].c).toBe(1);

	// Reloading again must not post it a second time: the schedule advanced past
	// today. This is the assertion that makes the test cover the advance, not
	// just the insert.
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	const second = await liveQuery<{ c: number }>(
		page,
		"SELECT COUNT(*) AS c FROM transactions WHERE payee = 'Landlord' AND deleted_at IS NULL"
	);
	expect(second[0].c).toBe(1);

	// And the schedule itself moved forward rather than re-firing.
	const schedule = await liveQuery<{ next_due_date: string; last_posted_date: string }>(
		page,
		'SELECT next_due_date, last_posted_date FROM schedules WHERE deleted_at IS NULL'
	);
	expect(schedule[0].last_posted_date).toBe(first[0].date);
	expect(schedule[0].next_due_date > first[0].date).toBe(true);
});
```

**Two names to confirm before running, not to guess:** the fixture's page extension (the file above imports `./fixtures/onboarded`, whose extension is `onboardedPage`) and the db handle the helper reaches for. Read `src/tests/e2e/backup-restore.spec.ts` and copy its `liveQuery` (line 25) and its `test`/`expect` import verbatim — if it exposes the database differently, use that exact accessor. Also use the real labels from Task 10's message keys rather than the English strings above.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:e2e src/tests/e2e/schedules.spec.ts`
Expected: FAIL — `tauri-mock: unhandled invoke schedule_list`.

- [ ] **Step 3: Add the mock handlers**

In `tauri-mock.ts`, alongside the other domain blocks, add one `if (cmd === '…')` arm per command, each translating to SQL over the mock's virtual DB exactly as the neighbouring domain handlers do: `schedule_list`, `schedule_create` (generating an id, defaulting `next_due_date` to `start_date`), `schedule_update`, `schedule_delete`, `schedule_list_due`, `schedule_mark_posted`, `schedule_mark_errored`. The `schedules` table itself was added in Task 2.

Two of them need care, because the mock is the only place the schema exists twice and drift shows up here first:

- **`schedule_list_due`** must apply the same predicate as the real query — `enabled = 1 AND completed = 0 AND errored_at IS NULL AND deleted_at IS NULL AND next_due_date IS NOT NULL AND next_due_date <= ?`. A mock that returns everything makes the boot pass look like it works while the native path would post nothing.
- **`schedule_update`** must implement `next_due_date = COALESCE(?, next_due_date)` and the `errored_at` clear-on-enable, or the E2E run will diverge from the unit tests on exactly the two behaviours Task 4 exists for.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:e2e`
Expected: PASS — the new spec plus the whole existing suite.

- [ ] **Step 5: Commit**

```bash
git add src/tests/e2e/fixtures/tauri-mock.ts src/tests/e2e/schedules.spec.ts
git commit -m "$(cat <<'EOF'
test: drive scheduled transactions end to end through the Tauri mock

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Gates, roadmap, and the story bookkeeping

**Files:**
- Modify: `product/stories/index.md` (split STORY-009; set the Part 1 status)
- Modify: `specs/2026-07-06-scheduled-transactions-and-rollover-pool-design.md` (status line: content is now split across two plans)
- Regenerate: `specs/STATUS.md` (via `pnpm test:roadmap` — never hand-edited)

**Interfaces:**
- Consumes: every prior task's commits.
- Produces: a repo where the roadmap, the story inventory, and reality agree.

- [ ] **Step 1: Run every gate**

```bash
pnpm check
pnpm test
pnpm test:e2e
pnpm check:db-contracts
pnpm check:native-db-cutover
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

All must be green. A DB-contract mismatch means Task 5's regeneration was not committed; a cutover failure means a new raw handle appeared.

- [ ] **Step 2: Split STORY-009 and record the status**

This plan ships Part 1 only, so STORY-009 ("I set up rent once and it reappears monthly, **with a rollover to-budget pool**") cannot go `shipped` — that would claim the pool works. In `product/stories/index.md`:

- Narrow STORY-009 to the recurring-bills need alone, set `Status` → `shipped`, and add `specs/plans/2026-10-03-scheduled-transactions` to its plan list.
- Add a new story for the Part 2 need (the to-budget pool: "I can see what income is still unassigned, and overspending in a bucket claws back into it"), with its own `Evidence` anchor pointing at the same Actual→Notchy research row and at the spec's Part 2, and `Status` → `planned`. **A story without an evidence anchor is a wish** — if the anchor does not hold up, leave the story out and say so in the log line rather than inventing one.
- Add a dated line to the inventory's change log noting the split and why.

Update the spec's status line: Part 1 implemented by this plan; Part 2 awaiting a plan.

- [ ] **Step 3: Regenerate the roadmap and read it**

```bash
pnpm test:roadmap
```

Expected: no `⚠ stale` warning, exit 0, and this plan's rows showing every task checked. If it reports stale, the commit history is missing a step commit or a checkbox is unflipped — fix that, do not edit `specs/STATUS.md`.

- [ ] **Step 4: Commit**

```bash
git add product/stories/index.md specs/2026-07-06-scheduled-transactions-and-rollover-pool-design.md specs/STATUS.md
git commit -m "$(cat <<'EOF'
docs: split STORY-009 and mark the scheduled-transactions plan complete

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

## Accepted risks

- **The spec contradicts itself on re-enabling, and this plan picks a side.** Its *Schedule disabled mid-period* case says re-enabling *"resumes from current `next_due_date` (no retroactive gap post — predictable)"* — but resuming from a stored past date is exactly what makes the catch-up loop post the gap. The two halves cannot both hold. This plan resolves it by intent: **the app being closed is not a user decision, so reopening catches up; disabling is a decision, so re-enabling must not replay it.** Disabled → re-enable supplies a re-anchored date (`firstDueOnOrAfter`); parked → Resume keeps the stored date so its backlog drains a cap-sized chunk at a time. Worth confirming with the spec's author before release.
- **A parked schedule's backlog drains 24 posts per pass.** Resuming a schedule that missed a year posts 24 rows, parks again, and needs another Resume. Visible and bounded, but tedious; a "post the rest" affordance is a follow-up, not a fix to rush here.
- **Monthly recurrence drifts after a clamped step.** `nextDueDate` steps relative to the *current* due date, so a schedule anchored on the 31st goes `Jan 31 → Feb 28 → Mar 28 → Apr 28`, not back to the 31st. The spec's own example ("Jan 31 → Feb 28") implies this stepping and it is what Task 1 asserts, but a user who means "the last day of the month" gets the 28th forever. An anchored variant needs an extra column to remember the intended day-of-month; that is a schema change and a separate decision. **Release-note item.**
- **The pass runs on open only.** No OS scheduler, so a schedule that comes due while the app is closed posts on the next launch. That is the spec's explicit non-goal, and it is why the catch-up cap exists.
- **`errored_at` is one column more than the spec's DDL.** Recorded in Task 2 with its rationale. Without it, a schedule that cannot post would retry and re-toast on every boot.
- **The `schedules` DDL exists twice** (JS 006 and Rust 007), as every table in this codebase does since the cutover. Mitigated by the manifest (`validate_manifest` proves the native shape) and by the mock's own copy carrying the drift test.

## Out of scope

- **Part 2, the rollover to-budget pool** — its own plan. It changes numbers existing users see, needs no migration, and should be reviewed on its own.
- **Nth-weekday, weekend skipping, after-N-occurrences recurrence** — the spec's explicit YAGNI list. Adding one means changing the `frequency` CHECK on both sides and the pure util's contract.
- **Money-movement primitives** (`coverOverspending`, `transferAvailable`, `holdForNextMonth`) — deferred by the spec.
- **Schedule discovery from transaction history** (Actual's history mining) — deferred by the spec.
- **Retroactive edits and history rewriting** — posted rows are ordinary transactions; editing a schedule never touches what it already posted.
