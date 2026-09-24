import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { db } from '../db';
import type { CodexModel } from './types';

const SETTING_KEY = 'codexModelVisibility';

export type CodexModelVisibility = {
  allHidden: boolean;
  hiddenModelIds: string[];
};

const defaultVisibility = (): CodexModelVisibility => ({ allHidden: false, hiddenModelIds: [] });

function parseVisibility(value: unknown): CodexModelVisibility {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultVisibility();
  const candidate = value as Record<string, unknown>;
  return {
    allHidden: candidate.allHidden === true,
    hiddenModelIds: Array.isArray(candidate.hiddenModelIds)
      ? [...new Set(candidate.hiddenModelIds.filter((id): id is string => typeof id === 'string'))]
      : [],
  };
}

export async function loadCodexModelVisibility(): Promise<CodexModelVisibility> {
  return parseVisibility((await db.settings.get(SETTING_KEY))?.value);
}

export function useCodexModelVisibility(): CodexModelVisibility | null {
  const [visibility, setVisibility] = useState<CodexModelVisibility | null>(null);

  useEffect(() => {
    const subscription = liveQuery(() => loadCodexModelVisibility()).subscribe({
      next: setVisibility,
      error: () => setVisibility(defaultVisibility()),
    });
    return () => subscription.unsubscribe();
  }, []);

  return visibility;
}

export function visibleCodexModels(models: CodexModel[], visibility: CodexModelVisibility): CodexModel[] {
  if (visibility.allHidden) return [];
  const hidden = new Set(visibility.hiddenModelIds);
  return models.filter((model) => !hidden.has(model.id));
}

export async function setCodexModelVisible(modelId: string, visible: boolean, allModelIds: string[]): Promise<void> {
  const modelIds = [...new Set(allModelIds)];
  await db.transaction('rw', db.settings, async () => {
    const current = await loadCodexModelVisibility();
    if (visible) {
      const hiddenModelIds = current.allHidden
        ? modelIds.filter((id) => id !== modelId)
        : current.hiddenModelIds.filter((id) => id !== modelId);
      await db.settings.put({ key: SETTING_KEY, value: { allHidden: false, hiddenModelIds } });
      return;
    }

    if (current.allHidden) return;
    const hiddenModelIds = [...new Set([...current.hiddenModelIds, modelId])];
    if (modelIds.length > 0 && modelIds.every((id) => hiddenModelIds.includes(id))) {
      await db.settings.put({ key: SETTING_KEY, value: { allHidden: true, hiddenModelIds: [] } });
      return;
    }
    await db.settings.put({ key: SETTING_KEY, value: { allHidden: false, hiddenModelIds } });
  });
}

export async function setAllCodexModelsVisible(visible: boolean): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    await db.settings.put({ key: SETTING_KEY, value: { allHidden: !visible, hiddenModelIds: [] } });
  });
}
