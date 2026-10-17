import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from '../Icon/Icon';
import { StatusDot, StatusPill } from '../StatusPill/StatusPill';
import './HistoryRow.css';

export interface HistoryRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** The filed name, e.g. "2026-03-12_Northwind_Invoice.pdf". */
  name: string;
  /** Destination folder, e.g. "Health/Health insurance". */
  folder?: string;
  /** Relative time, e.g. "2 min ago", "Yesterday". */
  time?: string;
  /** Replaces the generated second line. */
  detail?: string;
  /** Keyboard or pointer selection; uses `accent-subtle`. */
  selected?: boolean;
  /** `pill` in wide layouts, `dot` at popover width. Both keep the state as text. */
  statusDisplay?: 'pill' | 'dot';
  /** A small inline action before the status. */
  action?: ReactNode;
}

/** One filed document in the history (docs/design-system/components/HistoryRow): 48px, document icon, name, folder · time. */
export function HistoryRow({ name, folder, time, detail, selected = false, statusDisplay = 'pill', action, className, ...rest }: HistoryRowProps) {
  const line = detail ?? [folder, time].filter(Boolean).join(' · ');
  return (
    <div
      className={cx('filey-history-row', selected && 'filey-history-row--selected', className)}
      aria-selected={rest.role === 'option' ? selected : undefined}
      {...rest}
    >
      <Icon name="doc" size={20} className="filey-history-row__icon" />
      <div className="filey-history-row__text">
        <div className="filey-history-row__name" title={name}>
          {name}
        </div>
        {line && <div className="filey-history-row__detail">{line}</div>}
      </div>
      {action}
      {statusDisplay === 'pill' ? <StatusPill status="filed" /> : <StatusDot status="filed" />}
    </div>
  );
}
