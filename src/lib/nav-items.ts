/**
 * Shared navigation item definitions for Sidebar and BottomNav.
 * Single source of truth for route paths, labels, SVG icon paths,
 * and tour IDs — eliminates duplication between the two nav components.
 */
import * as m from '$lib/paraglide/messages';

export interface NavItem {
	href: string;
	key: string;
	label: () => string;
	tourId?: string;
}

export const primaryNav: NavItem[] = [
	{ href: '/', key: 'dashboard', label: () => m.nav_dashboard() },
	{ href: '/transactions', key: 'transactions', label: () => m.nav_transactions(), tourId: 'transactions' },
	{ href: '/budgets', key: 'budgets', label: () => m.nav_budgets(), tourId: 'budgets' },
	{ href: '/reports', key: 'reports', label: () => m.nav_reports() }
];

export const secondaryNav: NavItem[] = [
	{ href: '/accounts', key: 'accounts', label: () => m.nav_accounts(), tourId: 'accounts' },
	{ href: '/goals', key: 'goals', label: () => m.nav_goals() },
	{ href: '/debts', key: 'debts', label: () => m.nav_debts() },
	{ href: '/settings', key: 'settings', label: () => m.nav_settings(), tourId: 'settings' }
];

/** Single-stroke SVG glyph set — one visual language across nav. */
export const icons: Record<string, string> = {
	dashboard: 'M3 12h7V3H3zM14 21h7v-9h-7zM14 3v6h7V3zM3 21h7v-3H3z',
	transactions: 'M4 6h16M4 12h16M4 18h10',
	budgets: 'M3 17l5-5 4 4 8-8M21 8v5h-5',
	reports: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
	accounts: 'M3 7h18v12H3zM3 11h18M7 15h4',
	goals: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
	debts: 'M3 12h13M11 7l5 5-5 5M19 4v16',
	settings: 'M12 9a3 3 0 100 6 3 3 0 000-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2'
};

export function isActive(href: string, path: string): boolean {
	return href === '/' ? path === '/' : path === href || path.startsWith(href + '/');
}
