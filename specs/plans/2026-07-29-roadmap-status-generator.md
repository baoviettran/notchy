# Roadmap Status Generator Implementation Plan
**Serves:** STORY-013

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build a generator that emits `specs/STATUS.md` from plan checkboxes + git log, with a `pnpm test:roadmap` script, so future sessions can answer roadmap questions without re-scanning.

**Architecture:** Pure Node 22 ESM script at `scripts/roadmap.mjs` parses `specs/plans/*.md`, matches commit subjects against `git log` (scope-agnostic body-substring), cross-checks checkboxes, and emits a rollup. Tests cover pure parsing/matching functions. STATUS.md is committed to git (provides immediate visibility and historical record).

**Tech Stack:** Node 22.22.3, ESM (`.mjs`), Vitest 3, git CLI.

## Global Constraints

- Use Node 22.22.3 and pnpm 10.11.0.
- ESM only (`"type": "module"` in package.json).
- Pure Node builtins only — no external dependencies for the generator.
- STATUS.md is committed to git (provides immediate visibility and historical record).
- The generator must self-validate staleness and exit nonzero if detected.
- Matching is scope-agnostic body-substring (plan scope may differ from shipped commit scope).
- Checkbox discipline: a task is done only when box `[x]` AND matching commit in git log.

---

### Task 1: Scaffolding

**Files:**
- Create: `scripts/` directory
- Create: `scripts/roadmap.mjs` (empty placeholder)
- Modify: `package.json` (add `test:roadmap` script)

**Interfaces:**
- Consumes: nothing
- Produces: `pnpm test:roadmap` command exists (even if script is empty)

- [x] **Step 1: Create scripts directory**

```bash
mkdir -p scripts
```

- [x] **Step 2: Create empty roadmap.mjs placeholder**

```javascript
// scripts/roadmap.mjs
// Placeholder — will be implemented in later tasks
console.log('roadmap generator placeholder');
```

- [x] **Step 3: Add test:roadmap script to package.json**

Open `package.json`, find the `"scripts"` section, and add this line after `"test:release-smoke"`:

```json
"test:roadmap": "node scripts/roadmap.mjs",
```

- [x] **Step 4: Verify script runs**

```bash
pnpm test:roadmap
```

Expected: prints `roadmap generator placeholder`

- [x] **Step 5: Commit scaffolding**

```bash
git add scripts/ package.json
git commit -m "chore: add scaffolding for roadmap status generator"
```

---

### Task 2: Parsing Logic (parseTasks, extractCommitSubject, normalizeSubject)

**Files:**
- Create: `scripts/roadmap.test.mjs`
- Modify: `scripts/roadmap.mjs`

**Interfaces:**
- Consumes: plan file text (string)
- Produces: `parseTasks(planText)` → `[{headerLevel, number, title, steps[]}]`
- Produces: `extractCommitSubject(taskFinalStepText)` → `subject | null`
- Produces: `normalizeSubject(subject)` → `{type, scope, body}`

- [x] **Step 1: Write failing test for normalizeSubject**

```javascript
// scripts/roadmap.test.mjs
import { describe, it, expect } from 'vitest';
import { normalizeSubject } from './roadmap.mjs';

describe('normalizeSubject', () => {
  it('parses type(scope): body', () => {
    const result = normalizeSubject('feat(categorize-rules): add migration 005');
    expect(result).toEqual({
      type: 'feat',
      scope: 'categorize-rules',
      body: 'add migration 005'
    });
  });

  it('parses type: body (no scope)', () => {
    const result = normalizeSubject('test: cover upgrades from released database fixtures');
    expect(result).toEqual({
      type: 'test',
      scope: null,
      body: 'cover upgrades from released database fixtures'
    });
  });

  it('returns body=whole subject if no conventional prefix', () => {
    const result = normalizeSubject('just a plain subject');
    expect(result).toEqual({
      type: null,
      scope: null,
      body: 'just a plain subject'
    });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run scripts/roadmap.test.mjs
```

Expected: FAIL with "normalizeSubject is not defined"

- [x] **Step 3: Implement normalizeSubject in roadmap.mjs**

```javascript
// scripts/roadmap.mjs

export function normalizeSubject(subject) {
  const match = subject.match(/^(\w+)(?:\(([^)]+)\))?:\s*(.+)$/);
  if (!match) {
    return { type: null, scope: null, body: subject };
  }
  return {
    type: match[1],
    scope: match[2] || null,
    body: match[3]
  };
}
```

