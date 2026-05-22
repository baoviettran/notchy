# Contributing to Notchy

This document captures the working conventions for this repository. It is intended for any contributor — human or AI agent — to read first before making changes.

## Repository Layout

Notchy is split across two repositories:

- **This repository (public)**: source code, README, license, and tooling
- **`notchy-docs` (private)**: implementation plan, technical design, and other internal specifications

The private docs repository is mounted in this repository as a git submodule at `docs/`. Collaborators with access to the private repo see the docs populated; everyone else sees an empty `docs/` directory.

### Cloning

To work with full context locally (collaborators with access to both repos):

```bash
git clone --recurse-submodules <repo-url>
```

Or, after a regular clone:

```bash
git submodule update --init --recursive
```

### Reading the Docs

When the submodule is populated, the canonical specifications live at:

- `docs/PLAN.md` — implementation plan, scope, task breakdown, and roadmap
- `docs/DESIGN.md` — technical design: data model, schema, queries, UI surfaces, and risks

Cite specific sections as `docs/PLAN.md §4.3` or `docs/DESIGN.md §7.5`.

## Commit Conventions

### Code commits never modify the docs submodule

Routine code commits (features, bug fixes, refactors, tests) **must not** include changes to the `docs` submodule pointer. The submodule pointer changes only when the documentation itself changes.

If you find yourself wanting to update docs while implementing code, finish the code commit first, then make a separate documentation commit.

### Updating documentation

When `PLAN.md` or `DESIGN.md` need to change:

1. Make the edits inside the `docs/` working tree.
2. Commit and push within the docs repo:
   ```bash
   cd docs
   git add -A
   git commit -m "<docs commit message>"
   git push
   cd ..
   ```
3. In the parent (public) repo, record the updated submodule pointer:
   ```bash
   git add docs
   git commit -m "Update docs submodule: <brief summary>"
   git push
   ```

### Commit message style

- Use the imperative mood ("Add", "Fix", "Update", "Refactor"), not past tense.
- First line ≤ 72 characters; blank line; longer body if context is needed.
- For multi-line commits, summarise *what* and *why*, not the full diff.

## Branching and Pushing

- Default branch is `main` for both repos.
- Direct commits to `main` are acceptable while the project remains pre-implementation. Once the codebase grows, switch to feature branches and pull requests.
- Never force-push `main` without explicit confirmation.

## Submodule Hygiene

Recommended local git configuration to avoid common submodule mistakes:

```bash
git config submodule.recurse true
git config push.recurseSubmodules check
```

- `submodule.recurse=true`: `git pull` automatically updates the submodule.
- `push.recurseSubmodules=check`: refuses to push the parent if the submodule has unpushed changes.

## Working with Stale Docs

If the local `docs/` is behind the remote docs repo (because someone else updated docs from another machine):

```bash
git submodule update --remote docs
```

This pulls the latest commit on the docs repo's `main` branch into the working tree. To record the new pointer in the parent repo, follow the documentation update flow above.

## Notes for AI Agents

If you are an AI agent assisting with this project:

- Read `docs/PLAN.md` and `docs/DESIGN.md` for the authoritative specifications. They are the source of truth for scope, semantics, and design decisions.
- When implementing a feature, do **not** modify `docs/` unless the user explicitly asks for documentation updates.
- When code diverges from the design, surface the divergence to the user and ask whether to update the design or revise the code.
- Treat the docs as private: do not echo their content into the public repository's commits, README, or other public surfaces beyond high-level orientation.
