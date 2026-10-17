import { useEffect } from 'react';
import { parseSurfaceHash, type Surface } from '../core/surfaces';
import { OnboardingScreen } from './screens/Onboarding/OnboardingScreen';
import { Popover } from './screens/Popover/Popover';
import { SettingsScreen } from './screens/Settings/SettingsScreen';
import './App.css';

const TITLES: Record<Surface['kind'], string> = { popover: 'Filey', settings: 'Settings', onboarding: 'Welcome to Filey' };

export interface AppProps {
  /** The window URL fragment (`#popover`, `#settings/<tab>`, `#onboarding`); main sets it per window. */
  hash: string;
}

/**
 * Picks the screen for this window. Every window loads the same page; main chooses the surface with the
 * URL fragment (src/main/windows.ts). A window keeps its surface kind; only the Settings tab can change.
 */
export function App({ hash }: AppProps) {
  const surface = parseSurfaceHash(hash);
  const kind = surface?.kind;

  useEffect(() => {
    document.documentElement.dataset.surface = kind ?? 'unknown';
    document.title = kind ? TITLES[kind] : 'Filey';
  }, [kind]);

  switch (surface?.kind) {
    case 'popover':
      return <Popover />;
    case 'settings':
      return <SettingsScreen initialTab={surface.tab} />;
    case 'onboarding':
      return <OnboardingScreen />;
    default:
      // Main never loads the page without a known fragment, and IPC is refused for such a URL.
      return (
        <main className="app-unknown type-small" role="alert">
          This window has no content.
        </main>
      );
  }
}
