One filed document in the popover's History view: document icon, the filed name, then the destination folder and time in `text-muted`.

- 48px tall, `radius-md`. Selected (keyboard or hover) uses `accent-subtle`.
- A **Filed** indicator on the right in `success`: a pill in wide layouts, a dot at popover width. The label stays available as text, colour is never the only signal.
- Names truncate with an ellipsis. The consumer provides the name, folder and time.
- Files that are still in the inbox (failed, duplicate, working, waiting, new) are not part of the history; they use InboxRow.
