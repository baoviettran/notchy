// scripts/roadmap.mjs

export function normalizeSubject(subject) {
  // A plan directive may embed `Co-Authored-By: Claude <...>` — either glued onto
  // the subject line (inline multi-line `-m` pasted as one) or on a second line.
  // Keep only the first line and drop the footer so it never leaks into the body
  // that matchGit later compares against real single-line commit subjects.
  const cleaned = String(subject).split('\n')[0].replace(/Co-Authored-By:.*$/, '').trim();
  const match = cleaned.match(/^(\w+)(?:\(([^)]+)\))?:\s*(.+)$/);
  if (!match) {
    return { type: null, scope: null, body: cleaned };
  }
  return {
    type: match[1],
    scope: match[2] || null,
    body: match[3]
  };
}

export function extractCommitSubject(taskFinalStepText) {
  // Form 1: Commit with `subject`
  const form1 = taskFinalStepText.match(/Commit with\s+`([^`]+)`/);
  if (form1) return form1[1];

  // Form 3: heredoc git commit -m "$(cat <<'EOF'\nsubject\n... (check before form2,
  // because form2's greedy "([^"]+)" would eat the heredoc body)
  const form3 = taskFinalStepText.match(/git commit -m "\$\(cat <<'?EOF'?\n([^\n]+)/);
  if (form3) return form3[1];

  // Form 2: git commit -m "subject"
  const form2 = taskFinalStepText.match(/git commit -m "([^"]+)"/);
  if (form2) return form2[1];

  return null;
}

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

export function rollupStatus(tasks) {
  let stale = false;
  let allDone = true;
  let doneCount = 0;
  let allHaveCommits = tasks.length > 0;

  for (const task of tasks) {
    const allChecked = task.steps.length > 0 && task.steps.every(s => s.checkbox === 'x');
    const hasMatch = !!task.gitMatch;

    if (allChecked && !hasMatch) {
      stale = true;
    }

    const taskDone = allChecked && hasMatch;
    if (taskDone) doneCount++;
    else allDone = false;

    if (!hasMatch) allHaveCommits = false;
  }

  if (stale) return 'stale';
  if (allDone) return 'implemented';
  if (doneCount > 0) return 'in-progress';
  if (allHaveCommits) return 'implemented-pending-checkbox';
  return 'planned';
}

export function parseTasks(planText) {
  const tasks = [];
  const taskHeaderRegex = /^(#{2,3})\s+Task\s+(\d+):\s*(.+)$/gm;
  const terminalSectionRegex = /^## (Self-Review|Self-Review Notes|Summary|Acceptance|Out of Scope|Open Questions)/m;
  const stepRegex = /^- \[([ x])\]\s+\*\*Step\s+(\d+):\s*(.*?)\*\*\s*/gm;

  // Filter out code block content to avoid extracting example tasks from code blocks.
  // Replace code-block lines with same-length blank strings to preserve character offsets.
  const lines = planText.split('\n');
  let inCodeBlock = false;
  const cleanText = lines.map(line => {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      return line; // keep fence lines as-is (they don't match task/step regex)
    }
    return inCodeBlock ? ' '.repeat(line.length) : line;
  }).join('\n');

  let match;
  const taskStarts = [];
  while ((match = taskHeaderRegex.exec(cleanText)) !== null) {
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
    const nextTaskStart = i + 1 < taskStarts.length ? taskStarts[i + 1].startIndex : cleanText.length;

    // Use cleanText for finding task/step positions (avoids phantom tasks in code blocks)
    let cleanTaskBody = cleanText.slice(task.headerEnd, nextTaskStart);

    // Stop at terminal section
    const terminalMatch = cleanTaskBody.match(terminalSectionRegex);
    if (terminalMatch) {
      cleanTaskBody = cleanTaskBody.slice(0, terminalMatch.index);
    }

    // Use original planText for step content extraction (preserves code blocks with directives)
    const originalTaskBody = planText.slice(task.headerEnd, nextTaskStart);
    let originalBoundedBody = originalTaskBody;
    if (terminalMatch) {
      originalBoundedBody = originalTaskBody.slice(0, terminalMatch.index);
    }

    // Find step positions using cleanText
    const stepPositions = [];
    let stepMatch;
    stepRegex.lastIndex = 0;
    while ((stepMatch = stepRegex.exec(cleanTaskBody)) !== null) {
      stepPositions.push({
        checkbox: stepMatch[1],
        stepNum: parseInt(stepMatch[2]),
        title: stepMatch[3],
        index: stepMatch.index,
        end: stepMatch.index + stepMatch[0].length
      });
    }

    // Extract step content from original text (includes code blocks)
    // Text = bold title + body (everything after closing ** up to next step or end of task)
    const steps = [];
    for (let j = 0; j < stepPositions.length; j++) {
      const pos = stepPositions[j];
      const nextPos = j + 1 < stepPositions.length ? stepPositions[j + 1].index : originalBoundedBody.length;
      const body = originalBoundedBody.slice(pos.end, nextPos).trim();
      const text = body ? `${pos.title}\n\n${body}` : pos.title;
      steps.push({
        checkbox: pos.checkbox,
        stepNum: pos.stepNum,
        text
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

// --- Story-inventory traceability (source of truth for WHAT) ---
// Rule (CLAUDE.md): no story -> no spec. Every plan/spec carries a `Serves: STORY-0xx`
// header tracing to product/stories/index.md. This gate reports untraced plans/specs
// and any Serves reference that points at a story id that does not exist.

export function extractStoryIdsFromInventory(indexText) {
  // Only table rows (`| STORY-0xx |`); prose like "use STORY-010 next" must not count.
  const ids = new Set();
  const re = /^\| (STORY-\d{3}) \|/gm;
  let m;
  while ((m = re.exec(indexText)) !== null) ids.add(m[1]);
  return ids;
}

export function findServesIds(fileText) {
  const ids = [];
  // Tolerate the field's common rendered forms: `**Serves:** STORY-0xx` and `Serves: STORY-0xx`.
  const re = /Serves:[^*\n]*\*{0,2}\s*?(STORY-\d{3})\b/gi;
  let m;
  while ((m = re.exec(fileText)) !== null) ids.push(m[1].toUpperCase());
  return ids;
}

export function buildTraceFindings(fileEntries, validIds) {
  // fileEntries: [{ path, text }]. Pure — reads nothing from disk.
  const untraced = [];
  const unknown = [];
  let traced = 0;
  const total = fileEntries.length;
  for (const { path, text } of fileEntries) {
    const served = findServesIds(text);
    if (served.length === 0) {
      untraced.push(path);
    } else {
      traced++;
      for (const id of served) {
        if (!validIds.has(id)) unknown.push({ path, id });
      }
    }
  }
  return { total, traced, untraced, unknown };
}

export function renderStoryCoverage(findings) {
  let s = `## Story coverage (traceability)\n`;
  s += `- Traced: ${findings.traced} / ${findings.total} | Untraced: ${findings.untraced.length} | Unknown story ids: ${findings.unknown.length}\n`;
  for (const u of findings.unknown) s += `- ⚠ unknown story id ${u.id} in ${u.path}\n`;
  for (const p of findings.untraced) s += `- untraced: ${p}\n`;
  return `${s}\n`;
}

