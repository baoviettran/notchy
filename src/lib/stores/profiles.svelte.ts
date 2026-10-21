import type { AppDatabase } from '$lib/db/client';
import { isTauri, bindProfileDb, getDb } from '$lib/db';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { createInMemoryDb } from '$lib/db/browser/in-memory';
import { migrations } from '$lib/db/browser/migrations';
import { runMigrations } from '$lib/db/browser/migrations/runner';
import { BrowserProfilePort } from '$lib/profiles/browser';
import { NativeProfilePort } from '$lib/profiles/native';
import { hasDirtyDrafts, prepareDraftAck, commitDraftTransition, cancelDraftTransition } from '$lib/profiles/drafts.svelte';
import { requestProfileTransition, type DraftChoice } from '$lib/profiles/windows';
import type { ProfilePort } from '$lib/profiles/port';
import type { BackupSummary, DeleteResult, ProfileRecord, ProfileSession, ProfileSnapshot, ProfileStoragePaths, RestorePreview } from '$lib/profiles/types';
import { resetProfileState } from '$lib/profiles/reset-state';
import { settings } from '$lib/stores/settings.svelte';
import { dbStore } from '$lib/stores/db.svelte';
import { postDueSchedulesOnce, bootSummaryMessage } from '$lib/logic/post-due-schedules';
import { emitTransactionsChanged } from '$lib/stores/quick-refresh';
import { toast } from '$lib/stores/toast.svelte';
import { schedules } from '$lib/stores/schedules.svelte';
import { transactions } from '$lib/stores/transactions.svelte';
import { getBoundProfileSession } from '$lib/profiles/current';
import { todayIso } from '$lib/utils/date';
import { ulid } from '$lib/utils/id';

export interface ProfileBarrier { token: string | null; release(): Promise<void>; commit?(): void }
type PendingTransition = { requestId: string; requiredLabels: string[] };
type OnPending = (request: PendingTransition, cancel: () => Promise<void>) => void;
export interface ProfilesStoreDependencies {
	port: ProfilePort;
	bind: (session: ProfileSession | null, db: AppDatabase | null) => void;
	reset: (session: ProfileSession | null) => void;
	loadSettings: (session: ProfileSession) => Promise<void>;
	catchUp: (session: ProfileSession, db: AppDatabase) => Promise<void>;
	barrier: (expected: ProfileSession | null, onPending?: OnPending) => Promise<ProfileBarrier>;
	loadPreferences?: (snapshot: ProfileSnapshot) => void;
}

export class ProfilesStore {
	snapshot = $state<ProfileSnapshot | null>(null);
	busy = $state(false);
	error = $state<string | null>(null);
	pendingTransition = $state<PendingTransition | null>(null);
	private cancelPending: (() => Promise<void>) | null = null;
	private lastCatchUp: string | null = null;

	private lastBound: string | null | undefined = undefined;
	constructor(private readonly deps: ProfilesStoreDependencies) {}

