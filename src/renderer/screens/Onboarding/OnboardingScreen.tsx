import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { ApiKeyStatus, FileyApi, FolderSetup } from '../../../core/ipc';
import { Button, Icon, Input } from '../../components';
import { displayPath } from '../Settings/format';
import './OnboardingScreen.css';

export type OnboardingStep = 1 | 2 | 3;

export const ONBOARDING_TEXT = {
  keyIntro: 'Paste your OpenRouter key and Filey takes care of the rest.',
  keySaved: 'Key saved in Keychain',
  keyPlaceholder: 'sk-or-…',
  loginIntro: 'Filey can start when your Mac does, so scans are filed even if you forget it is there.',
  loginHint: 'You can change this in Settings → General.',
  menuBarIntro:
    'This window closes now. Look for the scanner icon at the top of your screen. There is no Dock icon, and Filey keeps watching your inbox in the background.',
  foldersHint: 'Save your scans in the Inbox folder. Filey files them in the folders next to it. Change this in Settings → Filing.',
  foldersFailed: 'Filey could not create its folder in iCloud Drive. Check that iCloud Drive is on, or choose an inbox and a target folder in Settings → Filing. Until then, scans are not filed.',
} as const;

export interface OnboardingScreenProps {
  /** The preload bridge; tests pass a mock. */
  api?: FileyApi;
  /** Step to start on; the app always starts on 1; tests start on a later step. */
  initialStep?: OnboardingStep;
}

/**
 * First-launch window (arc42 §6.4, docs/design-system/components/Onboarding): three steps, one primary
 * button each. 1: paste the OpenRouter key (saved in the Keychain). 2: start at login or not (applied and
 * stored right away). 3: Filey lives in the menu bar and where it expects the scans (the Filey folder main created in iCloud Drive,
 * or what to do if that failed); "Got it" marks onboarding as done and main closes the window. Closing the window earlier leaves onboarding incomplete, so it opens again on the next launch.
 * Esc does nothing here: skipping the setup needs the window's close button.
 */
export function OnboardingScreen({ api = window.filey, initialStep = 1 }: OnboardingScreenProps) {
  const [step, setStep] = useState<OnboardingStep>(initialStep);

  return (
    <main className="onboarding">
      {step === 1 && <KeyStep api={api} onDone={() => setStep(2)} />}
      {step === 2 && <LoginStep api={api} onDone={() => setStep(3)} />}
      {step === 3 && <MenuBarStep api={api} />}
    </main>
  );
}

function StepHeader({ step, title, intro }: { step: OnboardingStep; title: string; intro: string }) {
  return (
    <>
      <p className="type-label onboarding__step">{step} of 3</p>
      <h1 className="type-title onboarding__title">
        {title}
      </h1>
      <p className="type-small onboarding__intro">{intro}</p>
    </>
  );
}

function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="type-small onboarding__error">
      {children}
    </p>
  );
}

function KeyStep({ api, onDone }: { api: FileyApi; onDone(): void }) {
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<ApiKeyStatus | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api.apiKey.status().then(
      (s) => active && setStatus(s),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [api]);

  // A key saved earlier (onboarding closed after this step) counts as present: Continue keeps it.
  const keySaved = status === 'set';
  const canContinue = key.trim() !== '' || keySaved;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !canContinue) return;
    if (key.trim() === '') {
      onDone();
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.apiKey.save(key.trim());
      if (result.ok) {
        onDone();
        return;
      }
      setError(result.message);
    } catch {
      setError('Filey could not save the key.');
    }
    setBusy(false);
  };

  return (
    <form className="onboarding__body" onSubmit={(event) => void submit(event)} noValidate>
      <div className="onboarding__mark" aria-hidden="true">
        <Icon name="scan" size={28} />
      </div>
      <StepHeader step={1} title="Scan it. Filed." intro={ONBOARDING_TEXT.keyIntro} />
      <Input
        label="OpenRouter API key"
        type="password"
        variant="mono"
        autoComplete="off"
        autoFocus
        placeholder={keySaved ? ONBOARDING_TEXT.keySaved : ONBOARDING_TEXT.keyPlaceholder}
        value={key}
        onChange={(event) => {
          setKey(event.target.value);
          setError(undefined);
        }}
        error={error}
        className="onboarding__field"
      />
      <Button type="submit" variant="primary" fullWidth className="onboarding__push" disabled={!canContinue} aria-busy={busy || undefined}>
        Continue
      </Button>
    </form>
  );
}

