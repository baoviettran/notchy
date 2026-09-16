# Rust Business-Layer Fix Phase Implementation Plan
**Serves:** STORY-001

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gap between the Rust database boundary spec's stated criteria and what shipped — bind the IPC command surface to `lib.rs` on both names and arguments, wire error-code parity through the compiler, port the four commands the client invokes but Rust never implemented, and fix the five source-level defects the review found.

**Architecture:** Four sequenced stages. Stage 0 lands two contract gates that **fail on entry and enumerate the work**; every later stage is verified against them by construction. Stage 1 fixes Rust source defects and ports the four missing commands, which turns Gate 1 green. Stage 2 threads the missing report filter and makes the error envelope usable end-to-end. Stage 3 is pure refactor with no correctness consumer — it is the designated cut line.

**Tech Stack:** Rust (rusqlite, tauri, ts_rs, serde), TypeScript (Vitest, Svelte 5 runes, Paraglide i18n), sql.js for the browser reference implementation.

**Spec:** `specs/2026-09-14-rust-business-layer-fix-phase-design.md`

## Global Constraints

- **No new dependencies.** Prefer stdlib and what is already installed (spec's dependency discipline).
- **Applied migrations are immutable.** `src-tauri/src/database/migrations.rs` CHECK literals are never edited; §6.1 of the spec pins the money bound as a Rust constant with a parity test instead.
- **`receipt.rs` is untouched.** The idempotency seam is explicitly out of scope (spec §5).
- **Error envelopes carry only allowlisted `MetaKey`s.** `DbError::with_meta` panics on an unknown key — never pass a raw string.
- **Rust stays the source of truth for the contract.** Generated bindings are produced by `pnpm generate:db-contracts`; CI gates them with `pnpm check:db-contracts`.
- **Every task ends with its own commit.** The branch is expected to be **red from Task 2 until Task 11** — the gate lands before the fix. Do not merge before Task 11.
- **TDD, no exceptions.** Write the test, watch it fail, implement, watch it pass.
- Commands are run from the repo root. `zsh` requires quoting globs: `grep -rn "x" --include="*.rs"`.

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `src/tests/unit/helpers/rust-command-surface.ts` | Parses `lib.rs`'s `generate_handler![...]` and every `#[tauri::command]` signature; projects snake_case params to the camelCase the IPC layer uses. Fails closed. |
| `src/tests/unit/rust-command-surface.test.ts` | Self-tests for the parser, including the comment-header fixture that produced the §8 miscount and the malformed inputs that must throw. |
| `src/tests/unit/rust-error-parity.test.ts` | Gate 2's runtime backstop: every generated `ErrorCode` has a message, and dispatch keys on origin. |
| `src/lib/utils/rust-error-messages.ts` | `Record<ErrorCode, (params) => string>` — exhaustiveness is a compile error. |
| `src/lib/native/to-app-error.ts` | Converts the Rust `{code, meta}` envelope into a `NativeAppError`. |
| `src-tauri/tests/domain_transactions_bulk.rs` | Rust coverage for the three bulk transaction commands. |
| `src-tauri/tests/fixtures/control-chars.json` | The shared C0∪C1 corpus read by both the Rust and the TypeScript control-char tests. |
| `src-tauri/src/database/domains/balance.rs` | Stage 3: one account-balance-as-of helper. |
| `src-tauri/src/database/domains/civil_date.rs` | Stage 3: one civil-date derivation. |

**Modified**

| Path | Change |
|---|---|
| `src/tests/unit/native-boundary.test.ts` | Binds its op table to the parsed Rust surface; drops the hand-written `argKeys` third copy; removes the `?? null` fixture fallback. |
| `src/lib/errors.ts` | Adds `NativeAppError` — the origin marker. |
| `src/lib/utils/errors.ts` | `mapError` branches on the marker before the browser switch. |
| `src/lib/db/native/client.ts` | Local `invoke` wrapper applying `toAppError`; four command call sites; `tagId` null fix. |
| `src-tauri/src/lib.rs` | Registers four commands. |
| `src-tauri/src/database/commands.rs` | Four command wrappers; `bucket_id` threaded into `report_get_trend`. |
| `src-tauri/src/database/domains/transactions.rs` | C2 duplicate-`SET`; three bulk ops; C0∪C1 strip. |
| `src-tauri/src/database/domains/accounts.rs` | I2 restore guard; I3 linked-goal envelope. |
| `src-tauri/src/database/domains/goals.rs` | I2 restore guard. |
| `src-tauri/src/database/domains/debts.rs` | C3 default tag. |
| `src-tauri/src/database/domains/budgets.rs` | I4 malformed month. |
| `src-tauri/src/database/domains/reports.rs` | I1 `bucket_id`; S2 shared predicate; S4 N+1. |
| `src-tauri/src/database/error.rs` | I5 bound; C2 constraint mapping; I3 code + meta keys. |
| `messages/en.json`, `messages/vi.json` | New `errors_*` keys. |

**Deleted (Stage 3)**

| Path | Why |
|---|---|
| `src/lib/db/native/reports.ts` | Inactive stub whose every export throws `native reports adapter not wired`; the port lives in `native/client.ts`. Verified unreferenced. |

---

## Stage 0 — Contract gates

### Task 1: Fail-closed Rust command-surface parser

**Files:**
- Create: `src/tests/unit/helpers/rust-command-surface.ts`
- Test: `src/tests/unit/rust-command-surface.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export function camelCase(snake: string): string`
  - `export function parseRegisteredCommands(libRsPath: string): string[]`
  - `export interface RustCommand { name: string; params: string[] }`
  - `export interface CommandSurface { registered: string[]; commands: Map<string, RustCommand> }`
  - `export function loadCommandSurface(repoRoot?: string): CommandSurface`
  - `export function expectedArgKeys(surface: CommandSurface, command: string): string[]`

- [x] **Step 1: Write the failing test**

Create `src/tests/unit/rust-command-surface.test.ts`:

```ts
/**
 * Self-tests for the Rust command-surface parser.
 *
 * The parser is the only thing standing between this repo and a fourth
 * instance of the scan failures recorded in the fix-phase spec §8 — three
 * separate scans returned an empty or wrong set and were read as a fact about
 * the code. So the parser is tested against those exact shapes: a comment
 * header that swallows the following entry, and malformed input that must
 * throw rather than degrade to an empty set.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	camelCase,
	expectedArgKeys,
	loadCommandSurface,
	parseRegisteredCommands,
} from './helpers/rust-command-surface';

function tempLibRs(body: string): string {
	const dir = mkdtempSync(join(tmpdir(), 'notchy-lib-rs-'));
	const path = join(dir, 'lib.rs');
	writeFileSync(path, body);
	return path;
}

describe('camelCase', () => {
	it('projects the snake_case params the IPC layer receives', () => {
		expect(camelCase('account_id')).toBe('accountId');
		expect(camelCase('month_a')).toBe('monthA');
		expect(camelCase('include_adjustments')).toBe('includeAdjustments');
		expect(camelCase('id')).toBe('id');
	});

	it('strips the leading underscore Rust uses to mark an unused binding', () => {
		expect(camelCase('_bucket_id')).toBe('bucketId');
	});
});

describe('parseRegisteredCommands', () => {
	it('does not let a comment header swallow the entry that follows it', () => {
		// The §8 bug: splitting on commas before stripping comments made each
		// `// Account commands` header absorb the next command.
		const path = tempLibRs(`
			.invoke_handler(tauri::generate_handler![
				quit_app,
				// Account commands
				account_list,
				account_get,
				// Transaction commands
				transaction_list,
			])
		`);
		expect(parseRegisteredCommands(path)).toEqual([
			'quit_app',
			'account_list',
			'account_get',
			'transaction_list',
		]);
	});

	it('throws when the file has no generate_handler! block', () => {
		const path = tempLibRs('fn main() {}');
		expect(() => parseRegisteredCommands(path)).toThrow(/generate_handler/);
	});

	it('throws on an unbalanced bracket rather than returning what it found', () => {
		const path = tempLibRs('.invoke_handler(tauri::generate_handler![a, b,');
		expect(() => parseRegisteredCommands(path)).toThrow(/unbalanced/);
	});

	it('throws on an empty handler list', () => {
		const path = tempLibRs('.invoke_handler(tauri::generate_handler![])');
		expect(() => parseRegisteredCommands(path)).toThrow(/empty/);
	});
});

describe('loadCommandSurface on the real tree', () => {
	const surface = loadCommandSurface();

	it('finds the registered commands and a signature for every one', () => {
		expect(surface.registered.length).toBeGreaterThan(50);
		for (const name of surface.registered) {
			expect(surface.commands.has(name)).toBe(true);
		}
	});

	it('projects account_get_balance_as_of to the camelCase the client sends', () => {
		expect(expectedArgKeys(surface, 'account_get_balance_as_of')).toEqual([
			'accountId',
			'date',
		]);
	});

	it('excludes Tauri-injected params that never cross the IPC argument map', () => {
		const params = expectedArgKeys(surface, 'account_delete');
		expect(params).toEqual(['id']);
	});

	it('throws for a command that is not registered', () => {
		expect(() => expectedArgKeys(surface, 'not_a_real_command')).toThrow(/unknown command/);
	});
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/tests/unit/rust-command-surface.test.ts`
Expected: FAIL — `Failed to resolve import "./helpers/rust-command-surface"`.

- [x] **Step 3: Write the parser**

Create `src/tests/unit/helpers/rust-command-surface.ts`:

```ts
/**
 * Parses the Rust command surface out of the source tree.
 *
 * The boundary test's op table is a third copy of the surface — the client is
 * one copy, `lib.rs` is another, and the table is the only one verified. Both
 * sides of that assertion are TypeScript, so nothing binds the table to Rust
 * and four commands the client invokes are registered nowhere.
 *
 * This module makes `lib.rs` the authority: the table is checked against the
 * parsed surface, on names AND on the camelCase argument keys Tauri derives
 * from each command's parameter list.
 *
 * Every failure mode throws. A scan that degrades to an empty set is exactly
 * how the §8 miscounts happened; an empty or partial set must never read as a
 * passing assertion.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface RustCommand {
	name: string;
	/** Declared parameter names, in order, excluding Tauri-injected ones. */
	params: string[];
}

export interface CommandSurface {
	registered: string[];
	commands: Map<string, RustCommand>;
}

/**
 * Params Tauri supplies from the invocation context. They never appear in the
 * IPC argument map, so the client never sends them.
 */
const INJECTED_PARAM = /State<|WebviewWindow|AppHandle|tauri::Window/;

/**
 * `account_id` -> `accountId`. A leading underscore marks an unused Rust
 * binding and is not part of the wire name.
 */
export function camelCase(snake: string): string {
	return snake
		.replace(/^_+/, '')
		.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Remove whole-line comments only. A mid-line `//` may be inside a string
 * literal (a URL, a SQL fragment), so stripping it would corrupt the source we
 * are about to parse.
 */
function stripLineComments(source: string): string {
	return source.replace(/^[ \t]*\/\/.*$/gm, '');
}

function rustSources(dir: string): string[] {
	if (!existsSync(dir)) {
		throw new Error(`Rust source directory not found: ${dir}`);
	}
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...rustSources(full));
		} else if (entry.name.endsWith('.rs')) {
			out.push(full);
		}
	}
	return out;
}

/** Extract the command names from a `generate_handler![...]` block. */
export function parseRegisteredCommands(libRsPath: string): string[] {
	if (!existsSync(libRsPath)) {
		throw new Error(`lib.rs not found: ${libRsPath}`);
	}
	const source = stripLineComments(readFileSync(libRsPath, 'utf8'));

	const marker = source.indexOf('generate_handler!');
	if (marker === -1) {
		throw new Error(`no generate_handler! block in ${libRsPath}`);
	}
	const open = source.indexOf('[', marker);
	if (open === -1) {
		throw new Error(`generate_handler! has no argument list in ${libRsPath}`);
	}

	let depth = 0;
	let close = -1;
	for (let i = open; i < source.length; i += 1) {
		if (source[i] === '[') depth += 1;
		else if (source[i] === ']') {
			depth -= 1;
			if (depth === 0) {
				close = i;
				break;
			}
		}
	}
	if (close === -1) {
		throw new Error(`unbalanced brackets in generate_handler! (${libRsPath})`);
	}

	const names = source
		.slice(open + 1, close)
		.split(',')
		.map((token) => token.trim())
		.filter((token) => token.length > 0);

	if (names.length === 0) {
		throw new Error(`generate_handler! is empty in ${libRsPath}`);
	}
	const unparsable = names.filter((n) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(n));
	if (unparsable.length > 0) {
		throw new Error(
			`unparsable entries in generate_handler!: ${unparsable.join(', ')}`
		);
	}
	return names;
}

/**
 * Read the parameter list that starts at `openParen` and split it on
 * top-level commas, so `State<'_, Arc<DatabaseManager>>` stays one param.
 */
function paramsFrom(source: string, openParen: number): string[] {
	let depth = 1;
	let i = openParen + 1;
	for (; i < source.length && depth > 0; i += 1) {
		const ch = source[i];
		if (ch === '(' || ch === '<' || ch === '[') depth += 1;
		else if (ch === ')' || ch === '>' || ch === ']') depth -= 1;
	}
	if (depth !== 0) {
		throw new Error('unbalanced parentheses in a #[tauri::command] signature');
	}
	const body = source.slice(openParen + 1, i - 1);

	const parts: string[] = [];
	let inner = 0;
	let current = '';
	for (const ch of body) {
		if (ch === '(' || ch === '<' || ch === '[') inner += 1;
		else if (ch === ')' || ch === '>' || ch === ']') inner -= 1;
		if (ch === ',' && inner === 0) {
			parts.push(current);
			current = '';
			continue;
		}
		current += ch;
	}
	if (current.trim().length > 0) parts.push(current);

	return parts
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.map((part) => {
			const colon = part.indexOf(':');
			if (colon === -1) {
				throw new Error(`unparsable parameter declaration: ${part}`);
			}
			return { name: part.slice(0, colon).trim(), type: part.slice(colon + 1) };
		})
		.filter((param) => !INJECTED_PARAM.test(param.type))
		.map((param) => param.name);
}

/** Every `#[tauri::command]` fn in the tree, keyed by name. */
export function parseCommandSignatures(srcRoot: string): Map<string, RustCommand> {
	const found = new Map<string, RustCommand>();
	const pattern =
		/#\[tauri::command\][\s\S]*?\bfn\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\s*\(/g;

	for (const file of rustSources(srcRoot)) {
		const source = stripLineComments(readFileSync(file, 'utf8'));
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(source)) !== null) {
			const name = match[1];
			if (found.has(name)) {
				throw new Error(`duplicate #[tauri::command] signature for ${name}`);
			}
			found.set(name, {
				name,
				params: paramsFrom(source, match.index + match[0].length - 1),
			});
		}
	}
	if (found.size === 0) {
		throw new Error(`no #[tauri::command] signatures found under ${srcRoot}`);
	}
	return found;
}

export function loadCommandSurface(repoRoot: string = process.cwd()): CommandSurface {
	const srcRoot = resolve(repoRoot, 'src-tauri/src');
	const libRs = resolve(srcRoot, 'lib.rs');

	const registered = parseRegisteredCommands(libRs);
	const commands = parseCommandSignatures(srcRoot);

	const missing = registered.filter((name) => !commands.has(name));
	if (missing.length > 0) {
		throw new Error(
			`registered but no #[tauri::command] signature found: ${missing.join(', ')}`
		);
	}
	return { registered, commands };
}

/**
 * The camelCase argument keys the client must send for `command`.
 * Throws for an unknown command — never returns an empty set.
 */
