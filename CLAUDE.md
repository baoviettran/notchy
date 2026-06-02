# Notchy — Project Guide

## Overview
Local-first personal finance app built with SvelteKit 5 + Tauri v2. SQLite database, Svelte 5 runes, Paraglide JS i18n. No cloud dependency.

## Key Commands
- `pnpm test` — Run unit tests
- `pnpm test:watch` — Run tests in watch mode
- `pnpm test:coverage` — Run tests with coverage report
- `pnpm test:e2e` — Run Playwright E2E tests
- `pnpm check` — TypeScript check
- `pnpm tauri dev` — Launch desktop app in dev mode

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

## Architecture
```
UI (Svelte 5 components, $props, $state, $derived, $effect)
  → Stores (runes-based, call repos)
    → Repositories (SQL queries against DatabaseService)
      → DatabaseService (SAVEPOINT transactions)
        → SQLite (Tauri plugin or better-sqlite3 for tests)
```

## Conventions
- Amounts are always integers (smallest currency unit). No floats.
- Commit prefix: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`
- Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`), not legacy stores
- IDs are ULIDs (custom implementation in `src/lib/utils/id.ts`)
- Supports `en` and `vi` locales
