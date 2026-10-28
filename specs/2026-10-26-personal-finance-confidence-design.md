# Automatic backups, durable drafts, and spending until next income

**Serves:** STORY-038, STORY-039, STORY-040

Status: approved by the owner on 2026-10-26; implementation planning requested.
Date: 2026-10-26. Interview source: the current Notchy product discussion.
Review corrections: aggregate weekly median with conserved category attribution; recorded future outflows; persisted bill earmarks; isolated opaque draft recovery; nonzero-test verification. See [resolution record](notes/2026-10-26-plan-review-resolution.md).

Implementation plans (execute in order):

1. [Automatic backups](plans/2026-10-26-automatic-backups.md)
2. [Durable transaction drafts](plans/2026-10-26-durable-transaction-drafts.md)
3. [Spending forecast](plans/2026-10-26-spending-forecast.md)

## 1. Evidence and decision status

The owner selected automatic backups, spending until payday, and drafts. Their
primary income arrives around day 10, but the product must support multiple fixed
income sources. They selected the nearest receipt date across those sources,
backups inside application storage, and retaining all unfinished drafts. They
accepted selecting spendable accounts, excluding savings and credit limits by
default. They requested habit-based prediction, proposed the median, and accepted
weekly medians rather than transaction/day medians.

Explicit owner decisions:

- Native local-first operation, using the existing application.
- Automatic backup destination: application data directory, isolated per profile.
- Preserve all transaction drafts, including incomplete and invalid input.
- Forecast horizon: nearest expected receipt across multiple fixed income sources.
- Available money uses selected spending accounts, not all assets/credit limits.
- Predict typical spending using weekly medians; do not silently treat missing
  history as zero spending.

Defaults proposed during design and included in the owner’s design approval:

- Delivery order: backup, durable drafts, spending/forecast.
- One automatic snapshot per local day when profile content changed; retention
  of seven daily representatives plus four weekly representatives.
- Twelve complete local calendar weeks of history, minimum eight usable weeks.
- No positive contribution from unreceived income or draft income.
- Projection is read-only and never changes envelope allocations or transactions.
- Initial forecast has no machine learning, automatic outlier removal, weekday
  seasonality, statistical confidence percentage, or external service.

## 2. Approaches considered

The discussion compared a primary-payday horizon with the nearest income date;
the owner selected the latter. It compared explicit save-draft with automatic
preservation; the owner selected preserving all unfinished input. For prediction,
an explainable statistical approach was recommended over machine learning, and
the owner specifically selected medians. Weekly totals avoid the zero-median
problem of sparse daily purchases. These choices form the proposed design.

Implementation proposal: extend the existing Rust-owned SQLite/profile boundary
and verified backup publisher. Browser/session storage alone would not satisfy
durability and multiple-window ownership. A separate cloud or sync service would
add scope without serving the accepted needs.

## 3. Existing behavior and integration constraints

- `src-tauri/src/profiles/backup.rs` publishes labeled, verified profile snapshots
  under coordinator transition locks and restores into a new profile.
- `src-tauri/src/database/backup.rs` already provides durable publication,
  revalidation, interrupted-publication cleanup, and schema-aware retention
  primitives. The new routine retention policy must not erase upgrade protection.
- `src/lib/backup/index.ts` contains an older JS auto-backup implementation. Do not
  wire this legacy SQL/filesystem path into the native application.
- `TransactionForm.svelte` currently keeps one new-transaction draft in
  `sessionStorage`; editing existing transactions is not persisted there.
- `src/lib/profiles/drafts.svelte.ts` coordinates dirty surfaces and discards during
  profile transitions. Durable transaction drafts require a preserve-and-flush
  transition path, while unrelated dirty settings keep their existing behavior.
- Native scheduled posting can auto-post income. Expected receipts in this design
  must not silently inherit that behavior or credit cash merely because a date passed.
- Existing financial receipts and caller-owned operation IDs protect retry safety.
  Draft submission and income confirmation must preserve that guarantee.
- Keep stateful editors outside the locale key and track their translated labels.
- The browser adapter remains a development/test environment, not a promise of
  persistent browser storage. Production acceptance uses installed native binaries.

## 4. Automatic backups

