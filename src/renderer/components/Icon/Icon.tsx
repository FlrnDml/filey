import type { SVGProps } from 'react';
import { cx } from '../cx';
import './Icon.css';

/**
 * The outline glyphs used by the design-system previews (docs/design-system/components/*).
 * Drawn on a 20px grid (`check` on 16px) in currentColor with a 1.5 stroke and round caps.
 */
const GLYPHS = {
  scan: {
    viewBox: '0 0 20 20',
    body: <path d="M2.5 11.5h15v4a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5z M4.5 11.5 6 4.5h8l1.5 7 M14.5 14.2h.01" />,
  },
  doc: { viewBox: '0 0 20 20', body: <path d="M5 2.5h6l4 4v11H5z M11 2.5v4h4" /> },
  gear: {
    viewBox: '0 0 20 20',
    body: (
      <>
        <circle cx="10" cy="10" r="2.5" />
        <path d="M10 2.5v2 M10 15.5v2 M2.5 10h2 M15.5 10h2 M4.7 4.7l1.4 1.4 M13.9 13.9l1.4 1.4 M4.7 15.3l1.4-1.4 M13.9 6.1l1.4-1.4" />
      </>
    ),
  },
  key: {
    viewBox: '0 0 20 20',
    body: (
      <>
        <circle cx="7" cy="10" r="3.5" />
        <path d="M10.5 10h7 M15 10v3" />
      </>
    ),
  },
  folder: { viewBox: '0 0 20 20', body: <path d="M2.5 5h5l1.5 2h8.5v9h-15z" /> },
  check: { viewBox: '0 0 16 16', body: <path d="M3 8.5l3 3 7-7" /> },
  'check-circle': {
    viewBox: '0 0 20 20',
    body: (
      <>
        <circle cx="10" cy="10" r="7.5" />
        <path d="M6.8 10.2l2.2 2.2 4.2-4.6" />
      </>
    ),
  },
} as const;

export type IconName = keyof typeof GLYPHS;

export const ICON_NAMES = Object.keys(GLYPHS) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'children'> {
  name: IconName;
  /** Rendered size in px. The design system uses 16, 18 and 20 (28 for the onboarding mark). */
  size?: number;
  /** Accessible name. Without it the icon is decorative and hidden from screen readers. */
  label?: string;
}

export function Icon({ name, size = 20, label, className, ...rest }: IconProps) {
  const glyph = GLYPHS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox={glyph.viewBox}
      className={cx('filey-icon', className)}
      focusable="false"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      {...rest}
    >
      {glyph.body}
    </svg>
  );
}
