import { useId, useState, type KeyboardEvent } from 'react';
import { renderPath } from '../../../core/filer/naming';
import type { FileyApi, FolderKind, FolderRule, Settings, SettingsPatch } from '../../../core/ipc';
import { FALLBACK_FOLDER, NAMING_PLACEHOLDERS } from '../../../core/settings/types';
import { Button, Input } from '../../components';
import { cx } from '../../components/cx';
import { Feedback, failed, saved, type FeedbackValue } from './Feedback';
import { FolderRules, type FolderRulesProps } from './FolderRules';
import { displayPath } from './format';

/** The sample document of the naming-template preview (date: today). */
export const SAMPLE_DOCUMENT = { sender: 'Northwind', title: 'Invoice' } as const;

const FOLDERS: Record<FolderKind, { label: string; setting: 'inboxPath' | 'targetPath'; hint?: string }> = {
  inbox: { label: 'Inbox folder', setting: 'inboxPath' },
  target: { label: 'Target folder', setting: 'targetPath', hint: 'Must not be the inbox folder itself.' },
};

export interface FilingTabProps {
  api: FileyApi;
  settings: Settings;
  onSettings(settings: Settings): void;
  /** Saved rules; `null` while loading. */
  rules: FolderRule[] | null;
  /** Folder-rules editor state, kept by the screen so unsaved rules survive a tab switch. */
  rulesEditor: Omit<FolderRulesProps, 'api'>;
  /** Clock for the preview date. */
  now: () => Date;
}

/** Filing tab (docs/design-system/components/SettingsFiling): folders, naming template and folder rules. */
export function FilingTab({ api, settings, onSettings, rules, rulesEditor, now }: FilingTabProps) {
  const [folderFeedback, setFolderFeedback] = useState<Partial<Record<FolderKind, FeedbackValue>>>({});
  const [templateDraft, setTemplateDraft] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | undefined>();
  const [templateFeedback, setTemplateFeedback] = useState<FeedbackValue | null>(null);
  const previewId = useId();

  const update = (patch: SettingsPatch) => api.settings.update(patch);

  const chooseFolder = async (kind: FolderKind) => {
    const { setting } = FOLDERS[kind];
    setFolderFeedback((prev) => ({ ...prev, [kind]: undefined }));
    let feedback: FeedbackValue | undefined;
    try {
      const path = await api.dialogs.chooseFolder(kind);
      if (path === null) return;
      if (path === settings[setting]) return;
      const result = await update({ [setting]: path });
      if (result.ok) {
        onSettings(result.settings);
        feedback = saved();
      } else {
        // Shown at the folder the user changed, even if the rule names the other one (inbox = target).
        feedback = failed(result.error.message);
      }
    } catch {
      feedback = failed('Filey could not change this folder.');
    }
    setFolderFeedback((prev) => ({ ...prev, [kind]: feedback }));
  };

  const template = templateDraft ?? settings.namingTemplate;
  const firstFolder = rules?.[0]?.folder ?? FALLBACK_FOLDER;
  const preview = renderPath(template, { ...SAMPLE_DOCUMENT, category: firstFolder }, now());

  const commitTemplate = async () => {
    if (templateDraft === null) return;
    if (templateDraft === settings.namingTemplate) {
      setTemplateDraft(null);
      return;
    }
    setTemplateFeedback(null);
    try {
      const result = await update({ namingTemplate: templateDraft });
      if (result.ok) {
        setTemplateDraft(null);
        setTemplateError(undefined);
        onSettings(result.settings);
        setTemplateFeedback(saved());
      } else {
        setTemplateError(result.error.message);
      }
    } catch {
      setTemplateError('Filey could not save the naming template.');
    }
  };

  const onTemplateKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commitTemplate();
    } else if (event.key === 'Escape' && templateDraft !== null) {
      event.preventDefault();
      setTemplateDraft(null);
      setTemplateError(undefined);
    }
  };

  return (
    <div className="settings-form">
      {(['inbox', 'target'] as const).map((kind) => (
        <FolderField
          key={kind}
          label={FOLDERS[kind].label}
          path={settings[FOLDERS[kind].setting]}
          hint={FOLDERS[kind].hint}
          feedback={folderFeedback[kind] ?? null}
          onChoose={() => void chooseFolder(kind)}
        />
      ))}

      <div className="settings-field">
        <Input
          label="Naming template"
          variant="mono"
          value={template}
          onChange={(event) => {
            setTemplateDraft(event.target.value);
            setTemplateFeedback(null);
          }}
          onBlur={() => void commitTemplate()}
          onKeyDown={onTemplateKeyDown}
          error={templateError}
          aria-describedby={previewId}
        />
        <p id={previewId} className="type-mono settings-preview">
          <span className="visually-hidden">Example:</span> {preview}
        </p>
        <p className="type-small settings-muted settings-hint">
          Placeholders: {NAMING_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}. Use / for subfolders.
        </p>
        <Feedback value={templateFeedback} />
      </div>

      <FolderRules api={api} {...rulesEditor} />
    </div>
  );
}

interface FolderFieldProps {
  label: string;
  path: string;
  hint?: string;
  feedback: FeedbackValue | null;
  onChoose(): void;
}

/** A folder: its path in mono (as Finder names it) and a Choose… button that opens the native picker. */
function FolderField({ label, path, hint, feedback, onChoose }: FolderFieldProps) {
  const id = useId();
  const isError = feedback?.kind === 'error';
  return (
    <div className="settings-field" role="group" aria-labelledby={`${id}-label`}>
      <div id={`${id}-label`} className="settings-label">
        {label}
      </div>
      <div className="settings-row">
        <div id={`${id}-path`} className={cx('type-mono', 'settings-path', isError && 'settings-path--invalid')} title={path}>
          {displayPath(path)}
        </div>
        <Button
          id={`${id}-choose`}
          aria-labelledby={`${id}-choose ${id}-label`}
          aria-describedby={cx(`${id}-path`, `${id}-message`)}
          onClick={onChoose}
        >
          Choose…
        </Button>
      </div>
      {!feedback && hint && <p className="type-small settings-muted settings-hint">{hint}</p>}
      <Feedback id={`${id}-message`} value={feedback} />
    </div>
  );
}