Use each profile's existing `backups/` area. Identify automatically managed
snapshots separately through durable metadata, leaving manual, legacy, migration,
reset, and external copies outside routine pruning.

On activation, resume, and periodically while running, the native service checks
whether the active profile has meaningful changes since its last successful
automatic snapshot and has no snapshot for the current local day. First meaningful
changes in a new profile qualify. Drafts and forecast settings count as content;
backup bookkeeping and last-open timestamps do not. Use a durable content revision
or equivalent, not filesystem mtime. Failed attempts do not advance success state.

Snapshot creation and revision capture coordinate with writes/profile transitions.
Only the revision actually captured is marked backed up. Changes arriving after
the snapshot remain dirty. Multiple windows do not create duplicate daily jobs.
Opening an inactive changed profile catches it up; no background OS service is
introduced. The UI states that automatic backup runs while Notchy is open.

Retention selects the union of the latest verified automatic snapshot on each of
the seven most recent snapshot-bearing dates, and the latest one in each of the
four most recent snapshot-bearing ISO weeks. Representatives may overlap; no
requirement to create eleven files. Keep the newest verified automatic snapshot
for every schema generation as an additional recovery floor. Revalidate candidates
before pruning, protect the just-created copy, and prune only after successful
publication. Never traverse arbitrary user paths or delete unknown files.

Use profile-local calendar dates and store the actual timestamp/offset used.
Clock rollback must not delete the only current snapshot. Metadata updates alone
must not start a self-sustaining backup loop. Failed publication retains all prior
copies; failed pruning is recorded separately from a successful new snapshot.

Settings exposes enabled state, last successful time, next eligibility, location,
and failure/retry status. Enable by default in the proposed release, with an off
switch. Keep manual export available and explain that same-disk copies do not
protect against disk failure. No signing/platform support expansion is implied.

## 5. Durable transaction drafts

Persist draft records inside each profile SQLite database so verified snapshots
and restore-as-new include drafts. Add new migrations; never edit released ones.
Use ULIDs, payload versioning, revision numbers and timestamps. List/get return a per-record supported/unsupported/invalid payload envelope. Unknown or structurally malformed payloads retain exact raw text for export/recovery, cannot autosave/submit, and permit explicit discard. One such row never prevents other drafts loading. Structurally valid but financially incomplete input remains a normal editable draft. Payloads preserve
raw text, kind, date, selected IDs, payee, description, transfer destination, quick
capture text, and original parsing locale/currency. Partial/invalid values are
allowed here, never in the financial ledger. An untouched blank editor creates no
draft; changing a field relative to its opening defaults makes it meaningful.

Support both new transactions and unfinished edits. An edit draft references the
original transaction and its baseline version; it stores proposed changes without
changing that transaction. Missing/archived account or category references remain
visible for repair. Editing a transaction changed elsewhere requires conflict
resolution; deleting the original does not silently turn its edit into a new entry.

Every editor starts with or opens an explicit draft ID. Autosaves are ordered and
revision-checked; independent drafts never overwrite each other. Two windows
opening the same draft receive an explicit ownership/conflict flow rather than
last-write-wins. Debounce is an implementation choice, but show saved only after
native acknowledgment. Flush before normal close, navigation, profile change,
Quick Add hiding, and switching to another draft. If flushing fails, retain input
and block that destructive transition with retry/discard choices. Sudden power
loss can lose edits not yet acknowledged; do not promise otherwise.

Closing an editor preserves its draft. Only explicit discard or successful submit
retires it. No age-based draft cleanup. Retired records/tombstones prevent late
autosaves from resurrecting discarded/submitted drafts. Profile deletion remains
an explicit destructive lifecycle operation with existing protections.

Submit validates ledger fields, freezes the submitted revision and uses one durable
operation ID. Creating/updating the ledger entry, linking its result, and retiring
the draft occur atomically in Rust. Lost IPC responses recover the same result;
they must not expose a committed entry as an outstanding draft or submit twice.
On reopen, pending submissions reconcile receipts before allowing another save.
Browser parity tests use real in-memory SQLite with the same semantics.

Migrate a valid legacy sessionStorage payload once into the currently bound
profile, using a stable import identity to survive retries. Remove legacy storage
only after native acknowledgment. Preserve malformed payloads for recovery, and
never import an `unbound` payload into an arbitrary profile.

