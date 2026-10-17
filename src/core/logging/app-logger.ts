import type { Clock, Logger } from '../ports';
import { formatLogLine, isLevelEnabled, sanitizeLogMessage } from './format';

/** The app-wide logger: level filter, redaction and one line format for every sink (log file, console). */
export interface AppLogger extends Logger {
  /** Turns the `debug` level on or off ("Debug logging" setting); takes effect for the next message. */
  setDebug(enabled: boolean): void;
  isDebug(): boolean;
}

export interface AppLoggerOptions {
  clock: Clock;
  /** Receive finished lines (`formatLogLine`); a throwing sink does not stop the others. */
  sinks: readonly Logger[];
  debug?: boolean;
}

export function createAppLogger({ clock, sinks, debug = false }: AppLoggerOptions): AppLogger {
  let debugEnabled = debug;
  return {
    log(level, message) {
      if (!isLevelEnabled(level, debugEnabled)) return;
      const line = formatLogLine(clock.now(), level, sanitizeLogMessage(message));
      for (const sink of sinks) {
        try {
          sink.log(level, line);
        } catch {
          // Logging must never break the caller.
        }
      }
    },
    setDebug(enabled) {
      debugEnabled = enabled;
    },
    isDebug: () => debugEnabled,
  };
}

/** Applies the "Debug logging" setting (on start and after every settings change) and notes a change in the log. */
export function syncDebugLogging(logger: AppLogger, settings: { debugLogging: boolean }): void {
  if (logger.isDebug() === settings.debugLogging) return;
  logger.setDebug(settings.debugLogging);
  logger.log('info', `Log: debug logging ${settings.debugLogging ? 'on' : 'off'}`);
}
