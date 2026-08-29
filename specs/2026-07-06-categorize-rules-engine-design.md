# Categorize Rules Engine — Design
**Serves:** STORY-007

**Date:** 2026-07-06
**Status:** Design (pending implementation plan)
**Branch:** `feat/actual`

## Summary

Add a minimal rules engine that auto-categorizes transactions by payee and learns categorization rules from history. This fills Notchy's most conspicuous gap — every transaction today is categorized by hand — while preserving the existing UI → stores → repos → DB architecture. No new architectural layer is introduced; the engine composes the existing ones.

Inspired by Actual Budget's insight that *learned categorization is itself rules* (auto-generate an inspectable `{payee → category}` rule after repeated consistency, rather than hidden magic). Deliberately minimal: payee-only conditions, single action, manual-entry-time application only.

## Goals

- Auto-fill a transaction's category (tag) when its payee matches a known rule, at the moment of manual entry.
- Learn categorization rules passively from the user's own consistent behavior, surfaced as inspectable/editable rules (not hidden state).
- Keep the riskiest logic — payee matching and specificity ranking — in a pure, unit-testable function with no DB or Svelte dependency.
- Fit the existing layering and conventions exactly: pure util + runes store + repo + migration.

## Non-goals (explicit YAGNI)

- Batch/retroactive application of rules to existing transactions.
- Import-time rule application (no import feature exists yet; no stub).
- Multi-condition rules (amount, account, notes), AND/OR combinators.
- Regex conditions, multiple actions per rule, split generation, formula/template values.
- Pre/post rule stages, payee renaming.
- Explicit user-facing rule priority/ordering. Specificity alone resolves conflicts.
- Sync of rules across devices.

## Decisions (locked during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Rule power | **Minimal** — payee condition, single set-tag action | Covers ~90% of real auto-categorization; smallest schema/UI |
| Trigger | **Manual entry only** | Predictable; no retroactive changes; no background jobs |
| Auto-learn | **Passive auto-create** after N consistent transactions | Biggest UX win; learning becomes inspectable rules |
| Conflict resolution | **Specificity-based** (`is` > `starts_with` > `contains`) | Deterministic, matches intuition, no priority column |
| Architecture | **Approach A** — pure matcher util + cached rules store | Riskiest logic isolated & TDD-friendly; mirrors `number_parse` + stores |

## Architecture

The engine extends the existing stack without crossing layer boundaries:

```
TransactionForm.svelte (UI)
  ├─ bind category field to matcher; show "auto" indicator
  └─ after save → rules.learnRule(payee, tagId)
        ↓
    rules.svelte.ts (store, runes)
      holds $state rules[] cache; exposes matchTag(payee); CRUD; learnRule()
        ├─→ rules_matcher.ts (PURE util, like number_parse.ts)
        │     matchRules(payee, rules) → best tag_id by specificity, or null
        └─→ rules.ts (repo, like transactions.ts)
              CRUD against categorize_rules table; SQL only
                ↓
              DatabaseService → SQLite
```

### Unit responsibilities

| Unit | Responsibility | Depends on | Test approach |
|---|---|---|---|
| `src/lib/utils/rules_matcher.ts` | Pure: given `(payee, rules[])`, return best `tag_id` by specificity or `null`. Ranks `is` > `starts_with` > `contains`. | Nothing | Pure-function unit tests, edge cases |
| `src/lib/db/repos/rules.ts` | SQL CRUD on `categorize_rules` table. No business logic. | `DatabaseService` | DB-pattern tests (`createTestDb` + migrations) |
| `src/lib/stores/rules.svelte.ts` | Loads rules into `$state` cache; exposes `matchTag`; CRUD that writes DB then refreshes cache; `learnRule` auto-learn brain. | repo + matcher | Component/integration-level |

Auto-learn lives in the rules store, not the transactions store: the transactions store already owns `createTransaction`; after a successful save it calls `rules.learnRule(payee, tag_id)`, delegating the consistency-check and rule-creation logic to the rules store. This keeps each unit single-purpose.

## Data model

New migration `src/lib/db/migrations/005_categorize_rules.ts`, registered in `index.ts`.

