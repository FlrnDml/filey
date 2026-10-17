import { useId, type InputHTMLAttributes, type Ref } from 'react';
import { cx } from '../cx';
import './Input.css';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /** Visible label above the field (sentence case). */
  label: string;
  /** Keep the label for screen readers only, e.g. for the popover search field. */
  hideLabel?: boolean;
  /** Adds a muted "(optional)" after the label. */
  optional?: boolean;
  /** Help text below the field. Replaced by `error` when that is set. */
  hint?: string;
  /** Says what is wrong, in words; shown in `danger` instead of the hint and marks the field invalid. */
  error?: string;
  /** `mono` for paths, templates and API keys. */
  variant?: 'default' | 'mono';
  /** `password` masks the value (API keys). */
  type?: 'text' | 'password' | 'search' | 'url';
  /** Ref to the `<input>` element, e.g. to focus it. */
  ref?: Ref<HTMLInputElement>;
}

/** Input from docs/design-system/components/Input: label above, hint or error below. */
export function Input({
  label,
  hideLabel,
  optional,
  hint,
  error,
  variant = 'default',
  type = 'text',
  id,
  className,
  'aria-describedby': describedBy,
  ...rest
}: InputProps) {
  const autoId = useId();
  const inputId = id ?? `${autoId}-input`;
  const messageId = `${inputId}-message`;
  const message = error ?? hint;
  const describedByIds = cx(describedBy, message && messageId) || undefined;

  return (
    <div className={cx('filey-field', className)}>
      <label htmlFor={inputId} className={cx('filey-field__label', hideLabel && 'visually-hidden')}>
        {label}
        {optional && <span className="filey-field__optional"> (optional)</span>}
      </label>
      <input
        id={inputId}
        type={type}
        className={cx('filey-input', variant === 'mono' && 'filey-input--mono', error && 'filey-input--invalid')}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedByIds}
        spellCheck={variant === 'mono' ? false : undefined}
        autoCapitalize={variant === 'mono' ? 'off' : undefined}
        autoCorrect={variant === 'mono' ? 'off' : undefined}
        {...rest}
      />
      {message && (
        <div id={messageId} className={cx('filey-field__message', error && 'filey-field__message--error')}>
          {message}
        </div>
      )}
    </div>
  );
}
