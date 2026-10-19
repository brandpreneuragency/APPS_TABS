import { useMemo } from 'react';
import { useFormsStore } from '../../../stores/formsStore';
import { useUIStore } from '../../../stores/uiStore';
import { LayoutPanelTop, Plus, FileText } from 'lucide-react';
import '../forms.css';

function dateLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('tr-TR', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export function TemplatesList() {
  const templates = useFormsStore((s) => s.templates);
  const activeTemplateId = useFormsStore((s) => s.activeTemplateId);
  const createFormFromTemplate = useFormsStore((s) => s.createFormFromTemplate);
  const setActiveTemplateId = useFormsStore((s) => s.setActiveTemplateId);
  const setActiveFormsPage = useUIStore((s) => s.setActiveFormsPage);
  const showToast = useUIStore((s) => s.showToast);

  const sorted = useMemo(
    () => [...templates].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [templates],
  );

  const handleSelect = (templateId: string) => {
    setActiveTemplateId(templateId);
    setActiveFormsPage('builder');
  };

  const handleUse = async (e: React.MouseEvent, templateId: string, name: string) => {
    e.stopPropagation();
    const form = await createFormFromTemplate(templateId, `${name}`);
    if (form) {
      setActiveFormsPage('builder');
      showToast(`Created form “${form.name}” from template.`, 'info');
    }
  };

  return (
    <>
      <div className="forms-list-section-label">Templates</div>
      {sorted.length === 0 ? (
        <div className="forms-list-empty-inline">
          No saved templates yet. Open a form and choose “Save as template”.
        </div>
      ) : (
        sorted.map((t) => {
          const fieldCount = t.schema.fields.filter((f) => f.type !== 'submit').length;
          const isActive = t.id === activeTemplateId;
          return (
            <div data-active={isActive}
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => handleSelect(t.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleSelect(t.id);
                }
              }}
              className={"ui-list-row " + (`forms-list-item${isActive ? ' forms-list-item--active' : ''}`)}
              style={{ cursor: 'pointer' }}
            >
              <span className="forms-list-item-title">
                <LayoutPanelTop className="forms-muted" />
                <span className="trunc forms-grow">{t.name}</span>
                <button
                  type="button"
                  className="ui-button forms-action-btn forms-action-btn--ghost"
                  style={{ fontSize: 'var(--fs-xs)' }}
                  onClick={(e) => void handleUse(e, t.id, t.name)}
                  title="Create form from template"
                >
                  <Plus /> Use
                </button>
              </span>
              <span className="forms-list-item-meta">
                <FileText />
                <span>{fieldCount} fields</span>
                <span>·</span>
                <span>{dateLabel(t.createdAt)}</span>
              </span>
            </div>
          );
        })
      )}
    </>
  );
}
