import type { Migration } from './runner';

const DATA_TABLES = ['accounts', 'category_types', 'category_tags', 'transactions', 'budgets', 'goals', 'reconciliations'] as const;

function columnsForTable(table: string): string[] {
	switch (table) {
		case 'accounts':
			return ['id', 'name', 'type', 'counterparty', 'currency', 'archived', 'created_at', 'updated_at', 'deleted_at'];
		case 'category_types':
			return ['id', 'name', 'is_system', 'budgetable', 'sort_order', 'created_at', 'updated_at', 'deleted_at'];
		case 'category_tags':
			return ['id', 'type_id', 'name', 'is_system', 'sort_order', 'created_at', 'updated_at', 'deleted_at'];
		case 'transactions':
			return ['id', 'kind', 'date', 'amount', 'account_id', 'transfer_account_id', 'transfer_pair_id', 'refund_of_id', 'tag_id', 'payee', 'description', 'created_at', 'updated_at', 'deleted_at'];
		case 'budgets':
			return ['id', 'type_id', 'month', 'allocated', 'created_at', 'updated_at', 'deleted_at'];
		case 'goals':
			return ['id', 'name', 'type', 'target_amount', 'target_date', 'linked_account_id', 'starting_amount', 'show_on_dashboard', 'status', 'closed_at', 'created_at', 'updated_at', 'deleted_at'];
		case 'reconciliations':
			return ['id', 'account_id', 'date', 'expected_balance', 'actual_balance', 'adjustment_transaction_id', 'notes', 'created_at', 'updated_at', 'deleted_at'];
		default:
			return ['id'];
	}
}

function jsonObjectExpr(prefix: string, cols: string[]): string {
	return `json_object(${cols.map((c) => `'${c}', ${prefix}.${c}`).join(', ')})`;
}

export const migration002: Migration = {
	version: 2,
	name: 'change_log_triggers',
	async up(db) {
		for (const table of DATA_TABLES) {
			const cols = columnsForTable(table);
			const payload = jsonObjectExpr('NEW', cols);
			const payloadOld = jsonObjectExpr('OLD', cols);

			await db.execute(`
				CREATE TRIGGER trg_${table}_insert AFTER INSERT ON ${table}
				BEGIN
					INSERT INTO change_log (table_name, row_id, operation, timestamp, device_id, payload)
					VALUES (
						'${table}', NEW.id, 'insert',
						NEW.updated_at,
						(SELECT value FROM app_meta WHERE key = 'device_id'),
						${payload}
					);
				END
			`);

			await db.execute(`
				CREATE TRIGGER trg_${table}_update AFTER UPDATE ON ${table}
				BEGIN
					INSERT INTO change_log (table_name, row_id, operation, timestamp, device_id, payload)
					VALUES (
						'${table}', NEW.id, 'update',
						NEW.updated_at,
						(SELECT value FROM app_meta WHERE key = 'device_id'),
						${payload}
					);
				END
			`);

			await db.execute(`
				CREATE TRIGGER trg_${table}_delete AFTER DELETE ON ${table}
				BEGIN
					INSERT INTO change_log (table_name, row_id, operation, timestamp, device_id, payload)
					VALUES (
						'${table}', OLD.id, 'delete',
						OLD.updated_at,
						(SELECT value FROM app_meta WHERE key = 'device_id'),
						${payloadOld}
					);
				END
			`);
		}
	}
};
