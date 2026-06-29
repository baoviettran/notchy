import { describe, it, expect } from 'vitest';
import { parseAmount } from '$lib/utils/number_parse';
import { formatCurrency, formatNumber } from '$lib/utils/currency';
import { formatDate, formatDateRelative } from '$lib/utils/date';

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
		expect(() => parseAmount('', 'en')).toThrow('Invalid amount');
	});

	it('throws on zero or negative result', () => {
		expect(() => parseAmount('0', 'en')).toThrow('Invalid amount');
		expect(() => parseAmount('10-20', 'en')).toThrow('Invalid amount');
	});

	it('throws on invalid characters (security)', () => {
		expect(() => parseAmount('alert(1)', 'en')).toThrow('Invalid amount');
		expect(() => parseAmount('process.exit()', 'en')).toThrow('Invalid amount');
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
	it('returns Today for current date', () => {
		const today = new Date().toISOString().split('T')[0];
		setLanguageTag('en');
		expect(formatDateRelative(today, 'en')).toBe('Today');
		setLanguageTag('vi');
		expect(formatDateRelative(today, 'vi')).toBe('Hôm nay');
	});

	it('returns Yesterday for previous day', () => {
		const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0];
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
		expect(m.layout_lang_label_vi()).toBe('VI');
		setLanguageTag('en');
	});
});
