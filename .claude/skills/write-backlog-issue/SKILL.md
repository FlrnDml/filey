---
name: write-backlog-issue
description: Write or update GitHub backlog issues for filey (epics, tasks, bugs) so that a fresh Claude session or a contributor can implement them without further context. Use when asked to create, plan, split, refine or rewrite issues, tickets, epics, tasks or the backlog for filey.
---

# Writing backlog issues for filey

Every issue must be implementable by someone who starts cold: a new Claude session
that only sees the issue text and the repository. Put the context into the issue,
do not rely on the conversation it came from.

## 1. Before writing

1. Read `docs/arc42.md`. It is the source of truth for requirements, scenarios,
   decisions (ADRs), concepts and risks.
2. Search existing issues (`mcp__github__search_issues` / `list_issues`) to avoid
   duplicates and to find the parent epic and dependencies.
3. Check available issue types (`mcp__github__list_issue_types`): `Feature`, `Task`, `Bug`.
4. If the work needs a decision that arc42 does not contain, or would change arc42:
   do **not** decide it inside the ticket. Ask the user, or add it under
   "Open questions". arc42 changes need the user's approval (see `CLAUDE.md`).

## 2. Which kind of issue

| Kind | Issue type | Use for | Size |
|------|-----------|---------|------|
| Epic | `Feature` | A user-visible feature, a major refactoring, or a cross-cutting change (e.g. new provider, storage migration) | Several tasks; groups them as sub-issues |
| Task | `Task` | One implementable unit of work | One pull request, reviewable in one sitting (roughly ≤ 1 day, ≤ ~400 changed lines) |
| Bug | `Bug` | Behaviour that differs from arc42 or the acceptance criteria of a closed task | One pull request |

Rules:
- A task *can* belong to an epic, but does not have to. Link it to an epic when it is
  part of a larger feature or change: create it with `parent_issue_number` (or attach
  it with `mcp__github__sub_issue_write`). Standalone tasks are fine.
- Bugs normally have no epic. Link related issues by number in the bug instead.
- Split a task when it touches unrelated building blocks, needs more than one PR,
  or has more than ~8 acceptance criteria.
- A refactoring that changes structure across several building blocks is an epic,
  even if no user-visible behaviour changes.

## 3. Title

- Imperative, specific, English, no ticket prefixes: `Filer: resolve name collisions with _2, _3`.
- Start with the building block from arc42 §5 when it helps (`Watcher:`, `Analyzer:`,
  `Filer:`, `History:`, `Settings UI:`, `Tray:`).
- Epics: `Epic: <feature or change>`.

## 4. Epic template

```markdown
## Why
<Problem or user value in 2–4 sentences. Which requirement (F*/N*/quality goal) it serves.>

## Scope
**In:** <what this epic delivers>
**Out:** <what is explicitly not part of it, with a pointer to where it lives instead>

## Architecture
<Short summary of the architecture as described in arc42: affected building blocks,
interfaces and decisions, with section links (e.g. "arc42 §5.2, §6.1, ADR-5").
For refactorings: current architecture → target architecture, and how the change
is done incrementally without breaking main.>

## Tasks
Tracked as sub-issues. Order / dependencies:
1. #<task> – <one line>
2. #<task> – <one line> (needs #…)

## Done when
- [ ] <observable outcome for the user or the codebase>
- [ ] All sub-issues closed
- [ ] arc42 still matches the implementation (changes approved by the user)

## Open questions
- <decision needed from the user, or "None">
```

## 5. Task template

