import { useCallback, useEffect, useState } from 'react';
import { SETTINGS_TABS, type ApiKeyStatus, type FileyApi, type FolderRule, type Settings, type SettingsTab } from '../../../core/ipc';
import { parseSurfaceHash, surfaceHash } from '../../../core/surfaces';
import { Tabs, type IconName } from '../../components';
import { FilingTab } from './FilingTab';
import { toDrafts, type RuleDraft } from './format';
import { GeneralTab } from './GeneralTab';
import { ProviderTab } from './ProviderTab';
import './SettingsScreen.css';

const TAB_INFO: Record<SettingsTab, { label: string; icon: IconName }> = {
  general: { label: 'General', icon: 'gear' },
  provider: { label: 'Provider', icon: 'key' },
  filing: { label: 'Filing', icon: 'folder' },
};

const systemNow = () => new Date();

export interface SettingsScreenProps {
  /** Tab from the window URL (`#settings/<tab>`). */
  initialTab: SettingsTab;
  /** The preload bridge; tests pass a mock. */
  api?: FileyApi;
  /** Clock for the naming-template preview. */
  now?: () => Date;
  /**
   * Keep the window URL in sync with the selected tab and follow `hashchange` (default true).
   * Tests turn it off so renders do not leak the URL fragment into each other.
   */
  syncHash?: boolean;
}

/**
 * Settings window (arc42 §5.1 "UI") with the tabs General, Provider and Filing. Fields save when they are
 * committed (blur, Return, a chosen folder); folder rules save with "Save rules".
 * Main switches the tab by changing the URL fragment; selecting a tab here writes it back, so the
 * window URL always names the visible tab.
 */
export function SettingsScreen({ initialTab, api = window.filey, now = systemNow, syncHash = true }: SettingsScreenProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus | null>(null);
  const [rules, setRules] = useState<FolderRule[] | null>(null);
  // Kept here, not in the Filing tab, so unsaved rule edits survive switching tabs.
  const [ruleDrafts, setRuleDrafts] = useState<RuleDraft[] | null>(null);

  useEffect(() => {
    if (!syncHash) return;
    const onHashChange = () => {
      const surface = parseSurfaceHash(window.location.hash);
      if (surface?.kind === 'settings') setTab(surface.tab);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [syncHash]);

  const refreshKeyStatus = useCallback(() => {
    api.apiKey.status().then(setKeyStatus, () => undefined);
  }, [api]);

  // Live data: subscribe first, then load, so no change between the two is lost.
  useEffect(() => {
    let active = true;
    let changed = false;
    const off = api.settings.onChanged((next) => {
      changed = true;
      setSettings(next);
    });
    api.settings.get().then(
      (s) => active && !changed && setSettings(s),
      () => active && setLoadError(true),
    );
    api.settings.listRules().then(
      (list) => {
        if (!active) return;
        setRules(list);
        setRuleDrafts(toDrafts(list));
      },
      () => active && setLoadError(true),
    );
    api.apiKey.status().then(
      (status) => active && setKeyStatus(status),
      () => undefined,
    );
    return () => {
      active = false;
      off();
    };
  }, [api]);

  // The key can become unreadable (imports pause) or be saved elsewhere (first-launch window):
  // re-check when the pipeline state changes and when the window gets focus.
  useEffect(() => {
    const off = api.state.onChanged(refreshKeyStatus);
    window.addEventListener('focus', refreshKeyStatus);
    return () => {
      off();
      window.removeEventListener('focus', refreshKeyStatus);
    };
  }, [api, refreshKeyStatus]);

  const select = (id: string) => {
    const next = SETTINGS_TABS.find((t) => t === id);
    if (!next) return;
    setTab(next);
    if (syncHash) window.history.replaceState(null, '', surfaceHash({ kind: 'settings', tab: next }));
  };

  const content = (id: SettingsTab) => {
    if (loadError) {
      return (
        <p className="type-small settings-error" role="alert">
          Filey could not load the settings. Close this window and open Settings again.
        </p>
      );
    }
    if (!settings) return <p className="type-small settings-muted">Loading settings…</p>;
    switch (id) {
      case 'general':
        return <GeneralTab api={api} settings={settings} onSettings={setSettings} />;
      case 'provider':
        return <ProviderTab api={api} settings={settings} keyStatus={keyStatus} onSettings={setSettings} onKeyChanged={refreshKeyStatus} />;
      case 'filing':
        return (
          <FilingTab
            api={api}
            settings={settings}
            onSettings={setSettings}
            rules={rules}
            rulesEditor={{ saved: rules, drafts: ruleDrafts, setDrafts: setRuleDrafts, onSaved: setRules }}
            now={now}
          />
        );
    }
  };

  return (
    <main className="settings-screen">
      <h1 className="visually-hidden">Settings</h1>
      <Tabs
        label="Settings"
        selectedId={tab}
        onSelect={select}
        className="settings-screen__tabs"
        panelClassName="settings-screen__panel"
        items={SETTINGS_TABS.map((id) => ({
          id,
          label: TAB_INFO[id].label,
          icon: TAB_INFO[id].icon,
          content: content(id),
        }))}
      />
    </main>
  );
}
