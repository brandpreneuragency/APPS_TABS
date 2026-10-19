import type { FormTemplate } from '../../../types/forms';
import { LayoutPanelTop, Plus, Pencil, Copy, Trash2, Eye } from 'lucide-react';
import '../forms.css';

interface TemplateCardProps {
  template: FormTemplate;
  onCreate: (template: FormTemplate) => void;
  onRename: (template: FormTemplate) => void;
  onDuplicate: (template: FormTemplate) => void;
  onDelete: (template: FormTemplate) => void;
  onPreview: (template: FormTemplate) => void;
}

function dateLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('tr-TR', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

export function TemplateCard({
  template,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
  onPreview,
}: TemplateCardProps) {
  const fieldCount = template.schema.fields.filter((f) => f.type !== 'submit').length;

  return (
    <div className="ui-card forms-template-card">
      <div className="forms-template-card-head">
        <span className="forms-kpi-card-icon">
          <LayoutPanelTop />
        </span>
        <span className="forms-list-item-meta">
          <Copy /> {fieldCount} fields
        </span>
      </div>
      <div>
        <div className="forms-template-card-name">{template.name}</div>
        <div className="forms-template-card-desc">
          {template.description ?? 'Saved form template'}
        </div>
        <div className="forms-list-item-meta" style={{ marginTop: 4 }}>
          Saved {dateLabel(template.createdAt)}
        </div>
      </div>
      <div className="forms-template-card-actions">
        <button
          type="button"
          className="ui-button forms-action-btn ui-button--primary forms-action-btn--primary"
          onClick={() => onCreate(template)}
          title="Create a new form from this template"
        >
          <Plus /> Use
        </button>
        <button type="button" className="ui-icon-button forms-action-btn forms-action-btn--ghost" onClick={() => onPreview(template)} title="Preview fields">
          <Eye />
        </button>
        <button type="button" className="ui-icon-button forms-action-btn forms-action-btn--ghost" onClick={() => onRename(template)} title="Rename">
          <Pencil />
        </button>
        <button type="button" className="ui-icon-button forms-action-btn forms-action-btn--ghost" onClick={() => onDuplicate(template)} title="Duplicate">
          <Copy />
        </button>
        <button
          type="button"
          className="ui-icon-button forms-action-btn forms-action-btn--ghost ui-button--danger forms-action-btn--danger"
          onClick={() => onDelete(template)}
          title="Delete template"
        >
          <Trash2 />
        </button>
      </div>
    </div>
  );
}
