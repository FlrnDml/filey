import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HistoryRow } from './HistoryRow';

describe('HistoryRow', () => {
  it('shows name, folder · time and the status in words', () => {
    render(<HistoryRow name="2026-03-12_Northwind_Invoice.pdf" folder="Health/Health insurance" time="2 min ago" />);
    expect(screen.getByText('2026-03-12_Northwind_Invoice.pdf')).toBeInTheDocument();
    expect(screen.getByText('Health/Health insurance · 2 min ago')).toBeInTheDocument();
    expect(screen.getByText('Filed')).toHaveClass('filey-status-pill');
  });

  it('shows only what it is given on the second line', () => {
    render(<HistoryRow name="a.pdf" time="Yesterday" />);
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
  });

  it('keeps the status label for screen readers in dot mode', () => {
    render(<HistoryRow name="a.pdf" folder="Taxes" time="Feb 27" statusDisplay="dot" />);
    const label = screen.getByText('Filed');
    expect(label).toHaveClass('visually-hidden');
    expect(label.parentElement).toHaveAttribute('title', 'Filed');
  });

  it('reflects selection in aria-selected when used as an option', () => {
    render(<HistoryRow name="a.pdf" role="option" selected />);
    expect(screen.getByRole('option', { name: /a\.pdf/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('renders an inline action before the status', () => {
    render(<HistoryRow name="Scan.pdf" action={<button type="button">Open</button>} statusDisplay="dot" />);
    const action = screen.getByRole('button', { name: 'Open' });
    expect(action.nextElementSibling).toHaveClass('filey-status-dot');
  });
});
