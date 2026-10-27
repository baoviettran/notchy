# Personal finance plans — review resolutions

**Serves:** STORY-038, STORY-039, STORY-040

Date: 2026-10-26. Scope: correct the approved design and its implementation plans
following the five plan-review findings. These are documentation resolutions;
application implementation and native feature acceptance have not started.

| Finding | Assessment | Resolution and owning tasks |
|---|---|---|
| F1 / P1: sum of bucket medians can be zero despite steady weekly spending | Confirmed with 12 synthetic weeks rotating 700,000 among three buckets | Forecast Task 6 uses median of aggregate weekly totals. Category attribution uses historical spending weights, conserving that total; exact offsets and display apportionment are specified. |
| F2 / P1: recorded future expenses omitted from both current cash and commitments | Confirmed against current `account_balance_as_of`, which filters `date <= as_of`; normal transaction insertion permits future dates | Forecast Task 5 reserves recorded future net outflows through the horizon, consolidates linked bill/schedule payments by stable IDs, and moves effects from commitments to cash when the date becomes effective. |
| F3 / P2: no contract for reserve-to-bill earmarks | Confirmed: previous allocation DTO only linked transactions and reserves | Forecast Tasks 1/3 add BillEarmark, set/release operations, payment provenance, partial consumption, cancellation/refund reversal and horizon-specific protection. Task 8 exposes that workflow. |
| F4 / P2: strict V1 draft payload conflicts with recovery of unknown payloads | Confirmed contract gap, rather than an existing runtime failure | Draft Tasks 1/3/5 use supported/unsupported/invalid per-record envelopes. Opaque rows preserve exact raw text, allow export/discard, and do not prevent other drafts loading. Forecast Task 7 preserves that envelope when adding V2. |
| F5 / P2: substring filters may select zero tests | Conditional verification risk: the implementation tests do not exist yet, so zero-test execution was not observed | All three plans run the complete named integration test targets and require nonzero executed tests including the new named behavior. A zero-selected success is explicitly not accepted as green. |

## Exact calculation decisions

For complete covered weeks, let M2 be twice the median of aggregate eligible
weekly totals. Let W_b be historical eligible spend in bucket b, W=sum(W_b), and D
the forecast interval in local calendar days. The unoffset baseline is
ceil(M2*D/14). If W>0, each category has exact attribution
V_b=M2*D*W_b/(14*W). If W=0 the baseline is zero.

Known ordinary commitments and protected ordinary spending offset these attributed
shares. Set Q=14*W and n_b=max(M2*D*W_b-Q*(R_b+C_b),0). Predicted additional spending
is U=ceil(sum(n_b)/Q); P=A-U. Display rounding is separate and never feeds this
calculation. Category attribution is a historical-share explanation of one overall
prediction, not an independent median prediction for each category.

Recorded future payments do not become cash early. A bill due within the horizon
is reserved at its remaining unpaid amount as of today; linked future payments
are part of that same commitment. If the bill is due later, recorded payments
inside the interval are still reserved. Effective-date transitions must recognize
each cash/settlement/reserve effect once.

Earmarked funds remain part of the reserve's unspent balance. Only the held amount
already represented in horizon commitments is excluded from horizon R. Holds for
later bills remain protected in R. Cancelling/releasing a bill returns unconsumed
hold to general reserve protection; it does not create cash.

## Verification performed during plan correction

- Synthetic 12-week rotation: all three individual bucket medians are 0, aggregate
  median is 700,000, and exact category shares sum to 1,000,000 over ten days.
- In-memory SQLite date example: current cash 5,000,000 and recorded future expense
  3,000,000 yield 2,000,000 availability both before and on the effective date.
- Earmark arithmetic: 500,000 reserve / 300,000 hold / 500,000 bill has horizon
  R=200,000; a funded payment of 100,000 preserves that R. Cancellation and linked
  refund return protection to the original reserve without creating cash.
- Example envelope decoding isolates supported, unsupported-version and malformed
  JSON rows while retaining unknown raw text exactly.

These are independent arithmetic/contract examples, not execution of the planned
application tests. The implementation plans carry the regression cases into real
SQLite, Rust, component and native acceptance tests.
