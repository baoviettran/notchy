import type { DatabaseService } from '$lib/db/browser/service';
import type { AppDatabase } from '$lib/db/client';
import { BrowserDatabaseClient } from '$lib/db/browser/client';
import { InMemoryDatabase, createInMemoryDbFromBytes } from '$lib/db/browser/in-memory';
import { inspectSchema } from '$lib/db/browser/schema';
import { runIntegrityCheck } from '$lib/db/browser/integrity';
import { migrations, LATEST_SCHEMA_VERSION, MIN_SUPPORTED_SCHEMA_VERSION } from '$lib/db/browser/migrations';
import { runMigrations } from '$lib/db/browser/migrations/runner';
import { ulid } from '$lib/utils/id';
import { assertCurrentSession } from './session';
import type { ProfilePort } from './port';
import type { AppPreferences, BackupSummary, DeleteResult, OperationContext, ProfileRecord, ProfileSession, ProfileSnapshot, ProfileStoragePaths, RestorePreview } from './types';

type Slot = { record: ProfileRecord; db: DatabaseService; client: BrowserDatabaseClient; backups: Uint8Array[] };
type Preview = { bytes: Uint8Array; suggestedName: string };
export interface BrowserProfileDependencies {
	createDatabase: () => Promise<DatabaseService>;
	exportSnapshot?: (db: DatabaseService) => Promise<Uint8Array>;
	importSnapshot?: (bytes: Uint8Array) => Promise<DatabaseService>;
	readSnapshot?: (path: string) => Promise<Uint8Array>;
	writeSnapshot?: (path: string, bytes: Uint8Array) => Promise<void>;
}
function validName(input: string): string {
	const name = input.trim();
	if (!name || Array.from(name).length > 80 || Array.from(name).some((char) => /[\u0000-\u001f\u007f]/u.test(char))) throw new Error('invalid profile name');
	return name;
}
function unavailable(): never { throw new Error('snapshot operation unavailable'); }

