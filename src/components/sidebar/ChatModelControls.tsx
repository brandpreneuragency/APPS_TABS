import { useCallback, useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ChatProviderId } from '../../types';
import type { CodexModel } from '../../services/codex/types';
import { useCodexService } from '../../services/codex/useCodexService';
import { useCodexModelVisibility, visibleCodexModels } from '../../services/codex/modelVisibility';
import { probeCliProvider, type CliProviderId, type CliProviderModel, type CliProviderProbe } from '../../services/providers/desktopClient';
import { useProviderModelVisibility, visibleProviderModels } from '../../services/providers/modelVisibility';
import { cliReasoningEffortSettingKey } from '../../services/providers/reasoningEffort';
import { mockProviderModels, type MockProviderId } from '../../services/providers/mockProviders';
import { isTauriRuntime } from '../../services/runtime';
import { db } from '../../services/db';
import { useUIStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import './ChatModelControls.css';

const providers: Array<{ id: ChatProviderId; name: string }> = [
  { id: 'codex', name: 'Codex' },
  { id: 'grok', name: 'Grok' },
  { id: 'commandCode', name: 'Command Code' },
  { id: 'openCode', name: 'OpenCode' },
  { id: 'mockEcho', name: 'Mock Echo' },
  { id: 'mockTools', name: 'Mock Tools' },
];
const cliProviderIds: CliProviderId[] = ['grok', 'commandCode', 'openCode'];

function isCliProviderId(id: ChatProviderId): id is CliProviderId {
  return id === 'grok' || id === 'commandCode' || id === 'openCode';
}

function isMockProviderId(id: ChatProviderId): id is MockProviderId {
  return id === 'mockEcho' || id === 'mockTools';
}

type ChatModel = CodexModel | CliProviderModel;
type Panel = 'models' | 'reasoning' | 'options' | null;

interface ChatModelControlsProps {
  providerId: ChatProviderId;
  providerLocked?: boolean;
  switchingLocked?: boolean;
  threadId: string;
  workspaceId?: string | null;
  onSelectModel: (providerId: ChatProviderId, modelId: string) => Promise<void>;
}

function preferredModel(models: ChatModel[], modelId: string): ChatModel | undefined {
  return models.find((model) => model.id === modelId)
    ?? models.find((model) => model.isDefault)
    ?? models[0];
}

/** One catalogue for every local provider, with the selected model's direct reasoning control. */
export function ChatModelControls({ providerId, providerLocked = false, switchingLocked = false, threadId, workspaceId, onSelectModel }: ChatModelControlsProps) {
  const { t } = useTranslation();
  const { connection, models: codexModels, activeRunId } = useCodexService();
  const codexVisibility = useCodexModelVisibility();
  const grokVisibility = useProviderModelVisibility('grok');
  const commandCodeVisibility = useProviderModelVisibility('commandCode');
  const openCodeVisibility = useProviderModelVisibility('openCode');
  const mockEchoVisibility = useProviderModelVisibility('mockEcho');
  const mockToolsVisibility = useProviderModelVisibility('mockTools');
  const openSettings = useUIStore((state) => state.openSettings);
  const hasConnectedFolder = useWorkspaceStore((state) => Boolean(state.workspaces
    .find((workspace) => workspace.id === workspaceId)?.connectedFolders[0]?.path));

  const [modelIds, setModelIds] = useState<Record<ChatProviderId, string>>({ codex: '', grok: '', commandCode: '', openCode: '', mockEcho: '', mockTools: '' });
  const [effort, setEffort] = useState('');
  const [cliEffortPreference, setCliEffortPreference] = useState<{ key: string; value: string }>({ key: '', value: '' });
  const [access, setAccess] = useState<'readOnly' | 'workspaceWrite'>('readOnly');
  const [accessLocked, setAccessLocked] = useState(false);
  const [probes, setProbes] = useState<Partial<Record<CliProviderId, CliProviderProbe>>>({});
  const [probeErrors, setProbeErrors] = useState<Partial<Record<CliProviderId, boolean>>>({});
  const [loading, setLoading] = useState<Partial<Record<CliProviderId, boolean>>>({});
  const [openPanel, setOpenPanel] = useState<Panel>(null);
  const [search, setSearch] = useState('');
  const [selectionError, setSelectionError] = useState('');
  const [selecting, setSelecting] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const reasoningButtonRef = useRef<HTMLButtonElement>(null);
  const optionsButtonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const attemptedRef = useRef(new Set<CliProviderId>());
  const inFlightRef = useRef(new Map<CliProviderId, Promise<void>>());
  const mountedRef = useRef(true);
  const desktop = isTauriRuntime();

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const subscription = liveQuery(async () => {
      const rows = await Promise.all([
        db.settings.get('codexModelId'), db.settings.get('providerModelId:grok'),
        db.settings.get('providerModelId:commandCode'), db.settings.get('providerModelId:openCode'),
        db.settings.get('providerModelId:mockEcho'), db.settings.get('providerModelId:mockTools'),
        db.settings.get('codexEffort'),
      ]);
      return {
        modelIds: {
          codex: typeof rows[0]?.value === 'string' ? rows[0].value : '',
          grok: typeof rows[1]?.value === 'string' ? rows[1].value : '',
          commandCode: typeof rows[2]?.value === 'string' ? rows[2].value : '',
          openCode: typeof rows[3]?.value === 'string' ? rows[3].value : '',
          mockEcho: typeof rows[4]?.value === 'string' ? rows[4].value : '',
          mockTools: typeof rows[5]?.value === 'string' ? rows[5].value : '',
        },
        effort: typeof rows[6]?.value === 'string' ? rows[6].value : '',
      };
    }).subscribe({
      next: (preferences) => { setModelIds(preferences.modelIds); setEffort(preferences.effort); },
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let current = true;
    void Promise.all([db.settings.get('codexPermissionProfile'), threadId ? db.codexSessions.get(threadId) : undefined])
      .then(([preference, session]) => {
        if (!current) return;
        setAccess(session ? session.permissionProfile ?? 'readOnly'
          : preference?.value === 'workspaceWrite' ? 'workspaceWrite' : 'readOnly');
        setAccessLocked(Boolean(session));
      });
    return () => { current = false; };
  }, [threadId, activeRunId]);

  const probeOne = useCallback((id: CliProviderId): Promise<void> => {
    const inFlight = inFlightRef.current.get(id);
    if (inFlight) return inFlight;
    if (!desktop || attemptedRef.current.has(id)) return Promise.resolve();
    attemptedRef.current.add(id);
    setLoading((previous) => ({ ...previous, [id]: true }));
    const request = probeCliProvider(id).then((probe) => {
      if (mountedRef.current) {
        setProbes((previous) => ({ ...previous, [id]: probe }));
        setProbeErrors((previous) => ({ ...previous, [id]: false }));
      }
    }).catch(() => {
      if (mountedRef.current) {
        setProbeErrors((previous) => ({ ...previous, [id]: true }));
      }
    }).finally(() => {
      inFlightRef.current.delete(id);
      if (mountedRef.current) setLoading((previous) => ({ ...previous, [id]: false }));
    });
    inFlightRef.current.set(id, request);
    return request;
  }, [desktop]);

  useEffect(() => {
    if (isCliProviderId(providerId)) void probeOne(providerId);
  }, [providerId, probeOne]);

  useEffect(() => {
    if (openPanel !== 'models') return;
    let active = true;
    const order = isCliProviderId(providerId) ? [providerId, ...cliProviderIds.filter((id) => id !== providerId)] : cliProviderIds;
    void (async () => {
      for (const id of order) {
        if (!active) break;
        await probeOne(id);
      }
    })();
    return () => { active = false; };
  }, [openPanel, providerId, probeOne]);

  useEffect(() => {
    if (openPanel !== 'models') return;
    searchRef.current?.focus();
  }, [openPanel]);

  useEffect(() => {
    if (!openPanel) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!controlsRef.current?.contains(event.target as Node)) setOpenPanel(null);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [openPanel]);

  const closePanel = () => {
    const target = openPanel === 'reasoning' ? reasoningButtonRef
      : openPanel === 'options' ? optionsButtonRef : modelButtonRef;
    target.current?.focus();
    setOpenPanel(null);
  };

  const visibilityByProvider = { grok: grokVisibility, commandCode: commandCodeVisibility, openCode: openCodeVisibility, mockEcho: mockEchoVisibility, mockTools: mockToolsVisibility };
  const catalogue = providers.map((provider) => {
    let models: ChatModel[] = [];
    if (provider.id === 'codex') {
      if (connection && codexVisibility) models = visibleCodexModels(codexModels, codexVisibility);
    } else if (isMockProviderId(provider.id)) {
      const visibility = visibilityByProvider[provider.id];
      if (visibility) models = visibleProviderModels(mockProviderModels[provider.id], visibility);
    } else if (isCliProviderId(provider.id)) {
      const probe = probes[provider.id];
      const visibility = visibilityByProvider[provider.id];
      if (probe?.installed && visibility) models = visibleProviderModels(probe.models, visibility);
    }
    return { ...provider, models };
  });
  const currentProvider = catalogue.find((provider) => provider.id === providerId) ?? catalogue[0];
  const chosen = preferredModel(currentProvider.models, modelIds[providerId]);
  const chosenName = chosen?.displayName ?? t('cliChat.setup');
  const cliEffortKey = providerId !== 'codex' && chosen
    ? cliReasoningEffortSettingKey(providerId, chosen.id) : null;
  const savedEffort = providerId === 'codex' ? effort
    : cliEffortPreference.key === cliEffortKey ? cliEffortPreference.value : '';
  const selectedEffort = chosen?.reasoningEfforts.includes(savedEffort) ? savedEffort : '';
  const effortChoices = chosen?.reasoningEfforts ?? [];
  const selectedAccess = !accessLocked && !hasConnectedFolder ? 'readOnly' : access;
  const accessHint = accessLocked ? t('codex.accessLocked')
    : !hasConnectedFolder ? t('codex.connectFolderForCoding') : undefined;
  const query = search.trim().toLocaleLowerCase();
  const filtered = catalogue.map((provider) => ({
    ...provider,
    models: provider.models.filter((model) => !query
      || `${provider.name} ${model.displayName} ${model.id}`.toLocaleLowerCase().includes(query)),
  }));
  const matchedCount = filtered.reduce((count, provider) => count + provider.models.length, 0);

  useEffect(() => {
    if (!cliEffortKey) return;
    const subscription = liveQuery(async () => {
      const row = await db.settings.get(cliEffortKey);
      return typeof row?.value === 'string' ? row.value : '';
    }).subscribe({
      next: (value) => setCliEffortPreference({ key: cliEffortKey, value }),
      error: () => setCliEffortPreference({ key: cliEffortKey, value: '' }),
    });
    return () => subscription.unsubscribe();
  }, [cliEffortKey]);

  const selectModel = async (selectedProvider: ChatProviderId, modelId: string) => {
    if (selecting || providerLocked || switchingLocked) return;
    setSelecting(true);
    setSelectionError('');
    try {
      await onSelectModel(selectedProvider, modelId);
      setModelIds((previous) => ({ ...previous, [selectedProvider]: modelId }));
      if (selectedProvider === 'codex' && modelIds.codex !== modelId) setEffort('');
      closePanel();
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : t('cliChat.requestFailed'));
    } finally {
      if (mountedRef.current) setSelecting(false);
    }
  };

  return <div ref={controlsRef} className="chat-model-controls" onKeyDown={(event) => {
    if (event.key === 'Escape' && openPanel) {
      event.preventDefault();
      event.stopPropagation();
      closePanel();
    }
  }}>
    <button ref={modelButtonRef} type="button" className="chat-model-trigger"
      aria-label={`${t('cliChat.model')}: ${currentProvider.name} / ${chosenName}`}
      aria-expanded={openPanel === 'models'} aria-controls="chat-composer-models"
      title={`${currentProvider.name} / ${chosenName}`} disabled={providerLocked || switchingLocked}
      onClick={() => { setSearch(''); setSelectionError(''); setOpenPanel(openPanel === 'models' ? null : 'models'); }}>
      <span className="chat-model-trigger-label">{chosenName}</span>
      <ChevronDown size={13} aria-hidden="true" />
    </button>

    {!providerLocked && <div className="chat-reasoning-control">
      <button ref={reasoningButtonRef} type="button" className="chat-reasoning-trigger"
        aria-label={`${t('codex.reasoning')}: ${selectedEffort || t('codex.defaultEffort')}`}
        aria-expanded={openPanel === 'reasoning'} aria-controls="chat-composer-reasoning"
        title={t('codex.reasoning')} disabled={switchingLocked}
        onClick={() => setOpenPanel(openPanel === 'reasoning' ? null : 'reasoning')}>
        <span>{selectedEffort || t('codex.reasoning')}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {openPanel === 'reasoning' && <div id="chat-composer-reasoning" className="chat-reasoning-popover"
        role="group" aria-label={t('codex.reasoning')}>
        {['', ...effortChoices].map((choice) => <button key={choice} type="button"
          className={`chat-reasoning-option${selectedEffort === choice ? ' is-selected' : ''}`}
          aria-pressed={selectedEffort === choice} disabled={switchingLocked}
          onClick={() => {
            if (switchingLocked) return;
            if (providerId === 'codex') {
              setEffort(choice);
              void db.settings.put({ key: 'codexEffort', value: choice });
            } else if (cliEffortKey) {
              setCliEffortPreference({ key: cliEffortKey, value: choice });
              void db.settings.put({ key: cliEffortKey, value: choice });
            }
            closePanel();
          }}>
          <span>{choice || t('codex.defaultEffort')}</span>
          {selectedEffort === choice && <Check size={14} aria-hidden="true" />}
        </button>)}
        {effortChoices.length === 0 && <p className="chat-reasoning-help">
          {chosen ? t('cliChat.reasoningUnavailable') : t('cliChat.reasoningChooseModel')}
        </p>}
      </div>}
    </div>}

    {!providerLocked && providerId === 'codex' && <button ref={optionsButtonRef} type="button" className="chat-options-trigger"
      aria-label={t('codex.options')} aria-expanded={openPanel === 'options'} aria-controls="chat-composer-options"
      title={t('codex.options')}
      onClick={() => setOpenPanel(openPanel === 'options' ? null : 'options')}>
      <SlidersHorizontal size={14} aria-hidden="true" />
    </button>}

    {openPanel === 'models' && <div id="chat-composer-models" className="chat-model-popover"
      role="group" aria-label={t('cliChat.model')}>
      <input ref={searchRef} className="chat-model-search" type="search"
        aria-label={t('codex.searchModels')} placeholder={t('codex.searchModels')}
        value={search} onChange={(event) => setSearch(event.target.value)} />
      <div className="chat-model-list">
        {filtered.map((provider) => {
          if (query && provider.models.length === 0) return null;
          const cliId = isCliProviderId(provider.id) ? provider.id : null;
          const probe = cliId ? probes[cliId] : null;
          const status = provider.models.length ? '' : provider.id === 'codex'
            ? !connection ? t('codex.connectForModels')
              : codexModels.length === 0 ? t('codex.noModels') : t('codex.noVisibleModels')
            : isMockProviderId(provider.id) ? t('cliProviders.noVisibleModels')
            : !desktop ? t('cliProviders.status.desktopOnly')
              : loading[cliId!] ? t('cliProviders.status.checking')
                : probeErrors[cliId!] ? t('cliProviders.status.checkFailed')
                  : probe && !probe.installed ? t('cliProviders.status.notInstalled')
                  : probe?.authState === 'notAuthenticated' ? t('cliProviders.status.signInRequired')
                      : !probe ? t('cliProviders.status.notChecked')
                        : probe.error ? t('cliProviders.status.checkFailed')
                        : probe.models.length === 0 ? t('cliProviders.noModels')
                          : t('cliProviders.noVisibleModels');
          return <section className="chat-model-group" key={provider.id} aria-label={provider.name}>
            <div className="chat-model-group-header">{provider.name}</div>
            {provider.models.length ? provider.models.map((model) => {
              const selected = provider.id === providerId && chosen?.id === model.id;
              const needsSignIn = probe?.authState === 'notAuthenticated';
              return <button key={model.id} type="button"
                className={`chat-model-option${selected ? ' is-selected' : ''}`}
                aria-pressed={selected} disabled={selecting || needsSignIn || providerLocked || switchingLocked}
                title={needsSignIn ? t('cliProviders.status.signInRequired') : undefined}
                onClick={() => { void selectModel(provider.id, model.id); }}>
                <span className="chat-model-option-provider">{model.displayName}</span>
                {needsSignIn && <span className="chat-model-status">{t('cliProviders.status.signInRequired')}</span>}
                {selected && <Check size={14} aria-hidden="true" />}
              </button>;
            }) : <div className="chat-model-status chat-model-status--empty">{status}</div>}
          </section>;
        })}
        {query && matchedCount === 0 && <div className="chat-model-status chat-model-status--no-results">{t('codex.noSearchResults')}</div>}
      </div>
      {selectionError && <div className="chat-model-footer" role="alert">{selectionError}</div>}
      <div className="chat-model-footer">
        <button type="button" onClick={() => {
          attemptedRef.current.clear();
          void (async () => {
            for (const id of cliProviderIds) await probeOne(id);
          })();
        }}>{t('cliProviders.refresh')}</button>
        <button type="button" onClick={() => { setOpenPanel(null); openSettings('tools'); }}>{t('navigation.tools')}</button>
      </div>
    </div>}

    {openPanel === 'options' && providerId === 'codex' && <div id="chat-composer-options" className="chat-options-popover"
      role="group" aria-label={t('codex.options')}>
      <label className="chat-options-field" title={accessHint}>
        <span>{t('codex.fileAccess')}</span>
        <select aria-label={t('codex.fileAccess')} value={selectedAccess}
          disabled={accessLocked || !hasConnectedFolder}
          onChange={(event) => {
            const selected = event.target.value === 'workspaceWrite' ? 'workspaceWrite' : 'readOnly';
            setAccess(selected);
            void db.settings.put({ key: 'codexPermissionProfile', value: selected });
          }}>
          <option value="readOnly">{t('codex.readOnly')}</option>
          <option value="workspaceWrite">{t('codex.editFolder')}</option>
        </select>
        {accessHint && <small>{accessHint}</small>}
      </label>
      <div className="chat-options-unavailable">
        <span>{t('codex.search')}</span><small>{t('codex.searchUnavailable')}</small>
      </div>
    </div>}
  </div>;
}
