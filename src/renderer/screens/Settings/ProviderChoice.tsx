import { useId } from 'react';
import type { Settings } from '../../../core/ipc';

export const PROVIDER_CHOICE_TEXT = {
  legend: 'Where should the AI run?',
  openrouter: 'OpenRouter (cloud)',
  openrouterHint: 'Paste your own API key. Documents are sent to OpenRouter and the model provider you choose.',
  ollama: 'Ollama (on this Mac)',
  ollamaHint: 'No key and no cloud: documents never leave your Mac. Needs the free Ollama app and about 6 GB of disk space.',
} as const;

export interface ProviderChoiceProps {
  value: Settings['provider'];
  onChange(provider: Settings['provider']): void;
  disabled?: boolean;
}

/** The choice between the two providers (arc42 §6.2): two radio buttons, each with a line saying what it means. */
export function ProviderChoice({ value, onChange, disabled }: ProviderChoiceProps) {
  const name = useId();
  const option = (provider: Settings['provider'], label: string, hint: string) => (
    <label className="settings-choice__option">
      <input type="radio" name={name} checked={value === provider} disabled={disabled} onChange={() => onChange(provider)} />
      <span>
        <span className="type-body settings-choice__label">{label}</span>
        <span className="type-small settings-muted settings-choice__hint">{hint}</span>
      </span>
    </label>
  );
  return (
    <fieldset className="settings-choice">
      <legend className="settings-label">{PROVIDER_CHOICE_TEXT.legend}</legend>
      {option('openrouter', PROVIDER_CHOICE_TEXT.openrouter, PROVIDER_CHOICE_TEXT.openrouterHint)}
      {option('ollama', PROVIDER_CHOICE_TEXT.ollama, PROVIDER_CHOICE_TEXT.ollamaHint)}
    </fieldset>
  );
}
