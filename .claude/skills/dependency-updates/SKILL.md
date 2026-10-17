---
name: dependency-updates
description: Review and merge the weekly Dependabot pull request for filey. Checks that the grouped update is safe (CI, changelogs of major bumps, npm audit, lint, typecheck, tests), fixes breakage if needed, and merges it. Use when asked to check, review, handle or merge dependency updates, Dependabot pull requests or "the weekly update".
---

# Weekly dependency updates

Dependabot (`.github/dependabot.yml`) opens **one** pull request every Monday that bundles all npm and GitHub Actions
updates (branch `dependabot/...`, commit prefix `deps`, label `dependencies`). `drizzle-orm` and `drizzle-kit` are pinned
on purpose and ignored (arc42 §11, risk 9); do not update them here.

Invoking this skill is the user's explicit request to merge the pull request once the checks below pass
(`CLAUDE.md` otherwise forbids merging). Never merge with red CI or an unresolved finding.

## Steps

1. **Find the pull request.** `mcp__github__list_pull_requests` (state open) for the `dependabot[bot]` PR with the
   `dependencies` label. None open: say so and stop. More than one (for example an older weekly PR): the newest wins;
   close the older ones with a comment pointing to it.
2. **Read the update list** in the PR description. Sort it into patch/minor and **major** bumps. Look at the release notes
   linked for each major bump (and for `electron`, `ai`, `@openrouter/ai-sdk-provider`, `zod`, `typescript`,
   `@electron-forge/*`, which can break the app or the build): note breaking changes that touch filey's code.
3. **Check CI** on the PR head (`mcp__github__pull_request_read`, check runs). Red CI is a failure to fix, not to
   re-run. Get the logs with `mcp__github__get_job_logs`.
4. **Verify locally** on the PR branch (`git fetch origin <branch>`, check it out):
   ```sh
   ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
   npm run lint && npm run typecheck && npm test
   npm audit --omit=dev --audit-level=high   # advisories in shipped dependencies block the merge
   ```
   If `electron`, `@electron-forge/*` or webpack loaders changed, the headless checks do not cover the build: say so and
   ask the user to run `npm start` or `npm run make:mac` on the Mac before merging.
5. **If something breaks,** fix it on the Dependabot branch with a small follow-up commit (adapt code to the new API,
   adjust types). If the fix is large or the cause is one package, do not hold up the other updates: ask the user, then
   either add an `ignore` entry for that package (with a comment why) to `.github/dependabot.yml` and ask Dependabot to
   recreate the PR (`@dependabot recreate`), or open a separate issue with the `write-backlog-issue` skill.
   Never skip or disable a test to get green.
6. **Check the diff** against `.claude/rules/electron-pr-checks.md` (new advisories, new heavy dependencies, changed
   Electron version). Changes to `docs/arc42.md` need the user's approval; a bump that contradicts it (for example
   moving `drizzle-*`) means stop and ask.
7. **Merge** with `mcp__github__merge_pull_request`, method `squash`, title `Update dependencies (<YYYY-MM-DD>)`.
   Then report: what was merged, which major bumps were in it, what was fixed or ignored, and anything the user should
   test on the Mac.

## Notes
- The Dependabot branch lives in this repository, so pushing a fix to it is allowed. Dependabot stops rebasing a branch
  once it has a manual commit; if `main` moves on, merge `main` into the branch yourself.
- Security updates for vulnerable packages arrive as separate Dependabot pull requests immediately, not in the weekly one.
  Handle them with the same steps.
