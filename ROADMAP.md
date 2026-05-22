# Notchy — Roadmap

## Current: v0.1.0 ✅

Single-device desktop application. Local-first, no sync, no cloud.

**Delivered:**
- 6 account types (checking, savings, cash, credit card, personal loans)
- 5 transaction kinds (expense, income, transfer, refund, adjustment)
- Monthly envelope budgets per bucket
- 3 reports (overview, trend, compare)
- Goals with velocity tracking
- Personal debts (I owe / owed to me)
- Reconciliation with adjustment creation
- Auto-backup, CSV export, SQLite export/import
- Onboarding flow (language → currency → first account)
- English and Vietnamese (Paraglide JS)
- Dark mode
- Keyboard shortcuts

---

## v0.2 — Web Build

**Goal:** Run Notchy in a browser with the same data model.

- [ ] SvelteKit web build using SQLite WASM (OPFS-SAH pool VFS)
- [ ] Cross-platform database parity test suite
- [ ] Web Lock for multi-tab access
- [ ] `navigator.storage.persist()` for durable storage
- [ ] Service Worker + PWA installability
- [ ] Responsive layout pass (mobile-first)

---

## v0.3 — File-Based Sync

**Goal:** Sync between devices via a shared folder (Syncthing, iCloud Drive, Dropbox).

- [ ] Lock file to prevent simultaneous writes
- [ ] External-change detection and database reload
- [ ] WAL-mode considerations documented
- [ ] Setup guide for Syncthing / iCloud Drive / Dropbox

---

## v0.4 — Peer-to-Peer Sync

**Goal:** Real-time sync between devices without a server.

- [ ] Hybrid Logical Clock (HLC) replacing ISO timestamps
- [ ] `prev_updated_at` column on all data tables
- [ ] `sync_peers` and `sync_conflicts` tables
- [ ] WebRTC manual signalling (QR code offer/answer)
- [ ] Last-write-wins with conflict logging
- [ ] Conflict review UI (Settings → Sync → Conflicts)
- [ ] Transitive sync (A↔B, B↔C → A gets C's changes)
- [ ] Resumable sync with batch commits
- [ ] `sync_in_progress` guard on triggers
- [ ] LAN discovery via mDNS (stretch goal)

---

## v0.5 — Power-User Features

**Goal:** Features requested after daily use.

- [ ] Recently-deleted view with 30-day restore
- [ ] Yearly report
- [ ] Cash-flow report (Money Movements + Adjustments)
- [ ] Schema-versioned exports
- [ ] Import-merge mode (HLC-based conflict resolution)

---

## v0.6+ — Future

Features planned but not yet scheduled:

- [ ] Recurring transactions (daily, weekly, monthly, custom)
- [ ] Multi-currency with exchange rates
- [ ] CSV and OFX bank import
- [ ] Receipt-photo attachments
- [ ] Encrypted backup (passphrase-based)
- [ ] App lock with PIN / biometric
- [ ] Mobile build (Tauri Mobile)
- [ ] Investment and asset tracking
- [ ] Notifications (budget exceeded, goal milestones)
- [ ] Split transactions
- [ ] Pinned / favourite transactions
- [ ] Activity log and "edited on" indicators
- [ ] Custom dashboard widgets
- [ ] Account groups and pinning
- [ ] Reconciliation reminders
- [ ] Live number formatting during input
- [ ] Multi-account goals

---

## Principles (all versions)

1. **Data outlives the application.** SQLite is the source of truth.
2. **Local-first.** No cloud dependency, no telemetry.
3. **Built for a decade.** Pinned deps, reproducible builds, archived binaries.
4. **Small and shippable.** Each version is intentionally scoped.

---

## Permanent Exclusions

These will never be part of Notchy:

- Telemetry or analytics
- Cloud-hosted accounts or sign-in
- Server-rendered UI
- Plugin systems
- Public APIs or direct bank integrations
