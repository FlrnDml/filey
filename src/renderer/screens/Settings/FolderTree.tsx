import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { MAX_DESCRIBE_FOLDERS, type FileyApi, type FolderRule, type ScanView, type Settings } from '../../../core/ipc';
import { buildFolderTree, countUnmapped, type FolderTreeNode } from '../../../core/scanner/tree';
import { proposeRules, upsertRules, type RuleProposal } from '../../../core/scanner/mapping';
import { RULE_LIMITS } from '../../../core/settings/types';
import { Button, Checkbox, Icon, Input } from '../../components';
import { cx } from '../../components/cx';
import { Feedback, failed, saved, type FeedbackValue } from './Feedback';
import { RuleEditorDialog } from './RuleEditorDialog';

export interface FolderTreeProps {
  api: FileyApi;
  settings: Pick<Settings, 'provider'>;
  /** Saved rules; `null` while loading. */
  rules: FolderRule[] | null;
  /** Called with the rules main saved and the rules that changed, so the rule list below can follow. */
  onSaved(rules: FolderRule[], changes: FolderRule[]): void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** What "Suggest descriptions" sends, in words (arc42 §8 "Privacy"). */
function describePrivacy(provider: Settings['provider']): string {
  return provider === 'ollama'
    ? 'Suggest descriptions asks Ollama on this Mac. It gets the folder names and up to 5 file names per folder, no file contents.'
    : 'Suggest descriptions sends the folder names and up to 5 file names per folder to OpenRouter, no file contents.';
}

/**
 * The target folder as a tree (arc42 §5.4, F9): every scanned folder with its rule state. Clicking a folder opens the
 * rule dialog; Map folders proposes rules for folders without one. Changes here are saved right away.
 */
export function FolderTree({ api, settings, rules, onSaved }: FolderTreeProps) {
  const headingId = useId();
  const [scan, setScan] = useState<ScanView | null>(null);
  const [scanning, setScanning] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackValue | null>(null);
  /** Folder whose rule is open in the dialog. */
  const [editing, setEditing] = useState<FolderTreeNode | null>(null);
  const [proposals, setProposals] = useState<RuleProposal[] | null>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    let active = true;
    api.folders.lastScan().then(
      (last) => active && last && setScan(last),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [api]);

  const tree = useMemo(() => (scan && rules ? buildFolderTree(scan.folders, rules) : []), [scan, rules]);
  const unmapped = countUnmapped(tree);

  const runScan = async () => {
    if (scanning) return;
    setScanning(true);
    setFeedback({ kind: 'progress', text: 'Scanning the target folder…' });
    try {
      const result = await api.folders.scan();
      if (result.ok) {
        setScan(result.scan);
        setProposals(null);
        setFeedback(null);
      } else {
        setFeedback(failed(result.message));
      }
    } catch {
      setFeedback(failed('Filey could not scan the target folder.'));
    } finally {
      setScanning(false);
    }
  };

  /** Saves `changes` on top of the saved rules (not the unsaved edits below). */
  const saveChanges = async (changes: FolderRule[]): Promise<string | null> => {
    if (!rules) return 'The folder rules are still loading.';
    const next = upsertRules(rules, changes);
    if (next.length > RULE_LIMITS.rules) return `Filey keeps at most ${RULE_LIMITS.rules} folder rules. Select fewer folders.`;
    try {
      const result = await api.settings.saveRules(next);
      if (!result.ok) return result.error.message;
      onSaved(result.rules, changes);
      return null;
    } catch {
      return 'Filey could not save the folder rules.';
    }
  };

  /** Keeps the Add/Edit buttons, so focus can return to the one that opened the dialog. */
  const registerButton = (folder: string, element: HTMLButtonElement | null) => {
    if (element) editButtons.current.set(folder, element);
    else editButtons.current.delete(folder);
  };

  const closeEditor = (node: FolderTreeNode) => {
    setEditing(null);
    editButtons.current.get(node.path)?.focus();
  };

  return (
    <section className="settings-field" aria-labelledby={headingId}>
      <h2 id={headingId} className="settings-label">
        Folders in the target folder
      </h2>
      {!scan ? (
        <p className="type-small settings-muted">Scan the target folder to see its folders and which of them have a rule. Scanning only reads folder and file names.</p>
      ) : tree.length === 0 ? (
        <p className="type-small settings-muted">The target folder has no folders yet.</p>
      ) : (
        <ul className="settings-tree" aria-labelledby={headingId}>
          {tree.map((node) => (
            <TreeRow key={node.path} node={node} onEdit={setEditing} registerButton={registerButton} />
          ))}
        </ul>
      )}
      {scan && (
        <p className="type-small settings-muted settings-hint">
          {plural(scan.folders.length, 'folder')}, {plural(scan.fileCount, 'file')} · scanned at {time(scan.scannedAt)}
          {unmapped > 0 && ` · ${plural(unmapped, 'folder')} without a rule`}
        </p>
      )}
      {scan?.truncated && (
        <p className="type-small settings-warning">The scan stopped at its limit (6 folder levels or 5,000 files and folders), so some folders are missing.</p>
      )}
      <div className="settings-row settings-row--actions">
        <Button onClick={() => void runScan()} disabled={scanning} aria-busy={scanning || undefined} icon={<Icon name="folder" size={16} />}>
          {scan ? 'Rescan' : 'Scan'}
        </Button>
        {scan && (
          <Button onClick={() => setProposals(proposeRules(scan.folders, rules ?? []))} disabled={unmapped === 0 || proposals !== null || !rules}>
            Map folders
          </Button>
        )}
        <span className="type-small settings-muted">Rescan after changing folders in Finder.</span>
      </div>
      <Feedback value={feedback} />
      {proposals && (
        <MapFolders
          api={api}
          provider={settings.provider}
          proposals={proposals}
          setProposals={setProposals}
          onSave={async (changes) => {
            const error = await saveChanges(changes);
            if (error === null) {
              setProposals(null);
              setFeedback(saved(`${plural(changes.length, 'rule')} added.`));
            }
            return error;
          }}
        />
      )}
      {editing && (
        <RuleEditorDialog
          folder={editing.path}
          value={editing.rule?.description ?? ''}
          onSave={(description) => {
            const node = editing;
            void saveChanges([{ folder: node.rule?.folder ?? node.path, description: description.trim() }]).then((error) => {
              setFeedback(error === null ? saved('Rule saved.') : failed(error));
              closeEditor(node);
            });
          }}
          onCancel={() => closeEditor(editing)}
        />
      )}
    </section>
  );
}

interface TreeRowProps {
  node: FolderTreeNode;
  onEdit(node: FolderTreeNode): void;
  registerButton(folder: string, element: HTMLButtonElement | null): void;
}

/** One folder and its subfolders. The state is always said in words, never by colour alone. */
function TreeRow({ node, onEdit, registerButton }: TreeRowProps) {
  const missing = node.exists ? '' : 'Created on the next filing';
  const state = node.rule ? [node.rule.description, missing.toLowerCase()].filter(Boolean).join(' · ') : missing || 'No rule';
  const label = node.rule ? 'Edit rule' : 'Add rule';
  return (
    <li className="settings-tree__item">
      <div className="settings-tree__row">
        <Icon name="folder" size={16} className="settings-tree__icon" />
        <span className="type-mono settings-tree__name" title={node.path}>
          {node.name}
        </span>
        <span className={cx('type-small', 'settings-tree__state', node.exists && !node.rule ? 'settings-tree__state--open' : 'settings-muted')} title={state}>
          {state}
        </span>
        {node.exists && <span className="type-small settings-muted settings-tree__count">{plural(node.fileCount, 'file')}</span>}
        <Button
          size="small"
          ref={(element) => registerButton(node.path, element)}
          onClick={() => onEdit(node)}
          aria-label={`${label} for ${node.path}`}
          aria-haspopup="dialog"
        >
          {label}
        </Button>
      </div>
      {node.children.length > 0 && (
        <ul className="settings-tree__children">
          {node.children.map((child) => (
            <TreeRow key={child.path} node={child} onEdit={onEdit} registerButton={registerButton} />
          ))}
        </ul>
      )}
    </li>
  );
}

interface MapFoldersProps {
  api: FileyApi;
  provider: Settings['provider'];
  proposals: RuleProposal[];
  setProposals(next: RuleProposal[] | null | ((prev: RuleProposal[] | null) => RuleProposal[] | null)): void;
  /** Saves the selected rules; resolves with an error message or null. */
  onSave(changes: FolderRule[]): Promise<string | null>;
}

/** Review of the proposed rules: choose folders, edit descriptions, optionally let the provider suggest them. */
function MapFolders({ api, provider, proposals, setProposals, onSave }: MapFoldersProps) {
  const headingId = useId();
  const [busy, setBusy] = useState<'suggest' | 'save' | null>(null);
  const [feedback, setFeedback] = useState<FeedbackValue | null>(null);
  const selected = proposals.filter((p) => p.selected);

  const update = (folder: string, patch: Partial<RuleProposal>) => {
    setProposals((prev) => prev?.map((p) => (p.folder === folder ? { ...p, ...patch } : p)) ?? prev);
    setFeedback(null);
  };

  const suggest = async () => {
    const folders = selected.slice(0, MAX_DESCRIBE_FOLDERS).map((p) => p.folder);
    if (folders.length === 0) return;
    setBusy('suggest');
    setFeedback({ kind: 'progress', text: `Asking ${provider === 'ollama' ? 'Ollama' : 'OpenRouter'} for descriptions…` });
    try {
      const result = await api.folders.suggestDescriptions(folders);
      if (!result.ok) {
        setFeedback(failed(result.message));
        return;
      }
      const byFolder = new Map(result.rules.map((rule) => [rule.folder, rule.description]));
      setProposals((prev) => prev?.map((p) => ({ ...p, description: byFolder.get(p.folder) ?? p.description })) ?? prev);
      const more = selected.length > folders.length ? ` Only the first ${MAX_DESCRIBE_FOLDERS} folders were sent; run it again for the rest.` : '';
      setFeedback({ kind: 'info', text: `${plural(byFolder.size, 'description')} suggested. Check them before you add the rules.${more}` });
    } catch {
      setFeedback(failed('Filey could not get descriptions.'));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    const changes = selected.map(({ folder, description }) => ({ folder, description: description.trim() }));
    const empty = changes.find((c) => c.description === '');
    if (empty) {
      setFeedback(failed(`The folder "${empty.folder}" needs a description.`));
      return;
    }
    setBusy('save');
    setFeedback(null);
    const error = await onSave(changes);
    setBusy(null);
    if (error !== null) setFeedback(failed(error));
  };

  return (
    <section className="settings-confirm" aria-labelledby={headingId}>
      <h3 id={headingId} className="settings-label">
        Map folders
      </h3>
      <p className="type-small settings-muted">
        Filey proposes a rule for each folder without one. Choose the folders and describe what belongs in them; folders that hold files are selected.
      </p>
      <ul className="settings-rules">
        {proposals.map((p) => (
          <li key={p.folder} className="settings-rule">
            <div className="settings-rule__fields">
              <Checkbox
                label={p.folder}
                hint={plural(p.fileCount, 'file')}
                checked={p.selected}
                onChange={(event) => update(p.folder, { selected: event.target.checked })}
                className="settings-rule__folder settings-map__folder"
              />
              <Input
                label={`Description of ${p.folder}`}
                hideLabel
                value={p.description}
                onChange={(event) => update(p.folder, { description: event.target.value })}
                disabled={!p.selected}
                className="settings-rule__description"
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="type-small settings-muted">{describePrivacy(provider)}</p>
      <div className="settings-row settings-row--actions">
        <Button onClick={() => void suggest()} disabled={busy !== null || selected.length === 0} aria-busy={busy === 'suggest' || undefined}>
          Suggest descriptions
        </Button>
        <Button variant="primary" onClick={() => void save()} disabled={busy !== null || selected.length === 0} aria-busy={busy === 'save' || undefined}>
          {`Add ${plural(selected.length, 'rule')}`}
        </Button>
        <Button onClick={() => setProposals(null)} disabled={busy !== null}>
          Cancel
        </Button>
      </div>
      <Feedback value={feedback} />
    </section>
  );
}
