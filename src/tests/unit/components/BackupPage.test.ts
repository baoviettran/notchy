// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import * as m from '$lib/paraglide/messages';
import BackupPage from '../../../routes/settings/backup/+page.svelte';

// The only thing the page must not reach on its own is the raw DatabaseService:
// `getDb()` hands back the domain port, and the page may use nothing else. We
// inject a fake AppDatabase whose meta and backup ops record every call, so the
// assertions are about ROUTING — which port method each button drives — not
// about the backup machinery (covered by the BackupOps contract tests).
const metaGet = vi.hoisted(() => vi.fn());
const backupCreate = vi.hoisted(() => vi.fn().mockResolvedValue('/backups/notchy-backup.sqlite'));
const backupExportSqlite = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const backupExportCsv = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const dialogSave = vi.hoisted(() => vi.fn());
const dialogOpen = vi.hoisted(() => vi.fn());

vi.mock('$lib/db', () => ({
	getDb: () => ({
		meta: { get: metaGet },
		backup: { create: backupCreate, exportSqlite: backupExportSqlite, exportCsv: backupExportCsv }
	}),
	getDatabasePaths: async () => ({
		dataDir: '/data',
		databasePath: '/data/notchy.db',
		routineBackupDir: '/data/backups',
		upgradeBackupDir: '/data/backups/upgrades'
	}),
	getInstalledAppVersion: async () => '0.1.4',
	openBackupFolder: async () => {}
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: dialogSave, open: dialogOpen }));

const META: Record<string, string> = {
	schema_version: '6',
	last_backup_at: '2026-08-01T00:00:00.000Z',
	last_upgrade_backup_path: '/data/backups/notchy-pre-upgrade-v4-to-v5.sqlite',
	last_migrated_from_schema: '4',
	backup_warning: 'Disk full'
};

beforeEach(() => {
	vi.clearAllMocks();
	metaGet.mockImplementation(async (key: string) => META[key] ?? null);
});

/** Health resolving is the page's own "the port answered" signal. */
async function renderWithHealth() {
	render(BackupPage);
	await screen.findByText('0.1.4');
}

describe('<BackupPage>', () => {
	it('renders the health card from the port meta ops', async () => {
		await renderWithHealth();

		expect(screen.getByText('0.1.4')).toBeInTheDocument();
		expect(screen.getByText('6')).toBeInTheDocument();
		expect(metaGet).toHaveBeenCalledWith('schema_version');
		expect(metaGet).toHaveBeenCalledWith('backup_warning');
	});

	it('drives "Create backup now" through backup.create', async () => {
		await renderWithHealth();

		await fireEvent.click(screen.getByRole('button', { name: m.settings_backup_health_create_now() }));

		await waitFor(() => expect(backupCreate).toHaveBeenCalledTimes(1));
	});

	it('drives the SQLite export through backup.exportSqlite with the saved path', async () => {
		await renderWithHealth();
		dialogSave.mockResolvedValue('/tmp/notchy-2026-09-30.sqlite');

		await fireEvent.click(screen.getByRole('button', { name: m.settings_backup_export_sqlite() }));

		await waitFor(() =>
			expect(backupExportSqlite).toHaveBeenCalledWith('/tmp/notchy-2026-09-30.sqlite')
		);
	});

	it('drives the CSV export through backup.exportCsv with the chosen directory', async () => {
		await renderWithHealth();
		dialogOpen.mockResolvedValue('/tmp/notchy-csv');

		await fireEvent.click(screen.getByRole('button', { name: m.settings_backup_export_csv() }));

		await waitFor(() => expect(backupExportCsv).toHaveBeenCalledWith('/tmp/notchy-csv'));
	});
});
