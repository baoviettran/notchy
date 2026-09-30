/**
 * Guards the class, not the instance: a page must reach the database through
 * the domain port. The escape hatch (`db.raw`) exists only on the browser
 * client, so any page that uses it works in Playwright and dies on the desktop
 * build — which is exactly how Settings -> Backup & Data shipped broken.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUTES = fileURLToPath(new URL('../../routes', import.meta.url));

// The handle shape, not the substring: `row.raw` (CSV row data) is legitimate.
const FORBIDDEN = [/(db|database)\s+as\s+unknown\s+as\s*\{\s*raw\s*:/, /\bgetRawDb\b/];

function filesUnder(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		return statSync(path).isDirectory() ? filesUnder(path) : [path];
	});
}

describe('no route reads a raw database handle', () => {
	it('finds no escape-hatch usage under src/routes', () => {
		const offenders = filesUnder(ROUTES).flatMap((path) => {
			const source = readFileSync(path, 'utf-8');
			return FORBIDDEN.filter((pattern) => pattern.test(source)).map(
				(pattern) => `${path}: ${pattern}`
			);
		});

		expect(offenders).toEqual([]);
	});
});
