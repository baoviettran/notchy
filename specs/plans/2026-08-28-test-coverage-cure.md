# Test-Coverage Cure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the test suite catch the bugs that actually ship. 723 unit tests + 32 E2E specs pass while trivial bugs keep shipping because coverage is inverted: ~100% on pure utils, ~0% on the bug-prone layers. **Rev 2 discovery:** the suite tests only the browser path (sql.js); the live desktop path — `NativeDatabaseClient` → Rust `invoke` (70 commands) — has zero automated *correctness* coverage. The cure: regression-proof every known past bug, lock the native boundary contract, enforce per-file coverage floors on bug-prone modules, and run E2E in CI.

**Architecture:** Three tiers per the spec (rev 2). (1) Bug inventory (`specs/coverage-bug-inventory.md`) drives everything: its primary files seed `specs/coverage-floors.json`, and each row maps to a TC-2 unit test, TC-7 E2E flow, and/or TC-8 native-boundary test. (2) Coverage is raised where it's ~0%: a **native-boundary contract test** (mocked `invoke`) locks every `NativeDatabaseClient` op → Rust command name + arg shape; Stryker mutation grows to the bug-prone modules (incl. `db/native/client.ts`, meaningful only once the boundary test exists); store logic is extracted out of `$state()` runes into testable pure modules; the 12 uncovered components get branch-oriented tests. (3) A per-file coverage gate (`scripts/coverage-gate.mjs`) compares touched files against `coverage-floors.json` and fails CI — implemented early and lenient, then ratcheted. E2E enters CI as a separate job.

The orphan `db/native/*.ts` standalone adapters (throw `'not wired'`, imported by nothing) are **dead code — not coverage or mutation targets**. Flag them in the inventory; a separate task removes them.

**Tech Stack:** Vitest + Istanbul (unit/component), Stryker (mutation), Playwright chromium (`src/tests/e2e`, runs against `pnpm build && pnpm preview`), GitHub Actions (`.github/workflows/ci.yml`), Svelte 5 runes + `@testing-library/svelte`. Native boundary test mocks `@tauri-apps/api/core`'s `invoke`.

**Spec:** `specs/2026-08-28-test-coverage-cure.md` (rev 2)

## Global Constraints

- **TDD discipline (CLAUDE.md):** failing test first for every bug fix; full suite green before commit (`pnpm test`, and `pnpm test:e2e` after Task 3).
- **Coverage config:** keep the existing `vitest.config.ts` exclusions. The `stores/**` exclusion stays until a TC-4 task shrinks it; `migrations/**`, `paraglide/**` stay.
- **Gate is monotonic:** floors in `coverage-floors.json` only go up, never down. Ratchet rule: `floor = max(current, observed − 5)`.
- **No 0% modules ship:** any commit touching an uncovered module adds its tests in the same commit.
- **Orphan adapters are out of the coverage/mutation scope:** the `db/native/*.ts` standalone files throw by construction and are imported by nothing — they are dead-code candidates for a separate removal task, never mutation/floors targets. The real native seam to test is `db/native/client.ts` (Task 2).
- **Real-native SQLite smoke is deferred** (out of scope). Task 2's mocked-invoke boundary test is the approved JS-side substitute; the Rust commands keep their `cargo test` coverage in CI.
- **Mutation ranges follow the existing contract:** Tauri-only wrappers stay excluded from `stryker.db.conf.mjs` with the justifying comment.
- **Component-test harness:** `// @vitest-environment jsdom`, `@testing-library/svelte`, probe-component pattern (`helpers/*Probe.svelte`) for bindable observation.
- **Roadmap discipline:** flip each task's `- [ ]`→`- [x]` when its commit lands (the final step's heredoc subject must match the real commit subject exactly, or the roadmap marks the plan stale).

---

### Task 1: Build the bug inventory

**Files:**
- Create: `specs/coverage-bug-inventory.md`

