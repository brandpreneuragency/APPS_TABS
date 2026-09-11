import { isNameTaken, normalizeTreeName } from '../../stores/taskTreeNames';

export type CreateProjectNameResult =
  | { status: 'empty' }
  | { status: 'duplicate' }
  | { status: 'ok'; name: string };

export function resolveCreateProjectName(
  rawName: string,
  existingNames: readonly string[],
): CreateProjectNameResult {
  const name = normalizeTreeName(rawName);
  if (!name) return { status: 'empty' };
  if (isNameTaken(name, existingNames)) return { status: 'duplicate' };
  return { status: 'ok', name };
}
