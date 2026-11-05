# Pull request titles

Every pull request title starts with one of four types, followed by a colon and a short description:

`<type>: <description>`

| Type | Use it for |
|------|------------|
| `feat` | Something new: a feature or a user-visible improvement. |
| `fix` | A bug fix, with or without a ticket. |
| `docs` | Documentation only: `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/`, code comments. |
| `chore` | Everything that has to be done but adds no feature and fixes no bug: dependency upgrades, tooling, build, CI, refactoring, tests, and security vulnerabilities (`npm audit`, advisories). |

## Rules
- Lowercase type, no scope, no trailing period. Use the imperative mood: `fix: keep scan folder after restart`.
- English only, like everything else in the repo (see `CLAUDE.md`).
- Pick the single type that fits best. If a change mixes types, split it into separate pull requests. A fix that needs
  a small supporting change is still a `fix`. A feature with its docs is still a `feat`.
- A fix for a ticket is still `fix:`. Do not put the ticket number in the title; GitHub appends the pull request number
  when squash-merging. Reference the ticket in the "Summary" of the template instead (`Closes #123`).
- Security vulnerabilities in dependencies or tooling are `chore`. A vulnerability in Filey's own code is a `fix`.
- Not sure between two types? `feat` is for what users notice, `fix` is for what was broken, `chore` is for upkeep.

## Branches and commits
- Name the branch `<type>/<short-kebab-description>`, for example `fix/duplicate-check-original-exists`.
- Commit messages use the same `<type>: <description>` form. With squash merging, the PR title becomes the commit
  message on `main`.

## Exception
Dependabot pull requests are generated with the `deps:` prefix (see `.github/dependabot.yml`) and are left as they are.
Handle them with the `dependency-updates` skill.

## Examples
- `feat: detect duplicates while importing`
- `fix: keep the scan folder after restart`
- `docs: explain iCloud placeholders in the README`
- `chore: upgrade Electron to the latest patch release`
- `chore: fix npm audit advisory in dependency tree`
