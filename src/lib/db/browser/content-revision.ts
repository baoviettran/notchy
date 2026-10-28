import type { DatabaseService } from './service';
const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

/** Later migrations call this after creating their content tables. */
export async function installContentRevisionTriggers(db: DatabaseService, tables: readonly string[]): Promise<void> {
	for (const table of tables) {
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
