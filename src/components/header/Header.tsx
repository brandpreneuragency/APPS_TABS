import { ArrowLeftRight, Minus, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ModeNavigation } from './ModeNavigation';
import { TaskAuthorityStatus } from '../taskManager/TaskAuthorityStatus';
import { AssistantToggle, ContextPanelToggle } from '../layout/workspace';
import { canStepEditorFontSize, stepEditorFontSize } from '../../stores/editorFontSize';
import { selectCanSwapWrappers, useUIStore } from '../../stores/uiStore';

export function Header() {
  const { t } = useTranslation();
  const wrappersSwapped = useUIStore((s) => s.wrappersSwapped);
  const toggleWrappersSwapped = useUIStore((s) => s.toggleWrappersSwapped);
  const canSwapWrappers = useUIStore(selectCanSwapWrappers);
  const fontSize = useUIStore((s) => s.editorFontSize);

  const swapLabel = wrappersSwapped
    ? 'Restore workspace and assistant order'
    : 'Swap workspace and assistant';

  return (
    <div id="header-bar" className="header-bar">
      <ModeNavigation />
      <div className="ai-toggle-col">
        <TaskAuthorityStatus />
        <button id="nav-btn-font-decrease" type="button" className="ai-toggle-btn" title={t('settings.decreaseTextSize')} aria-label={t('settings.decreaseTextSize')}
          disabled={!canStepEditorFontSize(fontSize, -1)} onClick={() => useUIStore.getState().setEditorFontSize(stepEditorFontSize(fontSize, -1))}><Minus size={15} /></button>
        <button id="nav-btn-font-increase" type="button" className="ai-toggle-btn" title={t('settings.increaseTextSize')} aria-label={t('settings.increaseTextSize')}
          disabled={!canStepEditorFontSize(fontSize, 1)} onClick={() => useUIStore.getState().setEditorFontSize(stepEditorFontSize(fontSize, 1))}><Plus size={15} /></button>
        <ContextPanelToggle variant="header" />
        <button
          id="header-btn-swap"
          type="button"
          title={canSwapWrappers ? swapLabel : 'Swap requires both workspace and assistant open'}
          aria-label={swapLabel}
          aria-pressed={wrappersSwapped}
          disabled={!canSwapWrappers}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => toggleWrappersSwapped()}
          className={`ai-toggle-btn${wrappersSwapped && canSwapWrappers ? ' ai-toggle-btn--on' : ''}`}
        >
          <ArrowLeftRight size={16} />
        </button>
        <AssistantToggle variant="header" />
      </div>
    </div>
  );
}