export function expectedArgKeys(surface: CommandSurface, command: string): string[] {
	const found = surface.commands.get(command);
	if (!found) {
		throw new Error(`unknown command: ${command}`);
	}
	return found.params.map(camelCase);
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/tests/unit/rust-command-surface.test.ts`
Expected: PASS, all cases.

If `excludes Tauri-injected params` fails, read the real `account_delete`
signature in `src-tauri/src/database/commands.rs` and adjust `INJECTED_PARAM` —
do not weaken the assertion. What gets filtered on `account_delete` is
`manager: State<'_, Arc<DatabaseManager>>` (matched by the `State<` arm), not a
window parameter: `commands.rs:148` declares it as
`(manager: State<'_, Arc<DatabaseManager>>, id: String)`. Window parameters do
exist on other commands (`window: tauri::WebviewWindow<R>` and
`_window: tauri::WebviewWindow<R>`), matched by the `WebviewWindow` arm.

- [x] **Step 5: Commit**

```bash
git add src/tests/unit/helpers/rust-command-surface.ts src/tests/unit/rust-command-surface.test.ts
git commit -m "test: parse the Rust command surface fail-closed

The boundary test's op table is the only copy of the IPC surface that is
verified, and both sides of its assertion are TypeScript. Add a parser
that reads generate_handler![...] and every #[tauri::command] signature,
projecting snake_case params to the camelCase the IPC layer receives.

Every failure mode throws. Three separate scans in the fix-phase review
returned an empty or wrong set that was read as a fact about the code;
the comment-header fixture reproduces the worst of them."
```

---

### Task 2: Bind the boundary test to the Rust surface (Gate 1)

**Files:**
- Modify: `src/tests/unit/native-boundary.test.ts` (whole file)

**Interfaces:**
- Consumes: `loadCommandSurface`, `expectedArgKeys` from Task 1.
- Produces: nothing — this is a test-only gate.

**This gate is expected to FAIL at the end of this task.** It fails on four
commands the client invokes and Rust does not register, plus any argument-name
drift. That red state is the point: it enumerates the work Tasks 9–11 close.
The branch stays red until Task 11.

- [x] **Step 1: Replace the mock's fixture fallback with a required lookup**

In `src/tests/unit/native-boundary.test.ts`, replace the `invokeMock` body:

```ts
	const invokeMock = vi.fn(async (command: string, args?: unknown) => {
		calls.push({ command, args });
		// An unknown command must fail, not degrade to null. A command with no
		// fixture is a decision someone has to make explicitly: either it needs
		// a real shape, or its return value is not asserted here and the entry
		// says so with an explicit `null`.
		if (!Object.prototype.hasOwnProperty.call(FIXTURES, command)) {
			throw new Error(`no fixture declared for command: ${command}`);
		}
		return FIXTURES[command];
	});
```

- [x] **Step 2: Add the required fixture entries**

Run: `pnpm vitest run src/tests/unit/native-boundary.test.ts`

Every failure names a command with no fixture. Add an entry for each. Use the
real shape where this test asserts one, and an explicit `null` with a comment
where it does not:

```ts
		// Return value not asserted here — the Rust domain tests own behavior.
		transaction_delete: null,
		transaction_restore: null,
```

The four commands added in Tasks 9–11 must land with:

```ts
		transaction_frequent: [],
		transaction_delete_many: null,
		transaction_set_tag_many: null,
		transaction_set_account_many: null,
```

- [x] **Step 3: Delete the hand-written `argKeys` third copy**

Every row in the op table carries an `argKeys` array (e.g. `argKeys: ['accountId', 'date']`). **Delete the `argKeys:` property from every row.** It is the third copy of the surface and the only one that was verified; the expected keys now come from Rust.

Then **delete the field from the `Row` interface too** (around line 281-286):

```ts
	interface Row {
		label: string;
		run: () => Promise<unknown>;
		command: string;
		argKeys: string[] | null;   // ← delete this line
	}
```

`argKeys` is declared as a **required** field, so leaving it while deleting the
property from every row makes the array no longer assignable to `Row[]`.
`pnpm vitest` will not notice — it strips types without checking them — but
`pnpm check` fails, and `pnpm check` is on this plan's verification list. Step 4
below removes the last reader of the field (`it.each`'s 4-tuple); the interface
line is the only remaining trace.

- [x] **Step 4: Assert against the parsed surface**

Add to the imports at the top of the file:

```ts
import { expectedArgKeys, loadCommandSurface } from './helpers/rust-command-surface';
```

Add below `function lastCall()`:

```ts
// The Rust surface is the authority. Parsed once: it throws if the tree is
// unreadable, so a broken parse fails the suite rather than emptying it.
const surface = loadCommandSurface();
```

Replace the table-driven test with:

```ts
	it.each(rows.map((r) => [r.label, r.run, r.command] as const))(
		'%s issues the registered %s command with the camelCase arg keys Rust declares',
		async (_label, run, command) => {
			calls.length = 0;
			await run();

			expect(lastCall().command).toBe(command);
			expect(surface.registered).toContain(command);

			const actualKeys = lastCall().args
				? Object.keys(lastCall().args as object).sort()
				: [];
			expect(actualKeys).toEqual(expectedArgKeys(surface, command).sort());
		}
	);
```

- [x] **Step 5: Run the gate and record the red state**

Run: `pnpm vitest run src/tests/unit/native-boundary.test.ts`
Expected: FAIL, naming exactly four unregistered commands —
`transaction_delete_many`, `transaction_set_tag_many`,
`transaction_set_account_many`, `transaction_frequent`. Copy the failure
output into the commit message.

Any *fifth* failure is argument drift, which is a real finding: fix the Rust
parameter name in `src-tauri/src/database/commands.rs` to match what the client
sends, in this task, and note it.

- [x] **Step 6: Commit**

```bash
git add src/tests/unit/native-boundary.test.ts
git commit -m "test: bind the boundary op table to lib.rs, not to itself

Gate 1. The table already listed all four missing commands; nothing bound
it to lib.rs, so the divergence was invisible. Commands now come from the
parsed Rust surface, argument keys come from the Rust parameter names
(the hand-written argKeys arrays are deleted), and a command with no
fixture throws instead of returning null.

Fails on entry, naming the four client-invoked commands Rust never
registered. Goes green at task 11."
```

---

### Task 3: Error-code parity enforced by the compiler (Gate 2)

**Files:**
- Create: `src/lib/utils/rust-error-messages.ts`
- Create: `src/lib/native/to-app-error.ts`
- Create: `src/tests/unit/rust-error-parity.test.ts`
- Modify: `src/lib/errors.ts`
- Modify: `src/lib/utils/errors.ts`
- Modify: `src/lib/db/native/client.ts` (imports and the `invoke` call path only)
- Modify: `messages/en.json`, `messages/vi.json`

**Interfaces:**
- Consumes: `ErrorCode` from `src/lib/native/contracts.generated.ts`.
- Produces:
  - `export class NativeAppError extends AppError { readonly code: ErrorCode }`
  - `export const RUST_ERROR_MESSAGES: Record<ErrorCode, (params: ErrorParams) => string>`
  - `export function toAppError(error: unknown): unknown`

- [x] **Step 1: Add the origin marker**

`src/lib/errors.ts` — append:

```ts
import type { ErrorCode } from '$lib/native/contracts.generated';

/**
 * Marker for an error that came from the Rust boundary rather than the browser
 * layer. The two code namespaces overlap — `database_corrupt` exists on both
 * sides — so dispatch must key on origin, not on the code string. A rule like
 * `code in RUST_ERRORS ? rustTable[code] : switch(code)` would silently route
 * a browser-originated `database_corrupt` through the Rust table.
 */
export class NativeAppError extends AppError {
	declare readonly code: ErrorCode;
	constructor(code: ErrorCode, params: ErrorParams = {}) {
		super(code, params);
		this.name = 'NativeAppError';
	}
}
```

- [x] **Step 2: Write the message table**

Add the two new keys to `messages/en.json` and `messages/vi.json`. They sit
next to the existing `errors_*` keys:

```json
"errors_native_database_corrupt": "The database file is damaged and could not be read. Restore from a backup to continue.",
"errors_amount_out_of_range": "That amount is larger than the app can store."
```

```json
"errors_native_database_corrupt": "Tệp cơ sở dữ liệu bị hỏng và không thể đọc được. Hãy khôi phục từ bản sao lưu để tiếp tục.",
"errors_amount_out_of_range": "Số tiền vượt quá giới hạn lưu trữ của ứng dụng."
```

Regenerate the Paraglide output:

```bash
npx paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide
```

Create `src/lib/utils/rust-error-messages.ts`:

```ts
/**
 * User-facing copy for every native error code.
 *
 * Keyed by the generated `ErrorCode` union, which makes exhaustiveness a
 * compile error: add a variant in `error.rs`, regenerate, and the build fails
 * here until it has copy. Codes with no bespoke wording take an explicit
 * `generic` entry — a decision, not an accident.
 *
 * `database_corrupt` deliberately does NOT take the generic entry. It is the
 * one string shared with the browser namespace, and the dispatch test needs
 * the two paths to be distinguishable to be worth anything.
 */
import * as m from '$lib/paraglide/messages';
import type { ErrorCode } from '$lib/native/contracts.generated';
import type { ErrorParams } from '$lib/errors';

const generic = (): string => m.errors_unknown();

export const RUST_ERROR_MESSAGES: Record<ErrorCode, (params: ErrorParams) => string> = {
	database_busy: generic,
	database_locked: generic,
	database_not_ready: generic,
	database_update_required: generic,
	unauthorized_caller: generic,
	schema_too_old: generic,
	schema_too_new: generic,
	database_invalid: generic,
	database_corrupt: () => m.errors_native_database_corrupt(),
	backup_unavailable: generic,
	restore_failed: generic,
	operation_id_conflict: generic,
	amount_out_of_range: () => m.errors_amount_out_of_range(),
	invalid_ulid: generic,
	invalid_date: generic,
	invalid_input: generic,
	recovery_required: generic,
};
```

- [x] **Step 3: Write the converter and branch the dispatch**

Create `src/lib/native/to-app-error.ts`:

```ts
import { NativeAppError } from '$lib/errors';
import type { ErrorCode } from '$lib/native/contracts.generated';

/**
 * Convert a Rust `{code, meta}` rejection into a NativeAppError.
 *
 * `meta` is a `BTreeMap<String, String>` on the Rust side, which is already
 * the `ErrorParams` shape the message functions take. Anything that is not a
 * well-formed envelope is returned untouched, so a transport failure still
 * surfaces as itself rather than being mislabelled a domain error.
 */
export function toAppError(error: unknown): unknown {
	if (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		typeof (error as { code: unknown }).code === 'string'
	) {
		const envelope = error as { code: ErrorCode; meta?: Record<string, string> };
		return new NativeAppError(envelope.code, envelope.meta ?? {});
	}
	return error;
}
```

`src/lib/utils/errors.ts` — add the import and put the marker branch **before**
the `AppError` branch, since `NativeAppError extends AppError`:

```ts
import { RUST_ERROR_MESSAGES } from './rust-error-messages';
import { AppError, NativeAppError } from '$lib/errors';

export function mapError(e: unknown): string {
	if (e instanceof NativeAppError) {
		return RUST_ERROR_MESSAGES[e.code](e.params);
	}
	if (e instanceof AppError) {
```

The rest of the function is unchanged: the browser switch keeps every case it
has today, including its own `account_delete_linked_goals`.

- [x] **Step 4: Route every invoke through the converter**

`src/lib/db/native/client.ts` — rename the import and add a local wrapper with
the original name, so all ~80 existing call sites are untouched:

```ts
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { toAppError } from './to-app-error';

/**
 * Every command goes through here: a Rust rejection is a `{code, meta}`
 * envelope, not an AppError, and would otherwise fall through to
 * `errors_unknown()`.
 */
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
	try {
		return await tauriInvoke<T>(command, args);
	} catch (error) {
		throw toAppError(error);
	}
}
```

- [x] **Step 5: Write the parity test**

Create `src/tests/unit/rust-error-parity.test.ts`:

```ts
/**
 * Gate 2's runtime backstop. Exhaustiveness of RUST_ERROR_MESSAGES is a
 * compile error, but the compiler only sees the *generated* union — a stale
 * union keeps the build green while a new code falls through. This test reads
 * the union at runtime and asserts the same thing, and pins the two dispatch
 * paths apart.
 */
import { describe, it, expect } from 'vitest';
import * as m from '$lib/paraglide/messages';
import { AppError, NativeAppError } from '$lib/errors';
import { RUST_ERROR_MESSAGES } from '$lib/utils/rust-error-messages';
import { mapError } from '$lib/utils/errors';
import { toAppError } from '$lib/native/to-app-error';

describe('RUST_ERROR_MESSAGES', () => {
	it('covers every generated ErrorCode', async () => {
		const generated = await import('$lib/native/contracts.generated');
		const codes = generated.ErrorCodeValues ?? [];
		expect(codes.length).toBeGreaterThan(0);
		for (const code of codes) {
			expect(RUST_ERROR_MESSAGES[code]).toBeTypeOf('function');
		}
	});

	it('returns a non-empty string for every code', () => {
		for (const [code, message] of Object.entries(RUST_ERROR_MESSAGES)) {
			expect(message({}), `${code} produced empty copy`).toBeTruthy();
		}
	});
});

describe('mapError dispatch keys on origin, not on the code string', () => {
	it('routes a Rust-originated database_corrupt through the native table', () => {
		const message = mapError(new NativeAppError('database_corrupt'));
		expect(message).toBe(RUST_ERROR_MESSAGES.database_corrupt({}));
		expect(message).not.toBe(m.errors_unknown());
	});

	it('keeps a browser-originated database_corrupt on the browser path', () => {
		// The one string present in both namespaces. If dispatch keyed on the
		// string, this would land in the Rust table.
		expect(mapError(new AppError('database_corrupt'))).toBe(m.errors_unknown());
	});
});

describe('toAppError', () => {
	it('converts a Rust envelope into a NativeAppError carrying its meta', () => {
		const converted = toAppError({ code: 'amount_out_of_range', meta: {} });
		expect(converted).toBeInstanceOf(NativeAppError);
		expect((converted as NativeAppError).code).toBe('amount_out_of_range');
	});

	it('leaves a non-envelope failure untouched', () => {
		const transport = new Error('IPC unavailable');
		expect(toAppError(transport)).toBe(transport);
	});
});
```

`ErrorCodeValues` does not exist yet — add it to the generated bindings by
declaring it next to the enum in Rust. In `src-tauri/src/database/error.rs`,
add below the `ErrorCode` enum:

```rust
impl ErrorCode {
    /// Every variant, for parity tests that must read the union at runtime.
    pub const ALL: [ErrorCode; 17] = [
        ErrorCode::DatabaseBusy,
        ErrorCode::DatabaseLocked,
        ErrorCode::DatabaseNotReady,
        ErrorCode::DatabaseUpdateRequired,
        ErrorCode::UnauthorizedCaller,
        ErrorCode::SchemaTooOld,
        ErrorCode::SchemaTooNew,
        ErrorCode::DatabaseInvalid,
        ErrorCode::DatabaseCorrupt,
        ErrorCode::BackupUnavailable,
        ErrorCode::RestoreFailed,
        ErrorCode::OperationIdConflict,
        ErrorCode::AmountOutOfRange,
        ErrorCode::InvalidUlid,
        ErrorCode::InvalidDate,
        ErrorCode::InvalidInput,
        ErrorCode::RecoveryRequired,
    ];
}
```

Then, in the generated bindings file, add the exported array by hand next to
`export type ErrorCode = ...`:

```ts
export const ErrorCodeValues = [
	'database_busy',
	'database_locked',
	'database_not_ready',
	'database_update_required',
	'unauthorized_caller',
	'schema_too_old',
	'schema_too_new',
	'database_invalid',
	'database_corrupt',
	'backup_unavailable',
	'restore_failed',
	'operation_id_conflict',
	'amount_out_of_range',
	'invalid_ulid',
	'invalid_date',
	'invalid_input',
	'recovery_required',
] as const satisfies readonly ErrorCode[];
```

`src/lib/native/contracts.generated.ts` is regenerated by
`pnpm generate:db-contracts`, which will overwrite this by-hand addition. The
emitter is **`generate_bindings()` in `src-tauri/src/database/commands.rs:895`**
— not `src-tauri/src/bin/export_bindings.rs`, which is a 59-line caller that
just writes or byte-compares whatever `generate_bindings()` returned and
contains no emission logic of its own.

`generate_bindings` is ts_rs-driven: it builds a `Config`, then pushes each
type's declaration through `push_decl` (`commands.rs:963`), which prepends
`export ` to the `TS::decl` string. `ErrorCodeValues` is not a ts_rs type, so
append it by hand inside `generate_bindings`, iterating `ErrorCode::ALL` and
formatting each variant with its `as_str()` — that keeps the union, the array,
and the enum from drifting independently. Then run:

```bash
pnpm generate:db-contracts
```

and confirm the array is still present. If wiring the generator is not
straightforward, keep the array in a hand-written
`src/lib/native/error-codes.ts` instead and have the test import it — but do
not leave a hand-edited generated file uncommitted-adjacent to a generator.

- [x] **Step 6: Run the tests**

Run: `pnpm vitest run src/tests/unit/rust-error-parity.test.ts`
Expected: PASS.

Run: `pnpm check`
Expected: PASS. `RUST_ERROR_MESSAGES` is a `Record` over the union, so it must
be complete.

- [x] **Step 7: Verify the compile-time property actually fires**

Both halves of Gate 2 are conditional, so prove them rather than assuming:

```bash
# (a) A new Rust code with a stale union must fail the generation gate.
#     Add `ErrorCode::TempProbe,` to the enum in error.rs, then:
pnpm check:db-contracts
```

Expected: FAIL — the generated file no longer matches.

```bash
# Revert error.rs, then:
# (b) A regenerated union with no message must fail the type check.
```

Revert the probe, run `pnpm generate:db-contracts`, add `temp_probe` to the
union by hand, run `pnpm check`, confirm it fails on the missing `Record` key,
then revert. If either half does not fire, the gate is not built and this task
is not done.

- [x] **Step 8: Commit**

```bash
git add -A messages src/lib src/tests src-tauri/src/bin src-tauri/src/database/error.rs src/lib/native/contracts.generated.ts
git commit -m "feat: wire Rust error codes to user-facing copy

Gate 2. No Rust error code was handled anywhere in src/lib, so every
desktop error degraded to errors_unknown() and the fully-built
account_delete_linked_goals copy was dead on desktop.

RUST_ERROR_MESSAGES is a Record over the generated ErrorCode union, so a
new code without copy is a compile error. toAppError converts the
{code, meta} envelope; mapError branches on a NativeAppError marker
rather than on the code string, because database_corrupt exists in both
the Rust and browser namespaces and string-keyed dispatch would silently
route one through the other."
```

---

## Stage 1 — Rust source fixes

### Task 4: C2 — stop writing `transfer_account_id` twice, and stop calling constraint violations corruption

**Files:**
- Modify: `src-tauri/src/database/domains/transactions.rs:434-437`
- Modify: `src-tauri/src/database/error.rs:152-165`
- Test: `src-tauri/tests/domain_accounts_transactions.rs`

**Interfaces:**
- Consumes: `TransactionPatch`, `Patch`, `TransactionKind` — all three are already imported at `domain_accounts_transactions.rs:12-15`. Nothing to add there.
- Produces: nothing new. `map_sqlite_error` keeps its signature.

**Why the FK test needs a pragma.** `fresh_db` (`domain_accounts_transactions.rs:34-38`) opens a connection with `Connection::open_with_flags` and nothing else, and SQLite defaults `foreign_keys` to OFF. The only place it is turned on is `apply_live_policy` (`connection.rs:78-81`), reached from the manager's open path — and `bootstrap_current` opens with `open_live_at` and then drops that connection. So a fresh `fresh_db` connection does **not** enforce foreign keys, the bogus `tag_id` inserts cleanly, and there is no error to map. The FK test must set the pragma itself. The CHECK test needs no pragma: CHECK constraints are always enforced.

**The bug.** In `update_transaction`, the kind-change branch writes
`transfer_account_id = NULL` (line 435) and the `patch.transfer_account_id`
branch then appends `transfer_account_id = ?` (line 450) because `dest_handled`
is still `false`. SQLite applies duplicate `SET` columns last-wins, so the row
ends with `transfer_account_id` populated and `transfer_pair_id` NULL — the
exact combination the CHECK at `migrations.rs:296-321` forbids. Verified
against the real DDL: `IntegrityError: CHECK constraint failed`.

- [x] **Step 1: Write the failing tests**

Add to `src-tauri/tests/domain_accounts_transactions.rs`. The types import at
lines 12-15 already carries every name this task needs
(`AccountPatch, AccountType, NewAccount, NewTransaction, OperationId, Patch,
TransactionFilter, TransactionKind, TransactionPatch`) — leave it alone.

Add a helper below `default_expense`:

```rust
/// An all-omitted patch, the base for the edit-mode repair cases below.
fn no_patch() -> TransactionPatch {
    TransactionPatch {
        kind: None,
        date: None,
        amount: None,
        transfer_account_id: None,
        tag_id: Patch::Omitted,
        payee: Patch::Omitted,
        description: Patch::Omitted,
    }
}
```

Add the two tests:

```rust
#[test]
fn changing_kind_away_from_transfer_clears_the_destination() {
    let mut conn = fresh_db("c2-kind-change-away");
    let source = accounts::create_account(&mut conn, op(), default_account("Source")).unwrap();
    let dest = accounts::create_account(&mut conn, op(), default_account("Dest")).unwrap();

    let id = transactions::create_transaction(
        &mut conn,
        op(),
        NewTransaction {
            kind: TransactionKind::Transfer,
            date: "2026-01-15".to_string(),
            amount: 10_000,
            account_id: source.clone(),
            transfer_account_id: Some(dest.clone()),
            refund_of_id: None,
            tag_id: None,
            payee: None,
            description: None,
        },
    )
    .unwrap();

    // Flip to expense while the patch still carries a destination. Before this
    // fix the destination was appended twice and last-wins left it populated
    // with a NULL pair id — the combination the schema CHECK forbids.
    let mut patch = no_patch();
    patch.kind = Some(TransactionKind::Expense);
    patch.transfer_account_id = Some(dest.clone());
    transactions::update_transaction(&mut conn, op(), &id, patch).unwrap();

    let row = transactions::get_transaction(&conn, &id).unwrap().unwrap();
    assert_eq!(row.kind, TransactionKind::Expense);
    assert_eq!(row.transfer_account_id, None);
    assert_eq!(row.transfer_pair_id, None);
}

#[test]
fn a_foreign_key_violation_reports_invalid_input_not_corruption() {
    let mut conn = fresh_db("c2-fk-mapping");
    // fresh_db does not enable foreign keys — SQLite defaults them off and only
    // the live-policy open path turns them on. Without this the bogus tag_id
    // inserts cleanly, there is no error at all, and unwrap_err() panics.
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    let account = accounts::create_account(&mut conn, op(), default_account("A")).unwrap();

    // The business layer does not pre-validate the tag, so this reaches SQLite.
    let mut input = default_expense(&account, 100);
    input.tag_id = Some("tag_does_not_exist".to_string());
    let error = transactions::create_transaction(&mut conn, op(), input).unwrap_err();

    assert_eq!(error.code, ErrorCode::InvalidInput);
}
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_accounts_transactions`
Expected:
- `changing_kind_away_from_transfer_clears_the_destination` FAILS — `CHECK constraint failed` surfaces as `DatabaseCorrupt`, so `update_transaction` returns `Err` and the `unwrap()` panics.
- `a_foreign_key_violation_reports_invalid_input_not_corruption` FAILS — code is `DatabaseCorrupt`, not `InvalidInput`.

If the FK test instead fails with "no rows"/a panic inside `create_account`, or passes, the pragma is not in effect — check that it is set on `conn` before the insert and that `accounts::create_account` did not reopen a connection.

- [x] **Step 3: Mark the destination as handled when leaving transfer**

`src-tauri/src/database/domains/transactions.rs`, in the `else if existing.kind == TransactionKind::Transfer` branch (around line 434):

```rust
            } else if existing.kind == TransactionKind::Transfer {
                sets.push("transfer_account_id = NULL".to_string());
                sets.push("transfer_pair_id = NULL".to_string());
                // Nulling the destination IS the handling. Without this the
                // patch's `transfer_account_id` was appended again below and
                // last-wins re-populated a column the CHECK requires to be NULL
                // whenever `transfer_pair_id` is NULL.
                dest_handled = true;
            }
```

- [x] **Step 4: Map constraint violations to `InvalidInput`**

`src-tauri/src/database/error.rs`, replace `map_sqlite_error`:

```rust
/// Constraint failures are caller mistakes, not corruption.
///
/// A CHECK, FOREIGN KEY, or NOT NULL rejection means the business layer let a
/// value through that the schema forbids. Reporting that as
/// `DatabaseCorrupt` told the user their database file was damaged when their
/// input was simply invalid.
fn constraint_code(extended_code: i32) -> Option<ErrorCode> {
    const CHECK: i32 = rusqlite::ffi::SQLITE_CONSTRAINT_CHECK as i32;
    const FOREIGNKEY: i32 = rusqlite::ffi::SQLITE_CONSTRAINT_FOREIGNKEY as i32;
    const NOTNULL: i32 = rusqlite::ffi::SQLITE_CONSTRAINT_NOTNULL as i32;

    matches!(extended_code, CHECK | FOREIGNKEY | NOTNULL).then_some(ErrorCode::InvalidInput)
}

/// Map a rusqlite error to the stable allowlisted envelope without leaking the
/// raw SQLite text or parameters. Busy and locked map to their stable codes,
/// constraint violations are caller mistakes, and every other failure is
/// corruption from the caller's perspective.
pub(crate) fn map_sqlite_error(error: rusqlite::Error) -> DbError {
    let code = match &error {
        rusqlite::Error::SqliteFailure(sqlite_error, _) => match sqlite_error.code {
            rusqlite::ErrorCode::DatabaseBusy => ErrorCode::DatabaseBusy,
            rusqlite::ErrorCode::DatabaseLocked => ErrorCode::DatabaseLocked,
            rusqlite::ErrorCode::ConstraintViolation => {
                constraint_code(sqlite_error.extended_code).unwrap_or(ErrorCode::DatabaseCorrupt)
            }
            _ => ErrorCode::DatabaseCorrupt,
        },
        _ => ErrorCode::DatabaseCorrupt,
    };
    DbError::new(code)
}
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS, the whole suite. If mapping constraint codes to `InvalidInput` broke an existing test that asserted `DatabaseCorrupt`, that test was encoding the bug — change it to `InvalidInput` and say so in the commit message.

- [x] **Step 6: Commit**

```bash
git add src-tauri/src/database/domains/transactions.rs src-tauri/src/database/error.rs src-tauri/tests/domain_accounts_transactions.rs
git commit -m "fix: stop writing transfer_account_id twice, map constraints to InvalidInput

C2. Changing a transaction's kind away from transfer while the patch still
carried a destination appended transfer_account_id twice; SQLite's
last-wins left the destination populated with a NULL pair id, the exact
combination the schema CHECK forbids. Verified against the real DDL as
'CHECK constraint failed'.

Constraint violations also surfaced as DatabaseCorrupt, telling the user
their database file was damaged when their input was invalid. CHECK,
FOREIGN KEY, and NOT NULL now report InvalidInput."
```

---

### Task 5: C3 — writing off a loan without choosing a tag

**Files:**
- Modify: `src-tauri/src/database/domains/debts.rs:112-160`
- Modify: `src-tauri/src/database/commands.rs` (`debt_write_off` wrapper)
- Modify: `src/lib/db/native/client.ts:397-399`
- Test: `src-tauri/tests/domain_reconciliation_debts.rs`

**Interfaces:**
- Produces: `debts::write_off(conn: &mut Connection, op_id: OperationId, account_id: &str, amount: i64, tag_id: Option<String>) -> DbResult<String>` — **the `tag_id` parameter changes from `&str` to `Option<String>`.**

- [x] **Step 1: Write the failing test**

Add to `src-tauri/tests/domain_reconciliation_debts.rs` (match that file's existing helper names — it already builds loan accounts):

```rust
#[test]
fn write_off_without_a_tag_defaults_to_the_loss_tag() {
    let mut conn = fresh_db("c3-write-off-default");
    let account = accounts::create_account(
        &mut conn,
        op(),
        NewAccount {
            name: "Loan to An".to_string(),
            account_type: AccountType::LoanToPerson,
            counterparty: Some("An".to_string()),
            currency: "USD".to_string(),
            initial_balance: None,
            initial_balance_date: None,
        },
    )
    .unwrap();

    let id = debts::write_off(&mut conn, op(), &account, 5_000, None).unwrap();

    let row = transactions::get_transaction(&conn, &id).unwrap().unwrap();
    assert_eq!(row.kind, TransactionKind::Expense);
    assert_eq!(row.tag_id.as_deref(), Some("tag_loss"));
}
```

- [x] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_reconciliation_debts`
Expected: FAIL to compile — `write_off` takes `&str`, not `Option<String>`.

- [x] **Step 3: Take an optional tag and resolve the default**

`src-tauri/src/database/domains/debts.rs` — change the signature and bind the
resolved value **before** `run_idempotent`, so the request hash and the INSERT
describe the same operation:

```rust
/// Write off a debt amount. Creates an expense (loan_to_person) or
/// income (loan_from_person) transaction. Returns the new transaction ID.
///
/// A missing tag resolves to the seeded `tag_loss` here rather than at the
/// caller: `tag_id` is a foreign key, so an empty string is rejected by SQLite
/// as corruption instead of being read as "no tag chosen". The TypeScript
/// reference defaults the same way (`browser/repos/debts.ts:57`).
pub fn write_off(
    conn: &mut Connection,
    op_id: OperationId,
    account_id: &str,
    amount: i64,
    tag_id: Option<String>,
) -> DbResult<String> {
    // `debts.rs:119-133` is untouched: the account-exists lookup, the
    // `InvalidInput` when it is absent, and the `loan_to_person` /
    // `loan_from_person` check all stay exactly as they are.

    let tag_id = tag_id.unwrap_or_else(|| "tag_loss".to_string());
```

The rest of the body below that point is unchanged; `&tag_id` in the
`run_idempotent` request tuple and in `params![...]` now refer to the resolved
`String` rather than the caller's `&str`.

- [x] **Step 4: Update the command wrapper**

`src-tauri/src/database/commands.rs` — `debt_write_off`'s `tag_id` parameter
becomes `Option<String>`, passed straight through.

- [x] **Step 5: Update the client**

`src/lib/db/native/client.ts:398`:

```ts
	writeOff(accountId: string, amount: number, tagId?: string): Promise<string> {
		return invoke<string>('debt_write_off', { accountId, amount, tagId: tagId ?? null });
	}
```

An explicit `null` means "not supplied"; `''` meant "tag named empty string"
and was rejected by the foreign key.

- [x] **Step 6: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

Run: `pnpm vitest run src/tests/unit/native-boundary.test.ts`
Expected: the `debts.writeOff` row still passes — it sends `tagId: 'tag1'`, which is unchanged.

- [x] **Step 7: Commit**

```bash
git add src-tauri/src/database/domains/debts.rs src-tauri/src/database/commands.rs src/lib/db/native/client.ts src-tauri/tests/domain_reconciliation_debts.rs
git commit -m "fix: default a missing debt write-off tag to tag_loss

C3. native/client.ts sent tagId: '' when no tag was chosen, and
domains/debts.rs inserted it unconditionally — tag_id is a foreign key,
so writing off a loan without choosing a tag failed on desktop
(FOREIGN KEY constraint failed) and succeeded on web, where the repo
defaults to tag_loss. The tag is now Option<String> and resolves to the
seeded loss tag before the request hash is computed."
```

---

### Task 6: I5 — reject amounts the schema cannot store

**Files:**
- Modify: `src-tauri/src/database/error.rs:167-171`
- Test: `src-tauri/tests/domain_accounts_transactions.rs`, `src-tauri/tests/migrations.rs`

**Interfaces:**
- Produces: `pub const MAX_AMOUNT: u64 = 999_999_999_999;` in `error.rs`. `validate_money` keeps its signature.

**Why a copy and not a shared symbol.** `transactions.amount` carries
`CHECK (amount > 0 AND amount <= 999999999999)` in an applied migration.
Applied migrations are immutable — interpolating a constant into one would
retroactively alter a schema already in the field. So the bound is a named
Rust constant and the anti-drift guarantee is a test that parses the bound out
of the migration text.

- [x] **Step 1: Write the failing tests**

Add to `src-tauri/tests/domain_accounts_transactions.rs`:

```rust
#[test]
fn amounts_above_the_schema_cap_are_rejected_before_sqlite() {
    let mut conn = fresh_db("i5-amount-cap");
    let account = accounts::create_account(&mut conn, op(), default_account("A")).unwrap();

    // All three pass the JS-safe-range check and fail the schema CHECK.
    for amount in [1_000_000_000_000_i64, 1_400_000_000_000, 9_007_199_254_740_991] {
        let error = transactions::create_transaction(&mut conn, op(), default_expense(&account, amount))
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::AmountOutOfRange, "amount {amount}");
    }
}

#[test]
fn the_largest_storable_amount_is_accepted() {
    let mut conn = fresh_db("i5-amount-boundary");
    let account = accounts::create_account(&mut conn, op(), default_account("A")).unwrap();

    transactions::create_transaction(&mut conn, op(), default_expense(&account, 999_999_999_999))
        .unwrap();
}
```

Add to `src-tauri/tests/migrations.rs`:

```rust
#[test]
fn the_money_bound_matches_the_migration_check() {
    let path = scratch_path("money-bound");
    bootstrap_current(&path, FailurePoint::None).unwrap();
    let conn = Connection::open(&path).unwrap();

    let ddl: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'transactions'",
            [],
            |row| row.get(0),
        )
        .unwrap();

    // The bound is read out of the migration that encodes it, so a migration
    // that changes the cap and a constant that does not cannot both be green.
    let expected = format!("amount <= {}", notchy_lib::database::error::MAX_AMOUNT);
    assert!(
        ddl.contains(&expected),
        "transactions DDL no longer carries `{expected}`:\n{ddl}"
    );
}
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_accounts_transactions --test migrations`
Expected:
- `amounts_above_the_schema_cap...` FAILS — the code is `DatabaseCorrupt` (or `InvalidInput` after Task 4), not `AmountOutOfRange`.
- `the_money_bound_matches_the_migration_check` FAILS to compile — `MAX_AMOUNT` does not exist.

- [x] **Step 2b: Check the assertions match the migration's real DDL**

Run: `sqlite3 /tmp/probe.sqlite "SELECT sql FROM sqlite_master WHERE name='transactions'"` after bootstrapping, or simply read `src-tauri/src/database/migrations.rs:303`. If the DDL reads `amount <= 999999999999` the assertion above is right; if the migration renders it differently (a different spacing, or through a `format!`), match the real text exactly. Do not loosen the assertion to a substring that would also match a *different* number.

- [x] **Step 3: Narrow the bound**

`src-tauri/src/database/error.rs`:

```rust
/// Largest amount the schema will store.
///
/// `transactions.amount` carries `CHECK (amount > 0 AND amount <= 999999999999)`
/// in migration 006. That migration is applied and immutable, so this is a copy
/// of the literal rather than a shared symbol — interpolating a constant into a
/// deployed migration would retroactively alter a schema already in the field.
/// `the_money_bound_matches_the_migration_check` in `tests/migrations.rs` keeps
/// the copy honest.
pub const MAX_AMOUNT: u64 = 999_999_999_999;

/// Reject monetary values outside the range the schema can store.
///
/// The window this closes: everything from `MAX_AMOUNT + 1` up to
/// `9_007_199_254_740_991` used to pass here and then be rejected by SQLite.
pub fn validate_money(value: i64) -> Result<i64, ErrorCode> {
    (value.unsigned_abs() <= MAX_AMOUNT).then_some(value).ok_or(ErrorCode::AmountOutOfRange)
}
```

Delete the now-unused `JS_MAX_SAFE` constant.

- [x] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS. A test that asserted a large amount succeeds must be updated — it was encoding the bug. Name it in the commit message.

- [x] **Step 5: Commit**

```bash
git add src-tauri/src/database/error.rs src-tauri/tests/domain_accounts_transactions.rs src-tauri/tests/migrations.rs
git commit -m "fix: reject amounts the schema cannot store

I5. validate_money accepted up to 9007199254740991 while the schema caps
at 999999999999, so every amount in that window was accepted by the
business layer and then rejected by SQLite as DatabaseCorrupt. The bound
is now the schema's, as a named constant rather than an edit to an
applied migration; a test parses the CHECK out of the migration text and
compares it to the constant."
```

---

### Task 7: I2 — move the restore guard inside the receipt

**Files:**
- Modify: `src-tauri/src/database/domains/accounts.rs:389-420`
- Modify: `src-tauri/src/database/domains/goals.rs:432-464`
- Test: `src-tauri/tests/domain_accounts_transactions.rs`, `src-tauri/tests/domain_goals_rules_meta.rs`

**Interfaces:**
- Consumes: `run_idempotent` (unchanged).
- Produces: no signature change.

**The defect.** Both `restore_account` and `restore_goal` check
`deleted_at IS NOT NULL` on `conn` *before* `run_idempotent` opens its
transaction. The guard therefore runs **outside** the receipt boundary, so a
retry with the same operation ID never reaches the receipt lookup — the guard
rejects it first with `InvalidInput` and the cached result is never replayed.
That is the whole point of the receipts table, and it is dead on this path.

`accounts::restore_account`'s `UPDATE` also has no `deleted_at IS NOT NULL`
predicate, so between the guard and the write the row could change.
`goals::restore_goal`'s `UPDATE` **already has it** (`goals.rs:457`) — the
guard placement is the shared defect, the missing predicate is accounts only.

**What the tests must prove.** The existing shape — create a live row, call
restore, expect `InvalidInput` — is not a driver: the pre-check already returns
`InvalidInput` today, so that test is green before and after. It is worth
keeping as a regression guard, but the test that drives this task is a
**retry with the same operation ID**, which is exactly what the pre-check
breaks.

- [ ] **Step 1: Write the failing tests**

Add to `src-tauri/tests/domain_accounts_transactions.rs` (imports there already
carry `accounts` and `ErrorCode`):

```rust
#[test]
fn retrying_a_restore_with_the_same_operation_id_replays_the_first_result() {
    let mut conn = fresh_db("i2-restore-retry");
    let id = accounts::create_account(&mut conn, op(), default_account("A")).unwrap();
    accounts::delete_account(&mut conn, op(), &id).unwrap();

    let op_id = op();
    accounts::restore_account(&mut conn, op_id.clone(), &id).unwrap();

    // The row is live now. Because the guard sits outside run_idempotent, this
    // retry hits the guard first and returns InvalidInput instead of replaying
    // the receipt. The receipt exists precisely so that a retry is safe.
    accounts::restore_account(&mut conn, op_id, &id).unwrap();

    assert!(accounts::get_account(&conn, &id).unwrap().is_some());
}

#[test]
fn restoring_a_live_account_is_rejected() {
    let mut conn = fresh_db("i2-restore-guard");
    let id = accounts::create_account(&mut conn, op(), default_account("A")).unwrap();

    // Never soft-deleted. Passes before and after the fix — a regression guard
    // on the guard, not the driver for this task.
    let error = accounts::restore_account(&mut conn, op(), &id).unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidInput);
}
```

Add the mirrors to `src-tauri/tests/domain_goals_rules_meta.rs` (its imports
already carry `accounts`, `goals`, `GoalType`, and `ErrorCode`):

```rust
#[test]
fn retrying_a_goal_restore_with_the_same_operation_id_replays_the_first_result() {
    let mut conn = fresh_db("i2-restore-retry-goal");
    let id = goals::create_goal(
        &mut conn,
        op(),
        "Emergency fund".to_string(),
        GoalType::Savings,
        1_000_000,
        "2027-01-01".to_string(),
        None,
        0,
        1,
    )
    .unwrap();
    goals::delete_goal(&mut conn, op(), &id).unwrap();

    let op_id = op();
    goals::restore_goal(&mut conn, op_id.clone(), &id).unwrap();

    goals::restore_goal(&mut conn, op_id, &id).unwrap();

    assert!(goals::get_goal(&conn, &id).unwrap().is_some());
}

#[test]
fn restoring_a_live_goal_is_rejected() {
    let mut conn = fresh_db("i2-restore-guard-goal");
    let id = goals::create_goal(
        &mut conn,
        op(),
        "Emergency fund".to_string(),
        GoalType::Savings,
        1_000_000,
        "2027-01-01".to_string(),
        None,
        0,
        1,
    )
    .unwrap();

    let error = goals::restore_goal(&mut conn, op(), &id).unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidInput);
}
```

`OperationId` is `Clone` — the retry tests depend on it, and
`domain_accounts_transactions.rs:577-591` already relies on the same thing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected:
- `retrying_a_restore_with_the_same_operation_id_replays_the_first_result` — FAILS, panicking on the second `restore_account` with `InvalidInput`. **This is the one that must fail.**
- `retrying_a_goal_restore_with_the_same_operation_id_replays_the_first_result` — FAILS the same way.
- `restoring_a_live_account_is_rejected` and `restoring_a_live_goal_is_rejected` — **PASS, both before and after.** They are guards, not drivers. A green result here is expected and is not evidence the fix works.

If the two retry tests pass at this step, stop: they are not exercising the
guard placement and this task has no signal.

- [ ] **Step 3: Move the guard and add the predicate**

`src-tauri/src/database/domains/accounts.rs` — replace `restore_account`'s body:

```rust
pub fn restore_account(
    conn: &mut Connection,
    op_id: OperationId,
    id: &str,
) -> DbResult<()> {
    #[derive(serde::Serialize, serde::Deserialize)]
    struct Void {}

    run_idempotent(conn, op_id, "restore_account", &id.to_string(), |tx| {
        // Inside the receipt, and the same predicate on the write. Outside it,
        // the check could pass and the UPDATE could then land on a row that had
        // changed in between.
        let found: bool = tx
            .query_row(
                "SELECT 1 FROM accounts WHERE id = ?1 AND deleted_at IS NOT NULL",
                params![id],
                |_| Ok(true),
            )
            .optional()
            .map_err(map_sqlite_error)?
            .is_some();
        if !found {
            return Err(DbError::new(ErrorCode::InvalidInput));
        }

        let now = now_iso_utc();
        tx.execute(
            "UPDATE accounts SET deleted_at = NULL, updated_at = ?1 \
             WHERE id = ?2 AND deleted_at IS NOT NULL",
            params![now, id],
        )
        .map_err(map_sqlite_error)?;

        Ok(Void {})
    })
    .map(|_| ())
}
```

Apply the same guard move to `goals::restore_goal`
(`src-tauri/src/database/domains/goals.rs:432-464`). One difference: its
`UPDATE` at `goals.rs:457` **already** carries
`AND deleted_at IS NOT NULL` — move the guard inside the closure and leave that
statement as it is. Only `accounts::restore_account`'s `UPDATE` is missing the
predicate.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS. The existing restore round-trip tests must still pass — a real restore is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/database/domains/accounts.rs src-tauri/src/database/domains/goals.rs src-tauri/tests
git commit -m "fix: move the restore guard inside the receipt boundary

I2. restore_account and restore_goal checked deleted_at IS NOT NULL on
the connection before run_idempotent opened its transaction, so a retry
with the same operation ID hit the guard first and got InvalidInput
instead of the cached result. The receipts table was dead on this path.
The guard now runs inside the transaction, and restore_account's UPDATE
gained the AND deleted_at IS NOT NULL predicate that restore_goal's
already had."
```

---

### Task 8: I4 — a malformed month is invalid input, not a panic

**Files:**
- Modify: `src-tauri/src/database/domains/budgets.rs:16-36`
- Test: `src-tauri/tests/domain_categories_budgets.rs`

**Interfaces:**
- Produces: `fn parse_month(month: &str) -> DbResult<(i32, i32)>` (private); `next_month` and `previous_month` become `fn(&str) -> DbResult<String>`. **No public signature changes.**

**The defect.** `next_month` does `month.split('-').map(|s| s.parse().unwrap_or(1))` and then indexes `parts[0]` and `parts[1]`. A month string with no `-` panics on the index; a non-numeric segment silently becomes month 1.

- [ ] **Step 1: Write the failing test**

Add to `src-tauri/tests/domain_categories_budgets.rs`:

```rust
#[test]
fn a_malformed_month_is_invalid_input() {
    let conn = fresh_db("i4-bad-month");

    for month in ["2026-13", "2026-00", "2026", "2026-1", "not-a-month", ""] {
        let error = budgets::get_budgets_for_month(&conn, month).unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidInput, "month {month:?}");
    }
}
```

Adjust `fresh_db` to the helper that file already uses if its name differs; the
test needs a `Connection`, not a mutable one.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_categories_budgets`
Expected: FAIL — `2026` and `""` panic on `parts[1]`; `2026-13` and `not-a-month` return without error.

- [ ] **Step 3: Parse the month once, rejecting anything malformed**

`src-tauri/src/database/domains/budgets.rs`:

```rust
/// Split a `YYYY-MM` month string, rejecting anything the schema would not
/// accept. `next_month` and `previous_month` used to `unwrap_or(1)` every
/// segment and index the result, so a month with no `-` panicked and a
/// non-numeric one silently became January.
fn parse_month(month: &str) -> DbResult<(i32, i32)> {
    let invalid = || DbError::new(ErrorCode::InvalidInput);

    let parts: Vec<&str> = month.split('-').collect();
    if parts.len() != 2 || parts[0].len() != 4 || parts[1].len() != 2 {
        return Err(invalid());
    }
    let year: i32 = parts[0].parse().map_err(|_| invalid())?;
    let month_number: i32 = parts[1].parse().map_err(|_| invalid())?;
    if !(1..=12).contains(&month_number) {
        return Err(invalid());
    }
    Ok((year, month_number))
}

/// Increment a `YYYY-MM` month string by one.
fn next_month(month: &str) -> DbResult<String> {
    let (year, month_number) = parse_month(month)?;
    Ok(if month_number == 12 {
        format!("{:04}-01", year + 1)
    } else {
        format!("{:04}-{:02}", year, month_number + 1)
    })
}

/// Decrement a `YYYY-MM` month string by one.
fn previous_month(month: &str) -> DbResult<String> {
    let (year, month_number) = parse_month(month)?;
    Ok(if month_number == 1 {
        format!("{:04}-12", year - 1)
    } else {
        format!("{:04}-{:02}", year, month_number - 1)
    })
}
```

Add `DbError` and `ErrorCode` to the imports from `crate::database::error`.

- [ ] **Step 4: Propagate at the call sites**

`get_spent_for_bucket` (line 41), `get_rolled_over`, `get_budgets_for_month`,
`copy_from_previous_month` (line 215), and any other caller now use `?`.

Run: `cargo build --manifest-path src-tauri/Cargo.toml` and fix each call site
the compiler names.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/database/domains/budgets.rs src-tauri/tests/domain_categories_budgets.rs
git commit -m "fix: reject a malformed month instead of panicking

I4. next_month unwrap_or(1)'d every segment of the month string and then
indexed the result, so a month with no '-' panicked and a non-numeric one
silently became January. Month parsing now happens once and returns
InvalidInput for anything that is not YYYY-MM in range."
```

---

### Task 9: C1a — port `transaction_frequent` (the dashboard strip)

**Files:**
- Modify: `src-tauri/src/database/types.rs` (add `FrequentTx`)
- Modify: `src-tauri/src/database/domains/transactions.rs` (add `get_frequent`)
- Modify: `src-tauri/src/database/domains/mod.rs` (re-export)
- Modify: `src-tauri/src/database/commands.rs` (add the wrapper)
- Modify: `src-tauri/src/lib.rs` (register)
- Modify: `src/tests/unit/native-boundary.test.ts` (fixture)
- Test: `src-tauri/tests/domain_transactions_bulk.rs`

**Interfaces:**
- Produces:
  - `pub struct FrequentTx { pub payee: Option<String>, pub tag_id: Option<String>, pub account_id: String, pub amount: i64, pub kind: String, pub count: i64 }`
  - `pub fn get_frequent(conn: &Connection, since_date: &str) -> DbResult<Vec<FrequentTx>>`
  - command `transaction_frequent(since_date: String) -> Result<Vec<FrequentTx>, DbError>`

**Not dead code.** The review reported this as unused and recommended deleting
it; spec §8 records that the grep was for lowercase `frequent` against
camelCase symbols. It is a documented product feature
(`FrequentTransactions.svelte:37`, rendered from `routes/+page.svelte:229`).
On desktop it does not fail loudly — the component degrades silently by design,
so the strip simply never appears.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/tests/domain_transactions_bulk.rs`:

```rust
//! Integration tests for the bulk transaction commands and the frequent-payee
//! strip — the four commands the client invoked but Rust never registered.

use std::path::PathBuf;

use rusqlite::{Connection, OpenFlags};

use notchy_lib::database::domains::{accounts, transactions};
use notchy_lib::database::error::ErrorCode;
use notchy_lib::database::migrations::{bootstrap_current, FailurePoint};
use notchy_lib::database::types::{
    AccountType, NewAccount, NewTransaction, OperationId, TransactionKind,
};

fn scratch_path(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("notchy-bulk-test-{}", nanos));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join(format!("{}.sqlite", tag))
}

fn fresh_db(tag: &str) -> Connection {
    let path = scratch_path(tag);
    bootstrap_current(&path, FailurePoint::None).unwrap();
    Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_WRITE).unwrap()
}

fn op() -> OperationId {
    OperationId::generate()
}

fn account(conn: &mut Connection, name: &str) -> String {
    accounts::create_account(
        conn,
        op(),
        NewAccount {
            name: name.to_string(),
            account_type: AccountType::Checking,
            counterparty: None,
            currency: "USD".to_string(),
            initial_balance: None,
            initial_balance_date: None,
        },
    )
    .unwrap()
}

fn expense(account_id: &str, payee: &str, amount: i64, date: &str) -> NewTransaction {
    NewTransaction {
        kind: TransactionKind::Expense,
        date: date.to_string(),
        amount,
        account_id: account_id.to_string(),
        transfer_account_id: None,
        refund_of_id: None,
        tag_id: None,
        payee: Some(payee.to_string()),
        description: None,
    }
}

#[test]
fn frequent_returns_the_most_repeated_payees_since_a_date() {
    let mut conn = fresh_db("frequent");
    let account = account(&mut conn, "A");

    for _ in 0..3 {
        transactions::create_transaction(
            &mut conn,
            op(),
            expense(&account, "Coffee", 5_000, "2026-02-01"),
        )
        .unwrap();
    }
    transactions::create_transaction(
        &mut conn,
        op(),
        expense(&account, "Rent", 900_000, "2026-02-02"),
    )
    .unwrap();
    // Before the window.
    transactions::create_transaction(
        &mut conn,
        op(),
        expense(&account, "Old", 1_000, "2025-01-01"),
    )
    .unwrap();

    let rows = transactions::get_frequent(&conn, "2026-01-01").unwrap();

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].payee.as_deref(), Some("Coffee"));
    assert_eq!(rows[0].count, 3);
    assert_eq!(rows[1].payee.as_deref(), Some("Rent"));
}

#[test]
fn frequent_ignores_soft_deleted_transactions() {
    let mut conn = fresh_db("frequent-deleted");
    let account = account(&mut conn, "A");

    transactions::create_transaction(
        &mut conn,
        op(),
        expense(&account, "Coffee", 5_000, "2026-02-01"),
    )
    .unwrap();
    let dropped = transactions::create_transaction(
        &mut conn,
        op(),
        expense(&account, "Coffee", 5_000, "2026-02-02"),
    )
    .unwrap();
    transactions::delete_transaction(&mut conn, op(), &dropped).unwrap();

    let rows = transactions::get_frequent(&conn, "2026-01-01").unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].count, 1);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_transactions_bulk`
Expected: FAIL to compile — `transactions::get_frequent` does not exist.

- [ ] **Step 3: Add the DTO**

`src-tauri/src/database/types.rs`, near the transaction types:

```rust
/// A recurring payee for the dashboard strip.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct FrequentTx {
    /// Nullable in the schema; the query filters `payee IS NOT NULL`.
    pub payee: Option<String>,
    pub tag_id: Option<String>,
    pub account_id: String,
    pub amount: i64,
    pub kind: String,
    pub count: i64,
}
```

- [ ] **Step 4: Port the query**

`src-tauri/src/database/domains/transactions.rs`:

```rust
/// Recurring payees since `since_date`, most frequent first.
///
/// Ported verbatim from `browser/client.ts:133-141`. Fidelity caveat:
/// `amount` and `kind` are bare columns under `GROUP BY payee, tag_id,
/// account_id`, so SQLite returns an arbitrary row from each group. The browser
/// layer relies on that; matching it is correct and diverging would make
/// desktop and web disagree. Do not "fix" it.
pub fn get_frequent(conn: &Connection, since_date: &str) -> DbResult<Vec<FrequentTx>> {
    let mut stmt = conn
        .prepare(
            "SELECT payee, tag_id, account_id, amount, kind, COUNT(*) as count
             FROM transactions
             WHERE deleted_at IS NULL AND date >= ?1 AND payee IS NOT NULL
               AND kind IN ('expense', 'income')
             GROUP BY payee, tag_id, account_id
             ORDER BY count DESC, date DESC
             LIMIT 5",
        )
        .map_err(map_sqlite_error)?;

    let rows = stmt
        .query_map([since_date], |row| {
            Ok(FrequentTx {
                payee: row.get(0)?,
                tag_id: row.get(1)?,
                account_id: row.get(2)?,
                amount: row.get(3)?,
                kind: row.get(4)?,
                count: row.get(5)?,
            })
        })
        .map_err(map_sqlite_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_sqlite_error)?;

    Ok(rows)
}
```

Add `FrequentTx` to the `use crate::database::types::{...}` list at the top.

- [ ] **Step 5: Re-export, wrap, and register**

`src-tauri/src/database/domains/mod.rs`:

```rust
pub use transactions::{
    create_transaction, create_transactions_batch, delete_transaction, duplicate_transaction,
    get_frequent, get_transaction, list_transactions, restore_transaction, update_transaction,
};
```

`src-tauri/src/database/commands.rs`, in the transaction section:

```rust
#[tauri::command]
pub async fn transaction_frequent(
    manager: State<'_, Arc<DatabaseManager>>,
    since_date: String,
) -> Result<Vec<FrequentTx>, DbError> {
    manager
        .data_job(move |state| domains::transactions::get_frequent(state.connection()?, &since_date))
        .await
}
```

`src-tauri/src/lib.rs`, in the `// Transaction commands` block after
`transaction_duplicate`:

```rust
            transaction_frequent,
```

- [ ] **Step 6: Add the boundary-test fixture**

`src/tests/unit/native-boundary.test.ts`, in `FIXTURES`:

```ts
		transaction_frequent: [],
```

- [ ] **Step 7: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_transactions_bulk`
Expected: PASS.

Run: `pnpm vitest run src/tests/unit/native-boundary.test.ts`
Expected: the `transaction_frequent` row now passes; three failures remain (the other C1 commands).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/database/types.rs src-tauri/src/database/domains/transactions.rs src-tauri/src/database/domains/mod.rs src-tauri/src/database/commands.rs src-tauri/src/lib.rs src-tauri/tests/domain_transactions_bulk.rs src/tests/unit/native-boundary.test.ts
git commit -m "feat: port transaction_frequent to Rust

C1. The client invoked transaction_frequent and Rust registered nothing,
so the dashboard 'Frequent transactions' strip never appeared on desktop
— silently, because the component degrades by design ('the strip is an
accelerator, never a required surface').

Ports the browser query verbatim, including its bare-column reliance
under GROUP BY: matching the browser is correct, diverging would make
desktop and web disagree."
```

---

### Task 10: C1b — port `transaction_delete_many`

**Files:**
- Modify: `src-tauri/src/database/domains/transactions.rs`
- Modify: `src-tauri/src/database/domains/mod.rs`, `commands.rs`, `lib.rs`
- Test: `src-tauri/tests/domain_transactions_bulk.rs`
- Test: `src/tests/unit/native-boundary.test.ts` (fixture)

**Interfaces:**
- Produces: `pub fn delete_transactions(conn: &mut Connection, op_id: OperationId, ids: Vec<String>) -> DbResult<()>`; command `transaction_delete_many(ids: Vec<String>) -> Result<(), DbError>`.

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/tests/domain_transactions_bulk.rs`:

```rust
#[test]
fn delete_many_soft_deletes_exactly_the_selected_ids() {
    let mut conn = fresh_db("delete-many");
    let account = account(&mut conn, "A");

    let keep = transactions::create_transaction(
        &mut conn,
        op(),
        expense(&account, "Keep", 1_000, "2026-02-01"),
    )
    .unwrap();
    let a = transactions::create_transaction(
        &mut conn,
        op(),
        expense(&account, "A", 1_000, "2026-02-02"),
    )
    .unwrap();
    let b = transactions::create_transaction(
        &mut conn,
        op(),
        expense(&account, "B", 1_000, "2026-02-03"),
    )
    .unwrap();

    transactions::delete_transactions(&mut conn, op(), vec![a.clone(), b.clone()]).unwrap();

    assert!(transactions::get_transaction(&conn, &a).unwrap().is_none());
    assert!(transactions::get_transaction(&conn, &b).unwrap().is_none());
    assert!(transactions::get_transaction(&conn, &keep).unwrap().is_some());
}

#[test]
fn delete_many_leaves_already_deleted_rows_alone() {
    let mut conn = fresh_db("delete-many-idempotent");
    let account = account(&mut conn, "A");

    let id = transactions::create_transaction(
        &mut conn,
        op(),
        expense(&account, "A", 1_000, "2026-02-02"),
    )
    .unwrap();
    transactions::delete_transactions(&mut conn, op(), vec![id.clone()]).unwrap();
    let first = transactions::get_transaction(&conn, &id).unwrap();
    assert!(first.is_none());

    // A second call must not error on the row it already soft-deleted.
    transactions::delete_transactions(&mut conn, op(), vec![id.clone()]).unwrap();
    assert!(transactions::get_transaction(&conn, &id).unwrap().is_none());
}

#[test]
fn delete_many_with_no_ids_is_a_no_op() {
    let mut conn = fresh_db("delete-many-empty");
    transactions::delete_transactions(&mut conn, op(), Vec::new()).unwrap();
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_transactions_bulk`
Expected: FAIL to compile — `delete_transactions` does not exist.

- [ ] **Step 3: Implement**

`src-tauri/src/database/domains/transactions.rs`:

```rust
/// Soft-delete many transactions in one operation.
///
/// Mirrors `browser/repos/transactions.ts:271-282`: an empty id list is a
/// no-op, and rows already soft-deleted are left alone rather than erroring.
pub fn delete_transactions(
    conn: &mut Connection,
    op_id: OperationId,
    ids: Vec<String>,
) -> DbResult<()> {
    if ids.is_empty() {
        return Ok(());
    }

    #[derive(serde::Serialize, serde::Deserialize)]
    struct Void {}

    let request = ids.clone();
    run_idempotent(conn, op_id, "delete_transactions", &request, |tx| {
        let now = now_iso_utc();
        for id in &ids {
            tx.execute(
                "UPDATE transactions SET deleted_at = ?1, updated_at = ?1 \
                 WHERE id = ?2 AND deleted_at IS NULL",
                params![now, id],
            )
            .map_err(map_sqlite_error)?;
        }
        Ok(Void {})
    })
    .map(|_| ())
}
```

- [ ] **Step 4: Re-export, wrap, register, fixture**

`domains/mod.rs` — add `delete_transactions` to the `transactions::` re-export list.

`commands.rs`:

```rust
#[tauri::command]
pub async fn transaction_delete_many(
    manager: State<'_, Arc<DatabaseManager>>,
    ids: Vec<String>,
) -> Result<(), DbError> {
    if ids.is_empty() {
        return Ok(());
    }
    let op_id = OperationId::generate();
    manager
        .data_job(move |state| {
            domains::transactions::delete_transactions(state.connection_mut()?, op_id, ids)
        })
        .await
}
```

`lib.rs` — add `transaction_delete_many,` in the transaction block.

`native-boundary.test.ts` — add `transaction_delete_many: null,` to `FIXTURES`
with a comment noting the return value is not asserted there.

- [ ] **Step 5: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

Run: `pnpm vitest run src/tests/unit/native-boundary.test.ts`
Expected: the `deleteMany` op row passes; two failures remain.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/database/domains/transactions.rs src-tauri/src/database/domains/mod.rs src-tauri/src/database/commands.rs src-tauri/src/lib.rs src-tauri/tests/domain_transactions_bulk.rs src/tests/unit/native-boundary.test.ts
git commit -m "feat: port transaction_delete_many to Rust

C1. The bulk-delete action on the transactions page (route line 203)
invoked a command Rust never registered. Ported 1:1 from
browser/repos/transactions.ts:271-282: one transaction, per-row guard,
empty id list is a no-op."
```

---

### Task 11: C1c — port `transaction_set_tag_many` and `transaction_set_account_many`

**Files:**
- Modify: `src-tauri/src/database/domains/transactions.rs`
- Modify: `src-tauri/src/database/domains/mod.rs`, `commands.rs`, `lib.rs`
- Test: `src-tauri/tests/domain_transactions_bulk.rs`
- Test: `src/tests/unit/native-boundary.test.ts` (fixtures)

**Interfaces:**
- Produces:
  - `pub fn set_tag_many(conn: &mut Connection, op_id: OperationId, ids: Vec<String>, tag_id: Option<String>) -> DbResult<()>`
  - `pub fn set_account_many(conn: &mut Connection, op_id: OperationId, ids: Vec<String>, account_id: String) -> DbResult<()>`
  - commands `transaction_set_tag_many(ids, tag_id)` and `transaction_set_account_many(ids, account_id)`.

**This task turns Gate 1 green.**

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/tests/domain_transactions_bulk.rs`:

```rust
#[test]
fn set_tag_many_retags_exactly_the_selected_ids() {
    let mut conn = fresh_db("set-tag-many");
    let account = account(&mut conn, "A");

    let a = transactions::create_transaction(
        &mut conn,
        op(),
        expense(&account, "A", 1_000, "2026-02-02"),
    )
    .unwrap();
    let b = transactions::create_transaction(
        &mut conn,
        op(),
        expense(&account, "B", 1_000, "2026-02-03"),
    )
    .unwrap();
    let keep = transactions::create_transaction(
        &mut conn,
        op(),
        expense(&account, "Keep", 1_000, "2026-02-04"),
    )
    .unwrap();

    transactions::set_tag_many(
        &mut conn,
        op(),
        vec![a.clone(), b.clone()],
        Some("tag_loss".to_string()),
    )
    .unwrap();

    assert_eq!(
        transactions::get_transaction(&conn, &a).unwrap().unwrap().tag_id.as_deref(),
        Some("tag_loss")
    );
    assert_eq!(
        transactions::get_transaction(&conn, &b).unwrap().unwrap().tag_id.as_deref(),
        Some("tag_loss")
    );
    assert_eq!(
        transactions::get_transaction(&conn, &keep).unwrap().unwrap().tag_id,
        None
    );
}

#[test]
fn set_tag_many_can_clear_the_tag() {
    let mut conn = fresh_db("set-tag-many-null");
    let account = account(&mut conn, "A");

    let mut input = expense(&account, "A", 1_000, "2026-02-02");
    input.tag_id = Some("tag_loss".to_string());
    let id = transactions::create_transaction(&mut conn, op(), input).unwrap();

    transactions::set_tag_many(&mut conn, op(), vec![id.clone()], None).unwrap();

    assert_eq!(transactions::get_transaction(&conn, &id).unwrap().unwrap().tag_id, None);
}

#[test]
fn set_tag_many_skips_soft_deleted_rows() {
    let mut conn = fresh_db("set-tag-many-deleted");
    let account = account(&mut conn, "A");

    let id = transactions::create_transaction(
        &mut conn,
        op(),
        expense(&account, "A", 1_000, "2026-02-02"),
    )
    .unwrap();
    transactions::delete_transaction(&mut conn, op(), &id).unwrap();

    transactions::set_tag_many(&mut conn, op(), vec![id.clone()], Some("tag_loss".to_string()))
        .unwrap();

    // Still soft-deleted, and get_transaction filters those out.
    assert!(transactions::get_transaction(&conn, &id).unwrap().is_none());
}

#[test]
fn set_account_many_moves_exactly_the_selected_ids() {
    let mut conn = fresh_db("set-account-many");
    let from = account(&mut conn, "From");
    let to = account(&mut conn, "To");

    let a = transactions::create_transaction(
        &mut conn,
        op(),
        expense(&from, "A", 1_000, "2026-02-02"),
    )
    .unwrap();
    let keep = transactions::create_transaction(
        &mut conn,
        op(),
        expense(&from, "Keep", 1_000, "2026-02-03"),
    )
    .unwrap();

    transactions::set_account_many(&mut conn, op(), vec![a.clone()], to.clone()).unwrap();

    assert_eq!(
        transactions::get_transaction(&conn, &a).unwrap().unwrap().account_id,
        to
    );
    assert_eq!(
        transactions::get_transaction(&conn, &keep).unwrap().unwrap().account_id,
        from
    );
}

#[test]
fn the_bulk_commands_with_no_ids_are_no_ops() {
    let mut conn = fresh_db("bulk-empty");
    transactions::set_tag_many(&mut conn, op(), Vec::new(), Some("tag_loss".to_string())).unwrap();
    transactions::set_account_many(&mut conn, op(), Vec::new(), "acc_missing".to_string()).unwrap();
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_transactions_bulk`
Expected: FAIL to compile — neither function exists.

- [ ] **Step 3: Implement**

`src-tauri/src/database/domains/transactions.rs`:

```rust
/// Retag many transactions in one operation.
///
/// Mirrors `browser/repos/transactions.ts:284-295`. `None` clears the tag, the
/// same way the browser sets the column to NULL rather than to an empty string.
pub fn set_tag_many(
    conn: &mut Connection,
    op_id: OperationId,
    ids: Vec<String>,
    tag_id: Option<String>,
) -> DbResult<()> {
    if ids.is_empty() {
        return Ok(());
    }

    #[derive(serde::Serialize, serde::Deserialize)]
    struct Void {}

    let request = (&ids, &tag_id);
    run_idempotent(conn, op_id, "set_tag_many", &request, |tx| {
        let now = now_iso_utc();
        for id in &ids {
            tx.execute(
                "UPDATE transactions SET tag_id = ?1, updated_at = ?2 \
                 WHERE id = ?3 AND deleted_at IS NULL",
                params![tag_id.as_deref(), now, id],
            )
            .map_err(map_sqlite_error)?;
        }
        Ok(Void {})
    })
    .map(|_| ())
}

/// Move many transactions to another account in one operation.
///
/// Mirrors `browser/repos/transactions.ts:297-308`. The destination account is
/// not pre-validated — the browser relies on the foreign key, and a bad
/// account id now surfaces as `InvalidInput` rather than as corruption.
pub fn set_account_many(
    conn: &mut Connection,
    op_id: OperationId,
    ids: Vec<String>,
    account_id: String,
) -> DbResult<()> {
    if ids.is_empty() {
        return Ok(());
    }

    #[derive(serde::Serialize, serde::Deserialize)]
    struct Void {}

    let request = (&ids, &account_id);
    run_idempotent(conn, op_id, "set_account_many", &request, |tx| {
        let now = now_iso_utc();
        for id in &ids {
            tx.execute(
                "UPDATE transactions SET account_id = ?1, updated_at = ?2 \
                 WHERE id = ?3 AND deleted_at IS NULL",
                params![&account_id, now, id],
            )
            .map_err(map_sqlite_error)?;
        }
        Ok(Void {})
    })
    .map(|_| ())
}
```

- [ ] **Step 4: Re-export, wrap, register, fixture**

`domains/mod.rs` — add `set_account_many, set_tag_many` to the re-export list.

`commands.rs`:

```rust
#[tauri::command]
pub async fn transaction_set_tag_many(
    manager: State<'_, Arc<DatabaseManager>>,
    ids: Vec<String>,
    tag_id: Option<String>,
) -> Result<(), DbError> {
    if ids.is_empty() {
        return Ok(());
    }
    let op_id = OperationId::generate();
    manager
        .data_job(move |state| {
            domains::transactions::set_tag_many(state.connection_mut()?, op_id, ids, tag_id)
        })
        .await
}

#[tauri::command]
pub async fn transaction_set_account_many(
    manager: State<'_, Arc<DatabaseManager>>,
    ids: Vec<String>,
    account_id: String,
) -> Result<(), DbError> {
    if ids.is_empty() {
        return Ok(());
    }
    let op_id = OperationId::generate();
    manager
        .data_job(move |state| {
            domains::transactions::set_account_many(state.connection_mut()?, op_id, ids, account_id)
        })
        .await
}
```

`lib.rs` — add `transaction_set_tag_many,` and `transaction_set_account_many,`.

`native-boundary.test.ts` — add:

```ts
		transaction_set_tag_many: null,
		transaction_set_account_many: null,
```

- [ ] **Step 5: Run Gate 1 and confirm it is green**

Run: `pnpm vitest run src/tests/unit/native-boundary.test.ts`
Expected: **PASS**, every row. This is the first green run of the gate; the
branch is no longer red.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

Run: `pnpm test && pnpm check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/database/domains/transactions.rs src-tauri/src/database/domains/mod.rs src-tauri/src/database/commands.rs src-tauri/src/lib.rs src-tauri/tests/domain_transactions_bulk.rs src/tests/unit/native-boundary.test.ts
git commit -m "feat: port the bulk retag and bulk move commands to Rust

C1, and Gate 1 goes green. Bulk retag (route line 232) and bulk move
(line 239) both invoked commands Rust never registered. Ported 1:1 from
browser/repos/transactions.ts:284-308, including the reliance on the
foreign key rather than a pre-validated destination account.

All four client-invoked commands the client had no Rust side for now
exist, and the boundary test proves the command surface and its argument
keys against lib.rs rather than against itself."
```

---

## Stage 2 — Boundary parity

### Task 12: I1 — the trend bucket filter the command throws away

**Files:**
- Modify: `src-tauri/src/database/domains/accounts.rs:44` (widen `today_iso`)
- Modify: `src-tauri/src/database/domains/reports.rs:192-250`
- Modify: `src-tauri/src/database/commands.rs:807-811`
- Test: `src-tauri/tests/domain_transactions_bulk.rs`
- Test: `src-tauri/tests/domain_reports_export.rs:237,250` (both existing `get_trend` callers need the new fourth argument)

**Interfaces:**
- Produces: `pub fn get_trend(conn: &Connection, months: u32, include_adjustments: bool, bucket_id: Option<&str>) -> DbResult<Vec<TrendPoint>>` — **a fourth parameter.**

**The defect.** `report_get_trend` declares `_bucket_id: Option<String>` and drops it. The client sends `bucketId`, the command accepts it, and the value goes nowhere — so a bucket-scoped trend silently returns the unscoped one.

**Reachability.** No shipping caller passes a bucket today:
`src/lib/stores/reports.svelte.ts:43` calls
`db.reports.getTrend(this.window, this.includeAdjustments)` with two arguments,
and the only other call site is the boundary test's own
`client.reports.getTrend(12)`. `native/client.ts:430-432` does forward
`bucketId` correctly. So this is a **latent** contract divergence — the port
advertises a parameter that silently does nothing — rather than a
user-visible web/desktop difference today. It is still worth fixing, precisely
because the moment a caller passes a bucket the failure is silent. Same
epistemic status spec §2 I4 is honest about.

- [ ] **Step 1: Make `today_iso` reachable from integration tests**

`src-tauri/src/database/domains/accounts.rs:44` is `pub(crate) fn today_iso()`.
Integration tests are a separate crate, so `pub(crate)` is invisible to them and
this task's test — plus Task 17's and Task 18's — fails to compile with
"function `today_iso` is private". Widen it:

```rust
/// Today's date as `YYYY-MM-DD` from the system clock (UTC).
pub fn today_iso() -> String {
```

Task 17 moves the derivation into `civil_date.rs` and re-exports it from
`accounts`, so this path stays valid and nothing downstream changes.

**Why this is a real defect, not just test ergonomics.** `today_iso` is the only
public door onto the civil-date derivation; `debts.rs:18` and
`reconciliations.rs:18` reach it through `crate::database::domains::accounts`
already. It being `pub(crate)` is why `transactions.rs:581-595` re-implements
the same block inline instead of calling it — see Task 17.

- [ ] **Step 2: Write the failing test**

Add to `src-tauri/tests/domain_transactions_bulk.rs` — it already has `fresh_db`, `op`, `account`, and `expense` from Task 9, and this test needs exactly those. Add one import at the top:

```rust
use notchy_lib::database::domains::reports;
```

```rust
#[test]
fn a_bucket_scoped_trend_only_counts_that_buckets_tags() {
    let mut conn = fresh_db("i1-trend-bucket");
    let account = account(&mut conn, "A");

    // `tag_loss` is seeded into the `bucket_adjustments` bucket. Dates come
    // from today so the assertion does not rot as the months roll forward.
    let today = notchy_lib::database::domains::accounts::today_iso();
    let month = &today[..7];

    let mut tagged = expense(&account, "Tagged", 5_000, &format!("{month}-05"));
    tagged.tag_id = Some("tag_loss".to_string());
    transactions::create_transaction(&mut conn, op(), tagged).unwrap();
    transactions::create_transaction(
        &mut conn,
        op(),
        expense(&account, "Untagged", 7_000, &format!("{month}-06")),
    )
    .unwrap();

    let all = reports::get_trend(&conn, 12, false, None).unwrap();
    let scoped = reports::get_trend(&conn, 12, false, Some("bucket_adjustments")).unwrap();

    let all_point = all.iter().find(|p| p.month == month).unwrap();
    let scoped_point = scoped.iter().find(|p| p.month == month).unwrap();

    // The untagged expense is excluded from the scoped trend — an inner join on
    // category_tags drops rows whose tag_id is NULL.
    assert_eq!(all_point.expense, 12_000);
    assert_eq!(scoped_point.expense, 5_000);
}
```

Check the `TrendPoint` field names in `src-tauri/src/database/types.rs` before
running this; if the spending field is named something other than `expense`,
use the real name.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_transactions_bulk`
Expected: FAIL to compile — `get_trend` takes three arguments.

- [ ] **Step 4: Thread the filter**

`src-tauri/src/database/domains/reports.rs`, at the top of `get_trend`:

```rust
    let kind = kind_filter(include_adjustments);

    // Bucket scoping mirrors the browser repo: join the tag table and restrict
    // on the tag's bucket. An inner join is deliberate — it drops rows with no
    // tag, which is what a bucket-scoped trend means.
    let (bucket_join, bucket_clause) = match bucket_id {
        Some(_) => (
            "JOIN category_tags ct ON t.tag_id = ct.id",
            "AND ct.type_id = ?3",
        ),
        None => ("", ""),
    };
```

Inside the per-month loop, extend the query and pick the matching parameter
list:

```rust
        let sql = format!(
            "SELECT t.kind, SUM(t.amount) AS total FROM transactions t
             {bucket_join}
             WHERE {kind} AND t.date >= ?1 AND t.date < ?2 AND t.deleted_at IS NULL
             {bucket_clause}
             GROUP BY t.kind"
        );
        let mut stmt = conn.prepare(&sql).map_err(map_sqlite_error)?;

        let rows: Vec<(String, i64)> = match bucket_id {
            Some(bucket) => stmt
                .query_map(params![start, end, bucket], |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })
                .map_err(map_sqlite_error)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(map_sqlite_error)?,
            None => stmt
                .query_map(params![start, end], |row| Ok((row.get(0)?, row.get(1)?)))
                .map_err(map_sqlite_error)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(map_sqlite_error)?,
        };
```

- [ ] **Step 5: Stop dropping it in the command**

`src-tauri/src/database/commands.rs`, `report_get_trend`:

```rust
#[tauri::command]
pub async fn report_get_trend(
    manager: State<'_, Arc<DatabaseManager>>,
    months: u32,
    include_adjustments: Option<bool>,
    bucket_id: Option<String>,
) -> Result<Vec<TrendPoint>, DbError> {
    let inc = include_adjustments.unwrap_or(false);
    manager
        .data_job(move |state| {
            domains::reports::get_trend(state.connection()?, months, inc, bucket_id.as_deref())
        })
        .await
}
```

The parameter is renamed from `_bucket_id` to `bucket_id`; the IPC argument key
stays `bucketId` either way, so the boundary test's expectation is unchanged.

- [ ] **Step 6: Update the other callers**

`reports::get_trend` is called with three arguments in two places in
`src-tauri/tests/domain_reports_export.rs` — line 237 (`get_trend(&db, 3, false)`)
and line 250 (`get_trend(&db, 2, false)`). Both take `None` for the bucket:

```rust
    let points = reports::get_trend(&db, 3, false, None).unwrap();
```

Any other call site the compiler names also passes `None`.

- [ ] **Step 7: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/database/domains/accounts.rs src-tauri/src/database/domains/reports.rs src-tauri/src/database/commands.rs src-tauri/tests/domain_reports_export.rs src-tauri/tests/domain_transactions_bulk.rs
git commit -m "fix: apply the trend bucket filter the command was discarding

I1. report_get_trend declared _bucket_id, the client sent bucketId, and
the value was dropped — a bucket-scoped trend silently returned the
unscoped one. get_trend now joins category_tags and restricts on the
tag's bucket, mirroring the browser repo.

No shipping caller passes a bucket yet, so this is latent rather than a
live web/desktop difference; it is fixed because the failure mode is
silent. Also widens accounts::today_iso from pub(crate) to pub, which
integration tests in this task, task 17, and task 18 all need."
```

---

### Task 13: I3 — name the linked goals in the deletion error

**Files:**
- Modify: `src-tauri/src/database/error.rs` (variant, `as_str`, meta keys)
- Modify: `src-tauri/src/database/domains/accounts.rs:365-384`
- Modify: `src/lib/utils/rust-error-messages.ts`
- Modify: `src/tests/unit/rust-error-parity.test.ts`
- Test: `src-tauri/tests/domain_accounts_transactions.rs`

**Interfaces:**
- Produces: `ErrorCode::AccountDeleteLinkedGoals` (wire name `account_delete_linked_goals`); meta keys `count`, `names`.

**Why this is not just a message.** `delete_account` returned a bare
`InvalidInput`, so the fully-built `errors_account_delete_linked_goals` copy
(en + vi, singular and plural) was dead on desktop. The meta keys are the
transport for the count and the names.

- [ ] **Step 1: Write the failing tests**

Rust — add to `src-tauri/tests/domain_accounts_transactions.rs`:

```rust
#[test]
fn deleting_an_account_with_linked_goals_names_them() {
    let mut conn = fresh_db("i3-linked-goals");
    let account = accounts::create_account(&mut conn, op(), default_account("Savings")).unwrap();
    goals::create_goal(
        &mut conn,
        op(),
        "Emergency fund".to_string(),
        GoalType::Savings,
        1_000_000,
        "2027-01-01".to_string(),
        Some(account.clone()),
        0,
        1,
    )
    .unwrap();

    let error = accounts::delete_account(&mut conn, op(), &account).unwrap_err();

    assert_eq!(error.code, ErrorCode::AccountDeleteLinkedGoals);
    assert_eq!(error.meta.get("count").map(String::as_str), Some("1"));
    assert_eq!(
        error.meta.get("names").map(String::as_str),
        Some("Emergency fund")
    );
}
```

Add `goals` to the domain imports and `GoalType` to the types imports.

TypeScript — add to `src/tests/unit/rust-error-parity.test.ts`:

```ts
	it('resolves a linked-goals rejection to the singular message', () => {
		const converted = toAppError({
			code: 'account_delete_linked_goals',
			meta: { count: '1', names: 'Emergency fund' },
		}) as NativeAppError;

		expect(mapError(converted)).toBe(
			m.errors_account_delete_linked_goals_one({ count: 1, names: 'Emergency fund' })
		);
	});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_accounts_transactions`
Expected: FAIL to compile — no `AccountDeleteLinkedGoals`.

Run: `pnpm vitest run src/tests/unit/rust-error-parity.test.ts`
Expected: FAIL — the code is not in the `ErrorCode` union, so the `toAppError` cast is wrong and `mapError` falls through to `errors_unknown()`.

- [ ] **Step 3: Add the code and its meta keys**

`src-tauri/src/database/error.rs` — add `AccountDeleteLinkedGoals,` to the
`ErrorCode` enum (after `InvalidInput`), `ErrorCode::AccountDeleteLinkedGoals => "account_delete_linked_goals",`
to `as_str`, and `Count,` / `Names,` to `MetaKey` with `"count"` / `"names"`
projections in both `as_str` and the `from_str` parse. Add
`ErrorCode::AccountDeleteLinkedGoals` to `ErrorCode::ALL` and bump its length
to 18.

`MetaKey` is a deliberate allowlist — its own doc comment says "Meta keys are
restricted to [`MetaKey`]; the builder enforces the allowlist, and an unknown
key is a programming error." Widening it is therefore a decision, not
bookkeeping, so record what the two new keys carry: an **integer count** and
**goal names** the user typed, joined with `", "`. Nothing else — no payees, no
descriptions, no amounts, no transaction ids, no raw SQLite text. Goal names
are already user-visible in the goals list, and they reach localized copy
through the same interpolation path `mapError` uses for every other parameter.
If a future key wants to carry a financial row or a free-text field wider than
a name, that is a new decision and belongs in a spec, not in this list.

- [ ] **Step 4: Return it with its meta**

`src-tauri/src/database/domains/accounts.rs`, inside `delete_account`'s
`run_idempotent` closure — replace the "Block if any active goal links" block:

```rust
        // Collect the names, not just the existence: the message names the
        // goals the user has to unlink. Ordered so the copy is stable.
        let mut stmt = tx
            .prepare(
                "SELECT name FROM goals
                 WHERE linked_account_id = ?1 AND deleted_at IS NULL AND status = 'active'
                 ORDER BY name",
            )
            .map_err(map_sqlite_error)?;
        let names: Vec<String> = stmt
            .query_map(params![id], |row| row.get(0))
            .map_err(map_sqlite_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(map_sqlite_error)?;

        if !names.is_empty() {
            return Err(DbError::new(ErrorCode::AccountDeleteLinkedGoals)
                .with_meta(MetaKey::Count.as_str(), names.len().to_string())
                .with_meta(MetaKey::Names.as_str(), names.join(", ")));
        }
```

**Use `MetaKey::X.as_str()`, not the bare variant.** `with_meta`'s signature is
`pub fn with_meta(mut self, key: &str, value: impl Into<String>) -> Self`
(`error.rs:134`) — it takes a `&str` and validates it through
`MetaKey::from_str`, and `MetaKey` has no `AsRef<str>`, `Deref`, or
`Into<&str>` impl, so `with_meta(MetaKey::Count, …)` does not compile. Passing
the literal `"count"` would compile and work, but with one sharp edge worth
knowing: `with_meta` **panics** on a key that is not in the allowlist

```rust
        let key = MetaKey::from_str(key).unwrap_or_else(|| {
            panic!("unknown metadata key: {key}");
        });
```

so a typo'd key becomes a runtime panic in a money path rather than an error.
`.as_str()` is the form that can be neither mistyped nor out of sync with the
enum.

`MetaKey` is already imported in `commands.rs`; add it to the `error` import in
`accounts.rs` if it is not there.

- [ ] **Step 5: Regenerate the bindings and add the message**

```bash
pnpm generate:db-contracts
pnpm check:db-contracts
```

Expected: the generated union now includes `'account_delete_linked_goals'`.
`pnpm check:db-contracts` must pass.

Run `pnpm check` — it must now **fail** in
`src/lib/utils/rust-error-messages.ts`, because the `Record` is missing the new
key. That failure is Gate 2 doing its job. Fix it:

```ts
	invalid_input: generic,
	// The browser switch already formats this message; the two are kept as
	// parallel entries rather than sharing a helper because the browser path is
	// intentionally untouched in this phase. Collapse them if a third caller
	// appears.
	account_delete_linked_goals: (params) => {
		const count = Number(params.count);
		const names = String(params.names);
		return count === 1
			? m.errors_account_delete_linked_goals_one({ count, names })
			: m.errors_account_delete_linked_goals({ count, names });
	},
	recovery_required: generic,
```

- [ ] **Step 6: Run the tests**

Run: `pnpm check && pnpm vitest run src/tests/unit/rust-error-parity.test.ts`
Expected: PASS.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/database/error.rs src-tauri/src/database/domains/accounts.rs src-tauri/tests/domain_accounts_transactions.rs src/lib/native/contracts.generated.ts src/lib/utils/rust-error-messages.ts src/tests/unit/rust-error-parity.test.ts
git commit -m "feat: name the linked goals when an account deletion is blocked

I3. delete_account returned a bare InvalidInput, so the fully-built
errors_account_delete_linked_goals copy (en and vi, singular and plural)
was dead on desktop — and the count and names it interpolates had no
transport at all. Adds the code, the two allowlisted meta keys, and the
message-table entry the compiler now demands."
```

---

### Task 14: I6 — one control-character corpus for both implementations

**Files:**
- Create: `src-tauri/tests/fixtures/control-chars.json`
- Create: `src/tests/unit/sanitize.test.ts`
- Modify: `src/lib/utils/sanitize.ts:1-13`
- Test: `src-tauri/tests/domain_accounts_transactions.rs`

**Interfaces:**
- Consumes: `no_patch()` from Task 4.
- Produces: nothing new. `strip_control_chars` keeps its signature.

**The divergence.** Rust's `char::is_control()` matches Unicode general category
Cc — C0, DEL, and C1 (0x80–0x9F). `sanitize.ts:13` strips only `[\x00-\x1F\x7F]`.
So C1 characters are stripped on desktop and kept on web: the same payee text
becomes two different strings depending on which build you are in.

**The exported name.** `src/lib/utils/sanitize.ts:10` exports exactly one
function: `stripControlChars`. There is no `sanitize` or `sanitizeText` export,
and there is no `src/tests/unit/sanitize.test.ts` today — `stripControlChars` is
covered only indirectly, through `transactions.test.ts`. The steps below name
the real symbol and create the new test file.

- [ ] **Step 1: Write the shared corpus**

Create `src-tauri/tests/fixtures/control-chars.json`. **Every character must be
a `\uXXXX` escape, never a literal.**

This is not style. JSON forbids unescaped characters in the range U+0000–U+001F
inside a string, so a literal control character makes the file invalid JSON:
`serde_json` refuses to parse it and the Rust test panics on load, and Vite's
JSON import (`JSON.parse`) fails the same way on the TypeScript side. Both
halves of a "shared corpus" would be unreadable. It is also unreviewable — a
literal C1 character is indistinguishable from whitespace in a diff, so the case
list would silently degrade into empty strings without anyone noticing.

```json
{
  "stripped": ["\u0000", "\u0007", "\u001F", "\u007F", "\u0085", "\u0092", "\u009F"],
  "preserved": ["\n", "\r", "\t", "a", "\u00E9", "\u4E2D"],
  "cases": [
    { "input": "Coffee\u0007Shop", "expected": "CoffeeShop" },
    { "input": "\u0085hidden\u0092", "expected": "hidden" },
    { "input": "line\nbreak\ttab", "expected": "line\nbreak\ttab" },
    { "input": "caf\u00E9 \u4E2D", "expected": "caf\u00E9 \u4E2D" },
    { "input": "a\u001Fb\u007Fc\u009Fd", "expected": "abcd" }
  ]
}
```

`\u0000` is listed in `stripped` but appears in no `input`: whether a NUL
survives a round trip through a bound `&str` and SQLite TEXT is a separate
question, and it is not what I6 is about. `stripped` and `preserved` are
documentation for the reader; `cases` is what both tests assert over.

The file lives under `src-tauri/tests/fixtures/`, which already exists and holds
the `.sqlite` fixtures the Rust integration tests anchor to, so the Rust side
needs no new dev-dependency — `serde_json` is a normal dependency
(`src-tauri/Cargo.toml:19`). The TypeScript test reaches across with a relative
path. One file, read by both: a corpus that lives inside either implementation
cannot catch the two drifting apart.

- [ ] **Step 2: Write the failing tests**

Rust — add to `src-tauri/tests/domain_accounts_transactions.rs`:

```rust
#[test]
fn control_characters_are_stripped_according_to_the_shared_corpus() {
    let corpus_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/control-chars.json");
    let corpus: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&corpus_path).unwrap()).unwrap();

    let mut conn = fresh_db("i6-control-chars");
    let account = accounts::create_account(&mut conn, op(), default_account("A")).unwrap();

    for case in corpus["cases"].as_array().unwrap() {
        let input = case["input"].as_str().unwrap();
        let expected = case["expected"].as_str().unwrap();

        let id = transactions::create_transaction(&mut conn, op(), default_expense(&account, 100))
            .unwrap();

        let mut patch = no_patch();
        patch.description = Patch::Replace { value: input.to_string() };
        transactions::update_transaction(&mut conn, op(), &id, patch).unwrap();

        let row = transactions::get_transaction(&conn, &id).unwrap().unwrap();
        assert_eq!(row.description.as_deref(), Some(expected), "input {input:?}");
    }
}
```

TypeScript — create `src/tests/unit/sanitize.test.ts`:

```ts
import corpus from '../../../src-tauri/tests/fixtures/control-chars.json';
import { stripControlChars } from '$lib/utils/sanitize';

it('strips C0, DEL, and C1, and preserves newline, carriage return, and tab', () => {
	for (const testCase of corpus.cases) {
		expect(
			stripControlChars(testCase.input),
			`input ${JSON.stringify(testCase.input)}`
		).toBe(testCase.expected);
	}
});
```

Three things that must be right for this to run:

- The relative path has three `..`: this file sits in `src/tests/unit/`, so
  `../../..` reaches the repo root.
- The import is `stripControlChars` — the only export of `sanitize.ts:10`.
- `src-tauri/` is inside the Vite project root, so the JSON import resolves
  without touching `server.fs.allow`. If a future config change does reject it,
  read the file instead of copying the path:
  `JSON.parse(readFileSync(resolve(process.cwd(), 'src-tauri/tests/fixtures/control-chars.json'), 'utf8'))`.
  Do not inline a second copy of the corpus — the shared file is the mechanism.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_accounts_transactions`
Expected: PASS — Rust already strips C1. This side is the control.

Run: `pnpm vitest run src/tests/unit/sanitize.test.ts`
Expected: FAIL on the C1 cases — the browser keeps `\u0085`, `\u0092`, and `\u009F`.

- [ ] **Step 4: Widen the browser regex, and correct the comment that overstates it**

`src/lib/utils/sanitize.ts`, line 13:

```ts
	// Union of what the two implementations used to strip separately: C0, DEL,
	// and C1 (0x80-0x9F). Rust's `char::is_control()` matches general category
	// Cc, which is all three; the browser stripped only C0 and DEL, so C1
	// characters survived on web and vanished on desktop. Newline, carriage
	// return, and tab stay.
	return input.replace(/(?![\n\r\t])[\x00-\x1F\x7F-\x9F]/g, '');
```

Then fix the module doc comment above it (lines 1-8), which claims something
the code has never done:

```
 * Removes ASCII control chars 0x00–0x1F and 0x7F except \n (0x0A), \r (0x0D),
 * and \t (0x09), plus Unicode category Cc/Cf (deliberately permissive: keeps
 * all visible glyphs, including combining marks handled separately by NFC).
```

There is no `\p{Cc}` or `\p{Cf}` anywhere in the implementation and never has
been — the regex is ASCII-only until this step. The comment described an
intention, the regex described neither that intention nor the real behavior, and
the comment is the part a reader trusts. Rewrite it to say what the character
class now covers: Cc minus `\n`, `\r`, and `\t`. Format characters (`Cf`, e.g.
U+200B zero-width space) are **not** in scope — do not claim them.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/tests/unit/sanitize.test.ts`
Expected: PASS.

Run: `pnpm test`
Expected: PASS. If another test asserted that a C1 character survives, it was encoding the divergence — update it and name it in the commit message.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/tests/fixtures/control-chars.json src-tauri/tests/domain_accounts_transactions.rs src/lib/utils/sanitize.ts src/tests/unit/sanitize.test.ts
git commit -m "fix: strip C1 control characters on web too

I6. Rust's char::is_control() matches category Cc (C0, DEL, and C1), but
sanitize.ts stripped only [\\x00-\\x1F\\x7F]. The same payee text became
two different strings depending on which build you were in.

Both sides now read one corpus committed under src-tauri/tests/fixtures/,
so they cannot drift apart without one side failing."
```

---

## Stage 3 — Structural (optional)

**This stage is the designated cut line.** It has no correctness consumer, it
is the largest and riskiest diff in the phase, and the spec names it as the
first thing to cut if the phase needs to shrink. Skip it entirely if Stages 0–2
are enough — nothing in Stage 0–2 depends on any task here.

### Task 15: S3 — delete the dead native reports stub

**Files:**
- Delete: `src/lib/db/native/reports.ts`

**Interfaces:** none.

- [ ] **Step 1: Confirm nothing imports it**

```bash
grep -rn "native/reports" src --include="*.ts" --include="*.svelte"
```

Expected: no output. If there is a hit, stop and reassess — this task's premise
is that there is not.

- [ ] **Step 2: Confirm what it is**

Read the file. Every export throws `native reports adapter not wired`. The live
report port is in `native/client.ts`. An inactive adapter that throws is not a
seam; it is a second copy of the interface that no one compiles against.

- [ ] **Step 3: Delete and verify**

```bash
git rm src/lib/db/native/reports.ts
pnpm check && pnpm test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: delete the dead native reports stub

S3. Every export in native/reports.ts throws 'native reports adapter not
wired'. The live report port lives in native/client.ts; this was a second
copy of the interface, unreferenced, that only made the surface look
larger than it is."
```

---

### Task 16: S2 — one name for the spending kind filter

**Files:**
- Modify: `src-tauri/src/database/domains/reports.rs:52-58`, `:348-353`, `:426-431`

**Interfaces:**
- Produces: `fn spending_kind_filter(include_adjustments: bool) -> &'static str` (private).

**What is duplicated.** `kind_filter` at line 52 is the *cash-flow* list
(`expense, income, refund[, adjustment]`). Two other queries — around lines 350
and 428 — inline a *spending* list by hand:
`t.kind IN ('expense', 'refund'[, 'adjustment'])`.

These are **not** the same list, so do not route them through `kind_filter` —
that would start counting income as spending. The fix is a second named helper
for the second concept.

- [ ] **Step 1: Write the guard test**

This is a literal-preserving extraction, so the guard is a unit test on the
private helpers rather than an integration test. Add at the bottom of
`src-tauri/src/database/domains/reports.rs`:

```rust
#[cfg(test)]
mod kind_filter_tests {
    use super::{kind_filter, spending_kind_filter};

    /// The two filters are different concepts. Collapsing them into one would
    /// silently make "spending" include income, and every spending series in
    /// the app would inflate with no failing test anywhere else.
    #[test]
    fn a_spending_filter_never_counts_income() {
        assert!(spending_kind_filter(false).contains("'expense'"));
        assert!(spending_kind_filter(false).contains("'refund'"));
        assert!(!spending_kind_filter(false).contains("'income'"));
        assert!(!spending_kind_filter(false).contains("'adjustment'"));

        assert!(spending_kind_filter(true).contains("'adjustment'"));
        assert!(!spending_kind_filter(true).contains("'income'"));
    }

    #[test]
    fn the_cash_flow_filter_includes_income() {
        assert!(kind_filter(false).contains("'income'"));
        assert!(kind_filter(true).contains("'income'"));
        assert!(kind_filter(true).contains("'adjustment'"));
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib kind_filter_tests`
Expected: FAIL to compile — `spending_kind_filter` does not exist.

- [ ] **Step 3: Extract the helper**

`src-tauri/src/database/domains/reports.rs`, below `kind_filter`:

```rust
/// Build the spending-only kind clause.
///
/// Deliberately not `kind_filter`: a spending series counts expenses and
/// refunds, never income. The two lists look similar and are not the same
/// concept, which is exactly why this needs a name of its own.
fn spending_kind_filter(include_adjustments: bool) -> &'static str {
    if include_adjustments {
        "t.kind IN ('expense', 'refund', 'adjustment')"
    } else {
        "t.kind IN ('expense', 'refund')"
    }
}
```

Replace both inline `if include_adjustments { "t.kind IN (...)" } else { ... }`
blocks (around lines 350 and 428) with
`let kind = spending_kind_filter(include_adjustments);`.

- [ ] **Step 4: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS, including `kind_filter_tests` and the existing reports suite.

- [ ] **Step 5: Confirm the extraction changed no literal**

Diff the two removed blocks against the new helper by eye before committing —
the entire risk in this task is a typo in a copied SQL literal, and the guard
in Step 1 checks the shape, not the spelling. Confirm each of the four strings
matches exactly.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/database/domains/reports.rs
git commit -m "refactor: name the spending kind filter

S2. Two report queries inlined the spending-only kind list
('expense', 'refund'[, 'adjustment']) by hand while kind_filter carries
the cash-flow list, which also includes income. They are different
concepts, so this adds a second named helper rather than folding them
together; a unit test pins that a spending filter never counts income."
```

---

### Task 17: S1 — one balance helper and one civil-date derivation

**Files:**
- Create: `src-tauri/src/database/domains/balance.rs`
- Create: `src-tauri/src/database/domains/civil_date.rs`
- Modify: `src-tauri/src/database/domains/mod.rs`
- Modify: `src-tauri/src/database/domains/accounts.rs` — `today_iso` (43-60)
  and `get_balance` (89-111)
- Modify: `src-tauri/src/database/domains/goals.rs` — `get_balance` (18-40),
  the `:7` import, and `compute_velocity_status`'s `today_iso()` at `:117`
- Modify: `src-tauri/src/database/domains/debts.rs` — `get_balance` (17-39)
- Modify: `src-tauri/src/database/domains/reconciliations.rs` — `get_balance`
  (18-40)
- Modify: `src-tauri/src/database/domains/reports.rs` — four Hinnant blocks
  (`:200-216`, `:352-372`, `:436-450`, `:587-603`)
- Modify: `src-tauri/src/database/domains/transactions.rs` — the inline
  `today_iso` at `:581-595`
- Test: `src-tauri/tests/domain_accounts_transactions.rs`

**Interfaces:**
- Produces:
  - `pub fn account_balance_as_of(conn: &Connection, account_id: &str, as_of: &str) -> DbResult<i64>`
  - `pub fn net_worth_as_of(conn: &Connection, as_of: &str) -> DbResult<i64>`
  - `pub fn current_year_month() -> (i32, u32)`
  - `pub fn today_iso() -> String`, re-exported from `accounts` so its
    existing callers keep their path (Task 12 made it `pub`)

**The duplication — exact census.** Counted against the tree, not estimated:

| Expression | Sites | Handled here |
|---|---|---|
| signed-balance CASE | `accounts.rs:96`, `debts.rs:24`, `reconciliations.rs:25`, `goals.rs:25`, `reports.rs:616` | **4 of 5** — `reports.rs:616` sits inside the loop Task 18 deletes |
| Hinnant days → `(year, month)` | `reports.rs:204`, `:362`, `:440`, `:591` | **all 4** |
| Hinnant days → `today_iso` | `accounts.rs:49`, `transactions.rs:585` | **both** |

Deliberately **not** consolidated, and why each one stays:

- `budgets.rs:46` — a *spending* sum (`-t.amount` for expense). Its sign
  convention is the opposite of a balance, so folding it in would be wrong.
- `accounts.rs:137` — `list_accounts`' `UNION ALL` subquery. Same quantity, a
  different route: one scan, no correlated subquery per account, and its own
  doc comment says so. Swapping it for the helper is a performance regression,
  not a deduplication.
- `migrations.rs:643`, `backup.rs:482` — storage layer. Having the
  migration/backup path depend on a domain module inverts the layering.

**What this task does not invent.** `balance::account_balance_as_of` is the body
of the existing public `accounts::get_balance` (`accounts.rs:90`), moved — not a
new function. There is no `accounts::get_balance_as_of`; the two commands that
sound like it are `account_get_balance` and `account_get_balance_as_of`
(`commands.rs:107`, `:116`), and both call the same `accounts::get_balance`.

- [ ] **Step 1: Write the characterization tests**

Add to `src-tauri/tests/domain_accounts_transactions.rs`:

```rust
#[test]
fn the_shared_balance_helper_matches_the_transaction_it_moves() {
    let mut conn = fresh_db("s1-balance-helper");
    let account = accounts::create_account(&mut conn, op(), default_account("A")).unwrap();

    transactions::create_transaction(&mut conn, op(), default_expense(&account, 2_500))
        .unwrap();

    let today = accounts::today_iso();
    let moved = notchy_lib::database::domains::balance::account_balance_as_of(
        &conn, &account, &today,
    )
    .unwrap();

    // -2500 as an expense from a fresh checking account.
    assert_eq!(moved, -2_500);

    // The point of the move: the old entry point must still agree with it.
    assert_eq!(accounts::get_balance(&conn, &account, &today).unwrap(), moved);
}
```

`accounts::today_iso()` is `pub` as of Task 12, which is what makes this — and
Task 18's test — compile.

- [ ] **Step 2: Run it**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_accounts_transactions`
Expected: FAIL to compile — the module does not exist.

- [ ] **Step 3: Move the balance expression into its own module**

Create `src-tauri/src/database/domains/balance.rs`:

```rust
//! One place that knows how a transaction row maps to an account balance.
//!
//! `account_balance_as_of` is the body of `accounts::get_balance`, moved here
//! unchanged. The same expression was copy-pasted into `goals::get_balance`,
//! `debts::get_balance`, `reconciliations::get_balance`, and the per-account
//! loop in `reports::get_net_worth_series`. Five copies of a sign convention is
//! five chances to disagree about whether a refund is positive.

use rusqlite::{Connection, params};

use crate::database::error::{DbResult, map_sqlite_error};

/// Signed balance of one account as of `as_of`, inclusive.
///
/// Both directions of a transfer are counted, because the ledger of an account
/// shows transfers where it is either party (single-row transfer model:
/// `account_id` is the source, `transfer_account_id` the destination).
pub fn account_balance_as_of(conn: &Connection, account_id: &str, as_of: &str) -> DbResult<i64> {
    conn.query_row(
        "SELECT COALESCE(SUM(CASE
            WHEN kind = 'income' THEN amount
            WHEN kind = 'adjustment' THEN amount
            WHEN kind = 'refund' THEN amount
            WHEN kind = 'expense' THEN -amount
            WHEN kind = 'transfer' AND account_id = ?1 THEN -amount
            WHEN kind = 'transfer' AND transfer_account_id = ?1 THEN amount
            ELSE 0
        END), 0)
        FROM transactions
        WHERE (account_id = ?1 OR (kind = 'transfer' AND transfer_account_id = ?1))
          AND deleted_at IS NULL
          AND date <= ?2",
        params![account_id, as_of],
        |row| row.get(0),
    )
    .map_err(map_sqlite_error)
}

/// Signed net worth across every live account as of `as_of`, inclusive.
///
/// One query rather than one per account. The join reproduces the per-account
/// loop exactly: a row is counted once per live account it touches, so a
/// transfer between two live accounts contributes -amount and +amount and nets
/// to zero, while a transfer into a deleted account still counts its source.
pub fn net_worth_as_of(conn: &Connection, as_of: &str) -> DbResult<i64> {
    conn.query_row(
        "SELECT COALESCE(SUM(CASE
            WHEN t.kind = 'expense' THEN -t.amount
            WHEN t.kind = 'transfer' AND t.account_id = a.id THEN -t.amount
            WHEN t.kind = 'transfer' AND t.transfer_account_id = a.id THEN t.amount
            WHEN t.kind IN ('income', 'adjustment', 'refund') THEN t.amount
            ELSE 0
        END), 0)
        FROM transactions t
        JOIN accounts a
          ON a.deleted_at IS NULL
         AND (a.id = t.account_id OR (t.kind = 'transfer' AND a.id = t.transfer_account_id))
        WHERE t.deleted_at IS NULL AND t.date <= ?1",
        params![as_of],
        |row| row.get(0),
    )
    .map_err(map_sqlite_error)
}
```

- [ ] **Step 4: Create the civil-date module**

Create `src-tauri/src/database/domains/civil_date.rs`. Note the two public
functions share one private derivation — `current_year_month` was discarding
the day it had already computed:

```rust
//! Civil date arithmetic, in one place.
//!
//! The Howard Hinnant days-from-civil block was copy-pasted four times inside
//! `reports.rs` alone (`:204`, `:362`, `:440`, `:591`) and once more inline in
//! `transactions.rs:585`. Five copies of a date derivation is five places to be
//! wrong about February.

/// `(year, month, day)` for a count of days since the Unix epoch, UTC.
///
/// Howard Hinnant's `civil_from_days`, the standard constant-719468 form.
fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };

    (year as i32, month as u32, day as u32)
}

/// Days since the Unix epoch, UTC, from the system clock.
fn days_since_epoch() -> i64 {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    (now.as_secs() / 86_400) as i64
}

/// Today as `(year, month)`, UTC.
pub fn current_year_month() -> (i32, u32) {
    let (year, month, _) = civil_from_days(days_since_epoch());
    (year, month)
}

/// Today as `YYYY-MM-DD`, UTC.
pub fn today_iso() -> String {
    let (year, month, day) = civil_from_days(days_since_epoch());
    format!("{year:04}-{month:02}-{day:02}")
}
```

The arithmetic is unchanged from what the four copies already do — same
`719_468`, same `146_097`, same term order. This is a move, and any deviation
here silently shifts every month boundary in every report.

- [ ] **Step 5: Register the modules and route `accounts` through them**

`src-tauri/src/database/domains/mod.rs` — add in alphabetical position:

```rust
pub mod balance;
pub mod civil_date;
```

`src-tauri/src/database/domains/accounts.rs`:

- Delete `today_iso` (lines 43-60) and re-export the shared one in its place. Its
  remaining references after Step 6 — `commands.rs:111`, `accounts.rs:122`,
  `accounts.rs:202`, and `goals.rs:117` — all keep working unchanged:

```rust
pub use super::civil_date::today_iso;
```

The three references inside the private `get_balance` helpers
(`debts.rs:18`, `reconciliations.rs:19`, `goals.rs:19`) go away with those
helpers; they are not callers this re-export exists to serve.

- Replace `get_balance`'s body (lines 89-111) with a delegation, keeping the
  signature that `commands.rs:112`, `commands.rs:121`, and `accounts.rs:203`
  already call:

```rust
/// Compute the balance for one account as of `date` (inclusive).
///
/// The expression lives in [`super::balance::account_balance_as_of`]; this is
/// the name the account commands were built against.
pub fn get_balance(conn: &Connection, account_id: &str, date: &str) -> DbResult<i64> {
    super::balance::account_balance_as_of(conn, account_id, date)
}
```

- Leave `list_accounts`' `UNION ALL` subquery alone, for the reason in the
  census table.

- [ ] **Step 6: Replace every remaining copy**

**The three private `get_balance` helpers** — delete each one and call the
shared helper at its call sites:

| File | Delete | Call sites become |
|---|---|---|
| `goals.rs:18-40` | `fn get_balance` | `goals.rs:77`, `goals.rs:82` |
| `debts.rs:17-39` | `fn get_balance` | `debts.rs:71` |
| `reconciliations.rs:18-40` | `fn get_balance` | `reconciliations.rs:102` |

Each call site becomes:

```rust
balance::account_balance_as_of(conn, account_id, &civil_date::today_iso())?
```

`goals.rs` already imports the date helper by its old path — line 7 is
`use crate::database::domains::accounts::today_iso;`. That path still resolves
after Step 5 re-exports it, but the bare name is what Step 5 asked you to stop
using, so **replace that line** with `use super::{balance, civil_date};`. Note
`goals.rs` has a second `today_iso()` at `:117`, inside
`compute_velocity_status` — that call survives the helper's deletion and must
become `civil_date::today_iso()`. `debts.rs` and `reconciliations.rs` import
nothing from `accounts`; add the same
`use super::{balance, civil_date};` line to each.

**The four Hinnant month blocks in `reports.rs`** — at `:200-216`, `:352-372`,
`:436-450`, and `:587-603`, each block ends with the same two lines:

```rust
    let mut cur_month_i = m as i32;
    let mut cur_year = yr;
```

Replace those two lines with:

```rust
    let (mut cur_year, mut cur_month_i) = civil_date::current_year_month();
```

`cur_month_i` becomes `u32`. That is safe at all four sites: every use is either
`format!("{:04}-{:02}", cur_year, cur_month_i)` or the decrement

```rust
            cur_month_i -= 1;
            if cur_month_i == 0 { cur_month_i = 12; cur_year -= 1; }
```

and a month is never below 1, so the subtraction cannot underflow before the
`== 0` check resets it.

**The inline `today_iso` in `transactions.rs:581-595`** — it recomputes the same
block to get today's date. Replace it with `civil_date::today_iso()`.

- [ ] **Step 7: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS. The reports suite is the real check here: a wrong month
derivation changes which months appear in every trend, and the balance move is
covered by the characterization test from Step 1 plus the existing account,
goal, debt, and reconciliation suites.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/database/domains/balance.rs \
        src-tauri/src/database/domains/civil_date.rs \
        src-tauri/src/database/domains/mod.rs \
        src-tauri/src/database/domains/accounts.rs \
        src-tauri/src/database/domains/goals.rs \
        src-tauri/src/database/domains/debts.rs \
        src-tauri/src/database/domains/reconciliations.rs \
        src-tauri/src/database/domains/reports.rs \
        src-tauri/src/database/domains/transactions.rs \
        src-tauri/tests
git commit -m "refactor: one balance expression, one civil-date derivation

S1. The signed-balance CASE appeared in five places (accounts, goals,
debts, reconciliations, and the net-worth loop) and the days-from-civil
block in five more (four in reports.rs, one inline in transactions.rs).
Five copies of a sign convention is five chances to disagree about
whether a refund is positive.

accounts::get_balance keeps its name and now delegates; the four private
get_balance helpers are gone. accounts::today_iso moves to civil_date
and is re-exported, so its callers are unchanged.

Left alone on purpose: budgets.rs has a spending sum, not a balance;
list_accounts uses a single-scan UNION ALL; migrations and backup are
storage layer and must not depend on domains."
```

### Task 18: S4 — collapse the two net-worth N+1 loops

**Files:**
- Modify: `src-tauri/src/database/domains/reports.rs` — the inner
  `for acc_id in &account_ids` loop inside `get_net_worth_series`
- Modify: `src-tauri/src/database/domains/goals.rs` — the `GoalType::NetWorth`
  arm of `enrich_goal`
- Test: `src-tauri/tests/domain_transactions_bulk.rs`

**Interfaces:**
- Consumes: `balance::net_worth_as_of` from Task 17. **This task cannot run without Task 17.**

**The defect.** `reports::get_net_worth_series` runs one query per account per
month; `goals::enrich_goal` runs one query per account for a net-worth goal. A
50-account history over 60 months is 3,000 queries.

**Sequencing — this task runs after Task 17, and the line numbers above assume
it has not.** Task 17 deletes the private `goals::get_balance` and rewires its two
call sites; by the time this task starts, `goals.rs:77` already reads
`balance::account_balance_as_of(conn, &id, &civil_date::today_iso())`, and Task 17
replaced the two-line month derivation at `reports.rs:602-603` with a single call.
So the regions below are located **by content**, not by the line numbers the
pre-Task-17 tree reports: the reports loop is the `for acc_id in &account_ids`
loop, and the goal arm is the `GoalType::NetWorth` branch. Nothing here re-adds
`get_balance`; this task collapses loops, it does not undo Task 17.

- [ ] **Step 1: Add the transaction helpers this test needs**

`src-tauri/tests/domain_transactions_bulk.rs` has `account` and `expense` from
Task 9. Add two more next to `expense`:

```rust
fn income(account_id: &str, amount: i64, date: &str) -> NewTransaction {
    NewTransaction {
        kind: TransactionKind::Income,
        date: date.to_string(),
        amount,
        account_id: account_id.to_string(),
        transfer_account_id: None,
        refund_of_id: None,
        tag_id: None,
        payee: None,
        description: None,
    }
}

fn transfer(from: &str, to: &str, amount: i64, date: &str) -> NewTransaction {
    NewTransaction {
        kind: TransactionKind::Transfer,
        date: date.to_string(),
        amount,
        account_id: from.to_string(),
        transfer_account_id: Some(to.to_string()),
        refund_of_id: None,
        tag_id: None,
        payee: None,
        description: None,
    }
}
```

- [ ] **Step 2: Write the equivalence test**

This test pins Task 17's `balance::net_worth_as_of` rather than anything this
task writes — Step 3 says as much. That is deliberate: the helper is the single
point where a wrong join would silently change every net-worth number, and it is
worth a test that names that risk instead of leaving it to the existing suites.
The collapse this task actually performs is carried by those suites:
`domain_reports_export.rs:386` (`net_worth_series`), `:407`
(`net_worth_empty_database`), `:415` (`net_worth_includes_liability_negative`),
and `domain_goals_rules_meta.rs:154` (`goal_progress_net_worth`). They assert
exact figures and must stay green with no edit.

```rust
#[test]
fn net_worth_equals_the_sum_of_live_account_balances() {
    use notchy_lib::database::domains::balance;

    let mut conn = fresh_db("s4-net-worth");
    let a = account(&mut conn, "A");
    let b = account(&mut conn, "B");
    let gone = account(&mut conn, "Gone");
    let today = notchy_lib::database::domains::accounts::today_iso();

    transactions::create_transaction(&mut conn, op(), expense(&a, "Coffee", 2_000, &today)).unwrap();
    transactions::create_transaction(&mut conn, op(), income(&b, 50_000, &today)).unwrap();
    transactions::create_transaction(&mut conn, op(), transfer(&a, &b, 10_000, &today)).unwrap();

    // Into an account that is then deleted: the source side still counts and
    // the destination side does not. This is the case where a naive
    // single-query rewrite and the per-account loop disagree.
    transactions::create_transaction(&mut conn, op(), transfer(&a, &gone, 3_000, &today)).unwrap();
    accounts::delete_account(&mut conn, op(), &gone).unwrap();

    let expected = balance::account_balance_as_of(&conn, &a, &today).unwrap()
        + balance::account_balance_as_of(&conn, &b, &today).unwrap();

    assert_eq!(balance::net_worth_as_of(&conn, &today).unwrap(), expected);
}
```

- [ ] **Step 3: Run it**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_transactions_bulk`
Expected: PASS if Task 17's helper is correct. If it fails, the join is wrong
and this task is not done — the helper is the thing being relied on.

- [ ] **Step 4: Collapse the reports loop**

`src-tauri/src/database/domains/reports.rs` — the inner
`for acc_id in &account_ids { ... }` loop that follows the
`format!("{:04}-{:02}", cur_year, cur_month_i)` line. It is the loop whose body
opens with the signed-balance CASE at `reports.rs:613-625`; match on that, since
Task 17 shifted the surrounding lines. Replace the whole loop (everything from
`let mut net_worth: i64 = 0;` through the closing brace after the `net_worth +=
balance;`) with:

```rust
        // One query per month instead of one per account per month.
        let net_worth = balance::net_worth_as_of(conn, &end_date)?;
```

Delete the now-unused `account_ids` fetch if nothing else uses it. Add
`use super::balance;` to the file's imports if it is not already there.

- [ ] **Step 5: Collapse the goal path**

`src-tauri/src/database/domains/goals.rs` — the `GoalType::NetWorth` arm of
`enrich_goal`, the branch that currently fetches every live account id and sums
`get_balance` over them:

```rust
    let current_amount = if goal.goal_type == GoalType::NetWorth {
        balance::net_worth_as_of(conn, &civil_date::today_iso())?
    } else {
```

Delete the id-fetch and the accumulation loop. Leave the `else` arm alone — Task
17 already rewired it to `balance::account_balance_as_of` and it is correct. Do
not look for a `get_balance` to delete here: Task 17 removed it. Add
`use super::{balance, civil_date};` is already there from Task 17 — use it. Do not
re-add an import of `accounts::today_iso`: Task 17 removed that line and the bare
`today_iso()` would no longer resolve.

- [ ] **Step 6: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS. The four existing net-worth tests named in Step 2 are the real
check — they assert exact figures, and if the single-query helper disagrees with
the loop it replaces, they move. Step 2's equivalence test is the one that
isolates *which* case broke: a plain transfer between live accounts nets to zero
under the join, and a transfer into a deleted account still counts its source.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/database/domains/reports.rs src-tauri/src/database/domains/goals.rs src-tauri/tests/domain_transactions_bulk.rs
git commit -m "perf: collapse the net-worth N+1 loops

S4. get_net_worth_series ran one query per account per month and
enrich_goal ran one per account, so a 50-account history over 60 months
issued 3,000 queries for a sum. Both use the single-query helper.

The join counts a row once per live account it touches, which reproduces
the loop exactly: a transfer between two live accounts nets to zero, and
a transfer into a deleted account still counts its source side."
```

---

## Verification

**Run `pnpm check` before `pnpm test` on a fresh checkout.** `src/lib/paraglide/`
is gitignored and the compile is wired into `dev`, `build`, and `check` — but
**not** into `test`. A clean clone that goes straight to `pnpm test` has no
`$lib/paraglide/messages`, and the component tests fail on a missing module
rather than on anything this phase touched. `pnpm check` runs the compile as a
side effect.

At review time `pnpm check` is green (0 errors, 3 pre-existing `@apply` CSS
warnings in `quick-add/+page.svelte`), so any error it reports after Stage 0
starts is new.

- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` — PASS
- [ ] `pnpm test` — PASS
- [ ] `pnpm check` — PASS
- [ ] `pnpm check:db-contracts` — PASS
- [ ] `pnpm vitest run src/tests/unit/native-boundary.test.ts` — PASS, and it fails again if any single command is removed from `generate_handler!` (verified in Task 2's red state)
- [ ] `pnpm test:e2e` — PASS
- [ ] Manual: `pnpm tauri dev`, open the dashboard, confirm the "Frequent transactions" strip renders
- [ ] Manual: bulk delete, bulk retag, and bulk move on the transactions page each take effect and survive a reload
- [ ] Manual: attempt to delete an account linked to a goal — the message names the goal, in the active locale
- [ ] Manual: write off a loan with no tag chosen — it succeeds and the transaction carries the Loss tag

**What the manual steps are for.** The first three are the only checks that the
native path actually runs, because `pnpm test:e2e` exercises the `sql.js`
browser fallback behind `isTauri()`, not Rust. That is also why C1's four
commands would have passed E2E while being absent on desktop — the mock answers
for them. Do not read a green `pnpm test:e2e` as coverage of Stage 0 or Stage 1.

---

## Self-review

**Spec coverage.** Every defect in spec §2 has a task, and every stage in §3
has a stage here.

| Spec | Task | Gate |
|---|---|---|
| §3 Stage 0 — Gate 1 (command surface) | 1, 2 | fails in Task 2, green in Task 11 |
| §3 Stage 0 — Gate 2 (error parity) | 3 | conditional, proven in Task 3 Step 7 |
| §2 C1 — four missing commands | 9, 10, 11 | Gate 1 |
| §2 C2 — duplicate `SET` | 4 | |
| §2 C3 — write-off tag | 5 | |
| §2 I1 — dropped `bucket_id` | 12 | |
| §2 I2 — restore guard | 7 | |
| §2 I3 — linked-goal envelope | 13 | Gate 2 |
| §2 I4 — malformed month | 8 | |
| §2 I5 — money bound | 6 | |
| §2 I6 — control-char divergence | 14 | |
| §2 S1 — balance + date duplication | 17, 18 | |
| §2 S2 — spending predicate duplication | 16 | |
| §2 S3 — dead native stub | 15 | |
| §2 S4 — net-worth N+1 | 18 | |
| §4 — reference SQL for `get_frequent` | 9 | |
| §5 — idempotency seam out of scope | Global Constraints | |
| §6 — verification | Verification section | |
| §9 — Stage 3 is the cut line | Stage 3 preamble | |

Spec §7 (the `2026-08-17` boundary spec's transfer-model wording) is **not a
task** — that correction was made and committed alongside the spec itself.
Nothing here depends on it.

**Known ordering constraints.** Task 18 cannot run without Task 17; Task 14
uses `no_patch()` from Task 4; Tasks 12 and 18 use the test helpers introduced in
Task 9. Task 17's and Task 18's tests call `accounts::today_iso()`, which Task 12
widens from `pub(crate)` to `pub` — so **Task 12 must precede both**, even though
it belongs to a different stage. The task order above satisfies all four.

**Placeholder scan.** No "TBD", no "add appropriate error handling", no "similar
to Task N". Two steps tell the implementer to check a real symbol before writing
against it — `TrendPoint`'s field names (Task 12) and whether
`generated/contracts` can own `ErrorCodeValues` (Task 3). Each names the file to
read and the decision to make; neither is a stand-in for code the plan should
have written. Every other step carries its code in full, including the four
copies of the Hinnant block that Task 17 replaces — those are quoted from the
tree, not paraphrased.

**Type consistency.** Checked across tasks: `write_off`'s `tag_id: Option<String>`
(Task 5) matches its command wrapper and the client's `tagId ?? null`;
`get_trend`'s fourth `bucket_id: Option<&str>` (Task 12) matches its command
wrapper's `bucket_id.as_deref()` and the test's `None` / `Some("bucket_adjustments")`;
`net_worth_as_of(conn, as_of)` and `account_balance_as_of(conn, account_id, as_of)`
(Task 17) are called with those shapes in Task 18; `ErrorCode::ALL` is 17 long
in Task 3 and must become 18 in Task 13, which Task 13 states.

**One thing this plan does not do.** It never runs the idempotency seam. Every
mutation here goes through `run_idempotent` because that is the house pattern,
but `commands.rs` still generates the operation ID itself, so the receipts table
protects nothing. That is spec §5's deliberate deferral, not an oversight.


