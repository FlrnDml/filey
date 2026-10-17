import { toHistoryRow, toInboxRow } from '../../core/history';
import type { ImportService } from '../../core/import';
import { IPC_CHANNELS, type AppState, type EventChannel, type EventContract } from '../../core/ipc';
import type { SettingsRepository } from '../../core/settings';

type AppStateSource = Pick<ImportService, 'getState' | 'queuedCount' | 'analyzingId' | 'listInbox'>;

/** The `AppState` the renderer and the tray see. `attentionCount` counts inbox entries that failed or are duplicates. */
export const currentAppState = (imports: AppStateSource): AppState => ({
  ...imports.getState(),
  queuedCount: imports.queuedCount(),
  analyzingId: imports.analyzingId(),
  attentionCount: imports.listInbox().filter((record) => record.status !== 'pending').length,
});

export interface EventBridgeDeps {
  imports: AppStateSource &
    Pick<
      ImportService,
      'getHistoryEntry' | 'onInboxChanged' | 'onHistoryChanged' | 'onStateChange' | 'onQueuedCountChange' | 'onAnalyzingChange'
    >;
  settings: Pick<SettingsRepository, 'getSettings'>;
  /** Sends one event to every app window (see `broadcast`). */
  send<C extends EventChannel>(channel: C, payload: EventContract[C]): void;
}

/**
 * Forwards pipeline events to the renderer as `inbox:changed`, `history:changed` and `state:changed`.
 * Returns a function that stops it.
 */
export function connectPipelineEvents({ imports, settings, send }: EventBridgeDeps): () => void {
  const sendState = () => send(IPC_CHANNELS.state.changed, currentAppState(imports));
  const disposers = [
    imports.onInboxChanged((change) => {
      if (change.kind === 'remove') {
        send(IPC_CHANNELS.inbox.changed, change);
      } else {
        send(IPC_CHANNELS.inbox.changed, {
          kind: 'upsert',
          row: toInboxRow(change.record, { analyzingId: imports.analyzingId(), findProcessed: (id) => imports.getHistoryEntry(id) }),
        });
      }
      // A row can enter or leave the failed/duplicate set, which changes `attentionCount`.
      sendState();
    }),
    imports.onHistoryChanged((change) => {
      if (change.kind === 'remove') {
        send(IPC_CHANNELS.history.changed, change);
      } else {
        send(IPC_CHANNELS.history.changed, {
          kind: 'upsert',
          row: toHistoryRow(change.record, { targetPath: settings.getSettings().targetPath }),
        });
      }
    }),
    imports.onStateChange(sendState),
    imports.onQueuedCountChange(sendState),
    imports.onAnalyzingChange(sendState),
  ];
  return () => disposers.splice(0).forEach((dispose) => dispose());
}
