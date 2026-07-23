# Repository Guidelines

## Project Structure & Module Organization

Notchy is a personal-finance app built with SvelteKit 5 and Tauri v2. Keep application code in `src/`: pages in `src/routes/`, reusable UI and stores in `src/lib/`, and tests in `src/tests/`. The SQLite data layer lives in `src/lib/db/` (`repos/`, numbered `migrations/`, and `service.ts`). The Rust host and Tauri permissions are in `src-tauri/`. Edit locale strings in `messages/en.json` and `messages/vi.json`; `src/lib/paraglide/` is generated and must not be edited. Use `specs/` and `specs/plans/` for design material—`docs/` is a Git submodule.

## Build, Test, and Development Commands

Use Node 22.22.3 and pnpm 10.11.0.

- `pnpm install` installs dependencies.
- `pnpm dev` starts the web development server and compiles Paraglide messages.
- `pnpm tauri dev` launches the application; use it for native-only behavior.
- `pnpm check` runs Svelte and TypeScript checks.
- `pnpm test` runs the Vitest unit suite; `pnpm test:watch` keeps it running.
- `pnpm test:coverage` produces Istanbul coverage output in `coverage/`.
- `pnpm test:e2e` runs Playwright against a production web build.
- `pnpm build` builds the frontend; `pnpm tauri build` creates release binaries.

## Coding Style & Naming Conventions

Follow the existing TypeScript and Svelte style: tabs for indentation, single quotes, and focused modules. Use Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`) rather than legacy stores. Name routes with SvelteKit conventions (for example, `src/routes/accounts/[id]/+page.svelte`), repositories by domain (`transactions.ts`), and migrations with ordered numeric prefixes (`005_description.ts`). Keep money as integer smallest currency units—never use floating-point arithmetic. Use ULIDs via the existing ID utility. Add user-facing strings to both locale JSON files using flat underscore-separated keys such as `forms_amount_placeholder`.

## Testing Guidelines

Write a failing test before implementing a feature or bug fix. Put unit tests in `src/tests/unit/<module>.test.ts`, component tests in `src/tests/unit/components/<Component>.test.ts`, and E2E specs in `src/tests/e2e/<feature>.spec.ts`. Use `describe()` and behavior-focused `it('does X when Y')` names. For database tests, use `createTestDb()` with real in-memory SQLite; do not mock the database. Run `pnpm test` before committing, plus `pnpm check` for TypeScript/Svelte changes.

## Commit & Pull Request Guidelines

Use concise imperative Conventional Commit messages, for example `feat: add budget rollover` or `fix(forms): validate amount input`. Common types are `feat`, `fix`, `docs`, `refactor`, `test`, and `chore`; keep the subject under 72 characters. Keep code commits out of the `docs/` submodule. Pull requests should explain the user-visible change, link the related issue or spec when available, list verification commands, and include screenshots for UI changes. Never force-push `main`.
