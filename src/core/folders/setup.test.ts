import { describe, expect, it } from 'vitest';
import type { FileSystem } from '../ports';
import { createSettingsRepository, type Settings } from '../settings';
import { openMigratedDatabase } from '../db';
import { setupDefaultFolders } from '.';

const HOME = '/Users/test';
const ICLOUD = `${HOME}/Library/Mobile Documents/com~apple~CloudDocs`;

/** An in-memory disk: `existing` are folders that are there, `unwritable` prefixes reject `mkdir`. */
function setup({ existing = [] as string[], unwritable = [] as string[], onboardingCompleted = false, stored = {} as Partial<Settings> } = {}) {
  const dirs = new Set<string>(existing);
  const made: string[] = [];
  const logs: string[] = [];
  const fs: Pick<FileSystem, 'exists' | 'mkdir'> = {
    exists: async (p) => dirs.has(p),
    mkdir: async (p) => {
      if (unwritable.some((prefix) => p.startsWith(prefix))) throw Object.assign(new Error(`EPERM: operation not permitted, mkdir '${p}'`), { code: 'EPERM' });
      dirs.add(p);
      made.push(p);
    },
  };
  const app = openMigratedDatabase(':memory:');
  const settings = createSettingsRepository(app, { home: HOME });
  if (onboardingCompleted) settings.updateSettings({ onboardingCompleted });
  if (Object.keys(stored).length > 0) settings.updateSettings(stored);
  const logger = { log: (level: string, message: string) => void logs.push(`${level}: ${message}`) };
  const run = () => setupDefaultFolders({ settings, fs, home: HOME, logger });
  return { run, settings, made, logs };
}

describe('setupDefaultFolders', () => {
  it('creates Filey/Inbox in iCloud Drive Documents and saves both folders', async () => {
    const t = setup({ existing: [ICLOUD] });
    const result = await t.run();
    expect(result).toEqual({ status: 'icloud', inboxPath: `${ICLOUD}/Documents/Filey/Inbox`, targetPath: `${ICLOUD}/Documents/Filey` });
    expect(t.made).toEqual([`${ICLOUD}/Documents/Filey/Inbox`]);
    expect(t.settings.getSettings()).toMatchObject({ inboxPath: result.inboxPath, targetPath: result.targetPath });
    expect(t.settings.isStored('inboxPath')).toBe(true);
    expect(t.settings.isStored('targetPath')).toBe(true);
  });

  it('fails without creating anything when iCloud Drive is off', async () => {
    const t = setup();
    const before = t.settings.getSettings();
    await expect(t.run()).resolves.toEqual({ status: 'failed', inboxPath: before.inboxPath, targetPath: before.targetPath });
    // No fake iCloud Drive folder and no local fallback.
    expect(t.made).toEqual([]);
    expect(t.settings.isStored('inboxPath')).toBe(false);
    expect(t.settings.isStored('targetPath')).toBe(false);
    expect(t.logs.join('\n')).toMatch(/warn: Folders: iCloud Drive is not available/);
  });

  it('fails and saves nothing when iCloud Drive is there but the folder cannot be created', async () => {
    const t = setup({ existing: [ICLOUD], unwritable: [ICLOUD] });
    const before = t.settings.getSettings();
    await expect(t.run()).resolves.toEqual({ status: 'failed', inboxPath: before.inboxPath, targetPath: before.targetPath });
    expect(t.made).toEqual([]);
    expect(t.settings.isStored('inboxPath')).toBe(false);
    expect(t.logs.join('\n')).toMatch(/warn: Folders: could not create Filey\/Inbox in iCloud Drive: EPERM/);
  });

  it('keeps folders that were saved before', async () => {
    const t = setup({ existing: [ICLOUD], stored: { inboxPath: '/my/inbox', targetPath: '/my/target' } });
    await expect(t.run()).resolves.toEqual({ status: 'kept', inboxPath: '/my/inbox', targetPath: '/my/target' });
    expect(t.made).toEqual([]);
  });

  it('does nothing once onboarding is completed', async () => {
    const t = setup({ existing: [ICLOUD], onboardingCompleted: true });
    expect((await t.run()).status).toBe('kept');
    expect(t.made).toEqual([]);
    expect(t.settings.isStored('inboxPath')).toBe(false);
  });

  it('keeps the setup stable on the next start of an unfinished onboarding', async () => {
    const t = setup({ existing: [ICLOUD] });
    const first = await t.run();
    const second = await t.run();
    expect(second).toEqual({ ...first, status: 'kept' });
  });
});
