import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { matchesQuery } from '../../../core/history/match';
import {
  POPOVER_HEIGHT,
  type AppState,
  type FileyApi,
  type HistoryRow as HistoryEntry,
  type InboxRow as InboxEntry,
  type RetryResult,
  type RevealResult,
} from '../../../core/ipc';
import { Button, HistoryRow, Icon, InboxRow, Input, MenuItem, Tabs } from '../../components';
import { cx } from '../../components/cx';
import { folderName, historyRowProps, inboxRowProps, removeRow, statusLine, upsertHistory, upsertInbox } from './format';
import './Popover.css';

/** How many filed documents the popover loads and searches. */
export const HISTORY_LIMIT = 100;

type View = 'inbox' | 'history';

const RETRY_MESSAGES: Partial<Record<RetryResult, string>> = {
  'not-found': 'This file is no longer in the inbox.',
  'not-failed': 'This import did not fail, so there is nothing to retry.',
  'file-missing': 'The file is no longer in the inbox, so it cannot be retried.',
};

const PAUSED_TEXT = {
  missing: 'Filey needs your OpenRouter API key before it can file new scans.',
  unreadable: 'Filey cannot read the saved API key. Enter it again in Settings.',
} as const;

const systemNow = () => new Date();

/** The view to start in: the Inbox when it has entries, otherwise the History. */
const defaultView = (inbox: readonly InboxEntry[] | null): View => (inbox && inbox.length > 0 ? 'inbox' : 'history');

export interface PopoverProps {
  /** The preload bridge; tests pass a mock. */
  api?: FileyApi;
  /** Clock for relative times. */
  now?: () => Date;
}

/** Outcome of an action that can fail with a message for the user. */
type ActionOutcome = { ok: true } | { ok: false; message: string };

/**
 * The menu-bar popover (docs/design-system/components/MenuBarPopover): status, a switch between the Inbox
 * (files still in the inbox folder) and the History (filed documents), and quick actions. Keyboard-driven:
 * focus stays in the search field (History) or the list (Inbox), Up/Down move the selection, Return runs the
 * main action of the selected row, ⌘1 and ⌘2 switch views, Esc hides the popover.
 */
