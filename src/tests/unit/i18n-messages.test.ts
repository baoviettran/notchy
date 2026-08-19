import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../..', 'messages');
type Catalog = Record<string, string>;
const en: Catalog = JSON.parse(readFileSync(resolve(root, 'en.json'), 'utf8'));
const vi: Catalog = JSON.parse(readFileSync(resolve(root, 'vi.json'), 'utf8'));

const placeholders = (s: string) => (s.match(/\{[a-zA-Z_]+\}/g) ?? []).sort();

// Keys confirmed unreferenced across src/, src/tests/, e2e/, scripts/ on 2026-08-18.
const DEAD_KEYS = [
	'budgets_remaining',
	'dashboard_quick_entry',
	'import_tx_preview_heading',
	'layout_menu',
	'reports_axis_amount',
	'reports_axis_month',
	'reports_legend_expense',
	'reports_legend_income',
	'reports_legend_net_worth',
	'reports_window_12m',
	'reports_window_24m',
	'reports_window_6m',
];

describe('i18n messages', () => {
	it('have identical key sets in en and vi', () => {
		expect(Object.keys(vi).sort()).toEqual(Object.keys(en).sort());
	});

	it('match placeholders between en and vi for every key', () => {
		const mismatches = Object.keys(en)
			.filter((k) => placeholders(en[k]).join(',') !== placeholders(vi[k] ?? '').join(','))
			.map((k) => `${k}: en=${placeholders(en[k])} vi=${placeholders(vi[k] ?? '')}`);
		expect(mismatches).toEqual([]);
	});

	it('contain no known-dead keys', () => {
		expect(DEAD_KEYS.filter((k) => k in en || k in vi)).toEqual([]);
	});

	it('use "Tệp" for "file" in vi — no stray English "File"', () => {
		const offenders = Object.entries(vi)
			.filter(([, v]) => /File/.test(v))
			.map(([k, v]) => `${k}: ${v}`);
		expect(offenders).toEqual([]);
	});

	it('end no errors_* message with a period', () => {
		const offenders = Object.keys(en)
			.filter((k) => k.startsWith('errors_') && (en[k].endsWith('.') || vi[k]?.endsWith('.')))
			.map((k) => `${k}`);
		expect(offenders).toEqual([]);
	});
});
