import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AppState, InboxRow } from '../../../core/ipc';
import { FIXTURE_HISTORY, FIXTURE_INBOX, FIXTURE_NOW } from '../../test/fixtures';
import { createMockFiley, type MockFileyOptions } from '../../test/mockFiley';
import { Popover } from './Popover';

const DEFAULTS: MockFileyOptions = { inbox: FIXTURE_INBOX, history: FIXTURE_HISTORY };

const appState = (state: Partial<AppState> & Pick<AppState, 'mode'>): AppState =>
  ({ queuedCount: 0, analyzingId: null, attentionCount: 0, ...state }) as AppState;

/** Renders the popover and waits until it has loaded and shows `view`. */
async function setup(options: MockFileyOptions = DEFAULTS, view: 'Inbox' | 'History' = 'Inbox') {
  const mock = createMockFiley(options);
  const { api } = mock;
  const spies = {
    retry: vi.spyOn(api.inbox, 'retry'),
    trash: vi.spyOn(api.inbox, 'moveToTrash'),
    revealInbox: vi.spyOn(api.inbox, 'revealInFinder'),
    openFolder: vi.spyOn(api.inbox, 'openFolder'),
    revealHistory: vi.spyOn(api.history, 'revealInFinder'),
    openSettings: vi.spyOn(api.app, 'openSettings'),
    quit: vi.spyOn(api.app, 'quit'),
    hide: vi.spyOn(api.popover, 'hide'),
  };
  const user = userEvent.setup();
  render(<Popover api={api} now={() => FIXTURE_NOW} />);
  await waitFor(() => {
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(tab(view)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).not.toBeEmptyDOMElement();
    expect(screen.queryAllByRole('option')).toHaveLength(view === 'Inbox' ? (options.inbox?.length ?? 0) : (options.history?.length ?? 0));
  });
  return { ...mock, spies, user };
}

const tab = (name: 'Inbox' | 'History') => screen.getByRole('tab', { name: new RegExp(`^${name}`) });
const options = () => screen.getAllByRole('option');
const selectedOption = () => options().find((o) => o.getAttribute('aria-selected') === 'true');
const inboxList = () => screen.getByRole('listbox', { name: 'Files in the inbox' });

