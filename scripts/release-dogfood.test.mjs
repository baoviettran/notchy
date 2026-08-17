// scripts/release-dogfood.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertVersionsMatch, artifactNames, checksumLine, sha256File, readDeclaredVersions, assertClean, RELEASE_GATE_ORDER } from './release-dogfood.mjs';

test('requires package, Tauri, and Cargo versions to match', () => {
	assert.throws(() => assertVersionsMatch({ package: '0.1.4', tauri: '0.1.4', cargo: '0.1.3' }), /version mismatch/);
});

test('uses deterministic Debian artifact names', () => {
	assert.deepEqual(artifactNames('0.2.0', 'amd64'), {
		deb: 'notchy_0.2.0_amd64.deb', checksum: 'notchy_0.2.0_amd64.deb.sha256'
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

test('checksumLine references the repo-root-relative artifact path', () => {
	const hash = '7acd3aa391384370d8cbb77c75b28600979ad9760fd612eb50f5a9e96388508a';
	assert.equal(
		checksumLine('0.2.0', 'amd64', hash),
		`${hash}  artifacts/0.2.0/notchy_0.2.0_amd64.deb\n`
	);
});

test('readDeclaredVersions reports 0.2.0 in every declaration', () => {
	assert.deepEqual(readDeclaredVersions(), { package: '0.2.0', tauri: '0.2.0', cargo: '0.2.0' });
});

test('rejects an untracked source file but allows explicit environment outputs', () => {
	assert.throws(() => assertClean([{ path: 'src/untracked.ts', status: '??' }]), /untracked source/);
	assert.doesNotThrow(() => assertClean([
		{ path: '.codegraph/daemon.sock', status: '??' },
		{ path: 'artifacts/0.2.0/notchy.deb', status: '??' }
	]));
});

test('rejects tracked modifications at release start', () => {
	assert.throws(() => assertClean([{ path: 'src/app.ts', status: ' M' }]), /tracked modification/);
	assert.throws(() => assertClean([{ path: 'package.json', status: 'M ' }]), /tracked modification/);
	assert.throws(() => assertClean([{ path: 'src/main.rs', status: 'MM' }]), /tracked modification/);
});

test('allows only exact allowed prefixes for untracked paths', () => {
	// Allowed prefixes
	assert.doesNotThrow(() => assertClean([{ path: '.codegraph/index.db', status: '??' }]));
	assert.doesNotThrow(() => assertClean([{ path: 'artifacts/0.2.0/notchy.deb', status: '??' }]));
	assert.doesNotThrow(() => assertClean([{ path: 'build/index.html', status: '??' }]));
	assert.doesNotThrow(() => assertClean([{ path: '.svelte-kit/output', status: '??' }]));
	assert.doesNotThrow(() => assertClean([{ path: 'src-tauri/target/release', status: '??' }]));
	assert.doesNotThrow(() => assertClean([{ path: 'reports/mutation/mutation.html', status: '??' }]));

	// Reject paths that don't match allowed prefixes
	assert.throws(() => assertClean([{ path: '.env.local', status: '??' }]), /untracked source/);
	assert.throws(() => assertClean([{ path: 'node_modules/package', status: '??' }]), /untracked source/);
	assert.throws(() => assertClean([{ path: 'tmp/debug.log', status: '??' }]), /untracked source/);
});

test('allows clean tree with no entries', () => {
	assert.doesNotThrow(() => assertClean([]));
});

test('RELEASE_GATE_ORDER defines the correct gate sequence', () => {
	assert.deepEqual(RELEASE_GATE_ORDER, [
		'check:native-db-cutover',
		'check:db-contracts',
		'cargo test',
		'pnpm check',
		'pnpm test',
		'pnpm test:e2e',
		'pnpm test:mutation:db',
		'pnpm build',
		'cargo check',
		'git diff --check'
	]);
});
