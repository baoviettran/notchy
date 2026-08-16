// scripts/release-dogfood.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertVersionsMatch, artifactNames, sha256File, readDeclaredVersions } from './release-dogfood.mjs';

test('requires package, Tauri, and Cargo versions to match', () => {
	assert.throws(() => assertVersionsMatch({ package: '0.1.4', tauri: '0.1.4', cargo: '0.1.3' }), /version mismatch/);
});

test('uses deterministic Debian artifact names', () => {
	assert.deepEqual(artifactNames('0.1.4', 'amd64'), {
		deb: 'notchy_0.1.4_amd64.deb', checksum: 'notchy_0.1.4_amd64.deb.sha256'
	});
});

test('sha256File returns the SHA-256 hex digest of a file', async () => {
	const dir = await mkdtemp(path.join(tmpdir(), 'notchy-release-'));
	const file = path.join(dir, 'sample.bin');
	const content = 'release tooling sha256 round-trip\n';
	await writeFile(file, content);
	try {
		const digest = await sha256File(file);
		assert.equal(digest, createHash('sha256').update(content).digest('hex'));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test('readDeclaredVersions reports 0.1.4 in every declaration', () => {
	assert.deepEqual(readDeclaredVersions(), { package: '0.1.4', tauri: '0.1.4', cargo: '0.1.4' });
});