describe('Popover', () => {
  it('shows the header, the segmented control with the attention count, the inbox and the footer', async () => {
    await setup();
    expect(screen.getByRole('heading', { name: 'Filey' })).toBeInTheDocument();
    expect(screen.getByText('Watching Documents')).toHaveClass('popover__status--success');
    expect(screen.getByRole('tablist', { name: 'View' })).toBeInTheDocument();
    expect(tab('Inbox')).toHaveAccessibleName('Inbox (2 need attention)');
    expect(tab('History')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('Files still in your inbox folder')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

    expect(options()).toHaveLength(3);
    const [failed, pending, duplicate] = options() as [HTMLElement, HTMLElement, HTMLElement];
    expect(within(failed).getByText('Scan 2026-03-11 18.02.pdf')).toBeInTheDocument();
    expect(within(failed).getByText('OpenRouter unreachable')).toHaveClass('filey-inbox-row__detail--failed');
    expect(within(failed).getByText('Failed')).toBeInTheDocument();
    expect(within(pending).getByText('New · waiting to be filed')).toBeInTheDocument();
    expect(within(pending).getByText('New')).toBeInTheDocument();
    expect(within(duplicate).getByText('Duplicate of 2026-02-27_Revenue_Assessment.pdf')).toBeInTheDocument();
    expect(within(duplicate).getByText('Duplicate')).toBeInTheDocument();
    for (const name of ['Open inbox folder', 'Settings…', 'Quit Filey']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
  });

  it('starts with the list focused and the first file selected, with its actions', async () => {
    await setup();
    expect(inboxList()).toHaveFocus();
    expect(selectedOption()).toBe(options()[0]);
    expect(inboxList()).toHaveAttribute('aria-activedescendant', options()[0]!.id);
    const actions = screen.getByRole('group', { name: 'Actions for Scan 2026-03-11 18.02.pdf' });
    expect(within(actions).getAllByRole('button').map((b) => b.textContent)).toEqual(['Retry ↩', 'Show in Finder', 'Move to Trash']);
  });

  it('moves the selection with Up and Down; each status has its own actions', async () => {
    const { user, spies } = await setup();
    await user.keyboard('{ArrowDown}');
    expect(selectedOption()).toBe(options()[1]);
    expect(screen.getAllByRole('button', { name: /Show .* in Finder/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Move .* to Trash/ })).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(spies.revealInbox).toHaveBeenCalledExactlyOnceWith(11);

    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(selectedOption()).toBe(options()[2]);
    const group = screen.getByRole('group', { name: /Actions for/ });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Show original', 'Show in Finder', 'Move to Trash']);
    await user.keyboard('{Enter}');
    expect(spies.revealHistory).toHaveBeenCalledExactlyOnceWith(1);

    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(selectedOption()).toBe(options()[0]);
  });

  it('retries a failed import with Return or its button and shows it as working meanwhile', async () => {
    const { user, spies } = await setup();
    let finish: (value: 'started') => void = () => undefined;
    spies.retry.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));

    await user.keyboard('{Enter}');
    expect(spies.retry).toHaveBeenCalledExactlyOnceWith(12);
    expect(within(options()[0]!).getByText('Analyzing…')).toBeInTheDocument();
    expect(within(options()[0]!).getByText('Working')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry Scan 2026-03-11 18.02.pdf' })).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(spies.retry).toHaveBeenCalledOnce();
    await act(async () => finish('started'));
    expect(within(options()[0]!).getByText('OpenRouter unreachable')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry Scan 2026-03-11 18.02.pdf' }));
    expect(spies.retry).toHaveBeenCalledTimes(2);
  });

  it('moves a file to the Trash with the button or Command-Backspace', async () => {
    const { user, spies } = await setup();
    await user.click(screen.getByRole('button', { name: 'Move Scan 2026-03-11 18.02.pdf to Trash' }));
    expect(spies.trash).toHaveBeenCalledExactlyOnceWith(12);
    await user.keyboard('{ArrowDown}{Meta>}{Backspace}{/Meta}');
    expect(spies.trash).toHaveBeenLastCalledWith(11);
  });

  it('shows a duplicate without a known original and cannot show it', async () => {
    const duplicate: InboxRow = { ...FIXTURE_INBOX[2]!, duplicateOf: null };
    const { spies, user } = await setup({ inbox: [duplicate], history: [] });
    expect(within(options()[0]!).getByText('Duplicate of a filed document')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show original/ })).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(spies.revealHistory).not.toHaveBeenCalled();
    expect(spies.revealInbox).toHaveBeenCalledExactlyOnceWith(10);
  });

  it('selects a row on click without acting', async () => {
    const { user, spies } = await setup();
    await user.click(screen.getByText('Scan 2026-03-02 07.10.pdf'));
    expect(selectedOption()).toBe(options()[2]);
    expect(spies.revealInbox).not.toHaveBeenCalled();
    expect(spies.revealHistory).not.toHaveBeenCalled();
  });

  it('says why a retry, reveal or trash did not work', async () => {
    const { user, spies } = await setup();
    spies.retry.mockResolvedValueOnce('file-missing');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('The file is no longer in the inbox');

    spies.revealInbox.mockResolvedValueOnce({ ok: false, reason: 'file-missing', message: 'The file is no longer there.' });
    await user.click(screen.getByRole('button', { name: 'Show Scan 2026-03-11 18.02.pdf in Finder' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The file is no longer there.'));

    spies.trash.mockRejectedValueOnce(new Error('refused'));
    await user.keyboard('{Meta>}{Backspace}{/Meta}');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Filey could not move this file to the Trash.'));
  });

  it('shows the clear inbox with the inbox name and starts in History', async () => {
    const { user } = await setup({ inbox: [], history: FIXTURE_HISTORY }, 'History');
    await user.click(tab('Inbox'));
    expect(screen.getByText('Inbox is clear')).toBeInTheDocument();
    expect(screen.getByText('New scans in Documents are filed automatically. Filed documents are under History.')).toBeInTheDocument();
    expect(tab('Inbox')).toHaveAccessibleName('Inbox');
  });

  it('shows pending files as waiting while offline', async () => {
    await setup({ ...DEFAULTS, state: appState({ mode: 'offline', queuedCount: 1, attentionCount: 2 }) });
    expect(screen.getByText('Offline · 1 waiting')).toHaveClass('popover__status--warning');
    expect(within(options()[1]!).getByText('Waiting for the connection')).toBeInTheDocument();
    expect(within(options()[1]!).getByText('Waiting')).toBeInTheDocument();
  });

  it('shows the paused state with a button to Settings', async () => {
    const { user, spies } = await setup({ ...DEFAULTS, state: appState({ mode: 'paused', reason: 'missing' }) });
    expect(screen.getByText('Paused · API key missing')).toHaveClass('popover__status--warning');
    expect(screen.getByText('Filey needs your OpenRouter API key before it can file new scans.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(spies.openSettings).toHaveBeenCalledExactlyOnceWith('provider');
  });

  it('follows the live analyzing id, not the working flag the row was sent with', async () => {
    const { emit } = await setup();
    const failed = FIXTURE_INBOX[0]!;
    const row = () => options().find((o) => within(o).queryByText(failed.fileName))!;
    act(() => {
      // Written as failed while the analysis was still marked as running (e.g. a timeout).
      emit('inbox:changed', { kind: 'upsert', row: { ...failed, working: true } });
      emit('state:changed', appState({ mode: 'running', analyzingId: failed.id }));
    });
    expect(within(row()).getByText('Working')).toBeInTheDocument();

    // The analysis ends; only the state is sent again.
    act(() => emit('state:changed', appState({ mode: 'running', analyzingId: null })));
    expect(within(row()).getByText('Failed')).toBeInTheDocument();
    expect(within(row()).queryByText('Working')).not.toBeInTheDocument();

    // A pending row that starts being analyzed shows as working without being sent again.
    const pending = FIXTURE_INBOX[1]!;
    act(() => emit('state:changed', appState({ mode: 'running', analyzingId: pending.id })));
    expect(within(options().find((o) => within(o).queryByText(pending.fileName))!).getByText('Working')).toBeInTheDocument();
  });

  it('updates live from inbox, history, state and settings events', async () => {
    const { emit } = await setup();
    const fresh: InboxRow = { ...FIXTURE_INBOX[1]!, id: 13, fileName: 'Scan 2026-03-12 10.44.pdf', createdAt: FIXTURE_NOW.toISOString(), updatedAt: FIXTURE_NOW.toISOString() };
    act(() => {
      emit('inbox:changed', { kind: 'upsert', row: fresh });
      emit('inbox:changed', { kind: 'upsert', row: { ...FIXTURE_INBOX[1]!, working: true, updatedAt: FIXTURE_NOW.toISOString() } });
      emit('inbox:changed', { kind: 'remove', id: 10 });
      emit('state:changed', appState({ mode: 'offline', queuedCount: 2, analyzingId: FIXTURE_INBOX[1]!.id, attentionCount: 1 }));
    });
    expect(options()).toHaveLength(3);
    expect(within(options()[0]!).getByText('Scan 2026-03-12 10.44.pdf')).toBeInTheDocument();
    expect(within(options()[0]!).getByText('Waiting')).toBeInTheDocument();
    expect(within(options()[2]!).getByText('Working')).toBeInTheDocument();
    expect(tab('Inbox')).toHaveAccessibleName('Inbox (1 need attention)');
    expect(screen.getByText('Offline · 2 waiting')).toBeInTheDocument();

    act(() => {
      emit('state:changed', appState({ mode: 'running' }));
      emit('settings:changed', { ...settingsFixture(), inboxPath: '/Users/me/Scans' });
    });
    expect(screen.getByText('Watching Scans')).toBeInTheDocument();
    expect(tab('Inbox')).toHaveAccessibleName('Inbox');
  });

  describe('History', () => {
    it('shows the filed documents with folder and time, and the search field', async () => {
      const { user } = await setup();
      await user.click(tab('History'));
      const search = screen.getByRole('combobox', { name: 'Search filed documents' });
      expect(search).toHaveFocus();
      expect(options()).toHaveLength(FIXTURE_HISTORY.length);
      expect(within(options()[0]!).getByText('2026-03-12_Northwind_Invoice.pdf')).toBeInTheDocument();
      expect(within(options()[0]!).getByText('Health/Health insurance · 2 min ago')).toBeInTheDocument();
      expect(within(options()[0]!).getByText('Filed')).toBeInTheDocument();
      expect(selectedOption()).toBe(options()[0]);
      expect(search).toHaveAttribute('aria-activedescendant', options()[0]!.id);
    });

    it('filters as you type, moves with Up and Down and reveals with Return or a click', async () => {
      const { user, spies } = await setup(DEFAULTS, 'Inbox');
      await user.keyboard('{Meta>}2{/Meta}');
      await user.type(screen.getByRole('combobox'), 'taxes');
      expect(options()).toHaveLength(1);
      await user.keyboard('{Enter}');
      expect(spies.revealHistory).toHaveBeenLastCalledWith(1);

      await user.clear(screen.getByRole('combobox'));
      await user.type(screen.getByRole('combobox'), 'nothing like this');
      expect(screen.queryByRole('option')).not.toBeInTheDocument();
      expect(screen.getByText('No documents match “nothing like this”.')).toBeInTheDocument();

      await user.clear(screen.getByRole('combobox'));
      await user.keyboard('{ArrowDown}{ArrowDown}');
      expect(selectedOption()).toBe(options()[2]);
      await user.keyboard('{ArrowUp}{Enter}');
      expect(spies.revealHistory).toHaveBeenLastCalledWith(3);

      await user.click(screen.getByText('2026-03-02_Stadtwerke_Jahresabrechnung.pdf'));
      expect(spies.revealHistory).toHaveBeenLastCalledWith(2);
      expect(selectedOption()).toBe(options()[2]);
    });

    it('shows the empty state with the inbox name and updates live', async () => {
      const { emit } = await setup({}, 'History');
      expect(await screen.findByText('Nothing filed yet. Scan a letter into Documents.')).toBeInTheDocument();
      act(() => emit('history:changed', { kind: 'upsert', row: FIXTURE_HISTORY[0]! }));
      expect(options()).toHaveLength(1);
      act(() => emit('history:changed', { kind: 'remove', id: FIXTURE_HISTORY[0]!.id }));
      expect(screen.queryByRole('option')).not.toBeInTheDocument();
    });
  });

  describe('views', () => {
    it('switches with the tabs, the arrow keys on the tab list and Command-1 and Command-2', async () => {
      const { user } = await setup();
      await user.click(tab('History'));
      expect(tab('History')).toHaveAttribute('aria-selected', 'true');
      await user.keyboard('{Meta>}1{/Meta}');
      expect(tab('Inbox')).toHaveAttribute('aria-selected', 'true');
      expect(inboxList()).toHaveFocus();
      await user.keyboard('{Meta>}2{/Meta}');
      expect(screen.getByRole('combobox')).toHaveFocus();

      tab('History').focus();
      await user.keyboard('{ArrowLeft}');
      expect(tab('Inbox')).toHaveAttribute('aria-selected', 'true');
      expect(tab('Inbox')).toHaveFocus();
    });

    it('keeps a picked tab while open and chooses the default again when the window gains focus', async () => {
      const { user, emit } = await setup();
      await user.click(tab('History'));
      act(() => emit('inbox:changed', { kind: 'upsert', row: { ...FIXTURE_INBOX[0]!, updatedAt: FIXTURE_NOW.toISOString() } }));
      expect(tab('History')).toHaveAttribute('aria-selected', 'true');

      act(() => window.dispatchEvent(new Event('focus')));
      expect(tab('Inbox')).toHaveAttribute('aria-selected', 'true');
      expect(inboxList()).toHaveFocus();

      for (const row of FIXTURE_INBOX) act(() => emit('inbox:changed', { kind: 'remove', id: row.id }));
      act(() => window.dispatchEvent(new Event('focus')));
      expect(tab('History')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('combobox')).toHaveFocus();
    });
  });

  it('runs the footer actions by click and shortcut, and hides on Esc', async () => {
    const { user, spies } = await setup();
    await user.click(screen.getByRole('button', { name: 'Open inbox folder' }));
    await user.click(screen.getByRole('button', { name: 'Settings…' }));
    await user.click(screen.getByRole('button', { name: 'Quit Filey' }));
    await user.keyboard('{Meta>}i{/Meta}{Meta>},{/Meta}{Meta>}q{/Meta}');
    expect(spies.openFolder).toHaveBeenCalledTimes(2);
    expect(spies.openSettings).toHaveBeenCalledTimes(2);
    expect(spies.openSettings).toHaveBeenCalledWith();
    expect(spies.quit).toHaveBeenCalledTimes(2);

    await user.keyboard('{Escape}');
    expect(spies.hide).toHaveBeenCalledOnce();
  });

  it('refocuses the list when the window gains focus again', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Settings…' }));
    inboxList().blur();
    act(() => window.dispatchEvent(new Event('focus')));
    expect(inboxList()).toHaveFocus();
  });
});

function settingsFixture() {
  return {
    provider: 'openrouter' as const,
    model: 'm',
    inboxPath: '/x',
    targetPath: '/y',
    namingTemplate: '{title}.pdf',
    autostart: false,
    debugLogging: false,
    onboardingCompleted: true,
  };
}
