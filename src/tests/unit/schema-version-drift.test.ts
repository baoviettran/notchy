/**
 * Schema-version call-site drift guard.
 *
 * When a migration bumps LATEST_SCHEMA_VERSION, every hardcoded "latest schema"
 * literal in the E2E fixture must track it — the failure class that "silently
 * broke E2E" (the v005-vs-v006 divergence). The live app derives its version from
 * the migration registry, so the risk lives in literals that assume a concrete
 * number. This test statically scans the one E2E fixture that owns such literals
 * and asserts each equals the registry's derived version. A bump that leaves a
 * literal stale here stays RED instead of breaking E2E mid-run.
 *
 * Scoped to tauri-mock.ts deliberately: other files' `schema_version`, 'N'`
 * inserts represent intentionally NEWER (rejection-test) or legacy versions, not
 * "the latest", so a blanket scan would false-positive on them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LATEST_SCHEMA_VERSION } from '$lib/db/migrations/index';

const MOCK_PATH = fileURLToPath(new URL('../e2e/fixtures/tauri-mock.ts', import.meta.url));

describe('schema-version call-site drift', () => {
	it('the E2E mock\'s `const LATEST` tracks the migration registry version', () => {
		const src = readFileSync(MOCK_PATH, 'utf8');
		const match = src.match(/const LATEST = (\d+);/);
		expect(match, 'tauri-mock must declare const LATEST = <version>').toBeTruthy();
		expect(Number(match![1])).toBe(LATEST_SCHEMA_VERSION);
	});

	it('every hardcoded schema_version insert in the E2E mock equals the registry version', () => {
		const src = readFileSync(MOCK_PATH, 'utf8');
		const inserts = [...src.matchAll(/schema_version', '(\d+)'/g)].map((m) => Number(m[1]));
		expect(inserts.length).toBeGreaterThan(0);
		for (const literal of inserts) {
			expect(literal).toBe(LATEST_SCHEMA_VERSION);
		}
	});
});