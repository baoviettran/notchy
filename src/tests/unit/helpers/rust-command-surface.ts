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
