// scripts/release-dogfood.mjs
//
// Reproducible Ubuntu dogfood release lane. Guards a Tauri `.deb` build behind
// a clean working tree, the full test suite, and a type check, then copies the
// single built artifact to artifacts/<version>/ with a deterministic lowercase
// name and a `sha256sum -c`-compatible checksum file.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEB_BUNDLE_DIR = path.join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'deb');

export function readDeclaredVersions() {
	const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
	const tauriConf = JSON.parse(readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
	const cargoText = readFileSync(path.join(ROOT, 'src-tauri', 'Cargo.toml'), 'utf8');
	const cargoVersion = cargoText.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
	return {
		package: packageJson.version,
		tauri: tauriConf.version,
		cargo: cargoVersion,
	};
}

export function assertVersionsMatch(versions) {
	const entries = [
		['package.json', versions.package],
		['tauri.conf.json', versions.tauri],
		['Cargo.toml', versions.cargo],
	];
	const first = entries[0][1];
	const mismatches = entries.filter(([, value]) => value !== first);
	if (mismatches.length > 0) {
		const details = entries.map(([name, value]) => `${name} declares ${value}`).join(', ');
		throw new Error(`version mismatch: ${details}`);
	}
}

export function artifactNames(version, arch) {
	return {
		deb: `notchy_${version}_${arch}.deb`,
		checksum: `notchy_${version}_${arch}.deb.sha256`,
	};
}

export async function sha256File(filePath) {
	const data = await readFile(filePath);
	return createHash('sha256').update(data).digest('hex');
}

/**
 * Compose the `sha256sum -c`-compatible checksum line. The referenced path is
 * repo-root-relative (`artifacts/<version>/<deb>`), so the documented
 * `sha256sum -c artifacts/<version>/<deb>.sha256` verification works from the
 * repository root regardless of the caller's cwd.
 */
export function checksumLine(version, arch, hash) {
	const { deb } = artifactNames(version, arch);
	return `${hash}  ${path.posix.join('artifacts', version, deb)}\n`;
}

function run(command, args) {
	const result = spawnSync(command, args, { stdio: 'inherit' });
	if (result.status !== 0) {
		if (result.error) {
			console.error(`failed to launch ${command}: ${result.error.message}`);
		}
		process.exit(result.status ?? 1);
	}
}

async function locateDeb(version) {
	let entries = [];
	try {
		entries = await readdir(DEB_BUNDLE_DIR);
	} catch (error) {
		if (error.code === 'ENOENT') {
			throw new Error(`no .deb artifacts found: ${DEB_BUNDLE_DIR} does not exist`);
		}
		throw error;
	}
	const debs = entries.filter((name) => name.endsWith('.deb'));
	if (debs.length !== 1) {
		throw new Error(`expected exactly one .deb under ${DEB_BUNDLE_DIR}, found ${debs.length}: ${debs.join(', ') || 'none'}`);
	}
	const filename = debs[0];
	const archMatch = filename.match(/_([^_]+)\.deb$/);
	const arch = archMatch ? archMatch[1] : 'amd64';
	const names = artifactNames(version, arch);
	return { sourcePath: path.join(DEB_BUNDLE_DIR, filename), names, arch };
}

async function main() {
	const versions = readDeclaredVersions();
	assertVersionsMatch(versions);
	const version = versions.package;

	run('git', ['diff', '--quiet']);
	run('git', ['diff', '--cached', '--quiet']);
	run('pnpm', ['test']);
	run('pnpm', ['check']);
	run('pnpm', ['tauri', 'build', '--bundles', 'deb']);

	const { sourcePath, names, arch } = await locateDeb(version);
	const artifactsDir = path.join(ROOT, 'artifacts', version);
	await mkdir(artifactsDir, { recursive: true });

	const debPath = path.join(artifactsDir, names.deb);
	await copyFile(sourcePath, debPath);

	const checksumPath = path.join(artifactsDir, names.checksum);
	const hash = await sha256File(debPath);
	await writeFile(checksumPath, checksumLine(version, arch, hash));

	console.log(debPath);
	console.log(checksumPath);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}
