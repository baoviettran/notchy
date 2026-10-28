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
const automaticStatus = vi.hoisted(() => vi.fn());
const automaticSet = vi.hoisted(() => vi.fn());
const automaticCheck = vi.hoisted(() => vi.fn());
const metaGet = vi.hoisted(() => vi.fn());
const backupCreate = vi.hoisted(() => vi.fn().mockResolvedValue('/backups/notchy-backup.sqlite'));
const backupExportSqlite = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const backupExportCsv = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const dialogSave = vi.hoisted(() => vi.fn());
const dialogOpen = vi.hoisted(() => vi.fn());

vi.mock('$lib/db', () => ({
	isTauri: () => true,
	getDb: () => ({
		meta: { get: metaGet },
		backup: { automaticStatus, setAutomaticEnabled: automaticSet, checkAutomatic: automaticCheck, create: backupCreate, exportSqlite: backupExportSqlite, exportCsv: backupExportCsv }
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

vi.mock('$lib/stores/profiles.svelte', () => ({ profiles: {
	snapshot: { active: { profileId: 'profile-A', generation: 'g1' } },
	paths: async () => ({ databasePath: '/data/profiles/profile-A/notchy.db', upgradeBackupDir: '/data/profiles/profile-A/backups/upgrades', routineBackupDir: '/data/profiles/profile-A/backups' }),
	backup: backupCreate, exportBackup: backupExportSqlite
} }));
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
	automaticStatus.mockResolvedValue({ enabled: true, contentRevision: 2, backedUpRevision: 1, lastSuccessAt: '2026-10-27T08:00:00Z', lastSuccessDate: '2026-10-27', nextEligibleDate: '2026-10-28', warning: 'backup_automatic_failed', pruneWarning: null });
	automaticSet.mockResolvedValue(undefined);
	automaticCheck.mockImplementation(async () => ({ ...(await automaticStatus()), warning: null }));
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

	it('creates a backup for the active profile', async () => {
		await renderWithHealth();

		await fireEvent.click(screen.getByRole('button', { name: m.settings_backup_health_create_now() }));

		await waitFor(() => expect(backupCreate).toHaveBeenCalledWith('profile-A'));
	});

	it('exports only the active profile to the saved path', async () => {
		await renderWithHealth();
		dialogSave.mockResolvedValue('/tmp/notchy-2026-09-30.sqlite');

		await fireEvent.click(screen.getByRole('button', { name: m.settings_backup_export_sqlite() }));

		await waitFor(() =>
			expect(backupExportSqlite).toHaveBeenCalledWith('profile-A', '/tmp/notchy-2026-09-30.sqlite')
		);
	});

	it('drives the CSV export through backup.exportCsv with the chosen directory', async () => {
		await renderWithHealth();
		dialogOpen.mockResolvedValue('/tmp/notchy-csv');

		await fireEvent.click(screen.getByRole('button', { name: m.settings_backup_export_csv() }));

		await waitFor(() => expect(backupExportCsv).toHaveBeenCalledWith('/tmp/notchy-csv'));
	});
});

it('does show a localized retryable warning and keep the last verified success', async () => {
	await renderWithHealth();
	expect(await screen.findByText('2026-10-27T08:00:00Z')).toBeInTheDocument();
	expect(screen.getByText(m.backup_automatic_failed())).toBeInTheDocument();
	expect(screen.getByText('/data/profiles/profile-A/backups')).toBeInTheDocument();
	await fireEvent.click(screen.getByRole('button', { name: m.settings_backup_auto_retry() }));
	await waitFor(() => expect(screen.queryByText(m.backup_automatic_failed())).not.toBeInTheDocument());
	expect(screen.getByText('2026-10-27T08:00:00Z')).toBeInTheDocument();
});
it('does persist the automatic backup toggle and refresh its enabled state', async () => {
	await renderWithHealth();
	const toggle = await screen.findByRole('checkbox', { name: m.settings_backup_auto_enabled() });
	expect(toggle).toBeChecked();
	automaticStatus.mockResolvedValue({ ...(await automaticStatus()), enabled: false, nextEligibleDate: null });
	await fireEvent.click(toggle);
	await waitFor(() => expect(toggle).not.toBeChecked());
	expect(automaticSet).toHaveBeenCalledWith(false);
});

it('does restore the enabled checkbox when saving the preference fails', async () => {
	await renderWithHealth();
	const toggle = await screen.findByRole('checkbox', { name: m.settings_backup_auto_enabled() });
	automaticSet.mockRejectedValueOnce(new Error('unavailable'));
	await fireEvent.click(toggle);
	await waitFor(() => expect(toggle).toBeEnabled());
	expect(toggle).toBeChecked();
	expect(screen.getAllByText(m.backup_automatic_failed()).length).toBeGreaterThan(0);
});