export class BrowserProfilePort implements ProfilePort {
	private slots = new Map<string, Slot>();
	private previews = new Map<string, Preview>();
	private files = new Map<string, Uint8Array>();
	private receipts = new Map<string, { name: string; record: ProfileRecord }>();
	private current: ProfileSession | null = null;
	private preferences: AppPreferences = { locale: 'en', theme: 'light' };
	constructor(private readonly dependencies: BrowserProfileDependencies) {}
	async load(): Promise<ProfileSnapshot> {
		return { profiles: [...this.slots.values()].map((slot) => slot.record), active: this.current, phase: 'idle', preferences: this.preferences, recovery: null };
	}
	async paths(id: string): Promise<ProfileStoragePaths> {
		this.slot(id);
		const dataDir = `/web/profiles/${id}`;
		return { dataDir, databasePath: `${dataDir}/notchy.db`, routineBackupDir: `${dataDir}/backups`, upgradeBackupDir: `${dataDir}/backups/upgrades`, resetBackupDir: `${dataDir}/backups/resets` };
	}
	async backups(id: string): Promise<BackupSummary[]> {
		return this.slot(id).backups.map((_, index) => ({ id: String(index), path: `memory:${id}:${index}`, schema_version: LATEST_SCHEMA_VERSION, source_app_version: 'browser', created_at: new Date().toISOString(), verified: true }));
	}
	async create(name: string, context: OperationContext): Promise<ProfileRecord> {
		name = validName(name);
		const receipt = this.receipts.get(context.operationId);
		if (receipt) { if (receipt.name !== name) throw new Error('operation conflict'); return receipt.record; }
		const db = await this.dependencies.createDatabase();
		const record = { id: ulid(), name, createdAt: new Date().toISOString() };
		this.slots.set(record.id, { record, db, client: new BrowserDatabaseClient(db), backups: [] });
		this.receipts.set(context.operationId, { name, record });
		return record;
	}
	async rename(id: string, name: string): Promise<ProfileRecord> {
		const slot = this.slot(id);
		slot.record = { ...slot.record, name: validName(name) };
		return slot.record;
	}
	async activate(id: string, _transitionToken: string | null): Promise<ProfileSession> {
		this.slot(id);
		this.current = { profileId: id, generation: ulid() };
		return this.current;
	}
	private async snapshot(db: DatabaseService): Promise<Uint8Array> {
		if (this.dependencies.exportSnapshot) return this.dependencies.exportSnapshot(db);
		if (db instanceof InMemoryDatabase) return db.exportBytes();
		return unavailable();
	}
	async backup(id: string): Promise<string> {
		const slot = this.slot(id);
		slot.backups.push(await this.snapshot(slot.db));
		return `memory:${id}:${slot.backups.length - 1}`;
	}
	async exportBackup(id: string, targetPath: string): Promise<void> {
		const bytes = await this.snapshot(this.slot(id).db);
		if (this.dependencies.writeSnapshot) await this.dependencies.writeSnapshot(targetPath, bytes);
		else this.files.set(targetPath, bytes.slice());
	}
	async inspectRestore(sourcePath: string): Promise<RestorePreview> {
		const bytes = this.dependencies.readSnapshot ? await this.dependencies.readSnapshot(sourcePath) : this.files.get(sourcePath);
		if (!bytes) unavailable();
		if (bytes.length < 16 || String.fromCharCode(...bytes.slice(0, 16)) !== 'SQLite format 3\0') throw new Error('invalid backup');
		const candidate = await this.importBytes(bytes);
		let schemaVersion: number;
		let sourceName: string | null;
		try {
			const inspection = await inspectSchema(candidate, LATEST_SCHEMA_VERSION);
			if (inspection.kind !== 'older' && inspection.kind !== 'current') throw new Error('incompatible backup');
			if (inspection.version < MIN_SUPPORTED_SCHEMA_VERSION) throw new Error('backup too old');
			await runIntegrityCheck(candidate);
			schemaVersion = inspection.version;
			sourceName = (await candidate.query<{ value: string }>("SELECT value FROM app_meta WHERE key = 'profile_display_name'"))[0]?.value ?? null;
		} finally { await candidate.close(); }
		const token = ulid();
		const baseName = validName(sourceName || sourcePath.split('/').pop()?.replace(/\.sqlite$/u, '') || 'Recovered profile');
		let suggestedName = baseName;
		for (let suffix = 2; [...this.slots.values()].some((slot) => slot.record.name === suggestedName); suffix++) {
			suggestedName = `${Array.from(baseName).slice(0, 80 - String(suffix).length - 3).join('')} (${suffix})`;
		}
		this.previews.set(token, { bytes: bytes.slice(), suggestedName });
		return { token, suggestedName, schemaVersion };
	}
	async cancelRestore(token: string): Promise<void> { this.previews.delete(token); }
	async restore(token: string, name: string, context: OperationContext): Promise<ProfileRecord> {
		name = validName(name);
		const receipt = this.receipts.get(context.operationId);
		if (receipt) { if (receipt.name !== name) throw new Error('operation conflict'); return receipt.record; }
		const preview = this.previews.get(token);
		if (!preview) unavailable();
		const db = await this.importBytes(preview.bytes.slice());
		await runMigrations(db, migrations);
		const record = { id: ulid(), name, createdAt: new Date().toISOString() };
		this.slots.set(record.id, { record, db, client: new BrowserDatabaseClient(db), backups: [] });
		this.receipts.set(context.operationId, { name, record });
		this.previews.delete(token);
		return record;
	}
	async reset(id: string, _context: OperationContext): Promise<void> {
		const slot = this.slot(id);
		slot.backups.push(await this.snapshot(slot.db));
		const replacement = await this.dependencies.createDatabase();
		await slot.db.close();
		slot.db = replacement;
		slot.client = new BrowserDatabaseClient(replacement);
		if (this.current?.profileId === id) this.current = { profileId: id, generation: ulid() };
	}
	async delete(id: string, _context: OperationContext, exportPath: string | null): Promise<DeleteResult> {
		const slot = this.slot(id);
		if (exportPath) await this.exportBackup(id, exportPath);
		this.slots.delete(id);
		if (this.current?.profileId === id) this.current = null;
		await slot.db.close();
		return { cleanupPending: false };
	}
	async setPreferences(preferences: AppPreferences): Promise<void> { this.preferences = { ...preferences }; }
	databaseFor(session: ProfileSession): AppDatabase {
		assertCurrentSession(session, this.current);
		const client = this.slot(session.profileId).client;
		const current = () => this.current;
		return new Proxy(client, {
			get(target, domainKey) {
				const domain = Reflect.get(target, domainKey);
				if (!domain || typeof domain !== 'object') return domain;
				return new Proxy(domain, {
					get(ops, methodKey) {
						const method = Reflect.get(ops, methodKey);
						if (typeof method !== 'function') return method;
						return async (...args: unknown[]) => {
							assertCurrentSession(session, current());
							const result = await method.apply(ops, args);
							assertCurrentSession(session, current());
							return result;
						};
					}
				});
			}
		}) as AppDatabase;
	}
	private async importBytes(bytes: Uint8Array): Promise<DatabaseService> {
		return this.dependencies.importSnapshot ? this.dependencies.importSnapshot(bytes) : createInMemoryDbFromBytes(bytes);
	}
	private slot(id: string): Slot { const slot = this.slots.get(id); if (!slot) throw new Error('profile not found'); return slot; }
}
