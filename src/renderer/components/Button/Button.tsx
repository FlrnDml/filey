import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from '../cx';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` for the one main action per view, `danger` for destructive actions. Default `secondary`. */
  variant?: ButtonVariant;
  /** Optional leading icon, e.g. `<Icon name="folder" size={16} />`. */
  icon?: ReactNode;
  /** Stretch to the width of the container. */
  fullWidth?: boolean;
  /** `small` (28px) for inline actions inside a row, e.g. Retry in the popover. Default 36px. */
  size?: 'default' | 'small';
  /** Ref to the `<button>` element, e.g. to focus it. */
  ref?: Ref<HTMLButtonElement>;
  /** A verb in sentence case ("Test connection", "Choose…"). */
  children: ReactNode;
}

/** Button from docs/design-system/components/Button: 36px, radius-md, label type. */
export function Button({ variant = 'secondary', size = 'default', icon, fullWidth, className, type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('filey-button', `filey-button--${variant}`, size === 'small' && 'filey-button--small', fullWidth && 'filey-button--full', className)}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
