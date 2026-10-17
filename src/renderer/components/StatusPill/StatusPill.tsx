import { cx } from '../cx';
import './StatusPill.css';

/** State of one import in the history (arc42 §6: filed, analyzing, waiting offline, failed, duplicate). */
export type ImportStatus = 'filed' | 'working' | 'waiting' | 'failed' | 'duplicate';

/** The words that always accompany a status colour: colour is never the only signal. */
export const STATUS_LABELS: Record<ImportStatus, string> = {
  filed: 'Filed',
  working: 'Working',
  waiting: 'Waiting',
  failed: 'Failed',
  duplicate: 'Duplicate',
};

export interface StatusProps {
  status: ImportStatus;
  /** Overrides the default label from `STATUS_LABELS`. */
  label?: string;
  className?: string;
}

/** Pill with a coloured dot and the state in words (full history, wide layouts). */
export function StatusPill({ status, label = STATUS_LABELS[status], className }: StatusProps) {
  return (
    <span className={cx('filey-status-pill', `filey-status--${status}`, className)} data-status={status}>
      {label}
    </span>
  );
}

/** Dot only, for narrow layouts such as the popover. The label stays available as text for screen readers and as a tooltip. */
export function StatusDot({ status, label = STATUS_LABELS[status], className }: StatusProps) {
  return (
    <span className={cx('filey-status-dot', `filey-status--${status}`, className)} data-status={status} title={label}>
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
