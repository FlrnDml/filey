import { Icon } from '../../components';
import { cx } from '../../components/cx';

/** The outcome of one settings action, shown next to the control it is about. */
export interface FeedbackValue {
  kind: 'success' | 'error' | 'warning' | 'info' | 'progress';
  text: string;
}

export const saved = (text = 'Saved.'): FeedbackValue => ({ kind: 'success', text });
export const failed = (text: string): FeedbackValue => ({ kind: 'error', text });

export interface FeedbackProps {
  value: FeedbackValue | null;
  id?: string;
  className?: string;
}

/**
 * A short line in words, coloured by its kind (never colour alone: success also gets a check).
 * Always rendered (a polite live region), so screen readers announce when its text changes.
 */
export function Feedback({ value, id, className }: FeedbackProps) {
  return (
    <p
      id={id}
      role="status"
      className={cx('type-small', 'settings-feedback', value && `settings-feedback--${value.kind}`, className)}
    >
      {value?.kind === 'success' && <Icon name="check" size={16} />}
      {value?.text}
    </p>
  );
}
