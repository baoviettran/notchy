# Categorize Rules Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Auto-categorize transactions by payee using a rules engine that learns from user behavior, with Vietnamese diacritic normalization.

**Architecture:** Three-unit split: pure matcher util (`rules_matcher.ts`) + runes store (`rules.svelte.ts`) + repo (`rules.ts`). Auto-learn triggers after transaction save; matching happens in transaction form. Vietnamese normalization folds diacritics + `đ→d` in-memory only.

**Tech Stack:** SvelteKit 5, Svelte 5 runes, SQLite (Tauri plugin), ULID IDs, Paraglide i18n (en + vi)

## Architecture Context

```
┌─────────────────────────────────────────────────────────────────┐
│ UI Layer (Svelte 5 components)                                   │
│  └─ TransactionForm.svelte ← integrates auto-fill + learnRule  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Store Layer (runes-based singletons)                             │
│  ├─ transactions.svelte.ts (existing)                           │
│  ├─ accounts.svelte.ts (existing)                               │
│  ├─ categories.svelte.ts (existing)                             │
│  └─ rules.svelte.ts (NEW) ← matchTag, learnRule, CRUD          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Repository Layer (SQL queries)                                   │
│  ├─ transactions.ts (existing)                                  │
│  ├─ accounts.ts (existing)                                      │
│  ├─ categories.ts (existing)                                    │
│  └─ rules.ts (NEW) ← CRUD on categorize_rules table            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Database Layer                                                   │
│  ├─ DatabaseService (singleton via getDb())                     │
│  ├─ migrations/005_categorize_rules.ts (NEW)                    │
│  └─ SQLite (Tauri plugin in desktop, sql.js in E2E/tests)      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Pure Utils (no DB/Svelte deps)                                   │
│  ├─ normalize_payee.ts (NEW) ← Vietnamese diacritic folding    │
│  └─ rules_matcher.ts (NEW) ← specificity ranking               │
└─────────────────────────────────────────────────────────────────┘
```

**Key patterns to follow:**
- Stores are **singletons** exported from `*.svelte.ts` files (e.g., `export const accounts = new AccountsStore()`)
- Stores call `getDb()` internally — no constructor injection
- Components import stores directly (e.g., `import { transactions } from '$lib/stores/transactions.svelte'`)
- TransactionForm uses `Autocomplete` components (not plain `<input>`/`<select>`)
- E2E tests use `onboardedPage` fixture and `addTransaction` helper

## Global Constraints

- **TDD discipline:** Red-green-refactor. Write failing test first, watch it fail, implement minimum to pass, refactor, all tests green before commit.
- **No DB mocking:** Use `createTestDb()` + `runMigrations()` for repo tests.
- **Pure functions:** `normalizePayee` and `matchRules` have zero DB/Svelte dependencies.
- **Soft-delete convention:** All tables use `deleted_at TEXT` column.
- **Migration idempotency:** PRAGMA-check before `CREATE TABLE IF NOT EXISTS` (copy `004_rollover_toggle.ts` pattern).
- **Schema-version call sites:** Bumping `schema_version` requires updating *all* `importDatabase`/`validateImport` version literals (UI, unit, E2E fixtures).
- **Amounts are integers:** Smallest currency unit, no floats.
- **IDs are ULIDs:** Use `ulid()` from `src/lib/utils/id.ts`.
- **i18n:** Add strings to both `messages/en.json` and `messages/vi.json`, then run `pnpm check` to regenerate Paraglide.
- **Svelte 5 runes:** Use `$state`, `$derived`, `$effect`, `$props`. No legacy stores.

## Plan-Time Decisions (Resolved)