export function Popover({ api = window.filey, now = systemNow }: PopoverProps) {
  const [inboxRows, setInboxRows] = useState<InboxEntry[] | null>(null);
  const [historyRows, setHistoryRows] = useState<HistoryEntry[] | null>(null);
  const [state, setState] = useState<AppState | null>(null);
  const [inboxPath, setInboxPath] = useState<string | null>(null);
  const [view, setView] = useState<View>('history');
  const [query, setQuery] = useState('');
  const [selectedInboxId, setSelectedInboxId] = useState<number | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<number | null>(null);
  const [retrying, setRetrying] = useState<ReadonlySet<number>>(() => new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [clock, setClock] = useState(now);
  const [focusTick, setFocusTick] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const inboxListRef = useRef<HTMLDivElement>(null);
  // The latest inbox rows for the focus handler, and whether the user picked a view since the window was shown.
  const inboxRowsRef = useRef<InboxEntry[] | null>(null);
  const pickedRef = useRef(false);
  const listId = useId();
  const inboxListId = `${listId}-inbox`;
  const historyListId = `${listId}-history`;

  // Live data: subscribe first, then load, so no change between the two is lost.
  useEffect(() => {
    let active = true;
    // Files that left the inbox or history before its list arrived must not come back with the list.
    const removedInbox = new Set<number>();
    const removedHistory = new Set<number>();
    const applyInbox = (update: (rows: InboxEntry[] | null) => InboxEntry[]) => {
      inboxRowsRef.current = update(inboxRowsRef.current);
      setInboxRows(inboxRowsRef.current);
    };
    const offInbox = api.inbox.onChanged((change) => {
      if (change.kind === 'upsert') {
        removedInbox.delete(change.row.id);
        applyInbox((prev) => upsertInbox(prev ?? [], change.row));
      } else {
        removedInbox.add(change.id);
        applyInbox((prev) => removeRow(prev ?? [], change.id));
      }
    });
    const offHistory = api.history.onChanged((change) => {
      if (change.kind === 'upsert') {
        removedHistory.delete(change.row.id);
        setHistoryRows((prev) => upsertHistory(prev ?? [], change.row, HISTORY_LIMIT));
      } else {
        removedHistory.add(change.id);
        setHistoryRows((prev) => removeRow(prev ?? [], change.id));
      }
    });
    const offState = api.state.onChanged(setState);
    const offSettings = api.settings.onChanged((settings) => setInboxPath(settings.inboxPath));
    api.inbox.list().then(
      (list) => {
        if (!active) return;
        applyInbox((prev) => (prev ?? []).reduce((acc, row) => upsertInbox(acc, row), list.filter((row) => !removedInbox.has(row.id))));
        if (!pickedRef.current) setView(defaultView(inboxRowsRef.current));
      },
      () => active && applyInbox((prev) => prev ?? []),
    );
    api.history.list({ limit: HISTORY_LIMIT }).then(
      (list) =>
        active &&
        setHistoryRows((prev) => (prev ?? []).reduce((acc, row) => upsertHistory(acc, row, HISTORY_LIMIT), list.filter((row) => !removedHistory.has(row.id)))),
      () => active && setHistoryRows((prev) => prev ?? []),
    );
    api.state.get().then(
      (s) => active && setState(s),
      () => undefined,
    );
    api.settings.get().then(
      (s) => active && setInboxPath(s.inboxPath),
      () => undefined,
    );
    return () => {
      active = false;
      offInbox();
      offHistory();
      offState();
      offSettings();
    };
  }, [api]);

  // The window is reused: each time it is shown, pick the default view again (Inbox if it has entries) and start
  // with fresh relative times. A view the user picked stays while the window stays open.
  useEffect(() => {
    const onFocus = () => {
      setClock(now());
      setMessage(null);
      pickedRef.current = false;
      setView(defaultView(inboxRowsRef.current));
      setFocusTick((tick) => tick + 1);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [now]);

  const hasInboxList = (inboxRows?.length ?? 0) > 0;
  const focusPrimary = () => (searchRef.current ?? inboxListRef.current)?.focus();

  // Focus belongs in the search field or the list; a keyboard user switching views stays on the tab.
  useEffect(() => {
    if (document.activeElement?.getAttribute('role') !== 'tab') focusPrimary();
  }, [view, hasInboxList]);

  useEffect(() => {
    if (focusTick > 0) focusPrimary();
  }, [focusTick]);

  // The window fits the content: report the panel height to main.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    let last = 0;
    const observer = new ResizeObserver(() => {
      const height = Math.min(POPOVER_HEIGHT.max, Math.max(POPOVER_HEIGHT.min, Math.ceil(root.getBoundingClientRect().height)));
      if (height === last) return;
      last = height;
      api.popover.setHeight(height).catch(() => undefined);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [api]);

  // `working` in a row is a snapshot from when the row was sent; the analysis can end without the row being sent
  // again (e.g. a timeout). The live `analyzingId` of the app state decides, once it is known.
  const inboxList = useMemo(
    () => (inboxRows ?? []).map((row) => (state && row.working !== (state.analyzingId === row.id) ? { ...row, working: !row.working } : row)),
    [inboxRows, state],
  );
  const inboxIndex = Math.max(
    0,
    inboxList.findIndex((row) => row.id === selectedInboxId),
  );
  const selectedInbox = inboxList[inboxIndex];

  const visibleHistory = useMemo(() => (historyRows ?? []).filter((row) => matchesQuery(row, query)), [historyRows, query]);
  const historyIndex = Math.max(
    0,
    visibleHistory.findIndex((row) => row.id === selectedHistoryId),
  );
  const selectedHistory = visibleHistory[historyIndex];

  const inboxOptionId = (id: number) => `${inboxListId}-option-${id}`;
  const historyOptionId = (id: number) => `${historyListId}-option-${id}`;

  const activeOptionId = view === 'inbox' ? (selectedInbox ? inboxOptionId(selectedInbox.id) : undefined) : selectedHistory ? historyOptionId(selectedHistory.id) : undefined;
  useEffect(() => {
    const node = activeOptionId ? document.getElementById(activeOptionId) : null;
    if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' });
  }, [activeOptionId]);

  const selectView = useCallback((next: View) => {
    pickedRef.current = true;
    setView(next);
  }, []);

  const run = useCallback(async (action: () => Promise<ActionOutcome>, failure: string) => {
    setMessage(null);
    try {
      const result = await action();
      if (!result.ok) setMessage(result.message);
    } catch {
      setMessage(failure);
    }
  }, []);

  const retry = useCallback(
    async (id: number) => {
      setMessage(null);
      setRetrying((prev) => new Set(prev).add(id));
      try {
        const result = await api.inbox.retry(id);
        const text = RETRY_MESSAGES[result];
        if (text) setMessage(text);
      } catch {
        setMessage('Filey could not retry this import.');
      } finally {
        setRetrying((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [api],
  );

  const revealInbox = useCallback((id: number) => run((): Promise<RevealResult> => api.inbox.revealInFinder(id), 'Filey could not show this file in Finder.'), [api, run]);
  const revealHistory = useCallback((id: number) => run((): Promise<RevealResult> => api.history.revealInFinder(id), 'Filey could not show this file in Finder.'), [api, run]);
  const trash = useCallback((id: number) => run(() => api.inbox.moveToTrash(id), 'Filey could not move this file to the Trash.'), [api, run]);
  const openInbox = useCallback(() => run(() => api.inbox.openFolder(), 'The inbox folder could not be opened.'), [api, run]);

  const openSettings = useCallback(() => void api.app.openSettings().catch(() => undefined), [api]);
  const quit = useCallback(() => void api.app.quit().catch(() => undefined), [api]);

  const isBusy = (row: InboxEntry) => row.working || retrying.has(row.id);

  /** The main action of an inbox row: retry a failed import, show the original of a duplicate, else show the file. */
  const primaryAction = (row: InboxEntry) => {
    if (row.status === 'failed') {
      if (!isBusy(row)) void retry(row.id);
    } else if (row.status === 'duplicate' && row.duplicateOf) {
      void revealHistory(row.duplicateOf.id);
    } else {
      void revealInbox(row.id);
    }
  };

  // Esc and the shortcuts work wherever the focus is inside the popover.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        api.popover.hide().catch(() => undefined);
        return;
      }
      if (!event.metaKey || event.altKey || event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (key === '1' || key === '2') {
        event.preventDefault();
        selectView(key === '1' ? 'inbox' : 'history');
      } else if (key === 'i') {
        event.preventDefault();
        void openInbox();
      } else if (key === ',') {
        event.preventDefault();
        openSettings();
      } else if (key === 'q') {
        event.preventDefault();
        quit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [api, openInbox, openSettings, quit, selectView]);

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (visibleHistory.length === 0) return;
      const next = event.key === 'ArrowDown' ? Math.min(visibleHistory.length - 1, historyIndex + 1) : Math.max(0, historyIndex - 1);
      setSelectedHistoryId(visibleHistory[next]?.id ?? null);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (selectedHistory) void revealHistory(selectedHistory.id);
    }
  };

  const onInboxKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey && event.key === 'Backspace') {
      event.preventDefault();
      if (selectedInbox) void trash(selectedInbox.id);
      return;
    }
    // Keys pressed on a button of the action strip belong to that button.
    if (event.target !== event.currentTarget) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = event.key === 'ArrowDown' ? Math.min(inboxList.length - 1, inboxIndex + 1) : Math.max(0, inboxIndex - 1);
      setSelectedInboxId(inboxList[next]?.id ?? null);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (selectedInbox) primaryAction(selectedInbox);
    }
  };

  const status = statusLine(state, inboxPath === null ? null : folderName(inboxPath));
  const inboxLabel = inboxPath === null ? 'your inbox folder' : folderName(inboxPath);
  const time = clock;
  // Keep the focus in the search field or the list when a row or button is clicked, as in a native menu.
  const keepFocus = { onMouseDown: (event: { preventDefault(): void }) => event.preventDefault() };

  const inboxActions = (row: InboxEntry, name: string): ReactNode => {
    const showInFinder = (
      <Button key="finder" size="small" aria-label={`Show ${name} in Finder`} {...keepFocus} onClick={() => void revealInbox(row.id)}>
        Show in Finder
      </Button>
    );
    const trashButton = (
      <Button key="trash" size="small" variant="danger" aria-label={`Move ${name} to Trash`} {...keepFocus} onClick={() => void trash(row.id)}>
        Move to Trash
      </Button>
    );
    if (row.status === 'failed') {
      return [
        <Button key="retry" size="small" variant="primary" disabled={isBusy(row)} aria-label={`Retry ${name}`} {...keepFocus} onClick={() => void retry(row.id)}>
          Retry ↩
        </Button>,
        showInFinder,
        trashButton,
      ];
    }
    if (row.status === 'duplicate') {
      const original = row.duplicateOf;
      return [
        <Button key="original" size="small" disabled={!original} aria-label={`Show original of ${name}`} {...keepFocus} onClick={() => original && void revealHistory(original.id)}>
          Show original
        </Button>,
        showInFinder,
        trashButton,
      ];
    }
    return showInFinder;
  };

  const inboxPanel =
    inboxRows === null ? null : inboxRows.length === 0 ? (
      <div className="popover__clear">
        <Icon name="check-circle" size={40} className="popover__clear-icon" />
        <p className="type-title">Inbox is clear</p>
        <p className="type-small popover__clear-text">New scans in {inboxLabel} are filed automatically. Filed documents are under History.</p>
      </div>
    ) : (
      <>
        <p className="type-small popover__caption">Files still in your inbox folder</p>
        <div
          className="popover__list"
          role="listbox"
          id={inboxListId}
          ref={inboxListRef}
          tabIndex={0}
          aria-label="Files in the inbox"
          aria-activedescendant={selectedInbox ? inboxOptionId(selectedInbox.id) : undefined}
          onKeyDown={onInboxKeyDown}
        >
          {inboxList.map((row) => {
            const props = inboxRowProps(row, state?.mode, retrying.has(row.id));
            return (
              <InboxRow
                key={row.id}
                id={inboxOptionId(row.id)}
                role="option"
                selected={row.id === selectedInbox?.id}
                {...props}
                {...keepFocus}
                onClick={() => setSelectedInboxId(row.id)}
                actions={inboxActions(row, row.fileName)}
              />
            );
          })}
        </div>
      </>
    );

  const historyPanel = (
    <>
      <div className="popover__search">
        <Input
          ref={searchRef}
          label="Search filed documents"
          hideLabel
          type="search"
          placeholder="Search filed documents"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedHistoryId(null);
          }}
          onKeyDown={onSearchKeyDown}
          role="combobox"
          aria-expanded={visibleHistory.length > 0}
          aria-controls={historyListId}
          aria-autocomplete="list"
          aria-activedescendant={selectedHistory ? historyOptionId(selectedHistory.id) : undefined}
        />
      </div>
      {historyRows !== null && visibleHistory.length === 0 ? (
        <p className="type-small popover__empty">{query.trim() ? `No documents match “${query.trim()}”.` : `Nothing filed yet. Scan a letter into ${inboxLabel}.`}</p>
      ) : (
        <div className="popover__list" role="listbox" id={historyListId} aria-label="Filed documents">
          {visibleHistory.map((row) => (
            <HistoryRow
              key={row.id}
              id={historyOptionId(row.id)}
              role="option"
              statusDisplay="dot"
              selected={row.id === selectedHistory?.id}
              {...historyRowProps(row, time)}
              {...keepFocus}
              onClick={() => {
                setSelectedHistoryId(row.id);
                void revealHistory(row.id);
              }}
            />
          ))}
        </div>
      )}
    </>
  );

  return (
    <div className="popover" ref={rootRef}>
      <header className="popover__header">
        <Icon name="scan" size={20} className="popover__mark" />
        <h1 className="popover__title">Filey</h1>
        {status && (
          <span className={cx('type-small', 'popover__status', `popover__status--${status.tone}`)} role="status">
            {status.text}
          </span>
        )}
      </header>

      {state?.mode === 'paused' && (
        <div className="popover__notice">
          <p className="type-small">{PAUSED_TEXT[state.reason]}</p>
          <Button variant="primary" onClick={() => void api.app.openSettings('provider').catch(() => undefined)}>
            Open Settings
          </Button>
        </div>
      )}

      <Tabs
        variant="segmented"
        label="View"
        className="popover__tabs"
        panelClassName="popover__panel"
        selectedId={view}
        onSelect={(id) => selectView(id as View)}
        items={[
          { id: 'inbox', label: 'Inbox', badge: { count: state?.attentionCount ?? 0, label: `${state?.attentionCount ?? 0} need attention` }, content: inboxPanel },
          { id: 'history', label: 'History', content: historyPanel },
        ]}
      />

      {message && (
        <p className="type-small popover__message" role="alert">
          {message}
        </p>
      )}

      <footer className="popover__footer">
        <MenuItem label="Open inbox folder" shortcut="⌘I" onClick={() => void openInbox()} />
        <MenuItem label="Settings…" shortcut="⌘," onClick={openSettings} />
        <MenuItem label="Quit Filey" shortcut="⌘Q" onClick={quit} />
      </footer>
    </div>
  );
}
