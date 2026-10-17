import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../cx';
import { Icon, type IconName } from '../Icon/Icon';
import './Tabs.css';

export interface TabItem {
  id: string;
  /** Sentence case: "General", "Provider", "Filing". */
  label: string;
  icon?: IconName;
  /** A count badge after the label (segmented variant), shown when `count` > 0. `label` says what it counts, for screen readers. */
  badge?: { count: number; label: string };
  /** Panel content, rendered only while the tab is selected. */
  content: ReactNode;
}

export interface TabsProps {
  /** Accessible name of the tab list, e.g. "Settings". */
  label: string;
  items: TabItem[];
  /** Controlled selection. Leave out and use `defaultSelectedId` for uncontrolled tabs. */
  selectedId?: string;
  defaultSelectedId?: string;
  onSelect?: (id: string) => void;
  /** `toolbar` (default) for the Settings window, `segmented` for a full-width switch between views (popover). */
  variant?: 'toolbar' | 'segmented';
  className?: string;
  /** Class for the panel, e.g. to add the window body padding. */
  panelClassName?: string;
}

/**
 * Toolbar-style tabs as in the Settings previews: the selected tab uses `accent-subtle` and `accent`.
 * The `segmented` variant is a full-width control (MenuBarPopover): equal segments on a `surface` track, the
 * selected one raised in `bg`. Its tabs keep the focus where it is on a click (like a native menu) and its
 * panel is not a tab stop, because its content brings its own focus target.
 * Follows the WAI-ARIA tabs pattern with roving tabindex: Tab enters the list on the selected tab,
 * Left/Right (wrapping), Home and End move and select.
 */
export function Tabs({ label, items, selectedId, defaultSelectedId, onSelect, variant = 'toolbar', className, panelClassName }: TabsProps) {
  const baseId = useId();
  const [internalId, setInternalId] = useState(defaultSelectedId ?? items[0]?.id);
  const currentId = selectedId ?? internalId;
  const current = items.find((item) => item.id === currentId) ?? items[0];
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  const select = (id: string) => {
    if (selectedId === undefined) setInternalId(id);
    onSelect?.(id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!current) return;
    const index = items.indexOf(current);
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (index + 1) % items.length;
        break;
      case 'ArrowLeft':
        next = (index - 1 + items.length) % items.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = items[next];
    if (!target) return;
    select(target.id);
    tabRefs.current.get(target.id)?.focus();
  };

  const tabId = (id: string) => `${baseId}-tab-${id}`;
  const panelId = (id: string) => `${baseId}-panel-${id}`;
  const segmented = variant === 'segmented';

  return (
    <div className={cx('filey-tabs', segmented && 'filey-tabs--segmented', className)}>
      <div role="tablist" aria-label={label} className="filey-tabs__list" onKeyDown={onKeyDown}>
        {items.map((item) => {
          const isSelected = item.id === current?.id;
          return (
            <button
              key={item.id}
              ref={(node) => {
                if (node) tabRefs.current.set(item.id, node);
                else tabRefs.current.delete(item.id);
              }}
              type="button"
              role="tab"
              id={tabId(item.id)}
              aria-selected={isSelected}
              aria-controls={panelId(item.id)}
              tabIndex={isSelected ? 0 : -1}
              className={cx('filey-tabs__tab', isSelected && 'filey-tabs__tab--selected')}
              onMouseDown={segmented ? (event) => event.preventDefault() : undefined}
              onClick={() => select(item.id)}
            >
              {item.icon && <Icon name={item.icon} size={16} />}
              {item.label}
              {item.badge && item.badge.count > 0 && (
                <>
                  <span className="filey-tabs__badge" aria-hidden="true">
                    {item.badge.count}
                  </span>
                  {' '}
                  <span className="visually-hidden">({item.badge.label})</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      {current && (
        <div
          role="tabpanel"
          id={panelId(current.id)}
          aria-labelledby={tabId(current.id)}
          tabIndex={segmented ? undefined : 0}
          className={cx('filey-tabs__panel', panelClassName)}
        >
          {current.content}
        </div>
      )}
    </div>
  );
}
