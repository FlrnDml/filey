# Renderer

React UI of Filey. The visual spec is the design system in `docs/design-system/` (arc42 §2).

## Tokens
- `styles/tokens.css` is generated from `docs/design-system/tokens.json` by `npm run tokens`
  (`scripts/build-tokens.mts`). Never edit it by hand; `test/tokens.test.ts` fails when it is out of date.
- Colours, type, spacing, radii and shadows come only from these custom properties:
  `var(--accent)`, `var(--space-4)`, `var(--radius-md)`, `font: var(--type-label)` or the classes
  `.type-display`, `.type-title`, `.type-body`, `.type-label`, `.type-small`, `.type-mono`.
- Dark mode follows the system (`prefers-color-scheme`); the same names get dark values.
- `styles/base.css` sets body colours, box-sizing, the focus ring (2px `--focus-ring`, 2px offset),
  `.visually-hidden` and reduced motion. `index.tsx` imports both files once.

## Components
Import from `./components` (e.g. `import { Button, Input, Tabs } from './components';`).
Each lives in `components/<Name>/` with `<Name>.tsx`, a plain `<Name>.css` (class prefix `filey-`) and tests.

To add one:
1. Read its `docs/design-system/components/<Name>/README.md` and `preview.html`.
2. Create `components/<Name>/<Name>.tsx` + `.css` using tokens only, typed props, and English
   sentence-case copy without emoji or exclamation marks.
3. Make it keyboard reachable, label every control, never use colour as the only signal.
4. Add `<Name>.test.tsx` (runs in jsdom via `npm test`) and export it from `components/index.ts`.

## Surfaces and screens
Every window loads the same entry page (`index.html` + `index.tsx`); the URL fragment picks the screen
(`src/core/surfaces.ts`, routed in `App.tsx`):

| Fragment | Screen | Window (src/main/windows.ts) |
|----------|--------|------------------------------|
| `#popover` | `screens/Popover/` | frameless popover under the tray icon, opened by a tray click |
| `#settings/<general\|provider\|filing>` | `screens/Settings/` | Settings window, `window.filey.app.openSettings(tab)` |
| `#onboarding` | `screens/Onboarding/` | first-launch window, opened by main on start while `onboardingCompleted` is false; "Got it" calls `app.completeOnboarding()` and main closes it |

Main accepts IPC only from the entry page with exactly one of these fragments (`isAppPage` in
`src/main/window.ts`), so a new surface needs an entry in `src/core/surfaces.ts` first. The Settings screen
keeps the fragment in sync with the selected tab (`history.replaceState`) and follows `hashchange` when main
opens another tab. Screens take the bridge from `window.filey`; every screen also accepts an `api` prop so
tests pass `createMockFiley()` from `test/mockFiley.ts` (the onboarding screen also takes `initialStep`,
so tests can start on a later step).

The Settings screen (`screens/Settings/`) has one component per tab (`GeneralTab`, `ProviderTab`, `FilingTab` with
`FolderRules`). Fields save when they are committed (blur, Return, a chosen folder) and show their result in words
right below; folder rules save together with "Save rules". The renderer imports only pure core modules
(`core/settings/types`, `core/filer/naming` for the template preview); anything with Node imports stays in main.

## Content-Security-Policy
`index.html` sets a CSP meta tag for all windows: scripts only from the app (no inline scripts, no eval),
`style-src 'unsafe-inline'` only because style-loader injects the bundled CSS as `<style>` elements. The dev
build uses a non-eval source map (`webpack.renderer.config.ts`) so the same policy works with `npm start`.