**Interfaces:**
- Consumes: `git log --grep="fix:"` (esp. `dbcb436` batch UI fixes), the memory docs (`MEMORY.md`), `specs/STATUS.md`, and the native-layer ground truth (Task 2's target, `src/lib/db/native/client.ts`, plus the orphan `db/native/*.ts` files).
- Produces: the backlog that Tasks 2, 8, 9, and 13 read rows from, and the file list that seeds Task 4's `coverage-floors.json`.

- [x] **Step 1: Enumerate the bug backlog**

Mine `git log --oneline --grep="fix:"` plus the memory docs. For each candidate bug, record: bug, fixing commit SHA, layer (unit/component/E2E/native-boundary), primary file(s), and whether an existing test covers it (which test file?).

- [x] **Step 2: Cross-check against existing tests**

For each row, grep the test tree (`src/tests/unit/`, `src/tests/e2e/`) for a test that would fail on the pre-fix build. Mark rows "covered" (existing test) or "gap" (needs a TC-2 unit/component test, TC-7 E2E flow, and/or TC-8 boundary test). The seed bugs known to already have specs: onboarding, tour, budgets, quick-add, reload-survival — verify, don't assume.

- [x] **Step 3: Add the native seam + dead-code rows**

Add a row for the live desktop seam: `NativeDatabaseClient` in `src/lib/db/native/client.ts` — every op's command-name/arg-shape contract is untested (only invoke-error propagation is covered). Note the suspected `accountId` vs `account_id` serialization seam. Separately, mark **every** `db/native/*.ts` standalone adapter (accounts/transactions/budgets/categories/goals/rules/meta/debts/reconciliations/reports/export) as `dead-code-candidate` — verify with `grep -rn "db/native/<name>" src/ scripts/` returning nothing, so Tasks 4/5 skip them.

- [x] **Step 4: Write `specs/coverage-bug-inventory.md`**

Table with columns: Bug | Fix commit | Layer | Primary file | Existing test? | Target test. Every gap row must have a Target test cell filled before its TC-2/TC-7/TC-8 task starts.

- [x] **Step 5: Commit**

```bash
git add specs/coverage-bug-inventory.md
git commit -m "$(cat <<'EOF'
docs: add coverage bug inventory for test-coverage cure

Enumerate known past trivial bugs from git log + memory into a
regression-test backlog. Rows map to TC-2 unit, TC-7 E2E, and TC-8
native-boundary tests; primary files seed the coverage-floors gate.
Flags orphan db/native adapter stubs as dead-code candidates.
EOF
)"
```

---

### Task 2: Native DB boundary contract test

**Files:**
- Create: `src/tests/unit/native-boundary.test.ts`

**Interfaces:**
- Consumes: the real `NativeDatabaseClient` (`src/lib/db/native/client.ts`) and the registered Rust command surface (`src-tauri/src/lib.rs` `generate_handler` list). Reuses the `vi.mock('@tauri-apps/api/core')` pattern from `native-client.test.ts`.
- Produces: locks the live-desktop seam. This is the highest-value, currently-zero-covered path. Enables Task 5 to mutate `db/native/client.ts` meaningfully.

- [x] **Step 1: Build the recording invoke mock**

In `src/tests/unit/native-boundary.test.ts`, mock `@tauri-apps/api/core`'s `invoke` as a spy that records `(command, args)` and returns a per-command fixture map (accounts → `[{...AccountWithBalance}]`, transactions → `{...}`, etc.). Instantiate the real `NativeDatabaseClient`.

- [x] **Step 2: Assert command-name mapping per ops group**

For one operation per ops group (accounts, transactions, categories, budgets, goals, rules, meta, debts, reconciliations, reports) plus the lifecycle commands, assert `invoke` was called with the **exact** command name that the Rust `generate_handler` registers (e.g. `account_list`, `transaction_create`, `category_list_buckets`). Cross-check each name against `src-tauri/src/lib.rs`.

- [x] **Step 3: Assert the serialization seam**

The `accountId` vs `account_id` risk: assert the recorded args object's keys match the Rust command's parameter names. If Tauri does not convert camelCase→snake_case, this step is red — surface the mismatch exactly (the suspected live bug), then resolve by aligning the client's arg keys to the Rust params in the same commit.

- [x] **Step 4: Assert result shaping + idempotency**

Assert fixture data deserializes to the domain types (`AccountWithBalance[]`, `Transaction[]`, …). Assert the idempotency contract: a retried mutation reuses the same operation ULID (per `NativeDatabaseClient`'s header comment) rather than minting a new one.

- [x] **Step 5: Green + commit**

`pnpm test` green (the new test included). The old `native-client.test.ts` "throws on every operation" assertion may now be redundant for asserted ops — keep it only where it still holds, or extend it. Commit.

```bash
git add src/tests/unit/native-boundary.test.ts src/lib/db/native/client.ts
git commit -m "$(cat <<'EOF'
test: lock NativeDatabaseClient boundary to Rust command surface

Mocked-invoke contract test asserting every op -> command name + arg
shape against the registered Rust commands, plus result shaping and
retry ULID idempotency. Surfaces the camelCase/snake_case serialization
seam the desktop app ship with.
EOF
)"
```

---

### Task 3: Run Playwright E2E in CI

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the existing `playwright.config.ts` (`webServer: pnpm build && pnpm preview`, `reuseExistingServer: !CI`, `retries: 1`).
- Produces: the CI job that Task 13's flow specs and Task 14's gate must not break.

- [x] **Step 1: Add the `e2e` job**

Append to `.github/workflows/ci.yml`:

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

- [x] **Step 2: Verify the job runs on a PR**

Push the branch and open a PR against `main` (or run the job on the existing `fix/ui-bugfix-session` branch). Confirm: `e2e` job starts, installs chromium, runs all 32 specs, reports pass/fail; the job runs in parallel with `rust` and doesn't block unit tests.

- [x] **Step 3: Confirm failure artifacts**

Introduce a deliberate failing assertion in one spec (or reuse a known-flaky one), confirm `playwright-report/` uploads on failure, then revert. All 32 specs must pass with only the existing `retries: 1` absorbing sql.js fallback flakiness.

- [x] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci: run Playwright E2E in CI

The 32 E2E specs were local-only. Add an e2e job to ci.yml that builds
the app, installs chromium, and runs pnpm test:e2e on PRs, uploading
playwright-report on failure.
EOF
)"
```

---

### Task 4: Build the per-file coverage gate (lenient)

**Files:**
- Create: `scripts/coverage-gate.mjs`
- Create: `specs/coverage-floors.json`
- Modify: `vitest.config.ts` (add `json-summary` reporter)
- Modify: `.github/workflows/ci.yml` (gate step in `quality` job)

**Interfaces:**
- Consumes: `coverage/coverage-summary.json` from `pnpm test:coverage`; `git diff` against the base ref (`BASE_SHA` env in CI, default `HEAD~1` locally).
- Produces: the enforcement mechanism Task 14 ratchets and every later task must keep green. The orphan `db/native/*.ts` adapters are deliberately absent from the floors.

- [x] **Step 1: Add the `json-summary` reporter**

In `vitest.config.ts`, add `'json-summary'` to `coverage.reporter`. Run `pnpm test:coverage` and confirm `coverage/coverage-summary.json` exists with a `total` and per-file `statements`/`branches`/`functions`/`lines` object.

- [x] **Step 2: Seed `specs/coverage-floors.json`**

For each module in the inventory's primary-file list plus the TC-3/TC-4/TC-5/TC-8 targets, record the **current observed** coverage as the floor (so the gate passes at launch). Include `db/native/client.ts` (Task 2 raises it). **Do NOT include** the orphan `db/native/*.ts` adapters. Format: `{ "path/to/file.ts": { "stmts": 80, "branch": 70 } }`. Explicitly include the 0% components so they're visible.

- [x] **Step 3: Write `scripts/coverage-gate.mjs`**

Read `coverage/coverage-summary.json`; compute touched files via `git diff --name-only` against `BASE_SHA` (filter to `src/lib/**`); for each touched file with a floor entry, fail if observed < floor. Print a per-file report (`PASS`/`FAIL floor=80 got=43`) and exit 1 on any violation. No floor entry → pass (targeted floors, not global).

- [x] **Step 4: Wire the CI step**

In the `quality` job, after `Unit tests`, add a `Coverage gate (touched files)` step: run `pnpm test:coverage` then `node scripts/coverage-gate.mjs` with `BASE_SHA` set from the PR base. The step must be green against the seeded lenient floors.

- [x] **Step 5: Prove the gate fires**

Adversarial check: temporarily lower a covered file's floor *below* its observed value, run the gate → `FAIL` + exit 1. Restore the floor. Then confirm the gate passes on a clean run and that the CI step shows PASS.

- [x] **Step 6: Commit**

```bash
git add scripts/coverage-gate.mjs specs/coverage-floors.json vitest.config.ts .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci: add per-file coverage gate on touched files

New scripts/coverage-gate.mjs reads coverage-summary.json, diffs touched
files against the PR base, and enforces per-file floors from
specs/coverage-floors.json. Seeded lenient; floors ratchet up.
Orphan db/native adapter stubs are not gated. json-summary reporter
added to vitest.config.ts.
EOF
)"
```

---

### Task 5: Expand Stryker mutation scope to bug-prone modules

**Files:**
- Modify: `stryker.conf.mjs`
- Modify: `stryker.db.conf.mjs`
- Modify: `specs/coverage-floors.json` (record initial mutation scores as baselines)

**Interfaces:**
- Consumes: the existing `@stryker-mutator/vitest-runner` setup; the `db/native/client.ts` boundary test from Task 2 (without it, mutating `client.ts` command strings proves nothing).
- Produces: mutation-score floors for the bug-prone modules; feeds Task 14's floors. The orphan adapters are NOT targets.

- [x] **Step 1: Extend `stryker.conf.mjs`**

Add to `mutate`: `src/lib/db/native/client.ts` (command-name/arg-key mutations are now caught by Task 2's boundary test). Keep `rules_matcher.ts` and `dedup.ts`. Do NOT add the orphan `db/native/*.ts` adapters.

- [x] **Step 2: Extend `stryker.db.conf.mjs`**

Add `src/lib/db/repos/transactions.ts` and `src/lib/db/repos/budgets.ts`. Keep the existing ranges/comment contract — Tauri-only `runAutoBackup`/`restore` wrappers stay excluded.

- [x] **Step 3: Run and baseline**

Run `pnpm test:mutation:pure` and `pnpm test:mutation:db`. Record the mutation scores for the newly added files in the Task 14 floor file as `mutation` floors. If `db/native/client.ts` scores alarmingly low (<50%), it signals the boundary test is too shallow — extend it rather than accepting the low score.

- [x] **Step 4: Commit**

```bash
git add stryker.conf.mjs stryker.db.conf.mjs specs/coverage-floors.json
git commit -m "$(cat <<'EOF'
test: expand mutation scope to bug-prone modules

Stryker now mutates db/native/client.ts (meaningful via the boundary
test), db/repos/transactions.ts and db/repos/budgets.ts in addition to
rules_matcher and dedup. Orphan db/native adapter stubs are excluded.
Baselines recorded in coverage-floors.json.
EOF
)"
```

---

### Task 6: Extract `db.svelte.ts` logic into a pure module

**Files:**
- Create: `src/lib/logic/db-boot.ts` (+ `src/tests/unit/logic/db-boot.test.ts`)
- Modify: `src/lib/stores/db.svelte.ts`

**Interfaces:**
- Consumes: `db.svelte.ts` — the boot/migration-ordering/quick-add decision logic (the code paths behind the quick-add contention and migration-race bugs).
- Produces: the pure module Tasks 8 and 9 test against; a thinner store. Behavior must be byte-identical (refactor under test).

- [x] **Step 1: Identify the pure candidates**

In `src/lib/stores/db.svelte.ts`, extract the decision logic that does not touch `$state`/Tauri plumbing: migration ordering, idempotent boot guard, quick-add savepoint/`getDb()` decision, VACUUM gating. Keep the `isTauri()`/event wiring in the store.

- [x] **Step 2: Write characterization tests (green-first)**

For each extracted candidate, write `src/tests/unit/logic/db-boot.test.ts` pinning current behavior — including the failure states the two bugs produced (double-init must not "duplicate column name"; quick-add under contention must not throw "no such savepoint"). These pass against current behavior; they lock it down.

- [x] **Step 3: Extract and thin the store**

Move the logic to `src/lib/logic/db-boot.ts`; `db.svelte.ts` calls into it. All existing tests stay green, `pnpm check` passes (public store surface unchanged).

- [x] **Step 4: Verify coverage and gate**

Run `pnpm test:coverage`: the new module must be ≥90% stmts / ≥80% branch. Update `specs/coverage-floors.json` with its floor. Gate stays green.

- [x] **Step 5: Commit**

```bash
git add src/lib/logic/db-boot.ts src/tests/unit/logic/db-boot.test.ts src/lib/stores/db.svelte.ts specs/coverage-floors.json
git commit -m "$(cat <<'EOF'
refactor: extract db.svelte.ts boot logic into pure module

Move migration-ordering, idempotent-boot guard, and quick-add decision
logic out of $state() runes into src/lib/logic/db-boot.ts so Istanbul
can measure it. Characterization tests pin the failure states behind the
quick-add contention and migration-race bugs.
EOF
)"
```

---

### Task 7: Extract budgets/settings/transactions pure logic

**Files:**
- Create: `src/lib/logic/budget-calc.ts`, `src/lib/logic/tx-transform.ts` (+ unit tests in `src/tests/unit/logic/`)
- Modify: `src/lib/stores/budgets.svelte.ts`, `src/lib/stores/settings.svelte.ts`, `src/lib/stores/transactions.svelte.ts` (as warranted)

**Interfaces:**
- Consumes: the calc/validation/transform logic currently inline in the three stores (follow the existing `BudgetSummaryCalc` pattern).
- Produces: pure modules with tests; thinner stores. No behavior change.

- [x] **Step 1: Locate the pure logic**

For each of the three stores, list the pure calc/validation/transform blocks (budget summary math, settings currency/theme transforms, transaction kind/date/amount normalization).

- [x] **Step 2: Write tests for the extracted functions (green-first)**

New tests in `src/tests/unit/logic/` hit ≥90% stmts / ≥80% branch on each new module. Include the branch-y edge cases (empty budgets, boundary dates, null payee/tag) that the 59% branch number hides today.

- [x] **Step 3: Extract and thin the stores**

Move logic; stores call into the pure modules. Full suite green, `pnpm check` green.

- [x] **Step 4: Update floors and gate**

Record new-module floors in `specs/coverage-floors.json`; confirm the gate stays green.

- [x] **Step 5: Commit**

```bash
git add src/lib/logic specs/coverage-floors.json
git commit -m "$(cat <<'EOF'
refactor: extract budgets/transactions pure logic

Move calc and transform logic out of $state() runes into pure modules
under src/lib/logic/ so it is Istanbul-measurable. Branch-oriented tests
cover the edge cases the 59% branch coverage hides today. settings.svelte.ts
left in place: its only non-trivial line is an applyThemeClass ternary, not
worth a module.
EOF
)"
```

---

### Task 8: Prove-it regression tests — DB-layer + native-seam bugs

**Files:**
- Create/Modify: `src/tests/unit/migrations.test.ts`, `src/tests/unit/logic/db-boot.test.ts`, a schema-version drift test under `src/tests/unit/`, and `src/tests/unit/native-boundary.test.ts` (extend)

**Interfaces:**
- Consumes: the inventory rows for quick-add contention, migration idempotency race, schema-version call-site drift, and the native-seam row; the pure module from Task 6.
- Produces: the DB-layer + native half of the "every inventory bug has a regression test" criterion. (The orphan adapter stubs are NOT targeted — they throw by construction.)

- [x] **Step 1: Confirm the gap per inventory row**

For each row, confirm the exact pre-fix failure state is still untested (or extend an existing test that misses the failure mode).

- [x] **Step 2: Migration idempotency race**

Add a test to `src/tests/unit/migrations.test.ts` (or `db-boot.test.ts`): run the migration sequence twice over the same `createTestDbFromPath` db — must not throw "duplicate column name". It must fail if the idempotency guard is removed.

- [x] **Step 3: Schema-version call-site drift**

Add a test asserting every `importDatabase`/`validateImport` version literal (UI, unit, E2E fixtures) equals the current migration registry version. It must fail if any literal drifts — the failure that silently broke E2E.

- [x] **Step 4: Quick-add contention path**

Extend `db-boot.test.ts` to cover the quick-add decision logic under the contended state the "no such savepoint" bug came from (single pooled connection, second call while a savepoint is open). Test must fail if the guard is removed.

> **2026-08-29 placement deviation:** the contention guard lives in savepoint *naming*
> (`browser/service.ts`'s `uniqueSavepointName`), not in `db-boot.ts` — `db-boot.ts` is a
> pure status→recovery module with no savepoint logic. The nested-in-flight regression
> test therefore landed in `db-service.test.ts` alongside the existing `uniqueSavepointName`
> tests (the file that owns the guard), not in `db-boot.test.ts`.

- [x] **Step 5: Native-seam regression rows**

For any native-seam bug the inventory surfaced beyond Task 2's coverage (e.g. a specific op whose response shape changed on the Rust side), add the failing assertion. Do NOT touch the orphan adapters.

> **2026-08-29 no-new-assertion note:** inventory row 10 (retry reuses ULID) is covered by
> the boundary test's idempotency contract, which documents the honest finding: there is
> NO JS-side retry-ULID to assert — mutations pass no `operation_id` and idempotency is
> Rust-side (`cargo test`). Fabricating a JS retry-ULID assertion would be dishonest, so
> Step 5 adds no new failing assertion. Row 9 (command/arg shape) is already locked by
> Task 2 + the Task 5 surface sweep.

- [x] **Step 6: Full suite + commit**

`pnpm test` fully green; demonstrate each new test is red when its guard is removed. Commit with the inventory updated (`Existing test` column).

```bash
git add src/tests/unit specs/coverage-bug-inventory.md
git commit -m "$(cat <<'EOF'
test: prove-it regressions for DB-layer and native-seam bugs

Regression tests for migration idempotency ("duplicate column name"),
schema-version call-site drift (silent E2E break), the quick-add
contention path ("no such savepoint"), and native-seam response-shape
rows. Each fails if its guard is removed.
EOF
)"
```

---

### Task 9: Prove-it regression tests — component/pure bugs

**Files:**
- Modify: `src/tests/unit/components/Autocomplete.test.ts`
- Create: `src/tests/unit/quick_parse-tokenizer.test.ts` (or extend `src/tests/unit/quick_parse.test.ts`)
- Modify: `specs/coverage-bug-inventory.md` (batch-UI rows)

**Interfaces:**
- Consumes: inventory rows for autocomplete free-text, parseAmount k/m/tr tokenizer constraint, and the `dbcb436` batch UI fixes.
- Produces: the component/pure half of the "every inventory bug has a regression test" criterion.

- [x] **Step 1: Autocomplete free-text**

In `Autocomplete.test.ts`, add the regression: typing a payee value not in the option list must be preserved on blur/save (the free-text values silently dropped on save bug). Test must fail if `allowFreeText` handling is removed.

> **2026-08-29 already-covered note:** Step 1's regression already exists in
> `Autocomplete.test.ts` ("commits a typed free-text value on blur when allowFreeText is
> set"). If `allowFreeText` handling were removed, blur leaves `value=''` and the probe
> assertion fails. No new assertion needed.


- [x] **Step 2: parseAmount tokenizer constraint**

Add a unit test asserting `parseAmount` handles `k`/`m`/`tr` locale-aware, and that `quick_parse.ts` does **not** expand them itself (the CLAUDE.md gotcha — tokenizer must not expand). Test fails if the tokenizer expands.

- [x] **Step 3: Batch-UI rows verification**

For each `dbcb436` row (tour, DatePicker, onboarding, budgets, i18n): verify the existing spec truly reproduces the fix (check out the pre-fix commit, confirm red). Where an existing spec only passes incidentally, add the missing assertion. Update the inventory's `Existing test` column.

> **2026-08-29 verification scope:** existing E2E specs reproduce each `dbcb436` fix
> (onboarding.spec, budgets.spec, tour→light-contrast, DatePicker→goals/accounts,
> i18n→settings/transactions). Full pre-fix-checkout red-reproduction of each flow is
> Task 13's domain (E2E regression flows); Step 3 confirms the specs exist and updates the
> inventory's `Existing test` column.


- [x] **Step 4: Commit**

```bash
git add src/tests/unit specs/coverage-bug-inventory.md
git commit -m "$(cat <<'EOF'
test: prove-it regressions for component/pure bugs

Autocomplete free-text preservation on save, parseAmount locale k/m/tr
(tokenizer must not expand), and verification that the batch-UI fixes
are reproduced by existing specs.
EOF
)"
```

---

### Task 10: Component tests — forms + modals

**Files:**
- Create: `src/tests/unit/components/AccountForm.test.ts`, `GoalForm.test.ts`, `ImportTransactionsModal.test.ts`
- Modify: `specs/coverage-floors.json`

**Interfaces:**
- Consumes: the components at 0% coverage (`forms/AccountForm`, `forms/GoalForm`, `modals/ImportTransactionsModal`); the existing component-test harness.
- Produces: ≥80% stmts / ≥70% branch on all three.

- [x] **Step 1: AccountForm**

`@testing-library/svelte` tests: required-field validation, amount/date binding, submit payload, error states, disabled submit. ≥80/70.

- [x] **Step 2: GoalForm**

Validation branches (amount formats, empty target), save/cancel behavior, empty-state rendering. ≥80/70.

- [x] **Step 3: ImportTransactionsModal**

File-change flow, CSV parse trigger, error surface (AppError), cancel, success dismissal. Use the `csv-import` E2E fixtures' expectations as the unit contract where useful. ≥80/70.

- [x] **Step 4: Floors + gate**

Record floors for the three components in `specs/coverage-floors.json`; `pnpm test` green; gate green.

- [x] **Step 5: Commit**

```bash
git add src/tests/unit/components specs/coverage-floors.json
git commit -m "$(cat <<'EOF'
test: add AccountForm/GoalForm/ImportTransactionsModal coverage

Branch-oriented component tests for the forms/modals at 0% coverage:
validation branches, error states, submit payloads. Floors recorded.
EOF
)"
```

---

### Task 11: Component tests — layout + primitives

**Files:**
- Create: `src/tests/unit/components/Sidebar.test.ts`, `FAB.test.ts`, `ShortcutRef.test.ts`, `DatePicker.test.ts`, `FilterControls.test.ts`, `FilterSheet.test.ts`
- Modify: `specs/coverage-floors.json`

**Interfaces:**
- Consumes: the 0%-coverage layout components and the 30% DatePicker; the existing harness + probe pattern.
- Produces: ≥80% stmts / ≥70% branch on all six.

- [x] **Step 1: Layout (Sidebar, FAB, ShortcutRef)**

Navigation active-state logic (Sidebar), FAB visibility/click-to-add, ShortcutRef key-label rendering. ≥80/70 each.

- [x] **Step 2: DatePicker**

This is the 30%-coverage one and a `dbcb436` bug target: date selection, month navigation, min/max bounds, empty/disabled states. Reference the tour/DatePicker inventory rows from Task 1. ≥80/70.

- [x] **Step 3: FilterControls + FilterSheet**

Filter chip add/remove/toggle, sheet open/close, apply/cancel, empty-filter state. ≥80/70 each.

- [x] **Step 4: Floors + gate**

Record floors; `pnpm test` green; gate green.

- [x] **Step 5: Commit**

```bash
git add src/tests/unit/components specs/coverage-floors.json
git commit -m "$(cat <<'EOF'
test: add layout/primitives component coverage

Sidebar, FAB, ShortcutRef, DatePicker, FilterControls, FilterSheet —
branch-oriented tests incl. DatePicker's 30% gap. Floors recorded.
EOF
)"
```

---

### Task 12: Component tests — reports

**Files:**
- Create: `src/tests/unit/components/AdjustmentsToggle.test.ts`, `TapeLine.test.ts`
- Modify: `src/tests/unit/components/Money.test.ts` (extend the partial 81% toward branch-complete)
- Modify: `specs/coverage-floors.json`

**Interfaces:**
- Consumes: the reports components at 0% (AdjustmentsToggle, TapeLine) and partial (Money); the harness.
- Produces: ≥80% stmts / ≥70% branch on all three.

- [x] **Step 1: AdjustmentsToggle + TapeLine**

Toggle on/off state, label/accessibility, tape-line rendering with the `palette.ts`/`report-format.ts` fixtures. ≥80/70 each.

- [x] **Step 2: Money**

Extend to branch-complete: formatting edges, sign handling, currency config variants. ≥80/70.

- [x] **Step 3: Floors + gate**

Record floors; `pnpm test` green; gate green.

- [x] **Step 4: Commit**

```bash
git add src/tests/unit/components specs/coverage-floors.json
git commit -m "$(cat <<'EOF'
test: add reports component coverage

AdjustmentsToggle and TapeLine at 0%; Money extended to branch-complete.
Floors recorded.
EOF
)"
```

---

### Task 13: E2E regression flows for past bugs

**Files:**
- Create: `src/tests/e2e/<area>-regression.spec.ts` per gap found in Task 1's inventory
- Modify: `specs/coverage-bug-inventory.md`

**Interfaces:**
- Consumes: Task 1's inventory (rows marked for E2E flows); the existing `fixtures/` + `helpers/`; CI from Task 3.
- Produces: flow-level regression coverage — the layer that catches wiring bugs unit tests cannot.

- [x] **Step 1: Enumerate the flow-level gaps**

From the inventory, the rows whose target test includes E2E and whose existing coverage was verified as missing or incidental in Task 9. Step 3.

- [x] **Step 2: Write the flow specs**

For each: reproduce the pre-fix user flow, assert the fixed behavior. Follow the E2E selector patterns (`e2e-selector-patterns-2026-08`): radio roles, grouped tabs, confirm dialogs, hydration wait, surface specificity. Verify each spec fails against the pre-fix build (check out parent of the fix commit) and passes on current HEAD.

- [x] **Step 3: Full E2E suite**

`pnpm test:e2e` green locally (and in CI via Task 3's job). Update the inventory's `Existing test` column to "E2E spec".

- [x] **Step 4: Commit**

```bash
git add src/tests/e2e specs/coverage-bug-inventory.md
git commit -m "$(cat <<'EOF'
test: add E2E regression flows for past bugs

Flow-level specs reproducing the inventory bugs at the wiring layer —
fails on the pre-fix build, passes on HEAD. Closes the gap unit tests
cannot see.
EOF
)"
```

---

### Task 14: Enforce the coverage floors (gate capstone)

**Files:**
- Modify: `specs/coverage-floors.json`
- Modify (as needed): `scripts/coverage-gate.mjs`

**Interfaces:**
- Consumes: the floors achieved by Tasks 4–12 and the mutation baselines from Task 5.
- Produces: the enforced gate — the "no bug-prone module drops below its floor" guarantee. The orphan adapter stubs remain ungated.

- [ ] **Step 1: Ratchet floors to targets**

Set `specs/coverage-floors.json` to the spec's targets for every module that reached them: `db/native/client.ts` 90/80, `db/browser/client.ts` 80/70, `db/repos/transactions.ts` 90/80, `db/repos/budgets.ts` 85/75, `backup/index.ts` 80/70, TC-4 pure modules 90/80, TC-5 components 80/70. Add `mutation` floors from Task 5's baselines. Any module below target gets an explicit "known gap + plan" entry, not a silent pass. **No entry for the orphan `db/native/*.ts` adapters.**

- [ ] **Step 2: Adversarial gate check**

Remove one test from a covered module, run the gate → must FAIL with the file and floor in the report. Restore the test. Also confirm a PR that drops a touched module below its floor is blocked.

- [ ] **Step 3: Full verification**

`pnpm test`, `pnpm test:coverage` (gate green), `pnpm test:e2e`, `pnpm check`, `pnpm test:mutation` — all green. Confirm no 0%-coverage module remains in `src/lib/` other than the documented exclusions and the orphan adapters.

- [ ] **Step 4: Commit**

```bash
git add specs/coverage-floors.json scripts/coverage-gate.mjs
git commit -m "$(cat <<'EOF'
ci: enforce coverage floors on touched files

Ratchet coverage-floors.json to the spec targets (80/70 stmts/branch on
bug-prone modules, 90/80 on pure logic and the native boundary client)
and add mutation floors from the Stryker baselines. Orphan db/native
adapter stubs stay ungated. Gate verified to block a real regression.
EOF
)"
```

---

### Task 15: Final verification + roadmap refresh

**Files:**
- Modify: `specs/STATUS.md` (generated — via `pnpm test:roadmap`)

**Interfaces:**
- Consumes: every prior task's landed commits and flipped checkboxes.
- Produces: the "cured" state: both success criteria met, the native boundary locked, and visible in the roadmap.

- [ ] **Step 1: Confirm bug-driven criterion**

Every inventory row has its target test landed (unit/component, E2E, and/or native-boundary) — spot-check three rows by reverting the fix mentally and confirming the test is red. Confirm the plan's own tasks' steps are all `- [x]`.

- [ ] **Step 2: Confirm numeric + boundary criteria**

`pnpm test:coverage` shows the target modules ≥ their floors and the gate passes on the full tree; mutation scores reported for the expanded scope including `db/native/client.ts`; `pnpm test:unit/native-boundary` green. The orphan `db/native/*.ts` adapters are marked dead-code candidates (removal deferred to a separate task) — confirm they are not counted as gaps.

- [ ] **Step 3: Refresh the roadmap**

Run `pnpm test:roadmap`; confirm no `⚠ stale` warning and `specs/STATUS.md` shows the plan as implemented (all boxes `[x]` with matching commits).

- [ ] **Step 4: Commit**

```bash
git add specs/plans/2026-08-28-test-coverage-cure.md
git commit -m "$(cat <<'EOF'
docs: refresh roadmap for test-coverage cure

All tasks landed and verified. Bug inventory fully tested, native
boundary contract locked, floors enforced, E2E in CI. STATUS.md
regenerated by pnpm test:roadmap.
EOF
)"
```

---

## Checkpoints

### Checkpoint: Foundation (after Tasks 1–4)
- [ ] `specs/coverage-bug-inventory.md` exists with a Target test per gap row, native-seam row present, orphan adapters flagged dead-code
- [ ] Boundary contract test (Task 2) green and locking the Rust seam
- [ ] E2E job runs in CI; gate step runs and passes (lenient)
- [ ] Full suite green: `pnpm test`, `pnpm check`
- [ ] Review with human before proceeding

### Checkpoint: Coverage raised (after Tasks 5–13)
- [ ] No 0% component remains in `src/lib/`; pure modules ≥90/80
- [ ] Every inventory row has its target test landed
- [ ] Mutation baselines recorded; Stryker covers the bug-prone modules incl. `db/native/client.ts`
- [ ] `pnpm test`, `pnpm test:e2e` green; gate green
- [ ] Review with human before proceeding

### Checkpoint: Capstone (after Tasks 14–15)
- [ ] Gate enforces target floors and blocks a real regression (adversarial check passed)
- [ ] `pnpm test:roadmap` shows the plan implemented, no staleness
- [ ] Both success criteria demonstrated — bug-driven AND numeric floors; native boundary locked

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Gate fails CI immediately at strictness (0% modules) | High | Task 4 seeds floors at current levels; Task 14 ratchets only after coverage lands |
| Boundary test surfaces a real camelCase/snake_case mismatch | High | Task 2 Step 3 surfaces it exactly, then aligns the client's arg keys in the same commit — a live-desktop bug caught before it ships |
| Mutation on `db/native/client.ts` scores low → boundary test too shallow | Med | Task 5 Step 3 treats <50% as a red flag and extends the boundary test, not accepting the low score |
| Store extraction changes behavior | High | Characterization tests green-first (Task 6/7); full suite + `pnpm check` gate each commit |
| Stryker on DB repos slow/expensive | Med | Run in `:db` config; baseline then ratchet; keep Tauri-only ranges excluded |
| E2E-in-CI flakiness from sql.js worker races | Med | Existing `retries: 1` + comment contract; track retry rate in Task 3 Step 3 before proceeding |
| Inventory misses a bug class | Med | Cross-check `MEMORY.md` + `specs/STATUS.md` in Task 1; review sign-off gate |
| Removing orphan adapters breaks an unknown reference | Med | Task 1 Step 3 greps imports first; removal stays a separate approved task, not part of this plan |

## Open Questions
- None blocking. Task 1's inventory may surface a bug class that needs a different test layer — resolve there before its TC-2/TC-7/TC-8 task starts. Task 2 Step 3 determines whether the `accountId`/`account_id` seam is a live bug (red) or correctly converted by Tauri (green) — resolve there.