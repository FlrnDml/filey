import { useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import type { ApiKeyStatus, FileyApi, Settings } from '../../../core/ipc';
import { DEFAULT_MODEL } from '../../../core/settings/types';
import { Button, Icon, Input } from '../../components';
import { cx } from '../../components/cx';
import { Feedback, failed, saved, type FeedbackValue } from './Feedback';
import { effectiveModel, modelFieldValue } from './format';

export const PROVIDER_TEXT = {
  keyHint: 'Stored in your macOS Keychain. Only ever sent to OpenRouter.',
  keySaved: 'Key saved in Keychain',
  keyPlaceholder: 'sk-or-…',
  keyUnreadable:
    'Filey cannot read the saved key any more, for example after an update. Imports are paused until you paste your key again.',
  modelHint: 'Needs PDF or image input and structured output. Any OpenRouter model works.',
  testing: 'Sending the sample scan to OpenRouter…',
  privacy:
    'Privacy: document contents are sent to OpenRouter and the model provider you choose. Nothing else leaves your Mac. No telemetry, no backend.',
} as const;

type TestState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; ok: boolean; message: string; model: string };

export interface ProviderTabProps {
  api: FileyApi;
  settings: Settings;
  /** `null` while it is loading. */
  keyStatus: ApiKeyStatus | null;
  onSettings(settings: Settings): void;
  /** Asks the screen to read the key status again after it was saved or removed. */
  onKeyChanged(): void;
}

/**
 * Provider tab (docs/design-system/components/SettingsProvider): OpenRouter key, optional model and
 * "Test connection" (arc42 §6.2). The renderer never sees a stored key, only its status (§6.6).
 */
