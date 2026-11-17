import { useId, useState } from 'react';
import type { FileyApi, NameIssue, Settings } from '../../../core/ipc';
import { MAX_SUGGEST_NAMES } from '../../../core/renamer/types';
import { Button, Checkbox } from '../../components';
import { cx } from '../../components/cx';
import { Feedback, failed, saved, type FeedbackValue } from './Feedback';

export interface NamesTabProps {
  api: FileyApi;
  settings: Pick<Settings, 'provider' | 'namingTemplate'>;
}

/** One file in the rename queue. */
interface QueueEntry {
  path: string;
  name: string;
  folder: string;
  state:
    | { kind: 'proposed'; newName: string }
    | { kind: 'unchanged' }
    | { kind: 'failed'; message: string }
    | { kind: 'renaming'; newName: string }
    | { kind: 'renamed'; newName: string };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const where = (folder: string) => (folder === '' ? 'Target folder' : folder);

/** What "Suggest names" sends, in words (arc42 §8 "Privacy"). */
function suggestPrivacy(provider: Settings['provider']): string {
  return provider === 'ollama'
    ? 'Suggest names reads the selected documents with Ollama on this Mac, like an import.'
    : 'Suggest names sends the selected documents to OpenRouter, like an import, and costs the same.';
}

/**
 * Names tab (arc42 §5.4, F11): lists filed PDFs whose names do not follow the naming template, proposes names for the
 * selected ones and renames a file only after Accept. Files stay in their folder and are never overwritten.
 */
export function NamesTab({ api, settings }: NamesTabProps) {
  const headingId = useId();
  const queueId = useId();
  const [issues, setIssues] = useState<NameIssue[] | null>(null);
  const [summary, setSummary] = useState<{ checked: number; truncated: boolean } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [busy, setBusy] = useState<'check' | 'suggest' | 'apply' | null>(null);
  const [feedback, setFeedback] = useState<FeedbackValue | null>(null);
  const [queueFeedback, setQueueFeedback] = useState<FeedbackValue | null>(null);

  const check = async () => {
    setBusy('check');
    setFeedback({ kind: 'progress', text: 'Scanning the target folder…' });
    try {
      const result = await api.names.check();
      if (!result.ok) {
        setFeedback(failed(result.message));
        return;
      }
      setIssues(result.issues);
      setSummary({ checked: result.checked, truncated: result.truncated });
      setSelected(new Set(result.issues.slice(0, MAX_SUGGEST_NAMES).map((issue) => issue.path)));
      setQueue([]);
      setQueueFeedback(null);
      setFeedback(null);
    } catch {
      setFeedback(failed('Filey could not check the file names.'));
    } finally {
      setBusy(null);
    }
  };

  const toggle = (issue: NameIssue, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(issue.path);
      else next.delete(issue.path);
      return next;
    });
  };

  const suggest = async () => {
    if (!issues) return;
    const batch = issues.filter((issue) => selected.has(issue.path)).slice(0, MAX_SUGGEST_NAMES);
    if (batch.length === 0) return;
    setBusy('suggest');
    setFeedback({ kind: 'progress', text: `Reading ${plural(batch.length, 'document')}… This takes a while.` });
    try {
      const result = await api.names.suggest(batch.map((issue) => issue.path));
      if (!result.ok) {
        setFeedback(failed(result.message));
        return;
      }
      const byPath = new Map(batch.map((issue) => [issue.path, issue]));
      const entries: QueueEntry[] = result.suggestions.map((s) => ({
        path: s.path,
        name: s.name,
        folder: byPath.get(s.path)?.folder ?? '',
        state: s.status === 'proposed' ? { kind: 'proposed', newName: s.newName } : s.status === 'unchanged' ? { kind: 'unchanged' } : { kind: 'failed', message: s.message },
      }));
      const done = new Set(entries.map((entry) => entry.path));
      setQueue((prev) => [...prev.filter((entry) => !done.has(entry.path)), ...entries]);
      setIssues((prev) => prev?.filter((issue) => !done.has(issue.path)) ?? prev);
      setSelected((prev) => new Set([...prev].filter((p) => !done.has(p))));
      const proposed = entries.filter((entry) => entry.state.kind === 'proposed').length;
      setFeedback({ kind: 'info', text: `${plural(proposed, 'name')} proposed. Accept or skip them below.` });
    } catch {
      setFeedback(failed('Filey could not suggest names.'));
    } finally {
      setBusy(null);
    }
  };

  const apply = async (paths: string[]) => {
    if (paths.length === 0) return;
    setBusy('apply');
    setQueueFeedback(null);
    setQueue((prev) => prev.map((entry) => (paths.includes(entry.path) && entry.state.kind === 'proposed' ? { ...entry, state: { kind: 'renaming', newName: entry.state.newName } } : entry)));
    try {
      const results = await api.names.apply(paths);
      const byPath = new Map(results.map((r) => [r.path, r]));
      setQueue((prev) =>
        prev.map((entry) => {
          const r = byPath.get(entry.path);
          if (!r) return entry;
          return { ...entry, state: r.ok ? { kind: 'renamed', newName: r.newName } : { kind: 'failed', message: r.message } };
        }),
      );
      const renamed = results.filter((r) => r.ok).length;
      setQueueFeedback(renamed === results.length ? saved(`${plural(renamed, 'file')} renamed.`) : failed(`${plural(results.length - renamed, 'file')} could not be renamed.`));
    } catch {
      setQueue((prev) => prev.map((entry) => (entry.state.kind === 'renaming' ? { ...entry, state: { kind: 'proposed', newName: entry.state.newName } } : entry)));
      setQueueFeedback(failed('Filey could not rename the files.'));
    } finally {
      setBusy(null);
    }
  };

  const skip = (path: string) => setQueue((prev) => prev.filter((entry) => entry.path !== path));
  const pending = queue.filter((entry) => entry.state.kind === 'proposed').map((entry) => entry.path);
  const selectedCount = issues?.filter((issue) => selected.has(issue.path)).length ?? 0;

  return (
    <div className="settings-form">
      <section className="settings-field" aria-labelledby={headingId}>
        <h2 id={headingId} className="settings-label">
          File names
        </h2>
        <p className="type-small settings-muted">
          Find PDFs in the target folder whose names do not follow the naming template <span className="type-mono">{settings.namingTemplate}</span> and rename them. Files stay
          in their folder, and nothing is renamed until you accept the new name.
        </p>
        <div className="settings-row settings-row--actions">
          <Button variant={issues ? 'secondary' : 'primary'} onClick={() => void check()} disabled={busy !== null} aria-busy={busy === 'check' || undefined}>
            {issues ? 'Check again' : 'Check names'}
          </Button>
          <span className="type-small settings-muted">Checking reads only file names. Nothing is sent.</span>
        </div>
        <Feedback value={feedback} />
        {summary && issues && (issues.length > 0 || queue.length === 0) && (
          <p className="type-small settings-muted settings-hint">
            {issues.length === 0
              ? `All ${plural(summary.checked, 'PDF')} follow the naming template.`
              : `${issues.length} of ${plural(summary.checked, 'PDF')} ${issues.length === 1 ? 'does' : 'do'} not follow the naming template.`}
          </p>
        )}
        {summary?.truncated && <p className="type-small settings-warning">The scan stopped at its limit, so some files were not checked.</p>}
        {issues && issues.length > 0 && (
          <>
            <ul className="settings-rules settings-names" aria-label="Files to rename">
              {issues.map((issue) => (
                <li key={issue.path} className="settings-rule">
                  <Checkbox
                    label={issue.name}
                    hint={issue.placeholder ? `${where(issue.folder)} · in iCloud, downloaded first` : where(issue.folder)}
                    checked={selected.has(issue.path)}
                    disabled={!selected.has(issue.path) && selectedCount >= MAX_SUGGEST_NAMES}
                    onChange={(event) => toggle(issue, event.target.checked)}
                    className="settings-names__file"
                  />
                </li>
              ))}
            </ul>
            <p className="type-small settings-muted settings-hint">{suggestPrivacy(settings.provider)}</p>
            <div className="settings-row settings-row--actions">
              <Button variant="primary" onClick={() => void suggest()} disabled={busy !== null || selectedCount === 0} aria-busy={busy === 'suggest' || undefined}>
                {`Suggest names (${selectedCount})`}
              </Button>
              <span className="type-small settings-muted">At most {MAX_SUGGEST_NAMES} files at a time.</span>
            </div>
          </>
        )}
      </section>

      {queue.length > 0 && (
        <section className="settings-field" aria-labelledby={queueId}>
          <h2 id={queueId} className="settings-label">
            Proposed names
          </h2>
          <ul className="settings-rules settings-queue" aria-labelledby={queueId}>
            {queue.map((entry) => (
              <QueueRow key={entry.path} entry={entry} busy={busy !== null} onAccept={() => void apply([entry.path])} onSkip={() => skip(entry.path)} />
            ))}
          </ul>
          <div className="settings-row settings-row--actions">
            <Button variant="primary" onClick={() => void apply(pending)} disabled={busy !== null || pending.length === 0} aria-busy={busy === 'apply' || undefined}>
              {`Accept all (${pending.length})`}
            </Button>
            <span className="type-small settings-muted">A name that is taken gets _2. Files that were filed by Filey stay in the history.</span>
          </div>
          <Feedback value={queueFeedback} />
        </section>
      )}
    </div>
  );
}