```sql
CREATE TABLE IF NOT EXISTS categorize_rules (
    id          TEXT PRIMARY KEY,                              -- ULID
    payee_term  TEXT NOT NULL CHECK (length(payee_term) BETWEEN 1 AND 128),
    match_mode  TEXT NOT NULL CHECK (match_mode IN ('is', 'starts_with', 'contains')),
    tag_id      TEXT NOT NULL REFERENCES category_tags(id),
    source      TEXT NOT NULL DEFAULT 'manual'
               CHECK (source IN ('manual', 'learned')),        -- provenance: user vs auto-learned
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT                                           -- soft-delete, matches project convention
);
CREATE INDEX IF NOT EXISTS idx_categorize_rules_enabled
    ON categorize_rules(enabled, deleted_at);
```

### Column rationale

- **`payee_term` + `match_mode`** — the condition. Splitting the operator out (`is`/`starts_with`/`contains`) makes specificity ranking unambiguous. One string field plus an enum beats cramming `is:STARBUCKS` into a single blob.
- **`tag_id`** — the action (set category). FK to `category_tags`, so a deleted/moved tag can be cleaned up.
- **`source` (`manual` | `learned`)** — provenance. Lets the UI distinguish "you made this" from "Notchy learned this," and lets a user wipe learned rules in one action without touching manual ones. Cheap insurance for trust in auto-learn.
- **`enabled`** — disable without delete.
- **`deleted_at`** — soft-delete, consistent with every other table. The `002_triggers` change-log and any future sync layer expect this.

### Deliberate omissions

- **No `priority`/`sort_order` column.** Specificity (`is` > `starts_with` > `contains`) resolves all conflicts deterministically.
- **No `conditions_op` or multiple condition fields.** Minimal scope, payee-only.
- **No `UNIQUE(payee_term, match_mode)` constraint.** Auto-learn may create `{is: "STARBUCKS"}` while a manual `{contains: "STARBUCKS"}` exists — different modes, both valid; specificity resolves which wins. Duplicate *identical* rules (same term + mode) are de-duped in the store's `learnRule` (upsert) rather than by a DB constraint that would reject legitimate near-matches.

The matching layer never touches SQL — specificity ranking lives in the pure `rules_matcher.ts`. The repo loads enabled, non-deleted rules; the util ranks them. This honors the "pure function, no DB" discipline.

## Vietnamese-aware normalization

Vietnamese (`vi`) is a primary locale, and Vietnamese input frequently varies in diacritics — most often when typed quickly via the quick-add tray: `ca phe` vs `cà phê`, `cho` vs `chợ`, `nguyen` vs `nguyễn`. Naive "trim + lowercase" matching is **diacritic-sensitive**, so it would (a) fail to auto-fill a tag learned from `cà phê` when the next transaction is typed `ca phe`, and (b) never group diacritic variants together for the 3-transaction auto-learn query, so learning would often not fire. For a Vi-first app this is a primary path, not an edge case.

Fix: one new pure util, `src/lib/utils/normalize_payee.ts`, reused by both matching and learning (mirrors how `number_parse.ts` is locale-aware and pure):

```typescript
export function normalizePayee(s: string | null): string;
// trim → lowercase → collapse internal whitespace → NFC compose →
// NFD decompose → strip Unicode combining marks (U+0300–U+036F) → đ→d, Đ→d
```

- **Combining-mark stripping** handles `á→a, ạ→a, ơ→o, ư→u, ê→e` (standard diacritic folding via NFD).
- **Explicit `đ→d`** is required because Vietnamese `đ` is a distinct letter, not a decomposable combining form — NFD leaves it untouched. This is the detail a generic "strip accents" util gets wrong.
- **NFC compose first** to normalize equivalent byte sequences before decomposing (so a precomposed `á` and a decomposed `a` + combining-acute fold identically).

Normalization is **on by default** and applied symmetrically to both the input payee and each rule's `payee_term`, in-memory only. Rules store `payee_term` as the user typed it (`cà phê`); the management UI shows real names. `is`-match means "exact after normalization," so exact-match users lose nothing and everyone gets typo/diacritic tolerance. There is no opt-out toggle — folding only makes matching more correct, never less, and a toggle would add UI surface for no real benefit.

