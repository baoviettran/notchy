import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { toAppError } from '$lib/native/to-app-error';
import { NativeDatabaseClient } from '$lib/db/native/client';
import { createSessionInvoker } from './session';
import type { ProfilePort } from './port';
import type { AppPreferences, BackupSummary, DeleteResult, OperationContext, ProfileRecord, ProfileSession, ProfileSnapshot, ProfileStoragePaths, RestorePreview } from './types';

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
export class NativeProfilePort implements ProfilePort {
	private current: ProfileSession | null = null;
	constructor(private readonly raw: Invoke = tauriInvoke) {}
	private async call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
		try { return await this.raw<T>(command, args); }
		catch (error) { throw toAppError(error); }
	}
	async load(): Promise<ProfileSnapshot> {
		const snapshot = await this.call<ProfileSnapshot>('profiles_load');
		this.current = snapshot.active;
		return snapshot;
	}
	paths(id: string): Promise<ProfileStoragePaths> { return this.call('profile_paths', { id }); }
	backups(id: string): Promise<BackupSummary[]> { return this.call('profile_discover_backups', { id }); }
	create(name: string, context: OperationContext): Promise<ProfileRecord> { return this.call('profile_create', { name, context }); }
	rename(id: string, name: string): Promise<ProfileRecord> { return this.call('profile_rename', { id, name }); }
	async activate(id: string, transitionToken: string | null): Promise<ProfileSession> {
		const session = await this.call<ProfileSession>('profile_activate', { id, transitionToken });
		this.current = session;
		return session;
	}
	backup(id: string): Promise<string> { return this.call('profile_backup', { id }); }
	exportBackup(id: string, targetPath: string): Promise<void> { return this.call('profile_export_backup', { id, targetPath }); }
	inspectRestore(sourcePath: string): Promise<RestorePreview> { return this.call('profile_inspect_restore', { sourcePath }); }
	cancelRestore(token: string): Promise<void> { return this.call('profile_cancel_restore', { token }); }
	restore(token: string, name: string, context: OperationContext): Promise<ProfileRecord> { return this.call('profile_restore', { token, name, context }); }
	async reset(id: string, context: OperationContext): Promise<void> {
		await this.call('profile_reset', { id, context });
		this.current = (await this.load()).active;
	}
	async delete(id: string, context: OperationContext, exportPath: string | null): Promise<DeleteResult> {
		const result = await this.call<DeleteResult>('profile_delete', { id, context, exportPath });
		this.current = (await this.load()).active;
		return result;
	}
	setPreferences(preferences: AppPreferences): Promise<void> { return this.call('app_preferences_set', { preferences }); }
	databaseFor(session: ProfileSession): NativeDatabaseClient {
		return new NativeDatabaseClient(createSessionInvoker(session, this.raw, () => this.current));
	}
}
