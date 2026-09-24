import { Clock, Plus, User, X } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAIStore } from '../../stores/aiStore';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { ContextWindowPanel, ContextWindowSummaryTooltip, ContextWindowRing } from '../contextWindow';
import { db } from '../../services/db';
import type { ChatThreadMeta } from '../../types';

interface RightPanelSubheaderProps {
  /**
   * Optional override for the chat mode. When `undefined`, the subheader
   * derives the mode from the global UI store (task mode -> 'task',
   * otherwise 'writer'). Settings sub-tabs should pass `mode: 'writer'`.
   */
  mode?: 'writer' | 'task';
  /** Optional override for the workspace context (when not in task mode). */
  workspaceId?: string | null;
  /** Optional override for the task context (task mode). */
  taskId?: string | null;
  /** Optional Settings sub-tab id — when set, threads are scoped per tab. */
  settingsTab?: string | null;
}

/**
 * Assistant chat chrome: context window + history + new chat.
 * Shell swap lives in the global Header (not here).
 */
export function RightPanelSubheader({
  mode: modeOverride,
  workspaceId: workspaceIdOverride,
  taskId: taskIdOverride,
  settingsTab,
}: RightPanelSubheaderProps = {}) {
  const { threads, newChat, selectThread, deleteThread, activeThreadId } = useChatStore();
  const {
    taskMode,
    activeTaskId,
    contextWindowOpen,
    setContextWindowOpen,
  } = useUIStore();
  const { activeWorkspaceId } = useWorkspaceStore();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [legacyThreads, setLegacyThreads] = useState<ChatThreadMeta[]>([]);
  const [contextSummaryOpen, setContextSummaryOpen] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);
  const agentRef = useRef<HTMLDivElement>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const { t } = useTranslation();
  const { getActiveAgent, agents, setActiveAgent } = useAIStore();
  const contextWindowRef = useRef<HTMLDivElement>(null);

  // Resolve the active chat context. Props take precedence so this
  // subheader can be mounted under a Settings sub-tab without the global
  // uiStore knowing about the settings context.
  const mode: 'writer' | 'task' = modeOverride ?? (taskMode ? 'task' : 'writer');
  const activeAgent = getActiveAgent();
  const contextDocId = taskIdOverride
    ? null
    : workspaceIdOverride !== undefined
    ? workspaceIdOverride
    : taskMode
    ? null
    : activeWorkspaceId;
  const contextTaskId = taskIdOverride !== undefined
    ? taskIdOverride
    : taskMode
    ? activeTaskId
    : null;

  useEffect(() => {
    if (!historyOpen) return;
    let cancelled = false;
    void db.chatThreads.where('origin').equals('legacy_api').reverse().toArray()
      .then((rows) => { if (!cancelled) setLegacyThreads(rows); });
    return () => { cancelled = true; };
  }, [historyOpen]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (agentRef.current && !agentRef.current.contains(e.target as Node)) {
        setAgentOpen(false);
      }
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
      if (contextWindowRef.current && !contextWindowRef.current.contains(e.target as Node)) {
        setContextSummaryOpen(false);
        setContextWindowOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [setContextWindowOpen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAgentOpen(false);
        setHistoryOpen(false);
        setContextSummaryOpen(false);
        setContextWindowOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [setContextWindowOpen]);

  const handleNewChat = async () => {
    await newChat({
      mode,
      workspaceId: contextDocId || undefined,
      taskId: contextTaskId || undefined,
      settingsTab: settingsTab || undefined,
    });
    setHistoryOpen(false);
  };

  const handleSelectThread = async (threadId: string) => {
    await selectThread(threadId);
    setHistoryOpen(false);
  };

  const toggleContextWindow = () => {
    setHistoryOpen(false);
    setContextSummaryOpen(false);
    setContextWindowOpen(!contextWindowOpen);
  };

  return (
    <div id="right-panel-subheader" className="right-panel-subheader">
      <div className="editor-topbar-col justify-start">
        <div
          ref={contextWindowRef}
          className="context-window-trigger"
          data-align="left"
          onMouseEnter={() => {
            if (!contextWindowOpen) {
              setContextSummaryOpen(true);
            }
          }}
          onMouseLeave={() => setContextSummaryOpen(false)}
        >
          <button
            type="button"
            className={`tbar-btn ${contextWindowOpen ? 'tbar-btn--on' : ''}`}
            onClick={toggleContextWindow}
            title="Context window"
            aria-label="Context window"
            aria-haspopup="dialog"
            aria-expanded={contextWindowOpen ? 'true' : 'false'}
          >
            <ContextWindowRing size={18} />
          </button>
          {contextSummaryOpen && !contextWindowOpen && <ContextWindowSummaryTooltip />}
          {contextWindowOpen && (
            <div className="context-window-dropdown" role="dialog" aria-label="Context window">
              <ContextWindowPanel />
            </div>
          )}
        </div>
      </div>
      <div className="editor-topbar-col right-panel-agent-column">
        <div ref={agentRef} className="right-panel-agent-picker">
          <button
            type="button"
            className="tbar-btn right-panel-agent-button"
            title={activeAgent.name}
            aria-label={activeAgent.name}
            aria-haspopup="menu"
            aria-expanded={agentOpen}
            onClick={() => {
              setHistoryOpen(false);
              setContextSummaryOpen(false);
              setContextWindowOpen(false);
              setAgentOpen((open) => !open);
            }}
          >
            <User size={12} />
            <span className="trunc">{activeAgent.name}</span>
          </button>
          {agentOpen && (
            <div className="drop right-panel-agent-menu" role="menu" aria-label={activeAgent.name}>
              {agents.map((agent) => (
                <button
                  type="button"
                  key={agent.id}
                  role="menuitemradio"
                  aria-checked={agent.id === activeAgent.id}
                  className={`drop-item${agent.id === activeAgent.id ? ' header-dropdown-item--active' : ''}`}
                  onClick={() => { setActiveAgent(agent.id); setAgentOpen(false); }}
                >
                  <span className="trunc med">{agent.name}</span>
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                className="drop-item drop-item--brand"
                onClick={() => { useUIStore.getState().openSettings('agents'); setAgentOpen(false); }}
              >
                {t('sidebar.manageAgents')}
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="editor-topbar-col justify-end">
        <div
          ref={historyRef}
          className="right-panel-subheader-actions"
          data-align="right"
        >
          <button
            type="button"
            className="tbar-btn"
            onClick={() => {
              setContextSummaryOpen(false);
              setContextWindowOpen(false);
              setHistoryOpen((v) => !v);
            }}
            title="Chat history"
          >
            <Clock size={12} />
          </button>
          <button
            type="button"
            className="tbar-btn"
            onClick={handleNewChat}
            title="New chat"
          >
            <Plus size={12} />
          </button>
          {historyOpen && (
            <div className="chat-history-dropdown">
              {threads.length === 0 && legacyThreads.length === 0 && (
                <div className="chat-history-empty subtle">No chats yet</div>
              )}
              {threads.map((thread) => (
                <div
                  key={thread.id}
                  className={`chat-history-item ${thread.id === activeThreadId ? 'active' : ''}`}
                  onClick={() => handleSelectThread(thread.id)}
                >
                  <span className="trunc">{thread.title}</span>
                  <button
                    type="button"
                    className="chat-history-delete"
                    title="Delete chat"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteThread(thread.id);
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              {legacyThreads.some((thread) => !threads.some((current) => current.id === thread.id)) && (
                <div className="chat-history-empty subtle">{t('codex.legacyHistory')}</div>
              )}
              {legacyThreads.filter((thread) => !threads.some((current) => current.id === thread.id))
                .map((thread) => (
                  <button type="button" key={thread.id}
                    className={`chat-history-item ${thread.id === activeThreadId ? 'active' : ''}`}
                    onClick={() => void handleSelectThread(thread.id)}>
                    <span className="trunc">{thread.title}</span>
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
