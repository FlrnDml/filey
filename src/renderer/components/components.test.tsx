import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox, FileRow, Icon, ICON_NAMES, MenuItem, STATUS_LABELS, StatusPill, toAriaKeyShortcut, type ImportStatus } from '.';

describe('Icon', () => {
  it.each(ICON_NAMES)('draws %s in currentColor and hides it when decorative', (name) => {
    const { container } = render(<Icon name={name} size={16} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('width', '16');
    expect(svg).toHaveClass('filey-icon');
    expect(svg.childElementCount).toBeGreaterThan(0);
  });

  it('is an image with a name when labelled', () => {
    render(<Icon name="scan" label="Filey" />);
    expect(screen.getByRole('img', { name: 'Filey' })).toBeInTheDocument();
  });
});

describe('StatusPill', () => {
  it.each(Object.entries(STATUS_LABELS))('says %s as %s', (status, label) => {
    render(<StatusPill status={status as ImportStatus} />);
    expect(screen.getByText(label)).toHaveClass(`filey-status--${status}`);
  });
});

describe('FileRow', () => {
  it('shows the name and meta and marks selection', () => {
    const { container } = render(<FileRow name="Invoices" meta="12 items" icon="folder" selected />);
    expect(screen.getByText('Invoices')).toBeInTheDocument();
    expect(screen.getByText('12 items')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('filey-file-row--selected');
  });
});

describe('Checkbox', () => {
  it('toggles with the keyboard and links the hint', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox label="Start at login" hint="Filey starts when your Mac does." onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: 'Start at login' });
    expect(box).toHaveAccessibleDescription('Filey starts when your Mac does.');
    await user.tab();
    expect(box).toHaveFocus();
    await user.keyboard(' ');
    expect(box).toBeChecked();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('MenuItem', () => {
  it('is a button with its shortcut exposed as aria-keyshortcuts', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<MenuItem label="Settings…" shortcut="⌘," onClick={onClick} />);
    const item = screen.getByRole('button', { name: 'Settings…' });
    expect(item).toHaveAttribute('aria-keyshortcuts', 'Meta+,');
    await user.click(item);
    expect(onClick).toHaveBeenCalled();
  });

  it('converts macOS modifier glyphs', () => {
    expect(toAriaKeyShortcut('⌘⇧i')).toBe('Meta+Shift+I');
    expect(toAriaKeyShortcut('⌥⌃Q')).toBe('Alt+Control+Q');
  });
});
