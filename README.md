# Notchy

[English](README.md) | [Tiếng Việt](README.vi.md)

<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Notchy" width="128" height="128">
</p>

A local-first personal finance application. Your data stays on your device — no cloud, no accounts, no subscriptions.

## Install

### Download

Published binaries are available from [GitHub Releases](https://github.com/baoviettran/notchy/releases). The current 0.2.2 candidate uses these package formats:

| Platform | File |
|---|---|
| Linux (Debian/Ubuntu) | `Notchy_0.2.2_amd64.deb` |
| Linux (Fedora/RHEL) | `Notchy-0.2.2-1.x86_64.rpm` |

Current 0.2.2 candidate scope: Linux DEB/RPM only. Windows/macOS and AppImage are not certified for this candidate. Candidate artifacts are local until a GitHub release is published.

### Build from Source

Requirements: Node.js 22, pnpm 10, Rust 1.77+, and Tauri system dependencies.

```bash
# Install system dependencies (Ubuntu/Debian)
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

# Clone and build
git clone https://github.com/baoviettran/notchy.git
cd notchy
pnpm install
pnpm tauri build

# Binary is at: src-tauri/target/release/notchy
```

Or use Docker for a reproducible build:

```bash
docker build -t notchy .
docker cp $(docker create notchy):/app/src-tauri/target/release/bundle ./release
```

## Usage

### First Launch

1. **Choose language** — English or Tiếng Việt
2. **Choose currency** — VND or USD (all accounts share one currency)
3. **Create your first account** — pick a type (Checking, Savings, Cash, Credit Card) and optionally enter a starting balance

You're ready to go.

### Daily Use

- **Add a transaction** — click the green `+` button (or press `n`) → enter amount, pick a tag, save
- **Amount shortcuts** — type `50k` (= 50,000), `1.5tr` (= 1,500,000), or even `50k+30k` (= 80,000)
- **Search** — press `/` to focus the search bar, find transactions by payee or description
- **Frequent transactions** — your most-used transactions appear as one-tap cards on the dashboard

### Navigation

| Page | What it does |
|---|---|
| Dashboard | Budget progress, recent transactions, goals, net position |
| Transactions | Full list with search and filters |
| Budgets | Monthly envelope budgets per category |
| Reports | Overview, trends, comparisons, composition, categories, year-over-year and net worth |
| Accounts | All accounts with balances |
| Goals | Savings targets with progress tracking |
| Debts | Personal loans — who owes whom |
| Scheduled | Recurring income, expenses and transfers, posted on app launch |
| Settings | Categories, classification rules, backup/export, theme, language |

### Keyboard Shortcuts

| Key | Action |
|---|---|
| `n` | Open new transaction form |
| `/` | Focus search |
| `Escape` | Close modal |

### Backup & Data

- **Backups** — create one in Settings → Backup & Data. Desktop also saves a safety snapshot before a schema upgrade or restore; ordinary launches do not create backups, and automatic retention is not enabled.
- **Export** — Settings → Backup → Export as SQLite file or CSV
- **Import** — Settings → Backup → Import (replaces current data)
- **Your data file** is at:
  - Linux: `~/.config/com.notchy.app/notchy.db`
  - macOS: `~/Library/Application Support/com.notchy.app/notchy.db`
  - Windows: `%APPDATA%\com.notchy.app\notchy.db`

Backups are stored separately under the application data directory, in `backups/` and `backups/upgrades/`. Settings → Backup & Data shows the actual database and backup paths. Use SQLite export/import for a full database round-trip; per-table CSV exports are archival dumps, while transaction CSV import expects bank-style signed amounts.

You can open this file with any SQLite tool. See [RECOVERY.md](RECOVERY.md) for queries.

## Development

Run `pnpm check`, `pnpm test`, `pnpm test:coverage`, `pnpm test:roadmap`, and `pnpm build`. Native gates are `cargo test --manifest-path src-tauri/Cargo.toml`, Clippy with `--all-targets -- -D warnings`, and `pnpm check:db-contracts`. Run `pnpm test:e2e` with Node 22 for the pinned Playwright 1.52 loader; Node 24 currently stalls in that loader. Both pnpm 10 and 11 are supported by the repository configuration.

Initialize the separate documentation checkout with `git submodule update --init docs`. See [ROADMAP.md](ROADMAP.md) for current scope and [the desktop smoke checklist](specs/2026-07-27-desktop-release-smoke-checklist.md) before a release.

## Principles

1. **Data outlives the application.** SQLite is the single source of truth; the file remains readable in any era.
2. **Local-first.** No cloud, no telemetry, no required network.
3. **Built for a decade.** Pinned dependencies, reproducible builds.
4. **Small and shippable.** Intentionally minimal — only what's needed.

## Tech Stack

- [Tauri v2](https://tauri.app) — desktop shell
- [SvelteKit](https://kit.svelte.dev) + [Svelte 5](https://svelte.dev) — UI
- [SQLite](https://sqlite.org) — Rust `rusqlite` on desktop; an in-memory `sql.js` adapter for browser development and tests
- [Tailwind CSS](https://tailwindcss.com) — styling

## Documentation

- [SCHEMA.md](SCHEMA.md) — database schema reference
- [RECOVERY.md](RECOVERY.md) — how to read your data with sqlite3 if the app stops working

## License

MIT