export function ProviderTab({ api, settings, keyStatus, onSettings, onKeyChanged }: ProviderTabProps) {
  const [keyDraft, setKeyDraft] = useState('');
  const [keyError, setKeyError] = useState<string | undefined>();
  const [keyFeedback, setKeyFeedback] = useState<FeedbackValue | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);

  // `null` while the field shows the saved model.
  const [modelDraft, setModelDraft] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | undefined>();
  const [modelFeedback, setModelFeedback] = useState<FeedbackValue | null>(null);
  /** A model whose connection test failed, waiting for "Save anyway" (arc42 §6.2). */
  const [pendingModel, setPendingModel] = useState<string | null>(null);

  const [test, setTest] = useState<TestState>({ phase: 'idle' });
  const testButton = useRef<HTMLButtonElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const modelInput = useRef<HTMLInputElement>(null);
  const warningId = useId();

  const modelValue = modelDraft ?? modelFieldValue(settings.model);

  // ---- API key -------------------------------------------------------------------------------

  const saveKey = async () => {
    if (keyBusy) return;
    if (keyDraft.trim() === '') {
      setKeyError('Paste your OpenRouter API key first.');
      return;
    }
    setKeyBusy(true);
    setKeyError(undefined);
    setKeyFeedback(null);
    try {
      const result = await api.apiKey.save(keyDraft.trim());
      if (result.ok) {
        setKeyDraft('');
        setKeyFeedback(saved('Key saved in your Keychain.'));
        onKeyChanged();
      } else {
        setKeyError(result.message);
      }
    } catch {
      setKeyError('Filey could not save the key.');
    } finally {
      setKeyBusy(false);
    }
  };

  const removeKey = async () => {
    setConfirmRemove(false);
    setKeyFeedback(null);
    setKeyError(undefined);
    try {
      await api.apiKey.clear();
      setKeyFeedback(saved('Key removed. Filey pauses imports until you enter a key again.'));
      onKeyChanged();
    } catch {
      setKeyFeedback(failed('Filey could not remove the key.'));
    }
    keyInput.current?.focus();
  };

  const onKeyKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void saveKey();
    }
  };

  // ---- Model ---------------------------------------------------------------------------------

  const saveModel = async (model: string) => {
    setPendingModel(null);
    setModelError(undefined);
    setModelFeedback(null);
    try {
      const result = await api.settings.update({ model });
      if (result.ok) {
        setModelDraft(null);
        onSettings(result.settings);
        setModelFeedback(saved(model === DEFAULT_MODEL ? 'Saved. Filey uses the default model.' : 'Model saved.'));
      } else {
        setModelError(result.error.message);
      }
    } catch {
      setModelError('Filey could not save the model.');
    }
  };

  /** Saves the typed model, unless its connection test failed: then ask first (arc42 §6.2). */
  const commitModel = () => {
    if (modelDraft === null) return;
    const model = effectiveModel(modelDraft);
    if (model === settings.model) {
      setModelDraft(null);
      setPendingModel(null);
      return;
    }
    if (test.phase === 'done' && !test.ok && test.model === model) {
      setPendingModel(model);
      return;
    }
    void saveModel(model);
  };

  const onModelBlur = (event: FocusEvent<HTMLInputElement>) => {
    // Moving to "Test connection" may test the typed model first; the test result then decides about saving.
    if (event.relatedTarget === testButton.current) return;
    commitModel();
  };

  /** Focus passed through "Test connection" without a test: commit the typed model now. */
  const onTestBlur = (event: FocusEvent<HTMLButtonElement>) => {
    if (event.relatedTarget === modelInput.current || test.phase === 'running') return;
    commitModel();
  };

  const onModelKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitModel();
    } else if (event.key === 'Escape' && modelDraft !== null) {
      event.preventDefault();
      setModelDraft(null);
      setModelError(undefined);
      setPendingModel(null);
    }
  };

  const keepSavedModel = () => {
    setPendingModel(null);
    setModelDraft(null);
    modelInput.current?.focus();
  };

  // ---- Test connection -----------------------------------------------------------------------

  const runTest = async () => {
    if (test.phase === 'running') return;
    const model = effectiveModel(modelValue);
    const key = keyDraft.trim();
    setPendingModel(null);
    setModelFeedback(null);
    setTest({ phase: 'running' });
    let ok = false;
    let message: string;
    try {
      const result = await api.connection.test(key ? { key, model } : { model });
      ok = result.ok;
      message = result.message;
    } catch {
      message = 'Filey could not run the connection test.';
    }
    setTest({ phase: 'done', ok, message, model });
    // A typed, unsaved model: save it if it works, otherwise ask before saving it.
    if (modelDraft !== null && model !== settings.model) {
      if (ok) void saveModel(model);
      else setPendingModel(model);
    }
  };

  // ---- View ----------------------------------------------------------------------------------

  const keySet = keyStatus === 'set' || keyStatus === 'unreadable';
  const keyPlaceholder = keyStatus === 'set' ? PROVIDER_TEXT.keySaved : PROVIDER_TEXT.keyPlaceholder;

  return (
    <div className="settings-form">
      <div className="settings-field">
        <Input
          ref={keyInput}
          label="OpenRouter API key"
          type="password"
          variant="mono"
          autoComplete="off"
          placeholder={keyPlaceholder}
          value={keyDraft}
          onChange={(event) => {
            setKeyDraft(event.target.value);
            setKeyError(undefined);
          }}
          onKeyDown={onKeyKeyDown}
          hint={PROVIDER_TEXT.keyHint}
          error={keyError}
          aria-describedby={keyStatus === 'unreadable' ? warningId : undefined}
        />
        {keyStatus === 'unreadable' && (
          <p id={warningId} className="type-small settings-warning">
            {PROVIDER_TEXT.keyUnreadable}
          </p>
        )}
        <div className="settings-row settings-row--actions">
          <Button variant="primary" onClick={() => void saveKey()} aria-busy={keyBusy || undefined}>
            Save key
          </Button>
          {keySet && !confirmRemove && (
            <Button variant="danger" onClick={() => setConfirmRemove(true)}>
              Remove key
            </Button>
          )}
        </div>
        {confirmRemove && (
          <div className="settings-confirm" role="group" aria-label="Remove the API key">
            <p className="type-small">Remove the API key from your Keychain? Filey pauses imports until you enter a key again.</p>
            <div className="settings-row">
              <Button variant="danger" onClick={() => void removeKey()} autoFocus>
                Remove key
              </Button>
              <Button
                onClick={() => {
                  setConfirmRemove(false);
                  keyInput.current?.focus();
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        <Feedback value={keyFeedback} />
      </div>

      <div className="settings-field">
        <Input
          ref={modelInput}
          label="Model"
          optional
          variant="mono"
          placeholder={DEFAULT_MODEL}
          value={modelValue}
          onChange={(event) => {
            setModelDraft(event.target.value);
            setModelError(undefined);
            setModelFeedback(null);
          }}
          onBlur={onModelBlur}
          onKeyDown={onModelKeyDown}
          hint={PROVIDER_TEXT.modelHint}
          error={modelError}
        />
        <Feedback value={modelFeedback} />
        {pendingModel !== null && (
          <div className="settings-confirm settings-confirm--warning" role="group" aria-label="Save a model that failed the test">
            <p className="type-small">
              The connection test failed for <span className="type-mono">{pendingModel}</span>. Filey may not be able to file
              your documents with it. Save it anyway?
            </p>
            <div className="settings-row">
              <Button onClick={() => void saveModel(pendingModel)}>Save anyway</Button>
              <Button onClick={keepSavedModel}>Keep {modelFieldValue(settings.model) || 'the default model'}</Button>
            </div>
          </div>
        )}
      </div>

      <div className="settings-field settings-row settings-row--test">
        <Button ref={testButton} onClick={() => void runTest()} onBlur={onTestBlur} aria-busy={test.phase === 'running' || undefined}>
          {test.phase === 'running' ? 'Testing…' : 'Test connection'}
        </Button>
        <p
          role="status"
          className={cx(
            'type-small',
            'settings-test-result',
            test.phase === 'running' && 'settings-muted',
            test.phase === 'done' && (test.ok ? 'settings-test-result--ok' : 'settings-test-result--failed'),
          )}
        >
          {test.phase === 'running' && PROVIDER_TEXT.testing}
          {test.phase === 'done' && test.ok && <Icon name="check" size={16} />}
          {test.phase === 'done' && test.message}
        </p>
      </div>

      <p className="type-small settings-muted settings-privacy">{PROVIDER_TEXT.privacy}</p>
    </div>
  );
}
