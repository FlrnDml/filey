export { scanFolder, type DirEntry, type ScanDeps, type ScanFileSystem, type ScanOptions } from './scan';
export { createScanService, SCAN_MESSAGES, type ScanOutcome, type ScanService, type ScanServiceDeps } from './service';
export { buildFolderTree, countUnmapped, folderKey, type FolderTreeNode } from './tree';
export { defaultDescription, proposeRules, upsertRules, type RuleProposal } from './mapping';
export * from './types';
