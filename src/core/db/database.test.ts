import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BUNDLED_MIGRATIONS_PATH, renderBundledMigrations } from '../../../scripts/bundle-migrations.mts';
import {
  appliedMigrations,
  createOrm,
  migrate,
  MIGRATIONS_TABLE,
  openDatabase,
  openMigratedDatabase,
  type Database,
} from '.';
import { BUNDLED_MIGRATIONS } from './migrations.generated';

const tableNames = (db: Database) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(
    (r) => r.name,
  );

const NOW = '2026-01-01T00:00:00.000Z';

describe('migrations', () => {
  it('bundles exactly the migrations in drizzle/ (run `npm run db:generate`)', () => {
    expect(readFileSync(BUNDLED_MIGRATIONS_PATH, 'utf8')).toBe(renderBundledMigrations());
  });

  it('creates the schema on a fresh database and records the migrations', () => {
    const db = openDatabase(':memory:');
    migrate(db, createOrm(db));
    expect(tableNames(db)).toEqual([MIGRATIONS_TABLE, 'processed_imports', 'settings', 'unprocessed_imports']);
    expect(appliedMigrations(db)).toEqual(BUNDLED_MIGRATIONS.map((m) => m.name));
  });

  it('is idempotent', () => {
    const db = openDatabase(':memory:');
    migrate(db, createOrm(db));
    db.prepare("INSERT INTO settings (key, value) VALUES ('a', 'b')").run();
    migrate(db, createOrm(db));
    expect(db.prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual({ n: 1 });
    expect(appliedMigrations(db)).toHaveLength(BUNDLED_MIGRATIONS.length);
  });

  it('applies only pending migrations and rolls back a failing one', () => {
    const db = openDatabase(':memory:');
    const orm = createOrm(db);
    migrate(db, orm);
    const extra = { sql: ['CREATE TABLE extra (x INTEGER)'], bps: true, folderMillis: Date.now(), hash: 'x', name: '29990101000000_extra' };
    migrate(db, orm, [...BUNDLED_MIGRATIONS, extra]);
    expect(tableNames(db)).toContain('extra');

    const bad = { sql: ['CREATE TABLE b (x INTEGER)', 'INSERT INTO missing VALUES (1)'], bps: true, folderMillis: Date.now() + 1, hash: 'y', name: '29990102000000_bad' };
    expect(() => migrate(db, orm, [...BUNDLED_MIGRATIONS, extra, bad])).toThrow(/migration failed/);
    expect(tableNames(db)).not.toContain('b');
    expect(appliedMigrations(db)).toHaveLength(BUNDLED_MIGRATIONS.length + 1);
  });

  it('refuses a database from a newer app version', () => {
    const db = openDatabase(':memory:');
    migrate(db, createOrm(db));
    db.prepare(`INSERT INTO ${MIGRATIONS_TABLE} (hash, created_at, name) VALUES ('z', 0, '29990101000000_future')`).run();
    expect(() => migrate(db, createOrm(db))).toThrow(/newer than this app supports/);
  });
});

describe('file database', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('creates the file and keeps data across reopen', () => {
    dir = mkdtempSync(join(tmpdir(), 'filey-db-'));
    const file = join(dir, 'filey.db');
    const first = openMigratedDatabase(file);
    first.settings.set('model', 'x');
    first.db.close();
    expect(existsSync(file)).toBe(true);
    const second = openMigratedDatabase(file);
    expect(second.settings.get('model')).toBe('x');
    second.db.close();
  });

});

