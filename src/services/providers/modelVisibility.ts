import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { db } from '../db';

export const providerIds = ['codex', 'grok', 'commandCode', 'openCode'] as const;

export type ProviderId = typeof providerIds[number];

const visibilitySettingKeys: Record<ProviderId, string> = {
  codex: 'codexModelVisibility',
  grok: 'grokModelVisibility',
  commandCode: 'commandCodeModelVisibility',
  openCode: 'openCodeModelVisibility',
};

export type ProviderModelVisibility = {
  allHidden: boolean;
  hiddenModelIds: string[];
};

export type ProviderModel = {
  id: string;
};

const defaultVisibility = (): ProviderModelVisibility => ({ allHidden: false, hiddenModelIds: [] });

function parseVisibility(value: unknown): ProviderModelVisibility {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultVisibility();
  const candidate = value as Record<string, unknown>;
  return {
    allHidden: candidate.allHidden === true,
    hiddenModelIds: Array.isArray(candidate.hiddenModelIds)
      ? [...new Set(candidate.hiddenModelIds.filter((id): id is string => typeof id === 'string'))]
      : [],
  };
}

export function providerModelVisibilitySettingKey(providerId: ProviderId): string {
  return visibilitySettingKeys[providerId];
}

export async function loadProviderModelVisibility(providerId: ProviderId): Promise<ProviderModelVisibility> {
  const row = await db.settings.get(providerModelVisibilitySettingKey(providerId));
  return parseVisibility(row?.value);
}

export function useProviderModelVisibility(providerId: ProviderId): ProviderModelVisibility | null {
  const [visibility, setVisibility] = useState<ProviderModelVisibility | null>(null);

  useEffect(() => {
    const subscription = liveQuery(() => loadProviderModelVisibility(providerId)).subscribe({
      next: setVisibility,
      error: () => setVisibility(defaultVisibility()),
    });
    return () => subscription.unsubscribe();
  }, [providerId]);

  return visibility;
}

export function visibleProviderModels<T extends ProviderModel>(models: T[], visibility: ProviderModelVisibility): T[] {
  if (visibility.allHidden) return [];
  const hidden = new Set(visibility.hiddenModelIds);
  return models.filter((model) => !hidden.has(model.id));
}

export async function setProviderModelVisible(
  providerId: ProviderId,
  modelId: string,
  visible: boolean,
  allModelIds: string[],
): Promise<void> {
  const modelIds = [...new Set(allModelIds)];
  const settingKey = providerModelVisibilitySettingKey(providerId);
  await db.transaction('rw', db.settings, async () => {
    const current = await loadProviderModelVisibility(providerId);
    if (visible) {
      const hiddenModelIds = current.allHidden
        ? modelIds.filter((id) => id !== modelId)
        : current.hiddenModelIds.filter((id) => id !== modelId);
      await db.settings.put({ key: settingKey, value: { allHidden: false, hiddenModelIds } });
      return;
    }

    if (current.allHidden) return;
    const hiddenModelIds = [...new Set([...current.hiddenModelIds, modelId])];
    if (modelIds.length > 0 && modelIds.every((id) => hiddenModelIds.includes(id))) {
      await db.settings.put({ key: settingKey, value: { allHidden: true, hiddenModelIds: [] } });
      return;
    }
    await db.settings.put({ key: settingKey, value: { allHidden: false, hiddenModelIds } });
  });
}

export async function setAllProviderModelsVisible(providerId: ProviderId, visible: boolean): Promise<void> {
  const settingKey = providerModelVisibilitySettingKey(providerId);
  await db.transaction('rw', db.settings, async () => {
    await db.settings.put({ key: settingKey, value: { allHidden: !visible, hiddenModelIds: [] } });
  });
}
