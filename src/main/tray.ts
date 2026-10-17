/**
 * The menu-bar icon (arc42 §5.1 "Tray"). Thin Electron code; what it shows comes from
 * `tray-state.ts`, where the popover goes from `windows.ts`.
 *
 * Left click toggles the popover; right click opens the menu (Settings…, Show logs, Quit Filey).
 */
import { app, Menu, nativeImage, screen, Tray, type MenuItemConstructorOptions } from 'electron';
import * as path from 'node:path';
import { isEmptyRect, type Rect } from './popover-position';
import { TRAY_ICON_FILES, type TrayAppearance, type TrayIconVariant } from './tray-state';

/**
 * Folder with the template images. Packaged builds get it via
 * `packagerConfig.extraResource` in `forge.config.mts`, like the sample scan.
 */
export const trayIconDir = (): string => (app.isPackaged ? path.join(process.resourcesPath, 'tray') : path.join(app.getAppPath(), 'assets', 'tray'));

export interface AppTrayActions {
  /** Left click, with the icon bounds (or the cursor position if the platform reports none). */
  togglePopover(anchor: Rect): void;
  openSettings(): void;
  showLogs(): void;
  quit(): void;
}

export interface AppTray {
  apply(appearance: TrayAppearance): void;
  /** Where the popover opens: the icon bounds, or the cursor position if the platform reports none. */
  anchor(): Rect;
  destroy(): void;
}

/** Shared by the tray menu and the application menu, so both show the same shortcuts. */
export function trayMenuTemplate(actions: Pick<AppTrayActions, 'openSettings' | 'showLogs' | 'quit'>): MenuItemConstructorOptions[] {
  return [
    { label: 'Settings…', accelerator: 'CommandOrControl+,', click: () => actions.openSettings() },
    { label: 'Show logs', click: () => actions.showLogs() },
    { type: 'separator' },
    { label: 'Quit Filey', accelerator: 'CommandOrControl+Q', click: () => actions.quit() },
  ];
}

export function createAppTray(actions: AppTrayActions): AppTray {
  const icons = new Map<TrayIconVariant, Electron.NativeImage>();
  const icon = (variant: TrayIconVariant) => {
    let image = icons.get(variant);
    if (!image) {
      // createFromPath also loads the @2x file next to it.
      image = nativeImage.createFromPath(path.join(trayIconDir(), TRAY_ICON_FILES[variant]));
      // Black on transparent: macOS tints template images for light, dark and tinted menu bars.
      image.setTemplateImage(true);
      icons.set(variant, image);
    }
    return image;
  };

  const tray = new Tray(icon('idle'));
  tray.setToolTip('Filey');
  const menu = Menu.buildFromTemplate(trayMenuTemplate(actions));

  const anchor = (bounds?: Rect): Rect => {
    const icon = bounds && !isEmptyRect(bounds) ? bounds : tray.getBounds();
    if (!isEmptyRect(icon)) return icon;
    const cursor = screen.getCursorScreenPoint();
    return { x: cursor.x, y: cursor.y, width: 0, height: 0 };
  };

  // No setContextMenu: on macOS that would open the menu on left click as well.
  tray.on('click', (_event, bounds) => actions.togglePopover(anchor(bounds)));
  tray.on('right-click', () => tray.popUpContextMenu(menu));

  return {
    apply(appearance) {
      if (tray.isDestroyed()) return;
      tray.setImage(icon(appearance.icon));
      tray.setToolTip(appearance.tooltip);
    },
    anchor: () => anchor(),
    destroy: () => tray.destroy(),
  };
}
