import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from '../Icon/Icon';
import './InboxRow.css';

/** What an inbox file is doing: failed, a duplicate, being analyzed, waiting for the connection, or new. */
export type InboxRowStatus = 'failed' | 'duplicate' | 'working' | 'waiting' | 'new';

/** The words that always accompany a status colour: colour is never the only signal. */
export const INBOX_STATUS_LABELS: Record<InboxRowStatus, string> = {
  failed: 'Failed',
  duplicate: 'Duplicate',
  working: 'Working',
  waiting: 'Waiting',
  new: 'New',
};

export interface InboxRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** The file name in the inbox, e.g. "Scan 2026-03-11 18.02.pdf". */
  name: string;
  status: InboxRowStatus;
  /** The second line: the error of a failed import, or "Duplicate of <name>". Other states have a default line. */
  detail?: string;
  /** Keyboard or pointer selection; uses `accent-subtle` and shows `actions` under the row. */
  selected?: boolean;
  /** Buttons for the selected row (28px, e.g. Retry, Show in Finder), indented to the text. */
  actions?: ReactNode;
}

function secondLine(status: InboxRowStatus, detail?: string): string {
  if (detail) return detail;
  switch (status) {
    case 'failed':
      return 'Import failed';
    case 'duplicate':
      return 'Duplicate of a filed document';
    case 'working':
      return 'Analyzing…';
    case 'waiting':
      return 'Waiting for the connection';
    case 'new':
      return 'New · waiting to be filed';
  }
}

/**
 * One file in the inbox (docs/design-system/components/InboxRow): 48px, document icon, file name, a second line
 * and a status pill. The selected row expands an action strip. Extra props (id, role, handlers) go to the row.
 */
export function InboxRow({ name, status, detail, selected = false, actions, className, ...rest }: InboxRowProps) {
  return (
    <div className={cx('filey-inbox-row', selected && 'filey-inbox-row--selected', className)} role="presentation">
      <div className="filey-inbox-row__main" aria-selected={rest.role === 'option' ? selected : undefined} {...rest}>
        <Icon name="doc" size={20} className="filey-inbox-row__icon" />
        <div className="filey-inbox-row__text">
          <div className="filey-inbox-row__name" title={name}>
            {name}
          </div>
          <div className={cx('filey-inbox-row__detail', `filey-inbox-row__detail--${status}`)}>{secondLine(status, detail)}</div>
        </div>
        <span className={cx('filey-inbox-row__pill', `filey-inbox-row__pill--${status}`)} data-status={status}>
          {INBOX_STATUS_LABELS[status]}
        </span>
      </div>
      {selected && actions && (
        <div className="filey-inbox-row__actions" role="group" aria-label={`Actions for ${name}`}>
          {actions}
        </div>
      )}
    </div>
  );
}