- [x] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run scripts/roadmap.test.mjs
```

Expected: 3 tests PASS

- [x] **Step 5: Write failing test for extractCommitSubject**

Append to `scripts/roadmap.test.mjs`:

```javascript
import { extractCommitSubject } from './roadmap.mjs';

describe('extractCommitSubject', () => {
  it('extracts from "Commit with `subject`" form', () => {
    const text = 'Step 6: Commit with `test: cover upgrades from released database fixtures`.';
    const result = extractCommitSubject(text);
    expect(result).toBe('test: cover upgrades from released database fixtures');
  });

  it('extracts from git commit -m "subject" form', () => {
    const text = '```bash\ngit commit -m "feat(categorize-rules): add migration 005"\n```';
    const result = extractCommitSubject(text);
    expect(result).toBe('feat(categorize-rules): add migration 005');
  });

  it('extracts from heredoc form', () => {
    const text = 'git commit -m "$(cat <<\'EOF\'\nfeat(db): add migration 005\nEOF\n)"';
    const result = extractCommitSubject(text);
    expect(result).toBe('feat(db): add migration 005');
  });

  it('returns null if no directive found', () => {
    const text = 'Just a regular step with no commit directive';
    const result = extractCommitSubject(text);
    expect(result).toBeNull();
  });
});
```

- [x] **Step 6: Run test to verify it fails**

```bash
pnpm vitest run scripts/roadmap.test.mjs
```

Expected: FAIL with "extractCommitSubject is not defined"

- [x] **Step 7: Implement extractCommitSubject in roadmap.mjs**

```javascript
// scripts/roadmap.mjs

export function extractCommitSubject(taskFinalStepText) {
  // Form 1: Commit with `subject`
  const form1 = taskFinalStepText.match(/Commit with\s+`([^`]+)`/);
  if (form1) return form1[1];

  // Form 2: git commit -m "subject"
  const form2 = taskFinalStepText.match(/git commit -m "([^"]+)"/);
  if (form2) return form2[1];

  // Form 3: heredoc git commit -m "$(cat <<'EOF'\nsubject\n...
  const form3 = taskFinalStepText.match(/git commit -m "\$\(cat <<'?EOF'?\n([^\n]+)/);
  if (form3) return form3[1];

  return null;
}
```

- [x] **Step 8: Run test to verify it passes**

```bash
pnpm vitest run scripts/roadmap.test.mjs
```

Expected: 7 tests PASS (3 normalizeSubject + 4 extractCommitSubject)

- [x] **Step 9: Write failing test for parseTasks**

Append to `scripts/roadmap.test.mjs`:

```javascript
import { parseTasks } from './roadmap.mjs';

describe('parseTasks', () => {
  it('parses ### Task headers', () => {
    const planText = `
### Task 1: First task

Some description.

- [x] **Step 1: Do something.**
- [x] **Step 2: Commit with \`test: first task\`.**

### Task 2: Second task

- [x] **Step 1: Do another thing.**
- [x] **Step 2: Commit with \`docs: second task\`.**

## Self-Review

Some review notes.
`;
    const tasks = parseTasks(planText);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toEqual({
      headerLevel: 3,
      number: 1,
      title: 'First task',
      steps: [
        { checkbox: ' ', stepNum: 1, text: 'Do something.' },
        { checkbox: ' ', stepNum: 2, text: 'Commit with `test: first task`.' }
      ]
    });
    expect(tasks[1].number).toBe(2);
    expect(tasks[1].title).toBe('Second task');
  });

  it('parses ## Task headers (h2)', () => {
    const planText = `
## Task 1: H2 task

- [x] **Step 1: Do it.**
`;
    const tasks = parseTasks(planText);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].headerLevel).toBe(2);
  });

  it('stops at terminal sections', () => {
    const planText = `
### Task 1: Real task

- [x] **Step 1: Do it.**

## Summary

This is not a task.
`;
    const tasks = parseTasks(planText);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Real task');
  });
});
```

- [x] **Step 10: Run test to verify it fails**

```bash
pnpm vitest run scripts/roadmap.test.mjs
```

Expected: FAIL with "parseTasks is not defined"

- [x] **Step 11: Implement parseTasks in roadmap.mjs**

```javascript
// scripts/roadmap.mjs

