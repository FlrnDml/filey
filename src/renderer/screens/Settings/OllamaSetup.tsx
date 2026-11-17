import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { FileyApi, OllamaPullProgress, OllamaStatus, Settings } from '../../../core/ipc';
import { isModelInstalled } from '../../../core/ollama/models';
import { DEFAULT_OLLAMA_MODEL } from '../../../core/settings/types';
import { Button, Icon, Input } from '../../components';
import { Feedback, failed, saved, type FeedbackValue } from './Feedback';

export const OLLAMA_TEXT = {
  checking: 'Looking for Ollama…',
  notRunning: 'Ollama is not running. Start the Ollama app, or install it first. Scans wait in the inbox until it runs.',
  getOllama: 'Get Ollama',
  running: (version?: string) => (version ? `Ollama ${version} is running.` : 'Ollama is running.'),
  modelHint: 'Needs image input. The recommended model runs on a Mac with 16 GB of memory.',
  installed: 'This model is installed.',
  notInstalled: 'This model is not installed yet.',
  download: 'Download model',
  cancel: 'Cancel',
  downloaded: 'Model downloaded.',
  privacy: 'Privacy: with Ollama, document contents stay on your Mac. Filey only talks to the Ollama address above. Ollama itself downloads the model.',
} as const;

/** "Downloading… 35 %" for a step with a known size; Ollama's own step name otherwise ("pulling manifest"). */
export function progressText(progress: OllamaPullProgress | null): string {
  if (!progress) return 'Starting the download…';
  if (progress.total && progress.completed !== undefined && progress.total > 0) {
    return `Downloading… ${Math.min(100, Math.floor((progress.completed / progress.total) * 100))} %`;
  }
  return progress.status === 'success' ? 'Finishing…' : 'Preparing the download…';
}

export interface OllamaSetupProps {
  api: FileyApi;
  settings: Settings;
  onSettings(settings: Settings): void;
}

/**
 * Ollama's part of the Provider tab and of onboarding (arc42 §6.2): whether Ollama runs, the model to use and,
 * if it is missing, a "Download model" button with progress and a way to cancel. The address Ollama listens on
 * is edited in the Provider tab, not here.
 */
export function OllamaSetup({ api, settings, onSettings }: OllamaSetupProps) {
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [modelDraft, setModelDraft] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | undefined>();
  const [pulling, setPulling] = useState(false);
  const [progress, setProgress] = useState<OllamaPullProgress | null>(null);
  const [feedback, setFeedback] = useState<FeedbackValue | null>(null);
  const active = useRef(true);

  const model = modelDraft ?? settings.ollamaModel;
  const installed = status?.running === true && isModelInstalled(status.models, model);

  const refresh = useCallback(() => {
    api.ollama.status().then(
      (next) => {
        if (active.current) setStatus(next);
      },
      () => active.current && setStatus({ running: false, models: [] }),
    );
  }, [api]);

  useEffect(() => {
    active.current = true;
    refresh();
    // The user starts or installs Ollama in another app, then comes back: look again.
    window.addEventListener('focus', refresh);
    const off = api.ollama.onPullProgress((next) => setProgress(next));
    return () => {
      active.current = false;
      window.removeEventListener('focus', refresh);
      off();
    };
  }, [api, refresh, settings.ollamaUrl]);

  const commitModel = async () => {
    if (modelDraft === null) return;
    const next = modelDraft.trim() || DEFAULT_OLLAMA_MODEL;
    if (next === settings.ollamaModel) {
      setModelDraft(null);
      return;
    }
    try {
      const result = await api.settings.update({ ollamaModel: next });
      if (result.ok) {
        setModelDraft(null);
        setModelError(undefined);
        onSettings(result.settings);
      } else {
        setModelError(result.error.message);
      }
    } catch {
      setModelError('Filey could not save the model.');
    }
  };

  const onModelKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commitModel();
    } else if (event.key === 'Escape' && modelDraft !== null) {
      event.preventDefault();
      setModelDraft(null);
      setModelError(undefined);
    }
  };

  const download = async () => {
    if (pulling) return;
    // The typed model is saved first, so what is downloaded is what Filey will use.
    await commitModel();
    setPulling(true);
    setProgress(null);
    setFeedback(null);
    try {
      const result = await api.ollama.pull(modelDraft?.trim() || settings.ollamaModel);
      if (!active.current) return;
      if (result.ok) setFeedback(saved(OLLAMA_TEXT.downloaded));
      else setFeedback(result.reason === 'cancelled' ? { kind: 'info', text: result.message } : failed(result.message));
    } catch {
      if (active.current) setFeedback(failed('Filey could not download the model.'));
    } finally {
      if (active.current) {
        setPulling(false);
        refresh();
      }
    }
  };

  const percent = progress?.total && progress.completed !== undefined && progress.total > 0 ? Math.min(100, (progress.completed / progress.total) * 100) : undefined;

  return (
    <div className="settings-field">
      <p role="status" className="type-small settings-muted settings-ollama-status">
        {status === null && OLLAMA_TEXT.checking}
        {status?.running === true && (
          <>
            <Icon name="check" size={16} /> {OLLAMA_TEXT.running(status.version)}
          </>
        )}
        {status?.running === false && OLLAMA_TEXT.notRunning}
      </p>
      {status?.running === false && (
        <div className="settings-row settings-row--actions">
          <Button onClick={() => void api.ollama.openDownloadPage().catch(() => undefined)}>{OLLAMA_TEXT.getOllama}</Button>
        </div>
      )}

      <Input
        label="Model"
        variant="mono"
        placeholder={DEFAULT_OLLAMA_MODEL}
        value={model}
        disabled={pulling}
        onChange={(event) => {
          setModelDraft(event.target.value);
          setModelError(undefined);
        }}
        onBlur={() => void commitModel()}
        onKeyDown={onModelKeyDown}
        hint={status?.running ? (installed ? OLLAMA_TEXT.installed : OLLAMA_TEXT.notInstalled) : OLLAMA_TEXT.modelHint}
        error={modelError}
        className="settings-ollama-model"
      />

      {status?.running === true && !installed && !pulling && (
        <div className="settings-row settings-row--actions">
          <Button variant="primary" onClick={() => void download()}>
            {OLLAMA_TEXT.download}
          </Button>
        </div>
      )}
      {pulling && (
        <div className="settings-pull">
          <progress className="settings-pull__bar" max={100} value={percent} aria-label="Model download" />
          <div className="settings-row">
            <p role="status" className="type-small settings-muted settings-pull__text">
              {progressText(progress)}
            </p>
            <Button onClick={() => void api.ollama.cancelPull().catch(() => undefined)}>{OLLAMA_TEXT.cancel}</Button>
          </div>
        </div>
      )}
      <Feedback value={feedback} />
    </div>
  );
}
