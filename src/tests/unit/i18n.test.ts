import { describe, it, expect } from 'vitest';
import { parseAmount } from '$lib/utils/number_parse';
import { formatCurrency, formatNumber } from '$lib/utils/currency';
import { formatDate, formatDateRelative } from '$lib/utils/date';
import { AppError } from '$lib/errors';

describe('parseAmount', () => {
	it('parses plain numbers', () => {
		expect(parseAmount('50000', 'vi')).toBe(50000);
		expect(parseAmount('1234', 'en')).toBe(1234);
	});

	it('parses Vietnamese shortcut tr (triệu)', () => {
		expect(parseAmount('1.5tr', 'vi')).toBe(1500000);
		expect(parseAmount('2tr', 'vi')).toBe(2000000);
	});

	it('parses k shortcut (both locales)', () => {
		expect(parseAmount('50k', 'vi')).toBe(50000);
		expect(parseAmount('50k', 'en')).toBe(50000);
	});

	it('parses English shortcut m (million)', () => {
		expect(parseAmount('1.5m', 'en')).toBe(1500000);
	});

	it('handles arithmetic', () => {
		expect(parseAmount('50k+30k', 'vi')).toBe(80000);
		expect(parseAmount('100k-20k', 'en')).toBe(80000);
		expect(parseAmount('50k*2', 'vi')).toBe(100000);
	});

	it('handles parentheses', () => {
		expect(parseAmount('(50+30)*1000', 'en')).toBe(80000);
	});

	it('strips commas and spaces', () => {
		expect(parseAmount('1,000,000', 'en')).toBe(1000000);
		expect(parseAmount('50 000', 'vi')).toBe(50000);
	});

	it('throws on empty input', () => {
		expect(() => parseAmount('', 'en')).toThrow(AppError);
		expect(() => parseAmount('', 'en')).toThrow(expect.objectContaining({ code: 'invalid_amount' }));
	});

	it('throws on zero or negative result', () => {
		expect(() => parseAmount('0', 'en')).toThrow(expect.objectContaining({ code: 'invalid_amount' }));
		expect(() => parseAmount('10-20', 'en')).toThrow(expect.objectContaining({ code: 'invalid_amount' }));
	});

	it('throws on invalid characters (security)', () => {
		expect(() => parseAmount('alert(1)', 'en')).toThrow(expect.objectContaining({ code: 'invalid_amount' }));
		expect(() => parseAmount('process.exit()', 'en')).toThrow(expect.objectContaining({ code: 'invalid_amount' }));
	});
});

describe('formatCurrency', () => {
	it('formats VND with no decimals', () => {
		const result = formatCurrency(50000, 'VND', 'vi');
		expect(result).toContain('50.000');
	});

	it('formats USD with 2 decimals', () => {
		const result = formatCurrency(1234, 'USD', 'en');
		expect(result).toContain('12.34');
	});
});

describe('formatNumber', () => {
	it('formats with locale separators', () => {
		expect(formatNumber(1000000, 'vi')).toBe('1.000.000');
		expect(formatNumber(1000000, 'en')).toBe('1,000,000');
	});
});

describe('formatDate', () => {
	it('formats vi-VN as dd/mm/yyyy', () => {
		const result = formatDate('2026-05-22', 'vi');
		expect(result).toBe('22/05/2026');
	});

	it('formats en-US as mm/dd/yyyy', () => {
		const result = formatDate('2026-05-22', 'en');
		expect(result).toBe('05/22/2026');
	});
});

