import * as path from 'node:path';
import { resolveModelConfig, type AnalyzeOptions, type AnalyzeResult } from '../analyzer';
import type { ApiKeyStore } from '../api-key';
import { freePath, renderPath } from '../filer';
import { isInside } from '../history/paths';
import type { Clock, FileSystem, Logger } from '../ports';
import type { ScanService } from '../scanner';
import type { SettingsRepository } from '../settings';
import { createNameMatcher, fileNameTemplate, isPdfName } from './matcher';
import type { NameCheckOutcome, NameIssue, NameSuggestion, RenameResult, SuggestNamesOutcome } from './types';

export interface RenamerDeps {
  scans: ScanService;
  settings: Pick<SettingsRepository, 'getSettings' | 'listRules'>;
  apiKeys: Pick<ApiKeyStore, 'get'>;
  analyze: (pdf: Buffer, options: AnalyzeOptions) => Promise<AnalyzeResult>;
  fs: Pick<FileSystem, 'exists' | 'readFile' | 'rename'>;
  /** Downloads an iCloud file that is only a placeholder; resolves `ready` once the real file can be read. */
  download(realPath: string): Promise<'ready' | 'timeout' | 'gone'>;
  /** Called after a rename, so a history entry follows the file (arc42 §5.4 "Apply"). */
  onRenamed(from: string, to: string): void;
  clock: Clock;
  logger: Logger;
}

export interface Renamer {
  /** Scans the target folder again and lists the PDFs whose names do not follow the naming template. Sends nothing. */
  check(): Promise<NameCheckOutcome>;
  /** Analyzes the given files (relative paths from `check`) one after another and remembers the proposed names. */
  suggest(paths: readonly string[]): Promise<SuggestNamesOutcome>;
  /** Renames the given files to their remembered proposed names, in their folder, never overwriting. */
  apply(paths: readonly string[]): Promise<RenameResult[]>;
}

export const RENAME_MESSAGES = {
  noScan: 'Check names first.',
  notScanned: 'This file was not found by the last check. Check names again.',
  notAllowed: 'Filey only renames files in the target folder.',
  noProposal: 'There is no proposed name for this file. Suggest names again.',
  missing: 'The file is no longer there. Check names again.',
  download: 'The file could not be downloaded from iCloud.',
  read: 'The file could not be read.',
  rename: 'The file could not be renamed.',
} as const;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const folderOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const nameOf = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1);

