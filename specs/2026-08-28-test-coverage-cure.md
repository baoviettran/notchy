# Test-Coverage Cure — Design Spec

- **Date:** 2026-08-28 (rev 2 — native-boundary re-scope)
- **Status:** Draft for review
- **Branch:** `fix/ui-bugfix-session`
- **Problem:** 723 unit tests + 32 E2E specs pass, yet trivial bugs keep shipping. Coverage is 68.6% stmts / 59.6% branch overall, but the distribution is inverted: ~100% on pure utils, ~0% on the bug-prone layers.

## 1. Objective

Make the test suite catch the bugs that actually ship. The suite currently proofs pieces in isolation (pure functions, primitives) while systematically avoiding integration surfaces.

**The critical discovery driving this spec (rev 2):** the suite tests the *browser* path (sql.js in-memory) but the *product* — the desktop app under `pnpm tauri dev` — runs the **`NativeDatabaseClient`** path: every operation is an `invoke()` call to a Rust `#[tauri::command]` (70 registered commands). That live desktop path has **zero automated correctness coverage**. The only test (`native-client.test.ts`) mocks `invoke` to *throw*, proving error propagation, never a correct operation. The JS↔Rust seam — command-name strings, arg-name serialization (JS camelCase vs Rust snake_case), idempotency ULID reuse — is exactly where trivial bugs live, and no test touches it.

A subtler accounting error, also corrected here: the `db/native/*.ts` standalone adapter files (accounts/transactions/budgets/…) all `throw new Error('… not wired')` and are **imported by nothing** — orphaned dead code, not the production path. Their 0% coverage in the report was noise, and earlier drafts mis-targeted them as bug-prone.

## 2. Success criteria ("cured" = both, confirmed with user)

1. **Bug-driven:** every bug in the inventory (TC-0) has a regression test that fails against the pre-fix build and passes post-fix. New bugs must ship with a failing-test-first per the project's TDD discipline.
2. **Numeric floors:** every module the inventory touched is at ≥80% statements / ≥70% branch, enforced by a CI gate (TC-1) on touched files. No 0% modules ship.
3. **CI automation:** Playwright E2E runs in CI (TC-6). The 32 local-only specs become merge-blocking.
4. **Native boundary contract:** every `NativeDatabaseClient` op is locked to its Rust command name + arg shape by a mocked-invoke test (TC-8) — the live desktop seam is no longer silent.

## 3. Capability map (approved, rev 2)

```
TC-0 Bug inventory ──┬──> TC-2 Prove-it regression tests (per bug, TDD)
  (git log + memory) ├──> TC-7 Bug→E2E flow specs
                     ├──> TC-1 coverage gate (feeds floor targets)
                     └──> TC-8 Native boundary contract (high-priority seam)
TC-8 Native boundary → TC-3 (makes db/native/client.ts mutation-able)
TC-3 Stryker expansion ──┐
TC-4 Store-logic extraction ──┼──> TC-1 Coverage gate + CI enforcement
TC-5 Component test fill ────┘     (touched-files threshold, ratcheting)
TC-6 E2E in CI ────────┬──────────┘
                       └──> TC-7 (flows only pay off once E2E runs in CI)
```

Build order: **TC-0 → TC-8 (early, highest-value seam) → (TC-2, TC-3, TC-4, TC-5, TC-6 parallel) → TC-7 → TC-1**.

The orphan `db/native/*.ts` adapters (dead code) are **out of the mutation/floor scope** — they are candidates for removal, not coverage targets.

## 4. Per-capability specs (dependency order)

### TC-0 — Bug inventory

**Purpose:** enumerate every known past trivial bug into a regression-test backlog. This is the seed that drives TC-1's floors and TC-2/TC-7's test lists.

**Process:** mine `git log --grep="fix:"` and `fix:`/`bug` commits, the memory docs (see `MEMORY.md`), and `specs/STATUS.md` roadmap. Produce `specs/coverage-bug-inventory.md`, a table with: bug, fixing commit, layer (unit / component / E2E / native-boundary), primary file, current test status (tested? by which test?), target test (TC-2 unit/component, TC-7 flow, TC-8 boundary, or both).

