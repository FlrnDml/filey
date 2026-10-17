# Electron security and performance checks for pull requests

Before opening or updating a pull request, review the diff against the official Electron guides:

- Security: https://www.electronjs.org/docs/latest/tutorial/security
- Performance: https://www.electronjs.org/docs/latest/tutorial/performance

Re-read the current guides when the change touches Electron APIs; they are updated regularly.
Skip items that do not apply to the diff. Fix violations in the PR, or call them out under
"Notes" in the PR description with the reason. If a fix would contradict `docs/arc42.md`,
stop and ask (see `CLAUDE.md`).

## Security checklist (only for changed code)
- Never load remote content in a window with Node integration. Keep `nodeIntegration: false`,
  `contextIsolation: true` and `sandbox: true`; do not set `webSecurity: false` or
  `allowRunningInsecureContent`.
- Expose only narrow, purpose-specific functions through `contextBridge` in preload scripts.
  Never expose `ipcRenderer` or other raw Electron/Node APIs.
- Validate every IPC message in the main process: check the sender (`event.senderFrame`) and
  validate and sanitize all arguments (file paths included).
- Use `ipcMain.handle`/`invoke`, not synchronous IPC.
- Do not use `eval`, `new Function`, `dangerouslySetInnerHTML`, or `innerHTML` with untrusted
  data. Scanned document content and OCR text are untrusted.
- Define a Content-Security-Policy; avoid `unsafe-eval` and `unsafe-inline`.
- Handle `setWindowOpenHandler` and `will-navigate`: deny or allow-list new windows and
  navigations. Only pass `http(s)` URLs to `shell.openExternal` after validating them.
- Load resources over HTTPS only; do not disable certificate verification.
- Do not enable the `webview` tag or `allowpopups` without a reviewed need.
- Keep Electron and dependencies reasonably current; run `npm audit` and mention new
  advisories introduced by the PR.
- Restrict file-system access to what the feature needs; resolve and check paths before use.

## Performance checklist (only for changed code)
- Keep the main process free of blocking work: no synchronous `fs`/`child_process`/IPC calls,
  no CPU-heavy work (OCR, PDF rendering, image processing). Use async APIs, worker threads,
  utility processes or a hidden renderer.
- Load modules lazily and defer non-essential work until after the window is shown; avoid
  heavy `require`/`import` at startup.
- Add dependencies deliberately: check their size and startup cost; prefer small or native
  modules and avoid duplicates.
- Do not block the renderer: avoid long synchronous tasks, paginate or virtualize large lists
  (document libraries), and clean up listeners and timers.
- Avoid unnecessary or polling-style work (timers, `setInterval`, file watchers on large
  trees); don't keep hidden windows or background work running without need.
- Consider bundling/minifying the renderer and main code when it noticeably reduces load time.
- Profile (DevTools Performance tab, `--trace-startup`) when a change plausibly affects startup
  or responsiveness, and note the result in the PR.

## In the PR description
Add one line under "Notes" stating the checks were done, listing any findings and their
resolution (or "no security/performance impact").