`normalizePayee` is pure and DB-free, so it is trivially unit-testable with Vi fixtures (`cà phê` ↔ `ca phe`, `nguyễn` ↔ `nguyen`, `đ` ↔ `d`). This keeps all Unicode logic in the pure layer; SQLite never sees Unicode collation complexity.

## The three units

### Unit 1 — `src/lib/utils/rules_matcher.ts` (pure)

```typescript
export type MatchMode = 'is' | 'starts_with' | 'contains';
export interface CategorizeRuleLite {
    payee_term: string;
    match_mode: MatchMode;
    tag_id: string;
}

// Specificity ranking. `is` strongest (exact), `starts_with` next, `contains` weakest.
const RANK: Record<MatchMode, number> = { is: 3, starts_with: 2, contains: 1 };

export function matchRules(payee: string | null, rules: CategorizeRuleLite[]): string | null;
```

Behavior:
- **Normalization** — `normalizePayee(payee)` and `normalizePayee(rule.payee_term)` applied before comparing (see the Vietnamese-aware normalization section). So `STARBUCKS #4` and `starbucks #4` match, and `cà phê` matches `ca phe`.
- **Selection** — collect all matching rules; return the `tag_id` of the highest-ranked.
- **Ties within the same rank** — if two rules of equal rank match and target *different* tags, there is no deterministic winner. Return `null` (no auto-fill); the user picks manually. This avoids silently choosing an arbitrary category.
- **Empty/null payee** — return `null` immediately.

### Unit 2 — `src/lib/db/repos/rules.ts`

SQL CRUD only, mirroring `transactions.ts` conventions (soft-delete, `mapError`):