## 6. Fixed income and forecast horizon

Represent expected income separately from ledger effects. Reuse recurrence/date
utilities and, where appropriate, schedule identities; add durable occurrence
identity and an expected/received/skipped state with optional revised receipt date.
Initial supported recurrence patterns match the app: weekly, biweekly, monthly,
yearly. The owner's day-10 source is ordinary monthly configuration, not hardcoded.

New forecast income sources require confirmation. Existing income schedules may
be explicitly enrolled by switching future occurrences to confirmation mode; do
not silently change unrelated schedules or reinterpret past auto-posted income.
Disable their automatic ledger posting through one validated native transition.
Confirmation requires an actual transaction date on or before local today and either creates the actual income transaction with the confirmed
amount/account/date, or links an existing income transaction (e.g. imported CSV).
That linking/creation and occurrence advancement are idempotent and atomic.

An enrolled source qualifies for the horizon only when its destination is a
selected spending account and the user marks it as funding day-to-day spending.
Income paid exclusively into excluded savings or fully protected purposes remains
visible in the income list but cannot shorten the spending horizon. Selection
changes immediately re-evaluate eligibility; never silently add the destination
account to selected cash.

The horizon is the earliest pending receipt date across eligible enrolled sources.
Same-date receipts share one horizon. Multiple pending occurrences are identified
by source and original scheduled date; postponement does not create a second one.
Disabled/deleted sources cease contributing future dates. Skipping a receipt
advances that source without recording income.

Due today or overdue/unconfirmed receipts remain visible and require confirmation,
rescheduling or skipping; do not silently roll the horizon forward and imply the
income arrived. Until resolved, pause both dated A and P; show selected account
balances, protected amounts and known overdue bills separately, without calling
their subtotal spendable. With no eligible source show the same incomplete state
and setup guidance, not an invented payday. Income
expected in the future never increases available cash today.

The forecast covers today through the day before the horizon date. Show that
boundary explicitly; obligations due on the income date are conservatively
reserved too, since receipt time within that day is unknown. Use local calendar
arithmetic, not UTC-day slicing or a fixed 24-hour divisor across DST.

## 7. Available-to-spend calculation

Initial eligible accounts: selected nonarchived cash/checking accounts. Savings
are excluded by default but can be deliberately selected. Credit limits, loan
receivables, investments, and expected income are not cash. Known credit-card
payments can be explicit obligations; never infer a payment amount from a limit.

Let B be the sum of current posted balances of selected accounts (including
negative balances), C the remaining due obligations through the horizon, R the
explicit protected reserves backed by money still inside selected accounts, and
E the additional chosen cash buffer. Available A = B - C - R - E. Preserve a
negative result as a shortfall rather than clamping it to zero.

For this first version, obligations consist of future/unpaid expense-schedule
occurrences plus explicitly entered one-off forecast bills (amount, due date,
paying account and optional spending bucket). A manual bill is forecast-only until
the user links a posted payment or confirms a payment that creates the ledger
entry. Support partial payments and explicit cancellation, with stable bill and
payment IDs; native transactions and receipts guard each transition. Card/debt
payments may be entered this way but do not introduce interest calculations,
statement reconciliation or a second debt ledger. Planned outgoing transfers to
excluded accounts can be entered as commitments and settled by linking the actual
transfer; transfers entirely within selected accounts do not consume cash. Existing
debt balances are not automatically turned into bills. Only obligations paid from
selected accounts contribute to C. Linked settlements reduce remaining amounts,
and editing/deleting a settlement recalculates them under the same native boundary.
Prevent over-linking a payment or overpaying a commitment without an explicit
adjustment to its expected amount. One transaction can settle only one obligation
in this version; multiple transactions can settle a single obligation.

Persist a bill earmark as a separate link: id, reserve ID, obligation ID, total
allocated amount, revision and active/released status. Expose held and consumed
amounts as date-aware derived values. One bill has at most one active earmark;
one reserve can fund several bills provided their holds do not exceed its unspent
balance. Setting/updating/releasing an earmark is a receipt-backed atomic domain
operation. Changing its reserve/bill after any consumption requires releasing the
remaining hold and creating a new link; never rewrite historical payment ownership.