**Seed list (initial rows, not exhaustive):**
- Batch UI fixes from `dbcb436` — tour, DatePicker, onboarding, budgets, i18n
- Quick-add DB contention ("no such savepoint") — `db.svelte.ts` / quick-add path
- Migration idempotency race ("duplicate column name") — boot path
- Autocomplete free-text values silently dropped on save — `Autocomplete.svelte`
- Schema-version call-site drift breaking E2E — migration versioning
- Playwright `selectOption({label})` flakiness on `bind:value` selects
- Vite dev Svelte CSS race ("Unknown word onMount")
- `parseAmount` k/m/tr locale semantics (tokenizer must not expand)
- **Native seam**: `NativeDatabaseClient` ops (command-name/arg-shape contract) — see TC-8. The `accountId` vs `account_id` serialization seam is a suspected live bug to resolve.

**Also:** flag every `db/native/*.ts` standalone adapter as **dead code candidate** in the inventory (throw `'not wired'`, imported by nothing) — record it so TC-3/TC-1 skip it, and a future task can remove it.

**Acceptance criteria:**
- [ ] `specs/coverage-bug-inventory.md` exists; every row links a bug to a commit and a layer.
- [ ] Every row has a `target test` cell filled (unit/component/E2E/boundary/both) before its TC-2/TC-7/TC-8 work starts.
- [ ] Orphan `db/native/*.ts` adapters are each marked `dead-code-candidate` (so TC-3 mutation and TC-1 floors skip them).
- [ ] Review sign-off that no known bug class is missing (cross-check against `MEMORY.md`).

**TDD:** the inventory itself is a document, not code — no test requirement.

---

### TC-8 — Native DB boundary contract test (high-priority seam)

**Purpose:** close the live-desktop guarantee. `NativeDatabaseClient` is the production path under `pnpm tauri dev`, but the only test mocks `invoke` to throw. This capability locks every op → Rust command name + serialized arg shape, and flags drift or a mismatch (e.g. camelCase JS keys vs snake_case Rust params) the moment it appears.

**Scope:** a mocked-invoke test over the real `NativeDatabaseClient` (`src/lib/db/native/client.ts`). Replace the mock `invoke` to route into a spy that (a) captures the called command name + args object, and (b) returns fixture data per command. Assert for a representative-but-complete set of ops (at minimum one per ops group: accounts, transactions, categories, budgets, goals, rules, meta, debts, reconciliations, reports, and the lifecycle commands):
- the exact `invoke` command-name string matches the registered Rust command (`src-tauri/src/lib.rs` `generate_handler` list),
- the arg object keys match the Rust parameter names exactly (camelCase `accountId` vs snake_case `account_id` is the known seam — the test must assert the *actual* serialized key and surface a mismatch),
- the result deserializes to the domain type (fixture shape).

Also assert the **idempotency contract**: mutations reuse one operation ULID across retry paths (per `NativeDatabaseClient` header comment).

**This is NOT the deferred "native smoke".** It runs in Vitest/Node, mocks `invoke`, and needs no Tauri runtime. It closes the JS↔Rust contract seam now, while the real-SQLite integration smoke stays deferred (out of scope).

**Acceptance criteria:**
- [ ] `src/tests/unit/native-boundary.test.ts` runs the real `NativeDatabaseClient` with a mock `invoke` that records command name + args.
- [ ] One op per ops-group asserts exact command name + arg-shape match against the Rust surface.
- [ ] The `accountId`/`account_id` seam is asserted explicitly — the test either passes (Tauri converts) or is red with the mismatch visible (live bug found).
- [ ] Retry/idempotency ULID reuse is asserted.
- [ ] `pnpm test` green; the test replaces the weak "error propagation only" coverage for the live path.

---

### TC-2 — Prove-it regression tests (per inventory bug)

**Purpose:** give every past bug a regression test. Follows the project's Prove-It TDD pattern (CLAUDE.md): write the failing test, watch it fail, fix, keep green.

**Scope per inventory row:**
- Bug that already regressed (test fails against current code): the test *is* the failing-red state; then fix the bug.
- Bug already fixed (test fails against pre-fix build only): verify by checking out the parent of the fixing commit, confirm red, then green on current HEAD.

**Target files:** `src/tests/unit/<area>/<bug-slug>.test.ts` or a component test under `src/tests/unit/components/`. Match existing naming (`quick-add`, `migration-idempotency`, `autocomplete-freetext`).

**Acceptance criteria:**
- [ ] Every inventory row has a test file named after its bug slug.
- [ ] Each test is demonstrated red against the pre-fix state (test log captured) and green on current HEAD.
- [ ] `pnpm test` stays fully green after each test lands.

