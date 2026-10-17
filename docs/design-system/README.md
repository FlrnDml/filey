# Filey

The design system for Filey, a macOS menu-bar app that files scanned PDFs automatically. You scan a letter with your iPhone, drop it in an iCloud folder, and Filey reads it with an AI model, renames it and moves it into the right folder. This is an MVP system: a neutral palette, one blue accent, light and dark themes, and the handful of surfaces the app actually has. The look is native-feeling and quiet, in the spirit of Maccy.

## Where Filey shows up
- **Menu bar icon** (scanner glyph) opens the **popover**: an Inbox view (files still waiting) and a History view (filed documents, with search), quick actions. This is the main surface; most people never see anything else.
- **Settings window** with three tabs: General, Provider (OpenRouter key and model) and Filing (folders, naming template, folder rules).
- **First-launch window**, three steps: key, start at login, "I live in the menu bar now".
- No Dock icon, no main window.

## Principles
- **Invisible until needed.** Filey works in the background; every surface is small, fast and dismissible with Esc.
- **Native first.** Use the system font, standard traffic lights, native pickers and menu shortcuts (⌘, to open Settings, ⌘Q to quit).
- **Tell the truth about files.** Always show where a document went, or why it stayed in the inbox. Never hide a failure in colour alone.
- **Private by default.** Say plainly what leaves the Mac (the PDF goes to OpenRouter and the chosen model provider, nothing else).
- **One accent.** Blue means "selected, or you can act on this".

## Content fundamentals
- Plain, short, sentence case: "Test connection", not "Test Your Connection".
- Say what happened and where: "Filed to Health/Health insurance", "OpenRouter unreachable · stays in inbox".
- Buttons are verbs ("Choose…", "Add rule"). The ellipsis marks actions that open another step.
- Document examples are real-feeling English mail (health insurance, car insurance, tax office), since that is what users scan. UI copy is English.
- No exclamation marks, no emoji.

## Visual foundations
- **Colour:** `bg` for windows and the popover, `surface` for hover and the desktop behind a window, `text` and `text-muted` for copy. Status colours (`success`, `warning`, `danger`) are for dots, pills and short text, never large fills.
- **Type:** the system font (SF Pro on macOS; Inter is only a fallback). `body` 15px for file names, `small` 13px for metadata, `label` for controls, `mono` for paths, templates and API keys.
- **Spacing and shape:** 4px base. Windows and the popover use `radius-lg`, controls `radius-md`. Windows get `shadow-md`; everything inside is separated by `border` hairlines.
- **Rows:** inbox and history rows are 48px, menu items 32px, inputs and buttons 36px.
- **Focus:** a 2px `focus-ring` outline with 2px offset; the whole popover is keyboard-driven.
- **Contrast:** text is 4.5:1 or better in both themes; input outlines use `border-control` (3:1).
- **Dark mode:** follows the system; the same tokens, different values.

## Iconography
Outline icons, 1.5px stroke, round caps, 16 / 18 / 20px, drawn in `currentColor`. The brand mark is a flatbed scanner (see TrayIcon). The menu-bar icon ships as a monochrome template image so macOS tints it. No icon library is bundled; the previews draw the few glyphs they need inline. Lucide matches the style when the app needs more.

## Components
**Menu bar:** MenuBarPopover, InboxRow, HistoryRow · **Brand:** TrayIcon · **Settings:** SettingsProvider, SettingsFiling · **First launch:** Onboarding · **Basics:** Button, Input, FileRow.
