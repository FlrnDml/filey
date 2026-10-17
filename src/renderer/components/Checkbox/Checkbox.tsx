import { useId, type InputHTMLAttributes } from 'react';
import { cx } from '../cx';
import './Checkbox.css';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Visible label next to the box, e.g. "Start at login". */
  label: string;
  /** Help text below the label in `text-muted`. */
  hint?: string;
}

/**
 * Checkbox for boolean settings. A native input, so Space toggles it and screen readers announce the state;
 * outline `border-control`, `radius-sm`, checked uses `accent` with an `on-accent` check.
 */
export function Checkbox({ label, hint, id, className, 'aria-describedby': describedBy, ...rest }: CheckboxProps) {
  const autoId = useId();
  const inputId = id ?? `${autoId}-checkbox`;
  const hintId = `${inputId}-hint`;
  return (
    <div className={cx('filey-checkbox', className)}>
      <input
        id={inputId}
        type="checkbox"
        className="filey-checkbox__input"
        aria-describedby={cx(describedBy, hint && hintId) || undefined}
        {...rest}
      />
      <div className="filey-checkbox__text">
        <label htmlFor={inputId} className="filey-checkbox__label">
          {label}
        </label>
        {hint && (
          <div id={hintId} className="filey-checkbox__hint">
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}
