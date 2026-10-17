import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openMigratedDatabase } from '../db';
import { createSettingsRepository, defaultRules, defaultSettings, SettingsValidationError } from '.';

const HOME = '/Users/test';

const setup = () => {
  const app = openMigratedDatabase(':memory:');
  return { app, repo: createSettingsRepository(app, { home: HOME }) };
};

describe('defaults on first start', () => {
  it('returns the documented settings', () => {
    const settings = setup().repo.getSettings();
    expect(settings).toEqual(defaultSettings(HOME));
    expect(settings.provider).toBe('openrouter');
    expect(settings.model).toBe('google/gemini-2.5-flash');
    expect(settings.namingTemplate).toBe('{category}/{date}_{sender}_{title}.pdf');
    expect(settings.inboxPath).toBe('/Users/test/Library/Mobile Documents/com~apple~CloudDocs/Documents/Filey/Inbox');
    expect(settings.targetPath).toBe('/Users/test/Library/Mobile Documents/com~apple~CloudDocs/Documents/Filey');
    expect(settings.autostart).toBe(false);
    expect(settings.onboardingCompleted).toBe(false);
  });

  it('returns the default rules including Unsorted', () => {
    const rules = setup().repo.listRules();
    expect(rules).toEqual(defaultRules());
    expect(rules.map((r) => r.folder)).toContain('Unsorted');
    expect(rules.map((r) => r.folder)).toContain('Insurance/Car');
  });

  it('default rules and settings pass validation', () => {
    const { repo } = setup();
    expect(() => repo.saveRules(defaultRules())).not.toThrow();
    expect(() => repo.updateSettings({})).not.toThrow();
  });
});

describe('saving unchanged rules', () => {
  it('succeeds and keeps the stored rules', () => {
    const { repo } = setup();
    const rules = repo.saveRules(defaultRules());
    expect(repo.saveRules(rules)).toEqual(rules);
    expect(repo.listRules()).toEqual(rules);
    repo.saveRules([...rules.slice(0, -1), { folder: 'Unsorted', description: 'Changed' }]);
    expect(repo.listRules().at(-1)?.description).toBe('Changed');
  });
});

describe('persistence', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('keeps settings and rules after reopening the database', () => {
    dir = mkdtempSync(join(tmpdir(), 'filey-settings-'));
    const path = join(dir, 'filey.db');
    const first = openMigratedDatabase(path);
    const repo = createSettingsRepository(first, { home: HOME });
    repo.updateSettings({ model: 'openai/gpt-4o', autostart: true, inboxPath: '/tmp/in', targetPath: '/tmp/out' });
    repo.saveRules([
      { folder: 'Unsorted', description: 'Rest' },
      { folder: 'Tax', description: 'Taxes' },
    ]);
    first.db.close();

    const reopened = openMigratedDatabase(path);
    const repo2 = createSettingsRepository(reopened, { home: HOME });
    expect(repo2.getSettings()).toEqual({
      ...defaultSettings(HOME),
      model: 'openai/gpt-4o',
      autostart: true,
      inboxPath: '/tmp/in',
      targetPath: '/tmp/out',
    });
    expect(repo2.listRules()).toEqual([
      { folder: 'Unsorted', description: 'Rest' },
      { folder: 'Tax', description: 'Taxes' },
    ]);
    reopened.db.close();
  });

  it('merges a patch over earlier changes', () => {
    const { repo } = setup();
    repo.updateSettings({ model: 'a/b' });
    repo.updateSettings({ debugLogging: true });
    expect(repo.getSettings()).toMatchObject({ model: 'a/b', debugLogging: true });
  });

  it('falls back to defaults for corrupt stored values', () => {
    const { app, repo } = setup();
    app.settings.set('model', '{not json');
    app.settings.set('autostart', '"yes"');
    expect(repo.getSettings()).toEqual(defaultSettings(HOME));
  });
});

