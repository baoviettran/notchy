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
 * The client side is parsed here too ({@link invokeSites}): the table can only
 * catch a command it already lists, so the direction that catches a *de*
 * registered command is a scan of the `invoke()` call sites themselves.
 *
 * Every failure mode throws. A scan that degrades to an empty set is exactly
 * how the §8 miscounts happened; an empty or partial set must never read as a
 * passing assertion.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export interface RustCommand {
	name: string;
	/** Declared parameter names, in order, excluding Tauri-injected ones. */
	params: string[];
	/**
	 * The command body, braces excluded. Declared params are searched against
	 * this: a param the body never names is a value the client sends and Rust
	 * discards.
	 */
	body: string;
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

/**
 * Index just past the `)` that closes the parameter list opened at
 * `openParen`. Same balance scan as `paramsFrom`, but it keeps the position so
 * the body can be located after it.
 */
function paramsEnd(source: string, openParen: number): number {
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
	return i;
}

/**
 * The `{...}` body that follows `after`, braces excluded. Braces are matched,
 * so a nested block, closure or macro invocation stays inside the body; a
 * truncated body would read as "the param is unused" and fail the wrong way.
 */
function bodyFrom(source: string, after: number): string {
	const open = source.indexOf('{', after);
	if (open === -1) {
		throw new Error('no body brace after a #[tauri::command] signature');
	}
	let depth = 0;
	for (let i = open; i < source.length; i += 1) {
		if (source[i] === '{') depth += 1;
		else if (source[i] === '}') {
			depth -= 1;
			if (depth === 0) return source.slice(open + 1, i);
		}
	}
	throw new Error('unbalanced braces in a #[tauri::command] body');
}

/** Every `#[tauri::command]` fn in one source text, keyed by name. */
function commandSignaturesIn(source: string): Map<string, RustCommand> {
	const found = new Map<string, RustCommand>();
	const pattern =
		/#\[tauri::command\][\s\S]*?\bfn\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\s*\(/g;

	let match: RegExpExecArray | null;
	while ((match = pattern.exec(source)) !== null) {
		const name = match[1];
		if (found.has(name)) {
			throw new Error(`duplicate #[tauri::command] signature for ${name}`);
		}
		const openParen = match.index + match[0].length - 1;
		const end = paramsEnd(source, openParen);
		found.set(name, {
			name,
			params: paramsFrom(source, openParen),
			body: bodyFrom(source, end),
		});
	}
	return found;
}

/** Every `#[tauri::command]` fn in the tree, keyed by name. */
export function parseCommandSignatures(srcRoot: string): Map<string, RustCommand> {
	const found = new Map<string, RustCommand>();

	for (const file of rustSources(srcRoot)) {
		const source = stripLineComments(readFileSync(file, 'utf8'));
		for (const [name, command] of commandSignaturesIn(source)) {
			if (found.has(name)) {
				throw new Error(`duplicate #[tauri::command] signature for ${name}`);
			}
			found.set(name, command);
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

export interface UnusedParam {
	command: string;
	param: string;
}

/**
 * A name can only be a Rust identifier, but it reaches a RegExp raw, so the
 * metacharacters are escaped rather than trusted.
 */
function escapeForRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Declared, non-injected parameters the command's own body never references:
 * the client sends the key, Rust binds it, and the value is dropped.
 *
 * This is the complement to `camelCase()`'s underscore stripping. `_bucket_id`
 * normalizes to `bucketId` on the wire, so the wire-key check sees a key the
 * client sends and passes — the leading underscore, the only evidence the
 * binding was never wanted, is normalized away before the check runs. I1 lived
 * inside that rule. Searching the body for the name *as written* is the only
 * check that can see it.
 *
 * The match is word-bounded, so `bucket_id` is not satisfied by
 * `bucket_id_cached`, and it is a substring search, so it cannot tell a
 * parameter from a same-named local: a body that shadows its parameter is not
 * flagged. That false negative is accepted — the rule errs toward passing.
 * Same for a name that appears only in a block comment: `stripLineComments`
 * removes line comments, not `/*` blocks, so such a name reads as a use.
 *
 * `input` is a raw source text (how the synthetic tests plant a defect without
 * touching `commands.rs`) or a loaded surface (the real tree).
 * Throws when there is nothing to check: an empty scan must never read as a
 * clean bill of health.
 */
export function unusedCommandParams(input: string | CommandSurface): UnusedParam[] {
	const commands = typeof input === 'string' ? commandSignaturesIn(input) : input.commands;
	if (commands.size === 0) {
		throw new Error('no #[tauri::command] signatures to check for unused parameters');
	}

	const offenders: UnusedParam[] = [];
	for (const command of commands.values()) {
		for (const param of command.params) {
			if (!new RegExp(`\\b${escapeForRegex(param)}\\b`).test(command.body)) {
				offenders.push({ command: command.name, param });
			}
		}
	}
	return offenders;
}

/** A production `invoke()` call site, resolved to the command it sends. */
export interface InvokeSite {
	command: string;
	/** Path relative to the repo root, so a failure names the site. */
	file: string;
	line: number;
}

/**
 * Directories that hold no production invoke site: `src/tests` is fixtures
 * (scanning it would grade the scan against its own inputs), and `paraglide` is
 * generated and gitignored — a site found there could not be fixed by editing.
 */
const NOT_PRODUCTION = /^(?:src\/tests\/)|(?:^|\/)paraglide\//;

/** TypeScript and Svelte sources under `dir`; a `.ts`-only pass misses `quit_app`. */
function tsSources(dir: string, root: string, out: string[] = []): string[] {
	if (!existsSync(dir)) {
		throw new Error(`production source directory not found: ${dir}`);
	}
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (NOT_PRODUCTION.test(`${relative(root, full)}/`)) continue;
			tsSources(full, root, out);
		} else if (/\.(ts|svelte)$/.test(entry.name)) {
			out.push(full);
		}
	}
	return out;
}

function skipBlanks(source: string, from: number): number {
	let i = from;
	while (i < source.length && /\s/.test(source[i])) i += 1;
	return i;
}

function lineAt(source: string, index: number): number {
	let line = 1;
	for (let i = 0; i < index; i += 1) {
		if (source[i] === '\n') line += 1;
	}
	return line;
}

/** Index just past the `>` that closes the type arguments opened at `open`. */
function afterTypeArgs(source: string, open: number, file: string, at: number): number {
	let depth = 0;
	for (let i = open; i < source.length; i += 1) {
		const ch = source[i];
		// A function type's `=>` is not a closing angle bracket.
		if (ch === '=' && source[i + 1] === '>') {
			i += 1;
			continue;
		}
		if (ch === '<') depth += 1;
		else if (ch === '>') {
			depth -= 1;
			if (depth === 0) return i + 1;
		}
	}
	throw new Error(`unbalanced type arguments in invoke<...> at ${file}:${lineAt(source, at)}`);
}

/**
 * Every command one source text invokes, with its position.
 *
 * Fails closed. An `invoke()` whose first argument is not a string literal is a
 * name this scan cannot read, so it throws rather than dropping the site. The
 * two things read as "not a call site" are structural, never name-based: a
 * declaration (`function invoke<T>(`), and an empty argument list — the shape
 * the prose in `db/client.ts`, `db/index.ts` and `db/native/client.ts` has.
 */
function invokeSitesIn(source: string, file: string): InvokeSite[] {
	const sites: InvokeSite[] = [];
	for (const match of source.matchAll(/\binvoke\b/g)) {
		const start = match.index;
		if (/\bfunction\s+$/.test(source.slice(0, start))) continue;

		let cursor = skipBlanks(source, start + match[0].length);
		if (source[cursor] === '<') {
			cursor = skipBlanks(source, afterTypeArgs(source, cursor, file, start));
		}
		if (source[cursor] !== '(') continue;

		cursor = skipBlanks(source, cursor + 1);
		const quote = source[cursor];
		if (quote !== "'" && quote !== '"' && quote !== '`') {
			if (quote === ')') continue;
			throw new Error(
				`invoke() whose command name is not a string literal at ${file}:${lineAt(source, start)}`
			);
		}
		const close = source.indexOf(quote, cursor + 1);
		if (close === -1) {
			throw new Error(`unterminated command name at ${file}:${lineAt(source, start)}`);
		}
		const command = source.slice(cursor + 1, close);

		// Tauri's own APIs are namespaced (`plugin:sql|execute`,
		// `core:event|listen`) and registered by their plugin, not by this app's
		// `generate_handler!`. This app's surface is the bare snake_case form.
		// Anything else is a shape the scan does not know, so it throws.
		if (command.includes(':')) continue;
		if (!/^[a-z][a-z0-9_]*$/.test(command)) {
			throw new Error(
				`unrecognised invoke() target "${command}" at ${file}:${lineAt(source, start)}`
			);
		}
		sites.push({ command, file, line: lineAt(source, start) });
	}
	return sites;
}

/**
 * Every app command the production sources invoke, in walk order. Throws when
 * the scan finds nothing: an empty set must never read as a clean bill of
 * health.
 */
export function invokeSites(repoRoot: string = process.cwd()): InvokeSite[] {
	const root = resolve(repoRoot);
	const srcRoot = resolve(root, 'src');

	const sites: InvokeSite[] = [];
	for (const file of tsSources(srcRoot, root)) {
		const source = stripLineComments(readFileSync(file, 'utf8'));
		sites.push(...invokeSitesIn(source, relative(root, file)));
	}
	if (sites.length === 0) {
		throw new Error(`no invoke() call sites found under ${srcRoot}`);
	}
	return sites;
}
