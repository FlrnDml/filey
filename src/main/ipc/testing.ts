/** Test helpers for the IPC layer (imported by tests only, never bundled). */
import type { Logger } from '../../core/ports';
import { registerIpcHandlers, type IpcHandlers, type IpcMainLike } from './register';

type Listener = (event: unknown, ...args: unknown[]) => unknown;

/** Stands for an event from a trusted app window. */
export const TRUSTED_EVENT = { trusted: true };

/** Fake `ipcMain`; `invoke` sends `TRUSTED_EVENT`, `invokeAs` any event. */
export class FakeIpcMain implements IpcMainLike {
  readonly listeners = new Map<string, Listener>();
  handle(channel: string, listener: Listener): void {
    if (this.listeners.has(channel)) throw new Error(`Second handler for ${channel}`);
    this.listeners.set(channel, listener);
  }
  removeHandler(channel: string): void {
    this.listeners.delete(channel);
  }
  invokeAs(event: unknown, channel: string, ...args: unknown[]): Promise<unknown> {
    const listener = this.listeners.get(channel);
    if (!listener) throw new Error(`No handler for ${channel}`);
    return Promise.resolve(listener(event, ...args));
  }
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    return this.invokeAs(TRUSTED_EVENT, channel, ...args);
  }
}

/** Registers `handlers` on a fake `ipcMain` that trusts only `TRUSTED_EVENT` and records log lines. */
export function registerFake(...handlerSets: IpcHandlers[]) {
  const ipcMain = new FakeIpcMain();
  const logs: string[] = [];
  const logger: Logger = { log: (level, message) => logs.push(`${level}: ${message}`) };
  const disposers = handlerSets.map((handlers) =>
    registerIpcHandlers(ipcMain, handlers, { isTrustedSender: (event) => event === TRUSTED_EVENT, logger }),
  );
  return { ipcMain, logs, logger, dispose: () => disposers.forEach((d) => d()) };
}
