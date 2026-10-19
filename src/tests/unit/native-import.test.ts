import { afterEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { restoreCompatibleDatabase } from '$lib/recovery';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});

describe('native file import', () => {
	it('restores a selected file through Rust without loading the removed SQL plugin', async () => {
		vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
		vi.mocked(invoke).mockResolvedValue(7);

		await expect(restoreCompatibleDatabase('/chosen/backup.sqlite')).resolves.toEqual({ schemaVersion: 7 });
		expect(invoke).toHaveBeenCalledExactlyOnceWith('database_import', { sourcePath: '/chosen/backup.sqlite' });
	});

	it('converts native validation failures into localized application errors', async () => {
		vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
		vi.mocked(invoke).mockRejectedValue({ code: 'database_corrupt', meta: {} });

		await expect(restoreCompatibleDatabase('/chosen/broken.sqlite')).rejects.toMatchObject({
			name: 'NativeAppError', code: 'database_corrupt'
		});
	});

	it.each([
		['schema_too_old', 'backup_schema_too_old'],
		['schema_too_new', 'backup_schema_newer']
	])('preserves the import rejection message for %s', async (code, expected) => {
		vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
		vi.mocked(invoke).mockRejectedValue({ code, meta: {} });
		await expect(restoreCompatibleDatabase('/chosen/unsupported.sqlite')).rejects.toMatchObject({ code: expected });
	});
});
