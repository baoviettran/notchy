# The User Story Inventory — the *why* layer

This directory is the **demand engine** for Notchy. It answers the question your
test suite and specs cannot: **does a real user want this?**

Your existing chain proves something different:

```
spec/plan (decided solution) → tests (it works) → quality gate (it ships only when green)
```

That chain validates *"did we build what we decided, correctly?"* It never asks
*"did a real user want it?"* This inventory is the **relevance gate** that sits
**upstream** of the spec. It is the source of truth for **what to build**; the
specs/plans/tests remain the source of truth for **how to build it**.

## The one rule that makes it the source of truth

> **No story → no spec.** Every spec/plan must trace to a story via a `Serves:`
> header. Priority flows stories → specs, never the other way around.

The inventory is a **numbered backlog of small, need-shaped stories** — not an
epic document. Adding a spec without a `Serves: STORY-0xx` header is a defect,
not a shortcut.

## The trap to avoid

A story that merely restates the feature is a spec in first-person. The value is
the shift from **solution-shaped** to **need-shaped**:

| Spec (solution) | Story (need) |
|---|---|
| "Add `quickAddReadback` helper + parsed readback" | "A user typing `coffee 4` wants *confirmation it landed right* before closing the window." |

In the need column you can already smell the acceptance criteria and the tests
that fall out — that is why the story is the source of truth for the spec, not a
decorative preamble. A story carries **four things**: the actor, the need, the
motivation (payoff), and — non-negotiable — an **evidence anchor**.

## A story is not real until it has an evidence anchor

If you cannot point at where the need came from, the story is a wish and it does
not graduate to a spec. In this project you have real sources already reaching
for you:

- **The bug inventory** — `specs/coverage-bug-inventory.md`. Every bug row has a
  buried real-user scenario. Bugs are evidence of needs.
- **The Actual→Notchy roadmap** — `feat/actual` ports ideas from Actual Budget;
  Actual's community/issues are *observed needs in the wild*.
- **Your own dogfooding** — the `ubuntu-dogfooding` work. Every friction you hit
  as the user is a story.
- **Interviews** — even 3–5 real users, 20 minutes, beats any amount of invention.

`index.md` is seeded from exactly those anchors. A row with no evidence anchor is
a placemarker, not a story.

## Story shape

Each row in `index.md`:

```
STORY-0xx — <a name, not a feature title>
  Actor:      who
  Need:       the job-to-be-done, not the solution
  Motivation: what it's worth to them
  Evidence:   <source anchor — MUST be a pointer, not "the team thought" >
  Status:     shipped / planned / backlog
  Serves:     <spec or plan that fulfills it>   ← the trace link
```

## Wiring (ENFORCED — do not regress)

`pnpm test:roadmap` (`scripts/roadmap.mjs`) generates `specs/STATUS.md`, and now
**hard-fails (exit 1)** on a broken trace:

- every plan file and its linked spec must carry a `**Serves:** STORY-0xx` header
  (parsed by `findServesIds`);
- a `Serves:` reference to a story id that does not exist as a table row in
  `product/stories/index.md` is an **unknown id** — a defect;
- both cases push into the `warnings` array → `process.exit(1)`.

`specs/STATUS.md` gains a `## Story coverage` trailer:

```
## Story coverage (traceability)
- Traced: 1 / 59 | Untraced: 58 | Unknown story ids: 0
- untraced: specs/plans/2026-08-28-test-coverage-cure.md
...
```

Pure functions (unit-tested): `extractStoryIdsFromInventory` (table rows only —
prose like "use STORY-010 next" is never counted), `findServesIds`,
`buildTraceFindings`, `renderStoryCoverage`.

**Retrofit state:** the 22 pre-existing plans/specs predate the inventory and are
not yet traced, so the gate is **intentionally red** until that retrofit lands.
That is the forcing function. Add `**Serves:** STORY-0xx` headers (creating the
story first if none exists) until `pnpm test:roadmap` exits 0. Do not weaken the
gate to paper over the backlog.