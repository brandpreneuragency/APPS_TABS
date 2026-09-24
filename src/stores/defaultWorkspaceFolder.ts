/** Dexie `settings` key for the folder every empty workspace should open with. */
export const DEFAULT_WORKSPACE_FOLDER_SETTING_KEY = 'defaultWorkspaceFolder';

/** True for an auto-generated tab title, including legacy `Workspace N` tabs. */
export function isGeneratedWorkspaceName(name: string): boolean {
  return /^(?:Doc|Workspace) \d+$/.test(name);
}

/** Normalize a stored or picked folder path. Empty / non-string values become null. */
export function normalizeDefaultWorkspaceFolder(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\\/g, '/');
  return trimmed.length > 0 ? trimmed : null;
}

/** Apply the default only when the workspace has no attached folder. */
export function workspaceNeedsDefaultFolder(
  liveFolders: ReadonlyArray<{ path: string }>,
  persistedRefs: ReadonlyArray<{ path: string }>,
  defaultPath: string | null,
): defaultPath is string {
  if (!defaultPath) return false;
  return liveFolders.length === 0 && persistedRefs.length === 0;
}
