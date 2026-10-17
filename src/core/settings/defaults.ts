import { homedir } from 'node:os';
import { join } from 'node:path';
import { foldersIn, iCloudDriveRoot } from '../folders/setup';
import { DEFAULT_MODEL, DEFAULT_NAMING_TEMPLATE, FALLBACK_FOLDER, type FolderRule, type Settings } from './types';

export { DEFAULT_MODEL, DEFAULT_NAMING_TEMPLATE };

/**
 * Defaults: `Documents/Filey` in iCloud Drive with the inbox in `Documents/Filey/Inbox`. At the first launch the folders
 * are created (`setupDefaultFolders`). `home` is injectable
 * so tests do not depend on the machine.
 */
export function defaultSettings(home: string = homedir()): Settings {
  return {
    provider: 'openrouter',
    model: DEFAULT_MODEL,
    ...foldersIn(join(iCloudDriveRoot(home), 'Documents')),
    namingTemplate: DEFAULT_NAMING_TEMPLATE,
    autostart: false,
    debugLogging: false,
    onboardingCompleted: false,
  };
}

export function defaultRules(): FolderRule[] {
  return [
    { folder: 'Insurance/Car', description: 'Everything about my car insurance, including contract, invoices and claims' },
    { folder: 'Health/Health insurance', description: 'Letters from my health insurer' },
    { folder: 'Finance/Taxes', description: 'Tax returns, tax assessments and correspondence with the tax office' },
    { folder: 'Finance/Banking', description: 'Bank statements, account and credit card documents' },
    { folder: 'Housing', description: 'Rental or purchase contracts, utilities and other documents about my home' },
    { folder: 'Work', description: 'Employment contracts, payslips and other documents from my employer' },
    { folder: FALLBACK_FOLDER, description: 'Documents that match no other folder' },
  ];
}