	private async refresh(): Promise<ProfileSnapshot> {
		const snapshot = await this.deps.port.load();
		this.snapshot = snapshot;
		this.deps.loadPreferences?.(snapshot);
		return snapshot;
	}
	private async bind(session: ProfileSession | null): Promise<void> {
		const key = session ? `${session.profileId}:${session.generation}` : null;
		if (key === this.lastBound) return;
		const db = session ? this.deps.port.databaseFor(session) : null;
		this.deps.bind(session, db);
		if (typeof window !== 'undefined' && !isTauri()) {
			(window as typeof window & { __notchyTestHooks?: { getDb: typeof getDb } }).__notchyTestHooks = { getDb };
		}
		this.deps.reset(session);
		if (!session || !db) { this.lastBound = key; return; }
		await this.deps.loadSettings(session);
		this.lastBound = key;
		if (key === this.lastCatchUp) return;
		this.lastCatchUp = key;
		await this.deps.catchUp(session, db);
	}
	async bootstrap(): Promise<ProfileSnapshot> {
		await this.deps.port.bootstrap();
		return this.load();
	}
	async load(): Promise<ProfileSnapshot> {
		const snapshot = await this.refresh();
		await this.bind(snapshot.active);
		return snapshot;
	}
	private async run<T>(action: () => Promise<T>): Promise<T> {
		if (this.busy) throw new Error('profile operation in progress');
		this.busy = true;
		this.error = null;
		try { return await action(); }
		catch (error) { this.error = error instanceof Error ? error.message : String(error); throw error; }
		finally { this.busy = false; }
	}
	async cancelPendingTransition(): Promise<void> { await this.cancelPending?.(); }
	private async guarded<T>(action: (token: string | null) => Promise<T>): Promise<T> {
		const active = this.snapshot?.active ?? null;
		let guard: ProfileBarrier | null = null;
		try {
			guard = await this.deps.barrier(active, (request, cancel) => {
				this.pendingTransition = request;
				this.cancelPending = cancel;
			});
			const result = await action(guard.token);
			guard.commit?.();
			return result;
		} finally {
			try { await guard?.release(); }
			finally { this.pendingTransition = null; this.cancelPending = null; }
		}
	}
	private async reconcile(): Promise<void> {
		try { const snapshot = await this.refresh(); await this.bind(snapshot.active); }
		catch {
			this.snapshot = null;
			this.lastBound = undefined;
			this.deps.bind(null, null);
			this.deps.reset(null);
		}
	}
	private async activateTarget(id: string): Promise<ProfileSession> {
		return this.guarded(async (token) => {
			let session: ProfileSession;
			try { session = await this.deps.port.activate(id, token); }
			catch (error) {
				// Native rollback can reopen the prior profile with a new generation.
				await this.reconcile();
				throw error;
			}
			await this.refresh();
			await this.bind(session);
			return session;
		});
	}
	async switchTo(id: string): Promise<ProfileSession> { return this.run(() => this.activateTarget(id)); }
	async createAndOpen(name: string): Promise<ProfileSession> {
		return this.run(async () => {
			const created = await this.deps.port.create(name, { operationId: ulid(), transitionToken: null });
			await this.refresh();
			if (!created) throw new Error('created profile not found');
			return this.activateTarget(created.id);
		});
	}
	async rename(id: string, name: string): Promise<ProfileRecord> {
		return this.run(async () => { const record = await this.deps.port.rename(id, name); await this.refresh(); return record; });
	}
	async reset(id: string): Promise<void> {
		return this.run(async () => {
			const action = async (token: string | null) => {
				try {
					await this.deps.port.reset(id, { operationId: ulid(), transitionToken: token });
					const snapshot = await this.refresh();
					if (snapshot.active?.profileId === id) await this.bind(snapshot.active);
				} catch (error) { await this.reconcile(); throw error; }
			};
			if (this.snapshot?.active?.profileId === id) await this.guarded(action);
			else await action(null);
		});
	}
	async remove(id: string, exportPath: string | null): Promise<DeleteResult> {
		return this.run(async () => {
			const action = async (token: string | null) => {
				try {
					const result = await this.deps.port.delete(id, { operationId: ulid(), transitionToken: token }, exportPath);
					const snapshot = await this.refresh();
					if (!snapshot.active) await this.bind(null);
					return result;
				} catch (error) { await this.reconcile(); throw error; }
			};
			return this.snapshot?.active?.profileId === id ? this.guarded(action) : action(null);
		});
	}
	paths(id: string): Promise<ProfileStoragePaths> { return this.deps.port.paths(id); }
	backups(id: string): Promise<BackupSummary[]> { return this.deps.port.backups(id); }
	backup(id: string): Promise<string> { return this.run(() => this.deps.port.backup(id)); }
	exportBackup(id: string, path: string): Promise<void> { return this.run(() => this.deps.port.exportBackup(id, path)); }
	inspectRestore(path: string): Promise<RestorePreview> { return this.deps.port.inspectRestore(path); }
	cancelRestore(token: string): Promise<void> { return this.deps.port.cancelRestore(token); }
	async restore(token: string, name: string): Promise<ProfileRecord> {
		return this.run(async () => {
			const record = await this.deps.port.restore(token, name, { operationId: ulid(), transitionToken: null });
			await this.refresh();
			return record;
		});
	}
}

let draftChoice: (dirty: boolean) => Promise<DraftChoice> = async () => 'stay';
export function setProfileDraftChoice(handler: (dirty: boolean) => Promise<DraftChoice>): void { draftChoice = handler; }

async function defaultBarrier(expected: ProfileSession | null, onPending?: OnPending): Promise<ProfileBarrier> {
	if (isTauri()) {
		const transition = await requestProfileTransition(expected);
		onPending?.({ requestId: transition.request.requestId, requiredLabels: transition.request.requiredLabels }, transition.cancel);
		let token: string;
		try { token = await transition.token; }
		catch (error) { cancelDraftTransition(); throw error; }
		return {
			token,
			release: async () => { await transition.cancel().catch(() => {}); cancelDraftTransition(); }
		};
	}
	const choice = hasDirtyDrafts() ? await draftChoice(true) : 'discard';
	if (!await prepareDraftAck(expected, choice)) throw new Error('profile transition canceled');
	return { token: null, commit: commitDraftTransition, release: async () => { cancelDraftTransition(); } };
}

const browserPort = new BrowserProfilePort({ createDatabase: async () => {
	const db = await createInMemoryDb();
	await runMigrations(db, migrations);
	return db;
} });
const defaultPort: ProfilePort = typeof window !== 'undefined' && isTauri() ? new NativeProfilePort() : browserPort;
export const profiles = new ProfilesStore({
	port: defaultPort,
	bind: bindProfileDb,
	reset: resetProfileState,
	loadSettings: async () => { await settings.loadProfileSettings(); dbStore.firstRunComplete = settings.firstRunComplete; },
	catchUp: async (session, db) => {
		if (isTauri() && getCurrentWebviewWindow().label !== 'main') return;
		const summary = await postDueSchedulesOnce(db, todayIso(), `${session.profileId}:${session.generation}`);
		const current = getBoundProfileSession();
		if (!current || current.profileId !== session.profileId || current.generation !== session.generation) return;
		if (summary.posted > 0) {
			await transactions.load();
			await schedules.load();
			await emitTransactionsChanged(session);
		}
		const message = bootSummaryMessage(summary);
		if (message) toast.show(message);
	},
	barrier: defaultBarrier,
	loadPreferences: (snapshot) => {
		settings.configureAppPreferences((preferences) => defaultPort.setPreferences(preferences));
		settings.loadAppPreferences(snapshot.preferences);
	},
});