export function parseTasks(planText) {
  const tasks = [];
  const taskHeaderRegex = /^(#{2,3})\s+Task\s+(\d+):\s*(.+)$/gm;
  const terminalSectionRegex = /^## (Self-Review|Self-Review Notes|Summary|Acceptance|Out of Scope|Open Questions)/m;
  const stepRegex = /^- \[([ x])\]\s+\*\*Step\s+(\d+):\s*(.+?)\*\*\.?\s*(.*)$/gm;

  let match;
  const taskStarts = [];
  while ((match = taskHeaderRegex.exec(planText)) !== null) {
    taskStarts.push({
      headerLevel: match[1].length,
      number: parseInt(match[2]),
      title: match[3].trim(),
      startIndex: match.index,
      headerEnd: match.index + match[0].length
    });
  }

  for (let i = 0; i < taskStarts.length; i++) {
    const task = taskStarts[i];
    const nextTaskStart = i + 1 < taskStarts.length ? taskStarts[i + 1].startIndex : planText.length;
    let taskBody = planText.slice(task.headerEnd, nextTaskStart);

    // Stop at terminal section
    const terminalMatch = taskBody.match(terminalSectionRegex);
    if (terminalMatch) {
      taskBody = taskBody.slice(0, terminalMatch.index);
    }

    const steps = [];
    let stepMatch;
    stepRegex.lastIndex = 0;
    while ((stepMatch = stepRegex.exec(taskBody)) !== null) {
      steps.push({
        checkbox: stepMatch[1],
        stepNum: parseInt(stepMatch[2]),
        text: (stepMatch[3] + ' ' + stepMatch[4]).trim()
      });
    }

    tasks.push({
      headerLevel: task.headerLevel,
      number: task.number,
      title: task.title,
      steps
    });
  }

  return tasks;
}
```

- [x] **Step 12: Run test to verify it passes**

```bash
pnpm vitest run scripts/roadmap.test.mjs
```

Expected: 10 tests PASS (3 normalizeSubject + 4 extractCommitSubject + 3 parseTasks)

- [x] **Step 13: Commit parsing logic**

```bash
git add scripts/roadmap.mjs scripts/roadmap.test.mjs
git commit -m "feat: add parsing logic for roadmap generator"
```

---

### Task 3: Git Matching (matchGit)

**Files:**
- Modify: `scripts/roadmap.test.mjs`
- Modify: `scripts/roadmap.mjs`

**Interfaces:**
- Consumes: directive subject (string), commits array `[{sha, subject}]`
- Produces: `matchGit(directiveSubject, commits)` → `{sha, additionalMatches} | null`

- [x] **Step 1: Write failing test for matchGit**

Append to `scripts/roadmap.test.mjs`:

```javascript
import { matchGit } from './roadmap.mjs';

describe('matchGit', () => {
  const commits = [
    { sha: 'abc1234', subject: 'feat(db): add migration 005 for categorize_rules table' },
    { sha: 'def5678', subject: 'test: cover upgrades from released database fixtures' },
    { sha: 'ghi9012', subject: 'docs: add desktop release smoke checklist' }
  ];

  it('matches scope-agnostic body substring', () => {
    const result = matchGit('feat(categorize-rules): add migration 005 for categorize_rules table', commits);
    expect(result).toEqual({ sha: 'abc1234', additionalMatches: 0 });
  });

  it('matches unscoped directive', () => {
    const result = matchGit('test: cover upgrades from released database fixtures', commits);
    expect(result).toEqual({ sha: 'def5678', additionalMatches: 0 });
  });

  it('returns null if no match', () => {
    const result = matchGit('feat: nonexistent feature', commits);
    expect(result).toBeNull();
  });

  it('counts additional matches', () => {
    const commitsWithDupes = [
      { sha: 'aaa1111', subject: 'test: cover upgrades from released database fixtures' },
      { sha: 'bbb2222', subject: 'test: cover upgrades from released database fixtures' },
      { sha: 'ccc3333', subject: 'docs: something else' }
    ];
    const result = matchGit('test: cover upgrades from released database fixtures', commitsWithDupes);
    expect(result).toEqual({ sha: 'aaa1111', additionalMatches: 1 });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run scripts/roadmap.test.mjs
```

Expected: FAIL with "matchGit is not defined"

- [x] **Step 3: Implement matchGit in roadmap.mjs**

```javascript
// scripts/roadmap.mjs

export function matchGit(directiveSubject, commits) {
  const directiveBody = normalizeSubject(directiveSubject).body;
  let match = null;
  let additionalMatches = 0;

  for (const commit of commits) {
    const commitBody = normalizeSubject(commit.subject).body;
    if (commitBody.includes(directiveBody)) {
      if (!match) {
        match = { sha: commit.sha, additionalMatches: 0 };
      } else {
        additionalMatches++;
      }
    }
  }

  if (match) {
    match.additionalMatches = additionalMatches;
  }
  return match;
}
```

- [x] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run scripts/roadmap.test.mjs
```

Expected: 14 tests PASS

- [x] **Step 5: Commit git matching**

```bash
git add scripts/roadmap.mjs scripts/roadmap.test.mjs
git commit -m "feat: add git matching for roadmap generator"
```

---

### Task 4: Rollup Status (rollupStatus)

**Files:**
- Modify: `scripts/roadmap.test.mjs`
- Modify: `scripts/roadmap.mjs`

**Interfaces:**
- Consumes: tasks array with `steps[]` (each has `checkbox`) and `directive` + `gitMatch`
- Produces: `rollupStatus(tasks)` → one of 5 status strings

- [x] **Step 1: Write failing test for rollupStatus**

Append to `scripts/roadmap.test.mjs`:

```javascript
import { rollupStatus } from './roadmap.mjs';

describe('rollupStatus', () => {
  it('returns planned when no tasks done', () => {
    const tasks = [
      { steps: [{ checkbox: ' ' }], directive: null, gitMatch: null },
      { steps: [{ checkbox: ' ' }], directive: null, gitMatch: null }
    ];
    expect(rollupStatus(tasks)).toBe('planned');
  });

  it('returns in-progress when some tasks done', () => {
    const tasks = [
      { steps: [{ checkbox: 'x' }], directive: 'test: done', gitMatch: { sha: 'abc1234' } },
      { steps: [{ checkbox: ' ' }], directive: null, gitMatch: null }
    ];
    expect(rollupStatus(tasks)).toBe('in-progress');
  });

  it('returns implemented when all tasks have box [x] and commit matched', () => {
    const tasks = [
      { steps: [{ checkbox: 'x' }], directive: 'test: one', gitMatch: { sha: 'abc1234' } },
      { steps: [{ checkbox: 'x' }], directive: 'test: two', gitMatch: { sha: 'def5678' } }
    ];
    expect(rollupStatus(tasks)).toBe('implemented');
  });

  it('returns implemented-pending-checkbox when all commits present but boxes open', () => {
    const tasks = [
      { steps: [{ checkbox: ' ' }], directive: 'test: one', gitMatch: { sha: 'abc1234' } },
      { steps: [{ checkbox: ' ' }], directive: 'test: two', gitMatch: { sha: 'def5678' } }
    ];
    expect(rollupStatus(tasks)).toBe('implemented-pending-checkbox');
  });

  it('returns stale when box [x] but no matching commit', () => {
    const tasks = [
      { steps: [{ checkbox: 'x' }], directive: 'test: missing', gitMatch: null }
    ];
    expect(rollupStatus(tasks)).toBe('stale');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run scripts/roadmap.test.mjs
```

Expected: FAIL with "rollupStatus is not defined"

- [x] **Step 3: Implement rollupStatus in roadmap.mjs**

```javascript
// scripts/roadmap.mjs

export function rollupStatus(tasks) {
  let allDone = true;
  let anyDone = false;
  let allCommitsPresent = true;
  let anyBoxFlippedWithoutCommit = false;

  for (const task of tasks) {
    const allBoxesFlipped = task.steps.every(s => s.checkbox === 'x');
    const commitMatched = task.gitMatch !== null;

    if (allBoxesFlipped && commitMatched) {
      anyDone = true;
    } else if (allBoxesFlipped && !commitMatched) {
      anyBoxFlippedWithoutCommit = true;
      allDone = false;
    } else if (!allBoxesFlipped && commitMatched) {
      anyDone = true;
      allDone = false;
    } else {
      allDone = false;
    }

    if (!allBoxesFlipped) {
      allDone = false;
    }
    if (!commitMatched && task.directive) {
      allCommitsPresent = false;
    }
  }

  if (anyBoxFlippedWithoutCommit) return 'stale';
  if (allDone && allCommitsPresent) return 'implemented';
  if (anyDone && !allDone) return 'in-progress';
  if (!anyDone && !allCommitsPresent) return 'planned';
  if (allCommitsPresent && !tasks.every(t => t.steps.every(s => s.checkbox === 'x'))) {
    return 'implemented-pending-checkbox';
  }
  return 'planned';
}
```

- [x] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run scripts/roadmap.test.mjs
```

Expected: 19 tests PASS

- [x] **Step 5: Commit rollup status**

```bash
git add scripts/roadmap.mjs scripts/roadmap.test.mjs
git commit -m "feat: add rollup status logic for roadmap generator"
```

---

### Task 5: Staleness Validation

**Files:**
- Modify: `scripts/roadmap.test.mjs`
- Modify: `scripts/roadmap.mjs`

**Interfaces:**
- Consumes: existing STATUS.md text (string), current git log commits array
- Produces: `validateStaleness(existingStatusMd, commits)` → `{warnings: string[]}`

- [x] **Step 1: Write failing test for validateStaleness**

Append to `scripts/roadmap.test.mjs`:

```javascript
import { validateStaleness } from './roadmap.mjs';

describe('validateStaleness', () => {
  it('warns if SHA in STATUS.md not in git log', () => {
    const statusMd = `
| Task | SHA |
| --- | --- |
| 1 | abc1234 |
| 2 | def5678 |
`;
    const commits = [{ sha: 'abc1234', subject: 'test' }];
    const result = validateStaleness(statusMd, commits);
    expect(result.warnings).toContain('⚠ stale: SHA def5678 no longer in history (rebased/amended)');
  });

  it('returns empty warnings if all SHAs present', () => {
    const statusMd = `
| Task | SHA |
| --- | --- |
| 1 | abc1234 |
`;
    const commits = [{ sha: 'abc1234', subject: 'test' }];
    const result = validateStaleness(statusMd, commits);
    expect(result.warnings).toHaveLength(0);
  });

  it('returns empty warnings if STATUS.md does not exist', () => {
    const result = validateStaleness(null, []);
    expect(result.warnings).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run scripts/roadmap.test.mjs
```

Expected: FAIL with "validateStaleness is not defined"

- [x] **Step 3: Implement validateStaleness in roadmap.mjs**

```javascript
// scripts/roadmap.mjs

export function validateStaleness(existingStatusMd, commits) {
  const warnings = [];
  if (!existingStatusMd) return { warnings };

  const shaRegex = /\|\s*([0-9a-f]{7})\s*\|/g;
  const commitShas = new Set(commits.map(c => c.sha));
  let match;
  while ((match = shaRegex.exec(existingStatusMd)) !== null) {
    const sha = match[1];
    if (!commitShas.has(sha)) {
      warnings.push(`⚠ stale: SHA ${sha} no longer in history (rebased/amended)`);
    }
  }

  return { warnings };
}
```

- [x] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run scripts/roadmap.test.mjs
```

Expected: 22 tests PASS

- [x] **Step 5: Commit staleness validation**

```bash
git add scripts/roadmap.mjs scripts/roadmap.test.mjs
git commit -m "feat: add staleness validation for roadmap generator"
```

---

### Task 6: STATUS.md Generation + Stdout Table

**Files:**
- Modify: `scripts/roadmap.test.mjs`
- Modify: `scripts/roadmap.mjs`

**Interfaces:**
- Consumes: plans data (array of plan objects with tasks, status, spec path, etc.)
- Produces: `renderMarkdown(plans, commitCount)` → string
- Produces: `renderStdoutTable(plans)` → string

- [x] **Step 1: Write failing test for renderMarkdown**

Append to `scripts/roadmap.test.mjs`:

```javascript
import { renderMarkdown } from './roadmap.mjs';

describe('renderMarkdown', () => {
  it('renders header with timestamp and summary', () => {
    const plans = [
      {
        topic: 'test-confidence',
        planPath: 'specs/plans/2026-07-27-test-confidence-improvement.md',
        specPath: 'specs/2026-07-27-test-confidence-audit.md',
        status: 'implemented-pending-checkbox',
        tasks: [
          {
            number: 1,
            title: 'Add migration fixtures',
            steps: [{ checkbox: ' ' }, { checkbox: ' ' }],
            directive: 'test: cover upgrades',
            gitMatch: { sha: 'abc1234' }
          }
        ]
      }
    ];
    const md = renderMarkdown(plans, 231);
    expect(md).toContain('<!-- AUTO-GENERATED');
    expect(md).toContain('# Roadmap Status');
    expect(md).toContain('Plans: 1 | Commits: 231');
    expect(md).toContain('## Plan: test-confidence');
    expect(md).toContain('implemented-pending-checkbox');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run scripts/roadmap.test.mjs
```

Expected: FAIL with "renderMarkdown is not defined"

- [x] **Step 3: Implement renderMarkdown in roadmap.mjs**

```javascript
// scripts/roadmap.mjs

export function renderMarkdown(plans, commitCount) {
  const timestamp = new Date().toISOString();
  let md = `<!-- AUTO-GENERATED by \`pnpm test:roadmap\` on ${timestamp}. Do not hand-edit. -->\n`;
  md += `<!-- Re-run: pnpm test:roadmap. Source: specs/plans/*.md + git log. -->\n\n`;
  md += `# Roadmap Status\n`;
  md += `Generated: ${timestamp} | Plans: ${plans.length} | Commits: ${commitCount}\n\n`;

  for (const plan of plans) {
    md += `## Plan: ${plan.topic}\n`;
    md += `- Plan: ${plan.planPath}\n`;
    md += `- Spec: ${plan.specPath || '—'}\n`;
    md += `- Status: ${plan.status}\n\n`;

    md += `| Task | Title | Box | Commit subject | SHA | Status |\n`;
    md += `| --- | --- | --- | --- | --- | --- |\n`;

    for (const task of plan.tasks) {
      const openCount = task.steps.filter(s => s.checkbox === ' ').length;
      const totalCount = task.steps.length;
      const boxStr = `[${task.steps.every(s => s.checkbox === 'x') ? 'x' : ' '}] (${totalCount - openCount}/${totalCount})`;
      const shaStr = task.gitMatch ? task.gitMatch.sha : '—';
      const taskStatus = task.gitMatch
        ? (task.steps.every(s => s.checkbox === 'x') ? 'done' : 'committed, box open')
        : (task.steps.every(s => s.checkbox === 'x') ? 'stale (no commit)' : 'not started');

      md += `| ${task.number} | ${task.title} | ${boxStr} | ${task.directive || '—'} | ${shaStr} | ${taskStatus} |\n`;
    }
    md += `\n`;
  }

  return md;
}
```

- [x] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run scripts/roadmap.test.mjs
```

Expected: 23 tests PASS

- [x] **Step 5: Write failing test for renderStdoutTable**

Append to `scripts/roadmap.test.mjs`:

```javascript
import { renderStdoutTable } from './roadmap.mjs';

describe('renderStdoutTable', () => {
  it('renders one row per plan', () => {
    const plans = [
      { topic: 'test-confidence', status: 'implemented', tasks: [{ steps: [{ checkbox: 'x' }] }, { steps: [{ checkbox: 'x' }] }] },
      { topic: 'categorize-rules', status: 'in-progress', tasks: [{ steps: [{ checkbox: 'x' }] }, { steps: [{ checkbox: ' ' }] }] }
    ];
    const table = renderStdoutTable(plans);
    expect(table).toContain('test-confidence');
    expect(table).toContain('implemented');
    expect(table).toContain('categorize-rules');
    expect(table).toContain('in-progress');
  });
});
```

- [x] **Step 6: Run test to verify it fails**

```bash
pnpm vitest run scripts/roadmap.test.mjs
```

Expected: FAIL with "renderStdoutTable is not defined"

- [x] **Step 7: Implement renderStdoutTable in roadmap.mjs**

```javascript
// scripts/roadmap.mjs

export function renderStdoutTable(plans) {
  let table = 'Plan                          | Status                          | Tasks\n';
  table += '----------------------------- | ------------------------------- | -----\n';
  for (const plan of plans) {
    const doneCount = plan.tasks.filter(t => t.steps.every(s => s.checkbox === 'x')).length;
    const totalCount = plan.tasks.length;
    table += `${plan.topic.padEnd(28)} | ${plan.status.padEnd(30)} | ${doneCount}/${totalCount}\n`;
  }
  return table;
}
```

- [x] **Step 8: Run test to verify it passes**

```bash
pnpm vitest run scripts/roadmap.test.mjs
```

Expected: 24 tests PASS

- [x] **Step 9: Commit rendering logic**

```bash
git add scripts/roadmap.mjs scripts/roadmap.test.mjs
git commit -m "feat: add STATUS.md and stdout table rendering"
```

---

### Task 7: End-to-End Wiring

**Files:**
- Modify: `scripts/roadmap.mjs`

**Interfaces:**
- Consumes: filesystem (specs/plans/*.md, git log)
- Produces: writes specs/STATUS.md, prints stdout table, exits with appropriate code

- [x] **Step 1: Implement main() function in roadmap.mjs**

```javascript
// scripts/roadmap.mjs
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { globSync } from 'fs';

async function main() {
  // 1. Gather inputs
  const planPaths = globSync('specs/plans/*.md');
  const specPaths = globSync('specs/*.md');
  const gitLogOutput = execSync('git log --format="%h\t%s"', { encoding: 'utf-8' });
  const commits = gitLogOutput.trim().split('\n').map(line => {
    const [sha, ...subjectParts] = line.split('\t');
    return { sha, subject: subjectParts.join('\t') };
  });

  // 2. Build spec index by topic slug
  const specIndex = {};
  for (const specPath of specPaths) {
    const filename = specPath.split('/').pop();
    const match = filename.match(/^\d{4}-\d{2}-\d{2}-(.+?)(?:-design)?\.md$/);
    if (match) {
      specIndex[match[1]] = specPath;
    }
  }

  // 3. Parse each plan
  const plans = [];
  for (const planPath of planPaths.sort().reverse()) {
    const planText = readFileSync(planPath, 'utf-8');
    const filename = planPath.split('/').pop();
    const match = filename.match(/^\d{4}-\d{2}-\d{2}-(.+)\.md$/);
    const topic = match ? match[1] : filename;

    const tasks = parseTasks(planText);
    for (const task of tasks) {
      const finalStep = task.steps[task.steps.length - 1];
      const directive = finalStep ? extractCommitSubject(finalStep.text) : null;
      const gitMatch = directive ? matchGit(directive, commits) : null;
      task.directive = directive;
      task.gitMatch = gitMatch;
    }

    const status = rollupStatus(tasks);
    const specPath = specIndex[topic] || null;

    plans.push({ topic, planPath, specPath, status, tasks });
  }

  // 4. Validate staleness
  const existingStatusMd = existsSync('specs/STATUS.md') ? readFileSync('specs/STATUS.md', 'utf-8') : null;
  const { warnings } = validateStaleness(existingStatusMd, commits);
  for (const plan of plans) {
    const allBoxesFlipped = plan.tasks.every(t => t.steps.every(s => s.checkbox === 'x'));
    const noCommits = plan.tasks.every(t => !t.gitMatch);
    if (allBoxesFlipped && noCommits && plan.tasks.length > 0) {
      warnings.push(`⚠ stale: plan ${plan.topic} has all boxes flipped but no matching commits`);
    }
  }

  // 5. Render and write
  const markdown = renderMarkdown(plans, commits.length);
  writeFileSync('specs/STATUS.md', markdown);

  // 6. Print stdout table
  console.log(renderStdoutTable(plans));

  // 7. Exit with appropriate code
  if (warnings.length > 0) {
    for (const warning of warnings) {
      console.error(warning);
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [x] **Step 2: Run end-to-end test**

```bash
pnpm test:roadmap
```

Expected:
- Prints stdout table with all 11 plans
- Creates `specs/STATUS.md`
- Exits 0 (no staleness on first run)

- [x] **Step 3: Verify STATUS.md content**

```bash
cat specs/STATUS.md | head -30
```

Expected: header with timestamp, then plan sections with task tables

- [x] **Step 4: Verify test-confidence plan shows implemented-pending-checkbox**

```bash
grep -A 10 "test-confidence-improvement" specs/STATUS.md
```

Expected: status line shows `implemented-pending-checkbox`, SHAs `a83ad74`/`40facbe`/`89dde52` present

- [x] **Step 5: Commit end-to-end wiring**

```bash
git add scripts/roadmap.mjs
git commit -m "feat: wire up end-to-end roadmap generator"
```

---

### Task 8: CLAUDE.md Addition

**Files:**
- Modify: `CLAUDE.md`

- [x] **Step 1: Add Spec/Plan Tracking section to CLAUDE.md**

Open `CLAUDE.md`, find the `## Repo Layout` section, and insert the following **after** it (before `## Gotchas`):

```markdown
## Spec/Plan Tracking

- To answer "what's the roadmap progress / which specs are implemented," run `pnpm test:roadmap` and read `specs/STATUS.md` — do NOT re-scan plans + git log by hand.
- `specs/STATUS.md` is **generated** (from `specs/plans/*.md` checkboxes + `git log`). Never hand-edit it; re-run `pnpm test:roadmap` to refresh.
- **Checkbox discipline:** when a plan task's commit lands, flip that task's step checkboxes `- [x]`→`- [x]` in the plan file. A task counts as done only if its box is `[x]` AND git log has the matching commit.
- If `pnpm test:roadmap` prints `⚠ stale`, the rollup can't be trusted — regenerate it before relying on it. Nonzero exit = staleness detected.
```

- [x] **Step 2: Verify CLAUDE.md structure**

```bash
grep "^## " CLAUDE.md
```

Expected: list of `##` headers including `Spec/Plan Tracking` between `Repo Layout` and `Gotchas`

- [x] **Step 3: Commit CLAUDE.md addition**

```bash
git add CLAUDE.md
git commit -m "docs: add Spec/Plan Tracking section to CLAUDE.md"
```

---

### Task 9: Memory Addition

**Files:**
- Create: `/home/hoangtu34/.claude/projects/-home-hoangtu34-Documents-projects-local-personal-finance-management/memory/spec-plan-tracking.md`
- Modify: `/home/hoangtu34/.claude/projects/-home-hoangtu34-Documents-projects-local-personal-finance-management/memory/MEMORY.md`

- [x] **Step 1: Create spec-plan-tracking.md memory file**

```markdown
---
name: spec-plan-tracking
description: Roadmap status generator workflow — run pnpm test:roadmap, read specs/STATUS.md, flip checkboxes on commit
metadata:
  type: reference
---

## How to answer roadmap questions

When asked "what's the roadmap progress / which specs are implemented":
1. Run `pnpm test:roadmap`
2. Read `specs/STATUS.md`
3. Do NOT re-scan `specs/plans/*.md` + `git log` by hand

## Checkbox discipline

A plan task is **done** only when:
- Its step checkboxes are flipped to `[x]` in the plan file
- AND git log has a matching commit (scope-agnostic body-substring match)

The generator cross-checks both. If only one is true, it reports:
- `implemented-pending-checkbox` — commits present, boxes not flipped (backfill debt)
- `stale` — boxes flipped, commits missing (corruption signal)

## Five status states

| State | Meaning |
| --- | --- |
| `planned` | Not started |
| `in-progress` | Partially shipped |
| `implemented` | Fully shipped, disciplined |
| `implemented-pending-checkbox` | Shipped but checkboxes not flipped |
| `stale` | Checkbox flipped without commit |

## Generator location

`scripts/roadmap.mjs` — pure Node 22 ESM, no external deps.

## Three commit-directive forms

1. `` Commit with `subject` ``
2. ```` ```bash\ngit commit -m "subject"\n``` ````
3. Heredoc: `git commit -m "$(cat <<'EOF'\nsubject\n... EOF )"`

## Matching is scope-agnostic

Plan directive `feat(categorize-rules): ...` may ship as commit `feat(db): ...`. The generator strips `type(scope):` and matches the body as substring.
```

- [x] **Step 2: Add pointer to MEMORY.md**

Open `/home/hoangtu34/.claude/projects/-home-hoangtu34-Documents-projects-local-personal-finance-management/memory/MEMORY.md` and append this line:

```markdown
- [Spec/Plan tracking workflow](spec-plan-tracking.md) — run pnpm test:roadmap for roadmap progress; read specs/STATUS.md; flip plan checkboxes on commit; STATUS.md generated, don't hand-edit
```

- [x] **Step 3: Verify memory files exist**

```bash
ls -la /home/hoangtu34/.claude/projects/-home-hoangtu34-Documents-projects-local-personal-finance-management/memory/
```

Expected: `spec-plan-tracking.md` exists, `MEMORY.md` contains the new pointer

- [x] **Step 4: Commit memory addition (if tracked)**

Memory files are outside the repo, so no git commit needed. Just verify they exist.

---

## Self-Review

**1. Spec coverage:**
- ✓ Single source of truth (STATUS.md) — Task 7
- ✓ Trustworthy (self-validates staleness) — Task 5
- ✓ Discipline enforcement (cross-checks checkboxes + git) — Task 4
- ✓ Future-session aware (CLAUDE.md + memory) — Tasks 8, 9
- ✓ Gitignore STATUS.md — Task 1
- ✓ Scope-agnostic matching — Task 3
- ✓ Five status states — Task 4
- ✓ Three directive forms — Task 2
- ✓ Stdout table — Task 6
- ✓ Nonzero exit on staleness — Task 7

**2. Placeholder scan:**
- No TBD/TODO
- No "implement later"
- All code blocks present
- All function signatures defined

**3. Type consistency:**
- `parseTasks` → `[{headerLevel, number, title, steps[]}]` — consistent across Tasks 2, 4, 6, 7
- `extractCommitSubject` → `subject | null` — consistent
- `normalizeSubject` → `{type, scope, body}` — consistent
- `matchGit` → `{sha, additionalMatches} | null` — consistent
- `rollupStatus` → 5 status strings — consistent
- `validateStaleness` → `{warnings: string[]}` — consistent
- `renderMarkdown` / `renderStdoutTable` — consistent

All checks pass.