A reserve's remaining amount includes its unspent held money. For horizon-specific
calculation, R is that remaining amount minus earmarks already represented in C.
A hold for a bill outside this horizon stays protected in R; it does not become
spendable merely because the bill is not yet due. If a recorded early payment is
within the horizon, only the held portion covering that commitment moves to C.
An earmark never creates more protected money or changes the ledger.

Payment consumes the active earmark first up to its held amount. Store attribution
from that transaction to the earmark/reserve atomically with settlement; both B and
C decrease by the effective payment, while reserve remaining and earmark hold
shrink by the funded portion. The residual R is consequently not deducted twice.
Partial payment keeps the residual hold. Cancellation/release returns unconsumed
hold to general reserve protection without changing cash. Payment deletion/edit
and linked refunds reverse exact original attribution: restore the hold if the
bill and earmark remain active, otherwise return it to the original reserve.
Never replenish beyond the actually consumed amount. Reopening a settled bill
requires re-evaluating its commitment/hold consistently.

Money already outside selected accounts is absent from B and is not deducted
again. Direct reserve allocations and bill-funded allocations cannot own the same
unit. Use stable links, not payee/amount guesses, for payment and draft matching.

Initial reserves and buffer are explicit user inputs. Do not automatically subtract
all envelope allocations, goal target amounts, or the To Budget pool: those are
different views of the same money. Permit named protected reserves with account
backing; validate backing on account-selection changes. A reserve can optionally
identify one spending bucket it funds, with an explicit amount; it never excludes
that bucket's history. Section 8 offsets only that earmarked amount against its
bucket's prediction. Savings reserves have no consumption bucket. Future budget
integration requires explicit ownership/allocation rules.

Honor known unpaid obligations, including overdue expenses. Compute posted cash B
as of local today. Every already-recorded expense or net outgoing transfer dated
after today and on/before the horizon is also a known future outflow: it must be
reserved even when it has no schedule, manual bill or draft. Incoming future-dated
transactions do not increase B or confirm that income has actually been received.

Consolidate obligations, schedule occurrences and recorded future payments by stable
IDs. For a bill due within the horizon, reserve its remaining unpaid amount as of
today; linked future payments are covered by that same commitment and do not add
another C item. For a bill due after the horizon, reserve any actual recorded
outgoing payments dated within the horizon. Multiple partial future payments sum
once; never exceed their linked bill's outstanding amount without explicit review.
Unlinked future transaction outflows have their own transaction-ID commitment.
Ordinary categorized future expenses supply a baseline offset; scheduled,
exceptional or unclassified outflows are additional costs. Receipt-day outflows
are conservatively additional. Uncertain legacy links require review, not guessed
deduplication.

When the calendar reaches a transaction's date, it becomes part of B, disappears
from the future-outflow portion of C, and its effective settlement/allocation is
recognized once. Remaining bill/reserve amounts are derived as of the evaluation
date: recording a future payment does not prematurely declare a bill paid or a
reserve spent. This date transition must neither omit nor double-count the debit.
New schedule posting records occurrence-to-transaction links; already effective
posted schedule payments are not unpaid forecast commitments.

## 8. Median spending prediction

Use up to twelve complete Monday–Sunday local calendar weeks before the current
week, with at least eight usable weeks before publishing a numeric prediction.
History starts at a user-confirmed coverage date (with an explicit default shown
from their entered/imported history). Merely finding an old transaction is not
proof that every intervening week is complete. Missing weeks are excluded; zero
spending in confirmed covered weeks is a real zero. Show coverage and sample count.

Group eligible posted expense transactions by budgeting bucket (plus uncategorized).
Use expenses paid from selected spending accounts for initial scope. The UI states
that purchases paid through excluded accounts/cards are outside this forecast;
known payments from selected accounts belong in C. Exclude transfers, income,
adjustments, linked scheduled obligations, and user-marked exceptional purchases.
Do not auto-remove large purchases: the owner can include/exclude them explicitly.
Linked refunds reduce the original expense week's total, floored at zero for that
expense. Unlinked refunds affect cash but do not invent negative typical spending.