describe('tables', () => {
  const open = () => openMigratedDatabase(':memory:');

  it('round-trips settings', () => {
    const { settings } = open();
    expect(settings.get('k')).toBeUndefined();
    settings.set('k', 'v1');
    settings.set('k', 'v2');
    settings.set('other', 'o');
    expect(settings.get('k')).toBe('v2');
    expect(settings.all()).toEqual({ k: 'v2', other: 'o' });
    settings.delete('k');
    expect(settings.get('k')).toBeUndefined();
  });

  it('upserts inbox files by path and keeps id and creation time', () => {
    const { imports } = open();
    const first = imports.unprocessed.upsert({ inboxPath: '/in/a.pdf', fileName: 'a.pdf', contentHash: 'h', status: 'pending', now: NOW });
    expect(first).toMatchObject({ status: 'pending', error: null, duplicateOfId: null, createdAt: NOW, updatedAt: NOW });
    const later = '2026-01-02T00:00:00.000Z';
    const failed = imports.unprocessed.upsert({ inboxPath: '/in/a.pdf', fileName: 'a.pdf', contentHash: 'h', status: 'failed', error: 'boom', now: later });
    expect(failed).toMatchObject({ id: first.id, status: 'failed', error: 'boom', createdAt: NOW, updatedAt: later });
    const again = imports.unprocessed.upsert({ inboxPath: '/in/a.pdf', fileName: 'a.pdf', contentHash: 'h', status: 'pending', now: later });
    expect(again.error).toBeNull();
    expect(imports.unprocessed.getByPath('/in/a.pdf')?.id).toBe(first.id);
    expect(imports.unprocessed.getById(first.id)?.status).toBe('pending');
    expect(imports.unprocessed.deleteByPath('/in/a.pdf')?.id).toBe(first.id);
    expect(imports.unprocessed.deleteByPath('/in/a.pdf')).toBeUndefined();
    expect(imports.unprocessed.list()).toEqual([]);
  });

  it('files an inbox file in one step and finds it by content hash', () => {
    const { db, imports } = open();
    imports.unprocessed.upsert({ inboxPath: '/in/a.pdf', fileName: 'a.pdf', contentHash: 'abc', status: 'pending', now: NOW });
    const filed = imports.markFiled('/in/a.pdf', { contentHash: 'abc', originalName: 'a.pdf', targetPath: '/t/x.pdf', sender: 'ACME', filedAt: NOW });
    expect(filed).toMatchObject({ contentHash: 'abc', targetPath: '/t/x.pdf', sender: 'ACME', title: null });
    expect(imports.unprocessed.list()).toEqual([]);
    imports.markFiled('/in/b.pdf', { contentHash: 'def', originalName: 'b.pdf', targetPath: '/t/y.pdf', filedAt: NOW });
    expect(imports.processed.findByContentHash('abc').map((r) => r.id)).toEqual([filed.id]);
    expect(imports.processed.findByContentHash('nope')).toEqual([]);
    expect(imports.processed.listRecent(1).map((r) => r.contentHash)).toEqual(['def']);
    expect(imports.processed.getById(filed.id)?.targetPath).toBe('/t/x.pdf');

    const plan = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM processed_imports WHERE content_hash = ?').all('abc') as { detail: string }[];
    expect(plan.map((p) => p.detail).join(' ')).toContain('idx_processed_imports_content_hash');
  });

  it('clears the duplicate link when the original leaves the history', () => {
    const { imports } = open();
    const original = imports.markFiled('/in/a.pdf', { contentHash: 'h', originalName: 'a.pdf', targetPath: '/t/a.pdf', filedAt: NOW });
    imports.unprocessed.upsert({ inboxPath: '/in/b.pdf', fileName: 'b.pdf', contentHash: 'h', status: 'duplicate', duplicateOfId: original.id, now: NOW });
    imports.processed.delete(original.id);
    expect(imports.processed.getById(original.id)).toBeUndefined();
    expect(imports.unprocessed.getByPath('/in/b.pdf')?.duplicateOfId).toBeNull();
  });

  it('rejects an unknown inbox status', () => {
    const { imports } = open();
    expect(() => imports.unprocessed.upsert({ inboxPath: '/x', fileName: 'x', contentHash: 'h', status: 'bogus' as never, now: NOW })).toThrow();
  });
});
