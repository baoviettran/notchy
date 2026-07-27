# Testing Conventions

## Test DB Pattern
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

## Pure Function Tests
No setup needed. Import the function, test edge cases.

## Component Tests (Svelte 5)
- Use `@testing-library/svelte` with `// @vitest-environment jsdom` directive
- Prefer `render` + `screen` + `fireEvent`. Test behavior, not implementation.
- Svelte 5 snippet children: `render(Component, { children: 'text' })`

## Naming
- `describe('<function or feature>')` wrapping `it('does X when Y')`
- Imperative mood: "returns", "throws", "creates"

## What NOT to Mock
- Do not mock the database. Use `createTestDb()` (real SQLite in-memory).
- Do not mock utility functions. Call them directly.
- Only mock external APIs (none exist yet).

## E2E
- Runs against the web build with a `sql.js` in-memory fallback behind `isTauri()`. OS-level desktop features (tray, global shortcuts) are **not** exercisable from Playwright — verify those manually in `pnpm tauri dev`.
