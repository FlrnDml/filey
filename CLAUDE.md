# filey

Electron desktop app (Node.js).

## Workflow
- Develop on the branch assigned to the session, commit with clear messages and push.
- After every completed change, automatically open a pull request against `main`
  (do not wait to be asked). Fill in `.github/pull_request_template.md`.
- Do not merge pull requests yourself unless explicitly asked.
- Before opening a PR, apply `.claude/rules/electron-pr-checks.md` (Electron security and
  performance best practices) to the diff.
- Run `npm run lint`, `npm run typecheck` and `npm test` (when defined) before pushing.

## Architecture documentation
- `docs/arc42.md` is the source of truth for requirements and design decisions.
- Change arc42 only with explicit approval of the user: propose the change first
  (what and why), and edit the file only after the user agrees.
- If an implementation would contradict arc42, stop and ask instead of deviating silently.

## Documentation
- `README.md` is user-focused; contributor topics go to `CONTRIBUTING.md`, privacy and security to `SECURITY.md`.
  See `.claude/rules/documentation-structure.md`.

## Backlog
- Write and update GitHub issues with the `write-backlog-issue` skill
  (`.claude/skills/write-backlog-issue/SKILL.md`).

## Releases
- Releases are built by GitHub Actions, not locally: every push to `main` becomes a pre-release (`prerelease.yml`), and
  the maintainer starts the manual `Release` workflow (`release.yml`), which creates a **draft** release; the maintainer
  writes the text and publishes it. See "Releases" in `CONTRIBUTING.md`. Never publish a release or merge a release
  change yourself, and never create tokens or secrets for it. There is no changelog file.

## Language
- English only: app UI, code, comments, documentation, issues, pull requests and commit messages.
  No other UI languages for now. Scanned documents themselves can be in any language.

## Notes
- Cloud sessions are headless and skip the Electron binary download
  (`ELECTRON_SKIP_BINARY_DOWNLOAD=1`), so keep logic unit-testable without launching Electron.
