/**
 * Characterization tests for src/lib/logic/db-boot.ts.
 *
 * Green-first extraction from stores/db.svelte.ts: these pin the pure boot
 * decision logic (DatabaseStatus -> store-renderable RecoveryInfo / stage)
 * that used to live inline inside $state() runes where Istanbul could not
 * measure it. Behavior is locked exactly as the store behaved before the
 * refactor, including the "unknown stage leaves the stage unchanged" rule.
 */
import { describe, it, expect } from 'vitest';
import type { DatabaseStatus, BackupSummary } from '$lib/db/native/client';
import {
	statusToRecovery,
	fallbackRecovery,
	startupStageFromStatus,
	type RecoveryInfo,
} from '$lib/logic/db-boot';

function status(overrides: Partial<DatabaseStatus> = {}): DatabaseStatus {
	return {
		lifecycle: 'ready',
		stage: null,
		recovery: null,
		backups: [],
		...overrides,
	};
}

const backups: BackupSummary[] = [
	{
		id: 'b1',
		path: '/data/backups/upgrade.zip',
		schema_version: 4,
		source_app_version: '0.1.0',
		created_at: '2026-01-01T00:00:00Z',
		verified: true,
	},
];

describe('startupStageFromStatus', () => {
	it('maps the checking sub-stage to "checking"', () => {
		expect(startupStageFromStatus(status({ stage: 'checking' }))).toBe('checking');
	});

	it('maps the backing_up sub-stage to "backing_up"', () => {
		expect(startupStageFromStatus(status({ stage: 'backing_up' }))).toBe('backing_up');
	});

	it('maps the migrating sub-stage to "migrating"', () => {
		expect(startupStageFromStatus(status({ stage: 'migrating' }))).toBe('migrating');
	});

	it('maps the verifying sub-stage to "verifying"', () => {
		expect(startupStageFromStatus(status({ stage: 'verifying' }))).toBe('verifying');
	});

	it('returns null for an unknown/null stage so the store leaves it unchanged (byte-identical to the pre-refactor if/else that assigned nothing)', () => {
		expect(startupStageFromStatus(status({ stage: 'bogus' }))).toBeNull();
		expect(startupStageFromStatus(status({ stage: null }))).toBeNull();
	});

	it('is insensitive to lifecycle/recovery — it only reads the stage sub-field', () => {
		// Even in the 'ready' lifecycle, the extracted function reports a stage
		// truthfully; the STORE decides that 'ready' wins via its own branches.
		expect(startupStageFromStatus(status({ lifecycle: 'ready', stage: 'migrating' }))).toBe('migrating');
	});
});

describe('statusToRecovery', () => {
	it('returns null when status.recovery is absent', () => {
		expect(statusToRecovery(status({ recovery: null }), backups)).toBeNull();
	});

	it('maps the recovery code and picks backupPath from the newest backup', () => {
		const rec = statusToRecovery(
			status({
				recovery: { code: 'schema_migration_failed', retryable: true },
			}),
			backups
		);
		expect(rec).toMatchObject({
			code: 'schema_migration_failed',
			backupPath: '/data/backups/upgrade.zip',
			detectedSchemaVersion: null,
			liveDatabasePath: 'unknown',
			appVersion: 'unknown',
		});
		expect(typeof rec?.latestSchemaVersion).toBe('number');
	});

	it('sets backupPath to null when there is no latest backup', () => {
		const rec = statusToRecovery(
			status({ recovery: { code: 'database_corrupt', retryable: false } }),
			[]
		);
		expect(rec?.backupPath).toBeNull();
	});

	it('maps a recovery into a fully-populated RecoveryInfo', () => {
		const rec = statusToRecovery(
			status({ recovery: { code: 'verification_failed', retryable: false } }),
			backups
		) as RecoveryInfo;
		expect(rec).toEqual({
			code: 'verification_failed',
			appVersion: 'unknown',
			latestSchemaVersion: rec.latestSchemaVersion,
			detectedSchemaVersion: null,
			liveDatabasePath: 'unknown',
			backupPath: '/data/backups/upgrade.zip',
			detail: '',
		});
	});
});

describe('fallbackRecovery', () => {
	it('maps any startup error to a stable database_corrupt recovery and stringifies the error into detail', () => {
		const rec = fallbackRecovery(new Error('boom'));
		expect(rec.code).toBe('database_corrupt');
		expect(rec.detail).toContain('boom');
		expect(rec).toMatchObject({
			appVersion: 'unknown',
			detectedSchemaVersion: null,
			liveDatabasePath: 'unknown',
			backupPath: null,
		});
		expect(typeof rec.latestSchemaVersion).toBe('number');
	});

	it('handles non-Error throws (plain values) without crashing', () => {
		const rec = fallbackRecovery('some string error');
		expect(rec.detail).toBe('some string error');
	});
});