import { readFileSync, writeFileSync, existsSync, globSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

  // 4.5 Story-inventory traceability (no story -> no spec, per CLAUDE.md).
  // Gate on every plan + its linked spec. Reads nothing but facts; untraced and
  // unknown-id references are warnings -> exit 1, so the model stays enforced.
  let storyFindings = null;
  const storiesPath = 'product/stories/index.md';
  if (existsSync(storiesPath)) {
    const validIds = extractStoryIdsFromInventory(readFileSync(storiesPath, 'utf-8'));
    const traceEntries = new Map();
    for (const plan of plans) {
      traceEntries.set(plan.planPath, { path: plan.planPath, text: readFileSync(plan.planPath, 'utf-8') });
      if (plan.specPath) traceEntries.set(plan.specPath, { path: plan.specPath, text: readFileSync(plan.specPath, 'utf-8') });
    }
    storyFindings = buildTraceFindings([...traceEntries.values()], validIds);
    for (const p of storyFindings.untraced) warnings.push(`story: ${p} has no Serves: trace`);
    for (const u of storyFindings.unknown) warnings.push(`story: ${u.path} traces to unknown ${u.id}`);
  }

  // 5. Render and write
  let markdown = renderMarkdown(plans, commits.length);
  if (storyFindings) markdown += renderStoryCoverage(storyFindings);
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

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
