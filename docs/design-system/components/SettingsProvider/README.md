The Provider tab of the settings window: the one thing a new user must do. Paste an OpenRouter key, optionally name a model, press Test connection.

- Standard macOS window, 620px wide, traffic lights, toolbar-style tabs (General, Provider, Filing); the active tab uses `accent-subtle` and `accent`.
- The key field is masked and `mono`; a hint says it lives in the Keychain. The model field is optional and says what the default is.
- **Test connection** reports in words: "Connected · model can read PDFs" in `success`, or the reason in `danger`.
- The privacy note stays visible, in `text-muted`, below a hairline. The consumer provides the values and the test handler; the factory behind it must not assume OpenRouter forever.
