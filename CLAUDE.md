# Notchy — Project Guide

## Environment
- Tauri prerequisites: system WebView + Rust toolchain installed (`pnpm tauri dev` will fail otherwise)

## Key Commands
- `pnpm dev` — Vite dev server (web). Note: Paraglide compiles first.
- `pnpm tauri dev` — Launch the desktop app (use this for desktop-only features).

## TDD Discipline

**Red-Green-Refactor. No exceptions.**

1. **Write the test first.** Before implementing any feature or fixing any bug, write a failing test.
2. **Watch it fail.** Run `pnpm test:watch` and confirm the test fails with the expected error.
3. **Implement minimum code** to pass.
4. **Refactor** while keeping tests green.
5. **All tests must pass before committing.** Run `pnpm test` as a pre-commit check.

### Exceptions (ask first)
- Throwaway prototypes, generated code, configuration files

## Key convention
- `src/lib/db/migrations/index.ts` — migration registry; append new migrations here.

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

## Spec/Plan Tracking

- To answer "what's the roadmap progress / which specs are implemented," run `pnpm test:roadmap` and read `specs/STATUS.md` — do NOT re-scan plans + git log by hand.
- `specs/STATUS.md` is **generated** (from `specs/plans/*.md` checkboxes + `git log`). Never hand-edit it; re-run `pnpm test:roadmap` to refresh.
- **Checkbox discipline:** when a plan task's commit lands, flip that task's step checkboxes `- [ ]`→`- [x]` in the plan file. A task counts as done only if its box is `[x]` AND git log has the matching commit.
- If `pnpm test:roadmap` prints `⚠ stale`, the rollup can't be trusted — regenerate it before relying on it. Nonzero exit = staleness detected.

## Story Inventory (product source of truth for **what**)

- `product/stories/index.md` is the **demand engine** — it is the source of truth for *what* to build (relevance). Specs/plans/tests remain the source of truth for *how*. Process: `product/stories/README.md`.
- **Rule — no story → no spec.** Every spec/plan must carry a `**Serves:** STORY-0xx` header tracing to a real story. Before writing any spec or starting feature work, find the story it serves (or add one first).
- **A story without an Evidence anchor is a wish, not a story** — it must point at a real source (bug-inventory row, Actual→Notchy research, dogfooding, interviews). Do not graduate a wish to a spec.
- Stories are **need-shaped, not solution-shaped** — "the user wants confirmation a quick entry landed right," not "add a readback helper." Restating the feature is a spec in first-person.
- Keep stories one-line-about-one-need. When a story's `Serves:` list grows past ~2 specs, split it.
- Update `Status` → `shipped` when the fulfilling plan's final task lands. Retrace specs to existing stories rather than inventing new ones.

## Gotchas
- **`docs/` is a submodule** — see Repo Layout above. Files under `docs/` will not commit with the main repo.
- **Schema-version call sites** — every migration that bumps the schema version must update *all* `importDatabase`/`validateImport` version literals (UI, unit, E2E fixtures). Updating only some breaks E2E silently.
- **Paraglide flat keys** — pinned at 1.11.8; namespacing is an underscore prefix, not nested keys. 2.x upgrade was rejected (bracket access, not nested objects).
- **Per-window JS context** — each Tauri webview is a separate JS context with its own `DatabaseService` singleton and Svelte stores. Cross-window updates require Tauri events (e.g. `transaction:saved`), not shared store state.
- **`parseAmount` is pure** — tokenizer features (`quick_parse.ts`) must not expand `k`/`m`/`tr`; `parseAmount` already does and is locale-aware.