describe('validation', () => {
  const rejects = (fn: () => unknown, message: RegExp) => {
    expect(fn).toThrow(SettingsValidationError);
    expect(fn).toThrow(message);
  };

  it('rejects a target folder equal to the inbox and stores nothing', () => {
    const { repo } = setup();
    rejects(() => repo.updateSettings({ model: 'x/y', targetPath: defaultSettings(HOME).inboxPath + '/' }), /must not be the inbox/);
    expect(repo.getSettings().model).toBe('google/gemini-2.5-flash');
  });

  it('allows a target folder below the inbox', () => {
    const { repo } = setup();
    const inbox = repo.getSettings().inboxPath;
    expect(repo.updateSettings({ targetPath: `${inbox}/Filed` }).targetPath).toBe(`${inbox}/Filed`);
  });

  it('rejects an inbox change that makes it equal to the target', () => {
    const { repo } = setup();
    rejects(() => repo.updateSettings({ inboxPath: repo.getSettings().targetPath }), /must not be the inbox/);
  });

  it('rejects unknown placeholders in the naming template', () => {
    const { repo } = setup();
    rejects(() => repo.updateSettings({ namingTemplate: '{category}/{year}_{title}.pdf' }), /Unknown placeholder \{year\}/);
    expect(repo.updateSettings({ namingTemplate: '{date}_{title}.pdf' }).namingTemplate).toBe('{date}_{title}.pdf');
  });

  it('rejects empty values and unbalanced braces', () => {
    const { repo } = setup();
    rejects(() => repo.updateSettings({ namingTemplate: ' ' }), /must not be empty/);
    rejects(() => repo.updateSettings({ namingTemplate: '{title.pdf' }), /unbalanced/);
    rejects(() => repo.updateSettings({ model: '' }), /model/);
    rejects(() => repo.updateSettings({ inboxPath: '' }), /inbox/);
  });

  it('names the field (and rule) a validation error is about', () => {
    const { repo } = setup();
    const errorOf = (fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        return err as SettingsValidationError;
      }
      throw new Error('expected an error');
    };
    expect(errorOf(() => repo.updateSettings({ model: ' ' })).field).toBe('model');
    expect(errorOf(() => repo.updateSettings({ namingTemplate: '{x}' })).field).toBe('namingTemplate');
    expect(errorOf(() => repo.updateSettings({ targetPath: repo.getSettings().inboxPath })).field).toBe('targetPath');
    const rule = errorOf(() => repo.saveRules([{ folder: 'Unsorted', description: 'Rest' }, { folder: 'A', description: ' ' }]));
    expect([rule.field, rule.ruleIndex]).toEqual(['rules', 1]);
    expect(errorOf(() => repo.saveRules([{ folder: 'A', description: 'a' }])).field).toBe('rules');
  });

  it('rejects removing the Unsorted rule', () => {
    const { repo } = setup();
    rejects(() => repo.saveRules([{ folder: 'Tax', description: 'Taxes' }]), /"Unsorted" cannot be removed/);
    expect(repo.listRules()).toEqual(defaultRules());
  });

  it('rejects duplicate, empty and escaping folder rules', () => {
    const { repo } = setup();
    const unsorted = { folder: 'Unsorted', description: 'Rest' };
    rejects(() => repo.saveRules([unsorted, { folder: 'A', description: 'a' }, { folder: 'a', description: 'b' }]), /twice/);
    rejects(() => repo.saveRules([unsorted, { folder: 'A', description: ' ' }]), /needs a description/);
    rejects(() => repo.saveRules([unsorted, { folder: '../Out', description: 'x' }]), /Invalid folder name/);
    rejects(() => repo.saveRules([unsorted, { folder: '/abs', description: 'x' }]), /Invalid folder name/);
  });

  it('rejects a rule that files into the inbox, which lies inside the default target folder', () => {
    const { repo } = setup();
    const unsorted = { folder: 'Unsorted', description: 'Rest' };
    const clash = () => repo.saveRules([unsorted, { folder: 'inbox', description: 'Everything unread' }]);
    rejects(clash, /is the inbox folder/);
    expect(clash).toThrow(expect.objectContaining({ field: 'rules', ruleIndex: 1 }));
    // A subfolder of the inbox is not watched, so it is fine.
    expect(() => repo.saveRules([unsorted, { folder: 'Inbox/Archive', description: 'Old scans' }])).not.toThrow();
  });
});
