---
name: dependency-updates
description: Review and merge every open dependency pull request for filey (the weekly Dependabot PR and security updates). Merges the ones that do not overlap, closes older ones that a newer PR already covers, so all dependencies end up current. Checks each for safety (CI, changelogs of major bumps, npm audit, lint, typecheck, tests), fixes breakage if needed. Use when asked to check, review, handle or merge dependency updates, Dependabot pull requests or "the weekly update".
---

# Dependency updates

Dependabot (`.github/dependabot.yml`) opens **one** pull request every Monday that bundles all npm and GitHub Actions
updates (branch `dependabot/...`, commit prefix `deps`, label `dependencies`). It is capped at one open weekly PR, but an
older one can still be open next to a newer one, and security updates arrive as separate PRs at any time. This skill
handles **all** open dependency PRs in one run, so that afterwards every dependency is up to date. `drizzle-orm` and
`drizzle-kit` are pinned on purpose and ignored (arc42 §11, risk 9); do not update them here.

Invoking this skill is the user's explicit request to merge every dependency pull request that passes the checks below
(`CLAUDE.md` otherwise forbids merging). Never merge with red CI or an unresolved finding.

## Steps

1. **Find and sort the pull requests.** List the open PRs from `dependabot[bot]` with the `dependencies` label
   (`mcp__github__list_pull_requests`, or `gh pr list --label dependencies`). None open: say so and stop. For each PR
   write down its packages with the target versions (PR description, changed files). Then compare the PRs:
   - **No package in common:** independent, merge all of them (each one after the steps below).
   - **Every package of an older PR is also in a newer PR** (same or lower version): the older one is redundant. Close it
     with a comment pointing to the newer one (`gh pr close <n> --comment "Superseded by #<m>"`); do not merge it.
   - **Some packages in common, but the older PR also has packages the newer one lacks** (for example the GitHub Actions
     bumps while the newer PR is npm only): never close it, that would drop those updates. Process the newer PR first,
     then comment `@dependabot rebase` on the older one. Dependabot removes what is already updated; if nothing is left it
     closes the PR itself, otherwise carry on with it as a normal PR.

   Order: overlapping PRs newest first, independent ones oldest first. Every merge changes `package-lock.json`, so after
   each merge comment `@dependabot rebase` on the PRs still open, wait for the rebase and re-run steps 3 and 4 on them.
   Do the following steps for each PR that is left.
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
   ask the user to run `npm start` or `npm run make:mac` on the Mac before merging. With several PRs, ask once for all of
   them, not once per PR.
5. **If something breaks,** fix it on the Dependabot branch with a small follow-up commit (adapt code to the new API,
   adjust types). If the fix is large or the cause is one package, do not hold up the other updates: ask the user, then
   either add an `ignore` entry for that package (with a comment why) to `.github/dependabot.yml` and ask Dependabot to
   recreate the PR (`@dependabot recreate`), or open a separate issue with the `write-backlog-issue` skill.
   Never skip or disable a test to get green. A PR that cannot be merged does not stop the others, unless it overlaps
   with them.
6. **Check the diff** against `.claude/rules/electron-pr-checks.md` (new advisories, new heavy dependencies, changed
   Electron version). Changes to `docs/arc42.md` need the user's approval; a bump that contradicts it (for example
   moving `drizzle-*`) means stop and ask.
7. **Merge** with `mcp__github__merge_pull_request` (or `gh pr merge <n> --squash`), method `squash`, title
   `Update dependencies (<YYYY-MM-DD>)`. If the base branch policy blocks it (for example a required review), do not
   use an admin override or auto-merge on your own: ask the user first.
8. **Report** for all PRs together: what was merged, which major bumps were in it, which PRs were closed as redundant
   (and by which PR), what was fixed or ignored, what is still open and why, and anything the user should test on the Mac.
   Finish by checking `gh pr list --label dependencies`: nothing should be open that could have been merged or closed.

## Notes
- The Dependabot branch lives in this repository, so pushing a fix to it is allowed. Dependabot stops rebasing a branch
  once it has a manual commit; if `main` moves on, merge `main` into the branch yourself.
- Security updates for vulnerable packages are PRs of their own and are handled like the weekly one, with the same steps.