For each covered week first sum all eligible bucket spending, then calculate the
median of those weekly totals. This aggregate weekly median is the prediction
baseline. Do not sum independently calculated bucket medians: three rotating
buckets can each have a zero median even when total spending is 700,000 every week.
A zero aggregate median with nonzero occasional spending still needs a notice.

For D calendar days in the forecast interval, baseline interval spending is
V = ceil(M2 * D / 14), where M2 is twice the median total weekly spending. For an
even sample count M2 is the sum of the central two totals; for an odd count it is
twice the central total. Keep all intermediates exact; round only final displayed
minor-unit values. The initial prediction assumes a uniform daily rate.

Category explanations allocate this single baseline by observed spending shares:
W_b is eligible spending in bucket b summed over the same covered weeks and
W = sum(W_b). Before rounding, V_b = M2 * D * W_b / (14 * W). Thus sum(V_b) exactly
equals the unrounded aggregate prediction. These are attributed shares, not bucket medians.
If W=0, all history is zero and V and all category shares are zero. Category display
values use largest-remainder apportionment to sum to displayed V (ties by stable
bucket ID, uncategorized last); displayed rounded shares never feed calculations.

A reserve explicitly funding bucket b offsets its attributable forecast by R_b.
Ordinary known future spending in that bucket already reserved in C offsets it by
C_b. An ordinary item qualifies for C_b only from today through the day before the
receipt date. Overdue, receipt-day, scheduled (history-excluded), exceptional and
uncategorized-treatment-unknown commitments are additional costs, not offsets.
Savings reserves and the general buffer do not offset any category. A bill earmark
belongs to C only while that bill is in this horizon; it is never also R_b.

Predicted additional spending is U = ceil(sum(max(V_b - R_b - C_b, 0))) and
predicted remainder is P = A - U. Use the common exact denominator 14*W before
summing and rounding. With no offsets, U=V. Preserve a negative P as a shortfall.
Example: B=2,000,000, a food reserve R=400,000 and food interval attribution 700,000
produce A=1,600,000 and P=1,300,000. An ordinary food commitment of 400,000 with no
reserve yields the same result. Excess protected reserve stays protected.

V_b is a historical-share attribution of the overall typical-spending scenario,
not an independent category prediction or a guarantee. Show aggregate weekly
median, coverage, category weights, deductions and exclusions. Actual habits may
exceed the configured budget. No fabricated confidence percentage or prediction
interval is displayed.

## 9. Draft impact on spending

Keep official A/P based on posted ledger state. Offer a clearly separate draft
scenario and the count of drafts that cannot yet be evaluated. Draft income never
increases spendable money. New expense/refund/edit/transfer drafts have different
effects; apply their delta against the baseline, not their entire amount blindly.

Protected reserve balances are remaining amounts, not immutable initial targets.
An expense or outgoing transfer explicitly linked to a reserve consumes its linked
allocation when the ledger date becomes effective; future-dated allocations are
held until then and represented by their forecast commitment; no automatic consumption by matching bucket alone. Each
allocation belongs to exactly one reserve and cannot exceed either the payment
or remaining reserve. Spending beyond that allocation is unprotected spending.
Persist the allocation alongside the transaction atomically. Edits/deletions reverse
the old allocation and apply the new one; linked refunds replenish only the refunded
portion of that allocation, up to the amount actually consumed. They also affect B
normally, so cash and protection move together. Reject incompatible account/reserve
changes until the user resolves the link. An obligation’s earmark follows section 7: payment reduces B/C and consumes the linked reserve/hold together, so general horizon-specific R is not deducted again.

Draft scenarios have two phases, without writing any ledger/reserve state:

1. Past/current drafts: simulate valid expense/transfer entries as if posted,
   applying B, C and reserve-allocation deltas together. A pending bill payment
   reduces scenario B and releases the same paid amount from C. A reserve-funded
   purchase reduces B and its linked remaining R. Future median spending remains
   additional spending from now, so do not subtract these incurred expenses from V.