describe('formatDateRelative', () => {
	/** Local calendar date as `YYYY-MM-DD` — matches formatDateRelative's convention. */
	function localKey(d: Date): string {
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${y}-${m}-${day}`;
	}

	it('returns Today for current date', () => {
		const today = localKey(new Date());
		setLanguageTag('en');
		expect(formatDateRelative(today, 'en')).toBe('Today');
		setLanguageTag('vi');
		expect(formatDateRelative(today, 'vi')).toBe('Hôm nay');
	});

	it('returns Yesterday for previous day', () => {
		const d = new Date();
		d.setDate(d.getDate() - 1);
		const yesterday = localKey(d);
		setLanguageTag('en');
		expect(formatDateRelative(yesterday, 'en')).toBe('Yesterday');
		setLanguageTag('vi');
		expect(formatDateRelative(yesterday, 'vi')).toBe('Hôm qua');
	});
});

import * as m from '$lib/paraglide/messages';
import { setLanguageTag } from '$lib/paraglide/runtime';

describe('paraglide runtime sync', () => {
	it('returns vi string after setLanguageTag(vi)', () => {
		setLanguageTag('vi');
		expect(m.nav_dashboard()).toBe('Tổng quan');
		setLanguageTag('en'); // restore for other tests
	});

	it('returns en string by default', () => {
		setLanguageTag('en');
		expect(m.nav_dashboard()).toBe('Dashboard');
	});
});

describe('form messages', () => {
	it('renders transaction type labels in vi', () => {
		setLanguageTag('vi');
		expect(m.forms_expense()).toBe('Chi tiêu');
		expect(m.forms_transfer()).toBe('Chuyển khoản');
		setLanguageTag('en');
	});

	it('renders validation messages in vi', () => {
		setLanguageTag('vi');
		expect(m.validation_name_required()).toBe('Tên là bắt buộc');
		setLanguageTag('en');
	});
});

describe('transactions messages', () => {
	it('renders empty state in vi', () => {
		setLanguageTag('vi');
		expect(m.transactions_empty_state()).toBe('Không có giao dịch nào.');
		setLanguageTag('en');
	});

	it('renders transaction count (split keys) in vi', () => {
		setLanguageTag('vi');
		expect(m.transactions_count_none()).toBe('Không có giao dịch nào');
		expect(m.transactions_count_many({ count: 5 })).toBe('5 giao dịch');
		setLanguageTag('en');
	});
});

describe('wave 3 messages', () => {
	it('renders budgets + reports + goals vi strings', () => {
		setLanguageTag('vi');
		expect(m.budgets_title()).toBe('Ngân sách');
		expect(m.reports_net_cash_flow()).toBe('Dòng tiền thuần');
		expect(m.goals_empty_state()).toBe('Tạo mục tiêu đầu tiên');
		setLanguageTag('en');
	});
});

describe('wave 4 messages', () => {
	it('renders accounts + debts vi strings', () => {
		setLanguageTag('vi');
		expect(m.accounts_assets()).toBe('Tài sản');
		expect(m.accounts_liabilities()).toBe('Nợ phải trả');
		expect(m.debts_i_owe()).toBe('Tôi nợ');
		setLanguageTag('en');
	});
});

describe('wave 5 messages', () => {
	it('renders settings + categories + layout vi strings', () => {
		setLanguageTag('vi');
		expect(m.settings_title()).toBe('Cài đặt');
		expect(m.categories_title()).toBe('Nhãn');
		expect(m.layout_warming_up()).toBe('Đang khởi động');
		setLanguageTag('en');
	});

	it('renders onboarding residual-literal keys vi strings', () => {
		setLanguageTag('vi');
		expect(m.forms_account_type_checking()).toBe('Tài khoản thanh toán');
		expect(m.onboarding_account_name_placeholder()).toBe('Tài khoản thanh toán của tôi');
		expect(m.onboarding_amount_hint()).toBe('vd. 5tr, 1000000');
		expect(m.onboarding_lang_desc_english()).toBe('Quản lý tài chính bằng tiếng Anh');
		expect(m.onboarding_lang_desc_vietnamese()).toBe('Quản lý tài chính bằng tiếng Việt');
		expect(m.onboarding_currency_desc_vnd()).toBe('Đồng Việt Nam');
		expect(m.onboarding_currency_desc_usd()).toBe('Đô la Mỹ');
		expect(m.layout_lang_label_en()).toBe('EN');
		setLanguageTag('en');
	});
});

describe('wave 6 messages', () => {
	it('renders backup + reports sub-page vi strings', () => {
		setLanguageTag('vi');
		expect(m.settings_backup()).toBe('Sao lưu & Dữ liệu');
		expect(m.settings_backup_export_sqlite()).toBe('Xuất SQLite');
		expect(m.settings_backup_confirm_title()).toBe('Thay thế cơ sở dữ liệu?');
		expect(m.reports_vs()).toBe('so với');
		expect(m.reports_compare_empty()).toBe('Chưa có dữ liệu so sánh. Thêm chi tiêu ở cả hai tháng để so sánh.');
		expect(m.reports_trend_empty()).toBe('Chưa có dữ liệu xu hướng. Thêm giao dịch qua nhiều tháng.');
		expect(m.reports_expense()).toBe('Chi');
		setLanguageTag('en');
	});

	it('renders backup + reports sub-page en strings', () => {
		setLanguageTag('en');
		expect(m.settings_backup()).toBe('Backup & Data');
		expect(m.settings_backup_export_csv()).toBe('Export CSV');
		expect(m.reports_category()).toBe('Category');
		expect(m.reports_change()).toBe('Change');
		setLanguageTag('en');
	});
});

import { mapError } from '$lib/utils/errors';

describe('backend error mapping', () => {
	it('maps AppError codes to localized strings', () => {
		setLanguageTag('vi');
		expect(mapError(new AppError('txn_not_found'))).toBe('Không tìm thấy giao dịch');
		expect(mapError(new AppError('account_currency_mismatch', { currency: 'USD' }))).toBe('Tất cả tài khoản phải dùng cùng một loại tiền. Các tài khoản hiện dùng USD');
		setLanguageTag('en');
		expect(mapError(new AppError('txn_not_found'))).toBe('Transaction not found');
	});
	it('falls back to errors_unknown for non-AppError', () => {
		setLanguageTag('en');
		expect(mapError(new Error('something weird'))).toBe('Something went wrong. Please try again.');
		expect(mapError('raw string')).toBe('Something went wrong. Please try again.');
	});
	it('falls back to errors_unknown for unknown AppError codes', () => {
		setLanguageTag('en');
		expect(mapError(new AppError('not_a_real_code'))).toBe('Something went wrong. Please try again.');
	});
});
