import type { AppDatabase } from '$lib/db/client';
import { isTauri, bindProfileDb } from '$lib/db';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { createInMemoryDb } from '$lib/db/browser/in-memory';
import { migrations } from '$lib/db/browser/migrations';
import { runMigrations } from '$lib/db/browser/migrations/runner';
import { BrowserProfilePort } from '$lib/profiles/browser';
import { NativeProfilePort } from '$lib/profiles/native';
import { hasDirtyDrafts, prepareDraftAck, cancelDraftTransition } from '$lib/profiles/drafts.svelte';
import { requestProfileTransition, type DraftChoice } from '$lib/profiles/windows';
import type { ProfilePort } from '$lib/profiles/port';
import type { DeleteResult, ProfileRecord, ProfileSession, ProfileSnapshot } from '$lib/profiles/types';
import { resetProfileState } from '$lib/profiles/reset-state';
import { settings } from '$lib/stores/settings.svelte';
import { dbStore } from '$lib/stores/db.svelte';
import { postDueSchedulesOnce } from '$lib/logic/post-due-schedules';
import { todayIso } from '$lib/utils/date';
import { ulid } from '$lib/utils/id';

export interface ProfileBarrier { token: string | null; release(): Promise<void> }
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
		this.deps.reset(session);
		if (!session || !db) { this.lastBound = key; return; }
		await this.deps.loadSettings(session);
		this.lastBound = key;
		if (key === this.lastCatchUp) return;
		this.lastCatchUp = key;
		await this.deps.catchUp(session, db);
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
			return await action(guard.token);
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
	return { token: null, release: async () => { cancelDraftTransition(); } };
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
		await postDueSchedulesOnce(db, todayIso(), `${session.profileId}:${session.generation}`);
	},
	barrier: defaultBarrier,
	loadPreferences: (snapshot) => {
		settings.configureAppPreferences((preferences) => defaultPort.setPreferences(preferences));
		settings.loadAppPreferences(snapshot.preferences);
	},
});