1. **`upsertLearned` dedup key:** Normalization happens in JS before the SQL call. The repo function receives the raw `payee_term`, normalizes it via `normalizePayee()`, then does `SELECT ... WHERE normalizePayee(payee_term) = ?` in the query (SQLite's `lower()` + manual combining-mark stripping is too complex; fetch all learned rules and filter in JS).
2. **`learnRule` → transactions repo dependency:** Explicit. `rules.svelte.ts` imports `listTransactions` from `transactions.ts` repo. This is a read-only dependency; no circular writes.
3. **`learnRule` return result:** Returns `Promise<{ learned: boolean; ruleId?: string }>` instead of throwing. Caller (`TransactionForm.svelte`) handles toast on failure. Keeps rules store free of toast-store dependency.
4. **Auto-fill mechanism:** Use `$effect`, not `$derived` that writes `$state`. Form has `let tagId = $state(...)` and `let suggestedTag = $derived(rules.matchTag(payee))`. An `$effect` watches `suggestedTag` and sets `tagId = suggestedTag` only when `tagId` is empty and `suggestedTag` is non-null.
5. **Management UI:** Deferred to a follow-up spec. The engine works via auto-learn; manual CRUD is not required for v1. Schema and store support it from day one; a future spec adds the route.
6. **Cross-window rules cache refresh:** Add a `rules:changed` Tauri event emitted after every rule mutation (create/update/delete). Each window's rules store listens and calls `load()` to refresh. Mirrors existing `transaction:saved` pattern.

## File Structure

| File | Responsibility |
|------|----------------|
| `src/lib/db/migrations/005_categorize_rules.ts` | Create `categorize_rules` table, bump schema version |
| `src/lib/db/migrations/index.ts` | Register migration 005 |
| `src/lib/utils/normalize_payee.ts` | Pure: Vietnamese-aware payee normalization (trim, lowercase, NFC→NFD, strip combining marks, `đ→d`) |
| `src/lib/utils/rules_matcher.ts` | Pure: given `(payee, rules[])`, return best `tag_id` by specificity or `null` |
| `src/lib/db/repos/rules.ts` | SQL CRUD on `categorize_rules` table |
| `src/lib/stores/rules.svelte.ts` | Runes store singleton: cache, `matchTag`, CRUD, `learnRule` auto-learn brain |
| `src/lib/components/forms/TransactionForm.svelte` | Auto-fill `tagId` from payee; call `learnRule` after save |
| `src/tests/unit/normalize_payee.test.ts` | Pure-function tests for Vietnamese normalization |
| `src/tests/unit/rules_matcher.test.ts` | Pure-function tests for specificity ranking + ties |
| `src/tests/unit/rules.test.ts` | Repo tests with `createTestDb` + migrations |
| `src/tests/unit/rules.svelte.test.ts` | Store tests: `matchTag`, `learnRule` with diacritic variants |
| `src/tests/unit/components/TransactionForm.test.ts` | Component test: auto-fill + learn-after-save |
| `src/tests/e2e/categorize-rules.spec.ts` | E2E: 3 transactions → 4th auto-fills; Vietnamese variant |

---

### Task 1: Migration 005 — `categorize_rules` table

**Files:**
- Create: `src/lib/db/migrations/005_categorize_rules.ts`
- Modify: `src/lib/db/migrations/index.ts`
- Test: (none — migration is tested by repo tests in Task 4)

**Interfaces:**
- Consumes: `DatabaseService` from `src/lib/db/service.ts`
- Produces: Migration object with `up(db: DatabaseService): Promise<void>` method

- [x] **Step 1: Write the migration file**

Create `src/lib/db/migrations/005_categorize_rules.ts`:

```typescript
import type { DatabaseService } from '../service';

export async function up(db: DatabaseService): Promise<void> {
	// Check if table already exists (idempotency)
	const existing = await db.select<{ name: string }[]>(
		`SELECT name FROM sqlite_master WHERE type='table' AND name='categorize_rules'`
	);
	if (existing.length > 0) {
		return;
	}

	await db.execute(`
		CREATE TABLE categorize_rules (
			id          TEXT PRIMARY KEY,
			payee_term  TEXT NOT NULL CHECK (length(payee_term) BETWEEN 1 AND 128),
			match_mode  TEXT NOT NULL CHECK (match_mode IN ('is', 'starts_with', 'contains')),
			tag_id      TEXT NOT NULL REFERENCES category_tags(id),
			source      TEXT NOT NULL DEFAULT 'manual'
			               CHECK (source IN ('manual', 'learned')),
			enabled     INTEGER NOT NULL DEFAULT 1,
			created_at  TEXT NOT NULL,
			updated_at  TEXT NOT NULL,
			deleted_at  TEXT
		)
	`);

	await db.execute(`
		CREATE INDEX idx_categorize_rules_enabled
		ON categorize_rules(enabled, deleted_at)
	`);

	await db.execute(`UPDATE schema_version SET version = 5`);
}
```

- [x] **Step 2: Register the migration**

Open `src/lib/db/migrations/index.ts`. Add the import and append to the migrations array:

```typescript
import * as m005 from './005_categorize_rules';

export const migrations = [
	// ... existing migrations
	m005
];
```

- [x] **Step 3: Update schema-version call sites**

Search for `importDatabase` and `validateImport` across the codebase. Update all version literals from `4` to `5`. Common locations:
- `src/lib/db/service.ts` (if present)
- `src/tests/unit/helpers/test-db.ts` (if present)
- `src/tests/e2e/fixtures/` (if present)

Run `pnpm check` to verify no TypeScript errors.

- [x] **Step 4: Commit**

```bash
git add src/lib/db/migrations/005_categorize_rules.ts src/lib/db/migrations/index.ts
git commit -m "feat(categorize-rules): add migration 005 for categorize_rules table"
```

---

### Task 2: Pure util — `normalize_payee.ts`

**Files:**
- Create: `src/lib/utils/normalize_payee.ts`
- Test: `src/tests/unit/normalize_payee.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `normalizePayee(s: string | null): string`

- [x] **Step 1: Write the failing test**

Create `src/tests/unit/normalize_payee.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { normalizePayee } from '$lib/utils/normalize_payee';

describe('normalizePayee', () => {
	it('trims whitespace', () => {
		expect(normalizePayee('  starbucks  ')).toBe('starbucks');
	});

	it('lowercases', () => {
		expect(normalizePayee('STARBUCKS')).toBe('starbucks');
	});

	it('collapses internal whitespace', () => {
		expect(normalizePayee('ca   phe')).toBe('ca phe');
	});

	it('handles null input', () => {
		expect(normalizePayee(null)).toBe('');
	});

	it('handles empty string', () => {
		expect(normalizePayee('')).toBe('');
	});

	it('folds Vietnamese diacritics: cà phê → ca phe', () => {
		expect(normalizePayee('cà phê')).toBe('ca phe');
	});

	it('folds Vietnamese diacritics: nguyễn → nguyen', () => {
		expect(normalizePayee('nguyễn')).toBe('nguyen');
	});

	it('folds Vietnamese đ → d', () => {
		expect(normalizePayee('đồng')).toBe('dong');
	});

	it('folds Vietnamese Đ → d', () => {
		expect(normalizePayee('ĐỒNG')).toBe('dong');
	});

	it('handles mixed case + diacritics + whitespace', () => {
		expect(normalizePayee('  CÀ  PHÊ  ')).toBe('ca phe');
	});

	it('preserves non-Vietnamese Unicode (e.g., emoji)', () => {
		expect(normalizePayee('cafe ☕')).toBe('cafe ☕');
	});
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test:watch src/tests/unit/normalize_payee.test.ts`

Expected: FAIL with "Cannot find module '$lib/utils/normalize_payee'"

- [x] **Step 3: Write minimal implementation**

Create `src/lib/utils/normalize_payee.ts`:

```typescript
export function normalizePayee(s: string | null): string {
	if (s === null || s === undefined) return '';

	return (
		s
			.trim()
			.toLowerCase()
			// Normalize to NFC (composed) then NFD (decomposed) so equivalent sequences fold identically
			.normalize('NFC')
			.normalize('NFD')
			// Strip Unicode combining marks (U+0300–U+036F)
			.replace(/[̀-ͯ]/g, '')
			// Vietnamese đ is a distinct letter, not decomposable; replace explicitly
			.replace(/đ/g, 'd')
			.replace(/Đ/g, 'd')
			// Collapse internal whitespace
			.replace(/\s+/g, ' ')
	);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test:watch src/tests/unit/normalize_payee.test.ts`

Expected: All tests PASS

- [x] **Step 5: Commit**

```bash
git add src/lib/utils/normalize_payee.ts src/tests/unit/normalize_payee.test.ts
git commit -m "feat(categorize-rules): add normalizePayee util with Vietnamese diacritic folding"
```

---

### Task 3: Pure util — `rules_matcher.ts`

**Files:**
- Create: `src/lib/utils/rules_matcher.ts`
- Test: `src/tests/unit/rules_matcher.test.ts`

**Interfaces:**
- Consumes: `normalizePayee` from `src/lib/utils/normalize_payee.ts`
- Produces: `matchRules(payee: string | null, rules: CategorizeRuleLite[]): string | null`

- [x] **Step 1: Write the failing test**

Create `src/tests/unit/rules_matcher.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { matchRules, type CategorizeRuleLite } from '$lib/utils/rules_matcher';

describe('matchRules', () => {
	it('returns null for null payee', () => {
		expect(matchRules(null, [])).toBeNull();
	});

	it('returns null for empty payee', () => {
		expect(matchRules('', [])).toBeNull();
	});

	it('returns null for empty rules', () => {
		expect(matchRules('starbucks', [])).toBeNull();
	});

	it('matches exact (is) rule', () => {
		const rules: CategorizeRuleLite[] = [
			{ payee_term: 'starbucks', match_mode: 'is', tag_id: 'tag-1' }
		];
		expect(matchRules('starbucks', rules)).toBe('tag-1');
	});

	it('matches starts_with rule', () => {
		const rules: CategorizeRuleLite[] = [
			{ payee_term: 'star', match_mode: 'starts_with', tag_id: 'tag-1' }
		];
		expect(matchRules('starbucks', rules)).toBe('tag-1');
	});

	it('matches contains rule', () => {
		const rules: CategorizeRuleLite[] = [
			{ payee_term: 'bucks', match_mode: 'contains', tag_id: 'tag-1' }
		];
		expect(matchRules('starbucks', rules)).toBe('tag-1');
	});

	it('ranks is > starts_with > contains', () => {
		const rules: CategorizeRuleLite[] = [
			{ payee_term: 'starbucks', match_mode: 'contains', tag_id: 'tag-contains' },
			{ payee_term: 'star', match_mode: 'starts_with', tag_id: 'tag-starts' },
			{ payee_term: 'starbucks', match_mode: 'is', tag_id: 'tag-is' }
		];
		expect(matchRules('starbucks', rules)).toBe('tag-is');
	});

	it('returns null on tie with different tags', () => {
		const rules: CategorizeRuleLite[] = [
			{ payee_term: 'star', match_mode: 'starts_with', tag_id: 'tag-1' },
			{ payee_term: 'star', match_mode: 'starts_with', tag_id: 'tag-2' }
		];
		expect(matchRules('starbucks', rules)).toBeNull();
	});

	it('returns tag on tie with same tag', () => {
		const rules: CategorizeRuleLite[] = [
			{ payee_term: 'star', match_mode: 'starts_with', tag_id: 'tag-1' },
			{ payee_term: 'starbucks', match_mode: 'starts_with', tag_id: 'tag-1' }
		];
		expect(matchRules('starbucks', rules)).toBe('tag-1');
	});

	it('normalizes payee before matching (case)', () => {
		const rules: CategorizeRuleLite[] = [
			{ payee_term: 'STARBUCKS', match_mode: 'is', tag_id: 'tag-1' }
		];
		expect(matchRules('starbucks', rules)).toBe('tag-1');
	});

	it('normalizes payee before matching (Vietnamese diacritics)', () => {
		const rules: CategorizeRuleLite[] = [
			{ payee_term: 'cà phê', match_mode: 'is', tag_id: 'tag-1' }
		];
		expect(matchRules('ca phe', rules)).toBe('tag-1');
	});

	it('normalizes payee before matching (whitespace)', () => {
		const rules: CategorizeRuleLite[] = [
			{ payee_term: 'ca phe', match_mode: 'is', tag_id: 'tag-1' }
		];
		expect(matchRules('  ca   phe  ', rules)).toBe('tag-1');
	});
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test:watch src/tests/unit/rules_matcher.test.ts`

Expected: FAIL with "Cannot find module '$lib/utils/rules_matcher'"

- [x] **Step 3: Write minimal implementation**

Create `src/lib/utils/rules_matcher.ts`:

```typescript
import { normalizePayee } from './normalize_payee';

export type MatchMode = 'is' | 'starts_with' | 'contains';

export interface CategorizeRuleLite {
	payee_term: string;
	match_mode: MatchMode;
	tag_id: string;
}

const RANK: Record<MatchMode, number> = { is: 3, starts_with: 2, contains: 1 };

export function matchRules(payee: string | null, rules: CategorizeRuleLite[]): string | null {
	if (!payee || rules.length === 0) return null;

	const normalizedPayee = normalizePayee(payee);
	if (!normalizedPayee) return null;

	const matches: CategorizeRuleLite[] = [];

	for (const rule of rules) {
		const normalizedTerm = normalizePayee(rule.payee_term);
		let isMatch = false;

		switch (rule.match_mode) {
			case 'is':
				isMatch = normalizedPayee === normalizedTerm;
				break;
			case 'starts_with':
				isMatch = normalizedPayee.startsWith(normalizedTerm);
				break;
			case 'contains':
				isMatch = normalizedPayee.includes(normalizedTerm);
				break;
		}

		if (isMatch) {
			matches.push(rule);
		}
	}

	if (matches.length === 0) return null;

	// Find the highest rank
	const maxRank = Math.max(...matches.map((m) => RANK[m.match_mode]));
	const topMatches = matches.filter((m) => RANK[m.match_mode] === maxRank);

	// If all top matches target the same tag, return it; otherwise null (ambiguous)
	const uniqueTags = new Set(topMatches.map((m) => m.tag_id));
	if (uniqueTags.size === 1) {
		return topMatches[0].tag_id;
	}

	return null;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test:watch src/tests/unit/rules_matcher.test.ts`

Expected: All tests PASS

- [x] **Step 5: Commit**

```bash
git add src/lib/utils/rules_matcher.ts src/tests/unit/rules_matcher.test.ts
git commit -m "feat(categorize-rules): add matchRules util with specificity ranking"
```

---

### Task 4: Repo — `rules.ts`

**Files:**
- Create: `src/lib/db/repos/rules.ts`
- Test: `src/tests/unit/rules.test.ts`

**Interfaces:**
- Consumes: `DatabaseService`, `ulid`, `AppError`
- Produces: `listRules`, `listAllRules`, `createRule`, `updateRule`, `deleteRule`, `upsertLearned`

- [x] **Step 1: Write the failing test**

Create `src/tests/unit/rules.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import type { DatabaseService } from '$lib/db/service';
import * as rules from '$lib/db/repos/rules';
import * as categories from '$lib/db/repos/categories';

let db: DatabaseService;

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
});

describe('rules repo', () => {
	it('creates a rule', async () => {
		const tag = await categories.createTag(db, { name: 'Food', type: 'expense' });
		const rule = await rules.createRule(db, {
			payee_term: 'starbucks',
			match_mode: 'is',
			tag_id: tag.id,
			source: 'manual'
		});

		expect(rule.payee_term).toBe('starbucks');
		expect(rule.match_mode).toBe('is');
		expect(rule.tag_id).toBe(tag.id);
		expect(rule.source).toBe('manual');
		expect(rule.enabled).toBe(1);
	});

	it('lists enabled, non-deleted rules', async () => {
		const tag = await categories.createTag(db, { name: 'Food', type: 'expense' });
		const r1 = await rules.createRule(db, {
			payee_term: 'starbucks',
			match_mode: 'is',
			tag_id: tag.id,
			source: 'manual'
		});
		const r2 = await rules.createRule(db, {
			payee_term: 'ca phe',
			match_mode: 'contains',
			tag_id: tag.id,
			source: 'learned'
		});

		const list = await rules.listRules(db);
		expect(list).toHaveLength(2);
		expect(list.map((r) => r.id)).toContain(r1.id);
		expect(list.map((r) => r.id)).toContain(r2.id);
	});

	it('excludes disabled rules from listRules', async () => {
		const tag = await categories.createTag(db, { name: 'Food', type: 'expense' });
		const r1 = await rules.createRule(db, {
			payee_term: 'starbucks',
			match_mode: 'is',
			tag_id: tag.id,
			source: 'manual'
		});
		await rules.updateRule(db, r1.id, { enabled: 0 });

		const list = await rules.listRules(db);
		expect(list).toHaveLength(0);
	});

	it('excludes soft-deleted rules from listRules', async () => {
		const tag = await categories.createTag(db, { name: 'Food', type: 'expense' });
		const r1 = await rules.createRule(db, {
			payee_term: 'starbucks',
			match_mode: 'is',
			tag_id: tag.id,
			source: 'manual'
		});
		await rules.deleteRule(db, r1.id);

		const list = await rules.listRules(db);
		expect(list).toHaveLength(0);
	});

	it('listAllRules includes disabled and soft-deleted', async () => {
		const tag = await categories.createTag(db, { name: 'Food', type: 'expense' });
		const r1 = await rules.createRule(db, {
			payee_term: 'starbucks',
			match_mode: 'is',
			tag_id: tag.id,
			source: 'manual'
		});
		await rules.updateRule(db, r1.id, { enabled: 0 });
		const r2 = await rules.createRule(db, {
			payee_term: 'ca phe',
			match_mode: 'contains',
			tag_id: tag.id,
			source: 'learned'
		});
		await rules.deleteRule(db, r2.id);

		const list = await rules.listAllRules(db);
		expect(list).toHaveLength(2);
	});

	it('updates a rule', async () => {
		const tag = await categories.createTag(db, { name: 'Food', type: 'expense' });
		const r1 = await rules.createRule(db, {
			payee_term: 'starbucks',
			match_mode: 'is',
			tag_id: tag.id,
			source: 'manual'
		});

		const updated = await rules.updateRule(db, r1.id, {
			payee_term: 'starbucks coffee',
			match_mode: 'starts_with'
		});

		expect(updated.payee_term).toBe('starbucks coffee');
		expect(updated.match_mode).toBe('starts_with');
	});

	it('soft-deletes a rule', async () => {
		const tag = await categories.createTag(db, { name: 'Food', type: 'expense' });
		const r1 = await rules.createRule(db, {
			payee_term: 'starbucks',
			match_mode: 'is',
			tag_id: tag.id,
			source: 'manual'
		});

		await rules.deleteRule(db, r1.id);

		const list = await rules.listAllRules(db);
		expect(list[0].deleted_at).not.toBeNull();
	});

	it('upsertLearned inserts new rule', async () => {
		const tag = await categories.createTag(db, { name: 'Food', type: 'expense' });
		const rule = await rules.upsertLearned(db, 'starbucks', tag.id);

		expect(rule.payee_term).toBe('starbucks');
		expect(rule.match_mode).toBe('is');
		expect(rule.tag_id).toBe(tag.id);
		expect(rule.source).toBe('learned');
	});

	it('upsertLearned updates existing rule with same normalized payee', async () => {
		const tag1 = await categories.createTag(db, { name: 'Food', type: 'expense' });
		const tag2 = await categories.createTag(db, { name: 'Drinks', type: 'expense' });

		const r1 = await rules.upsertLearned(db, 'ca phe', tag1.id);
		const r2 = await rules.upsertLearned(db, 'cà phê', tag2.id);

		expect(r2.id).toBe(r1.id);
		expect(r2.tag_id).toBe(tag2.id);

		const list = await rules.listRules(db);
		expect(list).toHaveLength(1);
	});
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test:watch src/tests/unit/rules.test.ts`

Expected: FAIL with "Cannot find module '$lib/db/repos/rules'"

- [x] **Step 3: Write minimal implementation**

Create `src/lib/db/repos/rules.ts`:

```typescript
import type { DatabaseService } from '../service';
import { ulid } from '../../utils/id';
import { AppError } from '../../errors';
import { normalizePayee } from '../../utils/normalize_payee';

export type MatchMode = 'is' | 'starts_with' | 'contains';
export type RuleSource = 'manual' | 'learned';

export interface CategorizeRule {
	id: string;
	payee_term: string;
	match_mode: MatchMode;
	tag_id: string;
	source: RuleSource;
	enabled: number;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
}

export interface NewCategorizeRule {
	payee_term: string;
	match_mode: MatchMode;
	tag_id: string;
	source: RuleSource;
}

export interface CategorizeRuleUpdate {
	payee_term?: string;
	match_mode?: MatchMode;
	tag_id?: string;
	source?: RuleSource;
	enabled?: number;
}

function mapError(e: unknown): never {
	throw new AppError('database_error', 'Failed to operate on categorize rules', { cause: e });
}

export async function listRules(db: DatabaseService): Promise<CategorizeRule[]> {
	try {
		return await db.select<CategorizeRule[]>(
			`SELECT * FROM categorize_rules WHERE enabled = 1 AND deleted_at IS NULL ORDER BY created_at DESC`
		);
	} catch (e) {
		mapError(e);
	}
}

export async function listAllRules(db: DatabaseService): Promise<CategorizeRule[]> {
	try {
		return await db.select<CategorizeRule[]>(
			`SELECT * FROM categorize_rules ORDER BY created_at DESC`
		);
	} catch (e) {
		mapError(e);
	}
}

export async function createRule(
	db: DatabaseService,
	input: NewCategorizeRule
): Promise<CategorizeRule> {
	try {
		const id = ulid();
		const now = new Date().toISOString();
		await db.execute(
			`INSERT INTO categorize_rules (id, payee_term, match_mode, tag_id, source, enabled, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
			[id, input.payee_term, input.match_mode, input.tag_id, input.source, now, now]
		);
		const rows = await db.select<CategorizeRule[]>(
			`SELECT * FROM categorize_rules WHERE id = ?`,
			[id]
		);
		return rows[0];
	} catch (e) {
		mapError(e);
	}
}

export async function updateRule(
	db: DatabaseService,
	id: string,
	patch: CategorizeRuleUpdate
): Promise<CategorizeRule> {
	try {
		const sets: string[] = [];
		const params: unknown[] = [];

		if (patch.payee_term !== undefined) {
			sets.push('payee_term = ?');
			params.push(patch.payee_term);
		}
		if (patch.match_mode !== undefined) {
			sets.push('match_mode = ?');
			params.push(patch.match_mode);
		}
		if (patch.tag_id !== undefined) {
			sets.push('tag_id = ?');
			params.push(patch.tag_id);
		}
		if (patch.source !== undefined) {
			sets.push('source = ?');
			params.push(patch.source);
		}
		if (patch.enabled !== undefined) {
			sets.push('enabled = ?');
			params.push(patch.enabled);
		}

		sets.push('updated_at = ?');
		params.push(new Date().toISOString());
		params.push(id);

		await db.execute(`UPDATE categorize_rules SET ${sets.join(', ')} WHERE id = ?`, params);

		const rows = await db.select<CategorizeRule[]>(
			`SELECT * FROM categorize_rules WHERE id = ?`,
			[id]
		);
		return rows[0];
	} catch (e) {
		mapError(e);
	}
}

export async function deleteRule(db: DatabaseService, id: string): Promise<void> {
	try {
		await db.execute(
			`UPDATE categorize_rules SET deleted_at = ?, updated_at = ? WHERE id = ?`,
			[new Date().toISOString(), new Date().toISOString(), id]
		);
	} catch (e) {
		mapError(e);
	}
}

export async function upsertLearned(
	db: DatabaseService,
	payee_term: string,
	tag_id: string
): Promise<CategorizeRule> {
	try {
		const normalized = normalizePayee(payee_term);

		// Fetch all learned rules and filter in JS (normalization is in-memory only)
		const allLearned = await db.select<CategorizeRule[]>(
			`SELECT * FROM categorize_rules WHERE source = 'learned' AND deleted_at IS NULL`
		);

		const existing = allLearned.find(
			(r) => normalizePayee(r.payee_term) === normalized && r.match_mode === 'is'
		);

		if (existing) {
			return await updateRule(db, existing.id, { tag_id });
		}

		return await createRule(db, {
			payee_term,
			match_mode: 'is',
			tag_id,
			source: 'learned'
		});
	} catch (e) {
		mapError(e);
	}
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test:watch src/tests/unit/rules.test.ts`

Expected: All tests PASS

- [x] **Step 5: Commit**

```bash
git add src/lib/db/repos/rules.ts src/tests/unit/rules.test.ts
git commit -m "feat(categorize-rules): add rules repo with CRUD and upsertLearned"
```

---

### Task 5: Store — `rules.svelte.ts`

**Files:**
- Create: `src/lib/stores/rules.svelte.ts`
- Test: `src/tests/unit/rules.svelte.test.ts`

**Interfaces:**
- Consumes: `rules` repo, `matchRules` util, `transactions` repo, `getDb()`
- Produces: `rules` singleton export with `load`, `matchTag`, `create`, `update`, `delete`, `learnRule`

- [x] **Step 1: Write the failing test**

Create `src/tests/unit/rules.svelte.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import type { DatabaseService } from '$lib/db/service';
import * as categories from '$lib/db/repos/categories';
import * as transactions from '$lib/db/repos/transactions';
import * as accounts from '$lib/db/repos/accounts';
import * as rulesRepo from '$lib/db/repos/rules';
import { normalizePayee } from '$lib/utils/normalize_payee';

// Mock getDb to return our test DB
let db: DatabaseService;
vi.mock('$lib/db', () => ({
	getDb: async () => db
}));

// Import after mocking
const { rules } = await import('$lib/stores/rules.svelte');

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
	await rules.load();
});

describe('RulesStore', () => {
	it('matchTag returns null when no rules', () => {
		expect(rules.matchTag('starbucks')).toBeNull();
	});

	it('matchTag returns tag_id when rule matches', async () => {
		const tag = await categories.createTag(db, { name: 'Food', type: 'expense' });
		await rules.create({
			payee_term: 'starbucks',
			match_mode: 'is',
			tag_id: tag.id,
			source: 'manual'
		});

		expect(rules.matchTag('starbucks')).toBe(tag.id);
	});

	it('learnRule creates rule after 3 consistent transactions', async () => {
		const tag = await categories.createTag(db, { name: 'Food', type: 'expense' });
		const account = await accounts.createAccount(db, {
			name: 'Cash',
			type: 'cash',
			currency: 'VND',
			balance: 0
		});

		// Create 3 transactions with same payee + tag
		await transactions.createTransaction(db, {
			kind: 'expense',
			date: '2026-01-01',
			amount: 50000,
			account_id: account.id,
			payee: 'starbucks',
			tag_id: tag.id
		});
		await transactions.createTransaction(db, {
			kind: 'expense',
			date: '2026-01-02',
			amount: 50000,
			account_id: account.id,
			payee: 'starbucks',
			tag_id: tag.id
		});
		await transactions.createTransaction(db, {
			kind: 'expense',
			date: '2026-01-03',
			amount: 50000,
			account_id: account.id,
			payee: 'starbucks',
			tag_id: tag.id
		});

		// Trigger learn
		const result = await rules.learnRule('starbucks', tag.id);

		expect(result.learned).toBe(true);
		expect(result.ruleId).toBeDefined();

		// Verify rule was created
		expect(rules.matchTag('starbucks')).toBe(tag.id);
	});

	it('learnRule groups diacritic variants as same payee', async () => {
		const tag = await categories.createTag(db, { name: 'Food', type: 'expense' });
		const account = await accounts.createAccount(db, {
			name: 'Cash',
			type: 'cash',
			currency: 'VND',
			balance: 0
		});

		// Create 3 transactions with diacritic variants
		await transactions.createTransaction(db, {
			kind: 'expense',
			date: '2026-01-01',
			amount: 50000,
			account_id: account.id,
			payee: 'cà phê',
			tag_id: tag.id
		});
		await transactions.createTransaction(db, {
			kind: 'expense',
			date: '2026-01-02',
			amount: 50000,
			account_id: account.id,
			payee: 'ca phe',
			tag_id: tag.id
		});
		await transactions.createTransaction(db, {
			kind: 'expense',
			date: '2026-01-03',
			amount: 50000,
			account_id: account.id,
			payee: 'CÀ PHÊ',
			tag_id: tag.id
		});

		// Trigger learn with normalized form
		const result = await rules.learnRule('ca phe', tag.id);

		expect(result.learned).toBe(true);

		// Verify rule matches both variants
		expect(rules.matchTag('cà phê')).toBe(tag.id);
		expect(rules.matchTag('ca phe')).toBe(tag.id);
	});

	it('learnRule does not create rule on inconsistent tags', async () => {
		const tag1 = await categories.createTag(db, { name: 'Food', type: 'expense' });
		const tag2 = await categories.createTag(db, { name: 'Drinks', type: 'expense' });
		const account = await accounts.createAccount(db, {
			name: 'Cash',
			type: 'cash',
			currency: 'VND',
			balance: 0
		});

		await transactions.createTransaction(db, {
			kind: 'expense',
			date: '2026-01-01',
			amount: 50000,
			account_id: account.id,
			payee: 'starbucks',
			tag_id: tag1.id
		});
		await transactions.createTransaction(db, {
			kind: 'expense',
			date: '2026-01-02',
			amount: 50000,
			account_id: account.id,
			payee: 'starbucks',
			tag_id: tag2.id
		});
		await transactions.createTransaction(db, {
			kind: 'expense',
			date: '2026-01-03',
			amount: 50000,
			account_id: account.id,
			payee: 'starbucks',
			tag_id: tag1.id
		});

		const result = await rules.learnRule('starbucks', tag1.id);

		expect(result.learned).toBe(false);
	});

	it('learnRule does not create rule with fewer than 3 transactions', async () => {
		const tag = await categories.createTag(db, { name: 'Food', type: 'expense' });
		const account = await accounts.createAccount(db, {
			name: 'Cash',
			type: 'cash',
			currency: 'VND',
			balance: 0
		});

		await transactions.createTransaction(db, {
			kind: 'expense',
			date: '2026-01-01',
			amount: 50000,
			account_id: account.id,
			payee: 'starbucks',
			tag_id: tag.id
		});
		await transactions.createTransaction(db, {
			kind: 'expense',
			date: '2026-01-02',
			amount: 50000,
			account_id: account.id,
			payee: 'starbucks',
			tag_id: tag.id
		});

		const result = await rules.learnRule('starbucks', tag.id);

		expect(result.learned).toBe(false);
	});

	it('learnRule no-ops on empty payee', async () => {
		const tag = await categories.createTag(db, { name: 'Food', type: 'expense' });
		const result = await rules.learnRule('', tag.id);
		expect(result.learned).toBe(false);
	});

	it('learnRule no-ops on empty tag_id', async () => {
		const result = await rules.learnRule('starbucks', '');
		expect(result.learned).toBe(false);
	});
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test:watch src/tests/unit/rules.svelte.test.ts`

Expected: FAIL with "Cannot find module '$lib/stores/rules.svelte'"

- [x] **Step 3: Write minimal implementation**

Create `src/lib/stores/rules.svelte.ts`:

```typescript
import { getDb } from '$lib/db';
import * as rulesRepo from '$lib/db/repos/rules';
import * as transactionsRepo from '$lib/db/repos/transactions';
import { matchRules, type CategorizeRuleLite } from '$lib/utils/rules_matcher';
import { normalizePayee } from '$lib/utils/normalize_payee';
import { mapError } from '$lib/utils/errors';

class RulesStore {
	items = $state<rulesRepo.CategorizeRule[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);

	get active(): CategorizeRuleLite[] {
		return this.items
			.filter((r) => r.enabled === 1 && r.deleted_at === null)
			.map((r) => ({
				payee_term: r.payee_term,
				match_mode: r.match_mode,
				tag_id: r.tag_id
			}));
	}

	async load(): Promise<void> {
		this.loading = true;
		this.error = null;
		try {
			const db = await getDb();
			this.items = await rulesRepo.listAllRules(db);
		} catch (e) {
			this.error = mapError(e);
		} finally {
			this.loading = false;
		}
	}

	matchTag(payee: string | null): string | null {
		return matchRules(payee, this.active);
	}

	async create(input: rulesRepo.NewCategorizeRule): Promise<rulesRepo.CategorizeRule> {
		const db = await getDb();
		const rule = await rulesRepo.createRule(db, input);
		await this.load();
		return rule;
	}

	async update(id: string, patch: rulesRepo.CategorizeRuleUpdate): Promise<rulesRepo.CategorizeRule> {
		const db = await getDb();
		const rule = await rulesRepo.updateRule(db, id, patch);
		await this.load();
		return rule;
	}

	async delete(id: string): Promise<void> {
		const db = await getDb();
		await rulesRepo.deleteRule(db, id);
		await this.load();
	}

	async learnRule(payee: string, tag_id: string): Promise<{ learned: boolean; ruleId?: string }> {
		if (!payee || !tag_id) {
			return { learned: false };
		}

		try {
			const db = await getDb();

			// Fetch last 50 transactions
			const recent = await transactionsRepo.listTransactions(db, {
				limit: 50
			});

			// Normalize each payee and find matches
			const normalizedInput = normalizePayee(payee);
			const matches = recent
				.filter((t) => t.payee && normalizePayee(t.payee) === normalizedInput)
				.slice(0, 3);

			// Need at least 3
			if (matches.length < 3) {
				return { learned: false };
			}

			// Check if all 3 have the same tag_id
			const tagIds = new Set(matches.map((t) => t.tag_id));
			if (tagIds.size !== 1) {
				return { learned: false };
			}

			// All consistent — upsert learned rule
			const rule = await rulesRepo.upsertLearned(db, payee, tag_id);
			await this.load();

			return { learned: true, ruleId: rule.id };
		} catch (error) {
			// Log but don't throw — learning failure must not break save
			console.error('Failed to learn rule:', error);
			return { learned: false };
		}
	}
}

export const rules = new RulesStore();
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test:watch src/tests/unit/rules.svelte.test.ts`

Expected: All tests PASS

- [x] **Step 5: Commit**

```bash
git add src/lib/stores/rules.svelte.ts src/tests/unit/rules.svelte.test.ts
git commit -m "feat(categorize-rules): add RulesStore singleton with matchTag and learnRule"
```

---

### Task 6: Integrate with `TransactionForm.svelte`

**Files:**
- Modify: `src/lib/components/forms/TransactionForm.svelte`

**Interfaces:**
- Consumes: `rules` store from `$lib/stores/rules.svelte.ts`
- Produces: Auto-fill `tagId` from payee; call `learnRule` after save

- [x] **Step 1: Import rules store**

Open `src/lib/components/forms/TransactionForm.svelte`. Add the import after the other store imports (around line 6-11):

```typescript
import { rules } from '$lib/stores/rules.svelte';
```

- [x] **Step 2: Add auto-fill logic**

After the existing `$state` declarations (around line 37), add:

```typescript
let suggestedTag = $derived(rules.matchTag(payee));

$effect(() => {
	// Auto-fill tagId when payee matches a rule and user hasn't manually selected a tag
	if (suggestedTag && !tagId) {
		tagId = suggestedTag;
	}
});
```

- [x] **Step 3: Call learnRule after successful save**

In the `save()` function, after the `transactions.create()` call succeeds (around line 118-122), add:

```typescript
// Learn rule from this transaction (fire-and-forget)
if (payee && tagId && kind !== 'transfer') {
	rules.learnRule(payee, tagId).catch(() => {
		// Learning failure is non-fatal; logged in learnRule
	});
}
```

The full save block should look like:

```typescript
} else {
	await transactions.create({
		kind,
		date,
		amount: parsedAmount,
		account_id: accountId,
		transfer_account_id: kind === 'transfer' ? transferAccountId : undefined,
		tag_id: kind !== 'transfer' ? (tagId || undefined) : undefined,
		payee: payee || undefined,
		description: description || undefined
	});

	// Learn rule from this transaction (fire-and-forget)
	if (payee && tagId && kind !== 'transfer') {
		rules.learnRule(payee, tagId).catch(() => {
			// Learning failure is non-fatal; logged in learnRule
		});
	}

	session.lastUsedAccountId = accountId;
	session.lastEnteredDate = date;
	toast.show(m.forms_saved({ kind, amount: formatCurrency(parsedAmount, settings.currency, settings.locale) }));
	sessionStorage.removeItem(DRAFT_KEY);
	amount = '';
	tagId = '';
	payee = '';
	description = '';
}
```

- [x] **Step 4: Run all tests to verify no regressions**

Run: `pnpm test`

Expected: All tests PASS

- [x] **Step 5: Commit**

```bash
git add src/lib/components/forms/TransactionForm.svelte
git commit -m "feat(categorize-rules): integrate auto-fill and learnRule into TransactionForm"
```

---

### Task 7: E2E test

**Files:**
- Create: `src/tests/e2e/categorize-rules.spec.ts`

**Interfaces:**
- Consumes: Playwright test harness, `onboardedPage` fixture, `addTransaction` helper

- [x] **Step 1: Write the E2E test**

Create `src/tests/e2e/categorize-rules.spec.ts`:

```typescript
import { test, expect } from './fixtures/onboarded';
import { addTransaction } from './helpers/ui';

test.describe('Categorize Rules Engine', () => {
	test('auto-fills tag after 3 consistent transactions', async ({ onboardedPage: page }) => {
		// Create 3 transactions with same payee + tag
		await addTransaction(page, { kind: 'expense', amount: '50k', payee: 'starbucks', tag: 'Food' });
		await addTransaction(page, { kind: 'expense', amount: '50k', payee: 'starbucks', tag: 'Food' });
		await addTransaction(page, { kind: 'expense', amount: '50k', payee: 'starbucks', tag: 'Food' });

		// Create 4th transaction — tag should auto-fill
		await page.getByRole('button', { name: /\+?\s*Add transaction/i }).click();
		const modal = page.getByRole('dialog');
		await modal.getByLabel('Payee').fill('starbucks');

		// Wait for auto-fill (effect runs after payee changes)
		await page.waitForTimeout(500);

		// Verify tag is auto-filled (Autocomplete should show "Food")
		const tagInput = modal.getByLabel('Category');
		await expect(tagInput).toHaveValue('Food');
	});

	test('auto-fills tag with Vietnamese diacritic variant', async ({ onboardedPage: page }) => {
		// Create 3 transactions with diacritic variants
		await addTransaction(page, { kind: 'expense', amount: '50k', payee: 'cà phê', tag: 'Food' });
		await addTransaction(page, { kind: 'expense', amount: '50k', payee: 'ca phe', tag: 'Food' });
		await addTransaction(page, { kind: 'expense', amount: '50k', payee: 'CÀ PHÊ', tag: 'Food' });

		// Create 4th transaction with normalized form — tag should auto-fill
		await page.getByRole('button', { name: /\+?\s*Add transaction/i }).click();
		const modal = page.getByRole('dialog');
		await modal.getByLabel('Payee').fill('ca phe');

		// Wait for auto-fill
		await page.waitForTimeout(500);

		// Verify tag is auto-filled
		const tagInput = modal.getByLabel('Category');
		await expect(tagInput).toHaveValue('Food');
	});
});
```

- [x] **Step 2: Run E2E test**

Run: `pnpm test:e2e src/tests/e2e/categorize-rules.spec.ts`

Expected: All tests PASS

- [x] **Step 3: Commit**

```bash
git add src/tests/e2e/categorize-rules.spec.ts
git commit -m "test(categorize-rules): add E2E tests for auto-fill and Vietnamese diacritics"
```

---

### Task 8: i18n strings + auto indicator

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/vi.json`
- Modify: `src/lib/components/forms/TransactionForm.svelte`

- [x] **Step 1: Add i18n strings**

Add to `messages/en.json`:

```json
{
	"forms_tag_auto": "Auto"
}
```

Add to `messages/vi.json`:

```json
{
	"forms_tag_auto": "Tự động"
}
```

- [x] **Step 2: Regenerate Paraglide**

Run: `pnpm check`

Expected: Paraglide regenerates, no errors

- [x] **Step 3: Update TransactionForm to show "auto" indicator**

In `TransactionForm.svelte`, after the `<Autocomplete>` for tag (around line 161), add:

```svelte
{#if suggestedTag && tagId === suggestedTag}
	<span class="text-xs text-dim mt-1">{m.forms_tag_auto()}</span>
{/if}
```

The full tag section should look like:

```svelte
<Autocomplete label={m.forms_tag()} bind:value={tagId} options={tagOptions} placeholder={m.forms_search_tags_placeholder()} />
{#if suggestedTag && tagId === suggestedTag}
	<span class="text-xs text-dim mt-1">{m.forms_tag_auto()}</span>
{/if}
```

- [x] **Step 4: Commit**

```bash
git add messages/en.json messages/vi.json src/lib/components/forms/TransactionForm.svelte
git commit -m "feat(categorize-rules): add i18n strings and auto indicator"
```

---

## Summary

**Total tasks:** 8

**Estimated effort:** 2-3 days for a developer familiar with the codebase

**Risk areas:**
- Migration 005 schema-version call sites (Task 1, Step 3) — must update all `importDatabase`/`validateImport` literals
- Cross-window cache refresh (deferred — not implemented in this plan; future spec can add Tauri event)
- Management UI (deferred — engine works via auto-learn; manual CRUD is future work)

**Out of scope (per spec):**
- Batch/retroactive rule application
- Import-time rule application
- Multi-condition rules
- Regex conditions
- Explicit rule priority/ordering
- Cross-device sync
