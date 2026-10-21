# Profile management verification — 2026-10-20

Serves: STORY-037

Scope: `codex/profile-management` development source on Fedora 44 / GNOME Wayland. Native checks used `WebKitWebDriver` with `TAURI_WEBVIEW_AUTOMATION=true`, the actual Tauri/Rust binary, and isolated `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_CACHE_HOME` under `/tmp/notchy-native-profile-wd`. The user's own Notchy data was not opened. Toolchain: Node 22.22.3, pnpm 10.11.0, Rust 1.99.0.

## Automated checks

| Check | Result |
| --- | --- |
| `pnpm test` | Pass: 1,209 tests / 141 files |
| `pnpm check` | Pass: 0 errors; 3 existing Quick Add CSS `@apply` warnings |
| `pnpm test:e2e` | Pass: 166 journeys, including canceled inline-budget draft and unfinished-profile routing regressions |
| `pnpm check:db-contracts` | Pass: generated bindings current |
| `pnpm check:native-db-cutover` | Pass: no production SQL-plugin path |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Pass: full Rust suite, including 11 subprocess crash/recovery tests, 0 failures |
| `pnpm build` | Pass: static site written to `build/` |

Implementation commits include `1b25848` (draft protection), `9ff03df` (production cutover), `56a59b9` (journeys), `562da24` (Quick Add native prompt), and `a20d88a` (crash matrix and final regressions). The roadmap records **14/14 tasks done**.

The browser E2E mock now keeps a separate registry and database per profile. It covers first creation, A/B transaction isolation, rename, reset, last-profile deletion, backup restored into a new profile, invalid backup rejection, startup recovery, and returning from unfinished setup to the picker or manager. Rust tests cover session admission, journal replay, legacy adoption, backup/reset/delete, and the new interrupted-restore identity replay. These tests do not replace native UI checks.

## Native app results

| Journey | Observed result |
| --- | --- |
| Empty start | `/profiles` showed no profiles and Create/Restore actions. |
| Create A and B | Personal and Work each completed onboarding. Native storage contained two different `notchy.db` files; Personal held only `Personal Cash`, Work only `Work Cash`; both had `PRAGMA integrity_check = ok`. |
| Switch | Opening Personal through Settings → Profiles showed only its account. Opening Work again showed only its account. |
| Backup | Clicking Back up for Personal published a 204,800-byte SQLite snapshot. The snapshot passed integrity check and contained `Personal Cash`. |
| Restore as new | `profile_inspect_restore` and `profile_restore` through the real native IPC created an inactive Recovered profile. Its SQLite file contained `Personal Cash`; Personal and Work remained intact. The manager listed all three after reload. The restore command and data were checked; the OS source-file picker was driven in the follow-up below. |
| Reset active | Clicking Reset profile on Personal returned to onboarding. Personal's live database had zero accounts; a verified reset snapshot retained `Personal Cash`. Work and Recovered stayed intact. |
| Delete inactive, active, last | Explicit Delete without exporting removed Recovered, then active Work returned to the picker, then the last incomplete Personal returned to the empty picker. Removed profile directories disappeared. |
| Unfinished setup | Native routing initially forced reset Personal back into onboarding even when visiting the picker/manager. Two regressions reproduced the problem; the final build allows `/profiles` and `/settings/profiles`, so a user can switch or delete before finishing setup. |
| Full restart | Closed the native WebDriver session and relaunched the binary with the same isolated XDG tree. The selected Persistent profile reopened on Dashboard and retained `Persisted Cash`. |

Ignored local screenshots: `artifacts/profile-management/native-work-accounts.png`, `native-empty-picker.png`, and `native-restart-accounts.png`. The files are evidence in this worktree, not tracked product assets.

## Native follow-up — 2026-10-21

The same isolated desktop setup was driven through real GTK Open/Save dialogs using accessibility actions, in addition to the webview controls. All paths below were under isolated `/tmp` test trees. The binary was rebuilt after the Quick Add capability fix and retested with a fresh WebDriver session.

| Journey | Observed result |
| --- | --- |
| Restore through OS Open dialog | Selected a SQLite backup with the GTK file picker. Restore created a **new** “From Picker” profile; the source profile remained. Both databases passed `PRAGMA integrity_check = ok`, and the restored profile contained the expected `Persisted Cash` account. |
| Export through OS Save dialog | Saved `from-picker-export.sqlite` outside app-owned storage. The 204,800-byte file passed SQLite integrity check. |
| Unsafe export-first deletion | Selected a path inside Notchy-owned storage through the Save dialog. The UI rejected it with “Choose a location outside Notchy’s data folders for this backup”; no export file was written and both profile records and databases remained. |
| Restore from unusable profile | With a scratch profile's schema set to version 99 while the app was closed, restart showed Recovery rather than finance routes. The OS Open dialog accepted the valid external backup, created “Recovery New”, and opened it. The unusable profile remained isolated and the original source profile stayed intact. |
| Legacy upgrade and restart | A separate XDG tree seeded from `v004.sqlite`, a byte-for-byte old backup and saved Vietnamese locale adopted into exactly one “Cá nhân” profile. The database migrated to schema 7, passed integrity check, retained the old backup bytes, and reopened as that same profile after a full process restart. The legacy live path was removed. |
| Hidden Quick Add draft | A/B native windows with an unsaved `50k B draft` reproduced a transition failure: Quick Add could not call its own `show()` because its Tauri capability lacked that permission. A failing capability test preceded the change. After adding `allow-show` and `allow-set-focus`, the native prompt appeared. **Stay** retained B and the draft without an error alert; **Discard entry** cleared the draft, opened A, and loaded A's account. |

The native permission issue and canceled-switch error alert were fixed after the initial gate run. The final full gates above passed. A later regression test also confirmed that a draft acknowledged in one window remains intact if another window cancels before commit.

## Final review and limits

Subprocess probes now terminate create and restore before/after publication and after registry commit; reset at five backup/swap/commit boundaries; delete before and after registry commit and before cleanup; and legacy adoption before/after registration. Restart assertions verify one identity, valid databases, correct old/new reset state, and no deleted-profile resurrection. A read-only destination, injected backup-write failure, and second-process lock contention leave existing data intact. The write failure is deterministic fault injection, not a physical disk-full test.

Final review also found and fixed six gaps: canceled cross-window transitions could erase a draft, a missing registered database could silently reappear empty, Quick Add lacked the active profile name, restore could suggest a duplicate name, create could accept a restore operation ID, and a stale saved selection was incorrectly shown as damaged. Each has focused regression coverage. Native UI checks preceded the last internal fixes; their native Rust and component regressions passed after the fixes.
