import { describe, expect, it } from 'vitest';
import { displayPath, effectiveModel, fromDrafts, modelFieldValue, newDraft, rulesChanged, toDrafts } from './format';

describe('displayPath', () => {
  it('shortens iCloud Drive paths', () => {
    expect(displayPath('/Users/me/Library/Mobile Documents/com~apple~CloudDocs/Documents/Inbox')).toBe('iCloud Drive/Documents/Inbox');
    expect(displayPath('/Users/me/Library/Mobile Documents/com~apple~CloudDocs')).toBe('iCloud Drive');
  });

  it('shows other home paths with ~ and leaves the rest alone', () => {
    expect(displayPath('/Users/me/Documents/Scans')).toBe('~/Documents/Scans');
    expect(displayPath('/Users/me/Library/Mobile Documents/com~apple~CloudDocsX/a')).toBe('~/Library/Mobile Documents/com~apple~CloudDocsX/a');
    expect(displayPath('/Volumes/Archive/Scans')).toBe('/Volumes/Archive/Scans');
  });
});

describe('model field', () => {
  it('uses the default model for an empty field and shows the default as empty', () => {
    expect(effectiveModel('  ')).toBe('google/gemini-2.5-flash');
    expect(effectiveModel(' openai/gpt-4o ')).toBe('openai/gpt-4o');
    expect(modelFieldValue('google/gemini-2.5-flash')).toBe('');
    expect(modelFieldValue('openai/gpt-4o')).toBe('openai/gpt-4o');
  });
});

describe('rule drafts', () => {
  const saved = [
    { folder: 'Tax', description: 'Taxes' },
    { folder: 'Unsorted', description: 'Rest' },
  ];

  it('marks the fallback, trims on save and detects changes', () => {
    const drafts = toDrafts(saved);
    expect(drafts.map((d) => d.fallback)).toEqual([false, true]);
    expect(new Set(drafts.map((d) => d.id)).size).toBe(2);
    expect(rulesChanged(drafts, saved)).toBe(false);

    const edited = [{ ...drafts[0]!, folder: ' Tax ' }, drafts[1]!];
    expect(fromDrafts(edited)).toEqual(saved);
    expect(rulesChanged(edited, saved)).toBe(false);
    expect(rulesChanged([...drafts, newDraft()], saved)).toBe(true);
    expect(rulesChanged([{ ...drafts[0]!, description: 'Other' }, drafts[1]!], saved)).toBe(true);
  });
});