function LoginStep({ api, onDone }: { api: FileyApi; onDone(): void }) {
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => primary.current?.focus(), []);

  const choose = async (enabled: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.app.setLoginItem(enabled);
      onDone();
      return;
    } catch {
      setError('Filey could not change the login item. Try again, or choose later in Settings → General.');
    }
    setBusy(false);
  };

  return (
    <div className="onboarding__body">
      <StepHeader step={2} title="Start at login?" intro={ONBOARDING_TEXT.loginIntro} />
      <div className="onboarding__row">
        <Button ref={primary} variant="primary" className="onboarding__grow" onClick={() => void choose(true)} aria-busy={busy || undefined}>
          Start at login
        </Button>
        <Button className="onboarding__grow" onClick={() => void choose(false)}>
          Not now
        </Button>
      </div>
      {error ? <ErrorText>{error}</ErrorText> : <p className="type-small onboarding__hint">{ONBOARDING_TEXT.loginHint}</p>}
    </div>
  );
}

function MenuBarStep({ api }: { api: FileyApi }) {
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [folders, setFolders] = useState<FolderSetup | undefined>();
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => button.current?.focus(), []);

  useEffect(() => {
    let active = true;
    api.app.getFolderSetup().then(
      (setup) => active && setFolders(setup),
      // The explanation is a courtesy: without it the step still works.
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [api]);

  const finish = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      // Main saves the flag and closes this window.
      await api.app.completeOnboarding();
    } catch {
      setError('Filey could not finish the setup. Try again.');
      setBusy(false);
    }
  };

  return (
    <div className="onboarding__body">
      <StepHeader step={3} title="Filey lives in the menu bar" intro={ONBOARDING_TEXT.menuBarIntro} />
      <div className="onboarding__menubar">
        <span className="onboarding__glyph" role="img" aria-label="The Filey icon in the menu bar">
          <Icon name="scan" size={18} />
        </span>
      </div>
      {folders && <FoldersInfo api={api} setup={folders} />}
      {error && <ErrorText>{error}</ErrorText>}
      <Button ref={button} variant="primary" fullWidth className="onboarding__push" onClick={() => void finish()} aria-busy={busy || undefined}>
        Got it
      </Button>
    </div>
  );
}

/** Where scans go and where filed documents end up; says so if the folder could not be created. */
function FoldersInfo({ api, setup }: { api: FileyApi; setup: FolderSetup }) {
  if (setup.status === 'failed') {
    return (
      <div className="onboarding__folders">
        <ErrorText>{ONBOARDING_TEXT.foldersFailed}</ErrorText>
        <Button className="onboarding__folders-action" onClick={() => void api.app.openSettings('filing').catch(() => undefined)}>
          Open Settings
        </Button>
      </div>
    );
  }
  return (
    <div className="onboarding__folders">
      <dl className="onboarding__paths">
        <dt className="type-label">Inbox</dt>
        <dd className="type-mono onboarding__path">{displayPath(setup.inboxPath)}</dd>
        <dt className="type-label">Filed documents</dt>
        <dd className="type-mono onboarding__path">{displayPath(setup.targetPath)}</dd>
      </dl>
      <p className="type-small onboarding__hint">{ONBOARDING_TEXT.foldersHint}</p>
    </div>
  );
}
