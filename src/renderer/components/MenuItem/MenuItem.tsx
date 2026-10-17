import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';
import './MenuItem.css';

export interface MenuItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Sentence case; an ellipsis marks items that open another step ("Settings…"). */
  label: string;
  /** macOS shortcut as shown, e.g. "⌘I", "⌘,", "⌘Q". */
  shortcut?: string;
  icon?: ReactNode;
}

const MODIFIERS: Record<string, string> = { '⌘': 'Meta', '⌥': 'Alt', '⇧': 'Shift', '⌃': 'Control' };

/** "⌘⇧I" -> "Meta+Shift+I", for `aria-keyshortcuts`. */
export function toAriaKeyShortcut(shortcut: string): string {
  const keys: string[] = [];
  for (const char of shortcut) keys.push(MODIFIERS[char] ?? char.toUpperCase());
  return keys.join('+');
}

/** A plain menu row with its shortcut in `text-muted` (popover footer): 32px, radius-md. */
export function MenuItem({ label, shortcut, icon, className, type = 'button', ...rest }: MenuItemProps) {
  return (
    <button
      type={type}
      className={cx('filey-menu-item', className)}
      aria-keyshortcuts={shortcut ? toAriaKeyShortcut(shortcut) : undefined}
      {...rest}
    >
      {icon}
      <span className="filey-menu-item__label">{label}</span>
      {shortcut && (
        <kbd className="filey-menu-item__shortcut" aria-hidden="true">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}
