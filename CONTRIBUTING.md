# Contributing to Filey

Thanks for your interest in Filey! Bug reports, ideas and pull requests are welcome. Please be respectful and patient, and
keep issues and pull requests on topic.

## Before you start

- **Bugs:** open an [issue](https://github.com/FlrnDml/filey/issues/new/choose) with the steps to reproduce and the relevant
  lines from the log (right-click the menu-bar icon → Show logs). Never post your API key or a scanned document.
- **Security problems:** report them privately, see [SECURITY.md](SECURITY.md).
- **Larger changes:** open an issue first so we can agree on the approach. [docs/arc42.md](docs/arc42.md) is the source of
  truth for requirements and design decisions. A change that contradicts it needs a discussion first, and changes to the
  document itself are made with the maintainer's agreement.
- **Language:** English only for the app, code, comments, documentation, issues, pull requests and commit messages.
  Scanned documents themselves can be in any language.

## Tech stack and layout

Electron 44 with Electron Forge 8 (Webpack), TypeScript, React and Vitest. [docs/arc42.md](docs/arc42.md) describes the
architecture and [docs/design-system](docs/design-system/README.md) the UI.

| Folder | Purpose |
| --- | --- |
| `src/main/` | Main process: tray, windows, IPC handlers (`ipc/`), Electron adapters (`adapters/`). All I/O and AI calls live here. |
| `src/preload/` | Preload script: exposes the typed `window.filey` API through `contextBridge`. |
| `src/renderer/` | React UI. No Node access; talks to the main process only through `window.filey`. |
| `src/core/` | Pure logic and the shared IPC contract (`ipc.ts`). Must not import Electron (ESLint enforces this); Electron features are reached through the ports in `core/ports/`, so tests pass fakes. |

Tests live next to the code as `*.test.ts(x)`. Tests that use `node:sqlite` need Node 24 (see `.nvmrc`).

## Set up

Requirements: Node 24.22.0 (the pinned LTS in `.nvmrc`; `nvm use` or `fnm use` picks it) and npm. Linting and the unit tests also run on Linux and in CI;
starting the app and building a DMG need a Mac.

```sh
npm ci                  # headless/CI: ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
npm run lint
npm run typecheck
npm test                # unit tests in plain Node and jsdom, no Electron needed
```

Other scripts:

```sh
npm run tokens          # regenerates src/renderer/styles/tokens.css from docs/design-system/tokens.json
npm run db:generate     # after changing src/core/db/schema.ts: writes a migration to drizzle/ and bundles it (see arc42 §8)
npm run licenses        # regenerates THIRD_PARTY_LICENSES.md from the runtime dependencies
```

## Run the app locally

On a Mac, after `npm ci` (the first start downloads the Electron binary):

```sh
npm start
```

This is `electron-forge start`: Webpack builds the main process, the preload script and the renderer, and opens Filey.
Renderer changes are picked up live. After changes to `src/main/` or `src/preload/`, type `rs` and Return in the terminal to
restart the app. Stop it with Ctrl+C in the terminal.

- Filey is a menu-bar app: look for its icon in the menu bar, there is no Dock icon. The first launch shows the
  onboarding window (paste your OpenRouter key and choose the folders).
- The main process logs to the terminal and to `~/Library/Logs/Filey/filey.log`.
- Quit an installed copy of Filey before you start the development version, so that the two do not watch the same inbox.

## Making a change

1. Fork the repository and create a branch.
2. Keep the change focused and add or update tests.
3. Run `npm run lint`, `npm run typecheck` and `npm test`; CI runs the same checks.
4. Review your diff against the [Electron security and performance checklist](.claude/rules/electron-pr-checks.md). It
   applies to code that touches Electron APIs, IPC, windows, file access or startup. Treat scanned documents and OCR text as
   untrusted input.
5. Open a pull request and fill in the template. Explain what changed and why.

Use real-looking but fictional data in tests, examples and screenshots (made-up organisations, "Max Mustermann", all-zero
IBANs). Never add real documents or personal data.

Using an AI coding assistant is fine; you are responsible for the result, so read and test what it produces.

## Build a DMG for testing

The easiest way is the newest **pre-release** on the [releases page](https://github.com/FlrnDml/filey/releases): every
change merged to `main` is built there automatically (see below). To build a branch yourself, on a Mac:

```sh
npm ci
npm run make:mac        # universal build (arm64 + x64), about as long as a release build
```

The result is `out/make/dmg/universal/Filey-undefined-universal.dmg` plus a zip next to it: `package.json` has no
version (see Releases below), so a local build has none either; only the CI builds are stamped. For a quicker build of
your own Mac's architecture only, run `npm run make`; the DMG is then under `out/make/`.

Open the DMG, drag Filey to Applications and start it. A DMG you built yourself normally opens right away; one downloaded
needs the "Open Anyway" steps from the README (the app is ad-hoc signed, not notarized). Quit any running development
copy first. Delete `out/` (`rm -rf out`) when a build fails or looks stale. Nothing is uploaded by these commands.

## Releases (maintainers)

GitHub Actions builds and publishes everything; nothing is built or uploaded from a developer machine. The version comes
from the git tags only: `package.json` has no `version` and releases never change it, the workflows stamp the version
into the build (arc42 §8, "Versioning").

- **Pre-releases, automatic.** Every push to `main` that changes more than docs runs
  [`prerelease.yml`](.github/workflows/prerelease.yml): lint, typecheck, tests, the universal build, and a **pre-release**
  `vX.Y.Z-prerelease.N` (X.Y.Z is the next patch after the last release) with the DMG and zip and no release text. All
  pre-releases are kept.
- **Real release, manual.** Test the newest pre-release, then open **Actions → Release → Run workflow** and choose `bump`
  (`patch`, `minor` or `major`; the very first release is always `0.0.1`). By default it releases the commit of
  the newest pre-release, so you ship exactly what you tested; `ref` takes another commit on `main`. The workflow rebuilds
  with the real version and creates a **draft** release `vX.Y.Z` with GitHub's generated notes as a starting point.
- **Publish.** Open the draft on the releases page, write or edit the text explaining what is new, and click
  **Publish release**; GitHub then creates the tag. You can edit the text after publishing too. Download the DMG once to
  check it.

Optional: under **Settings → Environments → release** add yourself as required reviewer, so the Release workflow waits
for a confirmation. Both workflows use only the built-in `GITHUB_TOKEN` with `contents: write`; there is no personal token
or secret to manage. Version logic lives in `scripts/release-version.mts`.
