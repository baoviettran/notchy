# Notchy — Project Guide

## Overview
Local-first personal finance app built with **SvelteKit 5 + Tauri v2**. SQLite database, Svelte 5 runes, Paraglide JS i18n (`en` + `vi`). No cloud dependency. Desktop-first; a web build is planned for v0.2.

## Environment
- **Node** 22.22.3 · **pnpm** 10.11.0 (see `package.json` `engines`)
- **Rust + Tauri** 2.5 (stable toolchain; `src-tauri/`)
- Install deps: `pnpm install`
- Tauri prerequisites: system WebView + Rust toolchain installed (`pnpm tauri dev` will fail otherwise)

## Key Commands
- `pnpm dev` — Vite dev server (web). Note: Paraglide compiles first.
- `pnpm tauri dev` — Launch the desktop app (use this for desktop-only features).
- `pnpm build` — Production web build.
- `pnpm check` — TypeScript + Svelte check (`svelte-kit sync` runs first).
- `pnpm test` — Unit tests (Vitest, run once).
- `pnpm test:watch` — Watch mode.
- `pnpm test:coverage` — Unit tests with coverage.
- `pnpm test:e2e` — Playwright E2E.

## TDD Discipline

**Red-Green-Refactor. No exceptions.**

1. **Write the test first.** Before implementing any feature or fixing any bug, write a failing test.
2. **Watch it fail.** Run `pnpm test:watch` and confirm the test fails with the expected error.
3. **Implement minimum code** to pass.
4. **Refactor** while keeping tests green.
5. **All tests must pass before committing.** Run `pnpm test` as a pre-commit check.

### Exceptions (ask first)
- Throwaway prototypes, generated code, configuration files

## Testing Conventions

### File Locations
- Unit tests: `src/tests/unit/<module>.test.ts`
- Component tests: `src/tests/unit/components/<Component>.test.ts`
- E2E tests: `src/tests/e2e/<feature>.spec.ts`
- Test helpers: `src/tests/unit/helpers/`
- E2E fixtures/helpers: `src/tests/e2e/fixtures/`, `src/tests/e2e/helpers/`

### Test DB Pattern
For DB-dependent tests, use the in-memory test DB:
```typescript
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';

let db: DatabaseService;
beforeEach(async () => {
  db = createTestDb();
  await runMigrations(db, migrations);
});
```

### Pure Function Tests
No setup needed. Import the function, test edge cases.

### Component Tests (Svelte 5)
- Use `@testing-library/svelte` with `// @vitest-environment jsdom` directive
- Prefer `render` + `screen` + `fireEvent`. Test behavior, not implementation.
- Svelte 5 snippet children: `render(Component, { children: 'text' })`

### Naming
- `describe('<function or feature>')` wrapping `it('does X when Y')`
- Imperative mood: "returns", "throws", "creates"

### What NOT to Mock
- Do not mock the database. Use `createTestDb()` (real SQLite in-memory).
- Do not mock utility functions. Call them directly.
- Only mock external APIs (none exist yet).

### E2E
- Runs against the web build with a `sql.js` in-memory fallback behind `isTauri()`. OS-level desktop features (tray, global shortcuts) are **not** exercisable from Playwright — verify those manually in `pnpm tauri dev`.

## Architecture
```
UI (Svelte 5 components, $props, $state, $derived, $effect)
  → Stores (runes-based, call repos)
    → Repositories (SQL queries against DatabaseService)
      → DatabaseService (SAVEPOINT transactions)
        → SQLite (Tauri plugin in desktop, sql.js in E2E, better-sqlite3 in unit tests)
```