interface QueueRowProps {
  entry: QueueEntry;
  busy: boolean;
  onAccept(): void;
  onSkip(): void;
}

function QueueRow({ entry, busy, onAccept, onSkip }: QueueRowProps) {
  const { state } = entry;
  const newName = state.kind === 'proposed' || state.kind === 'renaming' || state.kind === 'renamed' ? state.newName : null;
  const status =
    state.kind === 'renamed'
      ? 'Renamed'
      : state.kind === 'renaming'
        ? 'Renaming…'
        : state.kind === 'unchanged'
          ? 'The name stays: the document gives the same name.'
          : state.kind === 'failed'
            ? state.message
            : null;
  return (
    <li className={cx('settings-rule', 'settings-queue__item', state.kind === 'failed' && 'settings-rule--invalid')}>
      <div className="settings-queue__names">
        <span className="type-mono settings-queue__old" title={entry.name}>
          {entry.name}
        </span>
        {newName !== null && (
          <span className="type-mono settings-queue__new" title={newName}>
            <span aria-hidden="true">→ </span>
            <span className="visually-hidden">new name: </span>
            {newName}
          </span>
        )}
        <span className="type-small settings-muted">{where(entry.folder)}</span>
        {status && (
          <span className={cx('type-small', state.kind === 'failed' ? 'settings-error' : state.kind === 'renamed' ? 'settings-feedback--success' : 'settings-muted')}>{status}</span>
        )}
      </div>
      {state.kind === 'proposed' && (
        <div className="settings-row">
          <Button size="small" variant="primary" onClick={onAccept} disabled={busy} aria-label={`Accept ${state.newName} for ${entry.name}`}>
            Accept
          </Button>
          <Button size="small" onClick={onSkip} disabled={busy} aria-label={`Skip ${entry.name}`}>
            Skip
          </Button>
        </div>
      )}
      {(state.kind === 'failed' || state.kind === 'unchanged') && (
        <Button size="small" onClick={onSkip} disabled={busy} aria-label={`Remove ${entry.name} from the list`}>
          Remove
        </Button>
      )}
    </li>
  );
}
