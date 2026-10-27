/** Shared pure policy. Native code owns timestamps, verification and publication. */
export interface BackupClock {
	nowIso: string;
	localDate: string;
	isoWeek: string;
	offsetMinutes: number;
}
export interface AutomaticBackupStatus {
	enabled: boolean;
	contentRevision: number;
	backedUpRevision: number;
	lastSuccessAt: string | null;
	lastSuccessDate: string | null;
	nextEligibleDate: string | null;
	warning: string | null;
	pruneWarning: string | null;
}
export interface AutomaticCopy {
	id: string;
	relativeFilename: string;
	schemaVersion: number;
	capturedRevision: number;
	localDate: string;
	localWeek: string;
	createdAt: string;
	publicationJobId: string;
	offsetMinutes: number;
	kind: string;
	verified: boolean;
	owned: boolean;
}
function validDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const time = Date.parse(`${value}T00:00:00Z`);
	return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
function instant(value: string): bigint | null {
	if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
	if (!validDate(value.slice(0, 10))) return null;
	const fraction = /\.(\d+)(?=Z|[+-])/.exec(value)?.[1] ?? '';
	const seconds = Date.parse(value.replace(/\.\d+(?=Z|[+-])/, ''));
	return Number.isSafeInteger(seconds) ? BigInt(seconds) * 1_000_000n + BigInt(fraction.padEnd(9, '0')) : null;
}
function validatedClock(clock: BackupClock): bigint | null {
	const time = instant(clock.nowIso);
	if (time === null || !Number.isInteger(clock.offsetMinutes) || Math.abs(clock.offsetMinutes) >= 1440) return null;
	const local = new Date(Date.parse(clock.nowIso) + clock.offsetMinutes * 60_000);
	if (local.toISOString().slice(0, 10) !== clock.localDate) return null;
	// ISO weeks use the year of the week's Thursday, including New Year overlap.
	local.setUTCDate(local.getUTCDate() + 4 - (local.getUTCDay() || 7));
	const year = local.getUTCFullYear();
	const start = Date.UTC(year, 0, 1);
	const week = Math.floor((local.getTime() - start) / 604_800_000) + 1;
	return clock.isoWeek === `${year}-W${String(week).padStart(2, '0')}` ? time : null;
}
export function automaticBackupDue(status: AutomaticBackupStatus, clock: BackupClock): boolean {
	const now = validatedClock(clock);
	if (now === null || !status.enabled || status.contentRevision <= status.backedUpRevision) return false;
	if (status.lastSuccessDate !== null && (!validDate(status.lastSuccessDate) || clock.localDate <= status.lastSuccessDate)) return false;
	if (status.lastSuccessAt === null) return true;
	const last = instant(status.lastSuccessAt);
	return last !== null && now > last;
}
/** The coordinator must gate pruning with this and rebind restored ownership. */
export function automaticPruneClockTrusted(previous: BackupClock, current: BackupClock): boolean {
	const before = validatedClock(previous);
	const now = validatedClock(current);
	return before !== null && now !== null && now >= before && current.offsetMinutes === previous.offsetMinutes && current.localDate >= previous.localDate;
}
export function automaticRetentionIds(copies: readonly AutomaticCopy[], protectedId: string): string[] {
	const eligible = copies.flatMap(copy => {
		if (copy.kind !== 'automatic' || !copy.verified || !copy.owned) return [];
		const time = validatedClock({ nowIso: copy.createdAt, localDate: copy.localDate, isoWeek: copy.localWeek, offsetMinutes: copy.offsetMinutes });
		return time === null ? [] : [{ copy, time }];
	}).sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0) || (a.copy.id < b.copy.id ? 1 : a.copy.id > b.copy.id ? -1 : 0));
	const keep = new Set([protectedId]);
	const dates = new Set<string>();
	const weeks = new Set<string>();
	const schemas = new Set<number>();
	for (const { copy } of eligible) {
		const daily = dates.size < 7 && !dates.has(copy.localDate);
		const weekly = weeks.size < 4 && !weeks.has(copy.localWeek);
		const schema = !schemas.has(copy.schemaVersion);
		if (daily) dates.add(copy.localDate);
		if (weekly) weeks.add(copy.localWeek);
		schemas.add(copy.schemaVersion);
		if (daily || weekly || schema) keep.add(copy.id);
	}
	return eligible.filter(({ copy }) => !keep.has(copy.id)).map(({ copy }) => copy.id);
}
