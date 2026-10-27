import type { Migration } from './runner';
// Browser schema 7 mirrors native schema 8; native-only receipts keep them apart.
const contentTables = ['accounts', 'transactions', 'category_types', 'category_tags', 'budgets', 'goals', 'reconciliations', 'categorize_rules', 'schedules'];
const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
export const migration007: Migration = {
	version: 7,
	name: 'automatic_backup',
	async up(db) {
		await db.execute(`CREATE TABLE IF NOT EXISTS automatic_backup_state (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
	content_revision INTEGER NOT NULL DEFAULT 0 CHECK (content_revision BETWEEN 0 AND 9007199254740991),
	backed_up_revision INTEGER NOT NULL DEFAULT 0 CHECK (backed_up_revision BETWEEN 0 AND content_revision),
	last_success_at TEXT,
	last_success_date TEXT,
	last_success_offset_minutes INTEGER,
	warning TEXT,
	prune_warning TEXT,
	pending_job_id TEXT,
	pending_relative_filename TEXT,
	pending_revision INTEGER CHECK (pending_revision BETWEEN 0 AND 9007199254740991),
	pending_local_date TEXT,
	pending_local_week TEXT,
	pending_offset_minutes INTEGER,
	pending_started_at TEXT
)`);
		await db.execute(`CREATE TABLE IF NOT EXISTS automatic_backup_copies (
	id TEXT PRIMARY KEY,
	relative_filename TEXT NOT NULL UNIQUE CHECK (length(relative_filename) > 0 AND instr(relative_filename, '/') = 0 AND instr(relative_filename, char(92)) = 0 AND relative_filename NOT IN ('.', '..')),
	schema_version INTEGER NOT NULL CHECK (schema_version >= 3),
	captured_revision INTEGER NOT NULL CHECK (captured_revision BETWEEN 0 AND 9007199254740991),
	local_date TEXT NOT NULL,
	local_week TEXT NOT NULL,
	created_at TEXT NOT NULL,
	publication_job_id TEXT NOT NULL UNIQUE,
	offset_minutes INTEGER NOT NULL
)`);
		await db.execute(`INSERT OR IGNORE INTO automatic_backup_state (id, content_revision)
SELECT 1, CASE WHEN
	EXISTS (SELECT 1 FROM accounts)
	OR EXISTS (SELECT 1 FROM transactions)
	OR EXISTS (SELECT 1 FROM budgets)
	OR EXISTS (SELECT 1 FROM goals)
	OR EXISTS (SELECT 1 FROM reconciliations)
	OR EXISTS (SELECT 1 FROM categorize_rules)
	OR EXISTS (SELECT 1 FROM schedules)
	OR EXISTS (SELECT 1 FROM app_meta WHERE key IN ('currency', 'first_run_complete', 'onboarding_step'))
	OR (SELECT COUNT(*) FROM category_types) <> 4
	OR EXISTS (
		SELECT id, name, is_system, budgetable, sort_order, deleted_at, rollover_enabled FROM category_types
		EXCEPT VALUES
			('bucket_essentials', 'Essentials', 0, 1, 0, NULL, 1),
			('bucket_learning', 'Learning & Entertainment', 0, 1, 1, NULL, 1),
			('bucket_saving', 'Saving & Investment', 0, 1, 2, NULL, 1),
			('bucket_adjustments', 'Adjustments', 1, 0, 3, NULL, 1)
	)
	OR (SELECT COUNT(*) FROM category_tags) <> 4
	OR EXISTS (
		SELECT id, type_id, name, is_system, sort_order, deleted_at FROM category_tags
		EXCEPT VALUES
			('tag_initial_balance', 'bucket_adjustments', 'Initial Balance', 1, 0, NULL),
			('tag_loss', 'bucket_adjustments', 'Loss', 1, 0, NULL),
			('tag_gift', 'bucket_adjustments', 'Gift', 1, 0, NULL),
			('tag_reconciliation', 'bucket_adjustments', 'Reconciliation', 1, 0, NULL)
	)
THEN 1 ELSE 0 END`);
		await db.execute(`CREATE TRIGGER IF NOT EXISTS trg_content_app_meta_insert AFTER INSERT ON app_meta
WHEN NEW.key IN ('currency', 'first_run_complete', 'onboarding_step')
BEGIN UPDATE automatic_backup_state SET content_revision = content_revision + 1 WHERE id = 1; END`);
		await db.execute(`CREATE TRIGGER IF NOT EXISTS trg_content_app_meta_delete AFTER DELETE ON app_meta
WHEN OLD.key IN ('currency', 'first_run_complete', 'onboarding_step')
BEGIN UPDATE automatic_backup_state SET content_revision = content_revision + 1 WHERE id = 1; END`);
		await db.execute(`CREATE TRIGGER IF NOT EXISTS trg_content_app_meta_update AFTER UPDATE ON app_meta
WHEN (OLD.key IN ('currency', 'first_run_complete', 'onboarding_step') OR NEW.key IN ('currency', 'first_run_complete', 'onboarding_step')) AND (OLD.key IS NOT NEW.key OR OLD.value IS NOT NEW.value)
BEGIN UPDATE automatic_backup_state SET content_revision = content_revision + 1 WHERE id = 1; END`);
		for (const table of contentTables) {
			const columns = await db.query<{
				name: string;
			}>(`PRAGMA table_info(${identifier(table)})`);
			const changes = columns.filter(({ name }) => name !== 'created_at' && name !== 'updated_at')
				.map(({ name }) => `OLD.${identifier(name)} IS NOT NEW.${identifier(name)}`).join(' OR ');
			for (const operation of ['insert', 'update', 'delete']) {
				const condition = operation === 'update' ? `WHEN ${changes || '0'}` : '';
				await db.execute(`CREATE TRIGGER IF NOT EXISTS ${identifier(`trg_content_${table}_${operation}`)}
					AFTER ${operation} ON ${identifier(table)} ${condition}
					BEGIN UPDATE automatic_backup_state SET content_revision = content_revision + 1 WHERE id = 1; END`);
			}
		}
	}
};
