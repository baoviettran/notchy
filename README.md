# Notchy

[English](README.md) | [Tiếng Việt](README.vi.md)

<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Notchy" width="128" height="128">
</p>

A local-first personal finance application. Your data stays on your device — no cloud, no accounts, no subscriptions.

## Install

### Download

Download [Notchy 0.2.2](https://github.com/baoviettran/notchy/releases/tag/v0.2.2):

| Platform | File |
|---|---|
| Ubuntu 24.04 x86_64 | [DEB](https://github.com/baoviettran/notchy/releases/download/v0.2.2/Notchy_0.2.2_amd64.deb) |
| Fedora 44 x86_64 | [RPM](https://github.com/baoviettran/notchy/releases/download/v0.2.2/Notchy-0.2.2-1.x86_64.rpm) |

Unsigned Linux DEB/RPM packages. Verify downloads using the release SHA256SUMS. Windows/macOS and AppImage are excluded from 0.2.2; other Linux distributions and host desktop integrations are not certified by these tests.

### Build from Source

Requirements: Node.js 22.22.3, pnpm 10.11.0, Rust stable and Tauri system dependencies.

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

- **Automatic backups** — enabled by default per profile. While Notchy is open, changed content qualifies for one verified copy per local day. Retention keeps seven daily and four weekly representatives (which may overlap), plus the newest copy for each schema version. Settings → Backup & Data shows the preference, last success, earliest next eligible date, actual folder and retry warnings.
- **Manual backups** — use Settings → Backup & Data for the active profile, or Settings → Profiles for another profile. Manual, legacy, upgrade, reset and unregistered copies are excluded from automatic retention.
- **Export** — export SQLite for complete recovery, or CSV for archival tables.
- **Restore** — restore SQLite into a **new profile**; existing profiles remain intact. Transaction CSV import is a separate bank-style import flow.
- **Linux profile database** — `~/.local/share/com.notchy.app/profiles/<profile-id>/notchy.db`.
- **Linux registry/preferences** — `~/.config/com.notchy.app/profiles.json` and `preferences.json`.

Backups live inside each profile's data directory under `backups/`, `backups/upgrades/` and `backups/resets/`. These same-disk copies do not protect against disk loss; export a SQLite backup to another drive. Settings → Backup & Data displays actual resolved paths. Older single-database installations are adopted into one profile. Export an external SQLite backup before upgrading; older binaries cannot be assumed to understand the new profile layout.

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
