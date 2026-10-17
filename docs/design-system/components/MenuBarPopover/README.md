The main surface of Filey: a popover that opens from the menu-bar icon. Filey has no Dock icon and no main window, so this is what most people see.

- 360px wide, `radius-lg`, `border` outline, `shadow-md`. It opens under the tray icon and closes on click outside or Esc.
- **Header:** scanner icon (`accent`), the name, and a status line: "Watching <inbox>" with a `success` dot, or "Paused" / "Needs attention" in `warning`.
- **View switch** below the header: a full-width segmented control (`surface` track with a `border` hairline, `radius-md`, two equal 28px segments in `label` type). The selected segment is `bg` with `shadow-sm` and `text`, the other `text-muted`. The Inbox segment carries a count badge (`warning` fill, white 11px text) for files that need attention (failed or duplicate). ⌘1 shows the Inbox, ⌘2 the History; Left/Right move between the segments when the switch has focus.
- **Inbox** (unprocessed imports, files still in the inbox folder): a muted caption, then `InboxRow`s with status pills and, on the selected row, an action strip. Up/Down select, Return runs the main action, ⌘⌫ moves the file to the Trash. When nothing is left, a centred "Inbox is clear" with a `success` check icon.
- **History** (filed documents): the search field "Search filed documents" and `HistoryRow`s with a status dot. Up/Down select, Return reveals the PDF in Finder. Search only exists here.
- The popover opens on the Inbox when it has entries and on the History otherwise; this is decided again each time the window is shown. A view the user picked stays while the popover is open.
- **Footer:** plain menu items with their shortcuts in `text-muted`: Open inbox folder ⌘I, Settings… ⌘,, Quit Filey ⌘Q.
- The consumer provides the inbox and history rows, the watched folder name and the handlers.
