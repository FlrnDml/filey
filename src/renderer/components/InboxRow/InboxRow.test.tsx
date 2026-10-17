import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InboxRow, INBOX_STATUS_LABELS, type InboxRowStatus } from './InboxRow';

describe('InboxRow', () => {
  it.each([
    ['failed', 'Failed', 'Import failed'],
    ['duplicate', 'Duplicate', 'Duplicate of a filed document'],
    ['working', 'Working', 'Analyzing…'],
    ['waiting', 'Waiting', 'Waiting for the connection'],
    ['new', 'New', 'New · waiting to be filed'],
  ] as const)('says %s in words with a default line', (status, label, line) => {
    render(<InboxRow name="Scan.pdf" status={status} />);
    expect(screen.getByText(label)).toHaveAttribute('data-status', status);
    expect(screen.getByText(line)).toHaveClass(`filey-inbox-row__detail--${status}`);
  });

  it('has a label for every status', () => {
    const statuses: InboxRowStatus[] = ['failed', 'duplicate', 'working', 'waiting', 'new'];
    expect(Object.keys(INBOX_STATUS_LABELS).sort()).toEqual([...statuses].sort());
  });

  it('shows the given second line instead of the default', () => {
    render(<InboxRow name="Scan.pdf" status="failed" detail="OpenRouter unreachable" />);
    expect(screen.getByText('OpenRouter unreachable')).toHaveClass('filey-inbox-row__detail--failed');
  });

  it('shows the actions only while selected', () => {
    const actions = <button type="button">Show in Finder</button>;
    const { rerender } = render(<InboxRow name="Scan.pdf" status="new" actions={actions} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<InboxRow name="Scan.pdf" status="new" actions={actions} selected />);
    expect(screen.getByRole('group', { name: 'Actions for Scan.pdf' })).toContainElement(screen.getByRole('button', { name: 'Show in Finder' }));
  });

  it('reflects selection in aria-selected when used as an option', () => {
    render(<InboxRow name="a.pdf" status="new" role="option" selected />);
    expect(screen.getByRole('option', { name: /a\.pdf/ })).toHaveAttribute('aria-selected', 'true');
  });
});
