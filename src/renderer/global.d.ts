import type { FileyApi } from '../core/ipc';

declare global {
  interface Window {
    /** Typed bridge to the main process, defined by the preload script. */
    filey: FileyApi;
  }
}
