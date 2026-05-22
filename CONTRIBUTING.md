# Contributing to Notchy

## Quick Start

```bash
# Prerequisites: Node.js 22, pnpm 10, Rust 1.77+
# Linux: also need libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

git clone --recurse-submodules <repo-url>
cd notchy
pnpm install
pnpm test          # 112 unit tests
pnpm tauri dev     # launch in dev mode
```

## Repository Layout

```
notchy/
├── src/lib/db/          # Data layer (service, migrations, repos)
├── src/lib/stores/      # Svelte 5 rune stores
├── src/lib/components/  # UI components (primitives, layout, forms, charts)
├── src/lib/utils/       # Utilities (id, number_parse, currency, date)
├── src/lib/backup/      # Backup, export, import
├── src/routes/          # SvelteKit pages
├── src/tests/           # Unit tests (Vitest)
├── src-tauri/           # Rust backend (Tauri v2)
├── messages/            # i18n (en.json, vi.json)
├── docs/                # Private design docs (git submodule)
├── SCHEMA.md            # Database schema reference
├── RECOVERY.md          # Data recovery guide
└── ROADMAP.md           # Future development plan
```

## Development Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Start Vite dev server |
| `pnpm tauri dev` | Launch Tauri app in dev mode |
| `pnpm test` | Run unit tests |
| `pnpm build` | Build frontend |
| `pnpm tauri build` | Build release binaries |

## Commit Conventions

- Imperative mood: "Add", "Fix", "Update" (not past tense)
- First line ≤ 72 characters
- Prefix: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`
- Code commits never modify the `docs/` submodule

## Architecture

```
UI (Svelte 5 components)
  → Stores ($state runes)
    → Repositories (SQL queries)
      → DatabaseService (SAVEPOINTs)
        → SQLite (via @tauri-apps/plugin-sql)
```

All monetary amounts are integers in the smallest currency unit. Floating-point arithmetic is forbidden.

## Testing

- Unit tests use `better-sqlite3` in-memory for real SQLite behavior
- Run `pnpm test` before committing
- Test files live alongside their subjects in `src/tests/unit/`

## Branching

- Default branch: `main`
- Direct commits acceptable for now; switch to feature branches when team grows
- Never force-push `main`
