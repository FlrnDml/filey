import { useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { FileyApi, FolderRule, SettingsError } from '../../../core/ipc';
import { FALLBACK_FOLDER } from '../../../core/settings/types';
import { Button, Input } from '../../components';
import { cx } from '../../components/cx';
import { Feedback, failed, saved, type FeedbackValue } from './Feedback';
import { RuleEditorDialog } from './RuleEditorDialog';
import { fromDrafts, newDraft, rulesChanged, toDrafts, type RuleDraft } from './format';

const NO_CHANGES: FeedbackValue = { kind: 'info', text: 'No changes to save. The rules are already saved.' };

export interface FolderRulesProps {
  api: FileyApi;
  /** Saved rules; `null` while loading. */
  saved: FolderRule[] | null;
  /** Rules being edited; `null` until the saved rules are loaded. */
  drafts: RuleDraft[] | null;
  setDrafts: Dispatch<SetStateAction<RuleDraft[] | null>>;
  /** Called with the rules main saved. */
  onSaved(rules: FolderRule[]): void;
}

/**
 * Folder rules editor (arc42 §5.2): a folder path and a plain-language description per rule.
 * The `Unsorted` fallback row is always there and cannot be removed; its description can be edited.
 * Rules are saved together with "Save rules" and apply to the next import only.
 */
export function FolderRules({ api, saved: savedRules, drafts, setDrafts, onSaved }: FolderRulesProps) {
  const headingId = useId();
  const [error, setError] = useState<SettingsError | null>(null);
  const [feedback, setFeedback] = useState<FeedbackValue | null>(null);
  const [busy, setBusy] = useState(false);
  /** Rule whose folder input (for Unsorted: description input) gets focus after the next render. */
  const focusNext = useRef<number | null>(null);
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const editButtons = useRef(new Map<number, HTMLButtonElement>());
  /** Rule open in the editor dialog. */
  const [editing, setEditing] = useState<number | null>(null);

  useEffect(() => {
    if (focusNext.current === null) return;
    inputs.current.get(focusNext.current)?.focus();
    focusNext.current = null;
  });

  if (!drafts || !savedRules) {
    return (
      <section className="settings-field" aria-labelledby={headingId}>
        <h2 id={headingId} className="settings-label">
          Folder rules
        </h2>
        <p className="type-small settings-muted">Loading folder rules…</p>
      </section>
    );
  }

  const dirty = rulesChanged(drafts, savedRules);

  const edit = (id: number, patch: Partial<FolderRule>) => {
    setDrafts((prev) => prev?.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)) ?? prev);
    setFeedback(null);
  };

  const add = () => {
    const rule = newDraft();
    setDrafts((prev) => {
      if (!prev) return prev;
      // New rules go above the fallback, so Unsorted stays last.
      const at = prev.findIndex((r) => r.fallback);
      const index = at === -1 ? prev.length : at;
      return [...prev.slice(0, index), rule, ...prev.slice(index)];
    });
    setFeedback(null);
    focusNext.current = rule.id;
  };

  const remove = (id: number) => {
    setDrafts((prev) => prev?.filter((rule) => rule.id !== id) ?? prev);
    setError(null);
    setFeedback(null);
    addButton.current?.focus();
  };

  const save = async () => {
    if (busy) return;
    if (!dirty) {
      // Nothing to write: saving unchanged rules is a no-op, not an error.
      setError(null);
      setFeedback(NO_CHANGES);
      return;
    }
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const result = await api.settings.saveRules(fromDrafts(drafts));
      if (result.ok) {
        onSaved(result.rules);
        setDrafts(toDrafts(result.rules));
        setFeedback(saved('Rules saved.'));
      } else {
        setError(result.error);
        const rule = result.error.ruleIndex === undefined ? undefined : drafts[result.error.ruleIndex];
        if (rule) focusNext.current = rule.id;
      }
    } catch {
      setFeedback(failed('Filey could not save the folder rules.'));
    } finally {
      setBusy(false);
    }
  };

  const closeEditor = (id: number) => {
    setEditing(null);
    editButtons.current.get(id)?.focus();
  };
  const editingRule = drafts.find((rule) => rule.id === editing);

  const ruleError = (index: number) => (error?.ruleIndex === index ? error.message : undefined);
  const generalError = error && error.ruleIndex === undefined ? error.message : null;

  return (
    <section className="settings-field" aria-labelledby={headingId}>
      <h2 id={headingId} className="settings-label">
        Folder rules
      </h2>
      <ul className="settings-rules" aria-labelledby={headingId}>
        {drafts.map((rule, index) => {
          const { fallback } = rule;
          const message = ruleError(index);
          const messageId = `${headingId}-rule-${rule.id}-error`;
          const name = rule.folder.trim() || `rule ${index + 1}`;
          const register = (node: HTMLInputElement | null) => {
            if (node) inputs.current.set(rule.id, node);
            else inputs.current.delete(rule.id);
          };
          const invalid = {
            'aria-invalid': message ? true : undefined,
            'aria-describedby': message ? messageId : undefined,
          } as const;
          return (
            <li key={rule.id} className={cx('settings-rule', message && 'settings-rule--invalid')}>
              <div className="settings-rule__fields">
                {fallback ? (
                  <span className="type-mono settings-rule__folder settings-rule__folder--fixed">{rule.folder}</span>
                ) : (
                  <Input
                    ref={register}
                    label={`Folder of rule ${index + 1}`}
                    hideLabel
                    variant="mono"
                    placeholder="Folder/Subfolder"
                    value={rule.folder}
                    onChange={(event) => edit(rule.id, { folder: event.target.value })}
                    className="settings-rule__folder"
                    {...invalid}
                  />
                )}
                <Input
                  ref={fallback ? register : undefined}
                  label={fallback ? `Description of ${FALLBACK_FOLDER}` : `Description of rule ${index + 1}`}
                  hideLabel
                  placeholder="What belongs here, in plain words"
                  value={rule.description}
                  onChange={(event) => edit(rule.id, { description: event.target.value })}
                  className="settings-rule__description"
                  {...invalid}
                />
                <Button
                  size="small"
                  ref={(node) => {
                    if (node) editButtons.current.set(rule.id, node);
                    else editButtons.current.delete(rule.id);
                  }}
                  onClick={() => setEditing(rule.id)}
                  aria-label={`Edit rule ${name}`}
                  aria-haspopup="dialog"
                >
                  Edit
                </Button>
                {fallback ? (
                  <span className="type-small settings-muted settings-rule__required">Required</span>
                ) : (
                  <Button size="small" onClick={() => remove(rule.id)} aria-label={`Remove rule ${name}`}>
                    Remove
                  </Button>
                )}
              </div>
              {message && (
                <p id={messageId} className="type-small settings-error">
                  {message}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {editingRule && (
        <RuleEditorDialog
          folder={editingRule.folder.trim() || 'New rule'}
          value={editingRule.description}
          onSave={(description) => {
            edit(editingRule.id, { description });
            closeEditor(editingRule.id);
          }}
          onCancel={() => closeEditor(editingRule.id)}
        />
      )}
      <div className="settings-row settings-row--actions">
        <Button ref={addButton} onClick={add}>
          Add rule
        </Button>
        <Button variant="primary" onClick={() => void save()} disabled={!dirty || busy} aria-busy={busy || undefined}>
          Save rules
        </Button>
        <span className="type-small settings-muted">Changes apply to the next import only.</span>
      </div>
      {generalError && <p className="type-small settings-error">{generalError}</p>}
      <Feedback value={feedback ?? (dirty ? { kind: 'info', text: 'Unsaved changes.' } : NO_CHANGES)} />
    </section>
  );
}
