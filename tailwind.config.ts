import type { Config } from 'tailwindcss';

export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	darkMode: 'class',
	theme: {
		extend: {
			colors: {
				// Adding Machine palette — values are RGB-triplet CSS variables
				// (defined in app.css as --*-rgb) so Tailwind v3's opacity
				// modifier can apply an alpha channel via <alpha-value>. The
				// triplet flips with the html.light / html.dark class, same as
				// the hex --* vars they pair with.
				ink: 'rgb(var(--ink-rgb) / <alpha-value>)',
				tape: 'rgb(var(--tape-rgb) / <alpha-value>)',
				ledger: 'rgb(var(--ledger-rgb) / <alpha-value>)',
				dim: 'rgb(var(--dim-rgb) / <alpha-value>)',
				line: 'rgb(var(--line-rgb) / <alpha-value>)',
				phosphor: 'rgb(var(--phosphor-rgb) / <alpha-value>)',
				'phosphor-bright': 'rgb(var(--phosphor-bright-rgb) / <alpha-value>)',
				debit: 'rgb(var(--debit-rgb) / <alpha-value>)'
			},
			fontFamily: {
				mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
				sans: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif']
			}
		}
	},
	plugins: [
		// Hover-reveal affordances must never hide content on touch devices,
		// so the reveal is gated behind an actual fine-pointer media query
		// instead of assuming hover exists wherever there is no `touch`.
		function ({ addVariant }: { addVariant: (name: string, definition: string) => void }) {
			addVariant('pointer-fine', '@media (pointer: fine)');
		}
	]
} satisfies Config;
