One file that is still in the inbox, in the popover's Inbox view: document icon, the scan's file name, a second line that says what is going on, and a status pill.

- 48px tall, `radius-md`. Hover and the selected row use `accent-subtle`.
- The second line and the pill always say the state in words; colour is never the only signal:
  - **Failed:** the error in `danger`, pill "Failed" (`danger` outline).
  - **Duplicate:** "Duplicate of <filed name>" (or "Duplicate of a filed document") in `warning`, pill "Duplicate" (`warning` outline).
  - **Working:** "Analyzing…" in `accent`, pill "Working" (`accent` on `accent-subtle`).
  - **Waiting:** "Waiting for the connection" in `text-muted`, pill "Waiting" (`border-control` outline). Pending files while Filey is offline.
  - **New:** "New · waiting to be filed" in `text-muted`, pill "New". Pending files while Filey is online.
- The selected row expands an action strip under it, indented to the text: 28px buttons, `radius-sm`, one per line and all as wide as the widest one. Failed: Retry ↩ (primary), Show in Finder, Move to Trash (`danger` text). Duplicate: Show original, Show in Finder, Move to Trash. Otherwise: Show in Finder.
- Keyboard: Up/Down select, Return runs the main action (retry, show original, show in Finder), ⌘⌫ moves the file to the Trash.
- Names truncate with an ellipsis. The consumer provides the name, status and the second line of failed and duplicate rows.
