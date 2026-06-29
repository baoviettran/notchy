import type { Config } from 'tailwindcss';

export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	darkMode: 'class',
	theme: {
		extend: {
			colors: {
				// Adding Machine palette — values are CSS variables defined in app.css,
				// so each token flips with the html.light / html.dark class.
				ink: 'var(--ink)',
				tape: 'var(--tape)',
				ledger: 'var(--ledger)',
				dim: 'var(--dim)',
				line: 'var(--line)',
				phosphor: 'var(--phosphor)',
				'phosphor-bright': 'var(--phosphor-bright)',
				debit: 'var(--debit)'
			},
			fontFamily: {
				mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
				sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif']
			}
		}
	},
	plugins: []
} satisfies Config;
