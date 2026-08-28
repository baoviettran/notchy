# Changelog

All notable changes to Notchy will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-08-28

### Added
- Budget management with category-level tracking
- Financial goals with progress tracking
- Debt management and payoff tracking
- Year-over-year and composition reports
- Accounts page with balance overview
- Auto-backup with configurable intervals
- Quick-add window (tray-based capture)
- Transaction categorization rules engine
- CSV import support
- Tour/onboarding flow for new users
- Keyboard shortcuts (`n` new transaction, `/` search, `Escape` close)
- Amount shortcuts (`50k`, `1.5tr`, `50k+30k`)
- Bilingual UI (English, Vietnamese)
- Local-first architecture — no cloud dependency

### Security
- Strict CSP policy configured
- Typed error system prevents internal state leaks
- Input validation on monetary values (safe integer range)

## [0.1.0] - 2026-07-01

### Added
- Initial release
- Transaction management with CRUD
- SQLite database with migration system
- Import/export (JSON format)
- Settings page with theme support
