import type { EventChannel, EventContract, InvokeChannel, InvokeContract } from '../../core/ipc';
import type { Logger } from '../../core/ports';
import { IpcValidationError } from './validate';

export { expectNoArgs } from './validate';

/** The slice of Electron's `ipcMain` we use; lets tests pass a fake. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}

/** The slice of `WebContents` we use to push events to a renderer. */
export interface EventTarget {
  isDestroyed(): boolean;
  send(channel: string, payload: unknown): void;
}

/**
 * One main-side handler. The renderer is untrusted, so `validate` must turn the raw
 * arguments into the typed tuple or throw; `handle` only ever sees validated input.
 */
export interface IpcHandler<C extends InvokeChannel> {
  validate(args: unknown[]): InvokeContract[C]['args'];
  handle(...args: InvokeContract[C]['args']): InvokeContract[C]['result'] | Promise<InvokeContract[C]['result']>;
}

export type IpcHandlers = { [C in InvokeChannel]?: IpcHandler<C> };

export interface RegisterOptions {
  /** Decides from the IPC event whether the call comes from one of the app's own pages (see `createSenderCheck`). */
  isTrustedSender(event: unknown): boolean;
  /** Receives one line per rejected or failed call; never the arguments. */
  logger: Logger;
}

/** The slice of `WebFrameMain` the sender check reads. */
export interface FrameLike {
  readonly url: string;
  readonly processId: number;
  readonly routingId: number;
}

/** The slice of `BrowserWindow` the sender check reads. */
export interface AppWindowLike {
  readonly webContents: { readonly mainFrame: FrameLike };
}

/**
 * Builds `isTrustedSender`: the call must come from the main frame of one of the app's windows
 * (no iframe, no foreign window) showing one of the app's own pages.
 */
export function createSenderCheck(getWindows: () => Iterable<AppWindowLike>, isAppPage: (url: string) => boolean): (event: unknown) => boolean {
  return (event) => {
    const frame = (event as { senderFrame?: FrameLike | null } | null | undefined)?.senderFrame;
    if (!frame) return false; // the frame navigated away or was destroyed
    let fromAppWindow = false;
    for (const window of getWindows()) {
      try {
        const main = window.webContents.mainFrame;
        if (main === frame || (main.processId === frame.processId && main.routingId === frame.routingId)) {
          fromAppWindow = true;
          break;
        }
      } catch {
        // A window that is being destroyed can throw on access; it is not a valid sender.
      }
    }
    if (!fromAppWindow) return false;
    try {
      return isAppPage(frame.url);
    } catch {
      return false;
    }
  };
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Registers every handler on `ipcMain` and returns a function that removes them again. */
export function registerIpcHandlers(ipcMain: IpcMainLike, handlers: IpcHandlers, { isTrustedSender, logger }: RegisterOptions): () => void {
  const channels = Object.keys(handlers) as InvokeChannel[];
  for (const channel of channels) {
    const handler = handlers[channel] as IpcHandler<InvokeChannel>;
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isTrustedSender(event)) {
        logger.log('warn', `IPC: rejected ${channel}: untrusted sender`);
        throw new Error(`Rejected ${channel}`);
      }
      let validated: InvokeContract[InvokeChannel]['args'];
      try {
        validated = handler.validate(args);
      } catch (err) {
        // Our validation messages never contain the payload; anything else might, so it is not logged.
        logger.log('warn', `IPC: rejected ${channel}: ${err instanceof IpcValidationError ? err.message : 'invalid arguments'}`);
        // eslint-disable-next-line preserve-caught-error -- deliberately detached: the renderer must not see the cause.
        throw new Error(`Invalid arguments for ${channel}`);
      }
      try {
        return await handler.handle(...validated);
      } catch (err) {
        logger.log('error', `IPC: ${channel} failed: ${errorText(err)}`);
        // The renderer gets no internal details (paths, provider errors).
        // eslint-disable-next-line preserve-caught-error -- deliberately detached: the renderer must not see the cause.
        throw new Error(`${channel} failed`);
      }
    });
  }
  return () => {
    for (const channel of channels) {
      ipcMain.removeHandler(channel);
    }
  };
}

/** Sends a typed event to every live target (e.g. all open windows). */
export function broadcast<C extends EventChannel>(
  targets: Iterable<EventTarget>,
  channel: C,
  payload: EventContract[C],
): void {
  for (const target of targets) {
    if (!target.isDestroyed()) {
      target.send(channel, payload);
    }
  }
}
