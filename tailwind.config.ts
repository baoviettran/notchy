import type { Config } from 'tailwindcss';

export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	darkMode: 'class',
	theme: {
		extend: {
			colors: {
				// Adding Machine palette — warm near-black casing + amber phosphor.
				ink: '#14110C',
				tape: '#1C1812',
				ledger: '#D6CFC0',
				dim: '#8A8170',
				line: '#2A2419',
				phosphor: '#FFB454',
				'phosphor-bright': '#FFD79A',
				debit: '#E5484D'
			},
			fontFamily: {
				mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
				sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif']
			}
		}
	},
	plugins: []
} satisfies Config;
