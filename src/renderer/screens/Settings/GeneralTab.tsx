import { useEffect, useState } from 'react';
import type { FileyApi, Settings } from '../../../core/ipc';
import { Button, Checkbox } from '../../components';
import { Feedback, failed, type FeedbackValue } from './Feedback';

export interface GeneralTabProps {
  api: FileyApi;
  settings: Settings;
  /** Called with the settings main saved, so the screen shows them before `settings.onChanged` arrives. */
  onSettings(settings: Settings): void;
}

/** General tab: start at login, debug logging, logs and the app version. Every change saves at once. */
export function GeneralTab({ api, settings, onSettings }: GeneralTabProps) {
  const [loginItem, setLoginItem] = useState<boolean | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginFeedback, setLoginFeedback] = useState<FeedbackValue | null>(null);
  const [debugBusy, setDebugBusy] = useState(false);
  const [debugFeedback, setDebugFeedback] = useState<FeedbackValue | null>(null);
  const [logsFeedback, setLogsFeedback] = useState<FeedbackValue | null>(null);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.app.getLoginItem().then(
      (enabled) => active && setLoginItem(enabled),
      () => active && setLoginFeedback(failed('Filey could not read the login item setting.')),
    );
    api.app.getVersion().then(
      (v) => active && setVersion(v),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [api]);

  // Busy controls stay enabled (disabling would drop keyboard focus); changes are ignored until the last one is done.
  const changeLoginItem = async (enabled: boolean) => {
    if (loginBusy) return;
    setLoginBusy(true);
    setLoginFeedback(null);
    setLoginItem(enabled);
    try {
      const actual = await api.app.setLoginItem(enabled);
      setLoginItem(actual);
      if (actual !== enabled) {
        setLoginFeedback({
          kind: 'warning',
          text: 'macOS did not change the login item. Check System Settings › General › Login Items.',
        });
      }
    } catch {
      setLoginItem(!enabled);
      setLoginFeedback(failed('Filey could not change the login item.'));
    } finally {
      setLoginBusy(false);
    }
  };

  const changeDebugLogging = async (debugLogging: boolean) => {
    if (debugBusy) return;
    setDebugBusy(true);
    setDebugFeedback(null);
    try {
      const result = await api.settings.update({ debugLogging });
      if (result.ok) onSettings(result.settings);
      else setDebugFeedback(failed(result.error.message));
    } catch {
      setDebugFeedback(failed('Filey could not save this setting.'));
    } finally {
      setDebugBusy(false);
    }
  };

  const openLogs = async () => {
    setLogsFeedback(null);
    try {
      const result = await api.app.openLogs();
      if (!result.ok) setLogsFeedback(failed(result.message));
    } catch {
      setLogsFeedback(failed('Filey could not open the logs.'));
    }
  };

  return (
    <div className="settings-form">
      <div className="settings-field">
        <Checkbox
          label="Start at login"
          hint="Filey starts in the menu bar when you log in to your Mac."
          checked={loginItem ?? false}
          disabled={loginItem === null}
          aria-busy={loginBusy || undefined}
          onChange={(event) => void changeLoginItem(event.target.checked)}
        />
        <Feedback value={loginFeedback} className="settings-feedback--indented" />
      </div>

      <div className="settings-field">
        <Checkbox
          label="Debug logging"
          hint="Adds more detail to the local log file. Logs never contain your API key or document contents."
          checked={settings.debugLogging}
          aria-busy={debugBusy || undefined}
          onChange={(event) => void changeDebugLogging(event.target.checked)}
        />
        <Feedback value={debugFeedback} className="settings-feedback--indented" />
      </div>

      <div className="settings-field">
        <div className="settings-row">
          <Button onClick={() => void openLogs()}>Show logs</Button>
        </div>
        <Feedback value={logsFeedback} />
      </div>

      <p className="type-small settings-muted settings-footer">{version ? `Filey ${version}` : 'Filey'}</p>
    </div>
  );
}
