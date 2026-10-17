import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Tabs, type TabItem } from './Tabs';

const items: TabItem[] = [
  { id: 'general', label: 'General', icon: 'gear', content: <p>General panel</p> },
  { id: 'provider', label: 'Provider', icon: 'key', content: <p>Provider panel</p> },
  { id: 'filing', label: 'Filing', icon: 'folder', content: <p>Filing panel</p> },
];

describe('Tabs', () => {
  it('wires tablist, tabs and panel with ARIA', () => {
    render(<Tabs label="Settings" items={items} defaultSelectedId="provider" />);
    expect(screen.getByRole('tablist', { name: 'Settings' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
    const panel = screen.getByRole('tabpanel', { name: 'Provider' });
    expect(panel).toHaveTextContent('Provider panel');
    expect(tabs[1]).toHaveAttribute('aria-controls', panel.id);
  });

  it('moves focus and selection with arrow keys, Home and End (wrapping)', async () => {
    const user = userEvent.setup();
    render(<Tabs label="Settings" items={items} />);
    await user.tab();
    expect(screen.getByRole('tab', { name: 'General' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Provider' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Provider' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Provider panel');

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Filing' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'General' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Filing' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'General' })).toHaveFocus();
  });

  it('leaves the tab list with Tab and lands on the panel', async () => {
    const user = userEvent.setup();
    render(<Tabs label="Settings" items={items} />);
    await user.tab();
    await user.tab();
    expect(screen.getByRole('tabpanel')).toHaveFocus();
  });

  it('selects on click and reports the selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Tabs label="Settings" items={items} onSelect={onSelect} />);
    await user.click(screen.getByRole('tab', { name: 'Filing' }));
    expect(onSelect).toHaveBeenCalledWith('filing');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Filing panel');
  });

  it('can be controlled', async () => {
    const user = userEvent.setup();
    function Controlled() {
      const [id, setId] = useState('filing');
      return <Tabs label="Settings" items={items} selectedId={id} onSelect={setId} />;
    }
    render(<Controlled />);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Filing panel');
    await user.click(screen.getByRole('tab', { name: 'General' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('General panel');
  });

  describe('segmented', () => {
    const views: TabItem[] = [
      { id: 'inbox', label: 'Inbox', badge: { count: 3, label: '3 need attention' }, content: <p>Inbox panel</p> },
      { id: 'history', label: 'History', badge: { count: 0, label: 'none' }, content: <p>History panel</p> },
    ];

    it('shows a count badge with a spoken label, only when the count is above zero', () => {
      render(<Tabs variant="segmented" label="View" items={views} />);
      expect(screen.getByRole('tab', { name: 'Inbox (3 need attention)' })).toHaveTextContent('3');
      expect(screen.getByRole('tab', { name: 'History' })).toBeInTheDocument();
    });

    it('keeps the focus on a click and has no tab stop on the panel', async () => {
      const user = userEvent.setup();
      render(
        <>
          <input aria-label="Search" />
          <Tabs variant="segmented" label="View" items={views} />
        </>,
      );
      screen.getByRole('textbox').focus();
      await user.click(screen.getByRole('tab', { name: 'History' }));
      expect(screen.getByRole('textbox')).toHaveFocus();
      expect(screen.getByRole('tabpanel')).toHaveTextContent('History panel');
      expect(screen.getByRole('tabpanel')).not.toHaveAttribute('tabindex');
    });

    it('moves with Left and Right when the tab list has focus', async () => {
      const user = userEvent.setup();
      render(<Tabs variant="segmented" label="View" items={views} />);
      await user.tab();
      await user.keyboard('{ArrowRight}');
      expect(screen.getByRole('tab', { name: 'History' })).toHaveFocus();
      expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    });
  });
});