### Directory map
```
src/lib/
  components/    Svelte 5 UI components
  stores/        runes-based stores (*.svelte.ts) — call repos
  db/
    repos/       SQL repositories (transactions, accounts, budgets, meta, …)
    migrations/  numbered migrations; index.ts registers them
    service.ts   DatabaseService (SAVEPOINT transactions)
    pragmas.ts   SQLite pragmas
    integrity.ts data integrity checks
    in-memory.ts test/sql.js DB construction
  utils/         id.ts (ULID), number_parse.ts, sanitize.ts, quick_parse.ts, …
  paraglide/     GENERATED — compiled from messages/*.json (gitignored)
  errors.ts      AppError + error codes
src/routes/      SvelteKit pages (+layout.svelte is the app shell)
src/tests/       unit/ and e2e/
src-tauri/       Rust desktop host (lib.rs builder, capabilities/, tauri.conf.json)
messages/        Paraglide source strings — en.json, vi.json
specs/           design specs + specs/plans/ implementation plans
static/          static assets
```

### Key files
- `src/routes/+layout.svelte` — app shell, DB/settings init, transaction modal, cross-window listener registration.
- `src/lib/db/migrations/index.ts` — migration registry; append new migrations here.
- `src/lib/db/repos/transactions.ts` — `createTransaction` / single-row transfer model.
- `src/lib/utils/number_parse.ts` — locale-aware `parseAmount` (expands `k`/`m`/`tr`); keep pure.
- `src-tauri/src/lib.rs` — Tauri builder, plugin registration, tray/shortcut setup.
- `src-tauri/capabilities/default.json` — Tauri permissions (window labels + plugin perms).

## i18n Workflow (Paraglide JS)
- **Source strings** live in `messages/en.json` and `messages/vi.json` — flat underscore keys (e.g. `forms_amount_placeholder`). **No dotted IDs** (Paraglide 1.11.8 rejects them).
- Paraglide compiles to `src/lib/paraglide/messages/` — this is **gitignored/generated**; never hand-edit. It runs automatically as part of `dev`, `build`, and `check`.
- Use in components: `import * as m from '$lib/paraglide/messages'; m.forms_amount_placeholder()`.
- Adding a string: edit both `messages/en.json` and `messages/vi.json`, then run `pnpm check` (or `pnpm exec paraglide-js compile …`) to regenerate.

## Conventions
- Amounts are always integers (smallest currency unit). No floats.
- Commit prefix: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
- Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`), not legacy stores
- IDs are ULIDs (custom implementation in `src/lib/utils/id.ts`)
- Supports `en` and `vi` locales
- Transactions are a single-row model (transfers share a `transfer_pair_id`).

## Repo Layout — `docs/` submodule & specs/plans
- `docs/` is a **git submodule** (`notchy-docs`), not part of the main repo. Anything written under `docs/` is invisible to the main repo's commits.
- **Design specs** live at `specs/` (repo root), e.g. `specs/2026-07-01-v0.1.x-quality-of-life-design.md`.
- **Implementation plans** live at `specs/plans/`, e.g. `specs/plans/2026-07-01-v0.1.2-tray-quick-capture.md`.
- Ignore the superpowers skill's default `docs/superpowers/specs/` and `docs/superpowers/plans/` paths — redirect both to `specs/` and `specs/plans/` respectively.

## Gotchas
- **`docs/` is a submodule** — see Repo Layout above. Files under `docs/` will not commit with the main repo.
- **Schema-version call sites** — every migration that bumps the schema version must update *all* `importDatabase`/`validateImport` version literals (UI, unit, E2E fixtures). Updating only some breaks E2E silently.
- **Paraglide flat keys** — pinned at 1.11.8; namespacing is an underscore prefix, not nested keys. 2.x upgrade was rejected (bracket access, not nested objects).
- **Per-window JS context** — each Tauri webview is a separate JS context with its own `DatabaseService` singleton and Svelte stores. Cross-window updates require Tauri events (e.g. `transaction:saved`), not shared store state.
- **`parseAmount` is pure** — tokenizer features (`quick_parse.ts`) must not expand `k`/`m`/`tr`; `parseAmount` already does and is locale-aware.
