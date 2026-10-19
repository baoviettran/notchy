import type { AppDatabase } from '$lib/db/client';
import type { AppPreferences, BackupSummary, DeleteResult, OperationContext, ProfileRecord, ProfileSession, ProfileSnapshot, ProfileStoragePaths, RestorePreview } from './types';

export interface ProfilePort {
	load(): Promise<ProfileSnapshot>;
	paths(id: string): Promise<ProfileStoragePaths>;
	backups(id: string): Promise<BackupSummary[]>;
	create(name: string, context: OperationContext): Promise<ProfileRecord>;
	rename(id: string, name: string): Promise<ProfileRecord>;
	activate(id: string, transitionToken: string | null): Promise<ProfileSession>;
	backup(id: string): Promise<string>;
	exportBackup(id: string, targetPath: string): Promise<void>;
	inspectRestore(sourcePath: string): Promise<RestorePreview>;
	cancelRestore(token: string): Promise<void>;
	restore(token: string, name: string, context: OperationContext): Promise<ProfileRecord>;
	reset(id: string, context: OperationContext): Promise<void>;
	delete(id: string, context: OperationContext, exportPath: string | null): Promise<DeleteResult>;
	setPreferences(preferences: AppPreferences): Promise<void>;
	databaseFor(session: ProfileSession): AppDatabase;
}