2. Future drafts before the horizon: convert unlinked known outflows into temporary
   forecast obligations. They increase scenario C, not B. Move any explicitly
   allocated reserve amount from R to the temporary obligation so it is reserved
   once. Ordinary expenses also contribute to C_b; exceptional expenses do not.
   Recompute section 8 using these scenario values. Thus a future ordinary purchase
   overlaps V via max(V_b - R_b - C_b, 0), rather than being added twice. A draft
   payment already linked to an existing bill creates no extra obligation; show it
   as the planned settlement. Explicit changes to its amount require reconciliation
   with that bill before the scenario is considered complete.

Transfers only affect selected cash when crossing its boundary; an outgoing future
transfer becomes a temporary obligation with the same horizon-specific reserve/earmark representation rules.
Incoming draft income/refunds/transfers from excluded accounts do not increase
spendable cash until posted. Within-selected-account transfers have zero aggregate
cash effect. Future drafts on the receipt date are displayed separately and treated
conservatively as receipt-day obligations, with no ordinary-baseline offset.

An edit draft first reverses its original ledger effect and original allocation in
scenario state, then applies the proposed replacement using the relevant phase.
Do not reverse an original that has changed since the draft baseline: require
conflict resolution. A changed incoming entry can reduce scenario cash, but an
unconfirmed positive delta never increases it. Drafts after the horizon do not
alter the interval. Unknown amount, account, date, allocation or obligation links
are counted as unquantified, not zero. Ambiguous save receipts are resolved before
calculating draft impact. Full simulation is a separate final implementation slice;
until it passes validation, show draft counts/completeness warnings only.

## 10. Data boundaries and delivery

Keep native orchestration in Rust and use typed domain commands, profile sessions,
ULIDs and receipt semantics. No frontend SQL/file copying. New schema migrations
must preserve old ledgers and run through verified upgrade backups. Durable drafts,
income occurrence state, coverage/exclusion settings and reserve configuration
belong to the profile database; restore-as-new preserves them under the new profile
identity without replaying already committed submissions. Backup scheduler metadata
must be rebound to the restored profile/path and not authorize pruning source files.

Deliver three independently reviewable slices: automatic backup, durable drafts,
then forecast (income confirmation, available money, median model, draft scenario).
No OS background agent, bank integration, sync, investment forecasts, mobile build,
encryption project or UI redesign is included. Add English/Vietnamese strings and
keep the existing design system. Builder chooses concrete schema names, intervals,
component decomposition, and test fixture layout subject to these invariants.

## 11. Verification and acceptance

Write failing behavior tests before implementation, with real SQLite. Required
checks for the relevant slices include:

- Backup: changed/unchanged days, first activation, two windows, concurrent mutation,
  profile switch, interrupted publication, corrupt snapshot, full disk/permission
  errors, failed pruning, weekly/daily overlap, schema recovery floor, clock changes,
  preservation of manual/reset/upgrade backups, and restored scheduler identity.
- Drafts: partial and invalid input, exact text/date/locale preservation, multiple
  drafts, normal restart, edit conflicts, stale autosaves, flush failures, profile
  switch, main/Quick Add races, legacy migration, atomic submit and lost-response
  retry, restore-as-new, and no financial effect until a successful commit.
- Income/availability: multiple sources, equal dates, month ends/leap days,
  confirmed/import-linked income, postponement/skip, stale confirmation retries,
  negative balances, excluded savings/credit, partial bill payments, obligations
  due on receipt date, and prevention of reservation double counting.
- Median: sparse zero weeks vs unknown weeks, fewer than eight covered weeks,
  exceptional purchases, refunds, even sample sizes, category regrouping, interval
  boundaries, overflow protection and integer rounding. Assert the numeric example:
  A=2,000,000 VND, weekly baseline=700,000, D=10 => V=1,000,000, P=1,000,000. Rotating three buckets with 700,000 total each week must retain a 700,000 aggregate weekly median despite zero individual bucket medians.
- Draft scenario: past/current expense, future habitual vs exceptional expense,
  partial linked bill, transfer across account boundaries, original edit deltas,
  invalid draft counts, and no duplication after a committed-but-unacknowledged save.

Run pnpm check/test, relevant E2E, Rust tests/Clippy, generated-contract checks and
the roadmap trace gate. Native installed-app acceptance must demonstrate real
backup/restore and reopening incomplete drafts; browser tests alone do not prove
durability. This document adds no passing-test or release-readiness claims.
