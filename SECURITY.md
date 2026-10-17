# Security policy

## Supported versions

Filey is early software (0.x). Security fixes go into the latest release only.

## Reporting a vulnerability

Please report vulnerabilities **privately**, not in a public issue or pull request:

1. Go to the [Security tab](https://github.com/FlrnDml/filey/security) of this repository.
2. Choose **Report a vulnerability** and describe the problem: what you found, how to reproduce it and what an attacker could do.

You will get a reply as soon as the maintainer can; Filey is a spare-time project, so please be patient. Once a fix is
released, the advisory is published and you are credited if you wish.

## What is in scope

- The Filey app: the main process, the preload bridge, the renderer, and how it handles files, paths, the API key and the
  data it sends out.
- Anything that lets a scanned document, its text or its file name run code, read or write files outside the inbox and
  target folders, or leak the API key.

Not in scope: vulnerabilities in OpenRouter or in the model providers behind it (report those to them), and issues that need
an attacker who already has full access to your Mac or your OpenRouter account.

## Privacy

- **What leaves your Mac:** the content of each new PDF in the inbox, sent over HTTPS to OpenRouter and from there to the provider of the model you chose (for the default model, Google). Scanned letters often contain health and financial data; choose a model and provider you trust, and check their data policies on OpenRouter.
- **PDF parsing on OpenRouter:** for models without native PDF support, OpenRouter converts the PDF before it reaches the model. Depending on its parsing engine this can cost extra and may involve a further service. Prefer models that read PDFs or images natively.
- **Nothing else leaves your Mac.** No telemetry, no analytics, no account, no Filey backend. Settings, the inbox entries and the history live in a local SQLite database in `~/Library/Application Support/Filey`; your documents stay in your own folders (and sync through iCloud Drive as usual).
- **Your API key** is encrypted with macOS Keychain–backed storage (Electron `safeStorage`) and is only ever sent to OpenRouter. Logs never contain the key or document contents.

The design background is in the cross-cutting concepts of [docs/arc42.md](docs/arc42.md).

## Known limitations

- Builds are **not signed or notarized** yet, so macOS asks you to confirm the first launch. Download Filey only from the
  [GitHub Releases](https://github.com/FlrnDml/filey/releases) of this repository.
- Text inside a scanned document can try to steer the AI model (prompt injection). The effect is limited: the model can only
  pick one of your folders, file names are sanitized and the model has no tools (arc42 §11, risk 8).
