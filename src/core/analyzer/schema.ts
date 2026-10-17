import { z } from 'zod';
import { FALLBACK_FOLDER, type FolderRule } from '../settings';

export const MAX_SENDER_LENGTH = 10;

/** Folder names the model may choose from: the configured ones, unique, plus the fallback. */
export function folderNames(rules: readonly FolderRule[]): [string, ...string[]] {
  const names = new Set(rules.map((rule) => rule.folder));
  names.add(FALLBACK_FOLDER);
  return [...names] as [string, ...string[]];
}

/**
 * Result schema from arc42 §5.2; a sender longer than MAX_SENDER_LENGTH is accepted (the prompt asks for a short
 * one, the Filer cuts it). `category` is restricted to the configured folders at runtime. */
export function createDocumentInfoSchema(rules: readonly FolderRule[]) {
  return z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').nullable(),
    sender: z.string().nullable(),
    title: z.string().nullable(),
    category: z.enum(folderNames(rules)),
  });
}

export type DocumentInfo = z.infer<ReturnType<typeof createDocumentInfoSchema>>;
