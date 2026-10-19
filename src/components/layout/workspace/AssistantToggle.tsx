import { PanelRight } from 'lucide-react';
import { useUIStore } from '../../../stores/uiStore';

interface AssistantToggleProps {

  variant?: 'toolbar' | 'header';
  /** Override the default header id when the control is duplicated. */
  id?: string;
}

/**
 * Shows or hides the assistant wrapper.
 */
export function AssistantToggle({

  variant = 'toolbar',
  id = 'header-btn-assistant',
}: AssistantToggleProps) {
  const assistantOpen = useUIStore((s) => s.assistantWrapperOpen);
  const toggleAssistantWrapper = useUIStore((s) => s.toggleAssistantWrapper);

  const label = assistantOpen ? 'Hide assistant' : 'Show assistant';

  const className =
    variant === 'header'
      ? `ai-toggle-btn${assistantOpen ? ' ai-toggle-btn--on' : ''}`
      : `assistant-toggle tbar-btn${assistantOpen ? ' tbar-btn--on' : ''}`;

  const handleToggle = () => {
    const assistantEl = document.getElementById('assistant-wrapper');
    const focusInside = Boolean(
      assistantOpen && assistantEl?.contains(document.activeElement),
    );
    toggleAssistantWrapper();
    if (focusInside) {
      requestAnimationFrame(() => {
        document.getElementById(id)?.focus();
      });
    }
  };

  return (
    <button
      id={id}
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={variant === 'header' ? (event) => event.stopPropagation() : undefined}
      onClick={handleToggle}
      aria-pressed={assistantOpen}
      className={`ui-icon-button ${className}`}
    >
      <PanelRight />
    </button>
  );
}
