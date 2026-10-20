import { PanelLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WorkspaceMode } from '../../../stores/uiLayoutState';
import {
  selectActiveWorkspaceMode,
  selectIsContextPanelAvailable,
  useUIStore,
} from '../../../stores/uiStore';

const CONTEXT_PANEL_NOUN: Record<WorkspaceMode, string> = {
  documents: 'file tree',
  tasks: 'task list',
  crm: 'CRM list',
  forms: 'Forms list',
  settings: 'Settings list',
  github: 'repository files',
  notes: 'notes',
  providerAccounts: 'provider accounts',
};

interface ContextPanelToggleProps {
  mode?: WorkspaceMode;
  /** When false (e.g. Task Projects, CRM Pipeline), control is hidden. */
  available?: boolean;
  /** @deprecated UI icons follow the shared c-icon-1 token. */
  iconSize?: number;
  variant?: 'toolbar' | 'header';
  /** Override the default `context-panel-toggle-${mode}` id when the control is duplicated. */
  id?: string;
}

/**
 * Collapses the mode contextual panel only.
 */
export function ContextPanelToggle({
  mode: modeProp,
  available: availableProp,

  variant = 'toolbar',
  id: idProp,
}: ContextPanelToggleProps) {
  const { t } = useTranslation();
  const activeMode = useUIStore(selectActiveWorkspaceMode);
  const availableFromStore = useUIStore(selectIsContextPanelAvailable);
  const mode = modeProp ?? activeMode;
  const available = availableProp ?? (modeProp == null ? availableFromStore : true);
  const open = useUIStore((s) => s.contextPanelOpenByMode[mode]);
  const toggleContextPanel = useUIStore((s) => s.toggleContextPanel);

  if (!available) {
    if (variant === 'header') {
      return <span className="ui-icon-button ai-toggle-btn" aria-hidden="true" style={{ visibility: 'hidden' }} />;
    }
    return null;
  }

  const noun = CONTEXT_PANEL_NOUN[mode];
  const label = mode === 'github'
    ? t(open ? 'github.hideRepositoryPanel' : 'github.showRepositoryPanel')
    : open ? `Hide ${noun}` : `Show ${noun}`;

  const className =
    variant === 'header'
      ? `ai-toggle-btn${open ? ' ai-toggle-btn--on' : ''}`
      : `context-panel-toggle tbar-btn${open ? ' tbar-btn--on context-panel-toggle--on' : ''}`;

  return (
    <button
      id={idProp ?? `context-panel-toggle-${mode}`}
      type="button"
      className={"ui-icon-button " + (className)}
      onMouseDown={variant === 'header' ? (event) => event.stopPropagation() : undefined}
      onClick={() => toggleContextPanel(mode)}
      title={label}
      aria-label={label}
      aria-pressed={open}
    >
      <PanelLeft className="ui-icon"  />
    </button>
  );
}
