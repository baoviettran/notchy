/** In-memory browser policy model. No native files or durable disk protection. */
import type { DatabaseService } from './service';
import type { AutomaticBackupStatus } from '../client';
import { automaticBackupDue, type BackupClock } from '$lib/backup/automatic-policy';
import { ulid } from '$lib/utils/id';

function browserClock(): BackupClock {
	const now = new Date();
	const offsetMinutes = -now.getTimezoneOffset();
	const local = new Date(now.getTime() + offsetMinutes * 60_000);
	const localDate = local.toISOString().slice(0, 10);
	local.setUTCDate(local.getUTCDate() + 4 - (local.getUTCDay() || 7));
	const year = local.getUTCFullYear();
	const week = Math.floor((local.getTime() - Date.UTC(year, 0, 1)) / 604_800_000) + 1;
	return { nowIso: now.toISOString(), localDate, isoWeek: `${year}-W${String(week).padStart(2, '0')}`, offsetMinutes };
}
export class BrowserAutomaticBackup {
	private pending: Promise<AutomaticBackupStatus> | null = null;
	constructor(private readonly db: DatabaseService) {}
	async automaticStatus(): Promise<AutomaticBackupStatus> {
		const [row] = await this.db.query<{ enabled: number; content_revision: number; backed_up_revision: number; last_success_at: string | null; last_success_date: string | null; warning: string | null; prune_warning: string | null }>('SELECT * FROM automatic_backup_state WHERE id=1');
		let nextEligibleDate: string | null = null;
		if (row.enabled && row.last_success_date) {
			const next = new Date(`${row.last_success_date}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
			nextEligibleDate = next.toISOString().slice(0, 10);
		}
		return { enabled: !!row.enabled, contentRevision: row.content_revision, backedUpRevision: row.backed_up_revision, lastSuccessAt: row.last_success_at, lastSuccessDate: row.last_success_date, nextEligibleDate, warning: row.warning, pruneWarning: row.prune_warning };
	}
	async setAutomaticEnabled(enabled: boolean): Promise<void> {
		await this.db.execute('UPDATE automatic_backup_state SET enabled=? WHERE id=1', [enabled ? 1 : 0]);
	}
	checkAutomatic(): Promise<AutomaticBackupStatus> {
		if (!this.pending) this.pending = this.check().finally(() => { this.pending = null; });
		return this.pending;
	}
	private async check(): Promise<AutomaticBackupStatus> {
		return this.db.transaction(async tx => {
			const status = await this.automaticStatus();
			const clock = browserClock();
			if (!automaticBackupDue(status, clock)) return status;
			const id = ulid();
			await tx.execute(`INSERT INTO automatic_backup_copies (id, relative_filename, schema_version, captured_revision, local_date, local_week, created_at, publication_job_id, offset_minutes) VALUES (?, ?, 7, ?, ?, ?, ?, ?, ?)`, [id, `memory-${id}.sqlite`, status.contentRevision, clock.localDate, clock.isoWeek, clock.nowIso, id, clock.offsetMinutes]);
			await tx.execute('UPDATE automatic_backup_state SET backed_up_revision=?, last_success_at=?, last_success_date=?, last_success_offset_minutes=?, warning=NULL WHERE id=1', [status.contentRevision, clock.nowIso, clock.localDate, clock.offsetMinutes]);
			return this.automaticStatus();
		});
	}
}
