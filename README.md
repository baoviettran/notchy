# Notchy

A local-first personal finance application.

The name evokes the tally stick — humanity's earliest financial ledger, where each notch recorded a transaction.

## Status

Pre-implementation. Specification complete, code not yet started.

## Principles

1. **Data outlives the application.** SQLite is the single source of truth; the file remains readable in any era.
2. **Local-first.** No cloud, no telemetry, no required network.
3. **Built for a decade.** Pinned dependencies, reproducible builds, archived release binaries.
4. **Small and shippable.** v0.1 is intentionally minimal; later versions add web, sync, and power-user features.

## Versions

| Version | Focus |
|---|---|
| v0.1 | Single-device desktop (Tauri v2 + SvelteKit + Svelte 5), no synchronisation |
| v0.2 | Web build with SQLite WASM |
| v0.3 | File-based synchronisation via shared folder |
| v0.4 | WebRTC peer-to-peer synchronisation |
| v0.5 | Power-user features (recently-deleted view, yearly and cash-flow reports) |
| v0.6+ | Recurring transactions, multi-currency, attachments, mobile, and beyond |

## Internal documentation

The detailed implementation plan and technical design live in a separate private repository, included here as a git submodule at `docs/`. Only collaborators with access to that repository can populate `docs/`; for everyone else the directory is empty.

To work with full context locally (collaborators only):

```bash
git clone --recurse-submodules <repo-url>
# or, after a regular clone:
git submodule update --init --recursive
```

## Audience

Built primarily for the author and a small circle of family and friends.
