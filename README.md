# Notchy

A local-first personal finance application. Your data stays on your device — no cloud, no accounts, no subscriptions.

## Install

### Download

Pre-built Linux binaries are available from the [latest release](https://github.com/baoviettran/notchy/releases):

| Platform | File |
|---|---|
| Linux (Debian/Ubuntu) | `Notchy_0.1.0_amd64.deb` |
| Linux (Fedora/RHEL) | `Notchy-0.1.0-1.x86_64.rpm` |
| Linux (any) | `Notchy_0.1.0_amd64.AppImage` |
| macOS | `Notchy_0.1.0_x64.dmg` (planned) |
| Windows | `Notchy_0.1.0_x64-setup.exe` (planned) |

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
| Reports | Overview, Trend (6/12/24 months), Compare (two months) |
| Accounts | All accounts with balances |
| Goals | Savings targets with progress tracking |
| Debts | Personal loans — who owes whom |
| Settings | Categories, backup/export, theme, language |

### Keyboard Shortcuts

| Key | Action |
|---|---|
| `n` | Open new transaction form |
| `/` | Focus search |
| `Escape` | Close modal |

### Backup & Data

- **Auto-backup** — a snapshot is saved every time you launch the app (10 most recent kept)
- **Export** — Settings → Backup → Export as SQLite file or CSV
- **Import** — Settings → Backup → Import (replaces current data)
- **Your data file** is at:
  - Linux: `~/.local/share/com.notchy.app/notchy.db`
  - macOS: `~/Library/Application Support/com.notchy.app/notchy.db`
  - Windows: `%APPDATA%\com.notchy.app\notchy.db`

You can open this file with any SQLite tool. See [RECOVERY.md](RECOVERY.md) for queries.

## Principles

1. **Data outlives the application.** SQLite is the single source of truth; the file remains readable in any era.
2. **Local-first.** No cloud, no telemetry, no required network.
3. **Built for a decade.** Pinned dependencies, reproducible builds.
4. **Small and shippable.** v0.1 is intentionally minimal.

## Tech Stack

- [Tauri v2](https://tauri.app) — desktop shell
- [SvelteKit](https://kit.svelte.dev) + [Svelte 5](https://svelte.dev) — UI
- [SQLite](https://sqlite.org) — database (via `@tauri-apps/plugin-sql`)
- [Tailwind CSS](https://tailwindcss.com) — styling

## Documentation

- [SCHEMA.md](SCHEMA.md) — database schema reference
- [RECOVERY.md](RECOVERY.md) — how to read your data with sqlite3 if the app stops working

## License

MIT