---

### TC-3 — Stryker mutation expansion

**Purpose:** replace the honest "would a mutant survive?" signal for the bug-prone modules. Current `stryker.conf.mjs` mutates only `rules_matcher.ts` and `dedup.ts`; `stryker.db.conf.mjs` covers a few DB ranges. Both exclude the code that has shipped bugs.

**Scope:** extend the `mutate` lists to:
- `src/lib/db/native/client.ts` — **meaningful only after TC-8**: mutating a command-name string or arg key is caught by the boundary test. (TC-8 must land first.)
- `src/lib/db/repos/transactions.ts`, `src/lib/db/repos/budgets.ts`
- `src/lib/backup/index.ts` (the Vitest-covered ranges; keep the Tauri-only wrappers excluded — the existing comment's contract)
- The pure modules extracted by TC-4

**The orphan `db/native/*.ts` adapters are NOT targets** — they throw by construction and are dead code; mutating them proves nothing.

**Acceptance criteria:**
- [ ] `stryker.conf.mjs` / `stryker.db.conf.mjs` list the modules above (not the orphan adapters).
- [ ] Mutation score ≥80% on the original targets (`rules_matcher`, `dedup`) — do not regress what exists.
- [ ] `db/native/client.ts` mutation score is meaningful (driven by TC-8); score reported and floored in `coverage-floors.json`.
- [ ] For newly added targets, score is reported and a floor is set, ratcheting from the initial run's value.

**TDD note:** mutation testing is a test-quality oracle, not a red-green loop. It measures whether the tests from TC-2/TC-8/TC-4/TC-5 actually discriminate.

---

### TC-4 — Store-logic extraction to pure modules

**Purpose:** remove the coverage blind spot on `src/lib/stores/**`. The exclusion exists because `$state()` runes defeat Istanbul instrumentation — but that's a symptom: business logic lives inside untestable runes. Extract the logic into pure modules (the `BudgetSummaryCalc.test.ts` pattern) so it becomes testable; stores become thin wiring.

**Scope:** start with the stores that have shipped bugs and real logic:
- `db.svelte.ts` — boot, migration-ordering, quick-add paths (see memory: contention + race bugs)
- `budgets.svelte.ts` — calculation/validation branches
- `settings.svelte.ts`, `transactions.svelte.ts` — pure transforms

Extract to `src/lib/logic/` (new dir) or existing `src/lib/utils/`; keep naming/idiom consistent with `budget-summary` pure-logic modules. Behavior must be identical — this is a refactor under test.

**Acceptance criteria:**
- [ ] Pure modules land under `src/lib/logic/` (or `utils/`) with tests ≥90% stmts / ≥80% branch.
- [ ] Store files shrink to state + wiring (no inline business logic that could live in a pure module).
- [ ] All existing tests stay green — no behavior change. Verify with `pnpm test`.
- [ ] No change to the store's public surface used by components (checked by `svelte-check`).

---

### TC-5 — Component test fill (the 0% list)

**Purpose:** cover the 12 user-facing components at 0% (or 30% for DatePicker). These are the "trivial bug" generators: form validation, enable/disable, focus, event wiring.

**Target components** (verified absent of tests):
- `forms/AccountForm.svelte`, `forms/GoalForm.svelte`
- `layout/FAB.svelte`, `layout/ShortcutRef.svelte`, `layout/Sidebar.svelte`
- `modals/ImportTransactionsModal.svelte`
- `primitives/DatePicker.svelte` (currently 30%), `primitives/FilterControls.svelte`, `primitives/FilterSheet.svelte`
- `reports/AdjustmentsToggle.svelte`, `reports/TapeLine.svelte`, `reports/Money.svelte` (partial)

**Harness:** match existing component tests — `// @vitest-environment jsdom`, `@testing-library/svelte`, probe-component pattern (`helpers/*Probe.svelte`) where bindable values need observation (see `AutocompleteBindProbe.svelte`).

**Acceptance criteria:**
- [ ] Each target has a test file under `src/tests/unit/components/`.
- [ ] Coverage of each target ≥80% stmts / ≥70% branch.
- [ ] Branch-oriented: tests exercise disabled states, validation errors, empty states — not just happy paths.
- [ ] `pnpm test` fully green.

---

### TC-6 — E2E in CI

**Purpose:** the 32 Playwright specs currently run only locally. Add them as a merge-blocking CI job. **Real-native SQLite smoke coverage remains out of scope** (see Out of scope — the boundary contract is the JS-side substitute; the in-memory fallback is what E2E drives).

**Scope:** add an `e2e` job to `.github/workflows/ci.yml`:

```yaml
  e2e:
    runs-on: ubuntu-latest
    needs: quality
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: '22' }
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Compile i18n messages
        run: pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide
      - name: Install Playwright chromium
        run: npx playwright install --with-deps chromium
      - name: E2E tests
        run: pnpm test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```

The existing `webServer` config (`pnpm build && pnpm preview`) already handles build+boot in CI (`reuseExistingServer: !CI`). The existing `retries: 1` absorbs sql.js fallback flakiness without masking real failures (comment in `playwright.config.ts`).

**Acceptance criteria:**
- [ ] `e2e` job appears in CI and runs the 32 specs on PRs to `main`.
- [ ] All specs pass on CI (or the retry rate is tracked and workers isolated per the config comment if it climbs).
- [ ] Failed runs upload `playwright-report/` for diagnosis.
- [ ] CI wall-time stays reasonable (E2E job is parallel to `rust` job, not blocking it).

---

### TC-7 — Bug→E2E flow specs

**Purpose:** the unit/component tests prove logic; the wiring bugs that actually ship are only provable at the flow level. For every inventory bug that manifests as a user flow, add a Playwright spec reproducing the flow.

**Scope:** the inventory rows marked `E2E` in their target-test column (tour, DatePicker, onboarding, budgets, i18n batch from `dbcb436`; quick-add; migration/reload-survival). Place under `src/tests/e2e/<area>-regression.spec.ts`.

**Acceptance criteria:**
- [ ] Each flow-level bug has an E2E spec that fails against the pre-fix build and passes on current HEAD.
- [ ] Specs reuse the existing `helpers/` + fixtures; follow the E2E selector patterns in memory (`e2e-selector-patterns-2026-08.md`).
- [ ] `pnpm test:e2e` fully green locally and in CI (TC-6).

---

### TC-1 — Coverage gate (capstone)

**Purpose:** make the work in TC-2/3/4/5/8 sticky. No PR may drop a bug-prone module below its floor, and no 0% module may ship.

**Mechanism:**
- New script `scripts/coverage-gate.mjs`: reads `coverage-summary.json` (vitest `json-summary` reporter), computes touched files via `git diff --name-only` against the PR base, and enforces per-file floors from `specs/coverage-floors.json`. Exits nonzero on violation.
- `specs/coverage-floors.json`: per-file `{ "stmts": <n>, "branch": <n> }` map. Seeded from the inventory's primary files at the floors TC-2/3/4/5/8 achieve, then **ratcheted**: on each merge, floors update to `max(current_floor, observed − 5)` — monotonic, never lowered.
- Gate runs as a CI step in the `quality` job, after unit tests + coverage.

**Implementation is early, enforcement is gradual** (confirmed with user): the script + CI step land early and pass at current levels; strictness grows as coverage work lands. `coverage-floors.json` is the single knob.

**Target floors** (bug-prone modules, to be reached by the end):
- `db/native/client.ts` (boundary): 90/80 — the live desktop seam
- `db/browser/client.ts`: 80/70
- `db/repos/transactions.ts`: 90/80
- `db/repos/budgets.ts`: 85/75
- `backup/index.ts`: 80/70
- TC-4 pure modules: 90/80
- TC-5 components: 80/70

**Explicitly NOT gated:** the orphan `db/native/*.ts` standalone adapters — dead code, flagged for removal, not coverage targets.

**Acceptance criteria:**
- [ ] `scripts/coverage-gate.mjs` enforces per-file floors and fails CI on violation.
- [ ] `coverage-floors.json` exists, seeded, and ratchets upward on merge.
- [ ] Every module with 0% coverage today is either ≥ its floor by the end of this work or explicitly listed in `coverage-floors.json` with a plan.
- [ ] The gate blocks a real regression in a manual test (touch a covered module, remove a test, see the gate fail).

## 5. Commands

New/updated scripts in `package.json`:

| Command | Action |
|---|---|
| `pnpm test:gate` | `node scripts/coverage-gate.mjs` — per-file coverage floors on touched files |
| `pnpm test:coverage` | already exists; add `json-summary` reporter to feed the gate |
| `pnpm test:mutation` / `:mutation:pure` / `:mutation:db` | already exists; expanded mutate lists (TC-3) |
| `pnpm test:e2e` | already exists; now also runs in CI (TC-6) |
| `pnpm test:roadmap` | unchanged; flip plan checkboxes as commits land per project discipline |

## 6. Project structure changes

```
specs/coverage-bug-inventory.md   # TC-0: the bug → test backlog (incl. native seam + dead-code flags)
specs/coverage-floors.json        # TC-1: per-file gates, ratcheting (not the orphan adapters)
scripts/coverage-gate.mjs         # TC-1: the gate
src/lib/logic/                    # TC-4: extracted pure modules (+ tests)
src/tests/unit/native-boundary.test.ts  # TC-8: the live desktop seam
src/tests/unit/<area>/*.test.ts   # TC-2: per-bug regression tests
src/tests/unit/components/*.test.ts # TC-5: 12 components
src/tests/e2e/*-regression.spec.ts  # TC-7: flow specs
.github/workflows/ci.yml          # TC-6: e2e job; TC-1: gate step
```

Implementation plan follows the project convention: `specs/plans/`, checkboxes flipped on commit, `pnpm test:roadmap` refreshes `specs/STATUS.md`.

## 7. Code style

- Match existing test idioms: `@testing-library/svelte` + jsdom for components, probe-component pattern for bindable observation, `describe/it/expect`, vitest `node` env + `setup-dom.ts` for unit.
- The boundary test (TC-8) follows the existing `vi.mock('@tauri-apps/api/core')` pattern in `native-client.test.ts`, but replaces the throw-all mock with a recording spy + per-command fixtures.
- Svelte 5 runes, strict TS, ULIDs, integer amounts, flat Paragliide keys — unchanged (project CLAUDE.md).
- New pure modules: same comment density and naming as `budget-summary` / `BudgetSummaryCalc.test.ts`.
- Mutation-test ranges follow the existing contract: Tauri-only wrappers stay excluded with the justifying comment.

## 8. Testing strategy

The cure is itself built under TDD (project discipline, no exceptions):
- TC-2/TC-5/TC-7: failing test first → watch it fail → implement → refactor → all green.
- TC-8: mocked-invoke boundary assertions; the `accountId`/`account_id` seam either passes (Tauri converts) or is red with the mismatch visible.
- TC-1: the gate is proven by a manual adversarial check (remove a test → gate fails).
- TC-3: mutation score is the oracle that the tests discriminate; not a red-green loop.
- TC-4: refactor under existing green tests; new pure modules get their own tests first.
- Full suite before every commit: `pnpm test`, `pnpm test:e2e` (post TC-6 locally too), `pnpm check`.

## 9. Boundaries

**Always do:**
- Write the failing regression test before touching the code it guards (TC-2/TC-7).
- Keep `coverage-floors.json` monotonic (never lower a floor).
- Run the full suite before commit.

**Ask first before:**
- Changing the CI job structure (adding runners, splitting jobs) beyond the two additions specified.
- Touching the native Rust commands or adding a real-SQLite integration smoke (that's the deferred Task-13-class work; TC-8's mocked boundary is the approved JS-side substitute).
- Removing the orphan `db/native/*.ts` dead-code adapters — flag them now, remove in a separate task with explicit approval.
- Excluding any currently-included file from coverage (the `stores/**` exclusion stays until TC-4 extraction, then shrinks; the `migrations/**` exclusion stays).

**Never do:**
- Chase overall % at the expense of targeted floors — overall number is informational, per-file floors are the gate.
- Turn on the gate at full strictness before TC-2/3/4/5/8 land (would fail CI instantly on 0% modules).
- Delete or refactor tests to make the gate pass — the gate is a floor, not a ceiling.
- Spend coverage/mutation budget on the orphan `db/native/*.ts` adapters — they are dead code, not the production path.

## 10. Out of scope

- **Real-native SQLite integration smoke** (bootstrapping the actual Tauri app against a live SQLite file) — deferred to the native-cutover completion work. TC-8's mocked boundary is the JS-side seam substitute, not this.
- Rewriting the stores' rune architecture wholesale — only pure-logic extraction.
- Coverage on `src/routes/**` page components (not currently measured; the 0% `src/lib` components are the priority).
- Increasing E2E browser matrix beyond chromium.
- Deleting the orphan `db/native/*.ts` adapter stubs — flagged in the inventory as dead-code candidates; removal is a separate, approved task.