export function createRenamer(deps: RenamerDeps): Renamer {
  const { scans, settings, fs, logger } = deps;
  /** Proposed names by relative path; only these can be applied, so the renderer never chooses a name. */
  const proposals = new Map<string, string>();
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task);
    chain = run.catch(() => undefined);
    return run;
  };

  /** The absolute path of a scanned file, if it is inside the target folder and not in the inbox. */
  const resolveFile = (root: string, rel: string): string | undefined => {
    const abs = path.resolve(root, ...rel.split('/'));
    const { inboxPath } = settings.getSettings();
    if (!isInside(abs, root) || isInside(abs, inboxPath)) return undefined;
    return abs;
  };

  async function suggestOne(root: string, rel: string, placeholder: boolean, run: (pdf: Buffer) => Promise<AnalyzeResult>): Promise<NameSuggestion> {
    const name = nameOf(rel);
    const fail = (message: string): NameSuggestion => ({ path: rel, name, status: 'failed', message });
    const abs = resolveFile(root, rel);
    if (!abs) return fail(RENAME_MESSAGES.notAllowed);
    if (placeholder || !(await fs.exists(abs))) {
      const downloaded = await deps.download(abs);
      if (downloaded === 'gone') return fail(RENAME_MESSAGES.missing);
      if (downloaded !== 'ready') return fail(RENAME_MESSAGES.download);
    }
    let data: Buffer;
    try {
      data = Buffer.from(await fs.readFile(abs));
    } catch (err) {
      logger.log('warn', `Rename: could not read ${name}: ${errorText(err)}`);
      return fail(RENAME_MESSAGES.read);
    }
    const result = await run(data);
    if (!result.ok) return fail(result.failure.message);
    // The file stays in its folder: `{category}` is its current folder, and only the file-name part is used.
    const folder = folderOf(rel);
    const category = folder === '' ? undefined : nameOf(folder);
    const rendered = renderPath(fileNameTemplate(settings.getSettings().namingTemplate), { ...result.info, category }, deps.clock.now());
    const newName = nameOf(rendered);
    if (newName.normalize('NFC') === name.normalize('NFC')) return { path: rel, name, status: 'unchanged' };
    proposals.set(rel, newName);
    return { path: rel, name, status: 'proposed', newName };
  }

  return {
    check: () =>
      serial(async () => {
        const outcome = await scans.run();
        if (!outcome.ok) return outcome;
        proposals.clear();
        const matches = createNameMatcher(settings.getSettings().namingTemplate);
        const pdfs = outcome.scan.files.filter((file) => isPdfName(file.path));
        const issues: NameIssue[] = pdfs
          .filter((file) => !matches(nameOf(file.path)))
          .map((file) => ({ path: file.path, name: nameOf(file.path), folder: folderOf(file.path), placeholder: file.placeholder }));
        logger.log('info', `Rename: ${issues.length} of ${pdfs.length} PDFs do not follow the naming template`);
        return { ok: true, issues, checked: pdfs.length, truncated: outcome.scan.truncated };
      }),

    suggest: (paths) =>
      serial(async (): Promise<SuggestNamesOutcome> => {
        const scan = scans.last();
        if (!scan) return { ok: false, reason: 'no-scan', message: RENAME_MESSAGES.noScan };
        const resolved = await resolveModelConfig(settings.getSettings(), deps.apiKeys);
        if (!resolved.ok) return resolved;
        const rules = settings.listRules();
        const run = (pdf: Buffer) => deps.analyze(pdf, { config: resolved.config, rules });
        const files = new Map(scan.files.map((file) => [file.path, file]));
        const suggestions: NameSuggestion[] = [];
        let offline: string | undefined;
        for (const rel of paths) {
          const file = files.get(rel);
          if (offline !== undefined) {
            suggestions.push({ path: rel, name: nameOf(rel), status: 'failed', message: offline });
          } else if (!file || !isPdfName(rel)) {
            suggestions.push({ path: rel, name: nameOf(rel), status: 'failed', message: RENAME_MESSAGES.notScanned });
          } else {
            const suggestion = await suggestOne(scan.root, rel, file.placeholder, async (pdf) => {
              const result = await run(pdf);
              // Without a connection the rest of the batch would fail the same way; stop sending.
              if (!result.ok && result.failure.kind === 'offline') offline = result.failure.message;
              return result;
            });
            suggestions.push(suggestion);
          }
        }
        const proposed = suggestions.filter((s) => s.status === 'proposed').length;
        logger.log('info', `Rename: proposed ${proposed} new ${proposed === 1 ? 'name' : 'names'} for ${paths.length} ${paths.length === 1 ? 'file' : 'files'}`);
        return { ok: true, suggestions };
      }),

    apply: (paths) =>
      serial(async () => {
        const scan = scans.last();
        const results: RenameResult[] = [];
        for (const rel of paths) {
          const fail = (message: string) => results.push({ path: rel, ok: false, message });
          const newName = proposals.get(rel);
          if (!scan || newName === undefined) {
            fail(RENAME_MESSAGES.noProposal);
            continue;
          }
          const src = resolveFile(scan.root, rel);
          if (!src) {
            fail(RENAME_MESSAGES.notAllowed);
            continue;
          }
          if (!(await fs.exists(src))) {
            proposals.delete(rel);
            fail(RENAME_MESSAGES.missing);
            continue;
          }
          const target = path.join(path.dirname(src), newName);
          // A change of case only: APFS sees the same file, so the free-name check would add `_2`.
          const caseOnly = target.toLowerCase() === src.toLowerCase();
          const dest = caseOnly ? target : await freePath(target, fs);
          try {
            await fs.rename(src, dest);
          } catch (err) {
            logger.log('error', `Rename: could not rename ${nameOf(rel)}: ${errorText(err)}`);
            fail(RENAME_MESSAGES.rename);
            continue;
          }
          proposals.delete(rel);
          deps.onRenamed(src, dest);
          const folder = folderOf(rel);
          const destName = path.basename(dest);
          logger.log('info', `Rename: renamed ${nameOf(rel)} to ${destName}`);
          results.push({ path: rel, ok: true, newName: destName, newPath: folder === '' ? destName : `${folder}/${destName}` });
        }
        return results;
      }),
  };
}
