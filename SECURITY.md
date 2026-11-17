# Security policy

## Reporting a vulnerability

Please report vulnerabilities **privately**, not in a public issue or pull request:

1. Go to the [Security tab](https://github.com/FlrnDml/filey/security) of this repository.
2. Choose **Report a vulnerability** and describe the problem: what you found, how to reproduce it and what an attacker could do.

You will get a reply as soon as the maintainer can; Filey is a spare-time project, so please be patient.

## Privacy

- **With Ollama (on this Mac), your documents never leave your Mac.** Filey renders the first three pages of each new PDF to images in a hidden window and sends them to Ollama over HTTP on your own computer (`localhost`, `127.0.0.1` or `[::1]`; Filey refuses any other address). The model download is done by Ollama itself from its public model library; Filey sends no document content there. Filey does not start or bundle Ollama; it is a separate app you install.
- **With OpenRouter, the content of each new PDF in the inbox leaves your Mac:** it is sent over HTTPS to OpenRouter and from there to the provider of the model you chose (for the default model, Google). Scanned letters often contain health and financial data; choose a model and provider you trust, and check their data policies on OpenRouter.
- **PDF parsing on OpenRouter:** for models without native PDF support, OpenRouter converts the PDF before it reaches the model. Depending on its parsing engine this can cost extra and may involve a further service. Prefer models that read PDFs or images natively.
- **Nothing else leaves your Mac.** No telemetry, no analytics, no account, no Filey backend. Settings, the inbox entries and the history live in a local SQLite database in `~/Library/Application Support/Filey`; your documents stay in your own folders (and sync through iCloud Drive as usual).
- **Your OpenRouter API key** (not needed for Ollama) is encrypted with macOS Keychain–backed storage (Electron `safeStorage`) and is only ever sent to OpenRouter. Logs never contain the key, document contents or page images.

The design background is in the cross-cutting concepts of [docs/arc42.md](docs/arc42.md).

## Known limitations

- Builds are **not signed or notarized** yet, so macOS asks you to confirm the first launch. Download Filey only from the
  [GitHub Releases](https://github.com/FlrnDml/filey/releases) of this repository.
- Anything else running on your Mac can talk to Ollama, because Ollama has no login; that is how Ollama works, not something Filey changes. Page images that Filey sends to it are not stored by Filey.
- Text inside a scanned document can try to steer the AI model (prompt injection). The effect is limited: the model can only
  pick one of your folders, file names are sanitized and the model has no tools (arc42 §11, risk 8).