- `listRules(db)` → enabled, non-deleted rules (the matcher's input).
- `listAllRules(db)` → includes disabled + soft-deleted (for the management UI).
- `createRule(db, input)` / `updateRule(db, id, patch)` / `deleteRule(db, id)` (soft-delete).
- `upsertLearned(db, payee_term, tag_id)` — insert or update the `source:'learned'`, `match_mode:'is'` rule for a given exact payee.

### Unit 3 — `src/lib/stores/rules.svelte.ts`

Runes store, mirroring `accounts.svelte.ts`:

- `items = $state<CategorizeRule[]>([])` cache; `load()` from repo.
- `get active()` — getter filtering to enabled + non-deleted; feeds the matcher.
- `matchTag(payee: string | null): string | null` — pure delegation to `matchRules(payee, this.active)`.
- `create / update / delete` — write DB via repo, then refresh cache (`load()`).
- **`learnRule(payee, tag_id)`** — the auto-learn brain:
  - Guard: no-op if `payee` empty/null or `tag_id` empty.
  - Group the recent transactions **in JS by `normalizePayee(payee)`** — not via SQL `WHERE payee = ?`, which is diacritic-sensitive and would never group `ca phe` + `cà phê` (see the Vietnamese-aware normalization section). Fetch the last **50** transactions (ordered `date DESC, created_at DESC`), normalize each payee, and take the N = 3 most recent whose normalized payee equals `normalizePayee(inputPayee)`. The 50-row window bounds the query cost; a payee that hasn't appeared in 50 transactions is no longer a strong enough signal to learn from.
  - If all 3 share the same `tag_id` → `upsertLearned(db, inputPayee, tag_id)`. Store the payee as the user typed it (not the normalized form); `match_mode:'is'` means "exact after normalization." An existing learned rule for a normalized-payee match updates its `tag_id` rather than duplicating.
  - If fewer than N transactions, or inconsistent tags → no-op. No partial learning, no prompts.
  - Must not throw into the save path; failures are logged and surfaced as a toast at most.

## Integration — `TransactionForm.svelte`

The manual-entry-only trigger. Integration is two small additions to the existing form (`src/lib/components/forms/TransactionForm.svelte`):

1. **Auto-fill (`$derived`):** when `payee` changes and `tagId` is empty (user hasn't picked), compute `suggestedTag = rules.matchTag(payee)`. If non-null, set `tagId = suggestedTag` and show a small "auto" indicator beside the tag field. New i18n string, e.g. `forms_tag_auto`, added to both `messages/en.json` and `messages/vi.json`.

   **Only auto-fills when `tagId` is empty** — never overwrites a user's explicit choice. This is the "no retroactive surprises" guarantee.

2. **Learn (post-save):** the save flow is unchanged except that after `createTransaction`/`updateTransaction` succeeds, call `rules.learnRule(payee, tagId)`. Fire-and-forget; a learning failure must not fail the save (wrapped; surfaces a toast only if it throws).

`learnRule` is the *only* place learning happens; the form's `$derived` is the *only* place matching happens. No other call sites.

## Management UI (minimal)

A simple route/view to list, create, edit, enable/disable, and delete rules — so learned rules are inspectable (the core trust requirement of auto-learn). Distinguishes `manual` vs `learned` via the `source` column. Scope: list + create + edit + delete + toggle. Out of scope for this design's first pass if time-constrained, but the schema and store support it from day one; the engine is fully usable via auto-learn even without a manual-creation UI.

## Error handling

- **Migration** — idempotent (PRAGMA-check before `CREATE TABLE IF NOT EXISTS`, following the `004_rollover_toggle.ts` pattern and the migration-idempotency-race memory note). Bumps `schema_version`.
- **Schema-version call sites** — per the project gotcha, bumping the schema version requires updating *all* `importDatabase`/`validateImport` version literals (UI, unit, E2E fixtures). Flagged for the implementation plan; updating only some breaks E2E silently.
- **Matcher** — pure function, cannot throw for valid input; returns `null` for no-match / ambiguity / empty input.
- **learnRule** — wraps repo calls; never rejects from the caller's perspective. Save success is independent of learning success.
- **Stale cache** — store refreshes via `load()` after every mutation; the single-writer desktop model means no cross-window cache invalidation is needed for the rules list itself (rules are read into the form's `$derived` fresh per render). Cross-window transaction events (`transaction:saved`) already exist; the learn step rides the save in the window that performed it.

## Testing

Following project TDD discipline (red-green-refactor) and the "do not mock the DB / pure functions" conventions:

- **`normalize_payee.test.ts`** (pure) — Vietnamese fixtures: `cà phê` ↔ `ca phe`, `nguyễn` ↔ `nguyen`, `đ` ↔ `d` (the `đ→d` case a generic accent-stripper misses), case + whitespace folding, null/empty input.
- **`rules_matcher.test.ts`** (pure) — exhaustive edge cases:
  - exact `is` beats `starts_with` beats `contains` for the same payee.
  - normalization (case, whitespace, **and diacritics**: `is cà phê` matches input `ca phe`) matches.
  - tie within same rank targeting different tags → `null`.
  - tie within same rank targeting the same tag → that tag.
  - empty/null payee → `null`.
  - no rules / no match → `null`.
- **`rules.test.ts`** (repo, DB-pattern with `createTestDb` + `runMigrations`) — create/read/update/soft-delete; `upsertLearned` inserts then updates; `listRules` filters enabled + non-deleted.
- **`rules.svelte.test.ts`** (store) — `matchTag` delegates correctly; `learnRule` groups diacritic-variant payees (`ca phe` + `cà phê`) as the same payee via normalization and creates a rule after 3 consistent, no-op on inconsistency or < 3, upserts existing.
- **Component test** — `TransactionForm` auto-fills `tagId` from payee when empty, does not overwrite a manually-set tag, calls `learnRule` after save.
- **E2E** — create 3 transactions with the same payee + tag; a 4th transaction with the same payee auto-fills the tag. Plus a Vietnamese variant: 3 transactions under `cà phê`, then a 4th typed `ca phe` (no diacritics) still auto-fills the same tag. (E2E uses the sql.js in-memory fallback per project setup.)

## Migration / rollout

- Single additive migration (`005`). No data backfill (no transactions to recategorize — rules are forward-only by design).
- No feature flag needed; auto-learn is passive and only creates rules after user consistency.

## Open questions

None at design time. Defaults are pinned in the body: **N = 3** consistent transactions, ordered `date DESC, created_at DESC`, learned rules use `match_mode:'is'`, normalization folds diacritics + `đ→d` and is on by default. The implementation plan may revisit these values but should treat them as the baseline.
