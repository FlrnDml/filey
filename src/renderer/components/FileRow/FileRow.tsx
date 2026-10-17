import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';
import { Icon, type IconName } from '../Icon/Icon';
import './FileRow.css';

export interface FileRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** File or folder name. Truncates with an ellipsis, never wraps. */
  name: string;
  /** Size, item count or date in `text-muted`, e.g. "1.2 MB". */
  meta?: string;
  /** An icon name, or any element drawn in currentColor. Default `doc`. */
  icon?: IconName | ReactNode;
  /** Selected rows use `accent-subtle` with an `accent` icon. */
  selected?: boolean;
}

/** One file or folder in a list (docs/design-system/components/FileRow): 40px, icon, name, meta. */
export function FileRow({ name, meta, icon = 'doc', selected = false, className, ...rest }: FileRowProps) {
  return (
    <div
      className={cx('filey-file-row', selected && 'filey-file-row--selected', className)}
      aria-selected={rest.role === 'option' ? selected : undefined}
      {...rest}
    >
      <span className="filey-file-row__icon">{typeof icon === 'string' ? <Icon name={icon as IconName} size={20} /> : icon}</span>
      <span className="filey-file-row__name" title={name}>
        {name}
      </span>
      {meta && <span className="filey-file-row__meta">{meta}</span>}
    </div>
  );
}