```markdown
## Context
<Why this task exists and where it fits: parent epic (#…), the arc42 scenario it
implements, and the relevant facts copied in briefly (paths, formats, defaults,
limits), so the implementer does not have to reconstruct them.>

## Goal
<One or two sentences: the result after this task is merged.>

## Scope
**In:** <…>
**Out:** <… (handled in #…)>

## Implementation notes
- Location: <files / modules to create or change, e.g. `src/core/filer/template.ts`>
- Interfaces: <function signatures, types, IPC channels, DB tables/columns>
- Libraries / APIs: <packages and the specific calls to use>
- Constraints: <relevant rules from arc42 §8 and CLAUDE.md, e.g. "main process only",
  "no Electron imports in core logic", "never log document contents">
- Edge cases: <the tricky inputs: umlauts/NFD, iCloud placeholders, offline, collisions …>

## Acceptance criteria
- [ ] <specific, observable, testable statement>
- [ ] <…>

## Testing
- Unit tests: <what is covered, which fakes are injected (fs, model, notifier, DB, clock)>
- Must run headless with `ELECTRON_SKIP_BINARY_DOWNLOAD=1`
- Manual check on a Mac (if any): <steps>

## Dependencies
- Blocked by: #… <or "None">
- Blocks: #…

## Open questions
- <or "None">

Refs: arc42 §…, ADR-…
```

## 6. Bug template

```markdown
## Observed
<What happens. Include log excerpt from ~/Library/Logs/Filey if available (no document contents, no API key).>

## Expected
<What should happen, with the arc42 section or acceptance criterion that defines it.>

## Steps to reproduce
1. …

## Environment
macOS version, Filey version, model name, iCloud setting ("Optimize Mac Storage" on/off).

## Notes
<Suspected cause, affected building block, related issues.>
```

## 7. Quality checklist (check before creating)

- [ ] English only.
- [ ] Self-contained: a cold reader knows *why*, *what* and *where* without this conversation.
- [ ] Every acceptance criterion is testable; no "works well", "is fast", "nice UI".
- [ ] Defaults, formats and limits are written as concrete values (e.g. `YYYY-MM-DD`, max 10 characters).
- [ ] Scope says what is out, so the PR stays small.
- [ ] arc42 sections and ADRs referenced; no decision invented that is not in arc42.
- [ ] Correct issue type, parent epic set if the task belongs to one, dependencies linked by number.
- [ ] No secrets, API keys, personal data or real documents in the issue.

## 8. Creating the issues

- Create epics first, then tasks with `mcp__github__issue_write` (`method: create`,
  `type`, and `parent_issue_number` when the task belongs to an epic), in
  implementation order so numbers read naturally.
- When a decision changes later, update the affected issues in place
  (`method: update`) instead of adding comments that contradict the body.
- Issues are not added to the GitHub Project board automatically; the Project's
  auto-add workflow (filter `repo:FlrnDml/filey is:issue`) does that.
- Report the created issue numbers and links back to the user in a short table.

## 9. Example (task)

Title: `Filer: naming template, file name sanitizing and safe move`

```markdown
## Context
Part of #7 (import pipeline). After the Analyzer returns `{date, sender, category, title}`
(arc42 §5.2), the Filer turns it into a path and moves the PDF (arc42 §6.1 steps 6–7).
Template default: `{category}/{date}_{sender}_{title}.pdf`. Missing values: date → import
date `YYYY-MM-DD`, sender → `Unknown`, title → `Untitled`. Sender max 10 characters.

## Goal
A pure, tested module that builds a safe target path and moves the file there.

## Scope
**In:** template rendering, sanitizing, collision handling, move.
**Out:** calling the model (#19), history rows and notifications (#21).

## Implementation notes
- Location: `src/core/filer/` (no Electron imports)
- Interfaces: `renderPath(template, info, now): string`, `fileDocument(src, targetRoot, relPath, fs)`
- Edge cases: NFD from APFS → NFC, `/` only allowed inside category, `:` replaced,
  segment length limit, collisions `_2`, `_3`, cross-volume move = copy + verify + delete

## Acceptance criteria
- [ ] Unknown placeholders are rejected when the template is saved
- [ ] Missing values are replaced by the fallbacks above
- [ ] Sender longer than 10 characters is cut to 10
- [ ] Existing target name → `_2`, `_3`, …
- [ ] Missing folders are created

## Testing
- Unit tests with an in-memory fs: umlauts, long titles, collisions, missing values

## Dependencies
- Blocked by: #11, #12
- Blocks: #21

## Open questions
- None

Refs: arc42 §5.2, §6.1, §8 file names
```
